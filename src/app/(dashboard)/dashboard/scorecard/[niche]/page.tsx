"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, ArrowLeft, Trophy, TrendingUp, TrendingDown,
  Eye, Clock, ExternalLink, Target, Minus,
  Youtube, Facebook, Instagram, ChevronDown, ChevronUp,
} from "lucide-react";
import { formatNumber } from "@/lib/format-utils";

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

interface NicheMeta {
  label: string;
  icon: string;
  description: string;
  bestTimesUTC: string[];
  bestPlatforms: string[];
  cluster: string;
}

interface ViewPrediction {
  estimatedViews: { low: number; mid: number; high: number };
  confidence: { low: number; mid: number; high: number };
}

interface NicheEntry {
  meta: NicheMeta | null;
  prediction: ViewPrediction | null;
  history: Array<{ date: string; stats: NicheTrendingStats }>;
  aggregated: NicheTrendingStats | null;
}

const PLATFORM_ICON: Record<string, { icon: typeof Youtube; color: string; label: string }> = {
  youtube: { icon: Youtube, color: "text-red-600", label: "YouTube" },
  facebook: { icon: Facebook, color: "text-blue-600", label: "Facebook" },
  instagram: { icon: Instagram, color: "text-pink-600", label: "Instagram" },
};

function scoreBadgeColor(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800 border-green-200";
  if (score >= 45) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  return "bg-red-100 text-red-800 border-red-200";
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Strong";
  if (score >= 45) return "Moderate";
  if (score >= 25) return "Weak";
  return "Low";
}

function viewsBarWidth(views: number, maxViews: number): number {
  if (!maxViews) return 0;
  return Math.min(100, (views / maxViews) * 100);
}

const DAY_OPTIONS = [
  { label: "Today", value: 1 },
  { label: "3 Days", value: 3 },
  { label: "7 Days", value: 7 },
  { label: "14 Days", value: 14 },
  { label: "30 Days", value: 30 },
] as const;

