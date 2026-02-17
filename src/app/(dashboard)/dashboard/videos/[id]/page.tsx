"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
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
  Image,
  Clapperboard,
  Upload,
} from "lucide-react";

const stageIcons: Record<string, typeof FileText> = {
  SCRIPT: FileText,
  TTS: Mic,
  IMAGES: Image,
  ASSEMBLY: Clapperboard,
  UPLOADING: Upload,
};

const stageLabels: Record<string, string> = {
  SCRIPT: "Generating script",
  TTS: "Creating voiceover",
  IMAGES: "Generating images",
  ASSEMBLY: "Assembling video",
  UPLOADING: "Finalizing",
};

const allStages = ["SCRIPT", "TTS", "IMAGES", "ASSEMBLY", "UPLOADING"];

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

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
      if (status === "QUEUED" || status === "GENERATING") return 3000;
      return false;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Video not found
      </div>
    );
  }

  const isGenerating = video.status === "QUEUED" || video.status === "GENERATING";
  const isReady = video.status === "READY" || video.status === "POSTED";
  const isFailed = video.status === "FAILED";
  const currentStageIndex = video.generationStage
    ? allStages.indexOf(video.generationStage)
    : -1;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold">{video.title || "Video"}</h1>
      </div>

      {isGenerating && (
        <Card className="mb-8">
          <CardContent className="py-8">
            <div className="text-center mb-8">
              <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4 text-primary" />
              <h2 className="text-xl font-semibold">Generating your video...</h2>
              <p className="text-sm text-muted-foreground mt-1">
                This usually takes 2-4 minutes
              </p>
            </div>
            <div className="flex justify-center gap-4">
              {allStages.map((stage, i) => {
                const Icon = stageIcons[stage];
                const isActive = stage === video.generationStage;
                const isDone = currentStageIndex > i;
                return (
                  <div key={stage} className="flex flex-col items-center gap-2">
                    <div
                      className={`h-10 w-10 rounded-full flex items-center justify-center ${
                        isDone
                          ? "bg-green-100 text-green-600"
                          : isActive
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
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
                    <span
                      className={`text-xs ${
                        isActive ? "text-primary font-medium" : "text-muted-foreground"
                      }`}
                    >
                      {stageLabels[stage]}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {isReady && (
        <div className="space-y-6">
          <div className="rounded-lg overflow-hidden bg-black">
            <video
              controls
              className="w-full max-h-[70vh] mx-auto"
              src={`/api/videos/${video.id}/stream`}
              poster={video.thumbnailUrl || undefined}
            />
          </div>

          <div className="flex gap-3">
            <Button asChild>
              <a href={`/api/videos/${video.id}/download`}>
                <Download className="mr-2 h-4 w-4" /> Download Video
              </a>
            </Button>
          </div>

          {video.scriptText && (
            <Card>
              <CardContent className="p-6">
                <h3 className="font-semibold mb-3">Script</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {video.scriptText}
                </p>
              </CardContent>
            </Card>
          )}

          {video.duration && (
            <p className="text-sm text-muted-foreground">
              Duration: {video.duration} seconds
            </p>
          )}
        </div>
      )}

      {isFailed && (
        <Card className="border-destructive/50">
          <CardContent className="flex flex-col items-center py-12">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold">Generation Failed</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-md text-center">
              {video.errorMessage || "An unknown error occurred during video generation."}
            </p>
            <Button className="mt-6" onClick={() => router.back()}>
              Go Back
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
