"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Calendar as CalendarIcon, Clock, Clapperboard, Scissors,
  Youtube, Facebook, Instagram, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, Timer, Upload, Trash2, Pause,
  RefreshCw, Zap, ArrowRight,
} from "lucide-react";

// ── Types ──

interface StageEntry {
  name: string;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface PlatformInfo {
  platform: string;
  status: string;
  postId: string | null;
  url: string | null;
  error: string | null;
  scheduledFor: string | null;
  retryAfter: number | null;
}

interface VideoItem {
  id: string;
  title: string | null;
  status: string;
  isClip: boolean;
  automationName: string | null;
  automationType: string;
  niche: string;
  createdAt: string;
  updatedAt: string;
  duration: number | null;
  build: {
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    stages: StageEntry[];
  };
  schedule: {
    scheduledPostTime: string | null;
    postedAt: string | null;
    schedToPostMs: number | null;
  };
  platforms: PlatformInfo[];
}

// ── Helpers ──

const DAY_OPTIONS = [
  { label: "Today", value: 1 },
  { label: "3 Days", value: 3 },
  { label: "7 Days", value: 7 },
  { label: "14 Days", value: 14 },
  { label: "30 Days", value: 30 },
] as const;

function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = secs / 60;
  if (mins < 60) return `${mins.toFixed(1)}m`;
  const hrs = mins / 60;
  return `${hrs.toFixed(1)}h`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function fmtDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const PLAT_ICON: Record<string, { icon: typeof Youtube; color: string }> = {
  YOUTUBE:   { icon: Youtube,   color: "text-red-500" },
  FACEBOOK:  { icon: Facebook,  color: "text-blue-500" },
  INSTAGRAM: { icon: Instagram, color: "text-pink-500" },
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof CheckCircle2; label: string }> = {
  posted:    { color: "text-green-700", bg: "bg-green-50 border-green-200", icon: CheckCircle2, label: "Posted" },
  scheduled: { color: "text-blue-700",  bg: "bg-blue-50 border-blue-200",  icon: Timer,        label: "Scheduled" },
  cooldown:  { color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: Pause,        label: "Cooldown" },
  uploading: { color: "text-indigo-700", bg: "bg-indigo-50 border-indigo-200", icon: Upload,    label: "Uploading" },
  failed:    { color: "text-red-700",   bg: "bg-red-50 border-red-200",    icon: AlertCircle,  label: "Failed" },
  deleted:   { color: "text-gray-500",  bg: "bg-gray-50 border-gray-200",  icon: Trash2,       label: "Deleted" },
  pending:   { color: "text-gray-500",  bg: "bg-gray-50 border-gray-200",  icon: Clock,        label: "Pending" },
};

const VIDEO_STATUS_BADGE: Record<string, string> = {
  QUEUED:     "bg-gray-100 text-gray-700 border-gray-200",
  GENERATING: "bg-indigo-100 text-indigo-700 border-indigo-200",
  READY:      "bg-cyan-100 text-cyan-700 border-cyan-200",
  SCHEDULED:  "bg-blue-100 text-blue-700 border-blue-200",
  POSTED:     "bg-green-100 text-green-700 border-green-200",
  FAILED:     "bg-red-100 text-red-700 border-red-200",
};

// ── Components ──

function PlatformBadge({ p }: { p: PlatformInfo }) {
  const platCfg = PLAT_ICON[p.platform];
  const statusCfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.pending;
  const Icon = platCfg?.icon ?? Zap;
  const StatusIcon = statusCfg.icon;

  return (
    <div className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${statusCfg.bg}`}>
      <Icon className={`h-3.5 w-3.5 ${platCfg?.color ?? "text-gray-500"}`} />
      <StatusIcon className={`h-3 w-3 ${statusCfg.color}`} />
      <span className={statusCfg.color}>{statusCfg.label}</span>
      {p.status === "cooldown" && p.retryAfter && (
        <span className="text-[10px] opacity-70">
          retry {fmtTime(new Date(p.retryAfter).toISOString())}
        </span>
      )}
      {p.status === "scheduled" && p.scheduledFor && (
        <span className="text-[10px] opacity-70">
          {fmtTime(p.scheduledFor)}
        </span>
      )}
    </div>
  );
}

function StageBar({ stages }: { stages: StageEntry[] }) {
  const sorted = [...stages].sort((a, b) => {
    if (!a.startedAt || !b.startedAt) return 0;
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  });
  const total = sorted.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  if (total === 0) return null;

  const STAGE_COLORS: Record<string, string> = {
    SCRIPT: "bg-violet-400",
    IMAGES: "bg-sky-400",
    IMAGE_TO_VIDEO: "bg-teal-400",
    VOICEOVER: "bg-amber-400",
    BGM: "bg-pink-400",
    SFX: "bg-orange-400",
    ASSEMBLY: "bg-emerald-400",
    UPLOADING: "bg-gray-400",
    DISCOVER: "bg-cyan-400",
    DOWNLOAD: "bg-blue-400",
    HEATMAP: "bg-indigo-400",
    CLIP: "bg-purple-400",
    ENHANCE: "bg-rose-400",
  };

  return (
    <div className="space-y-1">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
        {sorted.map((s, i) => {
          const pct = total > 0 ? ((s.durationMs ?? 0) / total) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <div
              key={i}
              className={`${STAGE_COLORS[s.name] ?? "bg-gray-300"} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${s.name}: ${fmtDuration(s.durationMs)}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        {sorted.filter((s) => (s.durationMs ?? 0) > 0).map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${STAGE_COLORS[s.name] ?? "bg-gray-300"}`} />
            {s.name} {fmtDuration(s.durationMs)}
          </span>
        ))}
      </div>
    </div>
  );
}

function VideoCard({ video }: { video: VideoItem }) {
  const [expanded, setExpanded] = useState(false);
  const { build, schedule, platforms } = video;

  const hasCooldown = platforms.some((p) => p.status === "cooldown");

  return (
    <Card className={`transition-shadow hover:shadow-md ${hasCooldown ? "ring-1 ring-amber-300" : ""}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {video.isClip
              ? <Scissors className="h-4 w-4 text-purple-500 shrink-0" />
              : <Clapperboard className="h-4 w-4 text-blue-500 shrink-0" />
            }
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {video.title || video.id.slice(0, 12)}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {video.automationName ?? "Manual"} · {video.niche}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className={`text-[10px] ${VIDEO_STATUS_BADGE[video.status] ?? ""}`}>
              {video.status}
            </Badge>
            {video.duration && (
              <span className="text-[10px] text-muted-foreground">{video.duration}s</span>
            )}
          </div>
        </div>

        {/* Timeline summary */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Built</span>
          </div>
          <div className="text-right font-mono">
            {fmtTime(build.startedAt ?? video.createdAt)}
            {build.durationMs != null && (
              <span className="ml-1 text-muted-foreground">({fmtDuration(build.durationMs)})</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Timer className="h-3 w-3" />
            <span>Scheduled</span>
          </div>
          <div className="text-right font-mono">
            {fmtTime(schedule.scheduledPostTime)}
          </div>

          {schedule.postedAt && (
            <>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <span>Posted</span>
              </div>
              <div className="text-right font-mono">
                {fmtTime(schedule.postedAt)}
                {schedule.schedToPostMs != null && (
                  <span className="ml-1 text-muted-foreground">
                    ({schedule.schedToPostMs > 0 ? "+" : ""}{fmtDuration(Math.abs(schedule.schedToPostMs))} {schedule.schedToPostMs > 0 ? "late" : "early"})
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Platforms */}
        {platforms.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {platforms.map((p) => (
              <PlatformBadge key={p.platform} p={p} />
            ))}
          </div>
        )}

        {/* Expand for stages */}
        {build.stages.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Build stages
            </button>
            {expanded && (
              <div className="mt-2">
                <StageBar stages={build.stages} />
              </div>
            )}
          </div>
        )}

        {/* Cooldown details */}
        {platforms.filter((p) => p.status === "cooldown").map((p) => (
          <div key={p.platform} className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800">
            <Pause className="h-3.5 w-3.5" />
            <span className="font-medium">{p.platform}</span> cooldown
            {p.retryAfter && (
              <>
                <ArrowRight className="h-3 w-3" />
                retry at {fmtDateTime(new Date(p.retryAfter).toISOString())}
              </>
            )}
          </div>
        ))}

        {/* Failed platform errors */}
        {platforms.filter((p) => p.status === "failed" && p.error).map((p) => (
          <div key={p.platform} className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span><span className="font-medium">{p.platform}:</span> {p.error}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Main Page ──

export default function CalendarPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/calendar?days=${d}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.videos ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(days); }, [days, fetchData]);

  const grouped = useMemo(() => {
    const map = new Map<string, VideoItem[]>();
    for (const v of data) {
      const key = fmtDateKey(v.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return [...map.entries()];
  }, [data]);

  // Summary stats
  const stats = useMemo(() => {
    let totalBuilt = 0;
    let totalBuildMs = 0;
    let totalPosted = 0;
    let totalCooldowns = 0;
    let totalScheduled = 0;
    for (const v of data) {
      if (v.build.durationMs != null) {
        totalBuilt++;
        totalBuildMs += v.build.durationMs;
      }
      if (v.status === "POSTED") totalPosted++;
      if (v.status === "SCHEDULED") totalScheduled++;
      totalCooldowns += v.platforms.filter((p) => p.status === "cooldown").length;
    }
    return {
      total: data.length,
      built: totalBuilt,
      avgBuildMs: totalBuilt > 0 ? totalBuildMs / totalBuilt : 0,
      posted: totalPosted,
      scheduled: totalScheduled,
      cooldowns: totalCooldowns,
    };
  }, [data]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarIcon className="h-6 w-6" />
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build timelines, post schedules, and platform status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border overflow-hidden">
            {DAY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchData(days)} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Total Videos" value={String(stats.total)} />
        <SummaryCard label="Avg Build Time" value={fmtDuration(stats.avgBuildMs)} />
        <SummaryCard label="Posted" value={String(stats.posted)} accent="green" />
        <SummaryCard label="Scheduled" value={String(stats.scheduled)} accent="blue" />
        <SummaryCard label="Cooldowns" value={String(stats.cooldowns)} accent={stats.cooldowns > 0 ? "amber" : undefined} />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && data.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <CalendarIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No videos found in the last {days} day{days > 1 ? "s" : ""}</p>
        </div>
      )}

      {/* Timeline grouped by day */}
      {!loading && grouped.map(([dateLabel, videos]) => (
        <div key={dateLabel} className="space-y-3">
          <div className="sticky top-14 z-10 bg-background/95 backdrop-blur-sm py-2 border-b">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <CalendarIcon className="h-4 w-4" />
              {dateLabel}
              <Badge variant="outline" className="text-[10px] ml-1">{videos.length}</Badge>
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const accentClass = accent === "green"
    ? "text-green-600"
    : accent === "blue"
    ? "text-blue-600"
    : accent === "amber"
    ? "text-amber-600"
    : "";
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold ${accentClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
