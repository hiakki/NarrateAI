"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Mic,
  ImageIcon,
  Clapperboard,
  Upload,
  Clock,
  XCircle,
  Film,
  Trash2,
  Instagram,
  Youtube,
  Facebook,
  Share2,
  Smartphone,
  Send,
  RefreshCw,
  Check,
  Play,
  SquareCheck,
  Square,
  Link2,
  Pencil,
  X,
  BarChart2,
  Eye,
  Heart,
  Search,
  TrendingUp,
  Scissors,
  Sparkles,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatPlatformError } from "@/lib/format-platform-error";

const BASE_STAGES = [
  { key: "SCRIPT", label: "Script", detail: "AI is writing your narration", icon: FileText },
  { key: "TTS", label: "Voiceover", detail: "Generating AI voiceover", icon: Mic },
  { key: "IMAGES", label: "Images", detail: "Creating scene visuals", icon: ImageIcon },
  { key: "ASSEMBLY", label: "Assembly", detail: "Building video with Ken Burns + captions + music", icon: Clapperboard },
  { key: "UPLOADING", label: "Finalize", detail: "Saving your video", icon: Upload },
];

const CLIP_REPURPOSE_STAGES = [
  { key: "DISCOVER", label: "Discovery", detail: "Finding viral no-copyright video from trending sources", icon: Search },
  { key: "HEATMAP", label: "Heatmap", detail: "Analyzing most-replayed sections for peak engagement", icon: TrendingUp },
  { key: "CLIPPING", label: "Clipping", detail: "Extracting peak segment with pre/post context, converting to 9:16", icon: Scissors },
  { key: "ENHANCE", label: "Enhancing", detail: "Adding subtitles, blur background, hook text overlay", icon: Sparkles },
  { key: "FINALIZE", label: "Finalize", detail: "Generating title, saving final clip", icon: Upload },
];

const I2V_STAGE = { key: "I2V", label: "Image-to-Video", detail: "Animating scene images into video clips", icon: Film };

function buildStages(hasI2V: boolean, isClipRepurpose: boolean) {
  if (isClipRepurpose) return CLIP_REPURPOSE_STAGES;
  if (!hasI2V) return BASE_STAGES;
  const idx = BASE_STAGES.findIndex((s) => s.key === "ASSEMBLY");
  const copy = [...BASE_STAGES];
  copy.splice(idx, 0, I2V_STAGE);
  return copy;
}

type StageTimings = Record<string, { startedAt: number; completedAt: number; durationMs: number }>;

function formatStageDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${min}m ${s}s` : `${min}m`;
}

function getStageTimingLabel(
  timings: StageTimings | null | undefined,
  stageKey: string,
  currentStageKey: string | null,
  isDone: boolean,
  isFailedStep: boolean,
): string | null {
  if (!timings?.[stageKey]) return null;
  const t = timings[stageKey];
  if (t.durationMs > 0) return formatStageDuration(t.durationMs);
  if (t.startedAt && (stageKey === currentStageKey || isFailedStep))
    return `— (${formatStageDuration(Date.now() - t.startedAt)} so far)`;
  return null;
}

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancellingPlatforms, setCancellingPlatforms] = useState<Set<string>>(new Set());
  const [deletingPlatforms, setDeletingPlatforms] = useState<Set<string>>(new Set());
  const [publishingPlatforms, setPublishingPlatforms] = useState<Set<string>>(new Set());
  const [publishResults, setPublishResults] = useState<
    { platform: string; success: boolean; postId?: string; error?: string }[] | null
  >(null);
  const [failedPublishes, setFailedPublishes] = useState<Map<string, string>>(new Map());
  const [connectedAccounts, setConnectedAccounts] = useState<
    { platform: string; username: string | null }[]
  >([]);

  const publishKeyRef = useRef(`narrate-pub-${id}`);
  publishKeyRef.current = `narrate-pub-${id}`;
  const failKeyRef = useRef(`narrate-pub-fail-${id}`);
  failKeyRef.current = `narrate-pub-fail-${id}`;

  const PUBLISH_STALE_MS = 3 * 60 * 1000;

  function syncPublishStorage(set: Set<string>) {
    if (set.size > 0) {
      const entry = { platforms: [...set], ts: Date.now() };
      sessionStorage.setItem(publishKeyRef.current, JSON.stringify(entry));
    } else {
      sessionStorage.removeItem(publishKeyRef.current);
    }
  }

  function markPublishing(...platforms: string[]) {
    setPublishingPlatforms((prev) => {
      const next = new Set(prev);
      platforms.forEach((p) => next.add(p));
      syncPublishStorage(next);
      return next;
    });
  }

  function unmarkPublishing(...platforms: string[]) {
    setPublishingPlatforms((prev) => {
      const next = new Set(prev);
      platforms.forEach((p) => next.delete(p));
      syncPublishStorage(next);
      return next;
    });
  }

  function syncFailStorage(map: Map<string, string>) {
    if (map.size > 0) {
      sessionStorage.setItem(failKeyRef.current, JSON.stringify(Object.fromEntries(map)));
    } else {
      sessionStorage.removeItem(failKeyRef.current);
    }
  }

  function recordFailure(platform: string, error: string) {
    setFailedPublishes((prev) => {
      const next = new Map(prev);
      next.set(platform, error);
      syncFailStorage(next);
      return next;
    });
  }

  function clearFailure(...platforms: string[]) {
    setFailedPublishes((prev) => {
      const next = new Map(prev);
      platforms.forEach((p) => next.delete(p));
      syncFailStorage(next);
      return next;
    });
  }

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(publishKeyRef.current);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          // Legacy format (plain array) — treat as stale, clear it
          sessionStorage.removeItem(publishKeyRef.current);
        } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.platforms)) {
          const age = Date.now() - (parsed.ts ?? 0);
          if (age > PUBLISH_STALE_MS) {
            sessionStorage.removeItem(publishKeyRef.current);
          } else if (parsed.platforms.length > 0) {
            setPublishingPlatforms(new Set(parsed.platforms));
          }
        }
      }
    } catch {
      sessionStorage.removeItem(publishKeyRef.current);
    }
    try {
      const stored = sessionStorage.getItem(failKeyRef.current);
      if (stored) {
        const obj = JSON.parse(stored);
        if (obj && typeof obj === "object") setFailedPublishes(new Map(Object.entries(obj)));
      }
    } catch { /* corrupt data */ }
  }, [id]);

  const [resettingPlatforms, setResettingPlatforms] = useState<Set<string>>(new Set());

  const [selectedImages, setSelectedImages] = useState<Set<number>>(new Set());
  const [editingPrompt, setEditingPrompt] = useState<number | null>(null);
  const [editPromptText, setEditPromptText] = useState("");
  const [regenerating, setRegenerating] = useState<number | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [reviewInited, setReviewInited] = useState(false);

  const [editingLink, setEditingLink] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [insightsRefreshing, setInsightsRefreshing] = useState(false);
  const [rerunStep, setRerunStep] = useState<"TTS" | "IMAGES" | "I2V" | null>(null);
  const [rerunImageProvider, setRerunImageProvider] = useState<string>("LOCAL_BACKEND");
  const [rerunTtsProvider, setRerunTtsProvider] = useState<string>("EDGE_TTS");
  const [rerunI2VProvider, setRerunI2VProvider] = useState<string>("LOCAL_BACKEND");

  async function handleSaveLink(platform: string) {
    const url = linkInput.trim();
    if (!url) { setLinkError("Please paste a URL"); return; }
    setSavingLink(true);
    setLinkError("");
    try {
      const res = await fetch(`/api/videos/${id}/update-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLinkError(data.error || "Failed to save link");
        return;
      }
      setEditingLink(null);
      setLinkInput("");
      queryClient.invalidateQueries({ queryKey: ["video", id] });
    } catch {
      setLinkError("Network error. Please try again.");
    } finally {
      setSavingLink(false);
    }
  }

  async function handleResetPosted(platforms?: string[]) {
    const keys = platforms ?? ["YOUTUBE", "INSTAGRAM", "FACEBOOK", "SHARECHAT", "MOJ"];
    clearFailure(...keys);
    setResettingPlatforms((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
    try {
      const res = await fetch(`/api/videos/${id}/reset-posted`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(platforms ? { platforms } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Reset failed");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["video", id] });
    } catch {
      alert("Reset failed");
    } finally {
      setResettingPlatforms((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Delete failed");
        return;
      }
      router.back();
    } catch {
      alert("Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/videos/${id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Retry failed");
        return;
      }
      await queryClient.refetchQueries({ queryKey: ["video", id] });
    } catch {
      alert("Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    fetch("/api/social/accounts")
      .then((r) => r.json())
      .then((j) => {
        if (j.data) setConnectedAccounts(j.data.map((a: { platform: string; username: string | null }) => ({ platform: a.platform, username: a.username })));
      })
      .catch(() => {});
  }, []);

  async function handlePublishPlatform(platform: string, immediate = false) {
    markPublishing(platform);
    clearFailure(platform);
    setPublishResults(null);
    try {
      const res = await fetch(`/api/videos/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: [platform], ...(immediate ? { immediate: true } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = json.error || "Publishing failed";
        setPublishResults([{ platform, success: false, error: err }]);
        recordFailure(platform, err);
        unmarkPublishing(platform);
        return;
      }
      setPublishResults(json.data);
      const results = (json.data ?? []) as { platform: string; success: boolean; error?: string }[];
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        failed.forEach((r) => recordFailure(r.platform, r.error || "Publishing failed"));
        unmarkPublishing(...failed.map((r) => r.platform));
      }
      const succeeded = results.filter((r) => r.success).map((r) => r.platform);
      if (succeeded.length > 0) clearFailure(...succeeded);
      queryClient.invalidateQueries({ queryKey: ["video", id] });
    } catch {
      setPublishResults([{ platform, success: false, error: "Network error" }]);
      recordFailure(platform, "Network error");
      unmarkPublishing(platform);
    }
  }

  async function handlePublishAll(platforms: string[], immediate = false) {
    markPublishing(...platforms);
    clearFailure(...platforms);
    setPublishResults(null);
    try {
      const res = await fetch(`/api/videos/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms, ...(immediate ? { immediate: true } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = json.error || "Publishing failed";
        setPublishResults([{ platform: "ALL", success: false, error: err }]);
        platforms.forEach((p) => recordFailure(p, err));
        unmarkPublishing(...platforms);
        return;
      }
      setPublishResults(json.data);
      const results = (json.data ?? []) as { platform: string; success: boolean; error?: string }[];
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        failed.forEach((r) => recordFailure(r.platform, r.error || "Publishing failed"));
        unmarkPublishing(...failed.map((r) => r.platform));
      }
      const succeeded = results.filter((r) => r.success).map((r) => r.platform);
      if (succeeded.length > 0) clearFailure(...succeeded);
      queryClient.invalidateQueries({ queryKey: ["video", id] });
    } catch {
      setPublishResults([{ platform: "ALL", success: false, error: "Network error" }]);
      platforms.forEach((p) => recordFailure(p, "Network error"));
      unmarkPublishing(...platforms);
    }
  }

  async function handleCancelSchedule(platforms?: string[]) {
    const keys = platforms ?? [];
    const label = keys.length > 0 ? keys.join(", ") : "all platforms";
    if (!confirm(`Cancel scheduled post on ${label}? This will delete content from the platform if already uploaded.`)) return;
    setCancellingPlatforms((prev) => {
      const next = new Set(prev);
      (keys.length > 0 ? keys : ["__all__"]).forEach((k) => next.add(k));
      return next;
    });
    try {
      const res = await fetch(`/api/videos/${id}/cancel-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keys.length > 0 ? { platforms: keys } : {}),
      });
      const data = await res.json().catch(() => ({}));
      queryClient.invalidateQueries({ queryKey: ["video", id] });
      if (!res.ok) {
        alert(data.error || `Failed to cancel ${label}`);
      } else if (data.results) {
        const failed = (data.results as { platform: string; success: boolean; error?: string }[]).filter((r) => !r.success);
        if (failed.length > 0) {
          console.warn("Platform cleanup partial failures:", failed);
        }
      }
    } catch {
      alert(`Network error cancelling ${label}`);
    } finally {
      setCancellingPlatforms(new Set());
    }
  }

  async function handleDeleteFromPlatform(platforms?: string[]) {
    const keys = platforms ?? [];
    const label = keys.length > 0 ? keys.join(", ") : "all platforms";
    if (!confirm(`Delete this video from ${label}? This cannot be undone.`)) return;
    setDeletingPlatforms((prev) => {
      const next = new Set(prev);
      (keys.length > 0 ? keys : ["__all__"]).forEach((k) => next.add(k));
      return next;
    });
    try {
      const res = await fetch(`/api/videos/${id}/delete-from-platform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keys.length > 0 ? { platforms: keys } : {}),
      });
      const data = await res.json().catch(() => ({}));
      queryClient.invalidateQueries({ queryKey: ["video", id] });
      if (!res.ok) {
        alert(data.error || `Failed to delete from ${label}`);
      } else if (data.results) {
        const failed = (data.results as { platform: string; success: boolean; error?: string }[]).filter((r) => !r.success);
        if (failed.length > 0) {
          console.warn("Platform delete partial failures:", failed);
        }
      }
    } catch {
      alert(`Network error deleting from ${label}`);
    } finally {
      setDeletingPlatforms(new Set());
    }
  }

  const handleRegenerate = useCallback(async (index: number, prompt: string) => {
    setRegenerating(index);
    try {
      const res = await fetch(`/api/videos/${id}/regenerate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, prompt }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["video", id] });
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Regeneration failed");
      }
    } catch {
      alert("Regeneration failed");
    } finally {
      setRegenerating(null);
      setEditingPrompt(null);
    }
  }, [id, queryClient]);

  async function handleAssemble() {
    setAssembling(true);
    try {
      const indices = selectedImages.size > 0 ? [...selectedImages].sort((a, b) => a - b) : undefined;
      const res = await fetch(`/api/videos/${id}/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIndices: indices }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Assembly failed");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["video", id] });
    } catch {
      alert("Assembly failed");
    } finally {
      setAssembling(false);
    }
  }

  async function handleRerunStep(
    step: "TTS" | "IMAGES" | "I2V",
    overrides?: { imageProvider?: string; ttsProvider?: string; imageToVideoProvider?: string },
  ) {
    setRerunStep(step);
    try {
      const body: Record<string, string | undefined> = { step };
      if (step === "IMAGES" && overrides?.imageProvider) body.imageProvider = overrides.imageProvider;
      if (step === "TTS" && overrides?.ttsProvider) body.ttsProvider = overrides.ttsProvider;
      if (step === "I2V" && overrides?.imageToVideoProvider !== undefined) body.imageToVideoProvider = overrides.imageToVideoProvider;
      const res = await fetch(`/api/videos/${id}/rerun-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to rerun step");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["video", id] });
    } catch {
      alert("Failed to rerun step");
    } finally {
      setRerunStep(null);
    }
  }

  const [queuedTimedOut, setQueuedTimedOut] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const queuedSince = useRef<number | null>(null);

  const { data: video, isLoading } = useQuery({
    queryKey: ["video", id],
    queryFn: async () => {
      const res = await fetch(`/api/videos/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      return json.data;
    },
    refetchInterval: (query) => {
      if (publishingPlatforms.size > 0) return 5000;
      const status = query.state.data?.status;
      if (status === "QUEUED") return 8000;
      if (status === "GENERATING") {
        const stage = query.state.data?.generationStage;
        return stage === "IMAGES" || stage === "I2V" ? 10000 : 15000;
      }
      if (status === "READY" || status === "POSTED" || status === "SCHEDULED") return 30000;
      return false;
    },
  });

  const { data: providerData } = useQuery({
    queryKey: ["settings", "providers"],
    queryFn: async () => {
      const res = await fetch("/api/settings/providers");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      return json.data as {
        defaults: { imageProvider?: string | null; ttsProvider?: string | null; imageToVideoProvider?: string | null };
        available: { image: { id: string; name: string }[]; tts: { id: string; name: string }[] };
        imageToVideo: { all: { id: string; name: string }[]; availableIds: string[] };
      };
    },
    enabled: !!video && (video.status === "READY" || video.status === "REVIEW"),
  });

  useEffect(() => {
    if (providerData?.defaults?.imageProvider && providerData.available?.image?.some((p) => p.id === providerData.defaults.imageProvider)) {
      setRerunImageProvider(providerData.defaults.imageProvider);
    }
    if (providerData?.defaults?.ttsProvider && providerData.available?.tts?.some((p) => p.id === providerData.defaults.ttsProvider)) {
      setRerunTtsProvider(providerData.defaults.ttsProvider);
    }
    if (providerData?.defaults?.imageToVideoProvider && providerData.imageToVideo?.availableIds?.includes(providerData.defaults.imageToVideoProvider)) {
      setRerunI2VProvider(providerData.defaults.imageToVideoProvider);
    } else if (providerData?.imageToVideo?.all?.some((p) => p.id === "LOCAL_BACKEND")) {
      setRerunI2VProvider("LOCAL_BACKEND");
    }
  }, [providerData?.defaults?.imageProvider, providerData?.defaults?.ttsProvider, providerData?.defaults?.imageToVideoProvider, providerData?.available?.image, providerData?.available?.tts, providerData?.imageToVideo]);

  useEffect(() => {
    if (publishingPlatforms.size === 0 || !video) return;
    const postedRaw = (video.postedPlatforms ?? []) as (
      | string
      | { platform: string; success?: boolean | "uploading" | "scheduled" | "deleted" }
    )[];
    const doneSet = new Set(
      postedRaw
        .filter((p) => {
          if (typeof p === "string") return true;
          if (p.success === true || p.success === false || p.success === "scheduled" || p.success === "deleted") return true;
          if (p.success === undefined && ((p as Record<string, unknown>).postId || (p as Record<string, unknown>).url)) return true;
          return false;
        })
        .map((p) => (typeof p === "string" ? p : p.platform)),
    );
    const toClear = [...publishingPlatforms].filter(
      (p) => doneSet.has(p) || failedPublishes.has(p),
    );
    if (toClear.length > 0) unmarkPublishing(...toClear);
  }, [video, failedPublishes]);

  // Clear client-side error state when server entry transitions to scheduled/posted
  useEffect(() => {
    if (!video || failedPublishes.size === 0) return;
    const postedRaw = (video.postedPlatforms ?? []) as (
      | string
      | { platform: string; success?: boolean | "uploading" | "scheduled" | "deleted" }
    )[];
    const resolvedPlatforms = postedRaw
      .filter((p) => typeof p !== "string" && (p.success === true || p.success === "scheduled"))
      .map((p) => (p as { platform: string }).platform);
    const stale = resolvedPlatforms.filter((p) => failedPublishes.has(p));
    if (stale.length > 0) {
      setFailedPublishes((prev) => {
        const next = new Map(prev);
        for (const p of stale) next.delete(p);
        return next;
      });
    }
  }, [video, failedPublishes]);

  useEffect(() => {
    if (video?.status === "QUEUED") {
      if (!queuedSince.current) queuedSince.current = Date.now();
      const timer = setInterval(() => {
        const elapsed = queuedSince.current ? Date.now() - queuedSince.current : 0;
        const remaining = Math.max(0, 60 - Math.floor(elapsed / 1000));
        setCountdown(remaining);
        if (remaining === 0) {
          setQueuedTimedOut(true);
          clearInterval(timer);
        }
      }, 1000);
      return () => clearInterval(timer);
    } else {
      queuedSince.current = null;
      setQueuedTimedOut(false);
      setCountdown(60);
    }
  }, [video?.status]);

  useEffect(() => {
    if (video?.status === "REVIEW" && !reviewInited && video.sceneImages?.length) {
      const all = new Set(Array.from({ length: video.sceneImages.length }, (_, i) => i));
      setSelectedImages(all);
      setReviewInited(true);
    }
  }, [video?.status, video?.sceneImages?.length, reviewInited]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="text-center py-20 text-muted-foreground">Video not found</div>
    );
  }

  const isQueued = video.status === "QUEUED";
  const isGenerating = video.status === "GENERATING";
  const isInProgress = isQueued || isGenerating;
  const isReview = video.status === "REVIEW";
  const isReady = video.status === "READY" || video.status === "POSTED" || video.status === "SCHEDULED";
  const isFailed = video.status === "FAILED";

  const isClipRepurpose = !!video.sourceUrl || CLIP_REPURPOSE_STAGES.some((s) => s.key === video.generationStage);
  const hasI2V = !!video.imageToVideoProvider || video.generationStage === "I2V";
  const stages = buildStages(hasI2V, isClipRepurpose);

  const currentStageIndex = video.generationStage
    ? stages.findIndex((s) => s.key === video.generationStage)
    : -1;

  const stageTimings = (video as { stageTimings?: StageTimings }).stageTimings;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6 min-w-0">
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold truncate flex-1 min-w-0">{video.title || "Video"}</h1>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700 border-red-200">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Video?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &quot;{video.title || "Untitled Video"}&quot; and its generated output. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              >
                {deleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* ── PROGRESS TRACKER ── */}
      {isInProgress && (
        <Card className="mb-8 overflow-hidden">
          <div className={`px-6 py-4 border-b ${queuedTimedOut ? "bg-amber-50" : "bg-gradient-to-r from-primary/5 to-primary/10"}`}>
            <div className="flex items-center gap-3">
              {queuedTimedOut ? (
                <AlertCircle className="h-5 w-5 text-amber-600" />
              ) : isQueued ? (
                <Clock className="h-5 w-5 text-amber-500 animate-pulse" />
              ) : (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              )}
              <div className="flex-1">
                <h2 className="font-semibold">
                  {queuedTimedOut
                    ? "Worker not responding"
                    : isQueued
                    ? "Waiting for worker..."
                    : "Generating your video"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {queuedTimedOut
                    ? "The worker hasn't picked up this job in 60 seconds. You can retry or check if the worker is running."
                    : isQueued
                    ? `Your video is queued. Waiting for worker... (${countdown}s)`
                    : "This usually takes 2-4 minutes. Do not close this page."}
                </p>
              </div>
              {isQueued && !queuedTimedOut && (
                <span className="text-lg font-mono font-bold text-amber-600 tabular-nums min-w-[3ch] text-right">
                  {countdown}
                </span>
              )}
              {queuedTimedOut && (
                <Button size="sm" onClick={handleRetry} disabled={retrying}>
                  {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Retry"}
                </Button>
              )}
            </div>
          </div>

          <CardContent className="py-6 px-6">
            <div className="space-y-0">
              {stages.map((stage, i) => {
                const Icon = stage.icon;
                const isDone = currentStageIndex > i;
                const isActive = currentStageIndex === i;
                const isLast = i === stages.length - 1;

                return (
                  <div key={stage.key} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div
                        key={`${stage.key}-${isDone}-${isActive}`}
                        className={`h-10 w-10 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                          isDone
                            ? "border-green-500 bg-green-50 text-green-600"
                            : isActive
                            ? "border-primary bg-primary/10 text-primary ring-4 ring-primary/20"
                            : "border-muted-foreground/20 bg-muted/50 text-muted-foreground/40"
                        }`}
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : isActive ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Icon className="h-5 w-5" />
                        )}
                      </div>
                      {!isLast && (
                        <div
                          className={`w-0.5 h-8 transition-all duration-500 ${
                            isDone ? "bg-green-500" : "bg-muted-foreground/15"
                          }`}
                        />
                      )}
                    </div>

                    {/* Label */}
                    <div className="pt-2 pb-4">
                      <p
                        className={`text-sm font-medium ${
                          isDone
                            ? "text-green-600"
                            : isActive
                            ? "text-primary"
                            : "text-muted-foreground/50"
                        }`}
                      >
                        {stage.label}
                        {(() => {
                          const timingLabel = getStageTimingLabel(
                            stageTimings,
                            stage.key,
                            video.generationStage,
                            isDone,
                            false,
                          );
                          if (timingLabel) {
                            return (
                              <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                                {isActive && timingLabel.includes("so far") ? (
                                  <span className="animate-pulse">{timingLabel}</span>
                                ) : (
                                  timingLabel
                                )}
                              </span>
                            );
                          }
                          if (isDone) {
                            return (
                              <span className="ml-2 text-xs font-normal text-green-500">
                                Done
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </p>
                      {isActive && (
                        <p className="text-xs text-muted-foreground mt-0.5 animate-pulse">
                          {stage.detail}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>

          {/* Live discovery transparency during generation (clip-repurpose) */}
          {isClipRepurpose && video.sourceMetadata && (() => {
            const meta = video.sourceMetadata as {
              discovery?: {
                candidates: Array<{ title: string; url: string; viewCount: number; platform: string; channelName: string; score?: number }>;
                totalConsidered: number;
                platformBreakdown?: Record<string, { found: number; qualified: number; rejected: number }>;
                rejectedSample?: Array<{ title: string; platform: string; viewCount: number; reason: string }>;
              };
              channelName?: string; originalTitle?: string; viewCount?: number; platform?: string; niche?: string;
            };
            const disc = meta.discovery;
            if (!disc || disc.candidates.length === 0) return null;
            const fmtViews = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : `${v}`;
            const platLabel: Record<string, string> = { youtube: "yt", facebook: "fb", instagram: "ig" };
            const pb = disc.platformBreakdown;
            return (
              <div className="mx-6 mb-6 rounded-lg border bg-muted/20 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Discovered {disc.totalConsidered} videos, selected:
                </p>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{meta.originalTitle ?? disc.candidates[0]?.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      {meta.channelName && <span>{meta.channelName}</span>}
                      {meta.viewCount ? <span className="flex items-center gap-0.5"><Eye className="w-2.5 h-2.5" /> {fmtViews(meta.viewCount)}</span> : null}
                      {meta.platform && <span className="uppercase text-[10px] bg-muted px-1.5 py-0.5 rounded">{meta.platform}</span>}
                      {disc.candidates[0]?.score != null && <span className="text-[10px] font-mono bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Score {disc.candidates[0].score}</span>}
                    </div>
                  </div>
                </div>
                {pb && Object.keys(pb).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {Object.entries(pb).map(([plat, counts]) => {
                      const f = counts.found;
                      const r = Math.min(counts.rejected, f);
                      const q = Math.min(counts.qualified, f - r);
                      return (
                        <span key={plat} className="text-[10px] px-2 py-0.5 rounded-full border bg-background">
                          <span className="uppercase font-semibold">{platLabel[plat] ?? plat}</span>{" "}
                          {f} found · {q} ok · {r} rej
                        </span>
                      );
                    })}
                  </div>
                )}
                {disc.candidates.length > 1 && (
                  <details className="group">
                    <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                      {disc.candidates.length - 1} other candidates...
                    </summary>
                    <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                      {disc.candidates.slice(1, 8).map((c, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] py-0.5 px-1 rounded hover:bg-muted/50">
                          <span className="truncate flex-1 mr-2">{c.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {c.score != null && <span className="font-mono text-muted-foreground">{c.score}</span>}
                            <span className="text-muted-foreground">{fmtViews(c.viewCount)}</span>
                            <span className="uppercase text-[9px] bg-muted px-1 rounded">{c.platform}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {disc.rejectedSample && disc.rejectedSample.length > 0 && (
                  <details className="group">
                    <summary className="text-[10px] text-orange-600 dark:text-orange-400 cursor-pointer hover:text-foreground">
                      {disc.rejectedSample.length} rejected candidates...
                    </summary>
                    <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                      {disc.rejectedSample.map((r, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] py-0.5 px-1 rounded hover:bg-muted/50 text-muted-foreground">
                          <span className="truncate flex-1 mr-2">{r.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span>{fmtViews(r.viewCount)}</span>
                            <span className="uppercase text-[9px] bg-muted px-1 rounded">{r.platform}</span>
                            <span className="text-[9px] text-orange-600 dark:text-orange-400">{r.reason}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })()}
        </Card>
      )}

      {/* ── LIVE IMAGE PREVIEW ── */}
      {isInProgress && video.totalScenes > 0 && (
        <Card className="mb-8">
          <div className="px-6 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Scene Preview</span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {video.sceneImageCount}/{video.totalScenes} images
            </span>
          </div>
          <CardContent className="p-4">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {Array.from({ length: video.totalScenes }).map((_, i) => {
                const url = (video.sceneImages as string[] | undefined)?.[i];
                const isReady = !!url;
                return (
                  <div
                    key={`scene-${i}`}
                    className={`relative aspect-[9/16] rounded-md overflow-hidden border ${
                      isReady ? "bg-muted animate-in fade-in duration-500" : "bg-muted/50 flex items-center justify-center"
                    }`}
                  >
                    {isReady ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={url}
                        alt={`Scene ${i + 1}`}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <Loader2 className="h-4 w-4 text-muted-foreground/30 animate-spin" />
                    )}
                    <span className={`absolute bottom-0 left-0 right-0 text-[10px] text-center py-0.5 ${
                      isReady ? "bg-black/50 text-white" : "bg-muted text-muted-foreground/40"
                    }`}>
                      {i + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── REVIEW MODE ── */}
      {isReview && (
        <div className="space-y-6">
          <Card className="overflow-hidden border-amber-200 bg-amber-50/30">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200">
              <CheckCircle2 className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">
                Review &amp; Approve
              </span>
              <span className="text-xs text-amber-600 ml-auto">
                {selectedImages.size}/{(video.sceneImages as string[] | undefined)?.length ?? 0} images selected
              </span>
            </div>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground mb-1">
                Listen to the voiceover, review each image and its prompt. Edit prompts and regenerate images as needed.
                Deselect images you don&apos;t want. When ready, click <strong>Proceed</strong> to assemble the final video.
              </p>
            </CardContent>
          </Card>

          {/* Pipeline steps (review mode, non-clip-repurpose) */}
          {!isClipRepurpose && (
            <Card>
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">Pipeline steps</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Rerun voiceover, images, or image-to-video to regenerate; assembly and final video will be re-created automatically.
                </p>
              </div>
              <CardContent className="p-4 space-y-2">
                {[
                  { key: "SCRIPT", label: "Script", status: "Generated", icon: FileText, canRerun: false },
                  { key: "TTS", label: "Voiceover", status: "Generated", icon: Mic, canRerun: true },
                  { key: "IMAGES", label: "Images", status: "Generated", icon: ImageIcon, canRerun: true },
                  { key: "I2V", label: "Image-to-video", status: "Done", icon: Film, canRerun: true },
                  { key: "ASSEMBLY", label: "Assembly", status: "Pending", icon: Clapperboard, canRerun: false },
                  { key: "UPLOADING", label: "Final video", status: "Pending", icon: Upload, canRerun: false },
                ].map(({ key, label, status, icon: Icon, canRerun }) => (
                  <div key={key} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">— {status}</span>
                    </div>
                    {canRerun && (
                      <div className="flex items-center gap-2">
                        {key === "TTS" && providerData?.available?.tts?.length ? (
                          <select
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            value={rerunTtsProvider}
                            onChange={(e) => setRerunTtsProvider(e.target.value)}
                            disabled={rerunStep !== null}
                          >
                            {providerData.available.tts.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        ) : null}
                        {key === "IMAGES" && providerData?.available?.image?.length ? (
                          <select
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            value={rerunImageProvider}
                            onChange={(e) => setRerunImageProvider(e.target.value)}
                            disabled={rerunStep !== null}
                          >
                            {providerData.available.image.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        ) : null}
                        {key === "I2V" && providerData?.imageToVideo?.all?.length ? (
                          <select
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            value={rerunI2VProvider}
                            onChange={(e) => setRerunI2VProvider(e.target.value)}
                            disabled={rerunStep !== null}
                          >
                            {providerData.imageToVideo.all.filter((p) => p.id === "" || providerData.imageToVideo.availableIds.includes(p.id)).map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rerunStep !== null}
                          onClick={() => {
                            const step = key as "TTS" | "IMAGES" | "I2V";
                            const overrides = step === "TTS" ? { ttsProvider: rerunTtsProvider }
                              : step === "IMAGES" ? { imageProvider: rerunImageProvider }
                              : step === "I2V" ? { imageToVideoProvider: rerunI2VProvider }
                              : undefined;
                            handleRerunStep(step, overrides);
                          }}
                        >
                          {rerunStep === key ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Rerunning...</>
                          ) : (
                            <><RefreshCw className="h-3.5 w-3.5 mr-1" /> Rerun this step</>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Audio player (only for original pipeline) */}
          {!isClipRepurpose && <Card>
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Mic className="h-4 w-4" />
              <span className="text-sm font-medium">Voiceover</span>
            </div>
            <CardContent className="p-4">
              <audio controls className="w-full" src={`/api/videos/${video.id}/audio`} preload="metadata" />
            </CardContent>
          </Card>}

          {/* Image review grid (only for original pipeline) */}
          {!isClipRepurpose && <Card>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                <span className="text-sm font-medium">Scene Images</span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm" variant="outline"
                  onClick={() => {
                    const all = new Set(Array.from({ length: (video.sceneImages as string[]).length }, (_, i) => i));
                    setSelectedImages(selectedImages.size === all.size ? new Set() : all);
                  }}
                >
                  {selectedImages.size === (video.sceneImages as string[] | undefined)?.length ? "Deselect All" : "Select All"}
                </Button>
              </div>
            </div>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {(video.sceneImages as string[] | undefined)?.map((url: string, i: number) => {
                  const isSelected = selectedImages.has(i);
                  const prompt = (video.imagePrompts as string[] | undefined)?.[i] ?? "";
                  const isEditing = editingPrompt === i;
                  const isRegen = regenerating === i;

                  return (
                    <div
                      key={`review-${i}`}
                      className={`rounded-lg border-2 overflow-hidden transition-all ${
                        isSelected ? "border-primary ring-1 ring-primary/20" : "border-muted opacity-50"
                      }`}
                    >
                      <div className="relative aspect-[9/16] bg-muted cursor-pointer group"
                        onClick={() => {
                          setSelectedImages(prev => {
                            const next = new Set(prev);
                            next.has(i) ? next.delete(i) : next.add(i);
                            return next;
                          });
                        }}
                      >
                        {isRegen ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-muted">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                          </div>
                        ) : (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={`${url}?t=${video.updatedAt}`}
                            alt={`Scene ${i + 1}`}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        )}
                        <div className="absolute top-1.5 left-1.5">
                          {isSelected
                            ? <SquareCheck className="h-5 w-5 text-primary drop-shadow" />
                            : <Square className="h-5 w-5 text-white/70 drop-shadow" />}
                        </div>
                        <span className="absolute top-1.5 right-1.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                          {i + 1}
                        </span>
                      </div>

                      <div className="p-2 space-y-1.5">
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <Textarea
                              value={editPromptText}
                              onChange={(e) => setEditPromptText(e.target.value)}
                              rows={3}
                              className="text-[11px] resize-none"
                            />
                            <div className="flex gap-1">
                              <Button
                                size="xs" className="flex-1"
                                onClick={() => handleRegenerate(i, editPromptText)}
                                disabled={isRegen}
                              >
                                {isRegen ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RefreshCw className="h-3 w-3 mr-1" /> Regenerate</>}
                              </Button>
                              <Button size="xs" variant="ghost" onClick={() => setEditingPrompt(null)}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">{prompt}</p>
                            <Button
                              size="xs" variant="ghost" className="w-full text-[10px]"
                              onClick={() => { setEditingPrompt(i); setEditPromptText(prompt); }}
                            >
                              Edit prompt
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>}

          {/* Proceed button (only for original pipeline) */}
          {!isClipRepurpose && <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {selectedImages.size === 0
                ? "Select at least one image to proceed"
                : `${selectedImages.size} image${selectedImages.size > 1 ? "s" : ""} will be used in the final video`}
            </p>
            <Button
              size="lg"
              onClick={handleAssemble}
              disabled={assembling || selectedImages.size === 0}
            >
              {assembling ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Assembling...</>
              ) : (
                <><Play className="mr-2 h-4 w-4" /> Proceed to Assembly</>
              )}
            </Button>
          </div>}
        </div>
      )}

      {/* ── READY: VIDEO PLAYER ── */}
      {isReady && (
        <div className="space-y-6">
          {/* Compact ready header */}
          <Card className="overflow-hidden border-green-200 bg-green-50/30">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-700">
                Video ready
              </span>
              {video.duration && (
                <span className="text-xs text-green-600 ml-auto">
                  {video.duration}s
                </span>
              )}
            </div>
            {!isClipRepurpose && (
              <div className="px-4 py-2 border-t border-green-200/60">
                <p className="text-xs text-muted-foreground mb-1.5">Step timings</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-green-800/90">
                  {stages.map((s) => {
                    const d = stageTimings?.[s.key]?.durationMs;
                    const value = d != null && d > 0 ? formatStageDuration(d) : "NA";
                    return (
                      <span key={s.key}>
                        {s.label} {value}
                      </span>
                    );
                  })}
                </div>
                {(() => {
                  const used = (video as { usedProviders?: { tts?: string; image?: string; i2v?: string; bgm?: string; sfx?: string } }).usedProviders;
                  if (!used) return null;
                  const parts: { label: string; value: string }[] = [];
                  if (used.tts) parts.push({ label: "TTS", value: used.tts });
                  if (used.image) parts.push({ label: "Image", value: used.image });
                  if (used.i2v) parts.push({ label: "I2V", value: used.i2v });
                  if (used.bgm) parts.push({ label: "BGM", value: used.bgm });
                  if (used.sfx) parts.push({ label: "SFX", value: used.sfx });
                  if (parts.length === 0) return null;
                  return (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-green-700/80">
                      <span className="text-muted-foreground font-medium">Built with</span>
                      {parts.map((p) => (
                        <span key={p.label} className="bg-green-100/60 px-1.5 py-0.5 rounded text-green-800">
                          <span className="font-medium">{p.label}:</span> {p.value}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
            {isClipRepurpose && (
              <div className="px-4 py-2 border-t border-green-200/60">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {stages.map((s) => {
                    const d = stageTimings?.[s.key]?.durationMs;
                    const Icon = s.icon;
                    return (
                      <span key={s.key} className="inline-flex items-center gap-1 text-green-700">
                        <Icon className="h-3 w-3" />
                        <span className="font-medium">{s.label}</span>
                        {d != null && d > 0 && <span className="text-green-600/70 tabular-nums">{formatStageDuration(d)}</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* Clip Repurpose: Combined Clip Details card (source + timing + candidates) */}
          {isClipRepurpose && video.sourceMetadata && (() => {
            const meta = video.sourceMetadata as {
              discovery?: {
                candidates: Array<{ title: string; url: string; viewCount: number; platform: string; channelName: string; score?: number }>;
                totalConsidered: number;
                platformBreakdown?: Record<string, { found: number; qualified: number; rejected: number }>;
                rejectedSample?: Array<{ title: string; platform: string; viewCount: number; reason: string }>;
              };
              timingBreakdown?: { preContext: { startSec: number; endSec: number; durationSec: number }; mainHeatmap: { startSec: number; endSec: number; durationSec: number }; postContext: { startSec: number; endSec: number; durationSec: number }; totalDurationSec: number };
              peakSegment?: { startSec: number; endSec: number; avgHeat: number };
              channelName?: string; originalTitle?: string; viewCount?: number; platform?: string; niche?: string;
            };
            const disc = meta.discovery;
            const timing = meta.timingBreakdown;
            const fmtTime = (s: number) => { const m = Math.floor(s / 60); const sec = s % 60; return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${sec}s`; };
            const fmtViews = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : `${v}`;
            const platLabel: Record<string, string> = { youtube: "yt", facebook: "fb", instagram: "ig" };

            if (!disc && !timing) return null;
            const pb = disc?.platformBreakdown;

            return (
              <Card>
                <div className="px-4 py-3 border-b">
                  <h3 className="text-sm font-semibold">Clip Details</h3>
                </div>
                <CardContent className="p-0 divide-y">
                  {/* Source video */}
                  {disc && disc.candidates.length > 0 && (
                    <div className="p-4 space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Source · {disc.totalConsidered} scanned</p>

                      {pb && Object.keys(pb).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(pb).map(([plat, counts]) => {
                            const f = counts.found;
                            const r = Math.min(counts.rejected, f);
                            const q = Math.min(counts.qualified, f - r);
                            return (
                              <span key={plat} className="text-[10px] px-2 py-0.5 rounded-full border bg-muted/30">
                                <span className="uppercase font-semibold">{platLabel[plat] ?? plat}</span>{" "}
                                {f} found · {q} ok · {r} rej
                              </span>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate" title={meta.originalTitle ?? disc.candidates[0]?.title}>{meta.originalTitle ?? disc.candidates[0]?.title}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                            {disc.candidates[0]?.score != null && <span className="font-mono text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">Score {disc.candidates[0].score}</span>}
                            {meta.channelName && <span>by {meta.channelName}</span>}
                            {meta.viewCount ? <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" /> {fmtViews(meta.viewCount)} views</span> : null}
                            {meta.platform && <span className="uppercase text-[10px] bg-muted px-1.5 py-0.5 rounded">{meta.platform}</span>}
                            {video.sourceUrl && (
                              <a href={video.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-0.5">
                                <Link2 className="w-3 h-3" /> Original
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                      {disc.candidates.length > 1 && (
                        <details className="group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground py-0.5">
                            {disc.candidates.length - 1} other candidates...
                          </summary>
                          <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                            {disc.candidates.slice(1).map((c, i) => (
                              <div key={i} className="flex items-center justify-between py-1 px-2 rounded text-xs hover:bg-muted/30">
                                <div className="flex-1 min-w-0 mr-2">
                                  <p className="truncate">{c.title}</p>
                                  <p className="text-muted-foreground text-[10px]">{c.channelName} · {c.platform}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                                  {c.score != null && <span className="font-mono text-[10px] bg-muted px-1 rounded">{c.score}</span>}
                                  <span className="flex items-center gap-0.5 text-[10px]"><Eye className="w-2.5 h-2.5" /> {fmtViews(c.viewCount)}</span>
                                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline"><Link2 className="w-3 h-3" /></a>
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {disc.rejectedSample && disc.rejectedSample.length > 0 && (
                        <details className="group">
                          <summary className="text-xs text-orange-600 dark:text-orange-400 cursor-pointer hover:text-foreground py-0.5">
                            {disc.rejectedSample.length} rejected candidates...
                          </summary>
                          <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                            {disc.rejectedSample.map((r, i) => (
                              <div key={i} className="flex items-center justify-between py-1 px-2 rounded text-xs hover:bg-muted/30 text-muted-foreground">
                                <div className="flex-1 min-w-0 mr-2">
                                  <p className="truncate">{r.title}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[10px]">{fmtViews(r.viewCount)}</span>
                                  <span className="uppercase text-[9px] bg-muted px-1 rounded">{r.platform}</span>
                                  <span className="text-[9px] text-orange-600 dark:text-orange-400 max-w-[120px] truncate">{r.reason}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}

                  {/* Timing breakdown */}
                  {timing && (
                    <div className="p-4 space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Clip Timing · {timing.totalDurationSec}s total</p>
                      <div className="relative h-6 rounded-md overflow-hidden border">
                        {timing.totalDurationSec > 0 && (
                          <>
                            <div className="absolute inset-y-0 left-0 bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[9px] font-medium text-blue-700 dark:text-blue-300" style={{ width: `${(timing.preContext.durationSec / timing.totalDurationSec) * 100}%` }}>
                              {timing.preContext.durationSec > 3 ? `Pre ${timing.preContext.durationSec}s` : ""}
                            </div>
                            <div className="absolute inset-y-0 bg-orange-200 dark:bg-orange-900/50 flex items-center justify-center text-[9px] font-semibold text-orange-800 dark:text-orange-300 border-x border-orange-300" style={{ left: `${(timing.preContext.durationSec / timing.totalDurationSec) * 100}%`, width: `${(timing.mainHeatmap.durationSec / timing.totalDurationSec) * 100}%` }}>
                              Peak {timing.mainHeatmap.durationSec}s{meta.peakSegment ? ` · ${(meta.peakSegment.avgHeat * 100).toFixed(0)}%` : ""}
                            </div>
                            <div className="absolute inset-y-0 right-0 bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[9px] font-medium text-blue-700 dark:text-blue-300" style={{ width: `${(timing.postContext.durationSec / timing.totalDurationSec) * 100}%` }}>
                              {timing.postContext.durationSec > 3 ? `Post ${timing.postContext.durationSec}s` : ""}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums px-0.5">
                        <span>{fmtTime(timing.preContext.startSec)}</span>
                        <span>{fmtTime(timing.mainHeatmap.startSec)} – {fmtTime(timing.mainHeatmap.endSec)}</span>
                        <span>{fmtTime(timing.postContext.endSec)}</span>
                      </div>
                    </div>
                  )}

                </CardContent>
              </Card>
            );
          })()}

          {/* Standard pipeline steps (non-clip-repurpose only) */}
          {!isClipRepurpose && (
            <Card>
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">Pipeline steps</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Rerun voiceover, images, or image-to-video to regenerate; assembly and final video will be re-created automatically.
                </p>
              </div>
              <CardContent className="p-4 space-y-2">
                {[
                  { key: "SCRIPT", label: "Script", status: "Generated", icon: FileText, canRerun: false },
                  { key: "TTS", label: "Voiceover", status: "Generated", icon: Mic, canRerun: true },
                  { key: "IMAGES", label: "Images", status: "Generated", icon: ImageIcon, canRerun: true },
                  { key: "I2V", label: "Image-to-video", status: "Done", icon: Film, canRerun: true },
                  { key: "ASSEMBLY", label: "Assembly", status: "Done", icon: Clapperboard, canRerun: false },
                  { key: "UPLOADING", label: "Final video", status: "Done", icon: Upload, canRerun: false },
                ].map(({ key, label, status, icon: Icon, canRerun }) => (
                  <div key={key} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">— {status}</span>
                    </div>
                    {canRerun && (
                      <div className="flex items-center gap-2">
                        {key === "TTS" && providerData?.available?.tts?.length ? (
                          <select
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            value={rerunTtsProvider}
                            onChange={(e) => setRerunTtsProvider(e.target.value)}
                            disabled={rerunStep !== null}
                          >
                            {providerData.available.tts.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        ) : null}
                        {key === "IMAGES" && providerData?.available?.image?.length ? (
                          <select
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            value={rerunImageProvider}
                            onChange={(e) => setRerunImageProvider(e.target.value)}
                            disabled={rerunStep !== null}
                          >
                            {providerData.available.image.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        ) : null}
                        {key === "I2V" && providerData?.imageToVideo?.all?.length ? (
                          <select
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            value={rerunI2VProvider}
                            onChange={(e) => setRerunI2VProvider(e.target.value)}
                            disabled={rerunStep !== null}
                          >
                            {providerData.imageToVideo.all.filter((p) => p.id === "" || providerData.imageToVideo.availableIds.includes(p.id)).map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rerunStep !== null}
                          onClick={() => {
                            const step = key as "TTS" | "IMAGES" | "I2V";
                            const overrides = step === "TTS" ? { ttsProvider: rerunTtsProvider }
                              : step === "IMAGES" ? { imageProvider: rerunImageProvider }
                              : step === "I2V" ? { imageToVideoProvider: rerunI2VProvider }
                              : undefined;
                            handleRerunStep(step, overrides);
                          }}
                        >
                          {rerunStep === key ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Rerunning...</>
                          ) : (
                            <><RefreshCw className="h-3.5 w-3.5 mr-1" /> Rerun this step</>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="rounded-lg overflow-hidden bg-black shadow-xl">
            <video
              controls
              autoPlay
              className="w-full max-h-[70vh] mx-auto"
              src={`/api/videos/${video.id}/stream`}
            />
          </div>

          <div className="flex gap-3 flex-wrap">
            <Button asChild>
              <a href={`/api/videos/${video.id}/download`}>
                <Download className="mr-2 h-4 w-4" /> Download MP4
              </a>
            </Button>
          </div>


          {/* Per-platform publish card */}
          {(() => {
            const PLATFORMS = [
              { key: "YOUTUBE", label: "YouTube Shorts", icon: Youtube, color: "text-red-600" },
              { key: "INSTAGRAM", label: "Instagram Reels", icon: Instagram, color: "text-pink-600" },
              { key: "FACEBOOK", label: "Facebook Reels", icon: Facebook, color: "text-blue-600" },
              { key: "SHARECHAT", label: "ShareChat", icon: Share2, color: "text-orange-600" },
              { key: "MOJ", label: "Moj", icon: Smartphone, color: "text-amber-600" },
            ] as const;

            type ServerEntry = { platform: string; success?: boolean | "uploading" | "scheduled" | "deleted"; postId?: string; url?: string; error?: string; scheduledFor?: string };
            const postedRaw = (video.postedPlatforms ?? []) as (string | ServerEntry)[];

            const serverMap = new Map<string, ServerEntry>();
            for (const p of postedRaw) {
              if (typeof p === "string") {
                serverMap.set(p, { platform: p, success: true });
              } else {
                const entry = { ...p };
                if (entry.success === undefined && (entry.postId || entry.url)) {
                  entry.success = true;
                }
                serverMap.set(entry.platform, entry);
              }
            }

            const connectedSet = new Set(connectedAccounts.map((a) => a.platform));

            const postablePlatforms = PLATFORMS.filter((p) => {
              const entry = serverMap.get(p.key);
              if (!entry) return connectedSet.has(p.key);
              return (entry.success === false || entry.success === "deleted") && connectedSet.has(p.key);
            });

            return (
              <Card className="mt-4">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Publish</h3>
                    <div className="flex gap-2">
                      {[...serverMap.values()].some((e) => e.success === true || e.success === "scheduled") && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 text-xs hover:text-red-600"
                            disabled={deletingPlatforms.size > 0}
                            onClick={() => handleDeleteFromPlatform()}
                          >
                            {deletingPlatforms.has("__all__") ? (
                              <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Deleting...</>
                            ) : (
                              <><Trash2 className="mr-1 h-3 w-3" /> Delete All</>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground text-xs"
                            disabled={resettingPlatforms.size > 0}
                            onClick={() => handleResetPosted()}
                          >
                            {resettingPlatforms.size > 0 ? (
                              <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Resetting...</>
                            ) : (
                              <><RefreshCw className="mr-1 h-3 w-3" /> Reset All</>
                            )}
                          </Button>
                        </>
                      )}
                      {postablePlatforms.length > 1 && (() => {
                        const anyServerFail = postablePlatforms.some((p) => serverMap.get(p.key)?.success === false);
                        const anyClientFail = postablePlatforms.some((p) => failedPublishes.has(p.key));
                        const anyFailed = anyServerFail || anyClientFail;
                        const allBusy = postablePlatforms.every((p) => publishingPlatforms.has(p.key));
                        const someBusy = postablePlatforms.some((p) => publishingPlatforms.has(p.key));
                        const availableKeys = postablePlatforms.filter((p) => !publishingPlatforms.has(p.key)).map((p) => p.key);
                        return someBusy ? (
                          <Button size="sm" variant="outline" disabled>
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Scheduling...
                          </Button>
                        ) : anyFailed ? (
                          <Button size="sm" variant="destructive" disabled={allBusy} onClick={() => handlePublishAll(availableKeys)}>
                            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry All
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => handlePublishAll(availableKeys)}>
                              <Clock className="mr-1 h-3.5 w-3.5" /> Schedule All
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handlePublishAll(availableKeys, true)}>
                              <Send className="mr-1 h-3.5 w-3.5" /> Post All Now
                            </Button>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {PLATFORMS.map(({ key, label, icon: Icon, color }) => {
                    const entry = serverMap.get(key);
                    const isPosted = entry?.success === true;
                    const isScheduled = entry?.success === "scheduled";
                    const isDeleted = entry?.success === "deleted";
                    const isUploading = entry?.success === "uploading";
                    const isServerFailed = entry?.success === false;
                    const postUrl = (isPosted || isScheduled) ? (entry?.url ?? undefined) : undefined;
                    const connected = connectedSet.has(key);
                    const isPublishing = publishingPlatforms.has(key);
                    const clientFailError = failedPublishes.get(key);
                    const serverFailError = isServerFailed && entry?.error ? formatPlatformError(entry.error) : undefined;
                    const failError = clientFailError || serverFailError;
                    const hasFailed = (isServerFailed || !!clientFailError) && !isPublishing && !isPosted && !isScheduled;
                    const isEditingThisLink = editingLink === key;
                    const insightsRaw = (video as { insights?: Record<string, { views?: number; likes?: number; comments?: number; reactions?: number }> }).insights;
                    const platformInsights = insightsRaw?.[key] as { views?: number; likes?: number; comments?: number; reactions?: number } | undefined;
                    const pViews = platformInsights?.views ?? 0;
                    const pInteractions = (platformInsights?.likes ?? 0) + (platformInsights?.comments ?? 0) + (platformInsights?.reactions ?? 0);
                    const hasPlatformInsights = pViews > 0 || pInteractions > 0;
                    const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n));

                    let rowBg = "";
                    if (isDeleted) rowBg = "bg-zinc-50 border-zinc-200";
                    else if (isPosted) rowBg = "bg-green-50 border-green-200";
                    else if (isScheduled) rowBg = "bg-blue-50 border-blue-200";
                    else if (isUploading || isPublishing) rowBg = "bg-blue-50/60 border-blue-200";
                    else if (hasFailed) rowBg = "bg-red-50/60 border-red-200";

                    return (
                      <div key={key} className={`rounded-lg border p-3 transition-colors ${rowBg}`}>
                        <div className="flex items-center gap-3">
                          <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">{label}</span>
                            {isScheduled && postUrl && (
                              <div className="mt-0.5">
                                <a href={postUrl} target="_blank" rel="noopener noreferrer"
                                  className="text-xs text-blue-700 underline underline-offset-2 hover:text-blue-900 truncate">
                                  {postUrl}
                                </a>
                              </div>
                            )}
                            {isScheduled && !postUrl && entry?.scheduledFor && (
                              <p className="text-xs text-blue-600 mt-0.5">
                                Will post at {new Date(entry.scheduledFor).toLocaleString()}
                              </p>
                            )}
                            {isDeleted && (
                              <p className="text-xs text-zinc-400 mt-0.5 line-through">Deleted</p>
                            )}
                            {isPosted && postUrl && !isEditingThisLink && (
                              <div className="mt-0.5 space-y-1">
                                <div className="flex items-center gap-1 min-w-0">
                                  <a
                                    href={postUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-green-700 underline underline-offset-2 hover:text-green-900 truncate"
                                  >
                                    {postUrl}
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => { setEditingLink(key); setLinkInput(postUrl); setLinkError(""); }}
                                    className="text-green-600 hover:text-green-800 shrink-0 p-0.5"
                                    title="Edit link"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                </div>
                                {hasPlatformInsights && (
                                  <div className="text-[11px] text-muted-foreground/90 font-medium tabular-nums">
                                    {fmt(pViews)} views · {fmt(pInteractions)} interactions
                                  </div>
                                )}
                              </div>
                            )}
                            {isPosted && !postUrl && !isEditingThisLink && (
                              <div className="mt-0.5 space-y-1">
                                <button
                                  type="button"
                                  onClick={() => { setEditingLink(key); setLinkInput(""); setLinkError(""); }}
                                  className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900"
                                >
                                  <Link2 className="h-3 w-3" /> Add link
                                </button>
                                {hasPlatformInsights && (
                                  <div className="text-[11px] text-muted-foreground/90 font-medium tabular-nums">
                                    {fmt(pViews)} views · {fmt(pInteractions)} interactions
                                  </div>
                                )}
                              </div>
                            )}
                            {(isUploading || isPublishing) && !isPosted && !isScheduled && (
                              <p className="text-xs text-blue-600 mt-0.5">Scheduling on {label}...</p>
                            )}
                            {hasFailed && failError && (
                              <p className="text-xs text-red-600 mt-0.5 break-words line-clamp-2" title={failError}>{failError}</p>
                            )}
                            {!connected && !isPosted && !isScheduled && !isDeleted && !isUploading && !hasFailed && (
                              <p className="text-xs text-muted-foreground">Not connected</p>
                            )}
                          </div>
                          <div className="shrink-0">
                            {isDeleted ? (
                              <div className="flex items-center gap-2">
                                <span className="flex items-center gap-1 text-xs text-zinc-400 font-medium">
                                  <Trash2 className="h-4 w-4" /> Deleted
                                </span>
                                {connected && !isPublishing && (
                                  <>
                                    <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => handlePublishPlatform(key)}>
                                      <Clock className="h-3.5 w-3.5" /> Schedule
                                    </Button>
                                    <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => handlePublishPlatform(key, true)}>
                                      <Send className="h-3.5 w-3.5" /> Post Now
                                    </Button>
                                  </>
                                )}
                                {connected && isPublishing && (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                                )}
                              </div>
                            ) : isScheduled ? (
                              <div className="flex items-center gap-2">
                                <span className="flex items-center gap-1 text-xs text-blue-700 font-medium">
                                  <Clock className="h-4 w-4" /> Scheduled
                                </span>
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  className="text-red-400 hover:text-red-600"
                                  disabled={cancellingPlatforms.has(key) || cancellingPlatforms.has("__all__")}
                                  onClick={() => handleCancelSchedule([key])}
                                  title="Cancel scheduled post"
                                >
                                  {cancellingPlatforms.has(key) ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3 w-3" />
                                  )}
                                </Button>
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-foreground"
                                  disabled={resettingPlatforms.has(key) || isPublishing}
                                  onClick={() => handleResetPosted([key])}
                                  title="Reset to re-schedule"
                                >
                                  {resettingPlatforms.has(key) ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            ) : isPosted ? (
                              <div className="flex items-center gap-2">
                                <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                                  <CheckCircle2 className="h-4 w-4" /> Posted
                                </span>
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  className="text-red-400 hover:text-red-600"
                                  disabled={deletingPlatforms.has(key) || deletingPlatforms.has("__all__")}
                                  onClick={() => handleDeleteFromPlatform([key])}
                                  title="Delete from platform"
                                >
                                  {deletingPlatforms.has(key) ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3 w-3" />
                                  )}
                                </Button>
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-foreground"
                                  disabled={resettingPlatforms.has(key) || isPublishing}
                                  onClick={() => handleResetPosted([key])}
                                  title="Reset to re-post"
                                >
                                  {resettingPlatforms.has(key) ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            ) : isUploading || isPublishing ? (
                              <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scheduling...
                              </span>
                            ) : connected ? (
                              <div className="flex items-center gap-1.5">
                                {isPublishing ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                                ) : hasFailed ? (
                                  <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => handlePublishPlatform(key)} title={failError}>
                                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                                  </Button>
                                ) : (
                                  <>
                                    <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => handlePublishPlatform(key)}>
                                      <Clock className="h-3.5 w-3.5" /> Schedule
                                    </Button>
                                    <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => handlePublishPlatform(key, true)}>
                                      <Send className="h-3.5 w-3.5" /> Post Now
                                    </Button>
                                  </>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </div>

                        {/* Inline link editor */}
                        {isEditingThisLink && (
                          <div className="mt-2 pl-8 space-y-1.5">
                            <div className="flex gap-1.5">
                              <input
                                type="url"
                                placeholder={`Paste ${label} link here...`}
                                value={linkInput}
                                onChange={(e) => { setLinkInput(e.target.value); setLinkError(""); }}
                                onKeyDown={(e) => { if (e.key === "Enter") handleSaveLink(key); if (e.key === "Escape") { setEditingLink(null); setLinkError(""); } }}
                                className="flex-1 h-8 rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                autoFocus
                              />
                              <Button
                                size="xs"
                                variant="default"
                                disabled={savingLink || !linkInput.trim()}
                                onClick={() => handleSaveLink(key)}
                              >
                                {savingLink ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3 mr-1" /> Save</>}
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => { setEditingLink(null); setLinkError(""); }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                            {linkError && (
                              <p className="text-[11px] text-red-600 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3 shrink-0" /> {linkError}
                              </p>
                            )}
                          </div>
                        )}

                        {/* "Already posted? Add link" for non-posted platforms */}
                        {!isPosted && !isUploading && !isEditingThisLink && !isPublishing && (
                          <div className="mt-1.5 pl-8">
                            <button
                              type="button"
                              onClick={() => { setEditingLink(key); setLinkInput(""); setLinkError(""); }}
                              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                            >
                              <Link2 className="h-3 w-3" /> Already posted? Add link manually
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })()}

          {/* Video insights — this video totals across platforms */}
          {isReady && (() => {
            const insights = (video as {
              insights?: Record<string, { views?: number; likes?: number; comments?: number; reactions?: number }>;
            }).insights;
            const refreshedAt = (video as { insightsRefreshedAt?: string | null }).insightsRefreshedAt;
            const formatNum = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n));
            const timeAgoInsights = (dateStr: string) => {
              const d = new Date(dateStr).getTime();
              const mins = Math.floor((Date.now() - d) / 60000);
              if (mins < 1) return "just now";
              if (mins < 60) return `${mins}m ago`;
              if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
              return `${Math.floor(mins / 1440)}d ago`;
            };
            const platformKeys = ["YOUTUBE", "INSTAGRAM", "FACEBOOK"];
            let totalViews = 0, totalInteractions = 0;
            if (insights && typeof insights === "object") {
              for (const key of platformKeys) {
                const p = (insights as Record<string, unknown>)[key];
                if (p && typeof p === "object" && !Array.isArray(p)) {
                  const o = p as { views?: number; likes?: number; comments?: number; reactions?: number };
                  totalViews += Number(o.views) || 0;
                  totalInteractions += (Number(o.likes) || 0) + (Number(o.comments) || 0) + (Number(o.reactions) || 0);
                }
              }
            }
            const hasAny = totalViews > 0 || totalInteractions > 0;
            return (
              <Card className="mt-4">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5">
                      <BarChart2 className="h-4 w-4 text-muted-foreground" />
                      Insights
                    </h3>
                    <div className="flex items-center gap-2">
                      {refreshedAt && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          Last refreshed {timeAgoInsights(refreshedAt)}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs shrink-0"
                        disabled={insightsRefreshing}
                        onClick={async () => {
                          setInsightsRefreshing(true);
                          try {
                            const res = await fetch("/api/insights/refresh", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ videoIds: [video.id] }),
                            });
                            if (res.ok) {
                              await queryClient.invalidateQueries({ queryKey: ["video", video.id] });
                            }
                          } finally {
                            setInsightsRefreshing(false);
                          }
                        }}
                      >
                        {insightsRefreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Refresh
                      </Button>
                    </div>
                  </div>
                  {hasAny ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Total views</p>
                        <p className="text-lg font-semibold tabular-nums mt-0.5">{formatNum(totalViews)}</p>
                      </div>
                      <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Total interactions</p>
                        <p className="text-lg font-semibold tabular-nums mt-0.5">{formatNum(totalInteractions)}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No insights yet. Click Refresh to fetch from platforms.</p>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Scene images / clips gallery */}
          {video.sceneImages && (video.sceneImages as string[]).length > 0 && (
            <Card className="mt-6">
              <div className="px-6 py-3 border-b flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                <span className="text-sm font-medium">Scenes</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {(video.sceneImages as string[]).length} scenes
                  {(video.sceneClips as (string | null)[] | undefined)?.some(Boolean) && (
                    <> · {(video.sceneClips as (string | null)[]).filter(Boolean).length} clips</>
                  )}
                </span>
              </div>
              <CardContent className="p-4">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {(video.sceneImages as string[]).map((imgUrl: string, i: number) => {
                    const clipUrl = (video.sceneClips as (string | null)[] | undefined)?.[i];
                    return (
                      <div
                        key={imgUrl}
                        className="relative aspect-[9/16] rounded-md overflow-hidden bg-muted border group cursor-pointer"
                      >
                        {clipUrl ? (
                          <video
                            src={clipUrl}
                            muted
                            loop
                            playsInline
                            onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                            onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={imgUrl}
                            alt={`Scene ${i + 1}`}
                            className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105"
                          />
                        )}
                        <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5">
                          {i + 1}{clipUrl ? " ▶" : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── FAILED ── */}
      {isFailed && (
        <Card className="mb-8 overflow-hidden border-red-200">
          <div className="px-6 py-4 border-b border-red-200 bg-red-50">
            <div className="flex items-center gap-3">
              <XCircle className="h-5 w-5 text-red-600 shrink-0" />
              <div className="flex-1">
                <h2 className="font-semibold text-red-800">Generation failed</h2>
                <p className="text-sm text-red-700/90 mt-0.5 break-words line-clamp-3" title={video.errorMessage || undefined}>
                  {video.errorMessage || "An unknown error occurred."}
                </p>
              </div>
            </div>
          </div>
          <CardContent className="py-6 px-6">
            {/* Full step list with color coding and timings (same layout as progress tracker) */}
            <div className="space-y-0">
              {(() => {
                const failedAt =
                  video.generationStage
                    ? stages.findIndex((s) => s.key === video.generationStage)
                    : stages.findIndex(
                        (s) =>
                          stageTimings?.[s.key]?.startedAt &&
                          !(stageTimings[s.key].durationMs > 0),
                      );
                const failedStepLabel = failedAt >= 0 ? stages[failedAt]?.label : null;

                return (
                  <>
                    {stages.map((stage, i) => {
                      const Icon = stage.icon;
                      const isDone = failedAt >= 0 && i < failedAt;
                      const isFailedStep = i === failedAt;
                      const isPending = failedAt < 0 || i > failedAt;
                      const isLast = i === stages.length - 1;
                      const t = stageTimings?.[stage.key];
                      const durationMs = t?.durationMs ?? 0;
                      const timeLabel = isDone && durationMs > 0
                        ? formatStageDuration(durationMs)
                        : isFailedStep
                        ? "Failed"
                        : null;

                      return (
                        <div key={stage.key} className="flex gap-4">
                          <div className="flex flex-col items-center">
                            <div
                              className={`h-10 w-10 rounded-full flex items-center justify-center border-2 shrink-0 ${
                                isDone
                                  ? "border-green-500 bg-green-50 text-green-600"
                                  : isFailedStep
                                  ? "border-red-500 bg-red-50 text-red-600"
                                  : "border-muted-foreground/20 bg-muted/50 text-muted-foreground/40"
                              }`}
                            >
                              {isDone ? (
                                <CheckCircle2 className="h-5 w-5" />
                              ) : isFailedStep ? (
                                <XCircle className="h-5 w-5" />
                              ) : (
                                <Icon className="h-5 w-5" />
                              )}
                            </div>
                            {!isLast && (
                              <div
                                className={`w-0.5 h-8 ${
                                  isDone ? "bg-green-500" : isFailedStep ? "bg-red-300" : "bg-muted-foreground/15"
                                }`}
                              />
                            )}
                          </div>
                          <div className="pt-2 pb-4">
                            <p
                              className={`text-sm font-medium ${
                                isDone
                                  ? "text-green-600"
                                  : isFailedStep
                                  ? "text-red-700"
                                  : "text-muted-foreground/50"
                              }`}
                            >
                              {stage.label}
                              {timeLabel != null && (
                                <span className={`ml-2 text-xs font-normal tabular-nums ${
                                  isDone ? "text-green-600" : isFailedStep ? "text-red-600" : "text-muted-foreground"
                                }`}>
                                  {timeLabel}
                                </span>
                              )}
                            </p>
                            {isFailedStep && (
                              <p className="text-xs text-red-600 mt-0.5">
                                This step failed. Retry will resume from here.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-border">
                      <Button
                        onClick={handleRetry}
                        disabled={retrying}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        {retrying ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Retrying...</>
                        ) : (
                          <><RefreshCw className="mr-2 h-4 w-4" /> Retry from{failedStepLabel ? ` ${failedStepLabel}` : " failed step"}
                          </>
                        )}
                      </Button>
                      <Button variant="outline" onClick={() => router.back()}>
                        Go Back
                      </Button>
                    </div>
                    {failedStepLabel && (
                      <p className="text-xs text-muted-foreground mt-3">
                        Completed steps (Script, Voiceover) will be reused. Generation will continue from {failedStepLabel}.
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STORYLINE (always visible when script exists) ── */}
      {video.scriptText && (
        <Card className="mt-6">
          <CardContent className="p-6">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Storyline
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {isInProgress
                ? "Your approved script — the AI is turning this into a video right now."
                : isFailed
                ? "The script that was being processed when the error occurred."
                : "The script used to generate this video."}
            </p>
            <div className="rounded-md bg-muted/50 p-4">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {video.scriptText}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
