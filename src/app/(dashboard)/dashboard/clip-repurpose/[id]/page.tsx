"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2, ArrowLeft, Scissors, Clock, Film, Eye, TrendingUp,
  ExternalLink, CheckCircle2, XCircle, AlertCircle, Instagram,
  Youtube, Facebook, Share2, Smartphone, Zap, Search, X,
} from "lucide-react";
import { timeAgo, formatNumber } from "@/lib/format-utils";
import { PlatformEntry } from "@/lib/platform-utils";

interface ClipVideo {
  id: string;
  title: string | null;
  status: string;
  videoUrl: string | null;
  duration: number | null;
  sourceUrl: string | null;
  sourceMetadata: {
    platform?: string;
    channelName?: string;
    originalTitle?: string;
    viewCount?: number;
    peakSegment?: { startSec: number; endSec: number; avgHeat: number };
  } | null;
  postedPlatforms: (string | PlatformEntry)[];
  errorMessage: string | null;
  createdAt: string;
}

interface AutomationDetail {
  id: string;
  name: string;
  enabled: boolean;
  frequency: string;
  postTime: string;
  targetPlatforms: string[];
  clipConfig: {
    clipNiche?: string;
    clipDurationSec?: number;
    cropMode?: string;
  } | null;
  series: { id: string; videos: ClipVideo[] } | null;
}

const PLATFORM_ICON: Record<string, typeof Instagram> = {
  INSTAGRAM: Instagram, YOUTUBE: Youtube, FACEBOOK: Facebook,
  SHARECHAT: Share2, MOJ: Smartphone,
};

const STATUS_CFG: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  QUEUED:     { label: "Queued",     cls: "text-yellow-700 bg-yellow-50", icon: Clock },
  GENERATING: { label: "Generating", cls: "text-blue-700 bg-blue-50",    icon: Loader2 },
  READY:      { label: "Ready",      cls: "text-green-700 bg-green-50",  icon: CheckCircle2 },
  POSTED:     { label: "Posted",     cls: "text-green-800 bg-green-100", icon: CheckCircle2 },
  FAILED:     { label: "Failed",     cls: "text-red-700 bg-red-50",      icon: XCircle },
};

const ALL_STATUSES = ["QUEUED", "GENERATING", "READY", "POSTED", "FAILED"] as const;

