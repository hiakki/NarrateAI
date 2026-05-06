"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Film,
  Cookie,
  ArrowRight,
  LogIn,
  Loader2,
  Play,
  RotateCcw,
  Check,
  CheckCircle2,
  X,
  RefreshCcw,
  Image as ImageIcon,
  Video as VideoIcon,
  Trash2,
  Sparkles,
  AlertTriangle,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

interface ImagePrompt {
  title: string;
  prompt: string;
  dialogueHi?: string;
  dialogueRoman?: string;
  bgmCue?: string;
  sfxCue?: string;
}
interface Storyline {
  title: string;
  logline: string;
  protagonist?: string;
  characterPrompt: string;
  imagePrompts: ImagePrompt[];
  imageCount: number;
  niche?: string;
  language?: "hindi" | "english";
  characterStyle?: "cartoon_3d" | "photoreal";
  aspectRatio?: "9:16" | "16:9";
}

type FlowLanguage = "hindi" | "english";
type FlowNiche = "zero-to-hero" | "funny" | "moral" | "horror" | "mythological";
type FlowCharacterStyle = "cartoon_3d" | "photoreal";
type FlowAspectRatio = "9:16" | "16:9";
type FlowStorylineSource = "api" | "web";
interface RunEvent {
  ts: number;
  stage: string;
  message: string;
  level: "info" | "warn" | "error";
}
interface RunUrls {
  characterUrl?: string;
  imageUrls: (string | undefined)[];
  clipUrls: (string | undefined)[];
  finalVideoUrl?: string;
}
interface FlowRun {
  id: string;
  createdAt: number;
  updatedAt: number;
  userId: string;
  niche: FlowNiche;
  triggerSource: string;
  imageCount: number;
  clipCount: number;
  veoVariant: "Lite" | "Fast" | "Quality";
  approvalMode:
    | "auto"
    | "storyline"
    | "storyline+images"
    | "storyline+images+clips";
  storyTitleHint?: string;
  storySlug?: string;
  projectName?: string;
  runDir: string;
  stage: string;
  stageStartedAt: number;
  stageUpdatedAt: number;
  lastMessage: string;
  error?: string;
  storyline?: Storyline;
  characterPath?: string;
  imagePaths?: string[];
  clipPaths?: string[];
  finalVideoPath?: string;
  videoId?: string;
  events: RunEvent[];
  urls?: RunUrls;
  // Creative options.
  language?: FlowLanguage;
  characterStyle?: FlowCharacterStyle;
  aspectRatio?: FlowAspectRatio;
  dialogue?: boolean;
  bgm?: boolean;
  sfx?: boolean;
  subtitles?: boolean;
  useRecurringCharacter?: boolean;
  adoptedFromRunId?: string;
  storylineSource?: FlowStorylineSource;
}

const NICHE_LABELS: Record<FlowNiche, string> = {
  "zero-to-hero": "Zero-to-Hero",
  funny: "Funny / Comedy",
  moral: "Moral / Fable",
  horror: "Horror / Suspense",
  mythological: "Mythological",
};

const CHARACTER_STYLE_LABELS: Record<FlowCharacterStyle, string> = {
  cartoon_3d: "Cartoon 3D (Pixar-like)",
  photoreal: "Photoreal",
};

