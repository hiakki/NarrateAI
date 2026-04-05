"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, RefreshCw, Clock, AlertTriangle, CheckCircle2,
  ExternalLink, Bot, Scissors, XCircle, Pause, Play,
  ChevronDown, Timer, History, Terminal, FileText, ChevronLeft, ChevronRight,
} from "lucide-react";

import { formatRelative, timeAgo, formatAbsolute } from "@/lib/format-utils";

/* ─────────────────────────── Types ─────────────────────────── */

interface StuckVideo {
  id: string;
  title: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  scheduledPostTime: string | null;
}

interface ScheduledVideo {
  id: string;
  title: string | null;
  status: string;
  scheduledPostTime: string | null;
  scheduledPlatforms: string[] | null;
  postedPlatforms?: Array<{
    platform: string;
    success?: boolean | string;
    scheduledFor?: string;
    error?: string | null;
  }> | null;
}

interface SchedulerLogEntry {
  id: string;
  outcome: string;
  message: string;
  errorDetail: string | null;
  durationMs: number;
  videoId: string | null;
  createdAt: string;
}

interface SchedulerAutomation {
  id: string;
  name: string;
  automationType: string;
  enabled: boolean;
  frequency: string;
  postTime: string;
  timezone: string;
  lastRunAt: string | null;
  niche: string;
  targetPlatforms: string[];
  stuckVideos: StuckVideo[];
  scheduledVideos: ScheduledVideo[];
  schedulerLogs: SchedulerLogEntry[];
  nextRunAt: string | null;
  nextPostAt: string | null;
}

interface SchedulerMeta {
  buildAllTime: string;
  buildAllTimezone: string;
  currentTimeInBuildTimezone: string;
  currentTimeIso: string;
  lastScheduledWindowStart: string;
  lastScheduledWindowEnd: string;
  ranInLastScheduledWindow: boolean;
  successfulInLastScheduledWindow: boolean;
  lastSchedulerLogAt: string | null;
  lastSchedulerOutcome: string | null;
  lastSchedulerMessage: string | null;
}

/* ──────────────────────── Helpers ──────────────────────── */

function autoLink(auto: SchedulerAutomation) {
  return auto.automationType === "clip-repurpose"
    ? `/dashboard/clip-repurpose`
    : `/dashboard/automations/${auto.id}`;
}

function isMissed(auto: SchedulerAutomation): boolean {
  if (!auto.enabled) return false;
  if (!auto.nextRunAt) return false;
  return new Date(auto.nextRunAt).getTime() <= Date.now();
}

function missedSeverity(auto: SchedulerAutomation): "none" | "warning" | "critical" {
  if (!auto.enabled) return "none";
  if (!auto.nextRunAt) return "none";
  const overdueMs = Date.now() - new Date(auto.nextRunAt).getTime();
  if (overdueMs <= 0) return "none";
  const overdueH = overdueMs / (60 * 60 * 1000);
  if (overdueH > 48) return "critical";
  if (overdueH > 0) return "warning";
  return "none";
}

function outcomeColor(outcome: string): string {
  switch (outcome) {
    case "enqueued": return "text-green-600";
    case "posted": return "text-blue-600";
    case "skipped": return "text-muted-foreground";
    case "error": return "text-red-600";
    default: return "text-foreground";
  }
}

function outcomeBg(outcome: string): string {
  switch (outcome) {
    case "enqueued": return "bg-green-500";
    case "posted": return "bg-blue-500";
    case "skipped": return "bg-muted-foreground/40";
    case "error": return "bg-red-500";
    default: return "bg-muted-foreground";
  }
}

