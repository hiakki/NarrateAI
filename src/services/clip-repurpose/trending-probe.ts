import { PrismaClient } from "@prisma/client";
import { createLogger } from "@/lib/logger";
import {
  discoverViaSearch,
  scoreCandidate,
  NICHE_SEARCH_QUERIES,
  CLIP_NICHES,
  type ClipNiche,
  type DiscoveredVideo,
  type DiscoveryResult,
} from "./discovery";
import { searchFbVideos, searchIgReels } from "./browser-scraper";

const log = createLogger("TrendingProbe");

interface NicheTrendingStats {
  date: string;
  niche: string;
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

function computeStats(
  niche: ClipNiche,
  candidates: DiscoveredVideo[],
): NicheTrendingStats {
  const today = new Date().toISOString().slice(0, 10);
  const scored = candidates
    .map((c) => ({ ...c, score: scoreCandidate(c, niche) }))
    .sort((a, b) => b.score - a.score);

  const platforms: Record<string, { count: number; totalViews: number }> = {};
  for (const c of scored) {
    const p = platforms[c.platform] ?? { count: 0, totalViews: 0 };
    p.count++;
    p.totalViews += c.viewCount;
    platforms[c.platform] = p;
  }

  const top20 = scored.slice(0, 20);
  const views = top20.map((c) => c.viewCount);
  const scores = top20.map((c) => c.score);

  return {
    date: today,
    niche,
    candidateCount: scored.length,
    platforms: Object.fromEntries(
      Object.entries(platforms).map(([k, v]) => [
        k,
        { count: v.count, avgViews: v.count > 0 ? Math.round(v.totalViews / v.count) : 0 },
      ]),
    ),
    top20: {
      maxViews: views.length > 0 ? Math.max(...views) : 0,
      avgViews: views.length > 0 ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0,
      minViews: views.length > 0 ? Math.min(...views) : 0,
      avgScore: scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0,
      maxScore: scores.length > 0 ? Math.max(...scores) : 0,
    },
    topCandidates: top20.slice(0, 10).map((c) => ({
      title: c.title || "(untitled)",
      url: c.url,
      viewCount: c.viewCount,
      platform: c.platform,
      channelName: c.channelName || "(unknown)",
      score: c.score,
    })),
  };
}

/**
 * Probe a single niche across YouTube, Facebook, and Instagram.
 * YT uses yt-dlp search; FB/IG use browser scraping (best-effort).
 */
export async function probeNicheTrending(niche: ClipNiche): Promise<NicheTrendingStats> {
  log.log(`[PROBE] Starting multi-platform probe for niche "${niche}"...`);

  const searchQuery = NICHE_SEARCH_QUERIES[niche]?.[0] ?? niche;

  const [ytEntries, fbResults, igResults] = await Promise.all([
    discoverViaSearch(niche, 10).catch((e) => {
      log.warn(`[PROBE] YT search failed for "${niche}": ${e instanceof Error ? e.message : e}`);
      return [] as Awaited<ReturnType<typeof discoverViaSearch>>;
    }),
    searchFbVideos(searchQuery, 8).catch((e) => {
      log.warn(`[PROBE] FB search failed for "${niche}": ${e instanceof Error ? e.message : e}`);
      return [] as Awaited<ReturnType<typeof searchFbVideos>>;
    }),
    searchIgReels(searchQuery, 8).catch((e) => {
      log.warn(`[PROBE] IG search failed for "${niche}": ${e instanceof Error ? e.message : e}`);
      return [] as Awaited<ReturnType<typeof searchIgReels>>;
    }),
  ]);

  const ytCandidates: DiscoveredVideo[] = ytEntries
    .filter((e) => e.id && e.view_count > 0)
    .map((e) => ({
      videoId: e.id,
      url: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`,
      title: e.title,
      channelId: e.channel_id,
      channelName: e.channel,
      viewCount: e.view_count,
      publishedAt: e.upload_date,
      durationSec: e.duration,
      platform: "youtube" as const,
      source: "search" as const,
    }));

  const fbCandidates: DiscoveredVideo[] = fbResults
    .filter((v) => v.viewCount > 0)
    .map((v) => ({
      videoId: v.videoId,
      url: v.url,
      title: v.title,
      channelId: "",
      channelName: v.channelName,
      viewCount: v.viewCount,
      publishedAt: "",
      durationSec: v.durationSec,
      platform: "facebook" as const,
      source: "search" as const,
    }));

  const igCandidates: DiscoveredVideo[] = igResults
    .filter((v) => v.viewCount > 0)
    .map((v) => ({
      videoId: v.videoId,
      url: v.url,
      title: v.title,
      channelId: "",
      channelName: v.channelName,
      viewCount: v.viewCount,
      publishedAt: "",
      durationSec: v.durationSec,
      platform: "instagram" as const,
      source: "search" as const,
    }));

  const candidates = [...ytCandidates, ...fbCandidates, ...igCandidates];
  const stats = computeStats(niche, candidates);
  log.log(
    `[PROBE] "${niche}": ${stats.candidateCount} candidates ` +
    `(YT=${ytCandidates.length} FB=${fbCandidates.length} IG=${igCandidates.length}), ` +
    `top20 avg=${stats.top20.avgViews.toLocaleString()} views, avgScore=${stats.top20.avgScore}`,
  );
  return stats;
}

/**
 * Probe all niches (excluding "auto") and upsert results into NicheTrending.
 */
export async function probeAllNicheTrends(db: PrismaClient): Promise<void> {
  const niches = Object.keys(CLIP_NICHES).filter((n) => n !== "auto") as ClipNiche[];
  log.log(`[PROBE-ALL] Probing ${niches.length} niches...`);

  for (const niche of niches) {
    try {
      const stats = await probeNicheTrending(niche);
      const today = new Date(stats.date + "T00:00:00Z");

      await db.nicheTrending.upsert({
        where: { niche_date: { niche, date: today } },
        create: { niche, date: today, stats: stats as never },
        update: { stats: stats as never },
      });
    } catch (err) {
      log.warn(`[PROBE-ALL] Failed for "${niche}": ${err instanceof Error ? err.message : err}`);
    }
  }

  log.log(`[PROBE-ALL] Done.`);
}

/**
 * Upsert trending data from an existing discovery run (called by clip-repurpose worker).
 * Merges the discovery result's candidates with today's existing stats if any.
 */
export async function upsertNicheTrendingFromDiscovery(
  db: PrismaClient,
  niche: ClipNiche,
  discoveryResult: DiscoveryResult,
): Promise<void> {
  try {
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

    const candidates: DiscoveredVideo[] = discoveryResult.candidates.map((c) => ({
      videoId: "",
      url: c.url,
      title: c.title,
      channelId: "",
      channelName: c.channelName,
      viewCount: c.viewCount,
      publishedAt: "",
      durationSec: 0,
      platform: (c.platform as DiscoveredVideo["platform"]) || "youtube",
      source: "search" as const,
    }));

    const stats = computeStats(niche, candidates);

    const existing = await db.nicheTrending.findUnique({
      where: { niche_date: { niche, date: today } },
    });

    if (existing) {
      const prev = existing.stats as unknown as NicheTrendingStats;
      if (stats.candidateCount > prev.candidateCount) {
        await db.nicheTrending.update({
          where: { niche_date: { niche, date: today } },
          data: { stats: stats as never },
        });
      }
    } else {
      await db.nicheTrending.create({
        data: { niche, date: today, stats: stats as never },
      });
    }
  } catch (err) {
    log.warn(`[UPSERT] Failed for "${niche}": ${err instanceof Error ? err.message : err}`);
  }
}
