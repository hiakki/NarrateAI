import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { getTtsProvider, getImageProvider } from "../src/services/providers/factory";
import { resolveVoiceForProvider } from "../src/config/voices";
import { assembleVideo } from "../src/services/video-assembler";
import { buildImagePrompt } from "../src/services/providers/image/prompt-builder";
import { getArtStyleById } from "../src/config/art-styles";
import { expandScenesToImageSlots } from "../src/services/scene-expander";
import { postVideoToSocials } from "../src/services/social-poster";
import path from "path";
import fs from "fs/promises";
import type { VideoJobData } from "../src/services/queue";

const db = new PrismaClient();
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

interface Checkpoint {
  audioPath?: string;
  durationMs?: number;
  sceneTimings?: { startMs: number; endMs: number }[];
  imagePaths?: string[];
  imageTmpDir?: string;
  completedStages?: string[];
  totalImageCount?: number;
  imagePrompts?: string[];
  expandedTimings?: { startMs: number; endMs: number }[];
  reviewMode?: boolean;
  musicPath?: string;
}

async function updateStage(videoId: string, stage: string) {
  await db.video.update({
    where: { id: videoId },
    data: { generationStage: stage as never, status: "GENERATING" },
  });
}

async function saveCheckpoint(videoId: string, checkpoint: Checkpoint) {
  await db.video.update({
    where: { id: videoId },
    data: { checkpointData: checkpoint as never },
  });
}

