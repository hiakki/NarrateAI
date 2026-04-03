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

  const automation = video.series.automation;
  if (!automation) {
    return NextResponse.json({
      data: {
        videoId,
        trigger: generationContext,
        logDate: null,
        lines: [],
      },
    });
  }

  const userDisplay = video.series.user.name ?? video.series.user.email?.split("@")[0] ?? "user";
  const logDir = automationLogDir(video.series.user.id, userDisplay, automation.id, automation.name);
  const dates = await listLogDates(logDir);
  if (dates.length === 0) {
    return NextResponse.json({
      data: {
        videoId,
        automationId: automation.id,
        trigger: generationContext,
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

  const needle = `video=${videoId}`;
  const filtered = parsed.filter((line) => line.raw.includes(videoId) || line.message.includes(needle));

  return NextResponse.json({
    data: {
      videoId,
      automationId: automation.id,
      trigger: generationContext,
      logDate: chosenDate,
      lines: filtered,
      lineCount: filtered.length,
    },
  });
}
