"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Plus, Clock, Loader2, Instagram, Youtube, Facebook,
  Trash2, Film, Zap, AlertCircle, CheckCircle2, XCircle, RefreshCw, Send,
  Pause, Play, Square,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface PlatformEntry {
  platform: string;
  success?: boolean | "uploading";
  postId?: string;
  url?: string;
  error?: string;
  startedAt?: number;
}

interface LastVideo {
  id: string;
  title: string | null;
  status: string;
  postedPlatforms: (string | PlatformEntry)[];
  createdAt: string;
  updatedAt: string;
}

interface Automation {
  id: string;
  name: string;
  niche: string;
  artStyle: string;
  tone: string;
  targetPlatforms: string[];
  enabled: boolean;
  frequency: string;
  postTime: string;
  timezone: string;
  lastRunAt: string | null;
  createdAt: string;
  series: { _count: { videos: number }; lastVideo: LastVideo | null } | null;
}

const PLATFORM_CFG: Record<string, { icon: typeof Instagram; color: string; label: string }> = {
  INSTAGRAM: { icon: Instagram, color: "text-pink-600", label: "IG" },
  YOUTUBE: { icon: Youtube, color: "text-red-600", label: "YT" },
  FACEBOOK: { icon: Facebook, color: "text-blue-600", label: "FB" },
};

const FREQ_LABEL: Record<string, string> = {
  daily: "Daily",
  every_other_day: "Every other day",
  weekly: "Weekly",
};

const STATUS_CFG: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  QUEUED: { label: "Queued", className: "text-yellow-700 bg-yellow-50", icon: Clock },
  GENERATING: { label: "Generating", className: "text-blue-700 bg-blue-50", icon: Loader2 },
  READY: { label: "Ready", className: "text-green-700 bg-green-50", icon: CheckCircle2 },
  POSTED: { label: "Posted", className: "text-green-800 bg-green-100", icon: CheckCircle2 },
  FAILED: { label: "Failed", className: "text-red-700 bg-red-50", icon: XCircle },
};

const FREQ_THRESHOLDS: Record<string, number> = { daily: 26, every_other_day: 50, weekly: 170 };

