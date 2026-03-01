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
  Pause, Play, Square, CheckSquare, SquareIcon, Star, EyeOff,
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
  characterId: string | null;
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

function firstTriggerMinutes(postTime: string): number {
  const first = postTime.split(",")[0]?.trim() ?? "23:59";
  const [h, m] = first.split(":").map((n) => parseInt(n, 10));
  const hh = Number.isFinite(h) ? h : 23;
  const mm = Number.isFinite(m) ? m : 59;
  return hh * 60 + mm;
}

function getLocalNowParts(timezone: string): { dateKey: string; minuteOfDay: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

  return {
    dateKey: `${year}-${month}-${day}`,
    minuteOfDay: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  };
}

function getLocalDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function isMissed(auto: Automation): boolean {
  if (!auto.enabled) return false;

  // Daily definition requested:
  // missed = has not run at all between today's 12:00 AM and now (automation timezone),
  // and at least one scheduled slot has already passed today.
  if (auto.frequency === "daily") {
    const { dateKey: todayKey, minuteOfDay: nowMinute } = getLocalNowParts(auto.timezone);
    const slots = auto.postTime
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => firstTriggerMinutes(t))
      .sort((a, b) => a - b);

    if (slots.length === 0) return false;
    const hasPassedSlotToday = slots.some((m) => m <= nowMinute);
    if (!hasPassedSlotToday) return false;

    if (!auto.lastRunAt) return true;
    const lastRunKey = getLocalDateKey(new Date(auto.lastRunAt), auto.timezone);
    return lastRunKey !== todayKey;
  }

  // Keep previous behavior for non-daily frequencies.
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  const [triggerResult, setTriggerResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleTrigger(id: string) {
    setTriggeringId(id);
    setTriggerResult(null);
    const url = `/api/automations/${id}/trigger`;
    try {
      const res = await fetch(url, { method: "POST" });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        setTriggerResult({ ok: true, msg: `Queued: ${json.data?.title ?? id}` });
        setTimeout(() => setTriggerResult(null), 5000);
        fetchAutomations();
        return;
      }
      const text = await res.text();
      let msg = `HTTP ${res.status}`;
      try { msg = JSON.parse(text).error ?? msg; } catch { msg = text.slice(0, 200) || msg; }
      setTriggerResult({ ok: false, msg });
      setTimeout(() => setTriggerResult(null), 8000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setTriggerResult({ ok: false, msg });
      setTimeout(() => setTriggerResult(null), 8000);
    } finally {
      setTriggeringId(null);
    }
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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const sortedAutomations = useMemo(
    () => [...automations].sort((a, b) => {
      // 1) Active/enabled first
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      // 2) Earlier trigger time first
      const timeDiff = firstTriggerMinutes(a.postTime) - firstTriggerMinutes(b.postTime);
      if (timeDiff !== 0) return timeDiff;
      // 3) Stable tie-breaker
      return a.name.localeCompare(b.name);
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
    const hasSelection = selectedIds.size > 0;
    const targets = hasSelection
      ? activeGenerations.filter((a) => selectedIds.has(a.id))
      : activeGenerations;
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

  async function handleDisableAll() {
    const hasSelection = selectedIds.size > 0;
    const targets = hasSelection
      ? enabledAutomations.filter((a) => selectedIds.has(a.id))
      : enabledAutomations;
    if (targets.length === 0) return;

    setPausingAll(true);
    try {
      await Promise.all(
        targets.map((a) =>
          fetch(`/api/automations/${a.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: false }),
          }),
        ),
      );
      const ids = new Set(targets.map((a) => a.id));
      setAutomations((prev) => prev.map((a) => ids.has(a.id) ? { ...a, enabled: false } : a));
      await fetchAutomations();
    } catch { /* ignore */ }
    finally { setPausingAll(false); }
  }

  const [resumingAll, setResumingAll] = useState(false);

  async function handleEnableAll() {
    const hasSel = selectedIds.size > 0;
    const targets = hasSel
      ? pausedAutomations.filter((a) => selectedIds.has(a.id))
      : pausedAutomations;
    if (targets.length === 0) return;

    setResumingAll(true);
    try {
      await Promise.all(
        targets.map((a) =>
          fetch(`/api/automations/${a.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          }),
        ),
      );
      const ids = new Set(targets.map((a) => a.id));
      setAutomations((prev) => prev.map((a) => ids.has(a.id) ? { ...a, enabled: true } : a));
      await fetchAutomations();
    } catch { /* ignore */ }
    finally { setResumingAll(false); }
  }

  async function handleRunAllMissed() {
    const hasSelection = selectedIds.size > 0;
    const targets = hasSelection
      ? missedAutomations.filter((a) => selectedIds.has(a.id))
      : missedAutomations;
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

  const [runSelectedState, setRunSelectedState] = useState<{
    running: boolean;
    current: number;
    total: number;
    currentName: string;
    failed: string[];
  } | null>(null);
  const [deleteAllState, setDeleteAllState] = useState<{
    running: boolean;
    current: number;
    total: number;
    currentName: string;
    failed: string[];
  } | null>(null);

  async function handleRunSelected() {
    const hasSelection = selectedIds.size > 0;
    const targets = hasSelection
      ? sortedAutomations.filter((a) => selectedIds.has(a.id) && a.enabled)
      : enabledAutomations;
    if (targets.length === 0) return;

    const failed: string[] = [];
    setRunSelectedState({ running: true, current: 0, total: targets.length, currentName: targets[0].name, failed });

    for (let i = 0; i < targets.length; i++) {
      const auto = targets[i];
      setRunSelectedState((s) => s ? { ...s, current: i, currentName: auto.name } : s);
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

    setRunSelectedState({ running: false, current: targets.length, total: targets.length, currentName: "", failed });
    setTimeout(() => setRunSelectedState(null), failed.length > 0 ? 8000 : 3000);
  }

  async function handleDeleteBulk() {
    const hasSelection = selectedIds.size > 0;
    const targets = hasSelection
      ? sortedAutomations.filter((a) => selectedIds.has(a.id))
      : sortedAutomations;
    if (targets.length === 0) return;

    const failed: string[] = [];
    setDeleteAllState({ running: true, current: 0, total: targets.length, currentName: targets[0].name, failed });

    for (let i = 0; i < targets.length; i++) {
      const auto = targets[i];
      setDeleteAllState((s) => s ? { ...s, current: i, currentName: auto.name } : s);
      try {
        const res = await fetch(`/api/automations/${auto.id}`, { method: "DELETE" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          failed.push(`${auto.name}: ${json.error || "Failed"}`);
        }
      } catch {
        failed.push(`${auto.name}: Network error`);
      }
    }

    await fetchAutomations();
    setSelectedIds(new Set());
    setDeleteAllState({ running: false, current: targets.length, total: targets.length, currentName: "", failed });
    setTimeout(() => setDeleteAllState(null), failed.length > 0 ? 8000 : 3000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isBusy = !!stopAllState?.running || !!runAllState?.running || !!runSelectedState?.running || !!deleteAllState?.running || pausingAll || resumingAll;
  const hasSelection = selectedIds.size > 0;
  const selLabel = hasSelection ? "Selected" : "All";

  const stopCount = hasSelection
    ? activeGenerations.filter((a) => selectedIds.has(a.id)).length
    : activeGenerations.length;
  const disableCount = hasSelection
    ? enabledAutomations.filter((a) => selectedIds.has(a.id)).length
    : enabledAutomations.length;
  const enableCount = hasSelection
    ? pausedAutomations.filter((a) => selectedIds.has(a.id)).length
    : pausedAutomations.length;
  const missedCount = hasSelection
    ? missedAutomations.filter((a) => selectedIds.has(a.id)).length
    : missedAutomations.length;
  const runCount = hasSelection
    ? sortedAutomations.filter((a) => selectedIds.has(a.id) && a.enabled).length
    : enabledAutomations.length;
  const deleteCount = hasSelection
    ? sortedAutomations.filter((a) => selectedIds.has(a.id)).length
    : sortedAutomations.length;

  const allSelected = sortedAutomations.length > 0 && selectedIds.size === sortedAutomations.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl font-bold">Automations</h1>
          <p className="mt-1 text-muted-foreground">
            Set up scheduled video generation and auto-posting to your channels.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/automations/new">
            <Plus className="mr-2 h-4 w-4" /> New Automation
          </Link>
        </Button>
      </div>

      {/* Action toolbar */}
      {sortedAutomations.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-6 rounded-lg border bg-muted/30 p-3">
          {/* Select all toggle */}
          <button
            onClick={() => {
              if (allSelected) setSelectedIds(new Set());
              else setSelectedIds(new Set(sortedAutomations.map((a) => a.id)));
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mr-1"
          >
            {allSelected
              ? <CheckSquare className="h-4 w-4 text-primary" />
              : <SquareIcon className="h-4 w-4" />
            }
            {hasSelection ? `${selectedIds.size} selected` : "Select"}
          </button>

          <div className="w-px h-6 bg-border" />

          {/* 1. Stop */}
          <Button
            variant="outline"
            size="sm"
            className="border-red-300 text-red-600 hover:bg-red-50"
            disabled={isBusy || stopCount === 0}
            onClick={handleStopAll}
          >
            {stopAllState?.running ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Stopping {stopAllState.current + 1}/{stopAllState.total}
              </>
            ) : (
              <>
                <Square className="mr-1.5 h-3.5 w-3.5" />
                Stop {selLabel}{stopCount > 0 ? ` (${stopCount})` : ""}
              </>
            )}
          </Button>

          {/* 2. Disable */}
          <Button
            variant="outline"
            size="sm"
            className="border-muted-foreground/30 text-muted-foreground hover:bg-muted"
            disabled={isBusy || disableCount === 0}
            onClick={handleDisableAll}
          >
            {pausingAll ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Disabling…
              </>
            ) : (
              <>
                <Pause className="mr-1.5 h-3.5 w-3.5" />
                Disable {selLabel}{disableCount > 0 ? ` (${disableCount})` : ""}
              </>
            )}
          </Button>

          {/* 3. Enable */}
          <Button
            variant="outline"
            size="sm"
            className="border-green-300 text-green-600 hover:bg-green-50"
            disabled={isBusy || enableCount === 0}
            onClick={handleEnableAll}
          >
            {resumingAll ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Enabling…
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Enable {selLabel}{enableCount > 0 ? ` (${enableCount})` : ""}
              </>
            )}
          </Button>

          {/* 4. Run Missed */}
          <Button
            variant="outline"
            size="sm"
            className="border-amber-300 text-amber-700 hover:bg-amber-100"
            disabled={isBusy || missedCount === 0}
            onClick={handleRunAllMissed}
          >
            {runAllState?.running ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Running {runAllState.current + 1}/{runAllState.total}
              </>
            ) : (
              <>
                <Zap className="mr-1.5 h-3.5 w-3.5" />
                Run Missed{missedCount > 0 ? ` (${missedCount})` : ""}
              </>
            )}
          </Button>

          {/* 4. Run Selected/All */}
          <Button
            variant="outline"
            size="sm"
            className="border-blue-300 text-blue-600 hover:bg-blue-50"
            disabled={isBusy || runCount === 0}
            onClick={handleRunSelected}
          >
            {runSelectedState?.running ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Running {runSelectedState.current + 1}/{runSelectedState.total}
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Run {selLabel}{runCount > 0 ? ` (${runCount})` : ""}
              </>
            )}
          </Button>

          {/* 5. Delete Selected/All */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="border-red-300 text-red-600 hover:bg-red-50"
                disabled={isBusy || deleteCount === 0}
              >
                {deleteAllState?.running ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Deleting {deleteAllState.current + 1}/{deleteAllState.total}
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete {selLabel}{deleteCount > 0 ? ` (${deleteCount})` : ""}
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {selLabel.toLowerCase()} automations?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete {deleteCount} automation{deleteCount === 1 ? "" : "s"} and related generated videos.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteBulk}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {hasSelection && (
            <>
              <div className="w-px h-6 bg-border" />
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

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

      {runSelectedState && (
        <div className={`mb-6 rounded-lg border p-4 text-sm ${
          runSelectedState.running
            ? "border-blue-200 bg-blue-50 text-blue-800"
            : runSelectedState.failed.length > 0
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-green-200 bg-green-50 text-green-800"
        }`}>
          {runSelectedState.running ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>
                Running <strong>{runSelectedState.currentName}</strong> ({runSelectedState.current + 1} of {runSelectedState.total})
              </span>
            </div>
          ) : runSelectedState.failed.length > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Completed {runSelectedState.total - runSelectedState.failed.length}/{runSelectedState.total} automations</span>
              </div>
              {runSelectedState.failed.map((msg, i) => (
                <p key={i} className="ml-6 text-xs opacity-80">{msg}</p>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>All {runSelectedState.total} automations triggered successfully</span>
            </div>
          )}
        </div>
      )}

      {deleteAllState && (
        <div className={`mb-6 rounded-lg border p-4 text-sm ${
          deleteAllState.running
            ? "border-red-200 bg-red-50 text-red-800"
            : deleteAllState.failed.length > 0
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-green-200 bg-green-50 text-green-800"
        }`}>
          {deleteAllState.running ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>
                Deleting <strong>{deleteAllState.currentName}</strong> ({deleteAllState.current + 1} of {deleteAllState.total})
              </span>
            </div>
          ) : deleteAllState.failed.length > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Deleted {deleteAllState.total - deleteAllState.failed.length}/{deleteAllState.total} automations</span>
              </div>
              {deleteAllState.failed.map((msg, i) => (
                <p key={i} className="ml-6 text-xs opacity-80">{msg}</p>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>All {deleteAllState.total} automations deleted</span>
            </div>
          )}
        </div>
      )}

      {triggerResult && (
        <div className={`mb-4 rounded-lg border p-3 text-sm flex items-center gap-2 ${
          triggerResult.ok
            ? "border-green-200 bg-green-50 text-green-800"
            : "border-red-200 bg-red-50 text-red-800"
        }`}>
          {triggerResult.ok
            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
            : <AlertCircle className="h-4 w-4 shrink-0" />
          }
          <span>{triggerResult.ok ? "Triggered successfully" : "Trigger failed"}: {triggerResult.msg}</span>
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
              <Card
                key={auto.id}
                className={`flex flex-col transition-colors hover:border-primary/50 ${
                  selectedIds.has(auto.id) ? "ring-2 ring-primary/40 border-primary/50" : ""
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button
                        onClick={(e) => { e.preventDefault(); toggleSelect(auto.id); }}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        {selectedIds.has(auto.id)
                          ? <CheckSquare className="h-4 w-4 text-primary" />
                          : <SquareIcon className="h-4 w-4" />
                        }
                      </button>
                      <Link href={`/dashboard/automations/${auto.id}`} className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate">{auto.name}</CardTitle>
                      </Link>
                    </div>
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
                      {auto.characterId ? (
                        <Badge variant="default" className="text-xs bg-amber-500 hover:bg-amber-600">
                          <Star className="h-2.5 w-2.5 mr-0.5" /> Star
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          <EyeOff className="h-2.5 w-2.5 mr-0.5" /> Faceless
                        </Badge>
                      )}
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
