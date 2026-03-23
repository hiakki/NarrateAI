"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2, Play, Plus, ExternalLink, RefreshCw,
  Scissors, TrendingUp, Eye, Clock, CheckCircle2,
  XCircle, Pause, Film, Instagram, Youtube, Facebook,
  Share2, Smartphone, Zap, AlertCircle, Pencil, Trash2, Save, X,
  CalendarClock, Heart, BarChart2, Search, ChevronDown, ChevronRight,
  CheckSquare, Square as SquareIcon, StopCircle,
} from "lucide-react";

interface PlatformEntry {
  platform: string;
  success?: boolean | "uploading" | "scheduled" | "deleted";
  postId?: string;
  url?: string;
  error?: string;
  scheduledFor?: string;
}

interface ClipVideo {
  id: string;
  title: string | null;
  status: string;
  videoUrl: string | null;
  duration: number | null;
  sourceUrl: string | null;
  sourceMetadata: {
    platform?: string;
    channelName?: string;
    originalTitle?: string;
    viewCount?: number;
    peakSegment?: { startSec: number; endSec: number; avgHeat: number };
  } | null;
  postedPlatforms: (string | PlatformEntry)[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClipAutomation {
  id: string;
  name: string;
  enabled: boolean;
  frequency: string;
  postTime: string;
  timezone: string;
  lastRunAt: string | null;
  targetPlatforms: string[];
  includeAiTags: boolean;
  crossPlatformOnly: boolean;
  enableBgm: boolean;
  enableHflip: boolean;
  clipConfig: {
    clipNiche: string;
    clipDurationSec: number;
    cropMode: string;
  } | null;
  series: {
    _count: { videos: number };
    lastVideo: ClipVideo | null;
    videos: ClipVideo[];
  } | null;
}

interface InsightsAgg {
  totalViews: number;
  totalInteractions: number;
  videoCount: number;
  avgViews: number;
  avgInteractions: number;
  lastRefreshedAt: string | null;
}

interface InsightsData {
  lastRefreshedAt: string | null;
  byAutomation: Record<string, InsightsAgg>;
}

type BulkOpState = {
  running: boolean;
  current: number;
  total: number;
  currentName: string;
  failed: string[];
} | null;

const CLIP_NICHES: Record<string, { label: string; icon: string }> = {
  "viral-repost": { label: "Viral Repost", icon: "🔥" },
  films:         { label: "Films & Movies", icon: "🎬" },
  anime:         { label: "Anime", icon: "⚔️" },
  serials:       { label: "TV Shows & Serials", icon: "📺" },
  entertainment: { label: "Entertainment", icon: "🎭" },
  nature:        { label: "Nature & Animals", icon: "🌿" },
  science:       { label: "Science & Tech", icon: "🔬" },
  sports:        { label: "Sports & Fitness", icon: "⚽" },
  gaming:        { label: "Gaming", icon: "🎮" },
  food:          { label: "Food & Cooking", icon: "🍳" },
  travel:        { label: "Travel & Adventure", icon: "✈️" },
  news:          { label: "News & Events", icon: "📰" },
  education:     { label: "Education", icon: "📚" },
  motivation:    { label: "Motivation", icon: "💪" },
  comedy:        { label: "Comedy & Memes", icon: "😂" },
  music:         { label: "Music & Dance", icon: "🎵" },
  auto:          { label: "Auto (All)", icon: "🔄" },
};

const PLATFORM_CFG: Record<string, { icon: typeof Instagram; color: string; label: string }> = {
  INSTAGRAM: { icon: Instagram, color: "text-pink-600", label: "IG Reels" },
  YOUTUBE: { icon: Youtube, color: "text-red-600", label: "YT Shorts" },
  FACEBOOK: { icon: Facebook, color: "text-blue-600", label: "FB Reels" },
  SHARECHAT: { icon: Share2, color: "text-orange-600", label: "ShareChat" },
  MOJ: { icon: Smartphone, color: "text-amber-600", label: "Moj" },
};

const STATUS_CFG: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  QUEUED: { label: "Queued", className: "text-yellow-700 bg-yellow-50", icon: Clock },
  GENERATING: { label: "Generating", className: "text-blue-700 bg-blue-50", icon: Loader2 },
  READY: { label: "Ready", className: "text-green-700 bg-green-50", icon: CheckCircle2 },
  SCHEDULED: { label: "Scheduled", className: "text-blue-700 bg-blue-100", icon: CalendarClock },
  POSTED: { label: "Posted", className: "text-green-800 bg-green-100", icon: CheckCircle2 },
  FAILED: { label: "Failed", className: "text-red-700 bg-red-50", icon: XCircle },
};

const FREQ_LABEL: Record<string, string> = {
  daily: "Daily",
  every_other_day: "Every other day",
  weekly: "Weekly",
};

const FREQ_PER_DAY: Record<string, number> = {
  daily: 1,
  every_other_day: 0.5,
  weekly: 1 / 7,
};

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
      if (entry.success === undefined && (entry.postId || entry.url)) entry.success = true;
      map.set(entry.platform, entry);
    }
  }
  return map;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function ClipRepurposePage() {
  const [automations, setAutomations] = useState<ClipAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string; clipNiche: string; clipDurationSec: number; cropMode: string;
    targetPlatforms: Set<string>; frequency: string; postTime: string;
    includeAiTags: boolean; crossPlatformOnly: boolean; enableBgm: boolean; enableHflip: boolean;
  }>({ name: "", clipNiche: "auto", clipDurationSec: 45, cropMode: "blur-bg", targetPlatforms: new Set(), frequency: "daily", postTime: "10:00", includeAiTags: false, crossPlatformOnly: false, enableBgm: true, enableHflip: false });

  const [formName, setFormName] = useState("Viral Clips");
  const [formNiche, setFormNiche] = useState("auto");
  const [formDuration, setFormDuration] = useState(45);
  const [formCropMode, setFormCropMode] = useState("blur-bg");
  const [formPlatforms, setFormPlatforms] = useState<Set<string>>(new Set(["FACEBOOK", "YOUTUBE", "INSTAGRAM"]));
  const [formIncludeAiTags, setFormIncludeAiTags] = useState(false);
  const [formCrossPlatformOnly, setFormCrossPlatformOnly] = useState(false);
  const [formEnableBgm, setFormEnableBgm] = useState(true);
  const [formEnableHflip, setFormEnableHflip] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [retryingVideoId, setRetryingVideoId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCollapsed, setActiveCollapsed] = useState(false);
  const [pausedCollapsed, setPausedCollapsed] = useState(false);

  const [insightsData, setInsightsData] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightsRefreshing, setInsightsRefreshing] = useState(false);
  const [insightsRefreshingId, setInsightsRefreshingId] = useState<string | null>(null);

  const [stopAllState, setStopAllState] = useState<BulkOpState>(null);
  const [runSelectedState, setRunSelectedState] = useState<BulkOpState>(null);
  const [deleteAllState, setDeleteAllState] = useState<BulkOpState>(null);
  const [retryAllState, setRetryAllState] = useState<BulkOpState>(null);
  const [pausingAll, setPausingAll] = useState(false);
  const [resumingAll, setResumingAll] = useState(false);

  /* ---- data fetching ---- */

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/clip-repurpose");
      const json = await res.json();
      setAutomations(json.data ?? []);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInsights = useCallback(async () => {
    try {
      const res = await fetch("/api/insights");
      const json = await res.json();
      setInsightsData(json.data ?? null);
    } catch (err) {
      console.error("Insights fetch error:", err);
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchInsights(); }, [fetchInsights]);

  const hasActiveWork = useMemo(
    () => automations.some((a) => {
      const lv = a.series?.lastVideo;
      return lv && (lv.status === "QUEUED" || lv.status === "GENERATING");
    }),
    [automations],
  );

  useEffect(() => {
    if (!hasActiveWork) return;
    const iv = setInterval(fetchData, 5000);
    return () => clearInterval(iv);
  }, [hasActiveWork, fetchData]);

  /* ---- existing actions ---- */

  const triggerClip = async (automationId: string) => {
    setTriggeringId(automationId);
    try {
      await fetch("/api/clip-repurpose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger", automationId }),
      });
      setTimeout(fetchData, 1500);
    } finally {
      setTriggeringId(null);
    }
  };

  const toggleEnabled = async (automationId: string, enabled: boolean) => {
    setAutomations((prev) =>
      prev.map((a) => (a.id === automationId ? { ...a, enabled } : a)),
    );
    await fetch("/api/clip-repurpose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", automationId, enabled }),
    });
  };

  const togglePlatform = (p: string) => {
    setFormPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  const createAutomation = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/clip-repurpose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: formName,
          clipNiche: formNiche,
          clipDurationSec: formDuration,
          cropMode: formCropMode,
          targetPlatforms: Array.from(formPlatforms),
          includeAiTags: formIncludeAiTags,
          crossPlatformOnly: formCrossPlatformOnly,
          enableBgm: formEnableBgm,
          enableHflip: formEnableHflip,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        fetchData();
      }
    } finally {
      setCreating(false);
    }
  };

  const startEditing = (auto: ClipAutomation) => {
    setEditingId(auto.id);
    setEditForm({
      name: auto.name,
      clipNiche: auto.clipConfig?.clipNiche ?? "auto",
      clipDurationSec: auto.clipConfig?.clipDurationSec ?? 45,
      cropMode: auto.clipConfig?.cropMode ?? "blur-bg",
      targetPlatforms: new Set(auto.targetPlatforms ?? []),
      frequency: auto.frequency,
      postTime: auto.postTime,
      includeAiTags: auto.includeAiTags ?? false,
      crossPlatformOnly: auto.crossPlatformOnly ?? false,
      enableBgm: auto.enableBgm ?? true,
      enableHflip: auto.enableHflip ?? false,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await fetch("/api/clip-repurpose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          automationId: editingId,
          name: editForm.name,
          clipNiche: editForm.clipNiche,
          clipDurationSec: editForm.clipDurationSec,
          cropMode: editForm.cropMode,
          targetPlatforms: Array.from(editForm.targetPlatforms),
          frequency: editForm.frequency,
          postTime: editForm.postTime,
          includeAiTags: editForm.includeAiTags,
          crossPlatformOnly: editForm.crossPlatformOnly,
          enableBgm: editForm.enableBgm,
          enableHflip: editForm.enableHflip,
        }),
      });
      setEditingId(null);
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const deleteAutomation = async (id: string) => {
    if (!confirm("Delete this automation and all its clips?")) return;
    setDeletingId(id);
    try {
      await fetch("/api/clip-repurpose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", automationId: id }),
      });
      fetchData();
    } finally {
      setDeletingId(null);
    }
  };

  const toggleEditPlatform = (p: string) => {
    setEditForm((prev) => {
      const next = new Set(prev.targetPlatforms);
      if (next.has(p)) next.delete(p); else next.add(p);
      return { ...prev, targetPlatforms: next };
    });
  };

  /* ---- loading gate ---- */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  /* ---- computed values ---- */

  const sortedAutomations = [...automations].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const ta = a.postTime ?? "";
    const tb = b.postTime ?? "";
    if (ta !== tb) return ta.localeCompare(tb);
    return a.name.localeCompare(b.name);
  });

  const enabledAutomations = sortedAutomations.filter((a) => a.enabled);
  const pausedAutomations = sortedAutomations.filter((a) => !a.enabled);
  const activeGenerations = sortedAutomations.filter((a) => {
    const lv = a.series?.lastVideo;
    return lv && (lv.status === "QUEUED" || lv.status === "GENERATING");
  });
  const automationsWithFailedVideo = sortedAutomations.filter(
    (a) => a.series?.lastVideo?.status === "FAILED",
  );

  const lowerQ = searchQuery.toLowerCase();
  const filteredAutomations = sortedAutomations.filter((a) => {
    if (!searchQuery) return true;
    const niche = a.clipConfig?.clipNiche ?? "";
    const nicheLabel = CLIP_NICHES[niche]?.label ?? "";
    const platLabels = (a.targetPlatforms ?? []).map((p) => PLATFORM_CFG[p]?.label ?? p).join(" ");
    if (
      a.name.toLowerCase().includes(lowerQ) ||
      nicheLabel.toLowerCase().includes(lowerQ) ||
      platLabels.toLowerCase().includes(lowerQ)
    ) return true;
    const videos = a.series?.videos ?? [];
    return videos.some((v) => {
      if (
        v.title?.toLowerCase().includes(lowerQ) ||
        v.sourceMetadata?.channelName?.toLowerCase().includes(lowerQ) ||
        v.sourceMetadata?.originalTitle?.toLowerCase().includes(lowerQ) ||
        v.id.toLowerCase().includes(lowerQ) ||
        v.sourceUrl?.toLowerCase().includes(lowerQ)
      ) return true;
      const entries = (v.postedPlatforms ?? []) as PlatformEntry[];
      return entries.some((e) => typeof e === "object" && e.url?.toLowerCase().includes(lowerQ));
    });
  });

  const activeFiltered = filteredAutomations.filter((a) => a.enabled);
  const pausedFiltered = filteredAutomations.filter((a) => !a.enabled);

  const hasSelection = selectedIds.size > 0;
  const selLabel = hasSelection ? "Selected" : "All";
  const allSelected = sortedAutomations.length > 0 && selectedIds.size === sortedAutomations.length;

  const stopCount = hasSelection ? activeGenerations.filter((a) => selectedIds.has(a.id)).length : activeGenerations.length;
  const disableCount = hasSelection ? enabledAutomations.filter((a) => selectedIds.has(a.id)).length : enabledAutomations.length;
  const enableCount = hasSelection ? pausedAutomations.filter((a) => selectedIds.has(a.id)).length : pausedAutomations.length;
  const runCount = hasSelection ? sortedAutomations.filter((a) => selectedIds.has(a.id) && a.enabled).length : enabledAutomations.length;
  const retryCount = hasSelection ? automationsWithFailedVideo.filter((a) => selectedIds.has(a.id)).length : automationsWithFailedVideo.length;
  const deleteCount = hasSelection ? sortedAutomations.filter((a) => selectedIds.has(a.id)).length : sortedAutomations.length;

  const isBusy = !!stopAllState?.running || !!runSelectedState?.running || !!deleteAllState?.running || !!retryAllState?.running || pausingAll || resumingAll;

  const platformDailyClips: Record<string, number> = {};
  let uniqueDailyClips = 0;
  for (const a of enabledAutomations) {
    const rate = FREQ_PER_DAY[a.frequency] ?? 1;
    uniqueDailyClips += rate;
    for (const p of a.targetPlatforms ?? []) {
      platformDailyClips[p] = (platformDailyClips[p] ?? 0) + rate;
    }
  }

  /* ---- selection & bulk handlers ---- */

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleStopAll() {
    const targets = hasSelection
      ? activeGenerations.filter((a) => selectedIds.has(a.id))
      : activeGenerations;
    if (targets.length === 0) return;

    const failed: string[] = [];
    setStopAllState({ running: true, current: 0, total: targets.length, currentName: targets[0].name, failed });

    for (let i = 0; i < targets.length; i++) {
      const auto = targets[i];
      setStopAllState((s) => s ? { ...s, current: i, currentName: auto.name } : s);
      try {
        const res = await fetch("/api/clip-repurpose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop", automationId: auto.id }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          failed.push(`${auto.name}: ${json.error || "Failed"}`);
        }
        await fetchData();
      } catch {
        failed.push(`${auto.name}: Network error`);
      }
    }

    setStopAllState({ running: false, current: targets.length, total: targets.length, currentName: "", failed });
    setTimeout(() => setStopAllState(null), failed.length > 0 ? 8000 : 3000);
  }

  async function handleDisableAll() {
    const targets = hasSelection
      ? enabledAutomations.filter((a) => selectedIds.has(a.id))
      : enabledAutomations;
    if (targets.length === 0) return;

    setPausingAll(true);
    try {
      await Promise.all(
        targets.map((a) =>
          fetch("/api/clip-repurpose", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "toggle", automationId: a.id, enabled: false }),
          }),
        ),
      );
      const ids = new Set(targets.map((a) => a.id));
      setAutomations((prev) => prev.map((a) => ids.has(a.id) ? { ...a, enabled: false } : a));
      await fetchData();
    } catch { /* ignore */ }
    finally { setPausingAll(false); }
  }

  async function handleEnableAll() {
    const targets = hasSelection
      ? pausedAutomations.filter((a) => selectedIds.has(a.id))
      : pausedAutomations;
    if (targets.length === 0) return;

    setResumingAll(true);
    try {
      await Promise.all(
        targets.map((a) =>
          fetch("/api/clip-repurpose", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "toggle", automationId: a.id, enabled: true }),
          }),
        ),
      );
      const ids = new Set(targets.map((a) => a.id));
      setAutomations((prev) => prev.map((a) => ids.has(a.id) ? { ...a, enabled: true } : a));
      await fetchData();
    } catch { /* ignore */ }
    finally { setResumingAll(false); }
  }

  async function handleRunSelected() {
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
        const res = await fetch("/api/clip-repurpose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trigger", automationId: auto.id }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          failed.push(`${auto.name}: ${json.error || "Failed"}`);
        }
        await fetchData();
      } catch {
        failed.push(`${auto.name}: Network error`);
      }
      setTriggeringId(null);
    }

    setRunSelectedState({ running: false, current: targets.length, total: targets.length, currentName: "", failed });
    setTimeout(() => setRunSelectedState(null), failed.length > 0 ? 8000 : 3000);
  }

  async function handleRetryAllOrSelected() {
    const targets = hasSelection
      ? automationsWithFailedVideo.filter((a) => selectedIds.has(a.id))
      : automationsWithFailedVideo;
    if (targets.length === 0) return;

    const failed: string[] = [];
    setRetryAllState({ running: true, current: 0, total: targets.length, currentName: targets[0].name, failed });

    for (let i = 0; i < targets.length; i++) {
      const auto = targets[i];
      const videoId = auto.series?.lastVideo?.id;
      setRetryAllState((s) => s ? { ...s, current: i, currentName: auto.name } : s);
      setRetryingVideoId(videoId ?? null);
      if (videoId) {
        try {
          const res = await fetch(`/api/videos/${videoId}/retry`, { method: "POST" });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            failed.push(`${auto.name}: ${json.error || "Retry failed"}`);
          }
          await fetchData();
        } catch {
          failed.push(`${auto.name}: Network error`);
        }
      }
      setRetryingVideoId(null);
    }

    setRetryAllState({ running: false, current: targets.length, total: targets.length, currentName: "", failed });
    setTimeout(() => setRetryAllState(null), failed.length > 0 ? 8000 : 3000);
  }

  async function handleDeleteBulk() {
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
        const res = await fetch("/api/clip-repurpose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", automationId: auto.id }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          failed.push(`${auto.name}: ${json.error || "Failed"}`);
        }
      } catch {
        failed.push(`${auto.name}: Network error`);
      }
    }

    await fetchData();
    setSelectedIds(new Set());
    setDeleteAllState({ running: false, current: targets.length, total: targets.length, currentName: "", failed });
    setTimeout(() => setDeleteAllState(null), failed.length > 0 ? 8000 : 3000);
  }

  async function handleRetryVideo(videoId: string) {
    setRetryingVideoId(videoId);
    try {
      await fetch(`/api/videos/${videoId}/retry`, { method: "POST" });
      await fetchData();
    } catch { /* ignore */ }
    finally { setRetryingVideoId(null); }
  }

  async function handleRefreshInsights(automationId?: string) {
    if (automationId) setInsightsRefreshingId(automationId);
    else setInsightsRefreshing(true);
    try {
      const res = await fetch("/api/insights/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(automationId ? { automationId } : {}),
      });
      if (res.ok) {
        await fetchInsights();
        await fetchData();
      }
    } catch { /* ignore */ }
    finally {
      setInsightsRefreshing(false);
      setInsightsRefreshingId(null);
    }
  }

  /* ---- bulk op banner helper ---- */

  function renderBulkBanner(state: BulkOpState, verb: string, pastTense: string) {
    if (!state) return null;
    const cls = state.running
      ? "border-blue-200 bg-blue-50 text-blue-800"
      : state.failed.length > 0
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-green-200 bg-green-50 text-green-800";
    return (
      <div className={`mb-4 rounded-lg border p-4 text-sm ${cls}`}>
        {state.running ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>{verb} <strong>{state.currentName}</strong> ({state.current + 1} of {state.total})</span>
          </div>
        ) : state.failed.length > 0 ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{pastTense} {state.total - state.failed.length}/{state.total} automations</span>
            </div>
            {state.failed.map((msg, i) => (
              <p key={i} className="ml-6 text-xs opacity-80">{msg}</p>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>All {state.total} {pastTense.toLowerCase()} successfully</span>
          </div>
        )}
      </div>
    );
  }

  /* ---- render card ---- */

  function renderAutomationCard(auto: ClipAutomation) {
    const lv = auto.series?.lastVideo ?? null;
    const lvStatus = lv ? (STATUS_CFG[lv.status] ?? STATUS_CFG.QUEUED) : null;
    const platformMap = lv ? parsePlatformEntries(lv.postedPlatforms ?? []) : new Map<string, PlatformEntry>();
    const platforms = Array.isArray(auto.targetPlatforms) ? auto.targetPlatforms : [];
    const isEditing = editingId === auto.id;
    const isSelected = selectedIds.has(auto.id);

    return (
      <Card
        key={auto.id}
        className={`flex flex-col h-full overflow-hidden transition-colors hover:border-primary/50 ${
          !auto.enabled ? "opacity-60" : ""
        } ${isSelected ? "ring-2 ring-primary/40 border-primary/50" : ""}`}
      >
        <CardHeader className="pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.preventDefault(); toggleSelect(auto.id); }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              {isSelected
                ? <CheckSquare className="h-4 w-4 text-primary" />
                : <SquareIcon className="h-4 w-4" />
              }
            </button>
            <CardTitle className="text-base leading-snug line-clamp-2 flex-1 min-w-0">
              <Scissors className="h-4 w-4 text-blue-500 inline mr-1.5 align-text-bottom" />
              <Link href={`/dashboard/clip-repurpose/${auto.id}`} className="hover:underline underline-offset-2 hover:text-primary transition-colors">
                {auto.name}
              </Link>
            </CardTitle>
          </div>
          <div className="flex items-center gap-1.5 pt-1 flex-wrap">
            <button
              onClick={() => toggleEnabled(auto.id, !auto.enabled)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                auto.enabled
                  ? "bg-green-100 text-green-700 hover:bg-green-200"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {auto.enabled ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              {auto.enabled ? "Active" : "Paused"}
            </button>
            <button
              onClick={() => isEditing ? setEditingId(null) : startEditing(auto)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                isEditing
                  ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
            <button
              onClick={() => deleteAutomation(auto.id)}
              disabled={deletingId === auto.id}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-600 transition-colors"
            >
              {deletingId === auto.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Delete
            </button>
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-3 flex-1 flex flex-col min-h-0">
          {isEditing ? (
            <div className="space-y-2.5 rounded-lg border border-blue-200 bg-blue-50/30 p-3">
              <div>
                <Label className="text-[11px] font-medium text-muted-foreground">Name</Label>
                <Input className="h-7 text-xs mt-0.5" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px] font-medium text-muted-foreground">Niche</Label>
                  <select className="h-7 w-full rounded-md border text-xs px-1.5 mt-0.5 bg-background" value={editForm.clipNiche}
                    onChange={(e) => setEditForm((p) => ({ ...p, clipNiche: e.target.value }))}>
                    {Object.entries(CLIP_NICHES).map(([key, { label, icon }]) => (
                      <option key={key} value={key}>{icon} {label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-[11px] font-medium text-muted-foreground">Duration (s)</Label>
                  <Input className="h-7 text-xs mt-0.5" type="number" min={30} max={90} value={editForm.clipDurationSec}
                    onChange={(e) => setEditForm((p) => ({ ...p, clipDurationSec: Math.max(30, parseInt(e.target.value) || 45) }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px] font-medium text-muted-foreground">Post Time</Label>
                  <Input className="h-7 text-xs mt-0.5" type="time" value={editForm.postTime}
                    onChange={(e) => setEditForm((p) => ({ ...p, postTime: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-[11px] font-medium text-muted-foreground">Frequency</Label>
                  <select className="h-7 w-full rounded-md border text-xs px-1.5 mt-0.5 bg-background" value={editForm.frequency}
                    onChange={(e) => setEditForm((p) => ({ ...p, frequency: e.target.value }))}>
                    <option value="daily">Daily</option>
                    <option value="every_other_day">Every other day</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
              </div>
              <div>
                <Label className="text-[11px] font-medium text-muted-foreground">Platforms</Label>
                <div className="flex gap-1 mt-0.5 flex-wrap">
                  {Object.entries(PLATFORM_CFG).map(([key, cfg]) => {
                    const Icon = cfg.icon;
                    const sel = editForm.targetPlatforms.has(key);
                    return (
                      <button key={key} onClick={() => toggleEditPlatform(key)}
                        className={`flex items-center gap-0.5 px-1.5 py-1 rounded text-[10px] border transition-all ${
                          sel ? "border-blue-500 bg-blue-500/10 text-blue-600 font-medium" : "border-zinc-200 text-muted-foreground hover:border-zinc-400"
                        }`}>
                        <Icon className={`h-3 w-3 ${sel ? cfg.color : ""}`} />{cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className="text-[11px] font-medium text-muted-foreground">Crop</Label>
                <div className="flex gap-1.5 mt-0.5">
                  {(["blur-bg", "center-crop"] as const).map((m) => (
                    <button key={m} onClick={() => setEditForm((p) => ({ ...p, cropMode: m }))}
                      className={`px-2 py-1 rounded text-[10px] border transition-all ${
                        editForm.cropMode === m ? "border-blue-500 bg-blue-500/10 text-blue-600 font-medium" : "border-zinc-200 hover:border-zinc-400"
                      }`}>
                      {m === "blur-bg" ? "Blur BG" : "Center Crop"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5 pt-0.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-medium text-muted-foreground">Skip same-platform posting</Label>
                  <Switch size="sm" checked={editForm.crossPlatformOnly}
                    onCheckedChange={(v) => setEditForm((p) => ({ ...p, crossPlatformOnly: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-medium text-muted-foreground">Background music overlay</Label>
                  <Switch size="sm" checked={editForm.enableBgm}
                    onCheckedChange={(v) => setEditForm((p) => ({ ...p, enableBgm: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-medium text-muted-foreground">Horizontal flip (mirror)</Label>
                  <Switch size="sm" checked={editForm.enableHflip}
                    onCheckedChange={(v) => setEditForm((p) => ({ ...p, enableHflip: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-medium text-muted-foreground">Include AI tags</Label>
                  <Switch size="sm" checked={editForm.includeAiTags}
                    onCheckedChange={(v) => setEditForm((p) => ({ ...p, includeAiTags: v }))} />
                </div>
              </div>
              <div className="flex gap-2 pt-0.5">
                <Button size="sm" className="h-7 text-xs" onClick={saveEdit} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                  Save
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
          <>
          <div className="shrink-0 space-y-2 min-h-[140px]">
            <div className="flex items-center gap-2 flex-wrap">
              {auto.clipConfig && (
                <>
                  <Badge variant="outline" className="text-xs">{auto.clipConfig.clipDurationSec}s</Badge>
                  <Badge variant="outline" className="text-xs">{auto.clipConfig.cropMode}</Badge>
                </>
              )}
              {auto.clipConfig?.clipNiche && CLIP_NICHES[auto.clipConfig.clipNiche] ? (
                <Badge variant="outline" className="text-xs max-w-full truncate">
                  {CLIP_NICHES[auto.clipConfig.clipNiche].icon} {CLIP_NICHES[auto.clipConfig.clipNiche].label}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  <TrendingUp className="h-2.5 w-2.5 mr-0.5" /> Auto-discover
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span className="truncate">{FREQ_LABEL[auto.frequency] ?? auto.frequency} at {auto.postTime}</span>
              <span className="text-muted-foreground/60 shrink-0">·</span>
              <Link href={`/dashboard/clip-repurpose/${auto.id}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
                <Film className="h-3 w-3 shrink-0" />
                <span className="underline underline-offset-2">{auto.series?._count.videos ?? 0} clips</span>
              </Link>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {platforms.map((p) => {
                const cfg = PLATFORM_CFG[p];
                if (!cfg) return null;
                const Icon = cfg.icon;
                return (
                  <span key={p} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Icon className={`h-3 w-3 ${cfg.color}`} />{cfg.label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Last video status */}
          <div className="flex-1 flex flex-col justify-center min-h-[80px]">
            {lv && lvStatus ? (
              <Link href={`/dashboard/videos/${lv.id}`} className="block">
                <div className="rounded-lg border p-2.5 space-y-2 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium truncate flex-1 min-w-0">
                      {lv.title || "Processing..."}
                    </p>
                    <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${lvStatus.className}`}>
                      <lvStatus.icon className={`h-2.5 w-2.5 ${lv.status === "GENERATING" ? "animate-spin" : ""}`} />
                      {lvStatus.label}
                    </div>
                  </div>

                  {lv.sourceMetadata && (
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap overflow-hidden max-h-[2.5rem]">
                      {lv.sourceMetadata.channelName && (
                        <span className="truncate max-w-[5rem]">from {lv.sourceMetadata.channelName}</span>
                      )}
                      {lv.sourceMetadata.viewCount ? (
                        <span className="flex items-center gap-0.5 shrink-0">
                          <Eye className="w-2.5 h-2.5" />
                          {lv.sourceMetadata.viewCount >= 1_000_000
                            ? `${(lv.sourceMetadata.viewCount / 1_000_000).toFixed(1)}M`
                            : `${(lv.sourceMetadata.viewCount / 1_000).toFixed(0)}K`}
                        </span>
                      ) : null}
                      {lv.sourceMetadata.peakSegment && (
                        <span className="flex items-center gap-0.5 shrink-0">
                          <TrendingUp className="w-2.5 h-2.5" />
                          {(lv.sourceMetadata.peakSegment.avgHeat * 100).toFixed(0)}%
                        </span>
                      )}
                      {lv.sourceMetadata.platform && (
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1 truncate max-w-[5rem]">
                          {lv.sourceMetadata.platform}
                        </Badge>
                      )}
                    </div>
                  )}

                  <div className="text-[10px] text-muted-foreground">
                    {timeAgo(lv.createdAt)}
                    {lv.duration ? ` · ${lv.duration}s` : ""}
                    {lv.sourceUrl && (
                      <button
                        type="button"
                        className="ml-2 text-blue-500 hover:underline inline-flex items-center gap-0.5"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(lv.sourceUrl!, "_blank"); }}
                      >
                        <ExternalLink className="w-2.5 h-2.5" /> Original
                      </button>
                    )}
                  </div>

                  {lv.errorMessage && lv.status === "FAILED" && (
                    <p className="text-[10px] text-red-500 truncate">{lv.errorMessage}</p>
                  )}

                  {platforms.length > 0 && (
                    <div className="space-y-1">
                      {platforms.map((p) => {
                        const cfg = PLATFORM_CFG[p];
                        if (!cfg) return null;
                        const Icon = cfg.icon;
                        const entry = platformMap.get(p);
                        const isSuccess = entry?.success === true;
                        const isUploading = entry?.success === "uploading";
                        const isScheduled = entry?.success === "scheduled";
                        const isDeleted = entry?.success === "deleted";
                        const isFail = entry?.success === false;
                        const isVideoFailed = lv.status === "FAILED";
                        const isGenerating = lv.status === "GENERATING" || lv.status === "QUEUED";

                        let statusEl: React.ReactNode;
                        let rowClass = "";

                        if (isSuccess) {
                          rowClass = "bg-green-50 border-green-200";
                          statusEl = <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3 w-3" />Posted</span>;
                        } else if (isUploading) {
                          rowClass = "bg-blue-50 border-blue-200";
                          statusEl = <span className="flex items-center gap-1 text-blue-600"><Loader2 className="h-3 w-3 animate-spin" />Uploading</span>;
                        } else if (isScheduled) {
                          rowClass = "bg-blue-50/80 border-blue-200";
                          statusEl = <span className="flex items-center gap-1 text-blue-600"><CalendarClock className="h-3 w-3" />Scheduled</span>;
                        } else if (isDeleted) {
                          rowClass = "bg-zinc-50 border-zinc-200";
                          statusEl = <span className="flex items-center gap-1 text-zinc-400 line-through"><Trash2 className="h-3 w-3" />Deleted</span>;
                        } else if (isFail) {
                          rowClass = "bg-red-50 border-red-200";
                          statusEl = <span className="flex items-center gap-1 text-red-600"><XCircle className="h-3 w-3" />Failed</span>;
                        } else if (isVideoFailed) {
                          rowClass = "bg-red-50/50 border-red-100";
                          statusEl = <span className="flex items-center gap-1 text-red-500"><XCircle className="h-3 w-3" />Video failed</span>;
                        } else if (isGenerating) {
                          rowClass = "bg-muted/40";
                          statusEl = <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Building</span>;
                        } else if (!entry && lv.status === "READY") {
                          rowClass = "bg-green-50/30 border-green-100";
                          statusEl = <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3" />Ready</span>;
                        } else {
                          rowClass = "bg-amber-50/50 border-amber-100";
                          statusEl = <span className="flex items-center gap-1 text-amber-600"><Clock className="h-3 w-3" />Pending</span>;
                        }

                        return (
                          <div key={p} className={`flex items-center justify-between rounded border px-2 py-1 text-[10px] font-medium overflow-hidden ${rowClass}`}>
                            <span className="flex items-center gap-1.5 shrink-0">
                              <Icon className={`h-3 w-3 ${cfg.color}`} />
                              {cfg.label}
                            </span>
                            <span className="shrink-0">{statusEl}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed p-3 flex flex-col items-center justify-center text-center">
                <Scissors className="h-5 w-5 text-muted-foreground/40 mb-1" />
                <p className="text-xs text-muted-foreground">No clips yet</p>
              </div>
            )}
          </div>

          {/* Insights */}
          <div className="mt-2 pt-2 border-t border-border/60 h-[88px] flex flex-col shrink-0">
            <div className="flex items-center justify-between gap-1 shrink-0">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <BarChart2 className="h-3 w-3" /> Insights
              </span>
              <div className="flex items-center gap-1">
                {insightsLoading ? (
                  <span className="text-xs text-muted-foreground/80">Loading...</span>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground/80">
                      {(() => {
                        const agg = insightsData?.byAutomation?.[auto.id];
                        const lastRef = agg?.lastRefreshedAt ?? insightsData?.lastRefreshedAt;
                        return lastRef ? timeAgo(lastRef) : insightsData ? "Not refreshed" : "Refresh to load";
                      })()}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRefreshInsights(auto.id); }}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title="Refresh insights"
                      disabled={!!insightsRefreshingId}
                    >
                      {insightsRefreshingId === auto.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs mt-1.5">
              {insightsLoading ? (
                <span className="col-span-2 text-muted-foreground/60">Loading...</span>
              ) : (() => {
                const agg = insightsData?.byAutomation?.[auto.id];
                const views = agg?.totalViews ?? 0;
                const interactions = agg?.totalInteractions ?? 0;
                return (
                  <>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Eye className="h-3 w-3" />
                      {formatNumber(views)} views
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Heart className="h-3 w-3" />
                      {formatNumber(interactions)} interactions
                    </span>
                    {(agg?.videoCount != null && agg.videoCount >= 1) ? (
                      <span className="flex items-center gap-1 text-muted-foreground/80 col-span-2 text-[10px]">
                        Avg: {formatNumber(agg?.avgViews ?? 0)} views · {formatNumber(agg?.avgInteractions ?? 0)} interactions per video
                      </span>
                    ) : null}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex items-center gap-1.5 pt-1 mt-auto shrink-0">
            {lv?.status === "FAILED" && (
              <Button
                size="sm"
                variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50"
                disabled={retryingVideoId === lv.id}
                onClick={(e) => { e.preventDefault(); handleRetryVideo(lv.id); }}
              >
                {retryingVideoId === lv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Retry
              </Button>
            )}
            {lv && (lv.status === "GENERATING" || lv.status === "QUEUED") && (
              <Button
                size="sm"
                variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50"
                onClick={async (e) => {
                  e.preventDefault();
                  await fetch("/api/clip-repurpose", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "stop", automationId: auto.id }),
                  });
                  await fetchData();
                }}
              >
                <StopCircle className="h-3 w-3 mr-1" /> Stop
              </Button>
            )}
            <Button
              size="sm"
              className="flex-1"
              onClick={() => triggerClip(auto.id)}
              disabled={triggeringId === auto.id}
            >
              {triggeringId === auto.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <Zap className="w-3.5 h-3.5 mr-1" />
              )}
              Generate Clip
            </Button>
          </div>
          </>
          )}
        </CardContent>
      </Card>
    );
  }

  /* ---- page layout ---- */

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scissors className="w-6 h-6 text-blue-500" />
            Viral Clips Automations
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Find trending 500K+ view videos, extract peak moments, convert to 9:16 reels
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!insightsLoading && insightsData && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BarChart2 className="h-3.5 w-3.5" />
              <span>
                Insights {insightsData.lastRefreshedAt
                  ? `· ${timeAgo(insightsData.lastRefreshedAt)}`
                  : "· Not refreshed yet"}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={insightsRefreshing}
                onClick={() => handleRefreshInsights()}
              >
                {insightsRefreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Refresh all
              </Button>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="w-4 h-4 mr-1" /> New Automation
          </Button>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Create Clip Automation</CardTitle>
            <p className="text-sm text-muted-foreground">
              Pick a niche and the app will automatically find trending, non-copyrighted videos
              from YouTube, Facebook, and more — then clip the best moments as reels.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Content Niche</Label>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 mt-2">
                {Object.entries(CLIP_NICHES).map(([key, { label, icon }]) => (
                  <button
                    key={key}
                    onClick={() => setFormNiche(key)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-all text-left ${
                      formNiche === key
                        ? "border-blue-500 bg-blue-500/10 text-blue-600 ring-1 ring-blue-500/30"
                        : "border-zinc-200 dark:border-zinc-700 text-muted-foreground hover:border-zinc-400"
                    }`}
                  >
                    <span className="text-sm">{icon}</span>
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Name</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="My Viral Clips" />
              </div>
              <div>
                <Label>Clip Duration (seconds)</Label>
                <Input type="number" min={30} max={90} value={formDuration} onChange={(e) => setFormDuration(Math.max(30, parseInt(e.target.value) || 45))} />
              </div>
            </div>

            <div>
              <Label>Post to Platforms</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {Object.entries(PLATFORM_CFG).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  const selected = formPlatforms.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => togglePlatform(key)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${
                        selected
                          ? "border-blue-500 bg-blue-500/10 text-blue-600"
                          : "border-zinc-200 dark:border-zinc-700 text-muted-foreground hover:border-zinc-400"
                      }`}
                    >
                      <Icon className={`h-3.5 w-3.5 ${selected ? cfg.color : ""}`} />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>Crop Mode</Label>
              <div className="flex gap-3 mt-1">
                {(["blur-bg", "center-crop"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setFormCropMode(mode)}
                    className={`px-4 py-2 rounded-lg text-sm border transition-all ${
                      formCropMode === mode
                        ? "border-blue-500 bg-blue-500/10 text-blue-600"
                        : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"
                    }`}
                  >
                    {mode === "blur-bg" ? "Blur Background (9:16)" : "Center Crop (9:16)"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Skip same-platform posting</Label>
                  <p className="text-xs text-muted-foreground">Avoid copyright by not re-posting to the source platform</p>
                </div>
                <Switch checked={formCrossPlatformOnly} onCheckedChange={setFormCrossPlatformOnly} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Background music overlay</Label>
                  <p className="text-xs text-muted-foreground">Mix royalty-free BGM underneath to further break audio fingerprints</p>
                </div>
                <Switch checked={formEnableBgm} onCheckedChange={setFormEnableBgm} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Horizontal flip (mirror)</Label>
                  <p className="text-xs text-muted-foreground">Mirror the video horizontally — flips text and logos, rarely needed</p>
                </div>
                <Switch checked={formEnableHflip} onCheckedChange={setFormEnableHflip} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Include AI tags</Label>
                  <p className="text-xs text-muted-foreground">Add AI-generated hashtags and SEO tags to posts</p>
                </div>
                <Switch checked={formIncludeAiTags} onCheckedChange={setFormIncludeAiTags} />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={createAutomation} disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                Create
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {automations.length === 0 && !showCreate && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Scissors className="w-12 h-12 text-zinc-300 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No clip automations yet</h3>
            <p className="text-sm text-zinc-500 mb-4 max-w-md">
              Auto-discover trending videos from YouTube, Facebook Reels, and 25+ viral channels.
              Extract peak moments and post as 9:16 shorts/reels.
            </p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" /> Create First Automation
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Action toolbar */}
      {sortedAutomations.length > 0 && (
        <>
        <div className="flex items-center gap-2 flex-wrap rounded-lg border bg-muted/30 p-3">
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

          <Button
            variant="outline" size="sm"
            className="border-red-300 text-red-600 hover:bg-red-50"
            disabled={isBusy || stopCount === 0}
            onClick={handleStopAll}
          >
            {stopAllState?.running ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Stopping {stopAllState.current + 1}/{stopAllState.total}</>
            ) : (
              <><StopCircle className="mr-1.5 h-3.5 w-3.5" />Stop {selLabel}{stopCount > 0 ? ` (${stopCount})` : ""}</>
            )}
          </Button>

          <Button
            variant="outline" size="sm"
            className="border-muted-foreground/30 text-muted-foreground hover:bg-muted"
            disabled={isBusy || disableCount === 0}
            onClick={handleDisableAll}
          >
            {pausingAll ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Disabling...</>
            ) : (
              <><Pause className="mr-1.5 h-3.5 w-3.5" />Disable {selLabel}{disableCount > 0 ? ` (${disableCount})` : ""}</>
            )}
          </Button>

          <Button
            variant="outline" size="sm"
            className="border-green-300 text-green-600 hover:bg-green-50"
            disabled={isBusy || enableCount === 0}
            onClick={handleEnableAll}
          >
            {resumingAll ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Enabling...</>
            ) : (
              <><Play className="mr-1.5 h-3.5 w-3.5" />Enable {selLabel}{enableCount > 0 ? ` (${enableCount})` : ""}</>
            )}
          </Button>

          <Button
            variant="outline" size="sm"
            className="border-blue-300 text-blue-600 hover:bg-blue-50"
            disabled={isBusy || runCount === 0}
            onClick={handleRunSelected}
          >
            {runSelectedState?.running ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Running {runSelectedState.current + 1}/{runSelectedState.total}</>
            ) : (
              <><Play className="mr-1.5 h-3.5 w-3.5" />Run {selLabel}{runCount > 0 ? ` (${runCount})` : ""}</>
            )}
          </Button>

          <Button
            variant="outline" size="sm"
            className="border-amber-300 text-amber-700 hover:bg-amber-100"
            disabled={isBusy || retryCount === 0}
            onClick={handleRetryAllOrSelected}
          >
            {retryAllState?.running ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Retrying {retryAllState.current + 1}/{retryAllState.total}</>
            ) : (
              <><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry {selLabel}{retryCount > 0 ? ` (${retryCount})` : ""}</>
            )}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline" size="sm"
                className="border-red-300 text-red-600 hover:bg-red-50"
                disabled={isBusy || deleteCount === 0}
              >
                {deleteAllState?.running ? (
                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Deleting {deleteAllState.current + 1}/{deleteAllState.total}</>
                ) : (
                  <><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete {selLabel}{deleteCount > 0 ? ` (${deleteCount})` : ""}</>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {selLabel.toLowerCase()} automations?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete {deleteCount} automation{deleteCount === 1 ? "" : "s"} and all their generated clips.
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

        {/* Bulk operation banners */}
        {renderBulkBanner(stopAllState, "Stopping", "Stopped")}
        {renderBulkBanner(runSelectedState, "Running", "Ran")}
        {renderBulkBanner(retryAllState, "Retrying", "Retried")}
        {renderBulkBanner(deleteAllState, "Deleting", "Deleted")}

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, video title, channel, URL..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border bg-background pl-10 pr-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/60"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
        </>
      )}

      {/* Filtered empty */}
      {sortedAutomations.length > 0 && filteredAutomations.length === 0 && (
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Search className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">No automations match &quot;{searchQuery}&quot;</p>
        </div>
      )}

      {/* Active / Paused sections */}
      {filteredAutomations.length > 0 && (
        <div className="space-y-6">
          {/* Active section */}
          {activeFiltered.length > 0 && (
            <div>
              <button
                onClick={() => setActiveCollapsed(!activeCollapsed)}
                className="w-full flex items-center gap-2 mb-4 group cursor-pointer"
              >
                {activeCollapsed
                  ? <ChevronRight className="h-4 w-4 text-green-500 transition-transform" />
                  : <ChevronDown className="h-4 w-4 text-green-500 transition-transform" />
                }
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <h2 className="text-sm font-semibold text-foreground">Active</h2>
                <span className="text-xs text-muted-foreground">({activeFiltered.length})</span>

                {Object.keys(platformDailyClips).length > 0 && (
                  <div className="flex items-center gap-2.5 ml-2 text-[10px]">
                    <span className="text-muted-foreground/60">·</span>
                    {Object.entries(platformDailyClips)
                      .sort(([, a], [, b]) => b - a)
                      .map(([platform, count]) => {
                        const cfg = PLATFORM_CFG[platform];
                        if (!cfg) return null;
                        const Icon = cfg.icon;
                        const display = Number.isInteger(count) ? String(count) : count.toFixed(1);
                        return (
                          <span key={platform} className="inline-flex items-center gap-0.5 text-muted-foreground" title={`${display} clips/day to ${cfg.label}`}>
                            <Icon className={`h-3 w-3 ${cfg.color}`} />
                            <span className="font-medium">{display}/day</span>
                          </span>
                        );
                      })}
                    <span className="text-muted-foreground/60">·</span>
                    <span className="text-muted-foreground/70 font-medium">
                      {Number.isInteger(uniqueDailyClips) ? uniqueDailyClips : uniqueDailyClips.toFixed(1)} clips/day
                    </span>
                  </div>
                )}

                <div className="flex-1 h-px bg-border" />
              </button>
              {!activeCollapsed && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeFiltered.map((auto) => renderAutomationCard(auto))}
                </div>
              )}
            </div>
          )}

          {/* Paused section */}
          {pausedFiltered.length > 0 && (
            <div>
              <button
                onClick={() => setPausedCollapsed(!pausedCollapsed)}
                className="w-full flex items-center gap-2 mb-4 group cursor-pointer"
              >
                {pausedCollapsed
                  ? <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform" />
                  : <ChevronDown className="h-4 w-4 text-muted-foreground/40 transition-transform" />
                }
                <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                <h2 className="text-sm font-semibold text-muted-foreground">Paused</h2>
                <span className="text-xs text-muted-foreground">({pausedFiltered.length})</span>
                <div className="flex-1 h-px bg-border" />
              </button>
              {!pausedCollapsed && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pausedFiltered.map((auto) => renderAutomationCard(auto))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recent Clips Section */}
      {automations.some((a) => a.series && a.series.videos.length > 1) && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Film className="w-5 h-5" /> Recent Clips
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {automations.flatMap((a) =>
              (a.series?.videos ?? []).map((v) => ({ ...v, autoName: a.name })),
            )
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 10)
            .map((v) => (
              <Link key={v.id} href={`/dashboard/videos/${v.id}`}>
                <div className="rounded-lg border overflow-hidden hover:border-primary/50 transition-colors group">
                  {v.videoUrl && v.status === "READY" ? (
                    <video
                      src={v.videoUrl}
                      className="w-full aspect-[9/16] object-cover bg-black"
                      muted
                      playsInline
                      onMouseEnter={(e) => { (e.target as HTMLVideoElement).play().catch(() => {}); }}
                      onMouseLeave={(e) => {
                        const el = e.target as HTMLVideoElement;
                        el.pause();
                        el.currentTime = 0;
                      }}
                    />
                  ) : (
                    <div className="w-full aspect-[9/16] bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                      {v.status === "GENERATING" || v.status === "QUEUED" ? (
                        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                      ) : v.status === "FAILED" ? (
                        <AlertCircle className="w-6 h-6 text-red-400" />
                      ) : (
                        <Scissors className="w-6 h-6 text-zinc-300" />
                      )}
                    </div>
                  )}
                  <div className="p-2 space-y-1">
                    <p className="text-xs font-medium truncate">{v.title ?? "Processing..."}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">{timeAgo(v.createdAt)}</span>
                      <div className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${(STATUS_CFG[v.status] ?? STATUS_CFG.QUEUED).className}`}>
                        {(STATUS_CFG[v.status] ?? STATUS_CFG.QUEUED).label}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