const APPROVAL_MODES: Array<{
  id: FlowRun["approvalMode"];
  label: string;
  desc: string;
}> = [
  {
    id: "auto",
    label: "Full auto",
    desc: "No gates. Generate end-to-end without human review.",
  },
  {
    id: "storyline",
    label: "1 gate — storyline",
    desc: "Pause for storyline approval, then run all images + clips.",
  },
  {
    id: "storyline+images",
    label: "2 gates — storyline + images",
    desc: "Approve storyline, then approve images, then run clips.",
  },
  {
    id: "storyline+images+clips",
    label: "3 gates — storyline + images + clips",
    desc: "Approve every stage. Maximum control (default).",
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtAgo(ts?: number): string {
  if (!ts) return "—";
  const ms = Date.now() - ts;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleString();
}

function stageLabel(stage: string): { label: string; tone: "info" | "ok" | "warn" | "err" } {
  switch (stage) {
    case "queued": return { label: "Queued", tone: "info" };
    case "generating_storyline": return { label: "Generating storyline", tone: "info" };
    case "awaiting_storyline_approval": return { label: "Awaiting storyline approval", tone: "warn" };
    case "generating_images": return { label: "Generating images", tone: "info" };
    case "awaiting_images_approval": return { label: "Awaiting images approval", tone: "warn" };
    case "generating_clips": return { label: "Generating clips", tone: "info" };
    case "awaiting_clips_approval": return { label: "Awaiting clips approval", tone: "warn" };
    case "stitching": return { label: "Stitching final video", tone: "info" };
    case "finalizing": return { label: "Finalizing — creating Video row", tone: "info" };
    case "done": return { label: "Done", tone: "ok" };
    case "error": return { label: "Error", tone: "err" };
    default: return { label: stage, tone: "info" };
  }
}

function toneClass(tone: "info" | "ok" | "warn" | "err"): string {
  switch (tone) {
    case "ok": return "bg-emerald-500/15 text-emerald-300 border-emerald-700/40";
    case "warn": return "bg-amber-500/15 text-amber-300 border-amber-700/40";
    case "err": return "bg-red-500/15 text-red-300 border-red-700/40";
    default: return "bg-sky-500/15 text-sky-300 border-sky-700/40";
  }
}

// ─── main page ────────────────────────────────────────────────────────────────

interface FlowCookieStatus {
  exists: boolean;
  cookieCount: number;
  savedAt: string | null;
  earliestExpiry: string | null;
  envConfigured: boolean;
}

export default function FlowTvPage() {
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginMsg, setLoginMsg] = useState("");
  const [cookieStatus, setCookieStatus] = useState<FlowCookieStatus | null>(null);
  const [clearing, setClearing] = useState(false);

  const [imageCount, setImageCount] = useState(3);
  const [veoVariant, setVeoVariant] = useState<FlowRun["veoVariant"]>("Lite");
  const [approvalMode, setApprovalMode] =
    useState<FlowRun["approvalMode"]>("storyline+images+clips");
  const [storyTitleHint, setStoryTitleHint] = useState("");
  const [language, setLanguage] = useState<FlowLanguage>("hindi");
  const [niche, setNiche] = useState<FlowNiche>("funny");
  const [characterStyle, setCharacterStyle] =
    useState<FlowCharacterStyle>("cartoon_3d");
  const [aspectRatio, setAspectRatio] = useState<FlowAspectRatio>("9:16");
  const [dialogue, setDialogue] = useState(true);
  const [bgm, setBgm] = useState(true);
  const [sfx, setSfx] = useState(true);
  const [subtitles, setSubtitles] = useState(false);
  const [useRecurringCharacter, setUseRecurringCharacter] = useState(false);
  const [storylineSource, setStorylineSource] =
    useState<FlowStorylineSource>("web");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  function applyBandarApnaDostPreset() {
    setLanguage("hindi");
    setNiche("funny");
    setCharacterStyle("cartoon_3d");
    setAspectRatio("9:16");
    setDialogue(true);
    setBgm(true);
    setSfx(true);
    setSubtitles(true);
    setImageCount(5);
  }

  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [activeRun, setActiveRun] = useState<FlowRun | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── data fetching ──────────────────────────────────────────────────────────

  const fetchRuns = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard/flow-tv/runs");
      const j = await r.json();
      if (Array.isArray(j?.data)) setRuns(j.data as FlowRun[]);
    } catch {
      // ignore
    }
  }, []);

  const fetchActive = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/dashboard/flow-tv/runs/${id}`);
      const j = await r.json();
      if (j?.data) setActiveRun(j.data as FlowRun);
    } catch {
      // ignore
    }
  }, []);

  const fetchCookieStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/settings/flow-cookies");
      const j = await r.json();
      if (j?.data) setCookieStatus(j.data as FlowCookieStatus);
    } catch {
      // ignore
    }
  }, []);

  // Bootstrap: fetch runs + cookie status; pick most recent un-finished run.
  useEffect(() => {
    (async () => {
      await Promise.all([fetchRuns(), fetchCookieStatus()]);
    })();
  }, [fetchRuns, fetchCookieStatus]);

  // Auto-pick an in-progress run if no run is currently selected.
  useEffect(() => {
    if (activeRunId) return;
    const inflight = runs.find(
      (r) => r.stage !== "done" && r.stage !== "error",
    );
    if (inflight) setActiveRunId(inflight.id);
  }, [runs, activeRunId]);

  // Poll the active run while it's in flight.
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!activeRunId) return;
    fetchActive(activeRunId);
    pollRef.current = setInterval(() => {
      fetchActive(activeRunId);
      fetchRuns();
    }, 2500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeRunId, fetchActive, fetchRuns]);

  // ── login ──────────────────────────────────────────────────────────────────

  async function startGoogleLogin() {
    setLoggingIn(true);
    setLoginMsg("Starting Google login flow…");
    try {
      const res = await fetch("/api/settings/flow-cookies/extract", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setLoginMsg(json.error || "Failed to start login");
        setLoggingIn(false);
        return;
      }
      setLoginMsg(json.data?.message || "Waiting for login…");
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const sRes = await fetch("/api/settings/flow-cookies/extract");
        const sJson = await sRes.json();
        const d = sJson.data;
        if (!d) continue;
        if (d.status === "done") {
          setLoginMsg(d.message || "Flow cookies saved.");
          setLoggingIn(false);
          await fetchCookieStatus();
          return;
        }
        if (d.status === "error") {
          setLoginMsg(d.message || "Login failed.");
          setLoggingIn(false);
          return;
        }
        if (d.status === "in_progress") {
          setLoginMsg(d.message || "Waiting for Google login…");
        }
      }
      setLoginMsg("Timed out waiting for Google login.");
      setLoggingIn(false);
    } catch {
      setLoginMsg("Network error while starting login.");
      setLoggingIn(false);
    }
  }

  async function clearCookies() {
    if (!window.confirm("Sign out of Flow TV and delete saved cookies?")) return;
    setClearing(true);
    try {
      await fetch("/api/settings/flow-cookies", { method: "DELETE" });
      setLoginMsg("");
      await fetchCookieStatus();
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  }

  // ── new run ────────────────────────────────────────────────────────────────

  async function createRun() {
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/dashboard/flow-tv/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageCount,
          veoVariant,
          approvalMode,
          storyTitleHint: storyTitleHint.trim() || undefined,
          niche,
          language,
          characterStyle,
          aspectRatio,
          dialogue,
          bgm,
          sfx,
          subtitles,
          useRecurringCharacter,
          storylineSource,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCreateError(json?.error ?? "Failed to create run");
        setCreating(false);
        return;
      }
      const run = json.data as FlowRun;
      setActiveRunId(run.id);
      await fetchRuns();
      setStoryTitleHint("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function deleteOneRun(runId: string) {
    if (deletingIds.has(runId)) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Delete this run? Local images, clips, screenshots, and the final MP4 will be permanently removed. Flow TV gallery tiles in your Google Labs project are NOT touched.",
      );
      if (!ok) return;
    }
    setDeletingIds((prev) => new Set(prev).add(runId));
    setDeleteError("");
    try {
      const res = await fetch(`/api/dashboard/flow-tv/runs/${runId}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      if (activeRunId === runId) {
        setActiveRunId(null);
        setActiveRun(null);
      }
      await fetchRuns();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  }

  async function deleteAllRuns() {
    if (deletingAll) return;
    if (runs.length === 0) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Delete ALL ${runs.length} run(s)? Local images, clips, and final MP4s will be permanently removed. Runs currently mid-render will be skipped. This cannot be undone.`,
      );
      if (!ok) return;
    }
    setDeletingAll(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/dashboard/flow-tv/runs", {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      setActiveRunId(null);
      setActiveRun(null);
      await fetchRuns();
      const { deleted = 0, skipped = 0 } = json?.data ?? {};
      if (skipped > 0) {
        setDeleteError(
          `Deleted ${deleted}; skipped ${skipped} mid-render run(s) — try again once they settle.`,
        );
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingAll(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Film className="h-7 w-7" />
          Flow TV
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Web-scraper Flow TV pipeline: pick a niche, language, character
          style, and aspect ratio; Veo 3.1 bakes dialogue / BGM / SFX, and
          ffmpeg burns romanized subtitles on top. Configurable approval
          gates for human-in-the-loop control.
        </p>
      </div>

      {/* Login */}
      <Card
        className={
          cookieStatus?.exists
            ? "border-emerald-700/40 bg-emerald-500/5"
            : ""
        }
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Google Login + Cookie Setup
                {cookieStatus?.exists ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700/40 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    Logged in
                  </span>
                ) : null}
              </CardTitle>
              <CardDescription>
                Flow TV does not support API access. We sign in via Puppeteer and
                persist your Google session cookies.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {cookieStatus?.exists ? (
            <div className="rounded-md border border-emerald-700/40 bg-emerald-500/10 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Flow TV session active
              </div>
              <div className="mt-1 text-xs text-emerald-200/80">
                {cookieStatus.cookieCount} cookies saved
                {cookieStatus.savedAt
                  ? ` · ${fmtAgo(new Date(cookieStatus.savedAt).getTime())}`
                  : null}
                {cookieStatus.earliestExpiry
                  ? ` · earliest expiry ${new Date(
                      cookieStatus.earliestExpiry,
                    ).toLocaleDateString()}`
                  : null}
              </div>
            </div>
          ) : (
            <div className="rounded-md border p-3 text-sm bg-muted/40">
              No Flow TV cookies saved yet. Click below to sign in via a
              puppeteer-controlled Chrome window. Cookies are saved to{" "}
              <code className="font-mono text-xs">data/flow-cookies.json</code>{" "}
              and reused on every Flow run.
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <Button
              onClick={startGoogleLogin}
              disabled={loggingIn}
              variant={cookieStatus?.exists ? "outline" : "default"}
            >
              {loggingIn ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : cookieStatus?.exists ? (
                <RefreshCcw className="mr-2 h-4 w-4" />
              ) : (
                <LogIn className="mr-2 h-4 w-4" />
              )}
              {loggingIn
                ? "Waiting for login…"
                : cookieStatus?.exists
                  ? "Re-login (refresh cookies)"
                  : "Login with Google for Flow"}
            </Button>
            {cookieStatus?.exists ? (
              <Button
                onClick={clearCookies}
                disabled={loggingIn || clearing}
                variant="outline"
              >
                {clearing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Clear cookies
              </Button>
            ) : null}
            <Button asChild variant="ghost">
              <Link href="/dashboard/settings">
                <Cookie className="mr-2 h-4 w-4" />
                Settings
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            {loginMsg ? (
              <span className="text-xs text-muted-foreground">{loginMsg}</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* New Run */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start a new Flow TV video</CardTitle>
          <CardDescription>
            Each run gets its own Flow TV project (
            <code className="font-mono">&lt;story-slug&gt;-DDMMYYYY</code>) and is
            queued sequentially — only one Flow TV browser session runs at a
            time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase">Approval gates</Label>
              <div className="space-y-1">
                {APPROVAL_MODES.map((m) => (
                  <label
                    key={m.id}
                    className={`flex items-start gap-2 rounded-md border p-2 text-xs cursor-pointer ${
                      approvalMode === m.id
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="approvalMode"
                      checked={approvalMode === m.id}
                      onChange={() => setApprovalMode(m.id)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-medium">{m.label}</div>
                      <div className="text-muted-foreground">{m.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs uppercase" htmlFor="imageCount">
                  Number of scenes
                </Label>
                <Input
                  id="imageCount"
                  type="number"
                  min={2}
                  max={12}
                  value={imageCount}
                  onChange={(e) =>
                    setImageCount(
                      Math.max(2, Math.min(12, Number(e.target.value) || 3)),
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Clips = scenes − 1. Final duration ≈ clips × 8s.
                </p>
                {imageCount > 6 ? (
                  <p className="text-xs flex items-center gap-1 text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    {imageCount - 1} clips ≈ {imageCount - 1} Veo {veoVariant}{" "}
                    credits per render
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase">Veo variant</Label>
                <div className="flex gap-1">
                  {(["Lite", "Fast", "Quality"] as const).map((v) => (
                    <Button
                      key={v}
                      size="sm"
                      type="button"
                      variant={veoVariant === v ? "default" : "outline"}
                      onClick={() => setVeoVariant(v)}
                    >
                      {v}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Lite = cheapest credits, Quality = best fidelity.
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase">Storyline source</Label>
                <div className="flex gap-1">
                  {(
                    [
                      { id: "api", label: "Gemini Flash API" },
                      { id: "web", label: "Gemini 3 Fast (web)" },
                    ] as const
                  ).map((s) => (
                    <Button
                      key={s.id}
                      size="sm"
                      type="button"
                      variant={storylineSource === s.id ? "default" : "outline"}
                      onClick={() => setStorylineSource(s.id)}
                    >
                      {s.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {storylineSource === "web"
                    ? "Drives gemini.google.com via Puppeteer (uses Flow login). Bypasses API 503s."
                    : "Direct API call to Gemini Flash. Fast but can 503 during peak demand."}
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase" htmlFor="titleHint">
                  Title hint (optional)
                </Label>
                <Input
                  id="titleHint"
                  placeholder="e.g. Iron Bar Hero"
                  value={storyTitleHint}
                  onChange={(e) => setStoryTitleHint(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Creative options — niche, language, style, ratio */}
          <div className="rounded-md border border-dashed p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-xs uppercase">Creative options</Label>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={applyBandarApnaDostPreset}
                title="Set Hindi / funny / cartoon-3D / 9:16 / dialogue+BGM+SFX+subtitles"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                BandarApnaDost preset
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs uppercase" htmlFor="language">
                  Language
                </Label>
                <select
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as FlowLanguage)}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="hindi">Hindi</option>
                  <option value="english">English</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase" htmlFor="niche">
                  Niche
                </Label>
                <select
                  id="niche"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value as FlowNiche)}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  {(Object.keys(NICHE_LABELS) as FlowNiche[]).map((n) => (
                    <option key={n} value={n}>
                      {NICHE_LABELS[n]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase" htmlFor="characterStyle">
                  Character style
                </Label>
                <select
                  id="characterStyle"
                  value={characterStyle}
                  onChange={(e) =>
                    setCharacterStyle(e.target.value as FlowCharacterStyle)
                  }
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  {(Object.keys(CHARACTER_STYLE_LABELS) as FlowCharacterStyle[]).map(
                    (s) => (
                      <option key={s} value={s}>
                        {CHARACTER_STYLE_LABELS[s]}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase">Aspect ratio</Label>
                <div className="flex gap-1">
                  {(["9:16", "16:9"] as const).map((r) => (
                    <Button
                      key={r}
                      size="sm"
                      type="button"
                      variant={aspectRatio === r ? "default" : "outline"}
                      onClick={() => setAspectRatio(r)}
                    >
                      {r}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Audio + caption toggles */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-1">
              {(
                [
                  { id: "dialogue", label: "Dialogue", value: dialogue, set: setDialogue, hint: "Veo lip-syncs" },
                  { id: "bgm", label: "BGM", value: bgm, set: setBgm, hint: "Veo prompts music" },
                  { id: "sfx", label: "SFX", value: sfx, set: setSfx, hint: "Veo native sfx" },
                  { id: "subtitles", label: "Subtitles", value: subtitles, set: setSubtitles, hint: "ffmpeg burn-in" },
                  {
                    id: "recurring",
                    label: "Recurring char",
                    value: useRecurringCharacter,
                    set: setUseRecurringCharacter,
                    hint: "Reuse prior character",
                  },
                ] as const
              ).map((t) => (
                <label
                  key={t.id}
                  className={`flex items-start gap-2 rounded-md border p-2 text-xs cursor-pointer ${
                    t.value
                      ? "border-primary/60 bg-primary/5"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={t.value}
                    onChange={(e) => t.set(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium">{t.label}</div>
                    <div className="text-muted-foreground">{t.hint}</div>
                  </div>
                </label>
              ))}
            </div>

            {language === "hindi" && dialogue ? (
              <p className="text-xs text-muted-foreground">
                Hindi dialogue will be baked into Veo (Devanagari, lip-synced).
                {subtitles
                  ? " Subtitles burn in romanized Hinglish on top of the final MP4."
                  : ""}
              </p>
            ) : null}
            {useRecurringCharacter ? (
              <p className="text-xs text-muted-foreground">
                Will adopt the most recent done run with the same niche +
                language + character style. Falls back to fresh generation if
                none exists.
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={createRun} disabled={creating}>
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {creating ? "Creating…" : "Create Run"}
            </Button>
            {createError ? (
              <span className="text-xs text-red-500">{createError}</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Active Run */}
      {activeRun ? (
        <ActiveRunCard
          run={activeRun}
          onRefresh={() => activeRunId && fetchActive(activeRunId)}
        />
      ) : null}

      {/* History */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Run history</CardTitle>
              <CardDescription>
                Past Flow TV runs. Done runs surface their generated video on
                the main{" "}
                <Link className="underline" href="/dashboard/videos">
                  Videos
                </Link>{" "}
                page.
              </CardDescription>
            </div>
            {runs.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={deleteAllRuns}
                disabled={deletingAll}
                title="Delete every run for the current account. Mid-render runs are skipped."
              >
                {deletingAll ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Delete all ({runs.length})
              </Button>
            ) : null}
          </div>
          {deleteError ? (
            <p className="text-xs text-amber-400 mt-1">{deleteError}</p>
          ) : null}
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="space-y-1">
              {runs.map((r) => {
                const s = stageLabel(r.stage);
                const isActive = r.id === activeRunId;
                const isDeleting = deletingIds.has(r.id);
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveRunId(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveRunId(r.id);
                      }
                    }}
                    aria-pressed={isActive}
                    className={`w-full text-left rounded-md border p-3 transition-colors text-sm flex items-center justify-between gap-2 cursor-pointer ${
                      isActive ? "border-primary/60 bg-primary/5" : "hover:bg-muted/40"
                    } ${isDeleting ? "opacity-50" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {r.storyline?.title ?? r.storyTitleHint ?? "(unnamed)"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.imageCount} scenes · {r.clipCount} clips · {r.veoVariant} ·{" "}
                        {r.approvalMode}
                        {r.niche || r.language || r.aspectRatio ? (
                          <>
                            {" "}
                            ·{" "}
                            <span className="text-muted-foreground/80">
                              {r.niche ?? "niche?"}
                              {r.language ? ` / ${r.language}` : ""}
                              {r.aspectRatio ? ` / ${r.aspectRatio}` : ""}
                              {r.characterStyle === "cartoon_3d" ? " / cartoon" : ""}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`text-xs rounded-full border px-2 py-0.5 ${toneClass(s.tone)}`}
                      >
                        {s.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmtAgo(r.createdAt)}
                      </span>
                      {r.videoId ? (
                        <Link
                          href={`/dashboard/videos/${r.videoId}`}
                          className="text-xs underline text-primary"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open video
                        </Link>
                      ) : null}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-red-500"
                        title="Delete this run"
                        disabled={isDeleting}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteOneRun(r.id);
                        }}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Active run sub-component ─────────────────────────────────────────────────

function ActiveRunCard({
  run,
  onRefresh,
}: {
  run: FlowRun;
  onRefresh: () => void;
}) {
  const s = stageLabel(run.stage);
  const recentEvents = useMemo(
    () => (run.events ?? []).slice(-8).reverse(),
    [run.events],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {run.storyline?.title ?? "Active run"}
            </CardTitle>
            <CardDescription>
              <span className="font-mono text-xs">{run.id}</span> · slug:{" "}
              <span className="font-mono text-xs">{run.storySlug ?? "—"}</span>
            </CardDescription>
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
              <span>{run.niche ?? "?"}</span>
              <span>· {run.language ?? "?"}</span>
              <span>· {run.aspectRatio ?? "?"}</span>
              {run.characterStyle ? <span>· {run.characterStyle}</span> : null}
              <span>
                ·{" "}
                {[
                  run.dialogue ? "dialogue" : null,
                  run.bgm ? "bgm" : null,
                  run.sfx ? "sfx" : null,
                  run.subtitles ? "subs" : null,
                ]
                  .filter(Boolean)
                  .join("+") || "silent"}
              </span>
              {run.useRecurringCharacter ? (
                <span>
                  ·{" "}
                  {run.adoptedFromRunId
                    ? `adopted from ${run.adoptedFromRunId.slice(0, 8)}…`
                    : "recurring character"}
                </span>
              ) : null}
              {run.storylineSource ? (
                <span>
                  · text:{" "}
                  {run.storylineSource === "web"
                    ? "gemini-web"
                    : "gemini-api"}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs rounded-full border px-2 py-0.5 ${toneClass(s.tone)}`}
            >
              {s.label}
            </span>
            <Button size="icon" variant="ghost" onClick={onRefresh}>
              <RefreshCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border p-3 text-sm bg-muted/40">
          <div className="font-mono uppercase text-xs text-muted-foreground">
            {run.stage}
          </div>
          <div>{run.lastMessage}</div>
          {run.error ? (
            <div className="text-xs text-red-400 mt-1 break-words">
              {run.error}
            </div>
          ) : null}
          {run.stage === "error" ? (
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await postAction(run.id, { action: "retry" });
                  onRefresh();
                }}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Retry from last stage
              </Button>
              <span className="text-xs text-muted-foreground">
                Re-runs the failing stage. Existing storyline / images / clips
                are preserved.
              </span>
            </div>
          ) : null}
        </div>

        {/* Stage-specific UIs */}
        {run.stage === "awaiting_storyline_approval" && run.storyline ? (
          <StorylineGate run={run} onRefresh={onRefresh} />
        ) : null}

        {run.stage === "awaiting_images_approval" ? (
          <ImagesGate run={run} onRefresh={onRefresh} />
        ) : null}

        {run.stage === "awaiting_clips_approval" ? (
          <ClipsGate run={run} onRefresh={onRefresh} />
        ) : null}

        {/* Always-visible: storyline summary if ready */}
        {run.storyline && run.stage !== "awaiting_storyline_approval" ? (
          <details className="rounded-md border p-3 text-xs">
            <summary className="font-semibold cursor-pointer">
              Storyline · {run.storyline.title}
            </summary>
            <div className="mt-2 space-y-1">
              <div>
                <span className="font-mono uppercase text-muted-foreground">
                  Logline:{" "}
                </span>
                {run.storyline.logline}
              </div>
              {run.storyline.protagonist ? (
                <div>
                  <span className="font-mono uppercase text-muted-foreground">
                    Protagonist:{" "}
                  </span>
                  {run.storyline.protagonist}
                </div>
              ) : null}
              <div>
                <span className="font-mono uppercase text-muted-foreground">
                  Character:{" "}
                </span>
                {run.storyline.characterPrompt}
              </div>
              <ol className="list-decimal pl-5 mt-1 space-y-1">
                {run.storyline.imagePrompts.map((p, i) => (
                  <li key={i}>
                    <span className="font-mono">{p.title}</span> — {p.prompt}
                    {p.dialogueHi || p.dialogueRoman ? (
                      <div className="text-muted-foreground/80 ml-1 mt-0.5">
                        <span className="font-mono uppercase text-[10px]">
                          dialogue:{" "}
                        </span>
                        {p.dialogueHi}
                        {p.dialogueRoman ? (
                          <span className="opacity-70"> · {p.dialogueRoman}</span>
                        ) : null}
                      </div>
                    ) : null}
                    {p.bgmCue ? (
                      <div className="text-muted-foreground/80 ml-1">
                        <span className="font-mono uppercase text-[10px]">bgm: </span>
                        {p.bgmCue}
                      </div>
                    ) : null}
                    {p.sfxCue ? (
                      <div className="text-muted-foreground/80 ml-1">
                        <span className="font-mono uppercase text-[10px]">sfx: </span>
                        {p.sfxCue}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          </details>
        ) : null}

        {/* Always-visible: image previews if ready */}
        {(run.urls?.characterUrl ||
          (run.urls?.imageUrls && run.urls.imageUrls.some((u) => u))) &&
        run.stage !== "awaiting_images_approval" ? (
          <details className="rounded-md border p-3" open={run.stage !== "done"}>
            <summary className="text-xs font-semibold cursor-pointer">
              <ImageIcon className="inline h-3 w-3 mr-1" />
              Images
            </summary>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {run.urls?.characterUrl ? (
                <Thumb url={run.urls.characterUrl} label="character" />
              ) : null}
              {(run.urls?.imageUrls ?? []).map((u, i) =>
                u ? (
                  <Thumb
                    key={i}
                    url={u}
                    label={`scene ${String(i + 1).padStart(2, "0")}`}
                  />
                ) : null,
              )}
            </div>
          </details>
        ) : null}

        {/* Final video preview when ready */}
        {run.urls?.finalVideoUrl &&
        (run.stage === "awaiting_clips_approval" ||
          run.stage === "finalizing" ||
          run.stage === "done") ? (
          <div className="rounded-md border p-3">
            <div className="text-xs font-semibold mb-2">
              <VideoIcon className="inline h-3 w-3 mr-1" />
              Final video
            </div>
            <video
              key={run.urls.finalVideoUrl}
              controls
              className="w-full rounded-md max-h-96 bg-black"
              src={run.urls.finalVideoUrl}
            />
            {run.videoId ? (
              <div className="mt-2 text-xs">
                Saved to{" "}
                <Link
                  className="underline text-primary"
                  href={`/dashboard/videos/${run.videoId}`}
                >
                  /dashboard/videos/{run.videoId}
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Events log */}
        <details className="rounded-md border p-3 text-xs">
          <summary className="font-semibold cursor-pointer">
            Recent events
          </summary>
          <div className="mt-2 space-y-1 font-mono">
            {recentEvents.map((e, i) => (
              <div
                key={i}
                className={
                  e.level === "error"
                    ? "text-red-400"
                    : e.level === "warn"
                      ? "text-amber-400"
                      : "text-muted-foreground"
                }
              >
                <span className="opacity-60">
                  [{new Date(e.ts).toLocaleTimeString()}]
                </span>{" "}
                <span className="opacity-60">{e.stage}</span> — {e.message}
              </div>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

// ─── Gate sub-components ──────────────────────────────────────────────────────

function Thumb({ url, label }: { url: string; label: string }) {
  return (
    <div className="space-y-1">
      <div className="aspect-video w-full overflow-hidden rounded-md border bg-black/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="text-[10px] uppercase font-mono text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

async function postAction(
  runId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(`/api/dashboard/flow-tv/runs/${runId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: j?.error ?? "Action failed" };
  return { ok: true };
}

function StorylineGate({
  run,
  onRefresh,
}: {
  run: FlowRun;
  onRefresh: () => void;
}) {
  const sl = run.storyline!;
  const [title, setTitle] = useState(sl.title);
  const [logline, setLogline] = useState(sl.logline);
  const [characterPrompt, setCharacterPrompt] = useState(sl.characterPrompt);
  const [busy, setBusy] = useState<"" | "edit" | "refresh" | "approve">("");
  const [err, setErr] = useState("");

  const dirty =
    title !== sl.title ||
    logline !== sl.logline ||
    characterPrompt !== sl.characterPrompt;

  async function save() {
    setBusy("edit");
    setErr("");
    const r = await postAction(run.id, {
      action: "storyline.edit",
      title: dirty && title !== sl.title ? title : undefined,
      logline: dirty && logline !== sl.logline ? logline : undefined,
      characterPrompt:
        dirty && characterPrompt !== sl.characterPrompt
          ? characterPrompt
          : undefined,
    });
    setBusy("");
    if (!r.ok) setErr(r.error ?? "Save failed");
    onRefresh();
  }

  async function refresh() {
    setBusy("refresh");
    setErr("");
    const r = await postAction(run.id, { action: "storyline.refresh" });
    setBusy("");
    if (!r.ok) setErr(r.error ?? "Refresh failed");
    onRefresh();
  }

  async function approve() {
    if (dirty) {
      const ok = window.confirm(
        "Unsaved edits — save before approving?",
      );
      if (ok) await save();
    }
    setBusy("approve");
    setErr("");
    const r = await postAction(run.id, { action: "storyline.approve" });
    setBusy("");
    if (!r.ok) setErr(r.error ?? "Approve failed");
    onRefresh();
  }

  return (
    <div className="rounded-md border p-3 space-y-3 bg-amber-500/5">
      <div className="text-xs font-semibold uppercase text-amber-300">
        Storyline approval gate
      </div>
      <div className="space-y-2">
        <div className="space-y-1">
          <Label className="text-xs">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Logline</Label>
          <Textarea
            rows={2}
            value={logline}
            onChange={(e) => setLogline(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Character prompt</Label>
          <Textarea
            rows={3}
            value={characterPrompt}
            onChange={(e) => setCharacterPrompt(e.target.value)}
          />
        </div>
        <div className="text-xs text-muted-foreground">
          Scene image prompts ({sl.imagePrompts.length}) are read-only at this
          gate. Use <strong>Refresh storyline</strong> to re-roll.
        </div>
        <ol className="list-decimal pl-5 text-xs space-y-0.5">
          {sl.imagePrompts.map((p, i) => (
            <li key={i}>
              <span className="font-mono">{p.title}</span> — {p.prompt}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={save} size="sm" disabled={!dirty || busy !== ""}>
          {busy === "edit" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Save edits
        </Button>
        <Button
          onClick={refresh}
          size="sm"
          variant="outline"
          disabled={busy !== ""}
        >
          {busy === "refresh" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 h-4 w-4" />
          )}
          Refresh storyline
        </Button>
        <Button onClick={approve} size="sm" disabled={busy !== ""}>
          {busy === "approve" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          Approve & continue
        </Button>
        {err ? <span className="text-xs text-red-400">{err}</span> : null}
      </div>
    </div>
  );
}

function ImagesGate({ run, onRefresh }: { run: FlowRun; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");

  async function refreshAsset(kind: "character" | "image", index: number) {
    const k = `${kind}-${index}`;
    setBusy(k);
    setErr("");
    const r = await postAction(run.id, {
      action: "images.refresh",
      kind,
      index,
    });
    setBusy("");
    if (!r.ok) setErr(r.error ?? "Refresh failed");
    onRefresh();
  }

  async function approve() {
    setBusy("approve");
    setErr("");
    const r = await postAction(run.id, { action: "images.approve" });
    setBusy("");
    if (!r.ok) setErr(r.error ?? "Approve failed");
    onRefresh();
  }

  return (
    <div className="rounded-md border p-3 space-y-3 bg-amber-500/5">
      <div className="text-xs font-semibold uppercase text-amber-300">
        Images approval gate
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {run.urls?.characterUrl ? (
          <ImageTile
            url={run.urls.characterUrl}
            label="character"
            busy={busy === "character-1"}
            onRefresh={() => refreshAsset("character", 1)}
          />
        ) : null}
        {(run.urls?.imageUrls ?? []).map((u, i) => {
          const idx = i + 1;
          const k = `image-${idx}`;
          if (!u) return null;
          return (
            <ImageTile
              key={i}
              url={u}
              label={`scene ${String(idx).padStart(2, "0")}`}
              caption={run.storyline?.imagePrompts[i]?.title}
              busy={busy === k}
              onRefresh={() => refreshAsset("image", idx)}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={approve} size="sm" disabled={busy !== ""}>
          {busy === "approve" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          Approve all & generate clips
        </Button>
        {err ? <span className="text-xs text-red-400">{err}</span> : null}
      </div>
    </div>
  );
}

function ImageTile({
  url,
  label,
  caption,
  busy,
  onRefresh,
}: {
  url: string;
  label: string;
  caption?: string;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-black/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {busy ? (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1">
        <div className="text-[10px] uppercase font-mono text-muted-foreground truncate">
          {label}
          {caption ? <span className="opacity-60"> · {caption}</span> : null}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onRefresh}
          disabled={busy}
          title="Refresh this image"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function ClipsGate({ run, onRefresh }: { run: FlowRun; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");

  async function refreshClip(index: number) {
    setBusy(`clip-${index}`);
    setErr("");
    const r = await postAction(run.id, { action: "clips.refresh", index });
    setBusy("");
    if (!r.ok) setErr(r.error ?? "Refresh failed");
    onRefresh();
  }

  async function approve() {
    setBusy("approve");
    setErr("");
    const r = await postAction(run.id, { action: "clips.approve" });
    setBusy("");
    if (!r.ok) setErr(r.error ?? "Approve failed");
    onRefresh();
  }

  return (
    <div className="rounded-md border p-3 space-y-3 bg-amber-500/5">
      <div className="text-xs font-semibold uppercase text-amber-300">
        Clips approval gate
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(run.urls?.clipUrls ?? []).map((u, i) => {
          const idx = i + 1;
          if (!u) return null;
          return (
            <ClipTile
              key={i}
              url={u}
              label={`clip ${String(idx).padStart(2, "0")}`}
              busy={busy === `clip-${idx}`}
              onRefresh={() => refreshClip(idx)}
            />
          );
        })}
      </div>
      <div className="text-xs text-muted-foreground">
        Refreshing any clip will invalidate the final video; approval will
        re-stitch.
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={approve} size="sm" disabled={busy !== ""}>
          {busy === "approve" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          Approve & finalize
        </Button>
        <Button
          onClick={async () => {
            setBusy("cancel");
            await postAction(run.id, { action: "cancel" });
            setBusy("");
            onRefresh();
          }}
          size="sm"
          variant="outline"
          disabled={busy !== ""}
        >
          <X className="mr-2 h-4 w-4" />
          Cancel run
        </Button>
        {err ? <span className="text-xs text-red-400">{err}</span> : null}
      </div>
    </div>
  );
}

function ClipTile({
  url,
  label,
  busy,
  onRefresh,
}: {
  url: string;
  label: string;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-black">
        <video
          src={url}
          controls
          className="w-full h-full object-cover"
          preload="metadata"
        />
        {busy ? (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1">
        <div className="text-[10px] uppercase font-mono text-muted-foreground">
          {label}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onRefresh}
          disabled={busy}
          title="Refresh this clip"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
