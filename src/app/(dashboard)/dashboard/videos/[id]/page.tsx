"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Mic,
  ImageIcon,
  Clapperboard,
  Upload,
  Clock,
  XCircle,
  Film,
} from "lucide-react";

const stages = [
  { key: "SCRIPT", label: "Script", detail: "AI is writing your narration", icon: FileText },
  { key: "TTS", label: "Voiceover", detail: "Generating AI voiceover", icon: Mic },
  { key: "IMAGES", label: "Images", detail: "Creating scene visuals", icon: ImageIcon },
  { key: "ASSEMBLY", label: "Assembly", detail: "Building video with Ken Burns + captions + music", icon: Clapperboard },
  { key: "UPLOADING", label: "Finalize", detail: "Saving your video", icon: Upload },
];

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/videos/${id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Retry failed");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["video", id] });
    } catch {
      alert("Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  const [queuedTimedOut, setQueuedTimedOut] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const queuedSince = useRef<number | null>(null);

  const { data: video, isLoading } = useQuery({
    queryKey: ["video", id],
    queryFn: async () => {
      const res = await fetch(`/api/videos/${id}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      return json.data;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "QUEUED" || status === "GENERATING") return 2000;
      return false;
    },
  });

  useEffect(() => {
    if (video?.status === "QUEUED") {
      if (!queuedSince.current) queuedSince.current = Date.now();
      const timer = setInterval(() => {
        const elapsed = queuedSince.current ? Date.now() - queuedSince.current : 0;
        const remaining = Math.max(0, 60 - Math.floor(elapsed / 1000));
        setCountdown(remaining);
        if (remaining === 0) {
          setQueuedTimedOut(true);
          clearInterval(timer);
        }
      }, 1000);
      return () => clearInterval(timer);
    } else {
      queuedSince.current = null;
      setQueuedTimedOut(false);
      setCountdown(60);
    }
  }, [video?.status]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="text-center py-20 text-muted-foreground">Video not found</div>
    );
  }

  const isQueued = video.status === "QUEUED";
  const isGenerating = video.status === "GENERATING";
  const isInProgress = isQueued || isGenerating;
  const isReady = video.status === "READY" || video.status === "POSTED";
  const isFailed = video.status === "FAILED";

  const currentStageIndex = video.generationStage
    ? stages.findIndex((s) => s.key === video.generationStage)
    : -1;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold truncate">{video.title || "Video"}</h1>
      </div>

      {/* ── PROGRESS TRACKER ── */}
      {isInProgress && (
        <Card className="mb-8 overflow-hidden">
          <div className={`px-6 py-4 border-b ${queuedTimedOut ? "bg-amber-50" : "bg-gradient-to-r from-primary/5 to-primary/10"}`}>
            <div className="flex items-center gap-3">
              {queuedTimedOut ? (
                <AlertCircle className="h-5 w-5 text-amber-600" />
              ) : isQueued ? (
                <Clock className="h-5 w-5 text-amber-500 animate-pulse" />
              ) : (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              )}
              <div className="flex-1">
                <h2 className="font-semibold">
                  {queuedTimedOut
                    ? "Worker not responding"
                    : isQueued
                    ? "Waiting for worker..."
                    : "Generating your video"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {queuedTimedOut
                    ? "The worker hasn't picked up this job in 60 seconds. You can retry or check if the worker is running."
                    : isQueued
                    ? `Your video is queued. Waiting for worker... (${countdown}s)`
                    : "This usually takes 2-4 minutes. Do not close this page."}
                </p>
              </div>
              {isQueued && !queuedTimedOut && (
                <span className="text-lg font-mono font-bold text-amber-600 tabular-nums min-w-[3ch] text-right">
                  {countdown}
                </span>
              )}
              {queuedTimedOut && (
                <Button size="sm" onClick={handleRetry} disabled={retrying}>
                  {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Retry"}
                </Button>
              )}
            </div>
          </div>

          <CardContent className="py-6 px-6">
            <div className="space-y-0">
              {stages.map((stage, i) => {
                const Icon = stage.icon;
                const isDone = currentStageIndex > i;
                const isActive = currentStageIndex === i;
                const isPending = currentStageIndex < i;
                const isLast = i === stages.length - 1;

                return (
                  <div key={stage.key} className="flex gap-4">
                    {/* Vertical line + circle */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`h-10 w-10 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                          isDone
                            ? "border-green-500 bg-green-50 text-green-600"
                            : isActive
                            ? "border-primary bg-primary/10 text-primary ring-4 ring-primary/20"
                            : "border-muted-foreground/20 bg-muted/50 text-muted-foreground/40"
                        }`}
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : isActive ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Icon className="h-5 w-5" />
                        )}
                      </div>
                      {!isLast && (
                        <div
                          className={`w-0.5 h-8 transition-all duration-500 ${
                            isDone ? "bg-green-500" : "bg-muted-foreground/15"
                          }`}
                        />
                      )}
                    </div>

                    {/* Label */}
                    <div className="pt-2 pb-4">
                      <p
                        className={`text-sm font-medium ${
                          isDone
                            ? "text-green-600"
                            : isActive
                            ? "text-primary"
                            : "text-muted-foreground/50"
                        }`}
                      >
                        {stage.label}
                        {isDone && (
                          <span className="ml-2 text-xs font-normal text-green-500">
                            Done
                          </span>
                        )}
                      </p>
                      {isActive && (
                        <p className="text-xs text-muted-foreground mt-0.5 animate-pulse">
                          {stage.detail}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── READY: VIDEO PLAYER ── */}
      {isReady && (
        <div className="space-y-6">
          <Card className="overflow-hidden border-green-200 bg-green-50/30">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-700">
                Video ready
              </span>
              {video.duration && (
                <span className="text-xs text-green-600 ml-auto">
                  {video.duration}s
                </span>
              )}
            </div>
          </Card>

          <div className="rounded-lg overflow-hidden bg-black shadow-xl">
            <video
              controls
              autoPlay
              className="w-full max-h-[70vh] mx-auto"
              src={`/api/videos/${video.id}/stream`}
            />
          </div>

          <div className="flex gap-3">
            <Button asChild>
              <a href={`/api/videos/${video.id}/download`}>
                <Download className="mr-2 h-4 w-4" /> Download MP4
              </a>
            </Button>
          </div>
        </div>
      )}

      {/* ── FAILED ── */}
      {isFailed && (
        <Card className="border-red-200">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-red-200 bg-red-50">
            <XCircle className="h-4 w-4 text-red-600" />
            <span className="text-sm font-medium text-red-700">
              Generation failed
            </span>
          </div>
          <CardContent className="py-8">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {video.errorMessage || "An unknown error occurred."}
              </p>
              <div className="flex gap-3 justify-center mt-6">
                <Button
                  onClick={handleRetry}
                  disabled={retrying}
                >
                  {retrying ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Retrying...</>
                  ) : (
                    <><Film className="mr-2 h-4 w-4" /> Retry Generation</>
                  )}
                </Button>
                <Button variant="outline" onClick={() => router.back()}>
                  Go Back
                </Button>
              </div>
            </div>

            {/* Show which stages completed before failure */}
            {video.generationStage && (
              <div className="mt-6 pt-6 border-t">
                <p className="text-xs text-muted-foreground mb-3">
                  Progress before failure:
                </p>
                <div className="flex gap-2">
                  {stages.map((stage, i) => {
                    const failedAt = stages.findIndex(
                      (s) => s.key === video.generationStage
                    );
                    return (
                      <div
                        key={stage.key}
                        className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                          i < failedAt
                            ? "bg-green-100 text-green-700"
                            : i === failedAt
                            ? "bg-red-100 text-red-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {i < failedAt ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : i === failedAt ? (
                          <XCircle className="h-3 w-3" />
                        ) : null}
                        {stage.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── STORYLINE (always visible when script exists) ── */}
      {video.scriptText && (
        <Card className="mt-6">
          <CardContent className="p-6">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Storyline
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {isInProgress
                ? "Your approved script — the AI is turning this into a video right now."
                : isFailed
                ? "The script that was being processed when the error occurred."
                : "The script used to generate this video."}
            </p>
            <div className="rounded-md bg-muted/50 p-4">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {video.scriptText}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
