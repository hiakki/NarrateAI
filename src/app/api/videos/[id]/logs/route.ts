import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { automationLogDir, listLogDates, readLogFile } from "@/lib/file-logger";

function parseLines(content: string) {
  const lines = content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  return lines.map((line) => {
    const m = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/);
    if (!m) return { raw: line, ts: null as string | null, tag: null as string | null, message: line };
    return { raw: line, ts: m[1], tag: m[2], message: m[3] };
  });
}

function extractVideoRunLines(
  lines: Array<{ raw: string; ts: string | null; tag: string | null; message: string }>,
  videoId: string,
) {
  const directMatches = lines.filter((line) => line.raw.includes(videoId) || line.message.includes(`video=${videoId}`));
  if (directMatches.length === 0) return [];

  const startIdx = lines.findIndex((line) => line.message.includes(`JOB START: video=${videoId}`));
  if (startIdx === -1) return directMatches;

  let endIdx = lines.length - 1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const msg = lines[i].message;
    if (msg.startsWith("JOB START: video=") && !msg.includes(`video=${videoId}`)) {
      endIdx = i - 1;
      break;
    }
    if (msg.includes("FAILED:") && msg.includes(videoId)) {
      endIdx = i;
      break;
    }
    if (msg.startsWith("READY:") && msg.includes(videoId)) {
      endIdx = i;
      break;
    }
  }

  return lines.slice(startIdx, endIdx + 1);
}

function parseTriggerFromSchedulerMessage(message: string): {
  triggerSource: string | null;
  triggerLabel: string | null;
  reason: string | null;
} {
  const triggerMatch = message.match(/\[trigger=([^\]]+)\]/);
  const triggerSource = triggerMatch?.[1] ?? null;

  const labelMap: Record<string, string> = {
    "build-window-cron": "BUILD_ALL_TIME window",
    "catch-up-cron": "Catch-up window",
    startup: "Scheduler startup",
    "post-optimize": "Post-optimize sweep",
    "user-run-now": "Run Now",
  };
  const triggerLabel = triggerSource ? (labelMap[triggerSource] ?? triggerSource) : null;

  const reasonMatch = message.match(/Ran \([^)]+\):\s*([^.]*)/);
  const reason = reasonMatch?.[1]?.trim() ?? null;

  return { triggerSource, triggerLabel, reason };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: videoId } = await params;

  const video = await db.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      sourceMetadata: true,
      createdAt: true,
      series: {
        select: {
          userId: true,
          automation: {
            select: { id: true, name: true },
          },
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
  });

  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  if (video.series.userId !== session.user.id && session.user.role === "USER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ctxRoot = (video.sourceMetadata && typeof video.sourceMetadata === "object")
    ? (video.sourceMetadata as Record<string, unknown>)
    : {};
  const generationContext = (ctxRoot.generationContext && typeof ctxRoot.generationContext === "object")
    ? (ctxRoot.generationContext as Record<string, unknown>)
    : null;
  const triggerFallback = generationContext ?? (() => {
    const t = (ctxRoot.triggerType && typeof ctxRoot.triggerType === "string") ? ctxRoot.triggerType : null;
    const s = (ctxRoot.triggerSource && typeof ctxRoot.triggerSource === "string") ? ctxRoot.triggerSource : null;
    const label = (ctxRoot.triggerLabel && typeof ctxRoot.triggerLabel === "string") ? ctxRoot.triggerLabel : null;
    const reason = (ctxRoot.triggerReason && typeof ctxRoot.triggerReason === "string") ? ctxRoot.triggerReason : null;
    const at = (ctxRoot.triggeredAt && typeof ctxRoot.triggeredAt === "string") ? ctxRoot.triggeredAt : null;
    if (!t && !s && !label && !reason && !at) return null;
    return { triggerType: t, triggerSource: s, triggerLabel: label, reason, triggeredAt: at };
  })();
  let resolvedTrigger = triggerFallback;

  const automation = video.series.automation;
  if (!automation) {
    return NextResponse.json({
      data: {
        videoId,
        trigger: triggerFallback,
        logDate: null,
        lines: [],
      },
    });
  }

  const userDisplay = video.series.user.name ?? video.series.user.email?.split("@")[0] ?? "user";
  const logDir = automationLogDir(video.series.user.id, userDisplay, automation.id, automation.name);

  if (!resolvedTrigger) {
    const lastRunLog = await db.schedulerLog.findFirst({
      where: { automationId: automation.id, videoId },
      orderBy: { createdAt: "desc" },
      select: { message: true, createdAt: true },
    });
    if (lastRunLog?.message) {
      const parsed = parseTriggerFromSchedulerMessage(lastRunLog.message);
      resolvedTrigger = {
        triggerType: "scheduler",
        triggerSource: parsed.triggerSource,
        triggerLabel: parsed.triggerLabel,
        reason: parsed.reason,
        triggeredAt: lastRunLog.createdAt.toISOString(),
      };
    }
  }

  const dates = await listLogDates(logDir);
  if (dates.length === 0) {
    return NextResponse.json({
      data: {
        videoId,
        automationId: automation.id,
        trigger: resolvedTrigger,
        logDate: null,
        lines: [],
      },
    });
  }

  // Prefer the video creation day, then fallback to newest available file.
  const videoDate = video.createdAt.toISOString().slice(0, 10);
  const chosenDate = dates.includes(videoDate) ? videoDate : dates[0];
  const content = (await readLogFile(logDir, chosenDate)) ?? "";
  const parsed = parseLines(content);

  const filtered = extractVideoRunLines(parsed, videoId);

  return NextResponse.json({
    data: {
      videoId,
      automationId: automation.id,
      trigger: resolvedTrigger,
      logDate: chosenDate,
      lines: filtered,
      lineCount: filtered.length,
    },
  });
}
