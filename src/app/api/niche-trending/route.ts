import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CLIP_NICHE_META, computeViewPrediction } from "@/config/clip-niches";

interface NicheTrendingStats {
  candidateCount: number;
  platforms: Record<string, { count: number; avgViews: number }>;
  top20: {
    maxViews: number;
    avgViews: number;
    minViews: number;
    avgScore: number;
    maxScore: number;
  };
  topCandidates: Array<{
    title: string;
    url: string;
    viewCount: number;
    platform: string;
    channelName: string;
    score: number;
  }>;
}

function aggregateStats(history: Array<{ stats: NicheTrendingStats }>): NicheTrendingStats | null {
  const valid = history.filter((h) => h.stats?.top20);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0].stats;

  const n = valid.length;
  const platforms: Record<string, { totalCount: number; totalViews: number; days: number }> = {};
  for (const h of valid) {
    for (const [p, s] of Object.entries(h.stats.platforms ?? {})) {
      const cur = platforms[p] ?? { totalCount: 0, totalViews: 0, days: 0 };
      cur.totalCount += s.count;
      cur.totalViews += s.avgViews * s.count;
      cur.days++;
      platforms[p] = cur;
    }
  }

  const bestCandidates = valid
    .flatMap((h) => h.stats.topCandidates ?? [])
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    candidateCount: Math.round(valid.reduce((s, h) => s + h.stats.candidateCount, 0) / n),
    platforms: Object.fromEntries(
      Object.entries(platforms).map(([k, v]) => [
        k,
        { count: v.totalCount, avgViews: v.totalCount > 0 ? Math.round(v.totalViews / v.totalCount) : 0 },
      ]),
    ),
    top20: {
      maxViews: Math.max(...valid.map((h) => h.stats.top20.maxViews)),
      avgViews: Math.round(valid.reduce((s, h) => s + h.stats.top20.avgViews, 0) / n),
      minViews: Math.min(...valid.map((h) => h.stats.top20.minViews)),
      avgScore: Math.round((valid.reduce((s, h) => s + h.stats.top20.avgScore, 0) / n) * 100) / 100,
      maxScore: Math.max(...valid.map((h) => h.stats.top20.maxScore)),
    },
    topCandidates: bestCandidates,
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const niche = searchParams.get("niche");
    const days = Math.min(parseInt(searchParams.get("days") ?? "1", 10), 90);

    const since = new Date();
    since.setDate(since.getDate() - Math.max(days, 1));

    const where: Record<string, unknown> = {
      date: { gte: since },
    };
    if (niche) where.niche = niche;

    const rows = await db.nicheTrending.findMany({
      where,
      orderBy: [{ niche: "asc" }, { date: "desc" }],
      take: 2000,
    });

    const grouped: Record<
      string,
      {
        meta: (typeof CLIP_NICHE_META)[string] | null;
        prediction: ReturnType<typeof computeViewPrediction> | null;
        history: Array<{ date: string; stats: NicheTrendingStats }>;
        aggregated: NicheTrendingStats | null;
      }
    > = {};

    for (const row of rows) {
      const key = row.niche;
      if (!grouped[key]) {
        grouped[key] = {
          meta: CLIP_NICHE_META[key] ?? null,
          prediction: null,
          history: [],
          aggregated: null,
        };
      }
      grouped[key].history.push({
        date: row.date.toISOString().slice(0, 10),
        stats: row.stats as unknown as NicheTrendingStats,
      });
    }

    for (const [key, entry] of Object.entries(grouped)) {
      entry.aggregated = aggregateStats(entry.history);

      const stats = entry.aggregated ?? entry.history[0]?.stats;
      if (stats?.top20) {
        entry.prediction = computeViewPrediction(
          stats.top20.avgViews,
          stats.top20.avgScore,
        );
      }
      if (!entry.meta && CLIP_NICHE_META[key]) {
        entry.meta = CLIP_NICHE_META[key];
      }
    }

    const allNicheKeys = Object.keys(CLIP_NICHE_META).filter((k) => k !== "auto");
    for (const key of allNicheKeys) {
      if (!grouped[key]) {
        grouped[key] = {
          meta: CLIP_NICHE_META[key],
          prediction: null,
          history: [],
          aggregated: null,
        };
      }
    }

    return NextResponse.json({ data: grouped, days });
  } catch (err) {
    console.error("niche-trending API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
