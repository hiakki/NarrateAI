"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CharacterBuilder, type CharacterFormData } from "@/components/character-builder";
import { ArrowLeft, Loader2, Save, Star } from "lucide-react";

function CharacterFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(!!editId);
  const [initial, setInitial] = useState<Partial<CharacterFormData> | undefined>();
  const [formData, setFormData] = useState<CharacterFormData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const res = await fetch(`/api/characters/${editId}`);
        const json = await res.json();
        if (json.data) setInitial(json.data);
      } catch { /* ignore */ }
      setLoadingEdit(false);
    })();
  }, [editId]);

  const handleChange = useCallback((data: CharacterFormData) => {
    setFormData(data);
  }, []);

  async function handleSave() {
    if (!formData?.name?.trim()) { setError("Name is required"); return; }
    if (!formData?.fullPrompt?.trim()) { setError("Character prompt is required"); return; }

    setSaving(true);
    setError("");
    try {
      const url = editId ? `/api/characters/${editId}` : "/api/characters";
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || "Save failed");
        return;
      }
      router.push("/dashboard/characters");
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loadingEdit) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/characters">
            <ArrowLeft className="h-4 w-4 mr-1" /> Characters
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Star className="h-7 w-7" />
          {editId ? "Edit Character" : "New Character"}
        </h1>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
          ) : (
            <><Save className="mr-2 h-4 w-4" /> {editId ? "Save Changes" : "Create Character"}</>
          )}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-6">
          <CharacterBuilder
            initial={initial}
            onChange={handleChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewCharacterPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <CharacterFormInner />
    </Suspense>
  );
}
