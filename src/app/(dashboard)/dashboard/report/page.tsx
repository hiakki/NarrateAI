"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, BarChart2, Eye, Heart, Zap, Lightbulb, ArrowUpDown, ArrowUp, ArrowDown, Sparkles, RefreshCw, Film } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { InsightsReport, ReportSuggestion } from "@/app/api/insights/report/route";
import { computeNicheScore, getSuggestionsToImproveScore, type NicheScoreConfig } from "@/lib/niche-score";
import { formatNumber } from "@/lib/format-utils";

type SortKey = "name" | "niche" | "platforms" | "videoCount" | "totalViews" | "viewsPerVideo" | "totalInteractions" | "nicheScore";
type AutomationRow = NonNullable<InsightsReport["scorecard"]>["byAutomation"][number];

function rowToNicheConfig(row: AutomationRow): NicheScoreConfig {
  const times = (row.postTime ?? "09:00").split(",").map((t) => t.trim()).filter(Boolean);
  return {
    nicheId: row.niche,
    artStyleId: row.artStyle ?? "realistic",
    languageId: row.language ?? "en",
    toneId: row.tone ?? "dramatic",
    times: times.length > 0 ? times : ["09:00"],
  };
}

function getNicheScoreForRow(row: AutomationRow): number {
  return computeNicheScore(rowToNicheConfig(row), row.timezone ?? "UTC").overall;
}

function getSuggestionsThatIncreaseScore(row: AutomationRow) {
  return getSuggestionsToImproveScore(rowToNicheConfig(row), row.timezone ?? "UTC");
}

