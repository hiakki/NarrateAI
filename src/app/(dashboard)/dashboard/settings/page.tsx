"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Check, Cpu, Mic, Image as ImageIcon, Info, Video, Cookie, Upload, Trash2, CheckCircle2, XCircle, ExternalLink, LogIn } from "lucide-react";

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  costEstimate: string;
  qualityLabel: "Good" | "Great" | "Best";
  envVar: string;
}

interface ProvidersData {
  defaults: {
    llmProvider: string | null;
    ttsProvider: string | null;
    imageProvider: string | null;
    imageToVideoProvider: string | null;
  };
  platformDefaults: { llm: string; tts: string; image: string };
  available: {
    llm: ProviderInfo[];
    tts: ProviderInfo[];
    image: ProviderInfo[];
  };
  all: {
    llm: ProviderInfo[];
    tts: ProviderInfo[];
    image: ProviderInfo[];
  };
  imageToVideo?: {
    all: { id: string; name: string; description: string; costEstimate: string; envVar: string }[];
    availableIds: string[];
  };
}

function QualityBadge({ label }: { label: string }) {
  const variant = label === "Best" ? "default" : label === "Great" ? "secondary" : "outline";
  return <Badge variant={variant} className="text-[10px] px-1.5 py-0">{label}</Badge>;
}

