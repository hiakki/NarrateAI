"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, Cpu, Mic, Image as ImageIcon, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  costEstimate: string;
  qualityLabel: string;
}

interface AdminProviderData {
  enabledLlmProviders: string[];
  enabledTtsProviders: string[];
  enabledImageProviders: string[];
  allProviders: {
    llm: ProviderInfo[];
    tts: ProviderInfo[];
    image: ProviderInfo[];
  };
}

function ProviderToggleSection({
  title,
  icon,
  description,
  providers,
  enabledIds,
  onToggle,
}: {
  title: string;
  icon: React.ReactNode;
  description: string;
  providers: ProviderInfo[];
  enabledIds: Set<string>;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{description}</p>
      <div className="space-y-3">
        {providers.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg border p-4"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{p.name}</span>
                <Badge
                  variant={
                    p.qualityLabel === "Best"
                      ? "default"
                      : p.qualityLabel === "Great"
                        ? "secondary"
                        : "outline"
                  }
                  className="text-[10px] px-1.5 py-0"
                >
                  {p.qualityLabel}
                </Badge>
                <span className="text-xs font-mono text-muted-foreground">
                  {p.costEstimate}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {p.description}
              </p>
            </div>
            <Switch
              checked={enabledIds.has(p.id)}
              onCheckedChange={(checked) => onToggle(p.id, checked)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminProvidersPage() {
  const [data, setData] = useState<AdminProviderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [enabledLlm, setEnabledLlm] = useState<Set<string>>(new Set());
  const [enabledTts, setEnabledTts] = useState<Set<string>>(new Set());
  const [enabledImage, setEnabledImage] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/providers");
      const json = await res.json();
      if (json.data) {
        setData(json.data);
        setEnabledLlm(new Set(json.data.enabledLlmProviders));
        setEnabledTts(new Set(json.data.enabledTtsProviders));
        setEnabledImage(new Set(json.data.enabledImageProviders));
      }
    } catch (err) {
      console.error("Failed to load admin providers:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function toggleProvider(
    stage: "llm" | "tts" | "image",
    id: string,
    enabled: boolean,
  ) {
    const setter =
      stage === "llm"
        ? setEnabledLlm
        : stage === "tts"
          ? setEnabledTts
          : setEnabledImage;
    setter((prev) => {
      const next = new Set(prev);
      if (enabled) next.add(id);
      else next.delete(id);
      return next;
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch("/api/admin/providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabledLlmProviders: [...enabledLlm],
          enabledTtsProviders: [...enabledTts],
          enabledImageProviders: [...enabledImage],
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveMessage("Settings saved");
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

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="h-4 w-4 mr-1" /> Admin
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">AI Provider Controls</h1>
          <p className="mt-1 text-muted-foreground">
            Enable or disable AI providers for all users. Disabled providers are
            hidden from normal users.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider Visibility</CardTitle>
          <CardDescription>
            Toggle which AI providers regular users can see and select. Admin and
            Owner accounts always have access to all configured providers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <ProviderToggleSection
            title="Script Generation (LLM)"
            icon={<Cpu className="h-4 w-4 text-primary" />}
            description="Control which LLM providers users can choose for script generation."
            providers={data?.allProviders.llm ?? []}
            enabledIds={enabledLlm}
            onToggle={(id, enabled) => toggleProvider("llm", id, enabled)}
          />

          <Separator />

          <ProviderToggleSection
            title="Text-to-Speech"
            icon={<Mic className="h-4 w-4 text-primary" />}
            description="Control which TTS providers users can choose for voiceover."
            providers={data?.allProviders.tts ?? []}
            enabledIds={enabledTts}
            onToggle={(id, enabled) => toggleProvider("tts", id, enabled)}
          />

          <Separator />

          <ProviderToggleSection
            title="Image Generation"
            icon={<ImageIcon className="h-4 w-4 text-primary" />}
            description="Control which image providers users can choose for scene visuals."
            providers={data?.allProviders.image ?? []}
            enabledIds={enabledImage}
            onToggle={(id, enabled) => toggleProvider("image", id, enabled)}
          />

          <div className="flex items-center justify-between pt-2">
            <div className="text-sm">
              {saveMessage && (
                <span
                  className={
                    saveMessage.includes("Failed")
                      ? "text-destructive"
                      : "text-green-600"
                  }
                >
                  {saveMessage}
                </span>
              )}
            </div>
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                "Save Settings"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
