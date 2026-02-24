"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { NICHES } from "@/config/niches";
import { ART_STYLES } from "@/config/art-styles";
import { LANGUAGES, isLanguageSupportedByTts } from "@/config/languages";
import { getVoicesForProvider, getDefaultVoiceId } from "@/config/voices";
import {
  ArrowLeft, ArrowRight, Loader2, Check, ChevronDown, ChevronUp,
  Cpu, Mic, Image as ImageIcon, Instagram, Youtube, Facebook, Clock,
} from "lucide-react";
import Link from "next/link";

type Step = 1 | 2 | 3;

interface ProviderInfo {
  id: string; name: string; description: string; costEstimate: string; qualityLabel: string;
}

interface ProviderData {
  defaults: { llmProvider: string | null; ttsProvider: string | null; imageProvider: string | null };
  available: { llm: ProviderInfo[]; tts: ProviderInfo[]; image: ProviderInfo[] };
  all: { llm: ProviderInfo[]; tts: ProviderInfo[]; image: ProviderInfo[] };
  platformDefaults: { llm: string; tts: string; image: string };
}

interface SocialAccount {
  id: string;
  platform: "INSTAGRAM" | "YOUTUBE" | "FACEBOOK";
  username: string | null;
  pageName: string | null;
}

const PLATFORM_CONFIG = {
  INSTAGRAM: { icon: Instagram, color: "text-pink-600", label: "Instagram Reels" },
  YOUTUBE: { icon: Youtube, color: "text-red-600", label: "YouTube Shorts" },
  FACEBOOK: { icon: Facebook, color: "text-blue-600", label: "Facebook Reels" },
} as const;

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "every_other_day", label: "Every Other Day" },
  { value: "weekly", label: "Weekly" },
] as const;

const COMMON_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney",
] as const;