export default function ClipAutomationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [auto, setAuto] = useState<AutomationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [totalVideos, setTotalVideos] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/automations/${id}?limit=200`, { cache: "no-store" });
      const json = await res.json();
      if (json.data) setAuto(json.data);
      if (json.totalVideos != null) setTotalVideos(json.totalVideos);
    } catch { /* ignore */ }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const allVideos = useMemo(() => auto?.series?.videos ?? [], [auto]);

  const filteredVideos = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return allVideos.filter((v) => {
      if (statusFilter && v.status !== statusFilter) return false;
      if (!query) return true;
      if (
        v.title?.toLowerCase().includes(query) ||
        v.sourceMetadata?.channelName?.toLowerCase().includes(query) ||
        v.sourceMetadata?.originalTitle?.toLowerCase().includes(query) ||
        v.sourceMetadata?.platform?.toLowerCase().includes(query) ||
        v.id.toLowerCase().includes(query) ||
        v.sourceUrl?.toLowerCase().includes(query)
      ) return true;
      const entries = (v.postedPlatforms ?? []) as PlatformEntry[];
      return entries.some((e) => typeof e === "object" && e.url?.toLowerCase().includes(query));
    });
  }, [allVideos, searchQuery, statusFilter]);

  const statusCounts = useMemo(
    () =>
      ALL_STATUSES.reduce((acc, s) => {
        acc[s] = allVideos.filter((v) => v.status === s).length;
        return acc;
      }, {} as Record<string, number>),
    [allVideos],
  );

  const triggerClip = async () => {
    setTriggering(true);
    try {
      await fetch("/api/clip-repurpose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger", automationId: id }),
      });
      setTimeout(fetchData, 2000);
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!auto) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-muted-foreground">Automation not found.</p>
        <Link href="/dashboard/clip-repurpose">
          <Button variant="ghost" className="mt-2"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Link href="/dashboard/clip-repurpose" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Automations
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2 min-w-0">
            <Scissors className="w-6 h-6 text-blue-500 shrink-0" />
            <span className="truncate">{auto.name}</span>
          </h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {auto.frequency} at {auto.postTime}</span>
            <span className="flex items-center gap-1"><Film className="w-3.5 h-3.5" /> {totalVideos || allVideos.length} clips</span>
            {auto.clipConfig?.clipNiche && (
              <Badge variant="outline" className="text-xs">{auto.clipConfig.clipNiche}</Badge>
            )}
            {auto.clipConfig?.clipDurationSec && (
              <Badge variant="outline" className="text-xs">{auto.clipConfig.clipDurationSec}s</Badge>
            )}
          </div>
        </div>
        <Button onClick={triggerClip} disabled={triggering}>
          {triggering ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Zap className="w-4 h-4 mr-1" />}
          Generate Clip
        </Button>
      </div>

      {/* Search & Filters */}
      {allVideos.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by title, channel, URL, or video ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setStatusFilter(null)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                !statusFilter
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-muted-foreground border-border hover:border-foreground/30"
              }`}
            >
              All ({allVideos.length})
            </button>
            {ALL_STATUSES.map((s) => {
              const cfg = STATUS_CFG[s];
              const count = statusCounts[s] || 0;
              if (count === 0) return null;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    statusFilter === s
                      ? `${cfg.cls} border-current font-medium`
                      : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                  }`}
                >
                  {cfg.label} ({count})
                </button>
              );
            })}
            {(searchQuery || statusFilter) && (
              <span className="text-xs text-muted-foreground ml-1">
                {filteredVideos.length} result{filteredVideos.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Videos Grid */}
      {allVideos.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 flex flex-col items-center justify-center text-center">
          <Scissors className="w-10 h-10 text-zinc-300 mb-3" />
          <p className="text-muted-foreground">No clips generated yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Click &quot;Generate Clip&quot; to create your first clip.</p>
        </div>
      ) : filteredVideos.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 flex flex-col items-center justify-center text-center">
          <Search className="w-10 h-10 text-zinc-300 mb-3" />
          <p className="text-muted-foreground">No clips match your search.</p>
          <button
            type="button"
            className="text-xs text-blue-500 hover:underline mt-2"
            onClick={() => { setSearchQuery(""); setStatusFilter(null); }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredVideos.map((v) => {
            const st = STATUS_CFG[v.status] ?? STATUS_CFG.QUEUED;
            const StIcon = st.icon;
            const posted = (v.postedPlatforms ?? []).map((p) =>
              typeof p === "string" ? { platform: p, success: true } : p,
            ) as PlatformEntry[];

            return (
              <div key={v.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/videos/${v.id}`)}>
                <div className="rounded-lg border overflow-hidden hover:border-primary/50 transition-colors group flex flex-col h-full">
                  {/* Thumbnail / video preview */}
                  {v.videoUrl && (v.status === "READY" || v.status === "POSTED") ? (
                    <video
                      src={v.videoUrl}
                      className="w-full aspect-[9/16] object-cover bg-black"
                      preload="none"
                      muted
                      playsInline
                      onMouseEnter={(e) => { (e.target as HTMLVideoElement).play().catch(() => {}); }}
                      onMouseLeave={(e) => {
                        const el = e.target as HTMLVideoElement;
                        el.pause();
                        el.currentTime = 0;
                      }}
                    />
                  ) : (
                    <div className="w-full aspect-[9/16] bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                      {v.status === "GENERATING" || v.status === "QUEUED" ? (
                        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
                      ) : v.status === "FAILED" ? (
                        <AlertCircle className="w-8 h-8 text-red-400" />
                      ) : (
                        <Scissors className="w-8 h-8 text-zinc-300" />
                      )}
                    </div>
                  )}

                  {/* Info */}
                  <div className="p-3 space-y-2 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium line-clamp-2 flex-1">{v.title ?? "Processing..."}</p>
                      <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${st.cls}`}>
                        <StIcon className={`h-2.5 w-2.5 ${v.status === "GENERATING" ? "animate-spin" : ""}`} />
                        {st.label}
                      </div>
                    </div>

                    {/* Source metadata */}
                    {v.sourceMetadata && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                        {v.sourceMetadata.channelName && <span>from {v.sourceMetadata.channelName}</span>}
                        {v.sourceMetadata.viewCount ? (
                          <span className="flex items-center gap-0.5">
                            <Eye className="w-2.5 h-2.5" /> {formatNumber(v.sourceMetadata.viewCount)}
                          </span>
                        ) : null}
                        {v.sourceMetadata.peakSegment && (
                          <span className="flex items-center gap-0.5">
                            <TrendingUp className="w-2.5 h-2.5" /> {(v.sourceMetadata.peakSegment.avgHeat * 100).toFixed(0)}%
                          </span>
                        )}
                        {v.sourceMetadata.platform && (
                          <Badge variant="outline" className="text-[9px] h-3.5 px-1">{v.sourceMetadata.platform}</Badge>
                        )}
                      </div>
                    )}

                    <div className="text-[10px] text-muted-foreground mt-auto pt-1">
                      {timeAgo(v.createdAt)}
                      {v.duration ? ` · ${v.duration}s` : ""}
                      {v.sourceUrl && (
                        <button
                          type="button"
                          className="ml-2 text-blue-500 hover:underline inline-flex items-center gap-0.5"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(v.sourceUrl!, "_blank"); }}
                        >
                          <ExternalLink className="w-2.5 h-2.5" /> Source
                        </button>
                      )}
                    </div>

                    {v.errorMessage && v.status === "FAILED" && (
                      <p className="text-[10px] text-red-500 truncate">{v.errorMessage}</p>
                    )}

                    {/* Platform posting status */}
                    {posted.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        {posted.map((p) => {
                          const Icon = PLATFORM_ICON[p.platform] ?? Share2;
                          const statusLabel =
                            p.success === "deleted" ? "Deleted"
                            : p.success === "scheduled" ? "Scheduled"
                            : p.success === true ? "Posted"
                            : p.success === false ? "Failed"
                            : "Pending";
                          const statusCls =
                            p.success === "deleted" ? "bg-zinc-100 border-zinc-300 text-zinc-400 line-through"
                            : p.success === "scheduled" ? "bg-blue-50 border-blue-200 text-blue-700"
                            : p.success === true ? "bg-green-50 border-green-200 text-green-700"
                            : p.success === false ? "bg-red-50 border-red-200 text-red-600"
                            : "bg-muted border-muted-foreground/20 text-muted-foreground";
                          const linkUrl = p.success !== "deleted" && p.success !== false ? p.url : undefined;
                          return linkUrl ? (
                            <button key={p.platform} type="button"
                              className={`flex items-center gap-0.5 text-[9px] rounded-full px-1.5 py-0.5 border hover:opacity-80 ${statusCls}`}
                              onClick={(e) => { e.stopPropagation(); window.open(linkUrl, "_blank"); }}>
                              <Icon className="w-2.5 h-2.5" />
                              {statusLabel}
                            </button>
                          ) : (
                            <span key={p.platform} className={`flex items-center gap-0.5 text-[9px] rounded-full px-1.5 py-0.5 border ${statusCls}`}>
                              <Icon className="w-2.5 h-2.5" />
                              {statusLabel}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
