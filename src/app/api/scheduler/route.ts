import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const BUILD_ALL_TIME = process.env.BUILD_ALL_TIME ?? "04:00";
const BUILD_ALL_TIMEZONE = process.env.BUILD_ALL_TIMEZONE ?? "Asia/Kolkata";
const BUILD_WINDOW_MINUTES = 60;

function localTimeToUTC(timeStr: string, tz: string): Date {
  const [targetH, targetM] = timeStr.split(":").map(Number);
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now);
  const year = parseInt(dateParts.find((p) => p.type === "year")!.value);
  const month = parseInt(dateParts.find((p) => p.type === "month")!.value) - 1;
  const day = parseInt(dateParts.find((p) => p.type === "day")!.value);
  const noonUtc = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const noonParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(noonUtc);
  const noonH = parseInt(noonParts.find((p) => p.type === "hour")!.value);
  const noonM = parseInt(noonParts.find((p) => p.type === "minute")!.value);
  const offsetMin = (noonH * 60 + noonM) - 720;
  const targetUtcMin = targetH * 60 + targetM - offsetMin;
  let guess = new Date(Date.UTC(year, month, day, 0, targetUtcMin, 0));
  for (let i = 0; i < 3; i++) {
    const lp = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", minute: "numeric", hour12: false,
    }).formatToParts(guess);
    const lh = parseInt(lp.find((p) => p.type === "hour")!.value);
    const lm = parseInt(lp.find((p) => p.type === "minute")!.value);
    const diff = (targetH * 60 + targetM) - (lh * 60 + lm);
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff * 60000);
  }
  return guess;
}

function computeNextRunAt(
  auto: { enabled: boolean; frequency: string; lastRunAt: Date | null; postTime: string; timezone: string },
): Date | null {
  if (!auto.enabled) return null;

  const freqDays: Record<string, number> = { daily: 1, every_other_day: 2, weekly: 7 };
  const gap = freqDays[auto.frequency] ?? 1;

  const now = new Date();
  const todayBuild = localTimeToUTC(BUILD_ALL_TIME, BUILD_ALL_TIMEZONE);

  let nextBuild = new Date(todayBuild);

  // Advance to the next future build window
  while (nextBuild.getTime() + BUILD_WINDOW_MINUTES * 60000 < now.getTime()) {
    nextBuild = new Date(nextBuild.getTime() + 24 * 60 * 60 * 1000);
  }

  if (auto.lastRunAt) {
    const minGapMs = (gap - 0.25) * 24 * 60 * 60 * 1000;
    const earliest = new Date(auto.lastRunAt.getTime() + minGapMs);
    while (nextBuild < earliest) {
      nextBuild = new Date(nextBuild.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  return nextBuild;
}

function computeNextPostAt(auto: { postTime: string; timezone: string }): Date {
  const postSlot = auto.postTime.split(",")[0].trim();
  const postTime = localTimeToUTC(postSlot, auto.timezone);
  if (postTime.getTime() < Date.now()) {
    return new Date(postTime.getTime() + 24 * 60 * 60 * 1000);
  }
  return postTime;
}

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
      const effectiveLastRunAt = a.lastRunAt
        ?? (a.series?.id ? latestBySeriesId.get(a.series.id) ?? null : null);
      const autoWithLastRun = { ...a, lastRunAt: effectiveLastRunAt };
      const nextRunAt = computeNextRunAt(autoWithLastRun);
      const nextPostAt = computeNextPostAt(a);
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