export default function NicheDetailPage() {
  const params = useParams();
  const nicheKey = params.niche as string;

  const [data, setData] = useState<NicheEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [selectedDays, setSelectedDays] = useState(1);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/niche-trending?niche=${nicheKey}&days=${selectedDays}`);
        const json = await res.json();
        setData(json.data?.[nicheKey] ?? null);
      } catch (err) {
        console.error("Niche detail fetch error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [nicheKey, selectedDays]);

  const latest = data?.aggregated ?? data?.history?.[0]?.stats ?? null;
  const meta = data?.meta ?? null;
  const prediction = data?.prediction ?? null;

  const historyScores = useMemo(
    () =>
      (data?.history ?? [])
        .slice(0, 30)
        .reverse()
        .map((h) => ({
          date: h.date,
          score: h.stats?.top20?.avgScore ?? 0,
          avgViews: h.stats?.top20?.avgViews ?? 0,
          candidates: h.stats?.candidateCount ?? 0,
        })),
    [data],
  );

  const scoreBreakdown = useMemo(() => {
    if (!latest) return [];
    const items: { label: string; value: string; detail: string }[] = [];
    items.push({
      label: "Top-20 Avg Score",
      value: latest.top20.avgScore.toFixed(1),
      detail: "Average composite score across top 20 candidates",
    });
    items.push({
      label: "Top-20 Avg Views",
      value: formatNumber(latest.top20.avgViews),
      detail: `Range: ${formatNumber(latest.top20.minViews)} – ${formatNumber(latest.top20.maxViews)}`,
    });
    items.push({
      label: "Max Score",
      value: latest.top20.maxScore.toFixed(1),
      detail: "Highest scoring candidate found",
    });
    items.push({
      label: "Total Candidates",
      value: String(latest.candidateCount),
      detail: "Total videos discovered across all platforms",
    });
    return items;
  }, [latest]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Link
          href="/dashboard/scorecard"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Scorecard
        </Link>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Trophy className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold">
              No data for &ldquo;{nicheKey}&rdquo;
            </h3>
            <p className="text-sm text-muted-foreground mt-2">
              This niche hasn&apos;t been probed yet. Data appears after the
              daily trending probe runs at 03:00 UTC.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const score = latest?.top20?.avgScore ?? 0;
  const candidates = latest?.topCandidates ?? [];
  const displayCandidates = showAllCandidates
    ? candidates
    : candidates.slice(0, 5);
  const maxCandidateViews = Math.max(
    ...candidates.map((c) => c.viewCount),
    1,
  );

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Back + day selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href="/dashboard/scorecard"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Scorecard
        </Link>
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
          {DAY_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setSelectedDays(value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                selectedDays === value
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{meta?.icon ?? "📊"}</span>
          <div>
            <h1 className="text-2xl font-bold">
              {meta?.label ?? nicheKey}
            </h1>
            <p className="text-sm text-muted-foreground">
              {meta?.description ?? ""}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={`text-lg px-3 py-1 font-bold tabular-nums ${scoreBadgeColor(score)}`}
        >
          {score > 0 ? `${score.toFixed(1)} — ${scoreLabel(score)}` : "No data"}
        </Badge>
      </div>

      {/* Score breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Score Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scoreBreakdown.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {scoreBreakdown.map((item) => (
                <div key={item.label} className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="text-xl font-bold tabular-nums">
                    {item.value}
                  </p>
                  <p className="text-[10px] text-muted-foreground/80">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No score data available yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* View Prediction */}
      {prediction && prediction.estimatedViews.mid > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              View Prediction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-4">
              Estimated views if you post a clip from this niche today,
              based on trending discovery data.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border p-3 text-center bg-red-50/30">
                <p className="text-xs text-muted-foreground mb-1">
                  Conservative
                </p>
                <p className="text-xl font-bold tabular-nums">
                  {formatNumber(prediction.estimatedViews.low)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {prediction.confidence.low}% confidence
                </p>
              </div>
              <div className="rounded-lg border-2 border-primary/30 p-3 text-center bg-primary/5">
                <p className="text-xs text-muted-foreground mb-1">
                  Likely
                </p>
                <p className="text-2xl font-bold tabular-nums text-primary">
                  {formatNumber(prediction.estimatedViews.mid)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {prediction.confidence.mid}% confidence
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center bg-green-50/30">
                <p className="text-xs text-muted-foreground mb-1">
                  Optimistic
                </p>
                <p className="text-xl font-bold tabular-nums">
                  {formatNumber(prediction.estimatedViews.high)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {prediction.confidence.high}% confidence
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Best Timing & Platforms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Best Posting Times (UTC)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {meta?.bestTimesUTC?.length ? (
              <div className="space-y-2">
                {meta.bestTimesUTC.map((time, i) => (
                  <div
                    key={time}
                    className="flex items-center gap-3 rounded-lg border p-2.5"
                  >
                    <div
                      className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                        i === 0
                          ? "bg-amber-100 text-amber-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {i + 1}
                    </div>
                    <span className="text-sm font-medium tabular-nums">
                      {time} UTC
                    </span>
                    {i === 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-amber-50 text-amber-700 border-amber-200"
                      >
                        Peak
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No timing data available.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Best Platforms to Post
            </CardTitle>
          </CardHeader>
          <CardContent>
            {meta?.bestPlatforms?.length ? (
              <div className="space-y-2">
                {meta.bestPlatforms.map((platform, i) => {
                  const pi =
                    PLATFORM_ICON[platform.toLowerCase()] ?? null;
                  const Icon = pi?.icon ?? Eye;
                  const platStats =
                    latest?.platforms?.[platform.toLowerCase()];
                  return (
                    <div
                      key={platform}
                      className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                            i === 0
                              ? "bg-green-100 text-green-700"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {i + 1}
                        </div>
                        <Icon
                          className={`h-4 w-4 ${pi?.color ?? ""}`}
                        />
                        <span className="text-sm font-medium">
                          {pi?.label ?? platform}
                        </span>
                        {i === 0 && (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-green-50 text-green-700 border-green-200"
                          >
                            Best
                          </Badge>
                        )}
                      </div>
                      {platStats && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {platStats.count} found · avg{" "}
                          {formatNumber(platStats.avgViews)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No platform data available.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Platform breakdown from latest probe */}
      {latest?.platforms &&
        Object.keys(latest.platforms).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Discovery Platform Breakdown (Latest)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {Object.entries(latest.platforms).map(
                  ([platform, stats]) => {
                    const pi =
                      PLATFORM_ICON[platform.toLowerCase()] ?? null;
                    const Icon = pi?.icon ?? Eye;
                    return (
                      <div
                        key={platform}
                        className="rounded-lg border p-3 flex items-center gap-3"
                      >
                        <Icon
                          className={`h-5 w-5 shrink-0 ${pi?.color ?? ""}`}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {pi?.label ?? platform}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {stats.count} videos · avg{" "}
                            {formatNumber(stats.avgViews)} views
                          </p>
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </CardContent>
          </Card>
        )}

      {/* 7-day trend chart */}
      {historyScores.length >= 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Score Trend ({historyScores.length} days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {historyScores.map((row) => {
                const maxScore = Math.max(
                  ...historyScores.map((r) => r.score),
                  1,
                );
                const pct = (row.score / maxScore) * 100;
                return (
                  <div
                    key={row.date}
                    className="flex items-center gap-3 text-xs"
                  >
                    <span className="w-20 text-muted-foreground tabular-nums shrink-0">
                      {row.date}
                    </span>
                    <div className="flex-1 h-4 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/60 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-medium tabular-nums shrink-0">
                      {row.score.toFixed(1)}
                    </span>
                    <span className="w-16 text-right text-muted-foreground tabular-nums shrink-0">
                      {formatNumber(row.avgViews)}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top discovered candidates */}
      {candidates.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Top Discovered Candidates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {displayCandidates.map((c, i) => {
              const pi =
                PLATFORM_ICON[c.platform?.toLowerCase()] ?? null;
              const Icon = pi?.icon ?? Eye;
              return (
                <div
                  key={`${c.url}-${i}`}
                  className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors"
                >
                  <span className="text-sm font-bold text-muted-foreground w-6 text-center shrink-0">
                    {i + 1}
                  </span>
                  <Icon
                    className={`h-4 w-4 shrink-0 ${pi?.color ?? ""}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {c.title || "(untitled)"}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {c.channelName}
                    </p>
                    {/* Views bar */}
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden max-w-[120px]">
                        <div
                          className="h-full rounded-full bg-primary/50"
                          style={{
                            width: `${viewsBarWidth(c.viewCount, maxCandidateViews)}%`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {formatNumber(c.viewCount)} views
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge
                      variant="outline"
                      className={`text-xs tabular-nums ${scoreBadgeColor(c.score)}`}
                    >
                      {c.score.toFixed(1)}
                    </Badge>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      Open
                    </a>
                  </div>
                </div>
              );
            })}
            {candidates.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => setShowAllCandidates((v) => !v)}
              >
                {showAllCandidates ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" /> Show all{" "}
                    {candidates.length} candidates
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