function outcomePillClass(outcome: string): string {
  switch (outcome) {
    case "enqueued": return "bg-green-50 text-green-700 border-green-200";
    case "posted": return "bg-blue-50 text-blue-700 border-blue-200";
    case "skipped": return "bg-amber-50 text-amber-700 border-amber-200";
    case "error": return "bg-red-50 text-red-700 border-red-200";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function isNoiseSkip(entry: SchedulerLogEntry): boolean {
  const msg = (entry.message || "").toLowerCase();
  return entry.outcome === "skipped" && msg.includes("outside build window");
}

function isLifecycleEntry(entry: SchedulerLogEntry): boolean {
  if (entry.outcome === "enqueued" || entry.outcome === "posted" || entry.outcome === "error") return true;
  const msg = (entry.message || "").toLowerCase();
  return msg.includes("status promotion") || msg.includes("reconcile pending");
}

function summarizePlatformsFromMessage(message: string | null): string | null {
  if (!message) return null;
  const p = message.match(/platforms \[([^\]]+)\]/i);
  if (p?.[1]) return p[1];
  const o = message.match(/outcomes:\s*([a-z0-9_=,\s-]+)/i);
  if (o?.[1]) {
    const names = o[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((kv) => kv.split("=")[0])
      .filter(Boolean);
    return names.length > 0 ? names.join(", ") : null;
  }
  return null;
}

function statusBadge(status: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof AlertTriangle }> = {
    FAILED:     { variant: "destructive", icon: XCircle },
    GENERATING: { variant: "default", icon: Loader2 },
    QUEUED:     { variant: "secondary", icon: Clock },
  };
  const cfg = map[status] ?? { variant: "outline" as const, icon: Clock };
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="gap-1 text-xs">
      <Icon className={`h-3 w-3 ${status === "GENERATING" ? "animate-spin" : ""}`} />
      {status}
    </Badge>
  );
}

/* ─────────────────── Countdown Timer Hook ─────────────────── */

