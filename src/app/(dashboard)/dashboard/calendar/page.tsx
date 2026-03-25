"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Calendar as CalendarIcon, Clock, Clapperboard, Scissors,
  Youtube, Facebook, Instagram, ChevronDown, ChevronRight, ChevronLeft,
  CheckCircle2, AlertCircle, Timer, Upload, Trash2, Pause,
  RefreshCw, Zap, ArrowRight, X,
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

function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = secs / 60;
  if (mins < 60) return `${mins.toFixed(1)}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function videoDateKey(v: VideoItem): string {
  const iso = v.schedule.scheduledPostTime ?? v.createdAt;
  return dateKey(new Date(iso));
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getMonthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  let startDay = first.getDay() - 1;
  if (startDay < 0) startDay = 6;
  const start = new Date(year, month, 1 - startDay);
  const weeks: Date[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor.getMonth() !== month && w >= 4) break;
  }
  return weeks;
}

const PLAT_ICON: Record<string, { icon: typeof Youtube; color: string }> = {
  YOUTUBE:   { icon: Youtube,   color: "text-red-500" },
  FACEBOOK:  { icon: Facebook,  color: "text-blue-500" },
  INSTAGRAM: { icon: Instagram, color: "text-pink-500" },
};

const STATUS_DOT: Record<string, string> = {
  QUEUED:     "bg-gray-400",
  GENERATING: "bg-indigo-500",
  READY:      "bg-cyan-500",
  SCHEDULED:  "bg-blue-500",
  POSTED:     "bg-green-500",
  FAILED:     "bg-red-500",
};

const STATUS_CHIP: Record<string, string> = {
  QUEUED:     "bg-gray-100 text-gray-700 border-gray-200",
  GENERATING: "bg-indigo-50 text-indigo-700 border-indigo-200",
  READY:      "bg-cyan-50 text-cyan-700 border-cyan-200",
  SCHEDULED:  "bg-blue-50 text-blue-700 border-blue-200",
  POSTED:     "bg-green-50 text-green-700 border-green-200",
  FAILED:     "bg-red-50 text-red-700 border-red-200",
};

const PLAT_STATUS_CFG: Record<string, { color: string; bg: string; icon: typeof CheckCircle2; label: string }> = {
  posted:    { color: "text-green-700", bg: "bg-green-50 border-green-200", icon: CheckCircle2, label: "Posted" },
  scheduled: { color: "text-blue-700",  bg: "bg-blue-50 border-blue-200",  icon: Timer,        label: "Scheduled" },
  cooldown:  { color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: Pause,        label: "Cooldown" },
  uploading: { color: "text-indigo-700", bg: "bg-indigo-50 border-indigo-200", icon: Upload,    label: "Uploading" },
  failed:    { color: "text-red-700",   bg: "bg-red-50 border-red-200",    icon: AlertCircle,  label: "Failed" },
  deleted:   { color: "text-gray-500",  bg: "bg-gray-50 border-gray-200",  icon: Trash2,       label: "Deleted" },
  pending:   { color: "text-gray-500",  bg: "bg-gray-50 border-gray-200",  icon: Clock,        label: "Pending" },
};

const STAGE_COLORS: Record<string, string> = {
  SCRIPT: "bg-violet-400", IMAGES: "bg-sky-400", IMAGE_TO_VIDEO: "bg-teal-400",
  VOICEOVER: "bg-amber-400", BGM: "bg-pink-400", SFX: "bg-orange-400",
  ASSEMBLY: "bg-emerald-400", UPLOADING: "bg-gray-400", DISCOVER: "bg-cyan-400",
  DOWNLOAD: "bg-blue-400", HEATMAP: "bg-indigo-400", CLIP: "bg-purple-400",
  ENHANCE: "bg-rose-400",
};

// ── Sub-components ──

function EventChip({ video, onClick }: { video: VideoItem; onClick: () => void }) {
  const time = fmtTime(video.schedule.scheduledPostTime ?? video.createdAt);
  const statusColor = STATUS_DOT[video.status] ?? "bg-gray-400";

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`group flex items-center gap-1 w-full rounded px-1.5 py-0.5 text-[10px] leading-tight truncate border transition-all hover:shadow-sm ${STATUS_CHIP[video.status] ?? "bg-gray-50 border-gray-200 text-gray-700"}`}
    >
      <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${statusColor}`} />
      {video.isClip
        ? <Scissors className="h-2.5 w-2.5 shrink-0 opacity-60" />
        : <Clapperboard className="h-2.5 w-2.5 shrink-0 opacity-60" />
      }
      <span className="font-medium shrink-0">{time}</span>
      <span className="truncate opacity-70">{video.title || video.niche}</span>
    </button>
  );
}

