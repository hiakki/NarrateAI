import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getArtStyleById } from "@/config/art-styles";
import { getNicheById } from "@/config/niches";
import { getDefaultVoiceId } from "@/config/voices";
import { IMAGE_PROVIDERS, TTS_PROVIDERS } from "@/config/providers";
import { IMAGE_TO_VIDEO_PROVIDERS } from "@/config/image-to-video-providers";
import { enqueueVideoGeneration } from "@/services/queue";
import { resolveProviders } from "@/services/providers/resolve";
import {
  relDirFromVideoUrl,
  scenesAbsDir,
  voiceoverAbsPath,
  resolveVideoFile,
} from "@/lib/video-paths";
import { createLogger, runWithVideoIdAsync } from "@/lib/logger";
import fs from "fs/promises";
import path from "path";

const log = createLogger("API:RerunStep");

type Checkpoint = {
  relDir?: string;
  completedStages?: string[];
  audioPath?: string;
  durationMs?: number;
  sceneTimings?: { startMs: number; endMs: number }[];
  imagePaths?: string[];
  expandedTimings?: { startMs: number; endMs: number }[];
  [k: string]: unknown;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const step = body?.step === "TTS" || body?.step === "IMAGES" || body?.step === "I2V" ? body.step : null;
    if (!step) {
      return NextResponse.json({ error: "Missing or invalid step. Use { step: \"TTS\" | \"IMAGES\" | \"I2V\" }" }, { status: 400 });
    }
    const imageProviderOverride = typeof body?.imageProvider === "string" && Object.keys(IMAGE_PROVIDERS).includes(body.imageProvider) ? body.imageProvider : undefined;
    const ttsProviderOverride = typeof body?.ttsProvider === "string" && Object.keys(TTS_PROVIDERS).includes(body.ttsProvider) ? body.ttsProvider : undefined;
    const imageToVideoProviderOverride = body?.imageToVideoProvider !== undefined
      ? (body.imageToVideoProvider === "" || Object.keys(IMAGE_TO_VIDEO_PROVIDERS).includes(body.imageToVideoProvider) ? body.imageToVideoProvider : undefined)
      : undefined;

    return runWithVideoIdAsync(id, async () => {
      const video = await db.video.findUnique({
        where: { id },
        include: {
          series: {
            include: {
              user: {
                select: {
                  defaultLlmProvider: true,
                  defaultTtsProvider: true,
                  defaultImageProvider: true,
                  defaultImageToVideoProvider: true,
                },
              },
              automation: { select: { name: true, characterId: true } },
              character: { select: { fullPrompt: true } },
            },
          },
        },
      });

      if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });
      if (video.series.userId !== session.user.id && session.user.role === "USER") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Use session user's latest defaults from DB for rerun (so "Rerun Images" uses current Settings)
      const currentUser = await db.user.findUnique({
        where: { id: session.user.id },
        select: {
          defaultLlmProvider: true,
          defaultTtsProvider: true,
          defaultImageProvider: true,
          defaultImageToVideoProvider: true,
        },
      });

      const allowedStatuses = ["READY", "REVIEW"];
      if (!allowedStatuses.includes(video.status)) {
        return NextResponse.json(
          { error: "Only ready or review videos can rerun a step" },
          { status: 400 }
        );
      }

      let relDir: string;
      let checkpoint: Checkpoint = (video.checkpointData as Checkpoint) ?? {};

      if (checkpoint.relDir) {
        relDir = checkpoint.relDir;
      } else if (video.videoUrl) {
        const fromUrl = relDirFromVideoUrl(video.videoUrl);
        if (!fromUrl) {
          return NextResponse.json({ error: "Could not determine video directory" }, { status: 400 });
        }
        relDir = fromUrl;
        if (step === "TTS") {
          const scDir = scenesAbsDir(relDir);
          try {
            const files = await fs.readdir(scDir);
            const sceneFiles = files.filter((f) => f.startsWith("scene-")).sort();
            checkpoint = {
              relDir,
              completedStages: ["SCRIPT", "IMAGES"],
              imagePaths: sceneFiles.map((f) => path.join(scDir, f)),
            };
          } catch {
            return NextResponse.json({ error: "Scene directory not found; cannot rerun TTS" }, { status: 400 });
          }
        } else {
          const voiceoverUrl = video.voiceoverUrl;
          if (!voiceoverUrl) {
            return NextResponse.json({ error: "No voiceover URL; cannot rerun Images" }, { status: 400 });
          }
          const audioPath = path.join(process.cwd(), "public", voiceoverUrl.replace(/^\//, ""));
          const durationMs = (video.duration ?? 0) * 1000;
          const sceneCount = (video.scenesJson as unknown[])?.length ?? 0;
          const sceneTimings = sceneCount > 0
            ? Array.from({ length: sceneCount }, (_, i) => ({
                startMs: (durationMs * i) / sceneCount,
                endMs: (durationMs * (i + 1)) / sceneCount,
              }))
            : undefined;
          checkpoint = {
            relDir,
            completedStages: ["SCRIPT", "TTS"],
            audioPath,
            durationMs,
            sceneTimings,
          };
        }
      } else {
        return NextResponse.json({ error: "No checkpoint or video URL; cannot rerun step" }, { status: 400 });
      }

      const artStyle = getArtStyleById(video.series.artStyle);
      const niche = getNicheById(video.series.niche);
      // Use user's current default for the step being rerun (e.g. Settings → Local Backend for images)
      const seriesForResolve = {
        llmProvider: video.series.llmProvider,
        ttsProvider: step === "TTS" ? null : video.series.ttsProvider,
        imageProvider: step === "IMAGES" ? null : video.series.imageProvider,
      };
      const resolved = resolveProviders(seriesForResolve, currentUser ?? undefined);
      const finalImage = step === "IMAGES" && imageProviderOverride ? imageProviderOverride : resolved.image;
      const finalTts = step === "TTS" && ttsProviderOverride ? ttsProviderOverride : resolved.tts;
      const scenes = (video.scenesJson as { text: string; visualDescription: string }[]) ?? [];
      if (scenes.length === 0) {
        return NextResponse.json({ error: "No scenes; cannot rerun step" }, { status: 400 });
      }
      if (step === "I2V") {
        if (!checkpoint.imagePaths || checkpoint.imagePaths.length === 0) {
          const scDir = scenesAbsDir(relDir);
          try {
            const files = await fs.readdir(scDir);
            const sceneImageFiles = files
              .filter((f) => f.startsWith("scene-") && !f.endsWith("-clip.mp4"))
              .sort();
            if (sceneImageFiles.length === 0) {
              return NextResponse.json({ error: "No scene images; cannot rerun image-to-video" }, { status: 400 });
            }
            checkpoint = { ...checkpoint, imagePaths: sceneImageFiles.map((f) => path.join(scDir, f)) };
          } catch {
            return NextResponse.json({ error: "No scene images; cannot rerun image-to-video" }, { status: 400 });
          }
        }
      }

      if (step === "TTS") {
        const newCheckpoint: Checkpoint = {
          ...checkpoint,
          relDir,
          completedStages: ["SCRIPT", "IMAGES"],
          imagePaths: checkpoint.imagePaths,
          expandedTimings: checkpoint.expandedTimings,
        };
        delete newCheckpoint.audioPath;
        delete newCheckpoint.durationMs;
        delete newCheckpoint.sceneTimings;

        try {
          await fs.unlink(voiceoverAbsPath(relDir, "mp3"));
        } catch { /* ignore */ }
        try {
          await fs.unlink(voiceoverAbsPath(relDir, "wav"));
        } catch { /* ignore */ }

        if (video.videoUrl) {
          try {
            const videoFile = resolveVideoFile(video.videoUrl);
            await fs.unlink(videoFile);
          } catch { /* ignore */ }
        }

        await db.video.update({
          where: { id },
          data: {
            status: "GENERATING",
            generationStage: "TTS",
            videoUrl: null,
            voiceoverUrl: null,
            errorMessage: null,
            checkpointData: newCheckpoint as never,
          },
        });

        log.log(`Rerun TTS for ${id}; assembly and final video will be re-created`);
      } else if (step === "IMAGES") {
        const newCheckpoint: Checkpoint = {
          ...checkpoint,
          relDir,
          completedStages: ["SCRIPT", "TTS"],
          audioPath: checkpoint.audioPath,
          durationMs: checkpoint.durationMs,
          sceneTimings: checkpoint.sceneTimings,
        };
        delete newCheckpoint.imagePaths;
        delete newCheckpoint.expandedTimings;

        const scDir = scenesAbsDir(relDir);
        try {
          const files = await fs.readdir(scDir);
          for (const f of files) {
            if (f.startsWith("scene-")) await fs.unlink(path.join(scDir, f));
          }
        } catch { /* ignore */ }

        if (video.videoUrl) {
          try {
            const videoFile = resolveVideoFile(video.videoUrl);
            await fs.unlink(videoFile);
          } catch { /* ignore */ }
        }

        await db.video.update({
          where: { id },
          data: {
            status: "GENERATING",
            generationStage: "IMAGES",
            videoUrl: null,
            errorMessage: null,
            checkpointData: newCheckpoint as never,
          },
        });

        log.log(`Rerun Images for ${id}; assembly and final video will be re-created`);
      }

      if (step === "I2V") {
        // Don't delete existing valid clips -- the worker will scan, keep valid ones,
        // remove corrupt ones, and only regenerate what's missing.
        if (video.videoUrl) {
          try {
            const videoFile = resolveVideoFile(video.videoUrl);
            await fs.unlink(videoFile);
          } catch { /* ignore */ }
        }
        const newCheckpoint: Checkpoint = {
          ...checkpoint,
          relDir,
          completedStages: ["SCRIPT", "TTS", "IMAGES"],
          imagePaths: checkpoint.imagePaths,
          expandedTimings: checkpoint.expandedTimings,
          audioPath: checkpoint.audioPath,
          durationMs: checkpoint.durationMs,
          sceneTimings: checkpoint.sceneTimings,
        };
        await db.video.update({
          where: { id },
          data: {
            status: "GENERATING",
            generationStage: "IMAGES",
            videoUrl: null,
            errorMessage: null,
            checkpointData: newCheckpoint as never,
          },
        });
        log.log(`Rerun Image-to-Video for ${id}; assembly and final video will be re-created`);
      }

      const finalI2V = step === "I2V" && imageToVideoProviderOverride !== undefined
        ? (imageToVideoProviderOverride === "" ? undefined : imageToVideoProviderOverride)
        : (currentUser?.defaultImageToVideoProvider ?? undefined);
      const useI2V = step === "I2V" ? finalI2V : (currentUser?.defaultImageToVideoProvider ?? process.env.USE_IMAGE_TO_VIDEO ?? undefined);
      const voiceId = video.series.voiceId ?? getDefaultVoiceId(finalTts);
      await enqueueVideoGeneration({
        videoId: video.id,
        seriesId: video.seriesId,
        userId: session.user.id,
        userName: session.user.name ?? session.user.email?.split("@")[0] ?? "user",
        automationName: video.series.automation?.name,
        title: video.title ?? "Untitled",
        scriptText: video.scriptText ?? "",
        scenes,
        artStyle: video.series.artStyle,
        artStylePrompt: artStyle?.promptModifier ?? "cinematic, high quality",
        negativePrompt: artStyle?.negativePrompt ?? "low quality, blurry, watermark, text",
        tone: video.series.tone ?? "dramatic",
        niche: video.series.niche,
        voiceId,
        language: video.series.language ?? "en",
        musicPath: niche?.defaultMusic,
        duration: video.targetDuration ?? video.duration ?? 45,
        llmProvider: resolved.llm,
        ttsProvider: finalTts,
        imageProvider: finalImage,
        imageToVideoProvider: useI2V,
        characterPrompt: video.series.character?.fullPrompt ?? undefined,
      });

      return NextResponse.json({
        data: { videoId: video.id, status: "GENERATING", step },
      });
    });
  } catch (error) {
    log.error("Rerun step error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rerun step" },
      { status: 500 }
    );
  }
}
