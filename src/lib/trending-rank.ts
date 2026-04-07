export interface TrendingRankInput {
  avgViews: number;
  maxViews: number;
  predictedMid: number;
  avgScore: number;
  candidateCount: number;
}

export interface TrendingRankBounds {
  maxAvgViews: number;
  maxMaxViews: number;
  maxPredictedMid: number;
  maxCandidateCount: number;
}

export interface TrendingRankBreakdown {
  avgViewsPart: number;
  predictedPart: number;
  scorePart: number;
  maxViewsPart: number;
  candidatesPart: number;
  raw: number;
  probability: number;
}

function ceilMax(values: number[]): number {
  return Math.max(...values, 1);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Build cohort bounds so rank is calibrated against currently visible niches.
 */
export function buildTrendingBounds(entries: TrendingRankInput[]): TrendingRankBounds {
  return {
    maxAvgViews: ceilMax(entries.map((e) => e.avgViews)),
    maxMaxViews: ceilMax(entries.map((e) => e.maxViews)),
    maxPredictedMid: ceilMax(entries.map((e) => e.predictedMid)),
    maxCandidateCount: ceilMax(entries.map((e) => e.candidateCount)),
  };
}

/**
 * Convert weighted raw score (0..1) to probability-like value (0..100).
 * Center near 0.55 with steeper slope around mid-zone.
 */
export function probabilityFromRaw(raw: number): number {
  const clamped = clamp01(raw);
  const p = 100 / (1 + Math.exp(-8 * (clamped - 0.55)));
  return Math.max(1, Math.min(99, Math.round(p)));
}

/**
 * Final niche ranking score:
 * - weighted normalized features
 * - transformed into probability (% chance proxy for higher views)
 */
export function computeTrendingRankBreakdown(
  input: TrendingRankInput,
  bounds: TrendingRankBounds,
): TrendingRankBreakdown {
  const nAvgViews = clamp01(input.avgViews / Math.max(bounds.maxAvgViews, 1));
  const nPredicted = clamp01(input.predictedMid / Math.max(bounds.maxPredictedMid, 1));
  const nScore = clamp01(input.avgScore / 100);
  const nMaxViews = clamp01(input.maxViews / Math.max(bounds.maxMaxViews, 1));
  const nCandidates = clamp01(input.candidateCount / Math.max(bounds.maxCandidateCount, 1));

  const avgViewsPart = nAvgViews * 0.25;
  const predictedPart = nPredicted * 0.25;
  const scorePart = nScore * 0.30;
  const maxViewsPart = nMaxViews * 0.10;
  const candidatesPart = nCandidates * 0.10;
  const raw = avgViewsPart + predictedPart + scorePart + maxViewsPart + candidatesPart;
  const probability = probabilityFromRaw(raw);

  return {
    avgViewsPart: avgViewsPart * 100,
    predictedPart: predictedPart * 100,
    scorePart: scorePart * 100,
    maxViewsPart: maxViewsPart * 100,
    candidatesPart: candidatesPart * 100,
    raw,
    probability,
  };
}