function useCountdown(targetDate: string | null): string {
  const [label, setLabel] = useState("");
  const targetRef = useRef(targetDate);
  targetRef.current = targetDate;

  useEffect(() => {
    function update() {
      if (!targetRef.current) { setLabel("—"); return; }
      setLabel(formatRelative(new Date(targetRef.current)));
    }
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [targetDate]);

  return label;
}

/* ──────────────────────── Page ──────────────────────── */

export default function SchedulerPage() {
  const [data, setData] = useState<SchedulerAutomation[]>([]);
  const [meta, setMeta] = useState<SchedulerMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (silent?: boolean) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetch("/api/scheduler");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json.data ?? []);
      setMeta((json.meta ?? null) as SchedulerMeta | null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(() => fetchData(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const activeAutomations = data.filter((a) => a.enabled);
  const pausedAutomations = data.filter((a) => !a.enabled);
  const totalStuck = data.reduce((n, a) => n + a.stuckVideos.length, 0);
  const totalScheduled = data.reduce((n, a) => n + a.scheduledVideos.length, 0);
  const totalMissed = activeAutomations.filter(isMissed).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Scheduler</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sorted by next post time &middot; auto-refreshes every 30s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {meta && (
        <div className="rounded-lg border p-3 bg-card">
          <div className="text-sm font-medium">Build Window Status</div>
          <div className="text-xs text-muted-foreground mt-1">
            Scheduled build time: <span className="font-mono">{meta.buildAllTime}</span> ({meta.buildAllTimezone.replace(/^.*\//, "")})
            {" "}· Current time: <span className="font-mono">{meta.currentTimeInBuildTimezone}</span>
          </div>
          <div className="text-xs mt-2">
            Last scheduled window ({formatAbsolute(meta.lastScheduledWindowStart, meta.buildAllTimezone)} → {formatAbsolute(meta.lastScheduledWindowEnd, meta.buildAllTimezone)}):{" "}
            {meta.ranInLastScheduledWindow ? (
              meta.successfulInLastScheduledWindow
                ? <span className="text-green-600 font-semibold">Ran successfully</span>
                : <span className="text-amber-600 font-semibold">Ran, but no success outcome</span>
            ) : (
              <span className="text-red-600 font-semibold">No scheduler activity detected</span>
            )}
          </div>
          {meta.lastSchedulerLogAt && (
            <div className="text-xs text-muted-foreground mt-1">
              Latest scheduler log: {formatAbsolute(meta.lastSchedulerLogAt, meta.buildAllTimezone)} ({meta.lastSchedulerOutcome})
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Active" value={activeAutomations.length} icon={<Play className="h-4 w-4 text-green-600" />} />
        <SummaryCard label="Paused" value={pausedAutomations.length} icon={<Pause className="h-4 w-4 text-muted-foreground" />} />
        <SummaryCard
          label="Missed (24h+)"
          value={totalMissed}
          icon={<AlertTriangle className={`h-4 w-4 ${totalMissed > 0 ? "text-amber-500" : "text-muted-foreground"}`} />}
          highlight={totalMissed > 0 ? "amber" : undefined}
        />
        <SummaryCard
          label="Stuck / Failed"
          value={totalStuck}
          icon={<AlertTriangle className={`h-4 w-4 ${totalStuck > 0 ? "text-red-500" : "text-muted-foreground"}`} />}
          highlight={totalStuck > 0 ? "red" : undefined}
        />
        <SummaryCard label="Awaiting Post" value={totalScheduled} icon={<Clock className="h-4 w-4 text-blue-500" />} />
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading && data.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {activeAutomations.length > 0 && (
            <Section title={`Active Automations (${activeAutomations.length})`}>
              <div className="space-y-2">
                {activeAutomations.map((auto) => (
                  <AutomationCard key={auto.id} auto={auto} />
                ))}
              </div>
            </Section>
          )}

          {pausedAutomations.length > 0 && (
            <Section title={`Paused (${pausedAutomations.length})`} defaultOpen={false}>
              <div className="space-y-2">
                {pausedAutomations.map((auto) => (
                  <AutomationCard key={auto.id} auto={auto} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/* ──────────────────── Small components ──────────────────── */

function SummaryCard({ label, value, icon, highlight }: { label: string; value: number; icon: React.ReactNode; highlight?: "red" | "amber" }) {
  const border = highlight === "red" ? "border-red-300 bg-red-50/50"
    : highlight === "amber" ? "border-amber-300 bg-amber-50/50"
    : "bg-card";
  const text = highlight === "red" ? "text-red-600"
    : highlight === "amber" ? "text-amber-600"
    : "";
  return (
    <div className={`rounded-lg border p-3 ${border}`}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${text}`}>{value}</div>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        {title}
      </button>
      {open && children}
    </div>
  );
}

/* ──────────────────── Automation Card ──────────────────── */

function AutomationCard({ auto }: { auto: SchedulerAutomation }) {
  const [expanded, setExpanded] = useState(false);
  const isClip = auto.automationType === "clip-repurpose";
  const TypeIcon = isClip ? Scissors : Bot;
  const hasIssues = auto.stuckVideos.length > 0;
  const missed = missedSeverity(auto);
  const nextRunLabel = useCountdown(auto.nextRunAt);
  const nextPostLabel = useCountdown(auto.nextPostAt);
  const lastError = auto.schedulerLogs.find((l) => l.outcome === "error");
  const visibleLogs = auto.schedulerLogs.filter((l) => !isNoiseSkip(l));
  const latestLog = visibleLogs.find(isLifecycleEntry) ?? visibleLogs[0];

  const borderCls = hasIssues ? "border-red-300"
    : missed === "critical" ? "border-red-400"
    : missed === "warning" ? "border-amber-300"
    : "border-border";
  const bgCls = hasIssues ? "bg-red-50/30"
    : missed === "critical" ? "bg-red-50/20"
    : missed === "warning" ? "bg-amber-50/30"
    : "";

  return (
    <div className={`rounded-lg border ${borderCls} overflow-hidden`}>
      {/* Header row */}
      <button
        type="button"
        className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors ${bgCls}`}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Icon + Name */}
        <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={autoLink(auto)} className="font-medium hover:underline text-foreground flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {auto.name}
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </Link>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{auto.niche}</Badge>
            {!auto.enabled && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Paused</Badge>}
            {missed === "critical" && <Badge variant="destructive" className="text-[10px] px-1.5 py-0 animate-pulse">MISSED 72h+</Badge>}
            {missed === "warning" && <Badge className="text-[10px] px-1.5 py-0 bg-amber-500 hover:bg-amber-600 text-white">MISSED</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{auto.postTime}</span>
            {" "}&middot;{" "}{auto.frequency}
            {" "}&middot;{" "}{auto.timezone.replace(/^.*\//, "")}
          </div>
          {latestLog && (
            <div className="text-[11px] mt-1 flex items-start gap-2 min-w-0">
              <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-semibold uppercase tracking-wide shrink-0 ${outcomePillClass(latestLog.outcome)}`}>
                {latestLog.outcome}
              </span>
              <span className="text-muted-foreground truncate" title={latestLog.message}>
                {latestLog.message}
              </span>
              {(() => {
                const plats = summarizePlatformsFromMessage(latestLog.message);
                if (!plats) return null;
                return <span className="text-[10px] text-blue-700 shrink-0">[{plats}]</span>;
              })()}
            </div>
          )}
        </div>

        {/* Timer chips */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Previous run */}
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 justify-end">
              <History className="h-3 w-3" /> Last ran
            </div>
            <div
              className={`text-xs font-medium ${
                missed === "critical" ? "text-red-600 font-bold"
                : missed === "warning" ? "text-amber-600 font-semibold"
                : ""
              }`}
              title={auto.lastRunAt ? new Date(auto.lastRunAt).toLocaleString() : undefined}
            >
              {auto.lastRunAt ? timeAgo(auto.lastRunAt) : "Never"}
            </div>
          </div>

          {/* Next run */}
          <div className="text-right min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 justify-end">
              <Timer className="h-3 w-3" /> Next run
            </div>
            <div className="text-xs font-semibold text-blue-600" title={auto.nextRunAt ? formatAbsolute(auto.nextRunAt, auto.timezone) : undefined}>
              {auto.enabled ? nextRunLabel : "Paused"}
            </div>
          </div>

          {/* Next post */}
          <div className="text-right min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 justify-end">
              <Clock className="h-3 w-3" /> Posts at
            </div>
            <div className="text-xs font-semibold" title={auto.nextPostAt ? formatAbsolute(auto.nextPostAt, auto.timezone) : undefined}>
              {auto.nextPostAt ? formatAbsolute(auto.nextPostAt, auto.timezone) : "—"}
            </div>
          </div>

          {/* Status indicator */}
          <div className="w-8 flex justify-center">
            {hasIssues ? (
              <AlertTriangle className="h-4 w-4 text-red-500" />
            ) : missed === "critical" ? (
              <AlertTriangle className="h-4 w-4 text-red-500 animate-pulse" />
            ) : missed === "warning" ? (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            ) : lastError ? (
              <XCircle className="h-4 w-4 text-amber-500" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
          </div>

          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t bg-muted/10 divide-y">
          {/* Stuck videos */}
          {auto.stuckVideos.length > 0 && (
            <div className="px-4 py-2">
              <div className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Stuck / Failed Videos
              </div>
              {auto.stuckVideos.map((v) => (
                <div key={v.id} className="flex items-center gap-3 text-xs py-1">
                  {statusBadge(v.status)}
                  <Link href={`/dashboard/videos/${v.id}`} className="hover:underline font-medium flex items-center gap-1">
                    {v.title || v.id.slice(0, 12)}
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </Link>
                  {v.errorMessage && (
                    <span className="text-red-600 truncate max-w-[300px]" title={v.errorMessage}>
                      {v.errorMessage.slice(0, 80)}{v.errorMessage.length > 80 ? "…" : ""}
                    </span>
                  )}
                  <span className="text-muted-foreground ml-auto whitespace-nowrap">
                    retry #{v.retryCount} &middot; {timeAgo(v.updatedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Scheduled videos */}
          {auto.scheduledVideos.length > 0 && (
            <div className="px-4 py-2">
              <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Awaiting Post
              </div>
              {auto.scheduledVideos.map((v) => (
                <div key={v.id} className="flex items-center gap-3 text-xs py-1">
                  <Badge variant="outline" className="gap-1 text-xs text-blue-600 border-blue-200">
                    <Clock className="h-3 w-3" /> READY
                  </Badge>
                  <Link href={`/dashboard/videos/${v.id}`} className="hover:underline font-medium flex items-center gap-1">
                    {v.title || v.id.slice(0, 12)}
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </Link>
                  {v.scheduledPostTime && (
                    <span className="text-muted-foreground">
                      posts {formatRelative(new Date(v.scheduledPostTime))}
                    </span>
                  )}
                  {(() => {
                    const ig = (v.postedPlatforms ?? []).find((p) => p.platform === "INSTAGRAM");
                    if (!ig) return null;
                    if (ig.success === "scheduled") {
                      return (
                        <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                          IG delayed post queued
                        </Badge>
                      );
                    }
                    if (ig.success === true) {
                      return (
                        <Badge variant="outline" className="text-[10px] border-green-300 text-green-700">
                          IG posted
                        </Badge>
                      );
                    }
                    if (ig.success === false) {
                      return (
                        <Badge variant="outline" className="text-[10px] border-red-300 text-red-700">
                          IG failed
                        </Badge>
                      );
                    }
                    return null;
                  })()}
                </div>
              ))}
            </div>
          )}

          {/* Scheduler Logs */}
          <div className="px-4 py-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <Terminal className="h-3 w-3" /> Scheduler Run History
            </div>
            {!auto.enabled && auto.schedulerLogs.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-2">
                Automation is paused — scheduler is not processing it. Enable it to start recording runs.
                {auto.lastRunAt && (
                  <span className="block mt-1">Last known run was {timeAgo(auto.lastRunAt)} (before logging was added).</span>
                )}
              </div>
            ) : visibleLogs.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-2">No scheduler runs recorded yet. Logs will appear after the next scheduler tick.</div>
            ) : (
              <>
                {missed !== "none" && (
                  <div className={`text-xs px-3 py-2 rounded-md mb-2 flex items-center gap-2 ${
                    missed === "critical"
                      ? "bg-red-50 border border-red-200 text-red-700"
                      : "bg-amber-50 border border-amber-200 text-amber-700"
                  }`}>
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {missed === "critical"
                        ? "This automation hasn't produced a successful run in over 72 hours. Check errors below or review full logs."
                        : "This automation hasn't produced a successful run in over 24 hours. Recent history may reveal the cause."
                      }
                    </span>
                  </div>
                )}
                <div className="space-y-0">
                  {visibleLogs.map((entry, idx) => {
                    const isLatest = idx === 0;
                    return (
                      <SchedulerLogRow
                        key={entry.id}
                        entry={entry}
                        tz={auto.timezone}
                        highlight={isLatest && missed !== "none" ? missed : undefined}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* File Log Viewer */}
          <div className="px-4 py-2">
            <FileLogViewer automationId={auto.id} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Scheduler Log Row ──────────────────── */

/* ──────────────────── File Log Viewer ──────────────────── */

function FileLogViewer({ automationId }: { automationId: string }) {
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadingDates, setLoadingDates] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);

  const fetchDates = useCallback(async () => {
    setLoadingDates(true);
    try {
      const res = await fetch(`/api/scheduler/logs?automationId=${automationId}`);
      if (!res.ok) return;
      const json = await res.json();
      const d = (json.dates ?? []) as string[];
      setDates(d);
      if (d.length > 0 && !selectedDate) setSelectedDate(d[0]);
    } finally {
      setLoadingDates(false);
    }
  }, [automationId, selectedDate]);

  const fetchContent = useCallback(async (date: string) => {
    setLoadingContent(true);
    try {
      const res = await fetch(`/api/scheduler/logs?automationId=${automationId}&date=${date}`);
      if (!res.ok) { setContent("Failed to load log."); return; }
      const json = await res.json();
      setContent(json.content || "(empty)");
    } finally {
      setLoadingContent(false);
    }
  }, [automationId]);

  useEffect(() => {
    if (open && dates.length === 0) fetchDates();
  }, [open, dates.length, fetchDates]);

  useEffect(() => {
    if (open && selectedDate) fetchContent(selectedDate);
  }, [open, selectedDate, fetchContent]);

  const dateIdx = selectedDate ? dates.indexOf(selectedDate) : -1;
  const canPrev = dateIdx >= 0 && dateIdx < dates.length - 1;
  const canNext = dateIdx > 0;

  if (!open) {
    return (
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
        onClick={() => setOpen(true)}
      >
        <FileText className="h-3 w-3" />
        View Full Log
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <FileText className="h-3 w-3" /> Full Log
        </div>
        <div className="flex items-center gap-1.5">
          {loadingDates && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {dates.length > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <button
                type="button"
                disabled={!canPrev}
                className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                onClick={() => canPrev && setSelectedDate(dates[dateIdx + 1])}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <select
                value={selectedDate ?? ""}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="text-xs bg-transparent border rounded px-1.5 py-0.5"
              >
                {dates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!canNext}
                className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                onClick={() => canNext && setSelectedDate(dates[dateIdx - 1])}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground ml-2"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      </div>

      {loadingContent ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : dates.length === 0 && !loadingDates ? (
        <div className="text-xs text-muted-foreground italic py-2">No log files yet. Logs appear after the next scheduler run.</div>
      ) : (
        <pre className="p-3 rounded-md bg-zinc-950 text-zinc-200 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  );
}

function SchedulerLogRow({ entry, tz, highlight }: { entry: SchedulerLogEntry; tz: string; highlight?: "warning" | "critical" }) {
  const [showDetail, setShowDetail] = useState(false);

  const rowBg = highlight === "critical" ? "bg-red-50/60 rounded-md px-2 -mx-2"
    : highlight === "warning" ? "bg-amber-50/60 rounded-md px-2 -mx-2"
    : "";

  return (
    <div className={`py-1.5 group ${rowBg}`}>
      <div className="flex items-start gap-2 text-xs">
        {/* Timeline dot */}
        <div className="flex flex-col items-center pt-1.5 shrink-0">
          <div className={`w-2 h-2 rounded-full ${outcomeBg(entry.outcome)}`} />
        </div>

        {/* Timestamp */}
        <span className="text-muted-foreground whitespace-nowrap font-mono w-[110px] shrink-0" title={new Date(entry.createdAt).toLocaleString()}>
          {formatAbsolute(entry.createdAt, tz)}
        </span>

        {/* Outcome badge */}
        <span className={`uppercase font-semibold tracking-wider text-[10px] w-[65px] shrink-0 ${outcomeColor(entry.outcome)}`}>
          {entry.outcome}
        </span>

        {/* Message */}
        <span className="text-foreground flex-1 min-w-0">
          {entry.message}
          {entry.videoId && (
            <Link
              href={`/dashboard/videos/${entry.videoId}`}
              className="ml-1 text-blue-600 hover:underline inline-flex items-center gap-0.5"
              title={entry.videoId}
            >
              {entry.videoId.slice(0, 10)}…
              <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          )}
        </span>

        {/* Duration */}
        {entry.durationMs > 0 && (
          <span className="text-muted-foreground whitespace-nowrap shrink-0">
            {entry.durationMs}ms
          </span>
        )}

        {/* Error expand */}
        {entry.errorDetail && (
          <button
            type="button"
            onClick={() => setShowDetail((s) => !s)}
            className="text-red-500 hover:text-red-700 shrink-0"
            title="Show error detail"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showDetail ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {/* Error detail */}
      {showDetail && entry.errorDetail && (
        <pre className="mt-1 ml-4 p-2 rounded bg-red-50 border border-red-200 text-[10px] text-red-800 overflow-x-auto max-h-40 whitespace-pre-wrap">
          {entry.errorDetail}
        </pre>
      )}
    </div>
  );
}