function DayCell({
  day, videos, isCurrentMonth, isToday, isSelected, onSelect, onEventClick,
}: {
  day: Date;
  videos: VideoItem[];
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onEventClick: (v: VideoItem) => void;
}) {
  const maxVisible = 3;
  const visible = videos.slice(0, maxVisible);
  const overflow = videos.length - maxVisible;

  return (
    <div
      onClick={onSelect}
      className={`min-h-[90px] md:min-h-[110px] border-b border-r p-1 cursor-pointer transition-colors ${
        isSelected
          ? "bg-primary/5 ring-2 ring-primary/30 ring-inset"
          : "hover:bg-muted/40"
      } ${!isCurrentMonth ? "bg-muted/20" : ""}`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span
          className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-medium ${
            isToday
              ? "bg-primary text-primary-foreground"
              : isCurrentMonth
              ? "text-foreground"
              : "text-muted-foreground/50"
          }`}
        >
          {day.getDate()}
        </span>
        {videos.length > 0 && (
          <span className="text-[9px] text-muted-foreground">{videos.length}</span>
        )}
      </div>
      <div className="space-y-0.5">
        {visible.map((v) => (
          <EventChip key={v.id} video={v} onClick={() => onEventClick(v)} />
        ))}
        {overflow > 0 && (
          <div className="text-[9px] text-muted-foreground pl-1 font-medium">
            +{overflow} more
          </div>
        )}
      </div>
    </div>
  );
}

function PlatformBadge({ p }: { p: PlatformInfo }) {
  const platCfg = PLAT_ICON[p.platform];
  const statusCfg = PLAT_STATUS_CFG[p.status] ?? PLAT_STATUS_CFG.pending;
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
        <span className="text-[10px] opacity-70">{fmtTime(p.scheduledFor)}</span>
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

  return (
    <div className="space-y-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
        {sorted.map((s, i) => {
          const pct = ((s.durationMs ?? 0) / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={i}
              className={STAGE_COLORS[s.name] ?? "bg-gray-300"}
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

function DetailPanel({
  video, onClose,
}: {
  video: VideoItem;
  onClose: () => void;
}) {
  const { build, schedule, platforms } = video;
  const [stagesOpen, setStagesOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {video.isClip
            ? <Scissors className="h-5 w-5 text-purple-500 shrink-0" />
            : <Clapperboard className="h-5 w-5 text-blue-500 shrink-0" />
          }
          <div className="min-w-0">
            <p className="font-semibold truncate">{video.title || video.id.slice(0, 16)}</p>
            <p className="text-xs text-muted-foreground">{video.automationName ?? "Manual"} · {video.niche}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-muted rounded-md transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className={`text-xs ${STATUS_CHIP[video.status] ?? ""}`}>
          {video.status}
        </Badge>
        {video.duration && <span className="text-xs text-muted-foreground">{video.duration}s video</span>}
        <span className="text-xs text-muted-foreground">
          {video.isClip ? "Viral Clip" : "AI Video"}
        </span>
      </div>

      {/* Timeline */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Timeline</p>
          <div className="space-y-2 text-sm">
            <TimelineRow
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Build started"
              value={fmtDateTime(build.startedAt ?? video.createdAt)}
            />
            {build.durationMs != null && (
              <TimelineRow
                icon={<Zap className="h-3.5 w-3.5 text-amber-500" />}
                label="Build duration"
                value={fmtDuration(build.durationMs)}
                accent
              />
            )}
            <TimelineRow
              icon={<Timer className="h-3.5 w-3.5 text-blue-500" />}
              label="Scheduled for"
              value={fmtDateTime(schedule.scheduledPostTime)}
            />
            {schedule.postedAt && (
              <TimelineRow
                icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                label="Published"
                value={fmtDateTime(schedule.postedAt)}
              />
            )}
            {schedule.schedToPostMs != null && (
              <TimelineRow
                icon={<ArrowRight className="h-3.5 w-3.5" />}
                label="Schedule accuracy"
                value={`${schedule.schedToPostMs > 0 ? "+" : ""}${fmtDuration(Math.abs(schedule.schedToPostMs))} ${schedule.schedToPostMs > 0 ? "late" : "early"}`}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Platforms */}
      {platforms.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Platforms</p>
            <div className="space-y-1.5">
              {platforms.map((p) => (
                <PlatformBadge key={p.platform} p={p} />
              ))}
            </div>
            {platforms.filter((p) => p.status === "cooldown").map((p) => (
              <div key={`cd-${p.platform}`} className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800">
                <Pause className="h-3.5 w-3.5" />
                <span className="font-medium">{p.platform}</span> cooldown
                {p.retryAfter && (
                  <>
                    <ArrowRight className="h-3 w-3" />
                    retry {fmtDateTime(new Date(p.retryAfter).toISOString())}
                  </>
                )}
              </div>
            ))}
            {platforms.filter((p) => p.status === "failed" && p.error).map((p) => (
              <div key={`err-${p.platform}`} className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span><strong>{p.platform}:</strong> {p.error}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Build stages */}
      {build.stages.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <button
              onClick={() => setStagesOpen(!stagesOpen)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              {stagesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Build Stages
            </button>
            {stagesOpen && <StageBar stages={build.stages} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TimelineRow({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className={`text-xs font-mono ${accent ? "font-semibold text-amber-600" : ""}`}>{value}</span>
    </div>
  );
}

function DayDetailList({ videos, onEventClick }: { videos: VideoItem[]; onEventClick: (v: VideoItem) => void }) {
  if (videos.length === 0) return <p className="text-xs text-muted-foreground py-4 text-center">No videos this day</p>;
  return (
    <div className="space-y-1.5">
      {videos.map((v) => {
        const time = fmtTime(v.schedule.scheduledPostTime ?? v.createdAt);
        return (
          <button
            key={v.id}
            onClick={() => onEventClick(v)}
            className={`flex items-center gap-2 w-full rounded-lg border px-3 py-2 text-left transition-all hover:shadow-sm ${STATUS_CHIP[v.status] ?? "bg-muted/30 border-border"}`}
          >
            <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[v.status] ?? "bg-gray-400"}`} />
            {v.isClip
              ? <Scissors className="h-3.5 w-3.5 shrink-0 opacity-60" />
              : <Clapperboard className="h-3.5 w-3.5 shrink-0 opacity-60" />
            }
            <span className="text-xs font-medium shrink-0">{time}</span>
            <span className="text-xs truncate flex-1">{v.title || v.niche}</span>
            <div className="flex items-center gap-0.5 shrink-0">
              {v.platforms.map((p) => {
                const cfg = PLAT_ICON[p.platform];
                if (!cfg) return null;
                const I = cfg.icon;
                return <I key={p.platform} className={`h-3 w-3 ${cfg.color}`} />;
              })}
            </div>
            {v.build.durationMs != null && (
              <span className="text-[10px] text-muted-foreground shrink-0">{fmtDuration(v.build.durationMs)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Page ──

export default function CalendarPage() {
  const today = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [data, setData] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(dateKey(today));
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/calendar?days=90`);
      if (res.ok) {
        const json = await res.json();
        setData(json.videos ?? []);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const videosByDay = useMemo(() => {
    const map = new Map<string, VideoItem[]>();
    for (const v of data) {
      const key = videoDateKey(v);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return map;
  }, [data]);

  const weeks = useMemo(
    () => getMonthGrid(viewDate.getFullYear(), viewDate.getMonth()),
    [viewDate],
  );

  const todayKey = dateKey(today);
  const monthLabel = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  const goToday = () => {
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDay(todayKey);
    setSelectedVideo(null);
  };

  const selectedDayVideos = selectedDay ? (videosByDay.get(selectedDay) ?? []) : [];

  const monthStats = useMemo(() => {
    let built = 0, buildMs = 0, posted = 0, cooldowns = 0;
    for (const [key, vids] of videosByDay) {
      const d = new Date(key);
      if (!sameMonth(d, viewDate)) continue;
      for (const v of vids) {
        if (v.build.durationMs != null) { built++; buildMs += v.build.durationMs; }
        if (v.status === "POSTED") posted++;
        cooldowns += v.platforms.filter((p) => p.status === "cooldown").length;
      }
    }
    return { built, avgBuildMs: built > 0 ? buildMs / built : 0, posted, cooldowns };
  }, [videosByDay, viewDate]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Calendar
          </h1>
          <div className="hidden md:flex items-center gap-3 ml-4 text-xs text-muted-foreground">
            <span>{monthStats.built} built</span>
            <span className="text-muted-foreground/30">|</span>
            <span>avg {fmtDuration(monthStats.avgBuildMs)}</span>
            <span className="text-muted-foreground/30">|</span>
            <span className="text-green-600">{monthStats.posted} posted</span>
            {monthStats.cooldowns > 0 && (
              <>
                <span className="text-muted-foreground/30">|</span>
                <span className="text-amber-600">{monthStats.cooldowns} cooldowns</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={goToday} className="text-xs h-7 px-2">Today</Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[140px] text-center">{monthLabel}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7 ml-1" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Body: calendar grid + side panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Calendar grid */}
        <div className="flex-1 flex flex-col overflow-auto">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b shrink-0">
            {WEEKDAYS.map((wd) => (
              <div key={wd} className="text-center text-[11px] font-medium text-muted-foreground py-2 border-r last:border-r-0">
                {wd}
              </div>
            ))}
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7">
                  {week.map((day) => {
                    const dk = dateKey(day);
                    const dayVideos = videosByDay.get(dk) ?? [];
                    return (
                      <DayCell
                        key={dk}
                        day={day}
                        videos={dayVideos}
                        isCurrentMonth={sameMonth(day, viewDate)}
                        isToday={dk === todayKey}
                        isSelected={dk === selectedDay}
                        onSelect={() => { setSelectedDay(dk); setSelectedVideo(null); }}
                        onEventClick={(v) => { setSelectedDay(dk); setSelectedVideo(v); }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Side panel */}
        {selectedDay && (
          <div className="w-[320px] lg:w-[360px] border-l bg-background overflow-y-auto shrink-0 hidden md:block">
            <div className="p-4 space-y-4">
              {selectedVideo ? (
                <DetailPanel
                  video={selectedVideo}
                  onClose={() => setSelectedVideo(null)}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
                      {new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", {
                        weekday: "long", month: "long", day: "numeric",
                      })}
                    </h3>
                    <Badge variant="outline" className="text-[10px]">{selectedDayVideos.length}</Badge>
                  </div>
                  <DayDetailList videos={selectedDayVideos} onEventClick={setSelectedVideo} />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
