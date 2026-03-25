"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Trophy, TrendingUp, TrendingDown, Eye, Clock,
  Search, RefreshCw, ChevronRight, Target,
  Minus, Youtube, Facebook, Instagram,
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

type SortKey = "score" | "views" | "predicted" | "name";

const DAY_OPTIONS = [
  { label: "Today", value: 1 },
  { label: "3 Days", value: 3 },
  { label: "7 Days", value: 7 },
  { label: "14 Days", value: 14 },
  { label: "30 Days", value: 30 },
] as const;

const PLATFORM_ICON_MAP: Record<string, { icon: typeof Youtube; color: string; abbr: string }> = {
  youtube:   { icon: Youtube,   color: "text-red-600",  abbr: "YT" },
  facebook:  { icon: Facebook,  color: "text-blue-600", abbr: "FB" },
  instagram: { icon: Instagram, color: "text-pink-600", abbr: "IG" },
};

function scoreBadgeColor(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800 border-green-200";
  if (score >= 45) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  return "bg-red-100 text-red-800 border-red-200";
}

function rankBadgeColor(rank: number): string {
  if (rank === 1) return "bg-amber-100 text-amber-800 border-amber-300";
  if (rank === 2) return "bg-slate-100 text-slate-700 border-slate-300";
  if (rank === 3) return "bg-orange-100 text-orange-700 border-orange-300";
  return "bg-muted text-muted-foreground border-border";
}

function trendIndicator(history: NicheEntry["history"]) {
  if (history.length < 2) return null;
  const latest = history[0]?.stats?.top20?.avgScore ?? 0;
  const prev = history[1]?.stats?.top20?.avgScore ?? 0;
  const diff = latest - prev;
  if (Math.abs(diff) < 1)
    return { icon: Minus, color: "text-muted-foreground", label: "Stable" };
  if (diff > 0)
    return { icon: TrendingUp, color: "text-green-600", label: `+${diff.toFixed(1)}` };
  return { icon: TrendingDown, color: "text-red-500", label: diff.toFixed(1) };
}

function miniSparkline(history: NicheEntry["history"]) {
  const scores = history
    .slice(0, 7)
    .reverse()
    .map((h) => h.stats?.top20?.avgScore ?? 0);
  if (scores.length < 2) return null;

  const max = Math.max(...scores, 1);
  const min = Math.min(...scores, 0);
  const range = max - min || 1;
  const h = 24;
  const w = 64;
  const step = w / (scores.length - 1);

  const points = scores.map(
    (s, i) => `${i * step},${h - ((s - min) / range) * h}`,
  );

  return (
    <svg width={w} height={h} className="inline-block">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary/60"
      />
    </svg>
  );
}

function PlatformIcons({ platforms }: { platforms: Record<string, unknown> | undefined }) {
  if (!platforms) return null;
  const keys = Object.keys(platforms).filter((k) => PLATFORM_ICON_MAP[k]);
  if (keys.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5">
      {keys.map((k) => {
        const p = PLATFORM_ICON_MAP[k];
        const Icon = p.icon;
        return <Icon key={k} className={`h-3 w-3 ${p.color}`} />;
      })}
    </div>
  );
}

function BestPlatformIcon({ bestPlatforms }: { bestPlatforms?: string[] }) {
  if (!bestPlatforms?.length) return null;
  const key = bestPlatforms[0].toLowerCase();
  const p = PLATFORM_ICON_MAP[key];
  if (!p) return null;
  const Icon = p.icon;
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`Best platform: ${bestPlatforms[0]}`}>
      <Icon className={`h-3 w-3 ${p.color}`} />
      <span className="hidden sm:inline">post</span>
    </span>
  );
}

