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
  Send,
  RefreshCw,
  Check,
  Play,
  SquareCheck,
  Square,
  Link2,
  Pencil,
  X,
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

const stages = [
  { key: "SCRIPT", label: "Script", detail: "AI is writing your narration", icon: FileText },
  { key: "TTS", label: "Voiceover", detail: "Generating AI voiceover", icon: Mic },
  { key: "IMAGES", label: "Images", detail: "Creating scene visuals", icon: ImageIcon },
  { key: "ASSEMBLY", label: "Assembly", detail: "Building video with Ken Burns + captions + music", icon: Clapperboard },
  { key: "UPLOADING", label: "Finalize", detail: "Saving your video", icon: Upload },
];

function humanizePublishError(raw: string): string {
  const lower = raw.toLowerCase();

  // Meta / Instagram / Facebook specific
  if (lower.includes("rate limited by meta") || lower.includes("api access blocked"))
    return "Rate limited by Meta — too many posts in 24 hours. Wait a few hours and retry.";
  if (lower.includes("app id") && lower.includes("mismatch"))
    return "App ID mismatch — please disconnect & reconnect this platform in Channels.";
  if (lower.includes("copyright"))
    return "Platform detected copyrighted content in this video.";
  if (lower.includes("spam") || lower.includes("restricted"))
    return "Platform flagged your account as spam/restricted. Check your account status directly.";
  if (lower.includes("minimum interval") || lower.includes("posting too fast"))
    return "Posts are too frequent. Wait 5–10 minutes between uploads.";

  // YouTube specific
  if (lower.includes("quota") && lower.includes("youtube"))
    return "YouTube daily upload quota exceeded. Resets at midnight Pacific Time — try tomorrow.";
  if (lower.includes("channel not found"))
    return "YouTube channel not found. Ensure your connected account has an active channel.";

  // General auth / connection
  if (lower.includes("token") && (lower.includes("expired") || lower.includes("invalid") || lower.includes("revoked")))
    return "Account session expired or revoked. Please reconnect your account in Channels.";
  if (lower.includes("not connected") || lower.includes("no account"))
    return "No account connected for this platform. Connect one in Channels.";
  if (lower.includes("permission") || lower.includes("forbidden") || lower.includes("scope") || lower.includes("not authorized"))
    return "Insufficient permissions. Please reconnect your account with full access in Channels.";

  // Rate / quota
  if (lower.includes("rate limit") || lower.includes("too many"))
    return "Too many posts in a short time. Wait a few minutes and try again.";
  if (lower.includes("quota") || lower.includes("limit exceeded"))
    return "Platform upload quota exceeded. Try again tomorrow.";

  // Content issues
  if (lower.includes("duplicate") || lower.includes("already posted"))
    return "This video was already posted to this platform.";
  if (lower.includes("file") && lower.includes("size"))
    return "Video file is too large for this platform.";
  if (lower.includes("video") && lower.includes("not found"))
    return "Video file is missing. Try regenerating the video first.";

  // Network
  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("timeout") || lower.includes("econnreset"))
    return "Network error. Check your internet connection and try again.";

  // If the backend already classified, it may contain "(Original: ...)" — strip it for UI
  const origIdx = raw.indexOf("(Original:");
  if (origIdx > 0) return raw.slice(0, origIdx).trim();

  if (raw.length > 150) return raw.slice(0, 147) + "...";
  return raw;
}

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      next.set(platform, humanizePublishError(error));
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
    const keys = platforms ?? ["YOUTUBE", "INSTAGRAM", "FACEBOOK"];
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
      queryClient.invalidateQueries({ queryKey: ["video", id] });
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

  async function handlePublishPlatform(platform: string) {
    markPublishing(platform);
    clearFailure(platform);
    setPublishResults(null);
    try {
      const res = await fetch(`/api/videos/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: [platform] }),
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

  async function handlePublishAll(platforms: string[]) {
    markPublishing(...platforms);
    clearFailure(...platforms);
    setPublishResults(null);
    try {
      const res = await fetch(`/api/videos/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms }),
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

  const [queuedTimedOut, setQueuedTimedOut] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const queuedSince = useRef<number | null>(null);

  const { data: video, isLoading } = useQuery({
    queryKey: ["video", id],
    queryFn: async () => {
      const res = await fetch(`/api/videos/${id}`);
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
        return stage === "IMAGES" ? 10000 : 15000;
      }
      if (status === "READY" || status === "POSTED") return 30000;
      return false;
    },
  });

  useEffect(() => {
    if (publishingPlatforms.size === 0 || !video) return;
    const postedRaw = (video.postedPlatforms ?? []) as (
      | string
      | { platform: string; success?: boolean | "uploading" }
    )[];
    const doneSet = new Set(
      postedRaw
        .filter((p) => {
          if (typeof p === "string") return true;
          if (p.success === true || p.success === false) return true;
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
  const isReady = video.status === "READY" || video.status === "POSTED";
  const isFailed = video.status === "FAILED";

  const currentStageIndex = video.generationStage
    ? stages.findIndex((s) => s.key === video.generationStage)
    : -1;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold truncate flex-1">{video.title || "Video"}</h1>
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
                        {isDone && (
                          <span className="ml-2 text-xs font-normal text-green-500">
                            Done
                          </span>
                        )}
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

          {/* Audio player */}
          <Card>
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Mic className="h-4 w-4" />
              <span className="text-sm font-medium">Voiceover</span>
            </div>
            <CardContent className="p-4">
              <audio controls className="w-full" src={`/api/videos/${video.id}/audio`} preload="metadata" />
            </CardContent>
          </Card>

          {/* Image review grid */}
          <Card>
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
          </Card>

          {/* Proceed button */}
          <div className="flex items-center justify-between gap-4">
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
          </div>
        </div>
      )}

      {/* ── READY: VIDEO PLAYER ── */}
      {isReady && (
        <div className="space-y-6">
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
          </Card>

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
            ] as const;

            type ServerEntry = { platform: string; success?: boolean | "uploading"; postId?: string; url?: string; error?: string };
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
              return entry.success === false && connectedSet.has(p.key);
            });

            return (
              <Card className="mt-4">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Publish</h3>
                    <div className="flex gap-2">
                      {[...serverMap.values()].some((e) => e.success === true) && (
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
                      )}
                      {postablePlatforms.length > 1 && (() => {
                        const anyServerFail = postablePlatforms.some((p) => serverMap.get(p.key)?.success === false);
                        const anyClientFail = postablePlatforms.some((p) => failedPublishes.has(p.key));
                        const anyFailed = anyServerFail || anyClientFail;
                        return (
                          <Button
                            size="sm"
                            variant={anyFailed ? "destructive" : "outline"}
                            disabled={postablePlatforms.every((p) => publishingPlatforms.has(p.key))}
                            onClick={() => handlePublishAll(postablePlatforms.filter((p) => !publishingPlatforms.has(p.key)).map((p) => p.key))}
                          >
                            {postablePlatforms.some((p) => publishingPlatforms.has(p.key)) ? (
                              <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Publishing...</>
                            ) : anyFailed ? (
                              <><RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry All</>
                            ) : (
                              <><Send className="mr-1 h-3.5 w-3.5" /> Post to All</>
                            )}
                          </Button>
                        );
                      })()}
                    </div>
                  </div>

                  {PLATFORMS.map(({ key, label, icon: Icon, color }) => {
                    const entry = serverMap.get(key);
                    const isPosted = entry?.success === true;
                    const isUploading = entry?.success === "uploading";
                    const isServerFailed = entry?.success === false;
                    const postUrl = isPosted ? (entry.url ?? undefined) : undefined;
                    const connected = connectedSet.has(key);
                    const isPublishing = publishingPlatforms.has(key);
                    const clientFailError = failedPublishes.get(key);
                    const serverFailError = isServerFailed ? entry.error : undefined;
                    const failError = clientFailError || serverFailError;
                    const hasFailed = (isServerFailed || !!clientFailError) && !isPublishing && !isPosted;
                    const isEditingThisLink = editingLink === key;

                    let rowBg = "";
                    if (isPosted) rowBg = "bg-green-50 border-green-200";
                    else if (isUploading || isPublishing) rowBg = "bg-blue-50/60 border-blue-200";
                    else if (hasFailed) rowBg = "bg-red-50/60 border-red-200";

                    return (
                      <div key={key} className={`rounded-lg border p-3 transition-colors ${rowBg}`}>
                        <div className="flex items-center gap-3">
                          <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">{label}</span>
                            {isPosted && postUrl && !isEditingThisLink && (
                              <div className="flex items-center gap-1 mt-0.5">
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
                                  className="text-green-600 hover:text-green-800 shrink-0"
                                  title="Edit link"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                            {isPosted && !postUrl && !isEditingThisLink && (
                              <button
                                type="button"
                                onClick={() => { setEditingLink(key); setLinkInput(""); setLinkError(""); }}
                                className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 mt-0.5"
                              >
                                <Link2 className="h-3 w-3" /> Add link
                              </button>
                            )}
                            {(isUploading || isPublishing) && !isPosted && (
                              <p className="text-xs text-blue-600 mt-0.5">Uploading to {label}...</p>
                            )}
                            {hasFailed && failError && (
                              <p className="text-xs text-red-600 mt-0.5">{humanizePublishError(failError)}</p>
                            )}
                            {!connected && !isPosted && !isUploading && !hasFailed && (
                              <p className="text-xs text-muted-foreground">Not connected</p>
                            )}
                          </div>
                          <div className="shrink-0">
                            {isPosted ? (
                              <div className="flex items-center gap-2">
                                <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                                  <CheckCircle2 className="h-4 w-4" /> Posted
                                </span>
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
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading
                              </span>
                            ) : connected ? (
                              <Button
                                size="sm"
                                variant={hasFailed ? "destructive" : "outline"}
                                className={hasFailed ? "gap-1.5" : ""}
                                disabled={isPublishing}
                                onClick={() => handlePublishPlatform(key)}
                                title={hasFailed ? failError : undefined}
                              >
                                {isPublishing ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : hasFailed ? (
                                  <><RefreshCw className="h-3.5 w-3.5" /> Retry</>
                                ) : (
                                  <><Send className="mr-1 h-3.5 w-3.5" /> Post</>
                                )}
                              </Button>
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

          {/* Scene images gallery */}
          {video.sceneImages && (video.sceneImages as string[]).length > 0 && (
            <Card className="mt-6">
              <div className="px-6 py-3 border-b flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                <span className="text-sm font-medium">Scene Images</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {(video.sceneImages as string[]).length} scenes
                </span>
              </div>
              <CardContent className="p-4">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {(video.sceneImages as string[]).map((url: string, i: number) => (
                    <div
                      key={url}
                      className="relative aspect-[9/16] rounded-md overflow-hidden bg-muted border group cursor-pointer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Scene ${i + 1}`}
                        className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                      <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5">
                        {i + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── FAILED ── */}
      {isFailed && (
        <Card className="border-red-200">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-red-200 bg-red-50">
            <XCircle className="h-4 w-4 text-red-600" />
            <span className="text-sm font-medium text-red-700">
              Generation failed
            </span>
          </div>
          <CardContent className="py-8">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {video.errorMessage || "An unknown error occurred."}
              </p>
              <div className="flex gap-3 justify-center mt-6">
                <Button
                  onClick={handleRetry}
                  disabled={retrying}
                >
                  {retrying ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Retrying...</>
                  ) : (
                    <><Film className="mr-2 h-4 w-4" /> Retry Generation</>
                  )}
                </Button>
                <Button variant="outline" onClick={() => router.back()}>
                  Go Back
                </Button>
              </div>
            </div>

            {/* Show which stages completed before failure */}
            {video.generationStage && (
              <div className="mt-6 pt-6 border-t">
                <p className="text-xs text-muted-foreground mb-3">
                  Progress before failure:
                </p>
                <div className="flex gap-2">
                  {stages.map((stage, i) => {
                    const failedAt = stages.findIndex(
                      (s) => s.key === video.generationStage
                    );
                    return (
                      <div
                        key={stage.key}
                        className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                          i < failedAt
                            ? "bg-green-100 text-green-700"
                            : i === failedAt
                            ? "bg-red-100 text-red-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {i < failedAt ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : i === failedAt ? (
                          <XCircle className="h-3 w-3" />
                        ) : null}
                        {stage.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
