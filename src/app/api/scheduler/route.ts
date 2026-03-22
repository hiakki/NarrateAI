import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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

    const data = automations.map((a) => ({
      ...a,
      clipConfig: a.automationType === "clip-repurpose" ? a.clipConfig : undefined,
      stuckVideos: a.series?.videos ?? [],
      scheduledVideos: a.series ? (readyBySeriesId.get(a.series.id) ?? []) : [],
    }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Scheduler API error:", error);
    return NextResponse.json({ error: "Failed to load scheduler data" }, { status: 500 });
  }
}