export default function ReportPage() {
  const [data, setData] = useState<InsightsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("totalViews");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [suggestedRow, setSuggestedRow] = useState<AutomationRow | null>(null);
  const [refreshingInsights, setRefreshingInsights] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/report");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load report");
      if (json.data) setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const refreshInsightsThenReport = useCallback(async () => {
    setRefreshingInsights(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to refresh insights");
      await fetchReport();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh insights");
    } finally {
      setRefreshingInsights(false);
    }
  }, [fetchReport]);

  const INSIGHTS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  useEffect(() => {
    const id = setInterval(() => {
      refreshInsightsThenReport();
    }, INSIGHTS_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshInsightsThenReport]);

  const byAutomation = data?.scorecard?.byAutomation ?? [];
  const sortedRows = useMemo(() => {
    if (byAutomation.length === 0) return [];
    const rows = [...byAutomation];
    rows.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortKey) {
        case "name":
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case "niche":
          aVal = a.niche.toLowerCase();
          bVal = b.niche.toLowerCase();
          break;
        case "platforms":
          aVal = a.targetPlatforms.length;
          bVal = b.targetPlatforms.length;
          break;
        case "videoCount":
          aVal = a.videoCount;
          bVal = b.videoCount;
          break;
        case "totalViews":
          aVal = a.totalViews;
          bVal = b.totalViews;
          break;
        case "viewsPerVideo":
          aVal = a.viewsPerVideo;
          bVal = b.viewsPerVideo;
          break;
        case "totalInteractions":
          aVal = a.totalInteractions;
          bVal = b.totalInteractions;
          break;
        case "nicheScore": {
          aVal = getNicheScoreForRow(a);
          bVal = getNicheScoreForRow(b);
          break;
        }
        default:
          return 0;
      }
      if (typeof aVal === "string" && typeof bVal === "string") {
        const cmp = aVal.localeCompare(bVal);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const n = (aVal as number) - (bVal as number);
      return sortDir === "asc" ? n : -n;
    });
    return rows;
  }, [byAutomation, sortKey, sortDir]);

  async function applySuggestion(s: ReportSuggestion) {
    setApplyingId(s.id);
    try {
      if (s.action === "update_and_create" && s.automationId && s.updatePayload && s.createPayload) {
        const patchRes = await fetch(`/api/automations/${s.automationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(s.updatePayload),
        });
        if (!patchRes.ok) {
          const j = await patchRes.json();
          throw new Error(j.error || "Update failed");
        }
        const postRes = await fetch("/api/automations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(s.createPayload),
        });
        if (!postRes.ok) {
          const j = await postRes.json();
          throw new Error(j.error || "Create failed");
        }
      } else if (s.action === "update" && s.automationId) {
        const res = await fetch(`/api/automations/${s.automationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(s.payload),
        });
        if (!res.ok) {
          const j = await res.json();
          throw new Error(j.error || "Update failed");
        }
      } else if (s.action === "create") {
        const res = await fetch("/api/automations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(s.payload),
        });
        if (!res.ok) {
          const j = await res.json();
          throw new Error(j.error || "Create failed");
        }
      }
      await fetchReport();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setApplyingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => fetchReport()}>
          Retry
        </Button>
      </div>
    );
  }

  const sc = data?.scorecard;
  const suggestions = data?.suggestions ?? [];

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BarChart2 className="h-6 w-6" />
          Insights Report
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Scorecard across all automations and one-click suggestions to improve views.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-4 py-2 text-sm text-amber-800 dark:text-amber-200 break-words">
          {error}
        </div>
      )}

      {sc && (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart2 className="h-4 w-4" />
                    Scorecard
                  </CardTitle>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {sc.lastRefreshedAt && (
                      <p className="text-xs text-muted-foreground">
                        Insights last refreshed: {new Date(sc.lastRefreshedAt).toLocaleString()}
                      </p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-7 text-xs"
                      disabled={refreshingInsights}
                      onClick={() => refreshInsightsThenReport()}
                    >
                      {refreshingInsights ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Refresh insights
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="rounded-lg border bg-muted/30 p-4 overflow-hidden">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">Total videos</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1 flex items-center gap-1">
                    <Film className="h-5 w-5 text-muted-foreground shrink-0" />
                    {formatNumber(sc.totalVideos)}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4 overflow-hidden">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">Total views</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1 flex items-center gap-1">
                    <Eye className="h-5 w-5 text-muted-foreground shrink-0" />
                    {formatNumber(sc.totalViews)}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4 overflow-hidden">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">Interactions</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1 flex items-center gap-1">
                    <Heart className="h-5 w-5 text-muted-foreground shrink-0" />
                    {formatNumber(sc.totalInteractions)}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4 overflow-hidden">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">Avg views/vid</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1">{formatNumber(sc.viewsPerVideo)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4 overflow-hidden">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">Automations</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1">{sc.automationsCount}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Per automation</p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">
                          <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort("name")}>
                            Name <SortIcon column="name" />
                          </button>
                        </th>
                        <th className="text-left p-3 font-medium">
                          <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort("niche")}>
                            Niche <SortIcon column="niche" />
                          </button>
                        </th>
                        <th className="text-left p-3 font-medium">
                          <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort("platforms")}>
                            Platforms <SortIcon column="platforms" />
                          </button>
                        </th>
                        <th className="text-right p-3 font-medium">
                          <button type="button" className="flex items-center gap-1 justify-end w-full hover:text-foreground" onClick={() => handleSort("videoCount")}>
                            Videos <SortIcon column="videoCount" />
                          </button>
                        </th>
                        <th className="text-right p-3 font-medium">
                          <button type="button" className="flex items-center gap-1 justify-end w-full hover:text-foreground" onClick={() => handleSort("totalViews")}>
                            Views <SortIcon column="totalViews" />
                          </button>
                        </th>
                        <th className="text-right p-3 font-medium">
                          <button type="button" className="flex items-center gap-1 justify-end w-full hover:text-foreground" onClick={() => handleSort("viewsPerVideo")}>
                            Avg views/video <SortIcon column="viewsPerVideo" />
                          </button>
                        </th>
                        <th className="text-right p-3 font-medium">
                          <button type="button" className="flex items-center gap-1 justify-end w-full hover:text-foreground" onClick={() => handleSort("totalInteractions")}>
                            Interactions <SortIcon column="totalInteractions" />
                          </button>
                        </th>
                        <th className="text-right p-3 font-medium">
                          <button type="button" className="flex items-center gap-1 justify-end w-full hover:text-foreground" onClick={() => handleSort("nicheScore")}>
                            Niche score <SortIcon column="nicheScore" />
                          </button>
                        </th>
                        <th className="text-left p-3 font-medium">Suggested niche score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => (
                        <tr key={row.automationId} className="border-b last:border-0">
                          <td className="p-3 max-w-[180px]">
                            <Link
                              href={`/dashboard/automations/${row.automationId}`}
                              className="text-primary hover:underline font-medium truncate block"
                              title={row.name}
                            >
                              {row.name}
                            </Link>
                            {!row.enabled && (
                              <Badge variant="secondary" className="ml-2 text-[10px]">Paused</Badge>
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground max-w-[120px] truncate" title={row.niche}>{row.niche}</td>
                          <td className="p-3 max-w-[150px]">
                            <span className="text-muted-foreground truncate block" title={row.targetPlatforms.join(", ")}>
                              {row.targetPlatforms.length ? row.targetPlatforms.join(", ") : "—"}
                            </span>
                          </td>
                          <td className="p-3 text-right tabular-nums">{row.videoCount}</td>
                          <td className="p-3 text-right tabular-nums">{formatNumber(row.totalViews)}</td>
                          <td className="p-3 text-right tabular-nums">{formatNumber(row.viewsPerVideo)}</td>
                          <td className="p-3 text-right tabular-nums">{formatNumber(row.totalInteractions)}</td>
                          <td className="p-3 text-right tabular-nums">
                            {getNicheScoreForRow(row)}%
                          </td>
                          <td className="p-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs"
                              onClick={() => setSuggestedRow(row)}
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              View
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lightbulb className="h-4 w-4" />
                    Suggestions to get more views
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    One-click actions: update an automation or create a new one with better settings.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Score</span>
                  <div className="rounded-lg border bg-muted/50 px-3 py-1.5">
                    <span className="text-lg font-semibold tabular-nums">{sc.scorePercent ?? 0}%</span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {suggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No suggestions right now. Keep posting to multiple platforms and refresh insights to see tips.
                </p>
              ) : (
                <ul className="space-y-4">
                  {suggestions.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border p-4 bg-card"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium flex items-center gap-2 min-w-0">
                          <Zap className="h-4 w-4 text-amber-500 shrink-0" />
                          <span className="truncate">{s.title}</span>
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={!!applyingId}
                        onClick={() => applySuggestion(s)}
                      >
                        {applyingId === s.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : s.action === "create" || s.action === "update_and_create" ? (
                          s.action === "update_and_create" ? "Pause & create new" : "Create automation"
                        ) : (
                          "Apply"
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <AlertDialog open={!!suggestedRow} onOpenChange={(open) => { if (!open) setSuggestedRow(null); }}>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Suggested niche score — {suggestedRow?.name}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {suggestedRow && (
                    <span>
                      Combinations that can increase your niche score. Current score: <strong>{getSuggestionsThatIncreaseScore(suggestedRow).currentScore}%</strong>.
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {suggestedRow && (() => {
                const { currentScore, suggestions } = getSuggestionsThatIncreaseScore(suggestedRow);
                return (
                  <div className="space-y-3 py-2">
                    {suggestions.length === 0 ? (
                      <p className="text-sm font-medium text-green-700 py-4 text-center rounded-lg bg-green-50 border border-green-200">
                        All Good
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {suggestions.map((s, i) => (
                          <li key={i} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                            <span className="text-muted-foreground">{s.label}</span>
                            <span className="font-semibold tabular-nums text-green-600">
                              {currentScore}% → {s.newScore}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}
              <AlertDialogFooter>
                <AlertDialogCancel>Close</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