function ProviderCard({
  provider,
  isSelected,
  isAvailable,
  isPlatformDefault,
  onSelect,
}: {
  provider: ProviderInfo;
  isSelected: boolean;
  isAvailable: boolean;
  isPlatformDefault: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      className={`flex flex-col cursor-pointer transition-all ${
        !isAvailable
          ? "opacity-50 cursor-not-allowed border-dashed"
          : isSelected
          ? "border-primary ring-2 ring-primary/20"
          : "hover:border-primary/50"
      }`}
      onClick={() => isAvailable && onSelect()}
    >
      <CardContent className="p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-1">
          <div className="font-medium text-sm flex items-center gap-2">
            {provider.name}
            {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
          </div>
          <QualityBadge label={provider.qualityLabel} />
        </div>
        <p className="text-xs text-muted-foreground mb-2 flex-1">{provider.description}</p>
        <div className="flex items-center justify-between mt-auto">
          <span className="text-xs font-mono text-muted-foreground">{provider.costEstimate}</span>
          {!isAvailable && (
            <span className="text-[10px] text-destructive">Not configured</span>
          )}
          {isPlatformDefault && isAvailable && (
            <span className="text-[10px] text-muted-foreground">Platform default</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderSection({
  title,
  icon,
  description,
  allProviders,
  availableIds,
  selectedId,
  platformDefault,
  onSelect,
}: {
  title: string;
  icon: React.ReactNode;
  description: string;
  allProviders: ProviderInfo[];
  availableIds: Set<string>;
  selectedId: string | null;
  platformDefault: string;
  onSelect: (id: string | null) => void;
}) {
  const effectiveId = selectedId ?? platformDefault;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-3">{description}</p>
      {selectedId === null && (
        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
          <Info className="h-3 w-3" /> Using platform default. Click a provider to set your preference.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {allProviders.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            isSelected={effectiveId === p.id}
            isAvailable={availableIds.has(p.id)}
            isPlatformDefault={p.id === platformDefault}
            onSelect={() => onSelect(selectedId === p.id ? null : p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function timeUntil(iso: string): { text: string; warn: boolean } {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return { text: "expired", warn: true };
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return { text: "expires today", warn: true };
  if (days < 3) return { text: `expires in ${days}d`, warn: true };
  if (days < 30) return { text: `expires in ${days}d`, warn: false };
  return { text: `expires in ${Math.floor(days / 30)}mo`, warn: false };
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [providers, setProviders] = useState<ProvidersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [llmProvider, setLlmProvider] = useState<string | null>(null);
  const [ttsProvider, setTtsProvider] = useState<string | null>(null);
  const [imageProvider, setImageProvider] = useState<string | null>(null);
  const [imageToVideoProvider, setImageToVideoProvider] = useState<string | null>(null);

  const [cookieStatus, setCookieStatus] = useState<{ exists: boolean; lineCount: number; envConfigured: boolean; fbConnected?: boolean; igConnected?: boolean; fbCookieCount?: number; igCookieCount?: number; fbSavedAt?: string | null; igSavedAt?: string | null; fbEarliestExpiry?: string | null; igEarliestExpiry?: string | null } | null>(null);
  const [cookieText, setCookieText] = useState("");
  const [cookieSaving, setCookieSaving] = useState(false);
  const [cookieMsg, setCookieMsg] = useState("");
  const [cookieDeleting, setCookieDeleting] = useState(false);
  const [extractingPlatform, setExtractingPlatform] = useState<"facebook" | "instagram" | "both" | null>(null);
  const [extractMsg, setExtractMsg] = useState("");
  const fileInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) node.value = "";
  }, []);

  const fetchCookieStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/cookies");
      const json = await res.json();
      if (json.data) setCookieStatus(json.data);
    } catch { /* ignore */ }
  }, []);

  const handleCookieUpload = useCallback(async (text: string) => {
    setCookieSaving(true);
    setCookieMsg("");
    try {
      const res = await fetch("/api/settings/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookieText: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCookieMsg(json.error || "Failed to save");
        return;
      }
      setCookieMsg(`Saved ${json.data.lineCount} cookie entries`);
      setCookieText("");
      fetchCookieStatus();
      setTimeout(() => setCookieMsg(""), 4000);
    } catch {
      setCookieMsg("Network error");
    } finally {
      setCookieSaving(false);
    }
  }, [fetchCookieStatus]);

  const handleCookieExtract = useCallback(async (platform: "facebook" | "instagram" | "both") => {
    setExtractingPlatform(platform);
    setExtractMsg(`Opening browser for ${platform === "facebook" ? "Facebook" : "Instagram"} login...`);
    setCookieMsg("");
    try {
      const res = await fetch("/api/settings/cookies/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const json = await res.json();
      if (!res.ok) {
        setExtractMsg(json.error || "Failed to start");
        setExtractingPlatform(null);
        return;
      }
      setExtractMsg(json.data?.message || "Browser opening...");

      const poll = async () => {
        for (let i = 0; i < 160; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const statusRes = await fetch("/api/settings/cookies/extract");
            const statusJson = await statusRes.json();
            const d = statusJson.data;
            if (!d) continue;
            if (d.status === "done") {
              setExtractMsg(`Done! ${d.cookieCount} cookies saved.`);
              setExtractingPlatform(null);
              fetchCookieStatus();
              setTimeout(() => setExtractMsg(""), 5000);
              return;
            }
            if (d.status === "error") {
              setExtractMsg(d.message || "Extraction failed");
              setExtractingPlatform(null);
              return;
            }
            if (d.status === "in_progress") {
              setExtractMsg(d.message || "Waiting for login...");
            }
          } catch { /* retry */ }
        }
        setExtractMsg("Timed out waiting for login.");
        setExtractingPlatform(null);
      };
      poll();
    } catch {
      setExtractMsg("Network error");
      setExtractingPlatform(null);
    }
  }, [fetchCookieStatus]);

  const handleCookieDelete = useCallback(async () => {
    setCookieDeleting(true);
    try {
      await fetch("/api/settings/cookies", { method: "DELETE" });
      setCookieStatus({ exists: false, lineCount: 0, envConfigured: cookieStatus?.envConfigured ?? false });
      setCookieMsg("");
    } catch { /* ignore */ } finally {
      setCookieDeleting(false);
    }
  }, [cookieStatus?.envConfigured]);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/providers");
      const json = await res.json();
      if (json.data) {
        setProviders(json.data);
        setLlmProvider(json.data.defaults.llmProvider);
        setTtsProvider(json.data.defaults.ttsProvider);
        setImageProvider(json.data.defaults.imageProvider);
        setImageToVideoProvider(json.data.defaults.imageToVideoProvider ?? null);
      }
    } catch (err) {
      console.error("Failed to load providers:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
    fetchCookieStatus();
  }, [fetchProviders, fetchCookieStatus]);

  async function handleSave() {
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch("/api/settings/providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmProvider,
          ttsProvider,
          imageProvider,
          imageToVideoProvider: imageToVideoProvider ?? "",
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveMessage("Preferences saved");
      setDirty(false);
      setTimeout(() => setSaveMessage(""), 3000);
    } catch {
      setSaveMessage("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const availableLlm = new Set(providers?.available.llm.map((p) => p.id) ?? []);
  const availableTts = new Set(providers?.available.tts.map((p) => p.id) ?? []);
  const availableImage = new Set(providers?.available.image.map((p) => p.id) ?? []);
  const availableImageToVideo = new Set(providers?.imageToVideo?.availableIds ?? [""]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold">Settings</h1>
      <p className="mt-1 text-muted-foreground">Manage your account and AI provider preferences.</p>

      <div className="mt-8 space-y-6">
        {/* Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span>{session?.user?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span>{session?.user?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Role</span>
              <span className="capitalize">{(session?.user as unknown as Record<string, string>)?.role?.toLowerCase()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span className="capitalize">{(session?.user as unknown as Record<string, string>)?.plan?.toLowerCase()}</span>
            </div>
          </CardContent>
        </Card>

        {/* Provider Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>AI Provider Preferences</CardTitle>
            <CardDescription>
              Choose which AI services to use for each stage of video generation.
              These become your defaults -- you can override per-series during creation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <ProviderSection
              title="Script Generation"
              icon={<Cpu className="h-4 w-4 text-primary" />}
              description="AI model used to write the narration script and scene descriptions."
              allProviders={providers?.all.llm ?? []}
              availableIds={availableLlm}
              selectedId={llmProvider}
              platformDefault={providers?.platformDefaults.llm ?? "GEMINI_FLASH"}
              onSelect={(id) => { setLlmProvider(id); setDirty(true); }}
            />

            <Separator />

            <ProviderSection
              title="Text-to-Speech"
              icon={<Mic className="h-4 w-4 text-primary" />}
              description="Voice engine for generating the voiceover narration."
              allProviders={providers?.all.tts ?? []}
              availableIds={availableTts}
              selectedId={ttsProvider}
              platformDefault={providers?.platformDefaults.tts ?? "GEMINI_TTS"}
              onSelect={(id) => { setTtsProvider(id); setDirty(true); }}
            />

            <Separator />

            <ProviderSection
              title="Image Generation"
              icon={<ImageIcon className="h-4 w-4 text-primary" />}
              description="AI model for generating scene images shown in the video."
              allProviders={providers?.all.image ?? []}
              availableIds={availableImage}
              selectedId={imageProvider}
              platformDefault={providers?.platformDefaults.image ?? "GEMINI_IMAGEN"}
              onSelect={(id) => { setImageProvider(id); setDirty(true); }}
            />

            <Separator />

            <ProviderSection
              title="Final video from"
              icon={<Video className="h-4 w-4 text-primary" />}
              description="Static images only: scene images are stitched into the final video (Ken Burns). Or use AI image-to-video: each scene image becomes a short clip, then clips are stitched with voiceover."
              allProviders={(providers?.imageToVideo?.all ?? []).map((p) => ({
                ...p,
                qualityLabel: "Good" as const,
                envVar: p.envVar,
              }))}
              availableIds={availableImageToVideo}
              selectedId={imageToVideoProvider}
              platformDefault=""
              onSelect={(id) => { setImageToVideoProvider(id || null); setDirty(true); }}
            />

            <div className="flex items-center justify-between pt-2">
              <div className="text-sm">
                {saveMessage && (
                  <span className={saveMessage.includes("Failed") ? "text-destructive" : "text-green-600"}>
                    {saveMessage}
                  </span>
                )}
              </div>
              <Button onClick={handleSave} disabled={!dirty || saving}>
                {saving ? (
                  <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving...</>
                ) : (
                  "Save Preferences"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Platform Cookies for Clip Repurpose */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cookie className="h-5 w-5" />
              Content Discovery Access
            </CardTitle>
            <CardDescription>
              Connect your Facebook or Instagram account to discover and clip trending videos from those platforms.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Per-platform status */}
            <div className="grid grid-cols-2 gap-3">
              {/* Facebook status */}
              <div className={`flex flex-col gap-2 p-3 rounded-lg border ${cookieStatus?.fbConnected ? "border-green-200 bg-green-50/50" : "border-muted bg-muted/30"}`}>
                <div className="flex items-center gap-2">
                  {cookieStatus?.fbConnected ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm font-medium">Facebook</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {cookieStatus?.fbConnected
                    ? `Connected (${cookieStatus.fbCookieCount} cookies)`
                    : "Not connected"}
                </p>
                {cookieStatus?.fbConnected && (
                  <div className="text-[11px] text-muted-foreground space-y-0.5">
                    {cookieStatus.fbSavedAt && <p>Saved: {timeAgo(cookieStatus.fbSavedAt)}</p>}
                    {cookieStatus.fbEarliestExpiry && (() => {
                      const exp = timeUntil(cookieStatus.fbEarliestExpiry!);
                      return <p className={exp.warn ? "text-amber-600 font-medium" : ""}>{exp.text}</p>;
                    })()}
                  </div>
                )}
                <Button
                  size="sm"
                  className={cookieStatus?.fbConnected
                    ? "h-8 text-xs"
                    : "h-8 text-xs bg-[#1877F2] hover:bg-[#166FE5] text-white"}
                  variant={cookieStatus?.fbConnected ? "outline" : "default"}
                  disabled={extractingPlatform !== null}
                  onClick={() => handleCookieExtract("facebook")}
                >
                  {extractingPlatform === "facebook" ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <LogIn className="mr-1.5 h-3 w-3" />
                  )}
                  {cookieStatus?.fbConnected ? "Refresh" : "Login"}
                </Button>
              </div>

              {/* Instagram status */}
              <div className={`flex flex-col gap-2 p-3 rounded-lg border ${cookieStatus?.igConnected ? "border-green-200 bg-green-50/50" : "border-muted bg-muted/30"}`}>
                <div className="flex items-center gap-2">
                  {cookieStatus?.igConnected ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm font-medium">Instagram</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {cookieStatus?.igConnected
                    ? `Connected (${cookieStatus.igCookieCount} cookies)`
                    : "Not connected"}
                </p>
                {cookieStatus?.igConnected && (
                  <div className="text-[11px] text-muted-foreground space-y-0.5">
                    {cookieStatus.igSavedAt && <p>Saved: {timeAgo(cookieStatus.igSavedAt)}</p>}
                    {cookieStatus.igEarliestExpiry && (() => {
                      const exp = timeUntil(cookieStatus.igEarliestExpiry!);
                      return <p className={exp.warn ? "text-amber-600 font-medium" : ""}>{exp.text}</p>;
                    })()}
                  </div>
                )}
                <Button
                  size="sm"
                  className={cookieStatus?.igConnected
                    ? "h-8 text-xs"
                    : "h-8 text-xs bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90 text-white"}
                  variant={cookieStatus?.igConnected ? "outline" : "default"}
                  disabled={extractingPlatform !== null}
                  onClick={() => handleCookieExtract("instagram")}
                >
                  {extractingPlatform === "instagram" ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <LogIn className="mr-1.5 h-3 w-3" />
                  )}
                  {cookieStatus?.igConnected ? "Refresh" : "Login"}
                </Button>
              </div>
            </div>

            {/* YouTube always available */}
            <div className="flex items-center gap-2 p-2 rounded-lg border border-green-200 bg-green-50/50">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-xs text-green-700">YouTube discovery always available (no login needed)</span>
            </div>

            {cookieStatus?.exists && (
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-50"
                disabled={cookieDeleting}
                onClick={handleCookieDelete}
                title="Remove all saved cookies"
              >
                {cookieDeleting ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1.5 h-3 w-3" />}
                Remove All Cookies
              </Button>
            )}

            <p className="text-[11px] text-muted-foreground">
              Each button opens a browser window. Log in once and cookies are captured automatically.
            </p>

            {/* Extraction progress */}
            {(extractingPlatform || extractMsg) && (
              <div className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm ${
                extractMsg.includes("Done") ? "border-green-200 bg-green-50 text-green-700"
                  : extractMsg.includes("fail") || extractMsg.includes("error") || extractMsg.includes("closed") || extractMsg.includes("Timed")
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-blue-200 bg-blue-50 text-blue-700"
              }`}>
                {extractingPlatform && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
                {!extractingPlatform && extractMsg.includes("Done") && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                <span className="text-xs">{extractMsg}</span>
              </div>
            )}

            {/* Manual upload fallback */}
            <details className="group">
              <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                Advanced: manual cookie upload...
              </summary>
              <div className="mt-3 space-y-2 p-3 rounded-lg border border-dashed bg-muted/20">
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.cookies"
                    className="hidden"
                    id="cookie-file-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => handleCookieUpload(reader.result as string);
                      reader.readAsText(file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={cookieSaving}
                    onClick={() => document.getElementById("cookie-file-input")?.click()}
                  >
                    {cookieSaving ? (
                      <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Uploading...</>
                    ) : (
                      <><Upload className="mr-2 h-3.5 w-3.5" /> Upload cookies.txt</>
                    )}
                  </Button>
                </div>
                <textarea
                  rows={3}
                  placeholder={"# Netscape HTTP Cookie File\n.facebook.com\tTRUE\t/\tTRUE\t0\tc_user\t12345..."}
                  value={cookieText}
                  onChange={(e) => setCookieText(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-[11px] font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {cookieText.trim() && (
                  <Button
                    size="sm"
                    disabled={cookieSaving}
                    onClick={() => handleCookieUpload(cookieText)}
                  >
                    {cookieSaving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                    Save
                  </Button>
                )}
                {cookieMsg && (
                  <p className={`text-[11px] ${cookieMsg.includes("Failed") || cookieMsg.includes("error") || cookieMsg.includes("Invalid") || cookieMsg.includes("must be") ? "text-red-600" : "text-green-600"}`}>
                    {cookieMsg}
                  </p>
                )}
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
