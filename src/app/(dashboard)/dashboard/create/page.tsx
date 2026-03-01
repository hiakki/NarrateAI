"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { NICHES } from "@/config/niches";
import { ART_STYLES } from "@/config/art-styles";
import { LANGUAGES, isLanguageSupportedByTts } from "@/config/languages";
import { getVoicesForProvider, getDefaultVoiceId } from "@/config/voices";
import {
  ArrowLeft, ArrowRight, Loader2, RefreshCw, Sparkles, Check,
  ChevronDown, ChevronUp, Cpu, Mic, Image as ImageIcon,
  LayoutGrid, SlidersHorizontal, FileText, EyeOff, Star,
} from "lucide-react";
import Link from "next/link";

type Step = 1 | 2 | 3;

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  costEstimate: string;
  qualityLabel: string;
}

interface ProviderData {
  defaults: { llmProvider: string | null; ttsProvider: string | null; imageProvider: string | null };
  available: { llm: ProviderInfo[]; tts: ProviderInfo[]; image: ProviderInfo[] };
  all: { llm: ProviderInfo[]; tts: ProviderInfo[]; image: ProviderInfo[] };
  platformDefaults: { llm: string; tts: string; image: string };
}

interface CharacterSummary {
  id: string;
  name: string;
  type: string;
  fullPrompt: string;
  previewUrl: string | null;
}

