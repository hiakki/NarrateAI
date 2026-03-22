"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, RefreshCw, Clock, AlertTriangle, CheckCircle2,
  ExternalLink, Bot, Scissors, XCircle, Pause, Play,
} from "lucide-react";

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
}

function computeNextRun(auto: SchedulerAutomation): { label: string; date: Date | null } {
  if (!auto.enabled) return { label: "Paused", date: null };

  const freqDays: Record<string, number> = { daily: 1, every_other_day: 2, weekly: 7 };
  const gap = freqDays[auto.frequency] ?? 1;

  if (!auto.lastRunAt) return { label: "Pending first run", date: null };

  const lastRun = new Date(auto.lastRunAt);
  const nextDate = new Date(lastRun.getTime() + gap * 24 * 60 * 60 * 1000);

  const postSlot = auto.postTime.split(",")[0].trim();
  const [hh, mm] = postSlot.split(":").map(Number);

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: auto.timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    void formatter;
  } catch {
    return { label: nextDate.toLocaleString(), date: nextDate };
  }

  const nextWithTime = new Date(nextDate);
  nextWithTime.setUTCHours(hh, mm, 0, 0);

  return {
    label: formatRelative(nextWithTime),
    date: nextWithTime,
  };
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = date.getTime() - now;

  if (diff < 0) {
    const ago = Math.abs(diff);
    if (ago < 60_000) return "just now";
    if (ago < 3600_000) return `${Math.floor(ago / 60_000)}m ago`;
    if (ago < 86_400_000) return `${Math.floor(ago / 3600_000)}h ago`;
    return `${Math.floor(ago / 86_400_000)}d ago`;
  }
  if (diff < 60_000) return "< 1m";
  if (diff < 3600_000) return `in ${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.floor(diff / 3600_000)}h`;
  return `in ${Math.floor(diff / 86_400_000)}d`;
}

function timeAgo(dateStr: string): string {
  return formatRelative(new Date(dateStr));
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

function autoLink(auto: SchedulerAutomation) {
  return auto.automationType === "clip-repurpose"
    ? `/dashboard/clip-repurpose`
    : `/dashboard/automations/${auto.id}`;
}

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
            Automation schedules, upcoming runs, and stuck videos
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
          {/* Active automations */}
          {activeAutomations.length > 0 && (
            <Section title="Active Automations">
              <ScheduleTable automations={activeAutomations} />
            </Section>
          )}

          {/* Paused automations */}
          {pausedAutomations.length > 0 && (
            <Section title="Paused Automations" defaultOpen={false}>
              <ScheduleTable automations={pausedAutomations} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

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

function ScheduleTable({ automations }: { automations: SchedulerAutomation[] }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium">Automation</th>
              <th className="text-left px-4 py-2.5 font-medium">Schedule</th>
              <th className="text-left px-4 py-2.5 font-medium">Last Run</th>
              <th className="text-left px-4 py-2.5 font-medium">Next Run</th>
              <th className="text-left px-4 py-2.5 font-medium">Issues</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {automations.map((auto) => (
              <AutomationRow key={auto.id} auto={auto} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AutomationRow({ auto }: { auto: SchedulerAutomation }) {
  const nextRun = computeNextRun(auto);
  const isClip = auto.automationType === "clip-repurpose";
  const TypeIcon = isClip ? Scissors : Bot;

  const hasIssues = auto.stuckVideos.length > 0;
  const hasScheduled = auto.scheduledVideos.length > 0;

  return (
    <>
      <tr className={`${hasIssues ? "bg-red-50/30" : ""} hover:bg-muted/30 transition-colors`}>
        {/* Automation name */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <Link href={autoLink(auto)} className="font-medium hover:underline text-foreground flex items-center gap-1">
                {auto.name}
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </Link>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{auto.niche}</Badge>
                {!auto.enabled && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Paused</Badge>}
              </div>
            </div>
          </div>
        </td>

        {/* Schedule */}
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="font-mono text-xs">{auto.postTime}</div>
          <div className="text-xs text-muted-foreground">{auto.frequency} &middot; {auto.timezone.replace(/^.*\//, "")}</div>
        </td>

        {/* Last run */}
        <td className="px-4 py-3 whitespace-nowrap text-xs">
          {auto.lastRunAt ? (
            <span title={new Date(auto.lastRunAt).toLocaleString()}>{timeAgo(auto.lastRunAt)}</span>
          ) : (
            <span className="text-muted-foreground">Never</span>
          )}
        </td>

        {/* Next run */}
        <td className="px-4 py-3 whitespace-nowrap text-xs">
          {nextRun.date ? (
            <span title={nextRun.date.toLocaleString()}>{nextRun.label}</span>
          ) : (
            <span className="text-muted-foreground">{nextRun.label}</span>
          )}
        </td>

        {/* Issues */}
        <td className="px-4 py-3">
          {!hasIssues && !hasScheduled && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> OK
            </span>
          )}
          {hasIssues && (
            <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              {auto.stuckVideos.length} stuck
            </span>
          )}
          {hasScheduled && (
            <span className="flex items-center gap-1 text-xs text-blue-600 mt-0.5">
              <Clock className="h-3.5 w-3.5" />
              {auto.scheduledVideos.length} awaiting post
            </span>
          )}
        </td>
      </tr>

      {/* Expanded rows for stuck videos */}
      {auto.stuckVideos.map((v) => (
        <tr key={v.id} className="bg-red-50/50">
          <td colSpan={5} className="px-4 py-2 pl-12">
            <div className="flex items-center gap-3 text-xs">
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
          </td>
        </tr>
      ))}

      {/* Expanded rows for scheduled-to-post videos */}
      {auto.scheduledVideos.map((v) => (
        <tr key={v.id} className="bg-blue-50/30">
          <td colSpan={5} className="px-4 py-2 pl-12">
            <div className="flex items-center gap-3 text-xs">
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
          </td>
        </tr>
      ))}
    </>
  );
}
