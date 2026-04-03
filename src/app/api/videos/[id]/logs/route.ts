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

function extractVideoId(msg: string): string | null {
  const m = msg.match(/video=([a-z0-9]+)/i);
  return m?.[1] ?? null;
}

function extractVideoRunLines(
  lines: Array<{ raw: string; ts: string | null; tag: string | null; message: string }>,
  videoId: string,
) {
  const directMatches = lines.filter((line) => line.raw.includes(videoId) || line.message.includes(`video=${videoId}`));
  if (directMatches.length === 0) return [];

  const startIdx = lines.findIndex((line) => line.message.includes(`JOB START: video=${videoId}`));
  const firstDirectIdx = lines.findIndex((line) => line.raw.includes(videoId) || line.message.includes(`video=${videoId}`));
  const actualStart = startIdx >= 0 ? startIdx : firstDirectIdx;
  if (actualStart < 0) return directMatches;

  let endIdx = lines.length - 1;
  for (let i = actualStart + 1; i < lines.length; i++) {
    const msg = lines[i].message;
    const tag = lines[i].tag;
    if (msg.startsWith("JOB START: video=") && !msg.includes(`video=${videoId}`)) {
      endIdx = i - 1;
      break;
    }
    // Another worker/poster block for a different video usually indicates we should stop.
    const seenVideoId = extractVideoId(msg);
    if (seenVideoId && seenVideoId !== videoId && (tag === "WORKER" || tag === "POSTER")) {
      endIdx = i - 1;
      break;
    }
    // Avoid trailing unrelated scheduler noise that has no video linkage.
    if (tag === "SCHEDULER" && !msg.includes(videoId)) {
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

  return lines.slice(actualStart, endIdx + 1);
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

  // Read this video's date and all subsequent dates (newer) so cross-day
  // scheduling/reconcile activity stays visible.
  const videoDate = video.createdAt.toISOString().slice(0, 10);
  const relevantDates = dates
    .filter((d) => d >= videoDate)
    .sort()
    .slice(-7); // cap to recent week for response size

  const parsedByDate: Array<{ date: string; lines: Array<{ raw: string; ts: string | null; tag: string | null; message: string }> }> = [];
  for (const d of relevantDates) {
    const content = (await readLogFile(logDir, d)) ?? "";
    if (!content) continue;
    const parsed = parseLines(content);
    const block = extractVideoRunLines(parsed, videoId);
    if (block.length > 0) parsedByDate.push({ date: d, lines: block });
  }

  const filtered = parsedByDate.flatMap((x) => x.lines);
  const chosenDate = parsedByDate.length > 0 ? parsedByDate[0].date : (relevantDates[0] ?? dates[0]);
  const datesUsed = parsedByDate.map((x) => x.date);

  let finalTrigger = resolvedTrigger;
  if (!finalTrigger && filtered.length > 0) {
    finalTrigger = {
      triggerType: "inferred",
      triggerSource: "historical-log-inference",
      triggerLabel: "Automation Run (inferred)",
      reason: "Historical run created before trigger metadata was stored",
      triggeredAt: filtered[0]?.ts ?? null,
    };
  }

  return NextResponse.json({
    data: {
      videoId,
      automationId: automation.id,
      trigger: finalTrigger,
      logDate: chosenDate,
      logDatesUsed: datesUsed,
      availableDates: dates,
      lines: filtered,
      lineCount: filtered.length,
    },
  });
}
