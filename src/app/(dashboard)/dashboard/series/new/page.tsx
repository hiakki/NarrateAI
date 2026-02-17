"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { NICHES } from "@/config/niches";
import { ART_STYLES } from "@/config/art-styles";
import { VOICES } from "@/config/voices";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  RefreshCw,
  Sparkles,
  Check,
} from "lucide-react";

type Step = 1 | 2 | 3;

export default function NewSeriesPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  const [selectedNiche, setSelectedNiche] = useState("");
  const [artStyle, setArtStyle] = useState("");
  const [voiceId, setVoiceId] = useState("Charon");
  const [tone, setTone] = useState("dramatic");
  const [duration, setDuration] = useState(45);
  const [customTopic, setCustomTopic] = useState("");

  const [generatedScript, setGeneratedScript] = useState<{
    title: string;
    description: string;
    scenes: { text: string; visualDescription: string }[];
  } | null>(null);
  const [editableScript, setEditableScript] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const niche = NICHES.find((n) => n.id === selectedNiche);

  async function handleGenerateScript() {
    setIsGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/series/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche?.name ?? selectedNiche,
          tone,
          artStyle,
          duration,
          topic: customTopic || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setGeneratedScript(data.data);
      const fullScript = data.data.scenes
        .map((s: { text: string }, i: number) => `[Scene ${i + 1}]\n${s.text}`)
        .join("\n\n");
      setEditableScript(fullScript);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate script");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleApproveAndGenerate() {
    if (!generatedScript || !niche) return;
    setIsCreating(true);
    setError("");

    try {
      const scenes = generatedScript.scenes.map((scene, i) => {
        const editedLines = editableScript.split(/\[Scene \d+\]\n/);
        const editedText = editedLines[i + 1]?.trim() || scene.text;
        return { text: editedText, visualDescription: scene.visualDescription };
      });

      const res = await fetch("/api/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: generatedScript.title,
          niche: selectedNiche,
          artStyle,
          voiceId,
          tone,
          duration,
          title: generatedScript.title,
          scriptText: scenes.map((s) => s.text).join(" "),
          scenes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      router.push(`/dashboard/series/${data.data.seriesId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create series");
      setIsCreating(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-3xl font-bold">Create New Series</h1>
      </div>

      <div className="flex gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step >= s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step > s ? <Check className="h-4 w-4" /> : s}
            </div>
            <span className="text-sm hidden sm:inline">
              {s === 1 ? "Niche" : s === 2 ? "Options" : "Script"}
            </span>
            {s < 3 && <Separator className="w-8" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {step === 1 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Choose your niche</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {NICHES.map((n) => (
              <Card
                key={n.id}
                className={`cursor-pointer transition-all hover:border-primary/50 ${
                  selectedNiche === n.id ? "border-primary ring-2 ring-primary/20" : ""
                }`}
                onClick={() => {
                  setSelectedNiche(n.id);
                  setArtStyle(n.defaultArtStyle);
                  setTone(n.defaultTone);
                }}
              >
                <CardContent className="p-4 text-center">
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
                  <span
                    key={t}
                    className="text-xs bg-background rounded-full px-3 py-1 cursor-pointer hover:bg-primary/10"
                    onClick={() => setCustomTopic(t)}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <Button disabled={!selectedNiche} onClick={() => setStep(2)}>
              Next <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-4">Art Style</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {ART_STYLES.map((s) => (
                <Card
                  key={s.id}
                  className={`cursor-pointer transition-all hover:border-primary/50 ${
                    artStyle === s.id ? "border-primary ring-2 ring-primary/20" : ""
                  }`}
                  onClick={() => setArtStyle(s.id)}
                >
                  <CardContent className="p-3 text-center">
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {s.description}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Voice</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {VOICES.map((v) => (
                <Card
                  key={v.id}
                  className={`cursor-pointer transition-all hover:border-primary/50 ${
                    voiceId === v.id ? "border-primary ring-2 ring-primary/20" : ""
                  }`}
                  onClick={() => setVoiceId(v.id)}
                >
                  <CardContent className="p-3">
                    <div className="font-medium text-sm">{v.name}</div>
                    <div className="text-xs text-muted-foreground">{v.description}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <Label className="mb-2 block">Tone</Label>
              <div className="flex flex-wrap gap-2">
                {["dramatic", "casual", "funny", "educational"].map((t) => (
                  <Button
                    key={t}
                    variant={tone === t ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTone(t)}
                    className="capitalize"
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-2 block">Duration</Label>
              <div className="flex gap-2">
                {[30, 45, 60].map((d) => (
                  <Button
                    key={d}
                    variant={duration === d ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDuration(d)}
                  >
                    {d}s
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="topic" className="mb-2 block">
              Custom Topic (optional)
            </Label>
            <Input
              id="topic"
              placeholder="Leave blank for AI to choose a trending topic"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
            />
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button
              onClick={() => {
                setStep(3);
                handleGenerateScript();
              }}
            >
              <Sparkles className="mr-1 h-4 w-4" /> Generate Script
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Review & Edit Script</h2>

          {isGenerating ? (
            <div className="flex flex-col items-center py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p>Generating script with Gemini AI...</p>
              <p className="text-sm mt-1">This may take 10-20 seconds</p>
            </div>
          ) : generatedScript ? (
            <>
              <div className="space-y-2">
                <Label className="text-base font-medium">
                  Title: {generatedScript.title}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {generatedScript.description}
                </p>
              </div>

              <div>
                <Label className="mb-2 block">
                  Script ({generatedScript.scenes.length} scenes)
                </Label>
                <textarea
                  className="w-full min-h-[300px] rounded-md border bg-background p-4 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editableScript}
                  onChange={(e) => setEditableScript(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Edit the narration text above. Scene markers [Scene N] are used
                  for timing — keep them in place.
                </p>
              </div>

              <div className="flex justify-between">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    <ArrowLeft className="mr-1 h-4 w-4" /> Back
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleGenerateScript}
                    disabled={isGenerating}
                  >
                    <RefreshCw className="mr-1 h-4 w-4" /> Regenerate
                  </Button>
                </div>
                <Button onClick={handleApproveAndGenerate} disabled={isCreating}>
                  {isCreating ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Creating...
                    </>
                  ) : (
                    <>
                      <Check className="mr-1 h-4 w-4" /> Approve & Generate Video
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
