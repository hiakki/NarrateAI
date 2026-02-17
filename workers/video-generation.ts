import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { generateSpeech } from "../src/services/tts";
import { generateSceneImages } from "../src/services/image-generator";
import { assembleVideo } from "../src/services/video-assembler";
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
    const { videoId, title, scriptText, scenes, artStylePrompt, voiceId, musicPath } = job.data;

    const checkpoint = await loadCheckpoint(videoId);
    const completed = new Set(checkpoint.completedStages ?? []);

    console.log(`[Worker] Starting: ${videoId} (${scenes.length} scenes, resuming from: ${completed.size > 0 ? [...completed].join(",") : "beginning"})`);

    let audioPath = checkpoint.audioPath;
    let durationMs = checkpoint.durationMs;
    let sceneTimings = checkpoint.sceneTimings;
    let imagePaths = checkpoint.imagePaths;
    let imageTmpDir = checkpoint.imageTmpDir;

    try {
      // ── Stage 1: Script ──
      if (!completed.has("SCRIPT")) {
        await updateStage(videoId, "SCRIPT");
        await db.video.update({ where: { id: videoId }, data: { scriptText, title } });
        completed.add("SCRIPT");
        await saveCheckpoint(videoId, { ...checkpoint, completedStages: [...completed] });
        console.log("[Worker] Script saved");
      } else {
        console.log("[Worker] Script: skipped (checkpoint)");
      }

      // ── Stage 2: TTS ──
      if (!completed.has("TTS") || !audioPath || !(await fileExists(audioPath))) {
        await updateStage(videoId, "TTS");
        const tts = await generateSpeech(scriptText, voiceId, scenes);
        audioPath = tts.audioPath;
        durationMs = tts.durationMs;
        sceneTimings = tts.sceneTimings;

        await db.video.update({ where: { id: videoId }, data: { voiceoverUrl: audioPath } });
        completed.add("TTS");
        await saveCheckpoint(videoId, {
          completedStages: [...completed],
          audioPath, durationMs, sceneTimings,
          imagePaths, imageTmpDir,
        });
        console.log(`[Worker] TTS done: ${durationMs}ms`);
      } else {
        console.log(`[Worker] TTS: skipped (checkpoint, ${durationMs}ms)`);
      }

      // ── Stage 3: Images ──
      const allImagesExist = imagePaths && imagePaths.length === scenes.length &&
        await Promise.all(imagePaths.map(fileExists)).then(r => r.every(Boolean));

      if (!completed.has("IMAGES") || !allImagesExist) {
        await updateStage(videoId, "IMAGES");
        const imgResult = await generateSceneImages(scenes, artStylePrompt);
        imagePaths = imgResult.imagePaths;
        imageTmpDir = imgResult.tmpDir;

        completed.add("IMAGES");
        await saveCheckpoint(videoId, {
          completedStages: [...completed],
          audioPath, durationMs, sceneTimings,
          imagePaths, imageTmpDir,
        });
        console.log(`[Worker] Images done: ${imagePaths.length}`);
      } else {
        console.log(`[Worker] Images: skipped (checkpoint, ${imagePaths!.length} images)`);
      }

      // ── Stage 4: Assembly ──
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
        sceneTimings: sceneTimings!,
        scenes,
        musicPath: resolvedMusicPath,
        outputPath,
      });
      console.log("[Worker] Assembly done");

      // ── Stage 5: Finalize ──
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
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Worker] FAILED ${videoId}:`, msg);

      // Save checkpoint so retry can resume -- don't clear it
      await db.video.update({
        where: { id: videoId },
        data: { status: "FAILED", generationStage: null, errorMessage: msg },
      });

      throw error;
    }
    // NOTE: we do NOT clean up temp files on success either, since retry might
    // need them. They live in $TMPDIR which the OS cleans periodically.
  },
  { connection: redis as never, concurrency: 1 }
);

worker.on("completed", (job) => console.log(`[Worker] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[Worker] Job ${job?.id} failed:`, err.message));

console.log("[Worker] Video generation worker started. Waiting for jobs...");
