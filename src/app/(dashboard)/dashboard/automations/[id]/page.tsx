"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Loader2, Clock, Trash2, Instagram, Youtube, Facebook,
  CheckCircle2, AlertCircle, Play, Film, Pencil, X, Save, Mic, ChevronDown,
} from "lucide-react";
import { NICHES } from "@/config/niches";
import { ART_STYLES } from "@/config/art-styles";
import { LANGUAGES } from "@/config/languages";
import { getVoicesForProvider, getVoiceById, getDefaultVoiceId } from "@/config/voices";

interface Video {
  id: string;
  title: string | null;
  status: string;
  generationStage: string | null;
  duration: number | null;
  createdAt: string;
  updatedAt: string;
}

interface AutomationDetail {
  id: string;
  name: string;
  niche: string;
  artStyle: string;
  tone: string;
  duration: number;
  language: string;
  voiceId: string | null;
  llmProvider: string | null;
  ttsProvider: string | null;
  imageProvider: string | null;
  targetPlatforms: string[];
  enabled: boolean;
  includeAiTags: boolean;
  frequency: string;
  postTime: string;
  timezone: string;
  lastRunAt: string | null;
  createdAt: string;
  series: { id: string; videos: Video[] } | null;
}

interface SocialAccount {
  id: string;
  platform: "INSTAGRAM" | "YOUTUBE" | "FACEBOOK";
  username: string | null;
  pageName: string | null;
}

interface ProviderInfo {
  id: string;
  name: string;
}

interface ProviderData {
  defaults: { llmProvider: string; ttsProvider: string; imageProvider: string };
  platformDefaults: { llm: string; tts: string; image: string };
  available: { llm: ProviderInfo[]; tts: ProviderInfo[]; image: ProviderInfo[] };
}

const PLATFORM_CONFIG = {
  INSTAGRAM: { icon: Instagram, color: "text-pink-600", label: "Instagram Reels" },
  YOUTUBE: { icon: Youtube, color: "text-red-600", label: "YouTube Shorts" },
  FACEBOOK: { icon: Facebook, color: "text-blue-600", label: "Facebook Reels" },
} as const;

const FREQ_LABEL: Record<string, string> = {
  daily: "Daily", every_other_day: "Every other day", weekly: "Weekly",
};

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "every_other_day", label: "Every Other Day" },
  { value: "weekly", label: "Weekly" },
] as const;

const COMMON_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney",
] as const;

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  QUEUED: { label: "Queued", icon: Clock, className: "text-yellow-600 bg-yellow-50" },
  GENERATING: { label: "Generating", icon: Loader2, className: "text-blue-600 bg-blue-50" },
  REVIEW: { label: "Review", icon: AlertCircle, className: "text-amber-600 bg-amber-50" },
  READY: { label: "Ready", icon: CheckCircle2, className: "text-green-600 bg-green-50" },
  SCHEDULED: { label: "Scheduled", icon: Clock, className: "text-purple-600 bg-purple-50" },
  POSTED: { label: "Posted", icon: CheckCircle2, className: "text-green-700 bg-green-100" },
  FAILED: { label: "Failed", icon: AlertCircle, className: "text-red-600 bg-red-50" },
};

