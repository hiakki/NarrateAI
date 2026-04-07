import { CLIP_NICHE_META, computeViewPrediction } from "../config/clip-niches";
import { buildTrendingBounds, computeTrendingRankBreakdown } from "./trending-rank";

export interface NicheTrendingStats {
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

export interface RankedNiche {
  niche: string;
  rankScore: number;
  avgViews: number;
  maxViews: number;
  predictedMid: number;
  score: number;
  finalProbability: number;
  candidateCount: number;
  bestPlatforms: string[];
  bestTimesUTC: string[];
}

function dominates(
  a: { avgViews: number; maxViews: number; predictedMid: number; finalProbability: number; candidateCount: number },
  b: { avgViews: number; maxViews: number; predictedMid: number; finalProbability: number; candidateCount: number },
): boolean {
  const ge =
    a.avgViews >= b.avgViews &&
    a.maxViews >= b.maxViews &&
    a.predictedMid >= b.predictedMid &&
    a.finalProbability >= b.finalProbability &&
    a.candidateCount >= b.candidateCount;
  const gt =
    a.avgViews > b.avgViews ||
    a.maxViews > b.maxViews ||
    a.predictedMid > b.predictedMid ||
    a.finalProbability > b.finalProbability ||
    a.candidateCount > b.candidateCount;
  return ge && gt;
}

/**
 * Rank niches by a weighted composite score — same formula as the
 * Scorecard UI so what users see matches what the optimizer picks.
 *
 *   avgViews   × 30%
 *   predicted  × 25%
 *   avgScore   × 20%
 *   maxViews   × 15%
 *   candidates × 10%
 */
export function rankNichesFromTrending(
  rows: Array<{ niche: string; stats: NicheTrendingStats }>,
): RankedNiche[] {
  const byNiche = new Map<string, NicheTrendingStats>();
  for (const r of rows) {
    if (!r.stats?.top20) continue;
    byNiche.set(r.niche, r.stats);
  }

  const entries: {
    niche: string;
    avgViews: number;
    maxViews: number;
    predictedMid: number;
    score: number;
    candidateCount: number;
  }[] = [];

  for (const [niche, stats] of byNiche) {
    const meta = CLIP_NICHE_META[niche];
    if (!meta) continue;
    const pred = computeViewPrediction(stats.top20.avgViews, stats.top20.avgScore);
    entries.push({
      niche,
      avgViews: stats.top20.avgViews,
      maxViews: stats.top20.maxViews,
      predictedMid: pred.estimatedViews.mid,
      score: stats.top20.avgScore,
      candidateCount: stats.candidateCount,
    });
  }

  if (entries.length === 0) return [];

  const bounds = buildTrendingBounds(entries.map((e) => ({
    avgViews: e.avgViews,
    maxViews: e.maxViews,
    predictedMid: e.predictedMid,
    avgScore: e.score,
    candidateCount: e.candidateCount,
  })));

  return entries
    .map((e) => {
      const rank = computeTrendingRankBreakdown({
        avgViews: e.avgViews,
        maxViews: e.maxViews,
        predictedMid: e.predictedMid,
        avgScore: e.score,
        candidateCount: e.candidateCount,
      }, bounds);
      const rankScore = rank.raw * 100;
      const meta = CLIP_NICHE_META[e.niche]!;
      return {
        ...e,
        rankScore,
        finalProbability: rank.probability,
        bestPlatforms: meta.bestPlatforms,
        bestTimesUTC: meta.bestTimesUTC,
      };
    })
    .sort((a, b) => {
      // Keep optimizer ordering consistent with scorecard:
      // strict dominance must outrank dominated rows.
      if (dominates(a, b)) return -1;
      if (dominates(b, a)) return 1;
      if (b.finalProbability !== a.finalProbability) return b.finalProbability - a.finalProbability;
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      if (b.score !== a.score) return b.score - a.score;
      if (b.avgViews !== a.avgViews) return b.avgViews - a.avgViews;
      if (b.candidateCount !== a.candidateCount) return b.candidateCount - a.candidateCount;
      return b.maxViews - a.maxViews;
    });
}

const ALL_PLATFORMS = ["YOUTUBE", "FACEBOOK", "INSTAGRAM"];

/**
 * Walk the ranked list and enable niches until every platform has
 * `postsPerPlatform` posts assigned.  Returns the selected niches
 * together with their final `targetPlatforms`.
 */
export function pickTopNichesForTarget(
  ranked: RankedNiche[],
  postsPerPlatform: number,
): Array<RankedNiche & { assignedPlatforms: string[] }> {
  const counts: Record<string, number> = {};
  for (const p of ALL_PLATFORMS) counts[p] = 0;

  const selected: Array<RankedNiche & { assignedPlatforms: string[] }> = [];

  for (const niche of ranked) {
    const allFilled = ALL_PLATFORMS.every((p) => counts[p] >= postsPerPlatform);
    if (allFilled) break;

    const platforms = niche.bestPlatforms.filter((p) => counts[p] < postsPerPlatform);
    if (platforms.length === 0) continue;

    for (const p of platforms) counts[p]++;
    selected.push({ ...niche, assignedPlatforms: platforms });
  }

  return selected;
}

/**
 * Assign each selected niche a post time from its `bestTimesUTC`,
 * ensuring at least `gapMinutes` between any two assigned slots.
 *
 * Greedy: iterate niches by rank, try preferred times first,
 * fall back to the next free slot after the latest assigned time.
 */
export function computeStaggeredSchedule(
  niches: Array<{ niche: string; bestTimesUTC: string[] }>,
  gapMinutes: number,
): Map<string, string> {
  const assigned = new Map<string, string>();
  const takenMinutes: number[] = [];

  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const toHHMM = (min: number) => {
    const wrapped = ((min % 1440) + 1440) % 1440;
    const h = Math.floor(wrapped / 60);
    const m = wrapped % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const isFree = (min: number) =>
    takenMinutes.every((t) => Math.abs(t - min) >= gapMinutes && Math.abs(t - min - 1440) >= gapMinutes && Math.abs(t - min + 1440) >= gapMinutes);

  for (const entry of niches) {
    let placed = false;

    for (const time of entry.bestTimesUTC) {
      const min = toMin(time);
      if (isFree(min)) {
        assigned.set(entry.niche, time);
        takenMinutes.push(min);
        placed = true;
        break;
      }
    }

    if (!placed) {
      const latest = takenMinutes.length > 0 ? Math.max(...takenMinutes) : toMin("06:00");
      let candidate = latest + gapMinutes;
      while (!isFree(candidate) && candidate < latest + 1440) {
        candidate += gapMinutes;
      }
      const time = toHHMM(candidate);
      assigned.set(entry.niche, time);
      takenMinutes.push(candidate % 1440);
    }
  }

  return assigned;
}