async function loadCheckpoint(videoId: string): Promise<Checkpoint> {
  const video = await db.video.findUnique({ where: { id: videoId }, select: { checkpointData: true } });
  return (video?.checkpointData as Checkpoint) ?? {};
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

const worker = new Worker<VideoJobData>(
  "video-generation",
  async (job) => {
    const {
      videoId, title, scriptText, scenes, artStylePrompt, negativePrompt,
      voiceId, language, musicPath, ttsProvider, imageProvider, llmProvider,
      tone, niche, artStyle, reviewMode,
    } = job.data;

    if (!ttsProvider || !imageProvider || !scenes?.length) {
      throw new Error(`Invalid job data: missing required fields (tts=${ttsProvider}, image=${imageProvider}, scenes=${scenes?.length ?? 0})`);
    }

    console.log(`[Worker] Providers: LLM=${llmProvider}, TTS=${ttsProvider}, Image=${imageProvider}, Lang=${language ?? "en"}`);

    const checkpoint = await loadCheckpoint(videoId);
    const completed = new Set(checkpoint.completedStages ?? []);

    console.log(`[Worker] Starting: ${videoId} (${scenes.length} scenes, TTS: ${ttsProvider}, Image: ${imageProvider}, resuming from: ${completed.size > 0 ? [...completed].join(",") : "beginning"})`);

    let audioPath = checkpoint.audioPath;
    let durationMs = checkpoint.durationMs;
    let sceneTimings = checkpoint.sceneTimings;
    let imagePaths = checkpoint.imagePaths;
    let imageTmpDir = checkpoint.imageTmpDir;

    try {
      // -- Stage 1: Script --
      if (!completed.has("SCRIPT")) {
        await updateStage(videoId, "SCRIPT");
        await db.video.update({ where: { id: videoId }, data: { scriptText, title } });
        completed.add("SCRIPT");
        await saveCheckpoint(videoId, { ...checkpoint, completedStages: [...completed] });
        console.log("[Worker] Script saved");
      } else {
        console.log("[Worker] Script: skipped (checkpoint)");
      }

      // -- Stage 2: TTS --
      if (!completed.has("TTS") || !audioPath || !(await fileExists(audioPath))) {
        await updateStage(videoId, "TTS");
        const resolvedVoice = resolveVoiceForProvider(ttsProvider, voiceId, language);
        const tts = getTtsProvider(ttsProvider);
        const ttsResult = await tts.generateSpeech(scriptText, resolvedVoice, scenes);
        audioPath = ttsResult.audioPath;
        durationMs = ttsResult.durationMs;
        sceneTimings = ttsResult.sceneTimings;

        await db.video.update({ where: { id: videoId }, data: { voiceoverUrl: audioPath } });
        completed.add("TTS");
        await saveCheckpoint(videoId, {
          completedStages: [...completed],
          audioPath, durationMs, sceneTimings,
          imagePaths, imageTmpDir,
        });
        console.log(`[Worker] TTS done: ${durationMs}ms (${ttsProvider})`);
      } else {
        console.log(`[Worker] TTS: skipped (checkpoint, ${durationMs}ms)`);
      }

      // -- Stage 2.5: Expand scenes into image slots based on audio duration --
      const { slots: imageSlots, timings: expandedTimings } = expandScenesToImageSlots(scenes, durationMs!);

      // -- Stage 3: Images --
      const targetImageCount = imageSlots.length;
      const allImagesExist = imagePaths && imagePaths.length === targetImageCount &&
        await Promise.all(imagePaths.map(fileExists)).then(r => r.every(Boolean));

      if (!completed.has("IMAGES") || !allImagesExist) {
        await updateStage(videoId, "IMAGES");
        await saveCheckpoint(videoId, {
          completedStages: [...completed],
          audioPath, durationMs, sceneTimings,
          imagePaths, imageTmpDir,
          totalImageCount: targetImageCount,
        });
        const resolvedArtStyle = getArtStyleById(artStyle);
        const resolvedNeg = negativePrompt ?? resolvedArtStyle?.negativePrompt ?? "low quality, blurry, watermark, text";

        let enhancedSlots = imageSlots.map((s) => ({ ...s }));
        if (resolvedArtStyle) {
          enhancedSlots = imageSlots.map((s, i) => {
            const built = buildImagePrompt(s.visualDescription, resolvedArtStyle, i, imageSlots.length);
            return { ...s, visualDescription: built.prompt };
          });
        }

        const scenesDir = path.join(process.cwd(), "public", "videos", videoId, "scenes");
        await fs.mkdir(scenesDir, { recursive: true });

        const imagePrompts = enhancedSlots.map(s => s.visualDescription);

        const img = getImageProvider(imageProvider);
        const imgResult = await img.generateImages(enhancedSlots, artStylePrompt, resolvedNeg, async (index, srcPath) => {
          const ext = path.extname(srcPath) || ".png";
          const dest = path.join(scenesDir, `scene-${index.toString().padStart(3, "0")}${ext}`);
          await fs.copyFile(srcPath, dest);
        });
        imagePaths = imgResult.imagePaths;
        imageTmpDir = imgResult.tmpDir;

        completed.add("IMAGES");
        await saveCheckpoint(videoId, {
          completedStages: [...completed],
          audioPath, durationMs, sceneTimings: expandedTimings,
          imagePaths, imageTmpDir,
          imagePrompts,
          expandedTimings,
          reviewMode,
          musicPath,
        });
        console.log(`[Worker] Images done: ${imagePaths.length} for ${Math.round(durationMs! / 1000)}s audio (${imageProvider})`);

        if (reviewMode) {
          await db.video.update({
            where: { id: videoId },
            data: {
              status: "REVIEW",
              generationStage: null,
              voiceoverUrl: audioPath,
            },
          });
          console.log(`[Worker] Review mode: pausing for user approval (${videoId})`);
          return;
        }
      } else {
        const scenesDir = path.join(process.cwd(), "public", "videos", videoId, "scenes");
        await fs.mkdir(scenesDir, { recursive: true });
        for (let i = 0; i < imagePaths!.length; i++) {
          const ext = path.extname(imagePaths![i]) || ".png";
          const dest = path.join(scenesDir, `scene-${i.toString().padStart(3, "0")}${ext}`);
          if (!(await fileExists(dest))) await fs.copyFile(imagePaths![i], dest);
        }
        console.log(`[Worker] Images: skipped (checkpoint, ${imagePaths!.length} images)`);
      }

      // -- Stage 4: Assembly --
      await updateStage(videoId, "ASSEMBLY");
      const outputDir = path.join(process.cwd(), "public", "videos");
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `${videoId}.mp4`);

      let resolvedMusicPath: string | undefined;
      if (musicPath) {
        const fullMusicPath = path.join(process.cwd(), "public", "music", `${musicPath}.mp3`);
        if (await fileExists(fullMusicPath)) resolvedMusicPath = fullMusicPath;
      }

      await assembleVideo({
        imagePaths: imagePaths!,
        audioPath: audioPath!,
        sceneTimings: expandedTimings,
        scenes: imageSlots,
        captionScenes: scenes,
        captionTimings: sceneTimings!,
        musicPath: resolvedMusicPath,
        outputPath,
        tone: tone ?? "dramatic",
        niche: niche ?? "",
      });
      console.log("[Worker] Assembly done");

      // -- Stage 5: Finalize --
      await updateStage(videoId, "UPLOADING");
      await db.video.update({
        where: { id: videoId },
        data: {
          status: "READY",
          generationStage: null,
          videoUrl: `/videos/${videoId}.mp4`,
          duration: durationMs ? Math.round(durationMs / 1000) : null,
          checkpointData: null,
        },
      });

      console.log(`[Worker] READY: ${videoId}`);

      try {
        const results = await postVideoToSocials(videoId);
        if (results.length > 0) {
          const posted = results.filter((r) => r.success).map((r) => r.platform);
          const failed = results.filter((r) => !r.success).map((r) => `${r.platform}: ${r.error}`);
          if (posted.length > 0) console.log(`[Worker] Auto-posted to: ${posted.join(", ")}`);
          if (failed.length > 0) console.warn(`[Worker] Posting failed: ${failed.join("; ")}`);
        }
      } catch (postErr) {
        console.warn("[Worker] Auto-posting error (non-fatal):", postErr);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Worker] FAILED ${videoId}:`, msg);

      try {
        await db.video.update({
          where: { id: videoId },
          data: { status: "FAILED", generationStage: null, errorMessage: msg.slice(0, 500) },
        });
      } catch (dbErr) {
        console.error(`[Worker] CRITICAL: Could not mark ${videoId} as FAILED:`, dbErr);
      }

      throw error;
    }
  },
  { connection: redis as never, concurrency: 1 }
);

worker.on("completed", (job) => console.log(`[Worker] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[Worker] Job ${job?.id} failed:`, err.message));

console.log("[Worker] Video generation worker started. Waiting for jobs...");
