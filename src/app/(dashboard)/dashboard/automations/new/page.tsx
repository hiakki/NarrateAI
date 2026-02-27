"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { getScheduleForNiche, convertTime } from "@/config/posting-schedule";
import { LANGUAGES, isLanguageSupportedByTts } from "@/config/languages";
import { getVoicesForProvider, getDefaultVoiceId, getVoiceById, type Voice } from "@/config/voices";
import {
  ArrowLeft, ArrowRight, Loader2, Check, ChevronDown, ChevronUp,
  Cpu, Mic, Image as ImageIcon, Instagram, Youtube, Facebook, Clock,
  LayoutGrid, CalendarClock, ClipboardCheck, Sparkles, Globe, Plus, XCircle,
} from "lucide-react";
import Link from "next/link";

type Step = 1 | 2 | 3;
type PlatformKey = "FACEBOOK" | "YOUTUBE" | "INSTAGRAM";

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

const SCORE_WEIGHTS = { topic: 30, art: 15, voice: 10, language: 15, tone: 10, time: 20 } as const;
const PLATFORMS: PlatformKey[] = ["FACEBOOK", "YOUTUBE", "INSTAGRAM"];

const NICHE_PLATFORM_BASE: Record<string, Record<PlatformKey, number>> = {
  "scary-stories": { FACEBOOK: 76, YOUTUBE: 70, INSTAGRAM: 84 },
  mythology: { FACEBOOK: 78, YOUTUBE: 74, INSTAGRAM: 72 },
  history: { FACEBOOK: 74, YOUTUBE: 76, INSTAGRAM: 68 },
  "true-crime": { FACEBOOK: 80, YOUTUBE: 75, INSTAGRAM: 82 },
  "anime-recaps": { FACEBOOK: 62, YOUTUBE: 78, INSTAGRAM: 86 },
  "life-hacks": { FACEBOOK: 72, YOUTUBE: 70, INSTAGRAM: 82 },
  motivation: { FACEBOOK: 74, YOUTUBE: 72, INSTAGRAM: 80 },
  "science-facts": { FACEBOOK: 70, YOUTUBE: 76, INSTAGRAM: 74 },
  "conspiracy-theories": { FACEBOOK: 77, YOUTUBE: 68, INSTAGRAM: 79 },
  "biblical-stories": { FACEBOOK: 82, YOUTUBE: 66, INSTAGRAM: 62 },
  "urban-legends": { FACEBOOK: 74, YOUTUBE: 69, INSTAGRAM: 81 },
  heists: { FACEBOOK: 78, YOUTUBE: 74, INSTAGRAM: 77 },
};

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h * 60) + m;
}

function circularMinuteDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 1440 - d);
}

function scoreFromMinuteDiff(diff: number): number {
  if (diff <= 30) return 95;
  if (diff <= 60) return 86;
  if (diff <= 120) return 75;
  if (diff <= 240) return 62;
  return 48;
}

