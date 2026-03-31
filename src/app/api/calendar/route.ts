import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

interface StageTimingEntry {
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

interface PlatformEntry {
  platform: string;
  success?: boolean | string;
  postId?: string | null;
  url?: string | null;
  error?: string;
  scheduledFor?: string;
  retryAfter?: number;
  startedAt?: number;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const daysBack = Math.min(parseInt(searchParams.get("days") ?? "7", 10), 90);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  const videos = await db.video.findMany({
    where: {
      series: { userId: session.user.id },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      scheduledPostTime: true,
      scheduledPlatforms: true,
      postedPlatforms: true,
      stageTimings: true,
      duration: true,
      sourceUrl: true,
      series: {
        select: {
          niche: true,
          automation: {
            select: { id: true, name: true, automationType: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const items = videos.map((v) => {
    const stages = v.stageTimings as Record<string, StageTimingEntry> | null;
    const platformEntries = (v.postedPlatforms ?? []) as unknown as PlatformEntry[];
    const scheduledPlatforms = (v.scheduledPlatforms ?? []) as string[];

    let buildDurationMs: number | null = null;
    let buildStartedAt: string | null = null;
    let buildCompletedAt: string | null = null;
    if (stages) {
      const allStarts = Object.values(stages).map((s) => s.startedAt).filter(Boolean) as number[];
      const allEnds = Object.values(stages).map((s) => s.completedAt).filter(Boolean) as number[];
      if (allStarts.length > 0 && allEnds.length > 0) {
        const earliest = Math.min(...allStarts);
        const latest = Math.max(...allEnds);
        buildDurationMs = latest - earliest;
        buildStartedAt = new Date(earliest).toISOString();
        buildCompletedAt = new Date(latest).toISOString();
      }
    }

    const stageBreakdown = stages
      ? Object.entries(stages).map(([name, s]) => ({
          name,
          durationMs: s.durationMs ?? null,
          startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
          completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : null,
        }))
      : [];

    const platforms = scheduledPlatforms.map((plat) => {
      const entry = platformEntries.find((e) => e.platform === plat);
      let status: string = "pending";
      if (!entry) {
        status = "pending";
      } else if (entry.success === true) {
        status = "posted";
      } else if (entry.success === "scheduled") {
        status = "scheduled";
      } else if (entry.success === "cooldown") {
        status = "cooldown";
      } else if (entry.success === "uploading") {
        status = "uploading";
      } else if (entry.success === "deleted") {
        status = "deleted";
      } else if (entry.success === false) {
        status = "failed";
      }
      return {
        platform: plat,
        status,
        postId: entry?.postId ?? null,
        url: entry?.url ?? null,
        error: entry?.error ?? null,
        scheduledFor: entry?.scheduledFor ?? null,
        retryAfter: entry?.retryAfter ?? null,
      };
    });

    const postedAt = (() => {
      const successEntries = platformEntries.filter((e) => e.success === true);
      if (successEntries.length === 0) return null;
      return v.updatedAt.toISOString();
    })();

    const schedToPostMs = (() => {
      if (!v.scheduledPostTime || !postedAt) return null;
      return new Date(postedAt).getTime() - new Date(v.scheduledPostTime).getTime();
    })();

    return {
      id: v.id,
      title: v.title,
      status: v.status,
      isClip: !!v.sourceUrl,
      automationName: v.series.automation?.name ?? null,
      automationType: v.series.automation?.automationType ?? "original",
      niche: v.series.niche,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      duration: v.duration,
      build: {
        startedAt: buildStartedAt,
        completedAt: buildCompletedAt,
        durationMs: buildDurationMs,
        stages: stageBreakdown,
      },
      schedule: {
        scheduledPostTime: v.scheduledPostTime?.toISOString() ?? null,
        postedAt,
        schedToPostMs,
      },
      platforms,
    };
  });

  return NextResponse.json({ videos: items, daysBack });
}
