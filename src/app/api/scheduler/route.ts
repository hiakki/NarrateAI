import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeNextRunAt, computeNextPostAt } from "@/lib/scheduler-utils";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const automations = await db.automation.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        name: true,
        automationType: true,
        enabled: true,
        frequency: true,
        postTime: true,
        timezone: true,
        lastRunAt: true,
        niche: true,
        targetPlatforms: true,
        clipConfig: true,
        schedulerLogs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            outcome: true,
            message: true,
            errorDetail: true,
            durationMs: true,
            videoId: true,
            createdAt: true,
          },
        },
        series: {
          select: {
            id: true,
            videos: {
              where: { status: { in: ["GENERATING", "QUEUED", "FAILED"] } },
              select: {
                id: true,
                title: true,
                status: true,
                errorMessage: true,
                createdAt: true,
                updatedAt: true,
                retryCount: true,
                scheduledPostTime: true,
              },
              orderBy: { updatedAt: "desc" },
              take: 20,
            },
            _count: { select: { videos: true } },
          },
        },
      },
      orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
    });

    const readyToPost = await db.video.findMany({
      where: {
        status: "READY",
        scheduledPostTime: { not: null },
        series: { automation: { userId: session.user.id } },
      },
      select: {
        id: true,
        title: true,
        status: true,
        scheduledPostTime: true,
        scheduledPlatforms: true,
        seriesId: true,
      },
    });

    const readyBySeriesId = new Map<string, typeof readyToPost>();
    for (const v of readyToPost) {
      const arr = readyBySeriesId.get(v.seriesId) ?? [];
      arr.push(v);
      readyBySeriesId.set(v.seriesId, arr);
    }

    // Fallback: if lastRunAt is null, derive from latest video
    const seriesIds = automations.map((a) => a.series?.id).filter(Boolean) as string[];
    const latestVideoBySeriesRaw = seriesIds.length > 0
      ? await db.video.findMany({
          where: { seriesId: { in: seriesIds } },
          orderBy: { createdAt: "desc" },
          distinct: ["seriesId"],
          select: { seriesId: true, createdAt: true },
        })
      : [];
    const latestBySeriesId = new Map(latestVideoBySeriesRaw.map((v) => [v.seriesId, v.createdAt]));

    const data = automations.map((a) => {
      // Use actual last video build time (ground truth) over scheduler's lastRunAt
      const lastBuildAt = a.series?.id ? latestBySeriesId.get(a.series.id) ?? null : null;
      const effectiveLastRunAt = lastBuildAt ?? a.lastRunAt;
      const autoWithLastRun = { ...a, lastRunAt: effectiveLastRunAt };
      const nextRunAt = computeNextRunAt(autoWithLastRun);
      const nextPostAt = computeNextPostAt(a.postTime, a.timezone);
      return {
        ...a,
        lastRunAt: effectiveLastRunAt?.toISOString?.() ?? (effectiveLastRunAt as string | null),
        clipConfig: a.automationType === "clip-repurpose" ? a.clipConfig : undefined,
        stuckVideos: a.series?.videos ?? [],
        scheduledVideos: a.series ? (readyBySeriesId.get(a.series.id) ?? []) : [],
        nextRunAt: nextRunAt?.toISOString() ?? null,
        nextPostAt: nextPostAt?.toISOString() ?? null,
        totalVideos: a.series?._count?.videos ?? 0,
      };
    });

    // Sort by next post time (earliest first), nulls last
    data.sort((a, b) => {
      const ta = a.nextPostAt ? new Date(a.nextPostAt).getTime() : Infinity;
      const tb = b.nextPostAt ? new Date(b.nextPostAt).getTime() : Infinity;
      return ta - tb;
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Scheduler API error:", error);
    return NextResponse.json({ error: "Failed to load scheduler data" }, { status: 500 });
  }
}