function recommendVoice(voices: Voice[], tone: string): Voice | null {
  if (voices.length === 0) return null;
  const byKeyword = (keywords: string[]) =>
    voices.find((v) => keywords.some((k) => `${v.name} ${v.description}`.toLowerCase().includes(k)));
  if (tone === "dramatic") return byKeyword(["deep", "narrator", "intense", "authoritative"]) ?? voices[0];
  if (tone === "educational") return byKeyword(["clear", "professional", "calm", "steady"]) ?? voices[0];
  if (tone === "funny") return byKeyword(["upbeat", "lively", "energetic", "friendly"]) ?? voices[0];
  return byKeyword(["warm", "natural", "friendly", "conversational"]) ?? voices[0];
}

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
  const [postTimes, setPostTimes] = useState<string[]>(["09:00"]);
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [focusedNicheId, setFocusedNicheId] = useState("");

  const niche = NICHES.find((n) => n.id === selectedNiche);

  const suggestedSchedule = useMemo(() => {
    if (!selectedNiche) return null;
    const schedule = getScheduleForNiche(selectedNiche, language);
    return {
      ...schedule,
      localSlots: schedule.slots.map((s) => ({
        ...s,
        localTime: convertTime(s.time, schedule.viewerTimezone, timezone),
      })),
    };
  }, [selectedNiche, language, timezone]);

  const effectiveTts = ttsProvider || providerData?.defaults.ttsProvider || providerData?.platformDefaults.tts || "GEMINI_TTS";
  const voices = getVoicesForProvider(effectiveTts, language);

  const selectedVoice = getVoiceById(voiceId) ?? null;
  const activeNicheForScore = focusedNicheId || selectedNiche;
  const scorePlatforms = selectedPlatforms.size > 0
    ? PLATFORMS.filter((p) => selectedPlatforms.has(p))
    : PLATFORMS;

  const scoreForConfig = useCallback((cfg: {
    nicheId: string;
    artStyleId: string;
    voice: Voice | null;
    languageId: string;
    toneId: string;
    times: string[];
  }) => {
    const nicheDef = NICHES.find((n) => n.id === cfg.nicheId);
    const baseByPlatform = NICHE_PLATFORM_BASE[cfg.nicheId] ?? { FACEBOOK: 68, YOUTUBE: 68, INSTAGRAM: 68 };
    const schedule = getScheduleForNiche(cfg.nicheId, cfg.languageId);
    const recommendedLocalSlots = schedule.slots.map((s) => hmToMinutes(convertTime(s.time, schedule.viewerTimezone, timezone)));
    const selectedMins = (cfg.times.length > 0
      ? cfg.times
      : [recommendedLocalSlots[0] ? `${String(Math.floor(recommendedLocalSlots[0] / 60)).padStart(2, "0")}:${String(recommendedLocalSlots[0] % 60).padStart(2, "0")}` : "12:00"]
    ).map(hmToMinutes);
    const bestDiff = recommendedLocalSlots.length > 0
      ? Math.min(...selectedMins.map((sm) => Math.min(...recommendedLocalSlots.map((rm) => circularMinuteDiff(sm, rm)))))
      : 180;
    const timeBase = scoreFromMinuteDiff(bestDiff);

    const artBase = cfg.artStyleId === nicheDef?.defaultArtStyle ? 92 : 72;
    const toneBase = cfg.toneId === nicheDef?.defaultTone ? 90 : 70;
    const languageBase = cfg.languageId === "en" ? 80 : cfg.languageId === "hi" ? 84 : 72;
    const voiceText = `${cfg.voice?.name ?? ""} ${cfg.voice?.description ?? ""}`.toLowerCase();
    const voiceBase =
      (cfg.toneId === "dramatic" && /deep|narrator|authoritative|intense/.test(voiceText)) ? 90
        : (cfg.toneId === "educational" && /clear|professional|calm|steady/.test(voiceText)) ? 88
          : (cfg.toneId === "casual" && /friendly|warm|natural|conversational/.test(voiceText)) ? 86
            : cfg.voice ? 78 : 70;

    const perPlatform = Object.fromEntries(PLATFORMS.map((platform) => {
      const topic = baseByPlatform[platform];
      const art = platform === "INSTAGRAM" ? artBase + 2 : platform === "YOUTUBE" ? artBase - 1 : artBase;
      const voice = platform === "YOUTUBE" ? voiceBase + 3 : voiceBase;
      const lang = platform === "FACEBOOK" && cfg.languageId === "hi" ? languageBase + 4 : languageBase;
      const toneScore = toneBase;
      const time = platform === "INSTAGRAM" ? timeBase + 2 : timeBase;
      const overall = clamp(
        (topic * SCORE_WEIGHTS.topic
          + art * SCORE_WEIGHTS.art
          + voice * SCORE_WEIGHTS.voice
          + lang * SCORE_WEIGHTS.language
          + toneScore * SCORE_WEIGHTS.tone
          + time * SCORE_WEIGHTS.time) / 100,
      );
      return [platform, {
        overall,
        components: {
          topic: clamp(topic),
          art: clamp(art),
          voice: clamp(voice),
          language: clamp(lang),
          tone: clamp(toneScore),
          time: clamp(time),
        },
      }];
    })) as Record<PlatformKey, { overall: number; components: Record<string, number> }>;

    const overall = clamp(PLATFORMS.reduce((sum, p) => sum + perPlatform[p].overall, 0) / PLATFORMS.length);
    return { overall, perPlatform };
  }, [timezone]);

  const nicheCards = useMemo(() => {
    return NICHES.map((n) => {
      const recVoice = recommendVoice(voices, n.defaultTone);
      const score = scoreForConfig({
        nicheId: n.id,
        artStyleId: n.defaultArtStyle,
        voice: recVoice,
        languageId: language,
        toneId: n.defaultTone,
        times: postTimes,
      });
      return { niche: n, score };
    });
  }, [language, postTimes, scoreForConfig, voices]);

  const activeNicheScore = useMemo(() => {
    if (!activeNicheForScore) return null;
    return scoreForConfig({
      nicheId: activeNicheForScore,
      artStyleId: artStyle || (NICHES.find((n) => n.id === activeNicheForScore)?.defaultArtStyle ?? "realistic"),
      voice: selectedVoice ?? recommendVoice(voices, tone),
      languageId: language,
      toneId: tone,
      times: postTimes,
    });
  }, [activeNicheForScore, artStyle, selectedVoice, voices, tone, language, postTimes, scoreForConfig]);

  const finalScore = useMemo(() => {
    if (!selectedNiche || !activeNicheScore) return null;
    const avg = scorePlatforms.reduce((sum, p) => sum + activeNicheScore.perPlatform[p].overall, 0) / scorePlatforms.length;
    return clamp(avg);
  }, [selectedNiche, activeNicheScore, scorePlatforms]);

  const factorAverages = useMemo(() => {
    if (!activeNicheScore) return null;
    const keys: Array<keyof typeof SCORE_WEIGHTS> = ["topic", "art", "voice", "language", "tone", "time"];
    return Object.fromEntries(keys.map((k) => {
      const avg = scorePlatforms.reduce((sum, p) => sum + activeNicheScore.perPlatform[p].components[k], 0) / scorePlatforms.length;
      return [k, clamp(avg)];
    })) as Record<keyof typeof SCORE_WEIGHTS, number>;
  }, [activeNicheScore, scorePlatforms]);

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
          llmProvider: llmProvider && llmProvider !== providerData?.defaults.llmProvider && llmProvider !== providerData?.platformDefaults.llm ? llmProvider : undefined,
          ttsProvider: ttsProvider && ttsProvider !== providerData?.defaults.ttsProvider && ttsProvider !== providerData?.platformDefaults.tts ? ttsProvider : undefined,
          imageProvider: imageProvider && imageProvider !== providerData?.defaults.imageProvider && imageProvider !== providerData?.platformDefaults.image ? imageProvider : undefined,
          targetPlatforms: [...selectedPlatforms],
          includeAiTags,
          frequency, postTime: postTimes.join(","), timezone,
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

      <div className="flex items-center gap-0 mb-10">
        {([
          { num: 1, label: "Content", Icon: LayoutGrid },
          { num: 2, label: "Schedule", Icon: CalendarClock },
          { num: 3, label: "Review", Icon: ClipboardCheck },
        ] as const).map(({ num, label, Icon }, idx) => {
          const isActive = step === num;
          const isDone = step > num;
          const isPending = step < num;
          return (
            <div key={num} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center gap-1.5">
                <div className={`
                  relative h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-300
                  ${isDone ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : ""}
                  ${isActive ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-primary/15 scale-110" : ""}
                  ${isPending ? "bg-muted/60 text-muted-foreground border border-border" : ""}
                `}>
                  {isDone ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-4 w-4" />}
                </div>
                <span className={`text-xs font-medium transition-colors ${isActive ? "text-primary" : isDone ? "text-foreground" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </div>
              {idx < 2 && (
                <div className="flex-1 mx-3 mb-5">
                  <div className={`h-0.5 rounded-full transition-all duration-500 ${step > num ? "bg-primary" : "bg-border"}`} />
                </div>
              )}
            </div>
          );
        })}
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
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {nicheCards.map(({ niche: n, score }) => (
                  <Card
                    key={n.id}
                    className={`flex flex-col cursor-pointer transition-all hover:border-primary/50 ${
                      selectedNiche === n.id ? "border-primary ring-2 ring-primary/20" : ""
                    }`}
                    onClick={() => {
                      setFocusedNicheId(n.id);
                      setSelectedNiche(n.id);
                      if (!artStyle) setArtStyle(n.defaultArtStyle);
                      setTone(n.defaultTone);
                    }}
                  >
                    <CardContent className="p-4 text-center flex flex-col flex-1 items-center justify-center gap-1.5">
                      <div className="text-2xl">{n.icon}</div>
                      <div className="font-medium text-sm">{n.name}</div>
                      <Badge variant="secondary" className="text-[11px]">
                        Overall {score.overall}%
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="h-fit">
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-semibold">Niche Score Card</div>
                  {activeNicheScore ? (
                    <>
                      <div className="rounded-md border p-3 bg-muted/30">
                        <p className="text-xs text-muted-foreground">Overall potential</p>
                        <p className="text-2xl font-bold">{activeNicheScore.overall}%</p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Based on topic, art style, voice, language, tone and time.
                        </p>
                      </div>

                      <div className="space-y-2">
                        {PLATFORMS.map((p) => (
                          <div key={p} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs">
                            <span>{p === "FACEBOOK" ? "FB" : p === "YOUTUBE" ? "YT" : "IG"}</span>
                            <span className="font-semibold">{activeNicheScore.perPlatform[p].overall}%</span>
                          </div>
                        ))}
                      </div>

                      {factorAverages && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-md border px-2 py-1 text-[11px]">Topic: <span className="font-semibold">{factorAverages.topic}%</span></div>
                          <div className="rounded-md border px-2 py-1 text-[11px]">Art: <span className="font-semibold">{factorAverages.art}%</span></div>
                          <div className="rounded-md border px-2 py-1 text-[11px]">Voice: <span className="font-semibold">{factorAverages.voice}%</span></div>
                          <div className="rounded-md border px-2 py-1 text-[11px]">Language: <span className="font-semibold">{factorAverages.language}%</span></div>
                          <div className="rounded-md border px-2 py-1 text-[11px]">Tone: <span className="font-semibold">{factorAverages.tone}%</span></div>
                          <div className="rounded-md border px-2 py-1 text-[11px]">Time: <span className="font-semibold">{factorAverages.time}%</span></div>
                        </div>
                      )}

                      <Separator />
                      <div className="space-y-1 text-xs">
                        <p><span className="text-muted-foreground">Recommended art:</span> {NICHES.find((n) => n.id === activeNicheForScore)?.defaultArtStyle.replace(/-/g, " ")}</p>
                        <p><span className="text-muted-foreground">Recommended voice:</span> {recommendVoice(voices, tone)?.name ?? "Auto"}</p>
                        <p><span className="text-muted-foreground">Recommended language:</span> {language.toUpperCase()}</p>
                        <p><span className="text-muted-foreground">Recommended tone:</span> <span className="capitalize">{NICHES.find((n) => n.id === activeNicheForScore)?.defaultTone ?? tone}</span></p>
                        <p>
                          <span className="text-muted-foreground">Recommended time:</span>{" "}
                          {activeNicheForScore && suggestedSchedule?.localSlots[0]?.localTime
                            ? `${suggestedSchedule.localSlots[0].localTime} (best window for shorts/reels)`
                            : "Select a niche to see best shorts/reels time"}
                        </p>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Select a niche to view score details.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Art Style</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {ART_STYLES.map((s) => (
                <Card key={s.id} className={`flex flex-col cursor-pointer transition-all hover:border-primary/50 ${artStyle === s.id ? "border-primary ring-2 ring-primary/20" : ""}`} onClick={() => setArtStyle(s.id)}>
                  <CardContent className="p-3 text-center flex flex-col flex-1">
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex-1">{s.description}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Voice</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {voices.map((v) => (
                <Card key={v.id} className={`flex flex-col cursor-pointer transition-all hover:border-primary/50 ${voiceId === v.id ? "border-primary ring-2 ring-primary/20" : ""}`} onClick={() => setVoiceId(v.id)}>
                  <CardContent className="p-3 flex flex-col flex-1">
                    <div className="font-medium text-sm">{v.name}</div>
                    <div className="text-xs text-muted-foreground flex-1">{v.description}</div>
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
                        <Button key={p.id} size="sm" variant={resolvedLlm === p.id ? "default" : "outline"} disabled={!availableLlmIds.has(p.id)} onClick={() => setLlmProvider(resolvedLlm === p.id ? "" : p.id)}>
                          {p.name}<span className="ml-1 text-[10px] opacity-70">{p.costEstimate}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2 block text-xs flex items-center gap-1"><Mic className="h-3 w-3" /> Voice AI</Label>
                    <div className="flex flex-wrap gap-2">
                      {providerData.all.tts.map((p) => (
                        <Button key={p.id} size="sm" variant={resolvedTts === p.id ? "default" : "outline"} disabled={!availableTtsIds.has(p.id)} onClick={() => setTtsProvider(resolvedTts === p.id ? "" : p.id)}>
                          {p.name}<span className="ml-1 text-[10px] opacity-70">{p.costEstimate}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2 block text-xs flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Image AI</Label>
                    <div className="flex flex-wrap gap-2">
                      {providerData.all.image.map((p) => (
                        <Button key={p.id} size="sm" variant={resolvedImage === p.id ? "default" : "outline"} disabled={!availableImageIds.has(p.id)} onClick={() => setImageProvider(resolvedImage === p.id ? "" : p.id)}>
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

          <div>
            <Label className="text-xs mb-2 block">Timezone</Label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs mb-2 block">Post Times</Label>
            <div className="space-y-2">
              {postTimes.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={t}
                    onChange={(e) => {
                      const next = [...postTimes];
                      next[i] = e.target.value;
                      setPostTimes(next);
                    }}
                    className="flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm"
                  />
                  {postTimes.length > 1 && (
                    <Button size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-red-600"
                      onClick={() => setPostTimes(postTimes.filter((_, j) => j !== i))}>
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}
                  {i === 0 && postTimes.length === 1 && (
                    <span className="text-xs text-muted-foreground">1 video per {frequency === "daily" ? "day" : frequency === "every_other_day" ? "cycle" : "week"}</span>
                  )}
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setPostTimes([...postTimes, "12:00"])}
              >
                <Plus className="h-3.5 w-3.5" /> Add another time
              </Button>
              {postTimes.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  {postTimes.length} videos per {frequency === "daily" ? "day" : frequency === "every_other_day" ? "cycle" : "week"}
                </p>
              )}
            </div>
          </div>

          {suggestedSchedule && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                <Sparkles className="h-4 w-4" />
                Best times to post for {niche?.name ?? "this niche"}
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {suggestedSchedule.reason}
              </p>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Globe className="h-3 w-3" />
                Viewer audience: {suggestedSchedule.viewerRegion} ({suggestedSchedule.viewerTimezone.replace(/_/g, " ")})
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestedSchedule.localSlots.map((slot, i) => {
                  const isActive = postTimes.includes(slot.localTime);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (isActive) {
                          if (postTimes.length > 1) setPostTimes(postTimes.filter((t) => t !== slot.localTime));
                        } else {
                          setPostTimes([...postTimes, slot.localTime].sort());
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        isActive
                          ? "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600"
                          : "border-amber-200 bg-white text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/40"
                      }`}
                    >
                      <Clock className="h-3 w-3" />
                      {slot.localTime}
                      <span className="text-amber-600 dark:text-amber-500">· {slot.label}</span>
                      {i === 0 && <Badge variant="outline" className="ml-1 text-[10px] py-0 px-1 border-amber-400 text-amber-700 dark:text-amber-400">Best</Badge>}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Click to add/remove times. {postTimes.length > 1 ? `${postTimes.length} times selected.` : "Select multiple for more videos per day."}
                {timezone !== suggestedSchedule.viewerTimezone && (
                  <> · Times converted from {suggestedSchedule.viewerTimezone.replace(/_/g, " ")} to {timezone.replace(/_/g, " ")}</>
                )}
              </p>
            </div>
          )}

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
              {finalScore !== null && activeNicheScore && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">Final Score</p>
                      <p className="text-xs text-muted-foreground">Average of selected platforms</p>
                    </div>
                    <p className="text-2xl font-bold">{finalScore}%</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {PLATFORMS.filter((p) => selectedPlatforms.size === 0 || selectedPlatforms.has(p)).map((p) => (
                      <div key={p} className="rounded-md border px-2 py-1 text-center">
                        <div className="text-muted-foreground">{p === "FACEBOOK" ? "FB" : p === "YOUTUBE" ? "YT" : "IG"}</div>
                        <div className="font-semibold">{activeNicheScore.perPlatform[p].overall}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                    {FREQUENCIES.find((f) => f.value === frequency)?.label} at {postTimes.sort().join(", ")} ({timezone.replace(/_/g, " ")})
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
