"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Film, Trash2, Loader2, X,
  Instagram, Youtube, Facebook, CloudOff, Star, EyeOff, Share2, Smartphone,
  BarChart2, Eye, Heart, Search, XCircle,
} from "lucide-react";

interface PostedEntry {
  platform: string;
  postId?: string;
  url?: string;
}

interface SeriesItem {
  id: string;
  name: string;
  niche: string;
  artStyle: string;
  characterId: string | null;
  _count: { videos: number };
  videos: {
    status: string;
    generationStage: string | null;
    postedPlatforms: (string | PostedEntry)[];
    insights?: Record<string, { views?: number; likes?: number; comments?: number; reactions?: number }> | null;
    insightsRefreshedAt?: string | null;
  }[];
}

const statusDisplay: Record<string, { label: string; className: string }> = {
  QUEUED: { label: "Queued", className: "text-yellow-600 bg-yellow-50" },
  GENERATING: { label: "Generating", className: "text-blue-600 bg-blue-50" },
  REVIEW: { label: "Review", className: "text-amber-600 bg-amber-50" },
  READY: { label: "Ready", className: "text-green-600 bg-green-50" },
  SCHEDULED: { label: "Scheduled", className: "text-purple-600 bg-purple-50" },
  POSTED: { label: "Posted", className: "text-green-700 bg-green-100" },
  FAILED: { label: "Failed", className: "text-red-600 bg-red-50" },
};