function isMissed(auto: Automation): boolean {
  if (!auto.enabled) return false;
  const timesPerDay = auto.postTime.split(",").length;
  let threshold = FREQ_THRESHOLDS[auto.frequency] ?? 26;
  if (timesPerDay > 1 && auto.frequency === "daily") {
    threshold = Math.min(threshold, 26 / timesPerDay);
  }
  if (!auto.lastRunAt) return true;
  const hours = (Date.now() - new Date(auto.lastRunAt).getTime()) / (1000 * 60 * 60);
  return hours > threshold;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function parsePlatformEntries(raw: (string | PlatformEntry)[]): Map<string, PlatformEntry> {
  const map = new Map<string, PlatformEntry>();
  for (const p of raw) {
    if (typeof p === "string") {
      map.set(p, { platform: p, success: true });
    } else {
      const entry = { ...p };
      if (entry.success === undefined && (entry.postId || entry.url)) {
        entry.success = true;
      }
      map.set(entry.platform, entry);
    }
  }
  return map;
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [retryingVideoId, setRetryingVideoId] = useState<string | null>(null);
  const [postingKey, setPostingKey] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [runAllState, setRunAllState] = useState<{
    running: boolean;
    current: number;
    total: number;
    currentName: string;
    failed: string[];
  } | null>(null);

  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch("/api/automations");
      const json = await res.json();
      if (json.data) setAutomations(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  // Auto-poll when any automation has an active video
  const hasActiveWork = useMemo(
    () => automations.some((a) => {
      const lv = a.series?.lastVideo;
      if (!lv) return false;
      const s = lv.status;
      if (s === "QUEUED" || s === "GENERATING") return true;
      const entries = (lv.postedPlatforms ?? []) as (string | PlatformEntry)[];
      return entries.some((e) => typeof e !== "string" && e.success === "uploading");
    }),
    [automations],
  );

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (hasActiveWork || triggeringId || retryingVideoId || postingKey) {
      pollRef.current = setInterval(fetchAutomations, 8000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hasActiveWork, triggeringId, retryingVideoId, postingKey, fetchAutomations]);

  async function toggleEnabled(id: string, enabled: boolean) {
    setAutomations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, enabled } : a)),
    );
    try {
      await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      setAutomations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, enabled: !enabled } : a)),
      );
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/automations/${id}`, { method: "DELETE" });
      if (res.ok) setAutomations((prev) => prev.filter((a) => a.id !== id));
    } catch { /* ignore */ }
  }

  async function handleTrigger(id: string) {
    setTriggeringId(id);
    try {
      const res = await fetch(`/api/automations/${id}/trigger`, { method: "POST" });
      if (res.ok) fetchAutomations();
      else {
        const json = await res.json();
        alert(json.error || "Trigger failed");
      }
    } catch { alert("Trigger failed"); }
    finally { setTriggeringId(null); }
  }

  async function handleRetryVideo(videoId: string) {
    setRetryingVideoId(videoId);
    try {
      const res = await fetch(`/api/videos/${videoId}/retry`, { method: "POST" });
      if (res.ok) fetchAutomations();
      else {
        const json = await res.json();
        alert(json.error || "Retry failed");
      }
    } catch { alert("Retry failed"); }
    finally { setRetryingVideoId(null); }
  }

  async function handlePostPlatform(videoId: string, platform: string) {
    const key = `${videoId}-${platform}`;
    setPostingKey(key);
    try {
      const res = await fetch(`/api/videos/${videoId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: [platform] }),
      });
      if (res.ok) fetchAutomations();
      else {
        const json = await res.json();
        alert(json.error || "Post failed");
      }
    } catch { alert("Post failed"); }
    finally { setPostingKey(null); }
  }

  async function handleStop(id: string) {
    setStoppingId(id);
    try {
      const res = await fetch(`/api/automations/${id}/stop`, { method: "POST" });
      if (res.ok) {
        setAutomations((prev) =>
          prev.map((a) => (a.id === id ? { ...a, enabled: false } : a)),
        );
        await fetchAutomations();
      } else {
        const json = await res.json();
        alert(json.error || "Stop failed");
      }
    } catch { alert("Stop failed"); }
    finally { setStoppingId(null); }
  }

  const sortedAutomations = useMemo(
    () => [...automations].sort((a, b) => {
      const aFirst = a.postTime.split(",")[0].trim();
      const bFirst = b.postTime.split(",")[0].trim();
      return aFirst.localeCompare(bFirst);
    }),
    [automations],
  );

  const missedAutomations = useMemo(
    () => sortedAutomations.filter((a) => {
      if (!isMissed(a)) return false;
      const lv = a.series?.lastVideo ?? null;
      return !lv || lv.status === "POSTED" || lv.status === "READY";
    }),
    [sortedAutomations],
  );

  const activeGenerations = useMemo(
    () => sortedAutomations.filter((a) => {
      if (!a.enabled) return false;
      const lv = a.series?.lastVideo;
      return lv && (lv.status === "QUEUED" || lv.status === "GENERATING");
    }),
    [sortedAutomations],
  );

  const enabledAutomations = useMemo(
    () => sortedAutomations.filter((a) => a.enabled),
    [sortedAutomations],
  );

  const pausedAutomations = useMemo(
    () => sortedAutomations.filter((a) => !a.enabled),
    [sortedAutomations],
  );

  const [stopAllState, setStopAllState] = useState<{
    running: boolean;
    current: number;
    total: number;
    currentName: string;
    failed: string[];
  } | null>(null);

  async function handleStopAll() {
    const targets = activeGenerations;
    if (targets.length === 0) return;

    const failed: string[] = [];
    setStopAllState({ running: true, current: 0, total: targets.length, currentName: targets[0].name, failed });

    for (let i = 0; i < targets.length; i++) {
      const auto = targets[i];
      setStopAllState((s) => s ? { ...s, current: i, currentName: auto.name } : s);
      setStoppingId(auto.id);
      try {
        const res = await fetch(`/api/automations/${auto.id}/stop`, { method: "POST" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          failed.push(`${auto.name}: ${json.error || "Failed"}`);
        }
        await fetchAutomations();
      } catch {
        failed.push(`${auto.name}: Network error`);
      }
      setStoppingId(null);
    }

    setStopAllState({ running: false, current: targets.length, total: targets.length, currentName: "", failed });
    setTimeout(() => setStopAllState(null), failed.length > 0 ? 8000 : 3000);
  }

  const [pausingAll, setPausingAll] = useState(false);

  async function handlePauseAll() {
    setPausingAll(true);
    try {
      await Promise.all(
        enabledAutomations.map((a) =>
          fetch(`/api/automations/${a.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: false }),
          }),
        ),
      );
      setAutomations((prev) => prev.map((a) => ({ ...a, enabled: false })));
      await fetchAutomations();
    } catch { /* ignore */ }
    finally { setPausingAll(false); }
  }

  const [resumingAll, setResumingAll] = useState(false);

  async function handleResumeAll() {
    setResumingAll(true);
    try {
      await Promise.all(
        pausedAutomations.map((a) =>
          fetch(`/api/automations/${a.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          }),
        ),
      );
      setAutomations((prev) => prev.map((a) => ({ ...a, enabled: true })));
      await fetchAutomations();
    } catch { /* ignore */ }
    finally { setResumingAll(false); }
  }

  async function handleRunAllMissed() {
    const targets = missedAutomations;
    if (targets.length === 0) return;

    const failed: string[] = [];
    setRunAllState({ running: true, current: 0, total: targets.length, currentName: targets[0].name, failed });

    for (let i = 0; i < targets.length; i++) {
      const auto = targets[i];
      setRunAllState((s) => s ? { ...s, current: i, currentName: auto.name } : s);
      setTriggeringId(auto.id);
      try {
        const res = await fetch(`/api/automations/${auto.id}/trigger`, { method: "POST" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          failed.push(`${auto.name}: ${json.error || "Failed"}`);
        }
        await fetchAutomations();
      } catch {
        failed.push(`${auto.name}: Network error`);
      }
      setTriggeringId(null);
    }

    setRunAllState({ running: false, current: targets.length, total: targets.length, currentName: "", failed });
    setTimeout(() => setRunAllState(null), failed.length > 0 ? 8000 : 3000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Automations</h1>
          <p className="mt-1 text-muted-foreground">
            Set up scheduled video generation and auto-posting to your channels.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {sortedAutomations.length > 0 && (() => {
            const isBusy = !!stopAllState?.running || !!runAllState?.running || pausingAll || resumingAll;

            let mode: "stop" | "resume" | "run-missed" | "pause" | "idle";
            if (stopAllState?.running) mode = "stop";
            else if (runAllState?.running) mode = "run-missed";
            else if (pausingAll) mode = "pause";
            else if (resumingAll) mode = "resume";
            else if (activeGenerations.length > 0) mode = "stop";
            else if (pausedAutomations.length > 0) mode = "resume";
            else if (missedAutomations.length > 0) mode = "run-missed";
            else if (enabledAutomations.length > 0) mode = "pause";
            else mode = "idle";

            const cfgs = {
              stop: {
                label: `Stop All (${activeGenerations.length})`,
                Icon: Square,
                className: "border-red-300 text-red-600 hover:bg-red-50",
                handler: handleStopAll,
                progressLabel: stopAllState?.running
                  ? `Stopping ${stopAllState.current + 1}/${stopAllState.total}`
                  : null,
              },
              pause: {
                label: `Pause All (${enabledAutomations.length})`,
                Icon: Pause,
                className: "border-muted-foreground/30 text-muted-foreground hover:bg-muted",
                handler: handlePauseAll,
                progressLabel: pausingAll ? "Pausing…" : null,
              },
              resume: {
                label: `Resume All (${pausedAutomations.length})`,
                Icon: Play,
                className: "border-green-300 text-green-600 hover:bg-green-50",
                handler: handleResumeAll,
                progressLabel: resumingAll ? "Resuming…" : null,
              },
              "run-missed": {
                label: `Run All Missed (${missedAutomations.length})`,
                Icon: Zap,
                className: "border-amber-300 text-amber-700 hover:bg-amber-100",
                handler: handleRunAllMissed,
                progressLabel: runAllState?.running
                  ? `Running ${runAllState.current + 1}/${runAllState.total}`
                  : null,
              },
              idle: {
                label: "All Caught Up",
                Icon: CheckCircle2,
                className: "border-muted text-muted-foreground",
                handler: () => {},
                progressLabel: null,
              },
            } as const;

            const cfg = cfgs[mode];
            const BtnIcon = cfg.Icon;

            return (
              <Button
                variant="outline"
                className={cfg.className}
                disabled={isBusy || mode === "idle"}
                onClick={cfg.handler}
              >
                {isBusy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {cfg.progressLabel || cfg.label}
                  </>
                ) : (
                  <>
                    <BtnIcon className="mr-2 h-4 w-4" />
                    {cfg.label}
                  </>
                )}
              </Button>
            );
          })()}
          <Button asChild>
            <Link href="/dashboard/automations/new">
              <Plus className="mr-2 h-4 w-4" /> New Automation
            </Link>
          </Button>
        </div>
      </div>

      {stopAllState && (
        <div className={`mb-6 rounded-lg border p-4 text-sm ${
          stopAllState.running
            ? "border-red-200 bg-red-50 text-red-800"
            : stopAllState.failed.length > 0
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-green-200 bg-green-50 text-green-800"
        }`}>
          {stopAllState.running ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>
                Stopping <strong>{stopAllState.currentName}</strong> ({stopAllState.current + 1} of {stopAllState.total})
              </span>
            </div>
          ) : stopAllState.failed.length > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Stopped {stopAllState.total - stopAllState.failed.length}/{stopAllState.total} automations</span>
              </div>
              {stopAllState.failed.map((msg, i) => (
                <p key={i} className="ml-6 text-xs opacity-80">{msg}</p>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>All {stopAllState.total} active generations stopped</span>
            </div>
          )}
        </div>
      )}

      {runAllState && (
        <div className={`mb-6 rounded-lg border p-4 text-sm ${
          runAllState.running
            ? "border-blue-200 bg-blue-50 text-blue-800"
            : runAllState.failed.length > 0
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-green-200 bg-green-50 text-green-800"
        }`}>
          {runAllState.running ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>
                Running <strong>{runAllState.currentName}</strong> ({runAllState.current + 1} of {runAllState.total})
              </span>
            </div>
          ) : runAllState.failed.length > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Completed {runAllState.total - runAllState.failed.length}/{runAllState.total} automations</span>
              </div>
              {runAllState.failed.map((msg, i) => (
                <p key={i} className="ml-6 text-xs opacity-80">{msg}</p>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>All {runAllState.total} missed automations triggered successfully</span>
            </div>
          )}
        </div>
      )}

      {sortedAutomations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
            <Bot className="h-12 w-12 mb-4" />
            <h2 className="text-xl font-semibold text-foreground">No automations yet</h2>
            <p className="text-sm mt-2">
              Create an automation to auto-generate and post videos on a schedule.
            </p>
            <Button asChild className="mt-6">
              <Link href="/dashboard/automations/new">
                <Plus className="mr-2 h-4 w-4" /> Create your first automation
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedAutomations.map((auto) => {
            const lv = auto.series?.lastVideo ?? null;
            const lvStatus = lv ? (STATUS_CFG[lv.status] ?? STATUS_CFG.QUEUED) : null;
            const platformMap = lv ? parsePlatformEntries(lv.postedPlatforms ?? []) : new Map<string, PlatformEntry>();

            return (
              <Card key={auto.id} className="flex flex-col transition-colors hover:border-primary/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Link href={`/dashboard/automations/${auto.id}`} className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{auto.name}</CardTitle>
                    </Link>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => toggleEnabled(auto.id, !auto.enabled)}
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                          auto.enabled
                            ? "bg-green-100 text-green-700 hover:bg-green-200"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {auto.enabled ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
                        {auto.enabled ? "Active" : "Paused"}
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <Link href={`/dashboard/automations/${auto.id}`} className="flex-1 flex flex-col">
                  <CardContent className="pt-0 space-y-3 flex-1 flex flex-col">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="capitalize text-xs">
                        {auto.niche}
                      </Badge>
                      <Badge variant="outline" className="capitalize text-xs">
                        {auto.tone}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{FREQ_LABEL[auto.frequency] ?? auto.frequency} at {auto.postTime.split(",").map((t: string) => t.trim()).sort().join(", ")}</span>
                      <span className="text-muted-foreground/60">·</span>
                      <Film className="h-3 w-3" />
                      <span>{auto.series?._count.videos ?? 0}</span>
                    </div>

                    {/* Last video status */}
                    {lv && lvStatus ? (
                      <div className="rounded-lg border p-2.5 space-y-2 bg-muted/30">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium truncate flex-1">
                            {lv.title || "Untitled"}
                          </p>
                          <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${lvStatus.className}`}>
                            <lvStatus.icon className={`h-2.5 w-2.5 ${lv.status === "GENERATING" ? "animate-spin" : ""}`} />
                            {lvStatus.label}
                          </div>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {timeAgo(lv.createdAt)}
                        </div>

                        {/* Per-platform status — always show all targets */}
                        {auto.targetPlatforms.length > 0 && (
                          <div className="space-y-1">
                            {auto.targetPlatforms.map((p) => {
                              const cfg = PLATFORM_CFG[p];
                              if (!cfg) return null;
                              const Icon = cfg.icon;
                              const entry = platformMap.get(p);
                              const isSuccess = entry?.success === true;
                              const isUploading = entry?.success === "uploading";
                              const isFail = entry?.success === false;
                              const isVideoFailed = lv.status === "FAILED";
                              const isGenerating = lv.status === "GENERATING" || lv.status === "QUEUED";

                              let statusEl: React.ReactNode;
                              let rowClass = "";

                              if (isSuccess) {
                                rowClass = "bg-green-50 border-green-200";
                                statusEl = (
                                  <span className="flex items-center gap-1 text-green-700">
                                    <CheckCircle2 className="h-3 w-3" />
                                    <span>Posted</span>
                                  </span>
                                );
                              } else if (isUploading || postingKey === `${lv.id}-${p}`) {
                                rowClass = "bg-blue-50 border-blue-200";
                                statusEl = (
                                  <span className="flex items-center gap-1 text-blue-600">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    <span>Uploading</span>
                                  </span>
                                );
                              } else if (isFail) {
                                rowClass = "bg-red-50 border-red-200";
                                statusEl = (
                                  <span className="flex items-center gap-1 text-red-600" title={entry.error}>
                                    <XCircle className="h-3 w-3" />
                                    <span>Failed</span>
                                  </span>
                                );
                              } else if (isVideoFailed) {
                                rowClass = "bg-red-50/50 border-red-100";
                                statusEl = (
                                  <span className="flex items-center gap-1 text-red-500">
                                    <XCircle className="h-3 w-3" />
                                    <span>Video failed</span>
                                  </span>
                                );
                              } else if (isGenerating) {
                                rowClass = "bg-muted/40";
                                statusEl = (
                                  <span className="flex items-center gap-1 text-muted-foreground">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    <span>Building</span>
                                  </span>
                                );
                              } else {
                                rowClass = "bg-amber-50/50 border-amber-100";
                                statusEl = (
                                  <span className="flex items-center gap-1 text-amber-600">
                                    <Clock className="h-3 w-3" />
                                    <span>Pending</span>
                                  </span>
                                );
                              }

                              return (
                                <div key={p} className={`flex items-center justify-between rounded border px-2 py-1 text-[10px] font-medium ${rowClass}`}>
                                  <span className="flex items-center gap-1.5">
                                    <Icon className={`h-3 w-3 ${cfg.color}`} />
                                    {cfg.label}
                                  </span>
                                  {statusEl}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground/60 italic">
                        {auto.lastRunAt
                          ? `Last run: ${new Date(auto.lastRunAt).toLocaleDateString()}`
                          : "No videos yet"}
                      </div>
                    )}
                  </CardContent>
                </Link>

                {/* Footer actions */}
                <div className="px-6 pb-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Retry generation for failed video */}
                    {lv?.status === "FAILED" && (
                      <Button
                        size="xs"
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        disabled={retryingVideoId === lv.id}
                        onClick={(e) => { e.preventDefault(); handleRetryVideo(lv.id); }}
                      >
                        {retryingVideoId === lv.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <><RefreshCw className="mr-1 h-3 w-3" /> Retry Video</>
                        )}
                      </Button>
                    )}

                    {/* Retry posting for failed/pending platforms */}
                    {lv && (lv.status === "READY" || lv.status === "POSTED") && auto.targetPlatforms.map((p) => {
                      const entry = platformMap.get(p);
                      const isUploading = entry?.success === "uploading";
                      const needsPost = !entry || entry.success === false;
                      if (!needsPost || isUploading) return null;
                      const cfg = PLATFORM_CFG[p];
                      if (!cfg) return null;
                      const Icon = cfg.icon;
                      const key = `${lv.id}-${p}`;
                      const isPosting = postingKey === key;
                      const isFailed = entry?.success === false;

                      return (
                        <Button
                          key={p}
                          size="xs"
                          variant="outline"
                          className={isFailed
                            ? "border-red-300 text-red-600 hover:bg-red-50"
                            : "border-amber-300 text-amber-700 hover:bg-amber-100"
                          }
                          disabled={isPosting}
                          onClick={(e) => { e.preventDefault(); handlePostPlatform(lv.id, p); }}
                          title={isFailed && entry?.error ? entry.error : undefined}
                        >
                          {isPosting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>
                              <Icon className="mr-1 h-3 w-3" />
                              {isFailed ? "Retry" : "Post"}
                            </>
                          )}
                        </Button>
                      );
                    })}

                    {/* Run now for missed schedules */}
                    {isMissed(auto) && (!lv || lv.status === "POSTED" || lv.status === "READY") && (
                      <Button
                        size="xs"
                        variant="outline"
                        className="border-amber-300 text-amber-700 hover:bg-amber-100"
                        disabled={triggeringId === auto.id || !!runAllState?.running}
                        onClick={(e) => { e.preventDefault(); handleTrigger(auto.id); }}
                      >
                        {triggeringId === auto.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <><Zap className="mr-1 h-3 w-3" /> Run Now</>
                        )}
                      </Button>
                    )}

                    {/* Stop: disable automation + cancel in-progress video */}
                    {auto.enabled && lv && (lv.status === "QUEUED" || lv.status === "GENERATING") && (
                      <Button
                        size="xs"
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        disabled={stoppingId === auto.id}
                        onClick={(e) => { e.preventDefault(); handleStop(auto.id); }}
                      >
                        {stoppingId === auto.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <><Square className="mr-1 h-3 w-3" /> Stop</>
                        )}
                      </Button>
                    )}
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive shrink-0">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete automation?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete &quot;{auto.name}&quot; and all its generated videos.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(auto.id)}
                          className="bg-destructive text-white hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
