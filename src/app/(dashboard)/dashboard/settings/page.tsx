"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Check, Cpu, Mic, Image as ImageIcon, Info } from "lucide-react";

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

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/providers");
      const json = await res.json();
      if (json.data) {
        setProviders(json.data);
        setLlmProvider(json.data.defaults.llmProvider);
        setTtsProvider(json.data.defaults.ttsProvider);
        setImageProvider(json.data.defaults.imageProvider);
      }
    } catch (err) {
      console.error("Failed to load providers:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  async function handleSave() {
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch("/api/settings/providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llmProvider, ttsProvider, imageProvider }),
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
              <span className="capitalize">{(session?.user as Record<string, string>)?.role?.toLowerCase()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span className="capitalize">{(session?.user as Record<string, string>)?.plan?.toLowerCase()}</span>
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
      </div>
    </div>
  );
}