export default function NewAutomationPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Step 1: Content config
  const [name, setName] = useState("");
  const [selectedNiche, setSelectedNiche] = useState("");
  const [artStyle, setArtStyle] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [language, setLanguage] = useState("en");
  const [tone, setTone] = useState("dramatic");
  const [duration, setDuration] = useState(45);

  const [automationCount, setAutomationCount] = useState(0);
  const [showProviders, setShowProviders] = useState(false);
  const [providerData, setProviderData] = useState<ProviderData | null>(null);
  const [llmProvider, setLlmProvider] = useState("");
  const [ttsProvider, setTtsProvider] = useState("");
  const [imageProvider, setImageProvider] = useState("");

  // Step 2: Channels + Schedule
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [includeAiTags, setIncludeAiTags] = useState(true);
  const [frequency, setFrequency] = useState<string>("daily");
  const [postTime, setPostTime] = useState("09:00");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  const niche = NICHES.find((n) => n.id === selectedNiche);
  const effectiveTts = ttsProvider || providerData?.defaults.ttsProvider || providerData?.platformDefaults.tts || "GEMINI_TTS";
  const voices = getVoicesForProvider(effectiveTts, language);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/providers");
      const json = await res.json();
      if (json.data) setProviderData(json.data);
    } catch { /* optional */ }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/social/accounts");
      const json = await res.json();
      if (json.data) setAccounts(json.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchProviders();
    fetchAccounts();
    fetch("/api/automations").then(r => r.json()).then(j => {
      if (j.data) setAutomationCount(j.data.length);
    }).catch(() => {});
  }, [fetchProviders, fetchAccounts]);

  useEffect(() => {
    const currentVoices = getVoicesForProvider(effectiveTts, language);
    const currentStillValid = voiceId && currentVoices.some((v) => v.id === voiceId);
    if (!currentStillValid) setVoiceId(getDefaultVoiceId(effectiveTts, language));
  }, [effectiveTts, voiceId, language]);

  async function handleCreate() {
    setIsCreating(true);
    setError("");
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || `${niche?.name ?? selectedNiche} ${automationCount + 1}`,
          niche: selectedNiche,
          artStyle, voiceId, language, tone, duration,
          llmProvider: llmProvider || undefined,
          ttsProvider: ttsProvider || undefined,
          imageProvider: imageProvider || undefined,
          targetPlatforms: [...selectedPlatforms],
          includeAiTags,
          frequency, postTime, timezone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/dashboard/automations/${data.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create automation");
      setIsCreating(false);
    }
  }

  const availableLlmIds = new Set(providerData?.available.llm.map((p) => p.id) ?? []);
  const availableTtsIds = new Set(providerData?.available.tts.map((p) => p.id) ?? []);
  const availableImageIds = new Set(providerData?.available.image.map((p) => p.id) ?? []);
  const connectedPlatforms = new Set(accounts.map((a) => a.platform));

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-3xl font-bold">New Automation</h1>
      </div>

      <div className="flex gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {step > s ? <Check className="h-4 w-4" /> : s}
            </div>
            <span className="text-sm hidden sm:inline">{s === 1 ? "Content" : s === 2 ? "Schedule" : "Review"}</span>
            {s < 3 && <Separator className="w-8" />}
          </div>
        ))}
      </div>

      {error && <div className="mb-6 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {/* STEP 1: Content Config */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <Label htmlFor="autoName" className="mb-2 block">Automation Name</Label>
            <Input id="autoName" placeholder="e.g. Scary Stories for YouTube" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Niche</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {NICHES.map((n) => (
                <Card key={n.id} className={`cursor-pointer transition-all hover:border-primary/50 ${selectedNiche === n.id ? "border-primary ring-2 ring-primary/20" : ""}`}
                  onClick={() => { setSelectedNiche(n.id); if (!artStyle) setArtStyle(n.defaultArtStyle); setTone(n.defaultTone); }}>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl mb-2">{n.icon}</div>
                    <div className="font-medium text-sm">{n.name}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Art Style</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {ART_STYLES.map((s) => (
                <Card key={s.id} className={`cursor-pointer transition-all hover:border-primary/50 ${artStyle === s.id ? "border-primary ring-2 ring-primary/20" : ""}`} onClick={() => setArtStyle(s.id)}>
                  <CardContent className="p-3 text-center">
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.description}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Voice</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {voices.map((v) => (
                <Card key={v.id} className={`cursor-pointer transition-all hover:border-primary/50 ${voiceId === v.id ? "border-primary ring-2 ring-primary/20" : ""}`} onClick={() => setVoiceId(v.id)}>
                  <CardContent className="p-3">
                    <div className="font-medium text-sm">{v.name}</div>
                    <div className="text-xs text-muted-foreground">{v.description}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Language</Label>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((l) => {
                const ttsOk = isLanguageSupportedByTts(l.id, effectiveTts);
                return (
                  <Button key={l.id} variant={language === l.id ? "default" : "outline"} size="sm" onClick={() => setLanguage(l.id)}
                    title={!ttsOk ? `${l.name} is not supported by the selected TTS provider` : undefined}>
                    <span className="mr-1">{l.flag}</span> {l.name}
                    {!ttsOk && <span className="ml-1 text-[10px] opacity-60">(limited TTS)</span>}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <Label className="mb-2 block">Tone</Label>
              <div className="flex flex-wrap gap-2">
                {["dramatic", "casual", "funny", "educational"].map((t) => (
                  <Button key={t} variant={tone === t ? "default" : "outline"} size="sm" onClick={() => setTone(t)} className="capitalize">{t}</Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-2 block">Duration</Label>
              <div className="flex gap-2">
                {[30, 45, 60].map((d) => (
                  <Button key={d} variant={duration === d ? "default" : "outline"} size="sm" onClick={() => setDuration(d)}>{d}s</Button>
                ))}
              </div>
            </div>
          </div>

          {providerData && (
            <div className="border rounded-lg">
              <button type="button" className="w-full flex items-center justify-between p-4 text-left" onClick={() => setShowProviders(!showProviders)}>
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    Advanced: AI Providers
                    {!llmProvider && !ttsProvider && !imageProvider
                      ? <Badge variant="secondary" className="text-[10px]">Using defaults</Badge>
                      : <Badge variant="default" className="text-[10px]">Custom</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Override which AI services to use</p>
                </div>
                {showProviders ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showProviders && (() => {
                const resolvedLlm = llmProvider || providerData.defaults.llmProvider || providerData.platformDefaults.llm;
                const resolvedTts = ttsProvider || providerData.defaults.ttsProvider || providerData.platformDefaults.tts;
                const resolvedImage = imageProvider || providerData.defaults.imageProvider || providerData.platformDefaults.image;
                return (
                <div className="px-4 pb-4 space-y-4">
                  <Separator />
                  <div>
                    <Label className="mb-2 block text-xs flex items-center gap-1"><Cpu className="h-3 w-3" /> Script AI</Label>
                    <div className="flex flex-wrap gap-2">
                      {providerData.all.llm.map((p) => (
                        <Button key={p.id} size="sm" variant={resolvedLlm === p.id ? "default" : "outline"} disabled={!availableLlmIds.has(p.id)} onClick={() => setLlmProvider(llmProvider === p.id ? "" : p.id)}>
                          {p.name}<span className="ml-1 text-[10px] opacity-70">{p.costEstimate}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2 block text-xs flex items-center gap-1"><Mic className="h-3 w-3" /> Voice AI</Label>
                    <div className="flex flex-wrap gap-2">
                      {providerData.all.tts.map((p) => (
                        <Button key={p.id} size="sm" variant={resolvedTts === p.id ? "default" : "outline"} disabled={!availableTtsIds.has(p.id)} onClick={() => setTtsProvider(ttsProvider === p.id ? "" : p.id)}>
                          {p.name}<span className="ml-1 text-[10px] opacity-70">{p.costEstimate}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2 block text-xs flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Image AI</Label>
                    <div className="flex flex-wrap gap-2">
                      {providerData.all.image.map((p) => (
                        <Button key={p.id} size="sm" variant={resolvedImage === p.id ? "default" : "outline"} disabled={!availableImageIds.has(p.id)} onClick={() => setImageProvider(imageProvider === p.id ? "" : p.id)}>
                          {p.name}<span className="ml-1 text-[10px] opacity-70">{p.costEstimate}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
                );
              })()}
            </div>
          )}

          <div className="flex justify-end">
            <Button disabled={!selectedNiche || !artStyle} onClick={() => setStep(2)}>
              Next: Schedule <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: Channels + Schedule */}
      {step === 2 && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Publishing Channels</h2>
          {accounts.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <p>No social accounts connected yet.</p>
                <Button variant="link" size="sm" asChild className="mt-1">
                  <Link href="/dashboard/channels">Connect Accounts</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(["INSTAGRAM", "YOUTUBE", "FACEBOOK"] as const).map((platform) => {
                const config = PLATFORM_CONFIG[platform];
                const Icon = config.icon;
                if (!connectedPlatforms.has(platform)) return null;
                const accts = accounts.filter((a) => a.platform === platform);
                return (
                  <div key={platform} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <Icon className={`h-4 w-4 ${config.color}`} />
                      <div>
                        <span className="text-sm font-medium">{config.label}</span>
                        <p className="text-xs text-muted-foreground">{accts.map((a) => a.username ?? a.pageName).join(", ")}</p>
                      </div>
                    </div>
                    <Switch
                      checked={selectedPlatforms.has(platform)}
                      onCheckedChange={(v) => {
                        setSelectedPlatforms((prev) => {
                          const next = new Set(prev);
                          v ? next.add(platform) : next.delete(platform);
                          return next;
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <Separator />

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <span className="text-sm font-medium">Include AI Tags</span>
              <p className="text-xs text-muted-foreground">
                Add &quot;ai generated&quot;, &quot;Made with AI | NarrateAI&quot; to video tags &amp; description
              </p>
            </div>
            <Switch checked={includeAiTags} onCheckedChange={setIncludeAiTags} />
          </div>

          <Separator />

          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5" /> Schedule
          </h2>

          <div>
            <Label className="text-xs mb-2 block">Frequency</Label>
            <div className="flex gap-2">
              {FREQUENCIES.map((f) => (
                <Button key={f.value} size="sm" variant={frequency === f.value ? "default" : "outline"}
                  onClick={() => setFrequency(f.value)}>
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs mb-2 block">Post Time</Label>
              <input type="time" value={postTime} onChange={(e) => setPostTime(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" />
            </div>
            <div>
              <Label className="text-xs mb-2 block">Timezone</Label>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep(3)}>Review <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* STEP 3: Review */}
      {step === 3 && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Review Automation</h2>
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Name</span>
                  <p className="font-medium">{name || `${niche?.name ?? selectedNiche} - ${tone}`}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Niche</span>
                  <p className="font-medium capitalize">{niche?.name ?? selectedNiche}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Art Style</span>
                  <p className="font-medium capitalize">{artStyle.replace(/-/g, " ")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Tone</span>
                  <p className="font-medium capitalize">{tone}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Duration</span>
                  <p className="font-medium">{duration}s</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Language</span>
                  <p className="font-medium">{language.toUpperCase()}</p>
                </div>
              </div>

              <Separator />

              <div className="text-sm space-y-2">
                <div>
                  <span className="text-muted-foreground">AI Tags</span>
                  <p className="font-medium">{includeAiTags ? "Included" : "Hidden"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Schedule</span>
                  <p className="font-medium">
                    {FREQUENCIES.find((f) => f.value === frequency)?.label} at {postTime} ({timezone.replace(/_/g, " ")})
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Channels</span>
                  <div className="flex gap-2 mt-1">
                    {selectedPlatforms.size === 0 ? (
                      <span className="text-xs text-muted-foreground">None selected (videos will be generated but not auto-posted)</span>
                    ) : (
                      [...selectedPlatforms].map((p) => {
                        const config = PLATFORM_CONFIG[p as keyof typeof PLATFORM_CONFIG];
                        if (!config) return null;
                        const Icon = config.icon;
                        return (
                          <Badge key={p} variant="secondary" className="flex items-center gap-1">
                            <Icon className="h-3 w-3" /> {config.label}
                          </Badge>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Creating...</> : <><Check className="mr-1 h-4 w-4" /> Create Automation</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