interface CreatePrefs {
  niche?: string;
  artStyle?: string;
  voiceId?: string;
  language?: string;
  tone?: string;
  duration?: number;
  llmProvider?: string;
  ttsProvider?: string;
  imageProvider?: string;
}

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [selectedNiche, setSelectedNiche] = useState("");
  const [artStyle, setArtStyle] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [language, setLanguage] = useState("en");
  const [tone, setTone] = useState("dramatic");
  const [duration, setDuration] = useState(45);
  const [customTopic, setCustomTopic] = useState("");
  const [generatedScript, setGeneratedScript] = useState<{
    title: string; description: string; hashtags: string[];
    scenes: { text: string; visualDescription: string }[]; fullScript: string;
  } | null>(null);
  const [editableScript, setEditableScript] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [videoStyle, setVideoStyle] = useState<"faceless" | "star">("faceless");
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>("");
  const selectedCharacter = characters.find((c) => c.id === selectedCharacterId);

  const [showProviders, setShowProviders] = useState(false);
  const [providerData, setProviderData] = useState<ProviderData | null>(null);
  const [llmProvider, setLlmProvider] = useState<string>("");
  const [ttsProvider, setTtsProvider] = useState<string>("");
  const [imageProvider, setImageProvider] = useState<string>("");

  const niche = NICHES.find((n) => n.id === selectedNiche);

  const effectiveTts = ttsProvider
    || providerData?.defaults.ttsProvider
    || providerData?.platformDefaults.tts
    || "GEMINI_TTS";
  const voices = getVoicesForProvider(effectiveTts, language);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/providers");
      const json = await res.json();
      if (json.data) setProviderData(json.data);
    } catch { /* optional */ }
  }, []);

  const loadPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/user/preferences");
      const json = await res.json();
      const prefs = json.data as CreatePrefs | null;
      if (prefs) {
        if (prefs.niche) setSelectedNiche(prefs.niche);
        if (prefs.artStyle) setArtStyle(prefs.artStyle);
        if (prefs.voiceId) setVoiceId(prefs.voiceId);
        if (prefs.language) setLanguage(prefs.language);
        if (prefs.tone) setTone(prefs.tone);
        if (prefs.duration) setDuration(prefs.duration);
        if (prefs.llmProvider) setLlmProvider(prefs.llmProvider);
        if (prefs.ttsProvider) setTtsProvider(prefs.ttsProvider);
        if (prefs.imageProvider) setImageProvider(prefs.imageProvider);
      }
    } catch { /* first-time user */ }
    setPrefsLoaded(true);
  }, []);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch("/api/characters");
      const json = await res.json();
      if (json.data) setCharacters(json.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchProviders();
    loadPrefs();
    fetchCharacters();
  }, [fetchProviders, loadPrefs, fetchCharacters]);

  useEffect(() => {
    if (!prefsLoaded) return;
    const currentVoices = getVoicesForProvider(effectiveTts, language);
    const currentStillValid = voiceId && currentVoices.some((v) => v.id === voiceId);
    if (!currentStillValid) {
      setVoiceId(getDefaultVoiceId(effectiveTts, language));
    }
  }, [effectiveTts, voiceId, language, prefsLoaded]);

  async function savePrefs() {
    try {
      await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: selectedNiche, artStyle, voiceId, language,
          tone, duration,
          llmProvider: llmProvider || undefined,
          ttsProvider: ttsProvider || undefined,
          imageProvider: imageProvider || undefined,
        }),
      });
    } catch { /* non-critical */ }
  }

  async function handleGenerateScript() {
    setIsGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/series/generate-script", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche?.name ?? selectedNiche, tone, artStyle, duration,
          topic: customTopic || undefined,
          language,
          llmProvider: llmProvider || undefined,
          characterPrompt: selectedCharacter?.fullPrompt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGeneratedScript(data.data);
      const full = data.data.scenes.map((s: { text: string }, i: number) => `[Scene ${i + 1}]\n${s.text}`).join("\n\n");
      setEditableScript(full);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate script");
    } finally { setIsGenerating(false); }
  }

  async function handleApproveAndGenerate() {
    if (!generatedScript || !niche) return;
    setIsCreating(true);
    setError("");
    try {
      const scenes = generatedScript.scenes.map((scene, i) => {
        const parts = editableScript.split(/\[Scene \d+\]\n/);
        const editedText = parts[i + 1]?.trim() || scene.text;
        return { text: editedText, visualDescription: scene.visualDescription };
      });
      const res = await fetch("/api/series", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: generatedScript.title, niche: selectedNiche, artStyle, voiceId, language, tone, duration,
          title: generatedScript.title, scriptText: scenes.map((s) => s.text).join(" "), scenes,
          llmProvider: llmProvider || undefined,
          ttsProvider: ttsProvider || undefined,
          imageProvider: imageProvider || undefined,
          characterId: selectedCharacterId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await savePrefs();
      router.push(`/dashboard/videos/${data.data.videoId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create video");
      setIsCreating(false);
    }
  }

  const availableLlmIds = new Set(providerData?.available.llm.map((p) => p.id) ?? []);
  const availableTtsIds = new Set(providerData?.available.tts.map((p) => p.id) ?? []);
  const availableImageIds = new Set(providerData?.available.image.map((p) => p.id) ?? []);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-3xl font-bold">Create Video</h1>
      </div>

      <div className="flex items-center gap-0 mb-10">
        {([
          { num: 1, label: "Niche", Icon: LayoutGrid },
          { num: 2, label: "Options", Icon: SlidersHorizontal },
          { num: 3, label: "Script", Icon: FileText },
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

      {step === 1 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Choose your niche</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {NICHES.map((n) => (
              <Card key={n.id} className={`flex flex-col cursor-pointer transition-all hover:border-primary/50 ${selectedNiche === n.id ? "border-primary ring-2 ring-primary/20" : ""}`}
                onClick={() => { setSelectedNiche(n.id); if (!artStyle) setArtStyle(n.defaultArtStyle); if (tone === "dramatic") setTone(n.defaultTone); }}>
                <CardContent className="p-4 text-center flex flex-col flex-1 items-center justify-center">
                  <div className="text-2xl mb-2">{n.icon}</div>
                  <div className="font-medium text-sm">{n.name}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          {niche && (
            <div className="mt-6 p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-2">Sample topics:</p>
              <div className="flex flex-wrap gap-2">
                {niche.sampleTopics.map((t) => (
                  <span key={t} className="text-xs bg-background rounded-full px-3 py-1 cursor-pointer hover:bg-primary/10" onClick={() => setCustomTopic(t)}>{t}</span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-6 flex justify-end">
            <Button disabled={!selectedNiche} onClick={() => setStep(2)}>Next <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          {/* Video Style toggle */}
          <div>
            <h2 className="text-xl font-semibold mb-3">Video Style</h2>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <button
                type="button"
                onClick={() => { setVideoStyle("faceless"); setSelectedCharacterId(""); }}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                  videoStyle === "faceless"
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <EyeOff className={`h-6 w-6 ${videoStyle === "faceless" ? "text-primary" : "text-muted-foreground"}`} />
                <div className="text-center">
                  <div className="font-medium text-sm">Faceless</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Narration with cinematic imagery</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setVideoStyle("star")}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                  videoStyle === "star"
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <Star className={`h-6 w-6 ${videoStyle === "star" ? "text-primary" : "text-muted-foreground"}`} />
                <div className="text-center">
                  <div className="font-medium text-sm">Star Mode</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Consistent character in every scene</div>
                </div>
              </button>
            </div>

            {videoStyle === "star" && (
              <div className="mt-4 rounded-lg border bg-muted/20 p-4 max-w-lg space-y-3">
                {characters.length > 0 ? (
                  <>
                    <Label className="text-xs block">Choose a character</Label>
                    <div className="space-y-2">
                      {characters.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedCharacterId(c.id)}
                          className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                            selectedCharacterId === c.id
                              ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                              : "hover:border-primary/40"
                          }`}
                        >
                          <div className="w-10 h-10 rounded-md overflow-hidden bg-muted/40 shrink-0 flex items-center justify-center">
                            {c.previewUrl ? (
                              <img src={c.previewUrl} alt={c.name} className="w-full h-full object-cover" />
                            ) : (
                              <Star className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm">{c.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{c.fullPrompt}</div>
                          </div>
                          <Badge variant="secondary" className="text-[10px] capitalize shrink-0">{c.type}</Badge>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No characters yet.</p>
                )}
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/characters/new">
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Create New Character
                  </Link>
                </Button>
                {selectedCharacter && (
                  <div className="rounded-md bg-muted/50 p-2.5">
                    <p className="text-[10px] font-medium text-muted-foreground mb-1">Character prompt (used in every scene):</p>
                    <p className="text-xs">{selectedCharacter.fullPrompt}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator />

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
                  <Button
                    key={l.id}
                    variant={language === l.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLanguage(l.id)}
                    title={!ttsOk ? `${l.name} is not supported by the selected TTS provider` : undefined}
                  >
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

          <div>
            <Label htmlFor="topic" className="mb-2 block">Custom Topic (optional)</Label>
            <Input id="topic" placeholder="Leave blank for AI to choose a trending topic" value={customTopic} onChange={(e) => setCustomTopic(e.target.value)} />
          </div>

          {providerData && (
            <div className="border rounded-lg">
              <button
                type="button"
                className="w-full flex items-center justify-between p-4 text-left"
                onClick={() => setShowProviders(!showProviders)}
              >
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    Advanced: AI Providers
                    {!llmProvider && !ttsProvider && !imageProvider && (
                      <Badge variant="secondary" className="text-[10px]">Using defaults</Badge>
                    )}
                    {(llmProvider || ttsProvider || imageProvider) && (
                      <Badge variant="default" className="text-[10px]">Custom</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Override which AI services to use for this video
                  </p>
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
                    <Label className="mb-2 block text-xs flex items-center gap-1">
                      <Cpu className="h-3 w-3" /> Script AI
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {providerData.all.llm.map((p) => (
                        <Button key={p.id} size="sm" variant={resolvedLlm === p.id ? "default" : "outline"} disabled={!availableLlmIds.has(p.id)} onClick={() => setLlmProvider(llmProvider === p.id ? "" : p.id)}>
                          {p.name}<span className="ml-1 text-[10px] opacity-70">{p.costEstimate}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2 block text-xs flex items-center gap-1">
                      <Mic className="h-3 w-3" /> Voice AI
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {providerData.all.tts.map((p) => (
                        <Button key={p.id} size="sm" variant={resolvedTts === p.id ? "default" : "outline"} disabled={!availableTtsIds.has(p.id)} onClick={() => setTtsProvider(ttsProvider === p.id ? "" : p.id)}>
                          {p.name}<span className="ml-1 text-[10px] opacity-70">{p.costEstimate}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2 block text-xs flex items-center gap-1">
                      <ImageIcon className="h-3 w-3" /> Image AI
                    </Label>
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

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => { setStep(3); handleGenerateScript(); }}><Sparkles className="mr-1 h-4 w-4" /> Generate Script</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Review & Edit Script</h2>
          {isGenerating ? (
            <div className="flex flex-col items-center py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p>Generating script with AI...</p>
              <p className="text-sm mt-1">This may take 10-20 seconds</p>
            </div>
          ) : generatedScript ? (
            <>
              <div className="space-y-2">
                <Label className="text-base font-medium">Title: {generatedScript.title}</Label>
                <p className="text-sm text-muted-foreground">{generatedScript.description}</p>
                {generatedScript.hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {generatedScript.hashtags.map((h) => (
                      <span key={h} className="text-xs text-primary">#{h}</span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Label className="mb-2 block">Narration Script ({generatedScript.scenes.length} scenes)</Label>
                <textarea
                  className="w-full min-h-[300px] rounded-md border bg-background p-4 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editableScript} onChange={(e) => setEditableScript(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">Edit narration above. Keep [Scene N] markers for timing.</p>
              </div>
              <div className="flex justify-between">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
                  <Button variant="outline" onClick={handleGenerateScript} disabled={isGenerating}><RefreshCw className="mr-1 h-4 w-4" /> Regenerate</Button>
                </div>
                <Button onClick={handleApproveAndGenerate} disabled={isCreating}>
                  {isCreating ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Creating...</> : <><Check className="mr-1 h-4 w-4" /> Approve & Generate Video</>}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