function formatProvider(p: unknown): string {
  if (!p || typeof p !== "string") return "Default";
  return p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AutomationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [auto, setAuto] = useState<AutomationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [providerData, setProviderData] = useState<ProviderData | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [editName, setEditName] = useState("");
  const [editNiche, setEditNiche] = useState("");
  const [editArtStyle, setEditArtStyle] = useState("");
  const [editTone, setEditTone] = useState("");
  const [editDuration, setEditDuration] = useState(45);
  const [editLanguage, setEditLanguage] = useState("en");
  const [editVoiceId, setEditVoiceId] = useState("");
  const [editLlmProvider, setEditLlmProvider] = useState("");
  const [editTtsProvider, setEditTtsProvider] = useState("");
  const [editImageProvider, setEditImageProvider] = useState("");
  const [editFrequency, setEditFrequency] = useState("daily");
  const [editPostTime, setEditPostTime] = useState("09:00");
  const [editTimezone, setEditTimezone] = useState("Asia/Kolkata");
  const [showProviders, setShowProviders] = useState(false);

  const effectiveTts = editTtsProvider
    || providerData?.defaults.ttsProvider
    || providerData?.platformDefaults.tts
    || "GEMINI_TTS";
  const voices = getVoicesForProvider(effectiveTts, editLanguage);

  const fetchData = useCallback(async () => {
    try {
      const [autoRes, acctRes, provRes] = await Promise.all([
        fetch(`/api/automations/${id}`),
        fetch("/api/social/accounts"),
        fetch("/api/settings/providers"),
      ]);
      const autoJson = await autoRes.json();
      const acctJson = await acctRes.json();
      const provJson = await provRes.json();
      if (autoJson.data) setAuto(autoJson.data);
      if (acctJson.data) setAccounts(acctJson.data);
      if (provJson.data) setProviderData(provJson.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!editing) return;
    const currentVoices = getVoicesForProvider(effectiveTts, editLanguage);
    const stillValid = editVoiceId && currentVoices.some((v) => v.id === editVoiceId);
    if (!stillValid) setEditVoiceId(getDefaultVoiceId(effectiveTts, editLanguage));
  }, [effectiveTts, editLanguage, editVoiceId, editing]);

  function startEdit() {
    if (!auto) return;
    setEditName(auto.name);
    setEditNiche(auto.niche);
    setEditArtStyle(auto.artStyle);
    setEditTone(auto.tone);
    setEditDuration(auto.duration);
    setEditLanguage(auto.language);
    setEditVoiceId(auto.voiceId ?? "");
    setEditLlmProvider(auto.llmProvider ?? "");
    setEditTtsProvider(auto.ttsProvider ?? "");
    setEditImageProvider(auto.imageProvider ?? "");
    setEditFrequency(auto.frequency);
    setEditPostTime(auto.postTime);
    setEditTimezone(auto.timezone);
    setShowProviders(!!(auto.llmProvider || auto.ttsProvider || auto.imageProvider));
    setEditing(true);
    setSaveMsg("");
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          niche: editNiche,
          artStyle: editArtStyle,
          tone: editTone,
          duration: editDuration,
          language: editLanguage,
          voiceId: editVoiceId || null,
          llmProvider: editLlmProvider || null,
          ttsProvider: editTtsProvider || null,
          imageProvider: editImageProvider || null,
          frequency: editFrequency,
          postTime: editPostTime,
          timezone: editTimezone,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const json = await res.json();
      setAuto((prev) => prev ? { ...prev, ...json.data } : prev);
      setEditing(false);
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch {
      setSaveMsg("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(enabled: boolean) {
    if (!auto) return;
    setAuto({ ...auto, enabled });
    try {
      await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      setAuto({ ...auto, enabled: !enabled });
    }
  }

  async function toggleAiTags(checked: boolean) {
    if (!auto) return;
    setAuto({ ...auto, includeAiTags: checked });
    try {
      await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeAiTags: checked }),
      });
    } catch {
      setAuto({ ...auto, includeAiTags: !checked });
    }
  }

  async function togglePlatform(platform: string, checked: boolean) {
    if (!auto) return;
    const newPlatforms = checked
      ? [...auto.targetPlatforms, platform]
      : auto.targetPlatforms.filter((p) => p !== platform);
    setAuto({ ...auto, targetPlatforms: newPlatforms });
    try {
      await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlatforms: newPlatforms }),
      });
    } catch {
      setAuto({ ...auto });
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/automations/${id}`, { method: "DELETE" });
      if (res.ok) router.push("/dashboard/automations");
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!auto) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Automation not found.</p>
        <Button variant="link" asChild className="mt-2">
          <Link href="/dashboard/automations">Back to Automations</Link>
        </Button>
      </div>
    );
  }

  const videos = auto.series?.videos ?? [];
  const currentVoice = auto.voiceId ? getVoiceById(auto.voiceId) : null;
  const displayTts = auto.ttsProvider
    || providerData?.defaults.ttsProvider
    || providerData?.platformDefaults.tts
    || "GEMINI_TTS";

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/automations">
            <ArrowLeft className="h-4 w-4 mr-1" /> Automations
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold">{auto.name}</h1>
          <Switch checked={auto.enabled} onCheckedChange={toggleEnabled} />
          <Badge variant={auto.enabled ? "default" : "secondary"}>
            {auto.enabled ? "Active" : "Paused"}
          </Badge>
          {saveMsg && (
            <span className={`text-sm ${saveMsg === "Saved" ? "text-green-600" : "text-destructive"}`}>
              {saveMsg}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Pencil className="mr-1 h-4 w-4" /> Edit
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                <X className="mr-1 h-4 w-4" /> Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                Save
              </Button>
            </>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10">
                <Trash2 className="mr-1 h-4 w-4" /> Delete
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
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-8">
        {/* Content Configuration */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-sm">Content Configuration</h3>
            {editing ? (
              <div className="space-y-4">
                <div>
                  <Label className="text-xs mb-1 block">Name</Label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Niche</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {NICHES.map((n) => (
                      <Button key={n.id} size="xs" variant={editNiche === n.id ? "default" : "outline"} onClick={() => setEditNiche(n.id)}>
                        {n.icon} {n.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Art Style</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {ART_STYLES.map((s) => (
                      <Button key={s.id} size="xs" variant={editArtStyle === s.id ? "default" : "outline"} onClick={() => setEditArtStyle(s.id)}>
                        {s.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Tone</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {["dramatic", "casual", "funny", "educational"].map((t) => (
                        <Button key={t} size="xs" variant={editTone === t ? "default" : "outline"} onClick={() => setEditTone(t)} className="capitalize">{t}</Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Duration</Label>
                    <div className="flex gap-1.5">
                      {[30, 45, 60].map((d) => (
                        <Button key={d} size="xs" variant={editDuration === d ? "default" : "outline"} onClick={() => setEditDuration(d)}>{d}s</Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Language</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {LANGUAGES.map((l) => (
                        <Button key={l.id} size="xs" variant={editLanguage === l.id ? "default" : "outline"} onClick={() => setEditLanguage(l.id)}>
                          {l.flag} {l.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Voice selection */}
                <div>
                  <Label className="text-xs mb-1.5 flex items-center gap-1">
                    <Mic className="h-3 w-3" /> Voice
                  </Label>
                  <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto rounded-md border p-2">
                    {voices.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setEditVoiceId(v.id)}
                        className={`rounded-md border p-2 text-left transition-all text-xs ${
                          editVoiceId === v.id
                            ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                            : "hover:border-primary/40"
                        }`}
                      >
                        <span className="font-medium">{v.name}</span>
                        <span className="text-[10px] text-muted-foreground ml-1">({v.gender})</span>
                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{v.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Provider overrides */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowProviders(!showProviders)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronDown className={`h-3 w-3 transition-transform ${showProviders ? "rotate-180" : ""}`} />
                    AI Provider Overrides
                  </button>
                  {showProviders && providerData && (() => {
                    const resolvedLlm = editLlmProvider || providerData.defaults.llmProvider || providerData.platformDefaults.llm;
                    const resolvedTts = editTtsProvider || providerData.defaults.ttsProvider || providerData.platformDefaults.tts;
                    const resolvedImage = editImageProvider || providerData.defaults.imageProvider || providerData.platformDefaults.image;
                    return (
                      <div className="mt-2 space-y-2 rounded-md border p-3">
                        <div>
                          <Label className="text-[10px] mb-0.5 block text-muted-foreground">Script (LLM)</Label>
                          <div className="flex flex-wrap gap-1">
                            {providerData.available.llm.map((p) => (
                              <Button key={p.id} size="xs" variant={resolvedLlm === p.id ? "default" : "outline"} onClick={() => setEditLlmProvider(p.id)}>
                                {p.name}
                              </Button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px] mb-0.5 block text-muted-foreground">Voice (TTS)</Label>
                          <div className="flex flex-wrap gap-1">
                            {providerData.available.tts.map((p) => (
                              <Button key={p.id} size="xs" variant={resolvedTts === p.id ? "default" : "outline"} onClick={() => setEditTtsProvider(p.id)}>
                                {p.name}
                              </Button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px] mb-0.5 block text-muted-foreground">Images</Label>
                          <div className="flex flex-wrap gap-1">
                            {providerData.available.image.map((p) => (
                              <Button key={p.id} size="xs" variant={resolvedImage === p.id ? "default" : "outline"} onClick={() => setEditImageProvider(p.id)}>
                                {p.name}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Niche</span>
                  <p className="capitalize">{NICHES.find((n) => n.id === auto.niche)?.name ?? auto.niche}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Art Style</span>
                  <p className="capitalize">{ART_STYLES.find((s) => s.id === auto.artStyle)?.name ?? auto.artStyle.replace(/-/g, " ")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Tone</span>
                  <p className="capitalize">{auto.tone}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Duration</span>
                  <p>{auto.duration}s</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Language</span>
                  <p>{LANGUAGES.find((l) => l.id === auto.language)?.name ?? auto.language.toUpperCase()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Voice</span>
                  <p className="flex items-center gap-1">
                    <Mic className="h-3 w-3 text-muted-foreground" />
                    {currentVoice ? (
                      <>{currentVoice.name} <span className="text-muted-foreground text-xs">({currentVoice.gender})</span></>
                    ) : (
                      <span className="text-muted-foreground">Default</span>
                    )}
                  </p>
                </div>
                {(auto.llmProvider || auto.ttsProvider || auto.imageProvider) && (
                  <>
                    <div className="col-span-2">
                      <Separator className="my-1" />
                      <span className="text-muted-foreground text-xs">Provider Overrides</span>
                      <div className="flex gap-3 mt-1">
                        {auto.llmProvider && (
                          <Badge variant="secondary" className="text-[10px]">Script: {formatProvider(auto.llmProvider)}</Badge>
                        )}
                        {auto.ttsProvider && (
                          <Badge variant="secondary" className="text-[10px]">TTS: {formatProvider(auto.ttsProvider)}</Badge>
                        )}
                        {auto.imageProvider && (
                          <Badge variant="secondary" className="text-[10px]">Image: {formatProvider(auto.imageProvider)}</Badge>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Schedule & Channels */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-sm">Schedule</h3>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs mb-1 block">Frequency</Label>
                  <div className="flex gap-1.5">
                    {FREQUENCIES.map((f) => (
                      <Button key={f.value} size="xs" variant={editFrequency === f.value ? "default" : "outline"} onClick={() => setEditFrequency(f.value)}>
                        {f.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Post Time</Label>
                    <input type="time" value={editPostTime} onChange={(e) => setEditPostTime(e.target.value)}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Timezone</Label>
                    <select value={editTimezone} onChange={(e) => setEditTimezone(e.target.value)}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm">
                      {COMMON_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {FREQ_LABEL[auto.frequency] ?? auto.frequency} at {auto.postTime}{" "}
                    <span className="text-muted-foreground">({auto.timezone.replace(/_/g, " ")})</span>
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Last run: {auto.lastRunAt ? new Date(auto.lastRunAt).toLocaleString() : "Never"}
                </div>
              </div>
            )}

            <Separator />

            <h3 className="font-semibold text-sm">Post To</h3>
            {accounts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                <p>No social accounts connected.</p>
                <Button variant="link" size="sm" asChild className="mt-1 h-auto p-0">
                  <Link href="/dashboard/channels">Connect Accounts</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {(["INSTAGRAM", "YOUTUBE", "FACEBOOK"] as const).map((platform) => {
                  const cfg = PLATFORM_CONFIG[platform];
                  const Icon = cfg.icon;
                  const connected = accounts.filter((a) => a.platform === platform);
                  if (connected.length === 0) return null;
                  const isSelected = auto.targetPlatforms.includes(platform);
                  return (
                    <div key={platform} className="flex items-center justify-between rounded-lg border p-2.5">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${cfg.color}`} />
                        <div>
                          <span className="text-xs font-medium">{cfg.label}</span>
                          <p className="text-[10px] text-muted-foreground">
                            {connected.map((a) => a.username ?? a.pageName).join(", ")}
                          </p>
                        </div>
                      </div>
                      <Switch checked={isSelected} onCheckedChange={(v) => togglePlatform(platform, v)} />
                    </div>
                  );
                })}
              </div>
            )}

            <Separator />

            <h3 className="font-semibold text-sm">Tags</h3>
            <div className="flex items-center justify-between rounded-lg border p-2.5">
              <div>
                <span className="text-xs font-medium">Include AI Tags</span>
                <p className="text-[10px] text-muted-foreground">
                  &quot;ai generated&quot;, &quot;Made with AI | NarrateAI&quot; in tags &amp; description
                </p>
              </div>
              <Switch checked={auto.includeAiTags} onCheckedChange={toggleAiTags} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator className="mb-6" />

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Film className="h-5 w-5" /> Generated Videos ({videos.length})
        </h2>
      </div>

      {videos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
            <Play className="h-12 w-12 mb-4" />
            <p className="text-lg font-medium">No videos yet</p>
            <p className="text-sm mt-1">Videos will appear here once the scheduler runs.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {videos.map((video) => {
            const config = statusConfig[video.status] ?? statusConfig.QUEUED;
            const Icon = config.icon;
            return (
              <Card key={video.id} className="transition-colors hover:border-primary/50">
                <CardContent className="flex items-center justify-between p-4">
                  <Link href={`/dashboard/videos/${video.id}`} className="flex-1 min-w-0">
                    <h3 className="font-medium">{video.title || "Untitled Video"}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(video.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      {(video.status === "READY" || video.status === "POSTED") && (() => {
                        const ms = new Date(video.updatedAt).getTime() - new Date(video.createdAt).getTime();
                        if (ms <= 0) return null;
                        const secs = Math.round(ms / 1000);
                        const m = Math.floor(secs / 60);
                        const s = secs % 60;
                        return <span className="ml-1 text-muted-foreground/70">· built in {m > 0 ? `${m}m ${s}s` : `${s}s`}</span>;
                      })()}
                      {video.duration ? <span className="ml-1 text-muted-foreground/70">· {video.duration}s video</span> : ""}
                    </p>
                  </Link>
                  <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${config.className}`}>
                    <Icon key={video.status} className={`h-3 w-3 ${video.status === "GENERATING" ? "animate-spin" : ""}`} />
                    {config.label}
                    {video.status === "GENERATING" && video.generationStage && (
                      <span className="lowercase">({video.generationStage})</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