export default function VideosPage() {
  const router = useRouter();
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchSeries = useCallback(async () => {
    try {
      const res = await fetch("/api/series");
      const json = await res.json();
      if (json.data) setSeries(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSeries(); }, [fetchSeries]);

  const filteredSeries = useMemo(() => {
    if (!searchQuery.trim()) return series;
    const q = searchQuery.toLowerCase();
    return series.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.niche.toLowerCase().includes(q) ||
      s.artStyle.toLowerCase().includes(q)
    );
  }, [series, searchQuery]);

  const selectMode = selected.size > 0;
  const allSelected = filteredSeries.length > 0 && selected.size === filteredSeries.length;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredSeries.map((s) => s.id)));
    }
  }

  async function handleBulkDelete() {
    setDeleting(true);
    const ids = [...selected];
    const results = await Promise.allSettled(
      ids.map((id) => fetch(`/api/series/${id}`, { method: "DELETE" })),
    );
    const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
    if (failed.length > 0) {
      alert(`${ids.length - failed.length} deleted, ${failed.length} failed`);
    }
    setSelected(new Set());
    setShowConfirm(false);
    setDeleting(false);
    fetchSeries();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Videos</h1>
          <p className="mt-1 text-muted-foreground">
            Browse all your generated video series.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectMode && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                <X className="mr-1 h-4 w-4" /> Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowConfirm(true)}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Delete {selected.size}
              </Button>
            </>
          )}
          <Button asChild>
            <Link href="/dashboard/create">
              <Plus className="mr-2 h-4 w-4" /> Create Video
            </Link>
          </Button>
        </div>
      </div>

      {/* Search bar */}
      {series.length > 0 && (
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search videos by name, niche, or art style…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border bg-background pl-10 pr-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/60"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {series.length > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
            />
            {allSelected ? "Deselect all" : "Select all"}
          </label>
          {selectMode && (
            <span className="text-xs text-muted-foreground">
              {selected.size} of {filteredSeries.length} selected
            </span>
          )}
          {searchQuery && (
            <span className="text-xs text-muted-foreground">
              Showing {filteredSeries.length} of {series.length}
            </span>
          )}
        </div>
      )}

      {series.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Film className="h-12 w-12 text-muted-foreground" />
            <h2 className="mt-4 text-xl font-semibold">No videos yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Create your first video to get started.
            </p>
            <Button asChild className="mt-6">
              <Link href="/dashboard/create">
                <Plus className="mr-2 h-4 w-4" /> Create your first video
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : filteredSeries.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Search className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">No videos match &quot;{searchQuery}&quot;</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredSeries.map((s) => {
            const latestVideo = s.videos[0];
            const vs = latestVideo
              ? statusDisplay[latestVideo.status] ?? statusDisplay.QUEUED
              : null;
            const isSelected = selected.has(s.id);

            return (
              <Card
                key={s.id}
                className={`overflow-hidden transition-all ${
                  isSelected
                    ? "border-destructive/50 ring-1 ring-destructive/20 bg-destructive/[0.02]"
                    : "hover:border-primary/50"
                }`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOne(s.id)}
                      className="shrink-0"
                    />
                    <Link href={`/dashboard/series/${s.id}`} className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">{s.name}</CardTitle>
                    </Link>
                  </div>
                </CardHeader>
                <Link href={`/dashboard/series/${s.id}`}>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm text-muted-foreground gap-2">
                      <span className="capitalize truncate min-w-0">{s.niche}</span>
                      <span className="shrink-0">{s._count.videos} video{s._count.videos !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs capitalize">
                        {s.artStyle.replace(/-/g, " ")}
                      </span>
                      {s.characterId ? (
                        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700">
                          <Star className="h-2.5 w-2.5 mr-0.5" /> Star
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          <EyeOff className="h-2.5 w-2.5 mr-0.5" /> Faceless
                        </span>
                      )}
                      {vs && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${vs.className}`}>
                          {vs.label}
                          {latestVideo?.status === "GENERATING" && latestVideo.generationStage && (
                            <span className="lowercase ml-1">({latestVideo.generationStage.toLowerCase()})</span>
                          )}
                        </span>
                      )}
                    </div>
                    {latestVideo && (latestVideo.status === "READY" || latestVideo.status === "POSTED") && (() => {
                      const raw = latestVideo.postedPlatforms ?? [];
                      const platforms = raw.map((p) =>
                        typeof p === "string" ? p : p.platform,
                      );
                      const hasYT = platforms.includes("YOUTUBE");
                      const hasIG = platforms.includes("INSTAGRAM");
                      const hasFB = platforms.includes("FACEBOOK");
                      const hasSC = platforms.includes("SHARECHAT");
                      const hasMoj = platforms.includes("MOJ");
                      const hasAny = hasYT || hasIG || hasFB || hasSC || hasMoj;
                      const insights = latestVideo.insights && typeof latestVideo.insights === "object" ? latestVideo.insights : null;
                      let views = 0, interactions = 0;
                      if (insights) {
                        for (const p of Object.values(insights)) {
                          if (p && typeof p === "object") {
                            views += Number(p.views) || 0;
                            interactions += (Number(p.likes) || 0) + (Number(p.comments) || 0) + (Number(p.reactions) || 0);
                          }
                        }
                      }
                      const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n));
                      return (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {hasAny ? (
                              <>
                                {hasYT && <Youtube className="h-3.5 w-3.5 text-red-600" />}
                                {hasIG && <Instagram className="h-3.5 w-3.5 text-pink-600" />}
                                {hasFB && <Facebook className="h-3.5 w-3.5 text-blue-600" />}
                                {hasSC && <Share2 className="h-3.5 w-3.5 text-orange-600" />}
                                {hasMoj && <Smartphone className="h-3.5 w-3.5 text-amber-600" />}
                                <span className="text-xs text-muted-foreground">Published</span>
                              </>
                            ) : (
                              <>
                                <CloudOff className="h-3.5 w-3.5 text-muted-foreground/50" />
                                <span className="text-xs text-muted-foreground/50">Not published</span>
                              </>
                            )}
                          </div>
                          {hasAny && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <BarChart2 className="h-3 w-3" />
                              <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" /> {fmt(views)} views</span>
                              <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" /> {fmt(interactions)} interactions</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Link>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} series?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selected.size} series and all their videos. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting...</>
              ) : (
                `Delete ${selected.size} series`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