export default function ScorecardPage() {
  const [data, setData] = useState<Record<string, NicheEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("score");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDays, setSelectedDays] = useState(1);

  const fetchData = useCallback(async (days: number) => {
    try {
      const res = await fetch(`/api/niche-trending?days=${days}`);
      const json = await res.json();
      setData(json.data ?? null);
    } catch (err) {
      console.error("Scorecard fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData(selectedDays);
  }, [selectedDays, fetchData]);

  const entries = useMemo(() => {
    if (!data) return [];
    return Object.entries(data)
      .filter(([key]) => key !== "auto")
      .map(([key, entry]) => {
        const stats = entry.aggregated ?? entry.history[0]?.stats ?? null;
        const score = stats?.top20?.avgScore ?? 0;
        const avgViews = stats?.top20?.avgViews ?? 0;
        const maxViews = stats?.top20?.maxViews ?? 0;
        const candidateCount = stats?.candidateCount ?? 0;
        const predictedMid = entry.prediction?.estimatedViews?.mid ?? 0;
        return { key, entry, stats, score, avgViews, maxViews, candidateCount, predictedMid };
      });
  }, [data]);

  const ranked = useMemo(() => {
    if (entries.length === 0) return [];

    const ceil = (arr: number[]) => Math.max(...arr, 1);
    const maxS = ceil(entries.map((e) => e.score));
    const maxAV = ceil(entries.map((e) => e.avgViews));
    const maxMV = ceil(entries.map((e) => e.maxViews));
    const maxP = ceil(entries.map((e) => e.predictedMid));
    const maxC = ceil(entries.map((e) => e.candidateCount));

    return entries
      .map((e) => {
        const rankScore =
          (e.avgViews / maxAV) * 30 +
          (e.predictedMid / maxP) * 25 +
          (e.score / maxS) * 20 +
          (e.maxViews / maxMV) * 15 +
          (e.candidateCount / maxC) * 10;
        return { ...e, rankScore };
      })
      .sort((a, b) => b.rankScore - a.rankScore)
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }, [entries]);

  const rankedMap = useMemo(() => {
    const m = new Map<string, { rank: number; rankScore: number }>();
    for (const r of ranked) m.set(r.key, { rank: r.rank, rankScore: r.rankScore });
    return m;
  }, [ranked]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = entries.map((e) => {
      const r = rankedMap.get(e.key);
      return { ...e, rank: r?.rank ?? entries.length, rankScore: r?.rankScore ?? 0 };
    });
    if (q) {
      list = list.filter(
        ({ key, entry }) =>
          key.includes(q) ||
          entry.meta?.label.toLowerCase().includes(q) ||
          entry.meta?.description.toLowerCase().includes(q) ||
          entry.meta?.cluster.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      switch (sortBy) {
        case "score":
          return b.rankScore - a.rankScore;
        case "views":
          return b.avgViews - a.avgViews;
        case "predicted":
          return b.predictedMid - a.predictedMid;
        case "name":
          return (a.entry.meta?.label ?? a.key).localeCompare(
            b.entry.meta?.label ?? b.key,
          );
        default:
          return 0;
      }
    });
    return list;
  }, [entries, search, sortBy, rankedMap]);

  const topRankScore = Math.max(...entries.map((e) => rankedMap.get(e.key)?.rankScore ?? 0), 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-500" />
            Niche Scorecard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Daily trending scores, view predictions, and best posting strategy per niche
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            fetchData(selectedDays);
          }}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1" />
          )}
          Refresh
        </Button>
      </div>

      {/* Day selector + Controls */}
      <div className="flex items-center gap-3 flex-wrap">
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

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search niches..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-background pl-10 pr-4 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Sort:</span>
          {(
            [
              ["score", "Rank"],
              ["views", "Views"],
              ["predicted", "Predicted"],
              ["name", "Name"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`px-2.5 py-1 rounded-md border text-xs transition-colors ${
                sortBy === key
                  ? "bg-primary/10 border-primary/30 text-primary font-medium"
                  : "border-transparent hover:bg-muted text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      {entries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-muted-foreground mb-1">Total Niches</p>
              <p className="text-2xl font-bold">{entries.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-muted-foreground mb-1">With Data</p>
              <p className="text-2xl font-bold">
                {entries.filter((e) => e.stats).length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-muted-foreground mb-1">Top Score</p>
              <p className="text-2xl font-bold">
                {entries.length > 0
                  ? Math.max(...entries.map((e) => e.score)).toFixed(1)
                  : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-muted-foreground mb-1">
                Avg Top-20 Views
              </p>
              <p className="text-2xl font-bold">
                {entries.length > 0
                  ? formatNumber(
                      Math.round(
                        entries.reduce((s, e) => s + e.avgViews, 0) /
                          Math.max(entries.filter((e) => e.avgViews > 0).length, 1),
                      ),
                    )
                  : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* No data */}
      {filtered.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Trophy className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {search ? "No matching niches" : "No scorecard data yet"}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {search
                ? `No niches match "${search}".`
                : "Scores are generated daily at 03:00 UTC, or when clip automations run. Check back later."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Niche grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(({ key, entry, stats, score, rank, rankScore }) => {
            const meta = entry.meta;
            const trend = trendIndicator(entry.history);
            const TrendIcon = trend?.icon ?? Minus;
            const prediction = entry.prediction;

            return (
              <Link
                key={key}
                href={`/dashboard/scorecard/${key}`}
                className="block group"
              >
                <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md group-hover:bg-muted/20">
                  <CardContent className="pt-4 pb-4 px-4 space-y-3">
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0">
                          {meta?.icon ?? "📊"}
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                            {meta?.label ?? key}
                          </h3>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {meta?.description ?? ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge
                          variant="outline"
                          className={`text-xs font-bold tabular-nums ${scoreBadgeColor(score)}`}
                        >
                          {score > 0 ? score.toFixed(1) : "—"}
                        </Badge>
                        {rankScore > 0 && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${rankBadgeColor(rank)}`}>
                            #{rank}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Rank bar */}
                    {rankScore > 0 && (
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/70 transition-all"
                          style={{
                            width: `${Math.min(100, (rankScore / topRankScore) * 100)}%`,
                          }}
                        />
                      </div>
                    )}

                    {/* Stats row */}
                    {stats ? (
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground text-[10px]">
                            Avg Views
                          </p>
                          <p className="font-medium tabular-nums">
                            {formatNumber(stats.top20.avgViews)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-[10px]">
                            Max Views
                          </p>
                          <p className="font-medium tabular-nums">
                            {formatNumber(stats.top20.maxViews)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-[10px]">
                            Candidates
                          </p>
                          <p className="font-medium tabular-nums">
                            {stats.candidateCount}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground/60 italic">
                        No data yet — waiting for first probe
                      </p>
                    )}

                    {/* Platform + Bottom row */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                      <div className="flex items-center gap-3">
                        {/* Source platforms */}
                        <PlatformIcons platforms={stats?.platforms} />
                        {/* Trend */}
                        {trend && (
                          <span
                            className={`flex items-center gap-0.5 text-[11px] font-medium ${trend.color}`}
                          >
                            <TrendIcon className="h-3 w-3" />
                            {trend.label}
                          </span>
                        )}
                        {/* Sparkline */}
                        {miniSparkline(entry.history)}
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {/* Best platform to post */}
                        <BestPlatformIcon bestPlatforms={meta?.bestPlatforms} />
                        {/* Best time */}
                        {meta?.bestTimesUTC?.[0] && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            {meta.bestTimesUTC[0]}
                          </span>
                        )}
                        {/* Prediction */}
                        {prediction && prediction.estimatedViews.mid > 0 && (
                          <span className="flex items-center gap-0.5 text-primary font-medium">
                            <Target className="h-2.5 w-2.5" />
                            ~{formatNumber(prediction.estimatedViews.mid)}
                          </span>
                        )}
                        <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
