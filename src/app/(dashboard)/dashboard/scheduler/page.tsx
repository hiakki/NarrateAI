"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, RefreshCw, Clock, AlertTriangle, CheckCircle2,
  ExternalLink, Bot, Scissors, XCircle, Pause, Play,
  ChevronDown, Timer, History, Terminal,
} from "lucide-react";

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

/* ──────────────────────── Helpers ──────────────────────── */

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = date.getTime() - now;

  if (diff < 0) {
    const ago = Math.abs(diff);
    if (ago < 60_000) return "just now";
    if (ago < 3600_000) return `${Math.floor(ago / 60_000)}m ago`;
    if (ago < 86_400_000) return `${Math.floor(ago / 3600_000)}h ${Math.floor((ago % 3600_000) / 60_000)}m ago`;
    return `${Math.floor(ago / 86_400_000)}d ago`;
  }
  if (diff < 60_000) return "< 1m";
  if (diff < 3600_000) return `in ${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.floor(diff / 3600_000)}h ${Math.floor((diff % 3600_000) / 60_000)}m`;
  return `in ${Math.floor(diff / 86_400_000)}d`;
}

function formatAbsolute(dateStr: string, tz?: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(dateStr));
  } catch {
    return new Date(dateStr).toLocaleString();
  }
}

function timeAgo(dateStr: string): string {
  return formatRelative(new Date(dateStr));
}

function autoLink(auto: SchedulerAutomation) {
  return auto.automationType === "clip-repurpose"
    ? `/dashboard/clip-repurpose`
    : `/dashboard/automations/${auto.id}`;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/scheduler");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json.data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const activeAutomations = data.filter((a) => a.enabled);
  const pausedAutomations = data.filter((a) => !a.enabled);
  const totalStuck = data.reduce((n, a) => n + a.stuckVideos.length, 0);
  const totalScheduled = data.reduce((n, a) => n + a.scheduledVideos.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Scheduler</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sorted by next post time &middot; auto-refreshes every 30s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Active" value={activeAutomations.length} icon={<Play className="h-4 w-4 text-green-600" />} />
        <SummaryCard label="Paused" value={pausedAutomations.length} icon={<Pause className="h-4 w-4 text-muted-foreground" />} />
        <SummaryCard
          label="Stuck / Failed"
          value={totalStuck}
          icon={<AlertTriangle className={`h-4 w-4 ${totalStuck > 0 ? "text-red-500" : "text-muted-foreground"}`} />}
          highlight={totalStuck > 0}
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

function SummaryCard({ label, value, icon, highlight }: { label: string; value: number; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-red-300 bg-red-50/50" : "bg-card"}`}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? "text-red-600" : ""}`}>{value}</div>
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
  const nextRunLabel = useCountdown(auto.nextRunAt);
  const nextPostLabel = useCountdown(auto.nextPostAt);
  const lastError = auto.schedulerLogs.find((l) => l.outcome === "error");

  return (
    <div className={`rounded-lg border ${hasIssues ? "border-red-300" : "border-border"} overflow-hidden`}>
      {/* Header row */}
      <button
        type="button"
        className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors ${hasIssues ? "bg-red-50/30" : ""}`}
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
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{auto.postTime}</span>
            {" "}&middot;{" "}{auto.frequency}
            {" "}&middot;{" "}{auto.timezone.replace(/^.*\//, "")}
          </div>
        </div>

        {/* Timer chips */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Previous run */}
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 justify-end">
              <History className="h-3 w-3" /> Last ran
            </div>
            <div className="text-xs font-medium" title={auto.lastRunAt ? new Date(auto.lastRunAt).toLocaleString() : undefined}>
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
                </div>
              ))}
            </div>
          )}

          {/* Scheduler Logs */}
          <div className="px-4 py-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <Terminal className="h-3 w-3" /> Scheduler Run History
            </div>
            {auto.schedulerLogs.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-2">No scheduler runs recorded yet</div>
            ) : (
              <div className="space-y-0">
                {auto.schedulerLogs.map((entry) => (
                  <SchedulerLogRow key={entry.id} entry={entry} tz={auto.timezone} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Scheduler Log Row ──────────────────── */

function SchedulerLogRow({ entry, tz }: { entry: SchedulerLogEntry; tz: string }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="py-1.5 group">
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
