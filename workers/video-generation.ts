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
import { createLogger } from "../src/lib/logger";
import { buildPrompt, getSceneCount } from "../src/services/providers/llm/prompt";
import path from "path";
import fs from "fs/promises";
import type { VideoJobData } from "../src/services/queue";

const log = createLogger("Worker");
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

    log.log(`Providers: LLM=${llmProvider}, TTS=${ttsProvider}, Image=${imageProvider}, Lang=${language ?? "en"}`);

    const checkpoint = await loadCheckpoint(videoId);
    const completed = new Set(checkpoint.completedStages ?? []);

    log.log(`Starting: ${videoId} (${scenes.length} scenes, resuming from: ${completed.size > 0 ? [...completed].join(",") : "beginning"})`);

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
        log.log(`Script saved — title: "${title}"`);

        const sceneCount = getSceneCount(job.data.duration);
        const llmPrompt = buildPrompt({
          niche: niche ?? "", tone: tone ?? "dramatic",
          artStyle: artStyle ?? "", duration: job.data.duration,
          topic: undefined, language: language ?? "en",
        }, sceneCount);
        log.log(`LLM prompt sent to ${llmProvider}:\n${"─".repeat(60)}\n${llmPrompt}\n${"─".repeat(60)}`);

        log.log(`Generated script (narration):\n${"─".repeat(60)}\n${scriptText}\n${"─".repeat(60)}`);
        for (let i = 0; i < scenes.length; i++) {
          log.log(`Scene ${i + 1}/${scenes.length} narration: "${scenes[i].text.slice(0, 120)}${scenes[i].text.length > 120 ? "..." : ""}"`);
          log.log(`Scene ${i + 1}/${scenes.length} visualDesc: "${scenes[i].visualDescription.slice(0, 200)}${scenes[i].visualDescription.length > 200 ? "..." : ""}"`);
        }
      } else {
        log.log("Script: skipped (checkpoint)");
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
        log.log(`TTS done: ${durationMs}ms (${ttsProvider}, voice=${resolvedVoice})`);
      } else {
        log.log(`TTS: skipped (checkpoint, ${durationMs}ms)`);
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

        log.log(`Generating ${targetImageCount} images (${imageProvider}, artStyle=${artStyle}, neg="${resolvedNeg.slice(0, 80)}")`);
        for (let i = 0; i < imagePrompts.length; i++) {
          log.log(`Image ${i + 1}/${imagePrompts.length} prompt: "${imagePrompts[i].slice(0, 250)}${imagePrompts[i].length > 250 ? "..." : ""}"`);
        }

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
        log.log(`Images done: ${imagePaths.length} for ${Math.round(durationMs! / 1000)}s audio (${imageProvider})`);

        if (reviewMode) {
          await db.video.update({
            where: { id: videoId },
            data: {
              status: "REVIEW",
              generationStage: null,
              voiceoverUrl: audioPath,
            },
          });
          log.log(`Review mode: pausing for user approval (${videoId})`);
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
        log.log(`Images: skipped (checkpoint, ${imagePaths!.length} images)`);
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
        language: language ?? "en",
      });
      log.log("Assembly done");

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

      log.log(`READY: ${videoId}`);

      try {
        const results = await postVideoToSocials(videoId);
        if (results.length > 0) {
          const posted = results.filter((r) => r.success).map((r) => r.platform);
          const failed = results.filter((r) => !r.success).map((r) => `${r.platform}: ${r.error}`);
          if (posted.length > 0) log.log(`Auto-posted to: ${posted.join(", ")}`);
          if (failed.length > 0) log.warn(`Posting failed: ${failed.join("; ")}`);
        }
      } catch (postErr) {
        log.warn("Auto-posting error (non-fatal):", postErr);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      log.error(`FAILED ${videoId}:`, msg);

      try {
        await db.video.update({
          where: { id: videoId },
          data: { status: "FAILED", generationStage: null, errorMessage: msg.slice(0, 500) },
        });
      } catch (dbErr) {
        log.error(`CRITICAL: Could not mark ${videoId} as FAILED:`, dbErr);
      }

      throw error;
    }
  },
  { connection: redis as never, concurrency: 1 }
);

worker.on("completed", (job) => log.log(`Job ${job.id} completed`));
worker.on("failed", (job, err) => log.error(`Job ${job?.id} failed:`, err.message));

log.log("Video generation worker started. Waiting for jobs...");
