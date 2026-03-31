"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus, Loader2, Trash2, Star, User, Cat, Bot, Skull, Sparkles, ImageIcon,
} from "lucide-react";

interface Character {
  id: string;
  name: string;
  type: string;
  fullPrompt: string;
  previewUrl: string | null;
  createdAt: string;
  _count: { series: number; automations: number };
}

const TYPE_ICONS: Record<string, typeof User> = {
  human: User,
  animal: Cat,
  robot: Bot,
  creature: Skull,
  custom: Sparkles,
};

export default function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingPreview, setGeneratingPreview] = useState<string | null>(null);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch("/api/characters");
      const json = await res.json();
      if (json.data) setCharacters(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCharacters(); }, [fetchCharacters]);

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/characters/${id}`, { method: "DELETE" });
      if (res.ok) setCharacters((prev) => prev.filter((c) => c.id !== id));
    } catch { /* ignore */ }
  }

  async function handleGeneratePreview(id: string) {
    setGeneratingPreview(id);
    try {
      const res = await fetch(`/api/characters/${id}/preview`, { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        setCharacters((prev) =>
          prev.map((c) => (c.id === id ? { ...c, previewUrl: json.data.previewUrl } : c)),
        );
      }
    } catch { /* ignore */ }
    finally { setGeneratingPreview(null); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Star className="h-7 w-7" /> Characters
          </h1>
          <p className="mt-1 text-muted-foreground">
            Create reusable characters for Star Mode videos with consistent appearances.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/characters/new">
            <Plus className="mr-2 h-4 w-4" /> New Character
          </Link>
        </Button>
      </div>

      {characters.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
            <Star className="h-12 w-12 mb-4" />
            <h2 className="text-xl font-semibold text-foreground">No characters yet</h2>
            <p className="text-sm mt-2 text-center max-w-md">
              Characters appear consistently across all scenes in your videos.
              Create one to use in Star Mode.
            </p>
            <Button asChild className="mt-6">
              <Link href="/dashboard/characters/new">
                <Plus className="mr-2 h-4 w-4" /> Create your first character
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {characters.map((char) => {
            const TypeIcon = TYPE_ICONS[char.type] ?? Sparkles;
            const usageCount = char._count.series + char._count.automations;
            return (
              <Card key={char.id} className="flex flex-col transition-colors hover:border-primary/50">
                <CardContent className="p-4 space-y-3 flex-1 flex flex-col">
                  {/* Preview image */}
                  <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-muted/30 flex items-center justify-center">
                    {char.previewUrl ? (
                      <Image
                        src={char.previewUrl}
                        alt={char.name}
                        fill
                        className="object-contain"
                      />
                    ) : (
                      <div className="text-center text-muted-foreground">
                        <TypeIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={generatingPreview === char.id}
                          onClick={() => handleGeneratePreview(char.id)}
                        >
                          {generatingPreview === char.id ? (
                            <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Generating...</>
                          ) : (
                            <><ImageIcon className="mr-1 h-3 w-3" /> Generate Preview</>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Name + type */}
                  <div className="flex items-center gap-2">
                    <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <h3 className="font-semibold truncate flex-1">{char.name}</h3>
                    <Badge variant="secondary" className="text-[10px] capitalize shrink-0">
                      {char.type}
                    </Badge>
                  </div>

                  {/* Prompt preview */}
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {char.fullPrompt}
                  </p>

                  {/* Usage */}
                  {usageCount > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      Used in {usageCount} {usageCount === 1 ? "project" : "projects"}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-auto pt-2">
                    <Button variant="outline" size="xs" asChild className="flex-1">
                      <Link href={`/dashboard/characters/new?edit=${char.id}`}>
                        Edit
                      </Link>
                    </Button>
                    {char.previewUrl ? (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={generatingPreview === char.id}
                        onClick={() => handleGeneratePreview(char.id)}
                      >
                        {generatingPreview === char.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ImageIcon className="h-3 w-3" />
                        )}
                      </Button>
                    ) : null}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive shrink-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete character?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete &quot;{char.name}&quot;.
                            Existing videos and automations using this character will keep working but won&apos;t reference it anymore.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(char.id)}
                            className="bg-destructive text-white hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
