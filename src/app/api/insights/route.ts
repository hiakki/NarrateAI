import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

type VideoInsightPlatform = { views?: number; likes?: number; comments?: number; reactions?: number };
type VideoInsightsMap = Record<string, VideoInsightPlatform>;

function sumInsights(insights: VideoInsightsMap | null): {
  views: number;
  likes: number;
  comments: number;
  reactions: number;
} {
  let views = 0, likes = 0, comments = 0, reactions = 0;
  if (!insights || typeof insights !== "object") return { views, likes, comments, reactions };
  const platformKeys = ["YOUTUBE", "INSTAGRAM", "FACEBOOK"];
  for (const platform of platformKeys) {
    const p = (insights as Record<string, unknown>)[platform];
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const o = p as { views?: number; likes?: number; comments?: number; reactions?: number };
      views += Number(o.views) || 0;
      likes += Number(o.likes) || 0;
      comments += Number(o.comments) || 0;
      reactions += Number(o.reactions) || 0;
    }
  }
  return { views, likes, comments, reactions };
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const automationId = searchParams.get("automationId") ?? undefined;

    const userId = session.user.id;

    if (automationId) {
      const automation = await db.automation.findFirst({
        where: { id: automationId, userId },
        include: {
          series: {
            include: {
              videos: {
                where: { status: "POSTED" },
                select: { id: true, insights: true, insightsRefreshedAt: true },
              },
            },
          },
        },
      });
      if (!automation?.series) {
        return NextResponse.json({
          data: {
            lastRefreshedAt: null,
            automationId,
            summary: { totalViews: 0, totalLikes: 0, totalComments: 0, totalReactions: 0, totalInteractions: 0, videoCount: 0 },
          },
        });
      }
      const videos = automation.series.videos;
      let totalViews = 0, totalLikes = 0, totalComments = 0, totalReactions = 0;
      let lastRefreshedAt: Date | null = null;
      for (const v of videos) {
        const s = sumInsights(v.insights as VideoInsightsMap);
        totalViews += s.views;
        totalLikes += s.likes;
        totalComments += s.comments;
        totalReactions += s.reactions;
        if (v.insightsRefreshedAt && (!lastRefreshedAt || v.insightsRefreshedAt > lastRefreshedAt)) {
          lastRefreshedAt = v.insightsRefreshedAt;
        }
      }
      return NextResponse.json({
        data: {
          lastRefreshedAt: lastRefreshedAt?.toISOString() ?? null,
          automationId,
          summary: {
            totalViews,
            totalLikes,
            totalComments,
            totalReactions,
            totalInteractions: totalLikes + totalComments + totalReactions,
            videoCount: videos.length,
          },
        },
      });
    }

    // User-level: all posted videos and latest refreshed time
    const videos = await db.video.findMany({
      where: { series: { userId }, status: "POSTED" },
      select: { id: true, seriesId: true, insights: true, insightsRefreshedAt: true },
    });
    let totalViews = 0, totalLikes = 0, totalComments = 0, totalReactions = 0;
    let lastRefreshedAt: Date | null = null;
    for (const v of videos) {
      const s = sumInsights(v.insights as VideoInsightsMap);
      totalViews += s.views;
      totalLikes += s.likes;
      totalComments += s.comments;
      totalReactions += s.reactions;
      if (v.insightsRefreshedAt && (!lastRefreshedAt || v.insightsRefreshedAt > lastRefreshedAt)) {
        lastRefreshedAt = v.insightsRefreshedAt;
      }
    }

    // Per-automation breakdown for automations page
    const automations = await db.automation.findMany({
      where: { userId },
      select: { id: true, name: true, seriesId: true },
    });
    const byAutomation: Record<string, { totalViews: number; totalLikes: number; totalComments: number; totalReactions: number; totalInteractions: number; videoCount: number; lastRefreshedAt: string | null }> = {};
    for (const auto of automations) {
      if (!auto.seriesId) {
        byAutomation[auto.id] = { totalViews: 0, totalLikes: 0, totalComments: 0, totalReactions: 0, totalInteractions: 0, videoCount: 0, lastRefreshedAt: null };
        continue;
      }
      const autoVideos = videos.filter((v) => v.seriesId === auto.seriesId);
      let av = 0, al = 0, ac = 0, ar = 0;
      let aRefreshed: Date | null = null;
      for (const v of autoVideos) {
        const s = sumInsights(v.insights as VideoInsightsMap);
        av += s.views;
        al += s.likes;
        ac += s.comments;
        ar += s.reactions;
        if (v.insightsRefreshedAt && (!aRefreshed || v.insightsRefreshedAt > aRefreshed)) aRefreshed = v.insightsRefreshedAt;
      }
      byAutomation[auto.id] = {
        totalViews: av,
        totalLikes: al,
        totalComments: ac,
        totalReactions: ar,
        totalInteractions: al + ac + ar,
        videoCount: autoVideos.length,
        lastRefreshedAt: aRefreshed?.toISOString() ?? null,
      };
    }

    return NextResponse.json({
      data: {
        lastRefreshedAt: lastRefreshedAt?.toISOString() ?? null,
        summary: {
          totalViews,
          totalLikes,
          totalComments,
          totalReactions,
          totalInteractions: totalLikes + totalComments + totalReactions,
          videoCount: videos.length,
        },
        byAutomation,
      },
    });
  } catch (error) {
    console.error("Insights GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load insights" },
      { status: 500 },
    );
  }
}
