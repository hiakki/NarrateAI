"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  User, Cat, Bot, Skull, Sparkles, ChevronDown,
} from "lucide-react";

const CHARACTER_TYPES = [
  { id: "human", label: "Human", icon: User },
  { id: "animal", label: "Animal", icon: Cat },
  { id: "robot", label: "Robot", icon: Bot },
  { id: "creature", label: "Creature", icon: Skull },
  { id: "custom", label: "Custom", icon: Sparkles },
] as const;

export interface CharacterFormData {
  name: string;
  type: string;
  physical: string;
  clothing: string;
  accessories: string;
  features: string;
  personality: string;
  fullPrompt: string;
}

interface CharacterBuilderProps {
  initial?: Partial<CharacterFormData>;
  onChange: (data: CharacterFormData) => void;
  compact?: boolean;
}

function assemblePrompt(d: Omit<CharacterFormData, "fullPrompt" | "name">): string {
  const parts: string[] = [];
  if (d.type && d.physical) parts.push(`A ${d.type} character: ${d.physical}`);
  else if (d.physical) parts.push(d.physical);
  if (d.clothing) parts.push(`Wearing ${d.clothing}`);
  if (d.accessories) parts.push(d.accessories);
  if (d.features) parts.push(`Distinguishing features: ${d.features}`);
  return parts.join(". ").replace(/\.\./g, ".").trim() || "";
}

export function CharacterBuilder({ initial, onChange, compact }: CharacterBuilderProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState(initial?.type ?? "human");
  const [physical, setPhysical] = useState(initial?.physical ?? "");
  const [clothing, setClothing] = useState(initial?.clothing ?? "");
  const [accessories, setAccessories] = useState(initial?.accessories ?? "");
  const [features, setFeatures] = useState(initial?.features ?? "");
  const [personality, setPersonality] = useState(initial?.personality ?? "");
  const [fullPrompt, setFullPrompt] = useState(initial?.fullPrompt ?? "");
  const [manualEdit, setManualEdit] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(
    !!(initial?.accessories || initial?.features || initial?.personality),
  );

  const autoPrompt = assemblePrompt({ type, physical, clothing, accessories, features, personality });

  useEffect(() => {
    if (!manualEdit && autoPrompt) setFullPrompt(autoPrompt);
  }, [autoPrompt, manualEdit]);

  const emit = useCallback(() => {
    onChange({ name, type, physical, clothing, accessories, features, personality, fullPrompt });
  }, [name, type, physical, clothing, accessories, features, personality, fullPrompt, onChange]);

  useEffect(() => { emit(); }, [emit]);

  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <Label className="text-xs mb-1 block">Character Name</Label>
        <Input
          placeholder="e.g. Bablu, Captain Nova, Shadow Fox"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      {/* Type */}
      <div>
        <Label className="text-xs mb-1.5 block">Type</Label>
        <div className="flex flex-wrap gap-1.5">
          {CHARACTER_TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <Button
                key={t.id}
                type="button"
                size={compact ? "xs" : "sm"}
                variant={type === t.id ? "default" : "outline"}
                onClick={() => setType(t.id)}
                className="gap-1.5"
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Physical */}
      <div>
        <Label className="text-xs mb-1 block">Physical Appearance</Label>
        <Textarea
          placeholder="e.g. chubby brown monkey, big expressive eyes, 3 feet tall, round face"
          value={physical}
          onChange={(e) => { setPhysical(e.target.value); setManualEdit(false); }}
          rows={2}
          className="text-sm resize-none"
        />
      </div>

      {/* Clothing */}
      <div>
        <Label className="text-xs mb-1 block">Clothing / Outfit</Label>
        <Textarea
          placeholder="e.g. red baseball cap, blue vest, torn jeans, no shoes"
          value={clothing}
          onChange={(e) => { setClothing(e.target.value); setManualEdit(false); }}
          rows={2}
          className="text-sm resize-none"
        />
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        More Details (accessories, features, personality)
      </button>

      {showAdvanced && (
        <div className="space-y-4 pl-2 border-l-2 border-muted">
          <div>
            <Label className="text-xs mb-1 block">Accessories / Props</Label>
            <Textarea
              placeholder="e.g. gold chain necklace, aviator sunglasses, leather backpack"
              value={accessories}
              onChange={(e) => { setAccessories(e.target.value); setManualEdit(false); }}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Distinguishing Features</Label>
            <Textarea
              placeholder="e.g. scar across left cheek, always grinning, bright green eyes"
              value={features}
              onChange={(e) => { setFeatures(e.target.value); setManualEdit(false); }}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">
              Personality <span className="text-muted-foreground">(affects narration style, not images)</span>
            </Label>
            <Textarea
              placeholder="e.g. mischievous, overconfident, speaks in slang, always cracking jokes"
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
        </div>
      )}

      {/* Full Prompt */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Image Prompt (used in every scene)</Label>
          {!manualEdit && fullPrompt && (
            <button
              type="button"
              onClick={() => setManualEdit(true)}
              className="text-[10px] text-muted-foreground hover:text-foreground underline"
            >
              Edit manually
            </button>
          )}
          {manualEdit && (
            <button
              type="button"
              onClick={() => { setManualEdit(false); setFullPrompt(autoPrompt); }}
              className="text-[10px] text-muted-foreground hover:text-foreground underline"
            >
              Reset to auto-generated
            </button>
          )}
        </div>
        <Textarea
          value={fullPrompt}
          onChange={(e) => { setFullPrompt(e.target.value); setManualEdit(true); }}
          rows={3}
          className={`text-sm resize-none ${!manualEdit ? "bg-muted/30" : ""}`}
          readOnly={!manualEdit}
          placeholder="Fill in the fields above to auto-generate, or click 'Edit manually'"
        />
        {fullPrompt && (
          <p className="text-[10px] text-muted-foreground mt-1">
            {fullPrompt.split(/\s+/).length} words — this exact text is prepended to every image prompt for consistency
          </p>
        )}
      </div>
    </div>
  );
}
