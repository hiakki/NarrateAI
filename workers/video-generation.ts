import "dotenv/config";
import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { generateSpeech } from "../src/services/tts";
import { generateSceneImages } from "../src/services/image-generator";
import { assembleVideo } from "../src/services/video-assembler";
import path from "path";
import fs from "fs/promises";
import type { VideoJobData } from "../src/services/queue";

const db = new PrismaClient();

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const parsedUrl = new URL(redisUrl);
const redisConnection = {
  host: parsedUrl.hostname,
  port: parseInt(parsedUrl.port || "6379"),
  maxRetriesPerRequest: null as null,
};

async function updateVideoStage(
  videoId: string,
  stage: "SCRIPT" | "TTS" | "IMAGES" | "ASSEMBLY" | "UPLOADING"
) {
  await db.video.update({
    where: { id: videoId },
    data: { generationStage: stage, status: "GENERATING" },
  });
}

const worker = new Worker<VideoJobData>(
  "video-generation",
  async (job) => {
    const { videoId, title, scriptText, scenes, artStylePrompt, voiceId } = job.data;
    console.log(`[Worker] Starting video generation for ${videoId}`);

    let ttsResult: Awaited<ReturnType<typeof generateSpeech>> | null = null;
    let imageResult: Awaited<ReturnType<typeof generateSceneImages>> | null = null;

    try {
      await updateVideoStage(videoId, "SCRIPT");
      await db.video.update({
        where: { id: videoId },
        data: { scriptText, title },
      });
      console.log(`[Worker] Script saved for ${videoId}`);

      await updateVideoStage(videoId, "TTS");
      ttsResult = await generateSpeech(scriptText, voiceId, scenes);
      console.log(`[Worker] TTS complete: ${ttsResult.durationMs}ms audio`);

      await updateVideoStage(videoId, "IMAGES");
      imageResult = await generateSceneImages(scenes, artStylePrompt);
      console.log(`[Worker] Images generated: ${imageResult.imagePaths.length} scenes`);

      await updateVideoStage(videoId, "ASSEMBLY");
      const outputDir = path.join(process.cwd(), "public", "videos");
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `${videoId}.mp4`);

      await assembleVideo({
        imagePaths: imageResult.imagePaths,
        audioPath: ttsResult.audioPath,
        sceneTimings: ttsResult.sceneTimings,
        scenes,
        outputPath,
      });
      console.log(`[Worker] Video assembled at ${outputPath}`);

      await updateVideoStage(videoId, "UPLOADING");
      const videoUrl = `/videos/${videoId}.mp4`;

      await db.video.update({
        where: { id: videoId },
        data: {
          status: "READY",
          generationStage: null,
          videoUrl,
          voiceoverUrl: ttsResult.audioPath,
          duration: Math.round(ttsResult.durationMs / 1000),
        },
      });

      console.log(`[Worker] Video ${videoId} is READY`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Worker] Failed for ${videoId}:`, errorMessage);

      await db.video.update({
        where: { id: videoId },
        data: {
          status: "FAILED",
          generationStage: null,
          errorMessage,
        },
      });

      throw error;
    } finally {
      if (ttsResult?.audioPath) {
        const dir = path.dirname(ttsResult.audioPath);
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      if (imageResult?.tmpDir) {
        await fs.rm(imageResult.tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

worker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

console.log("[Worker] Video generation worker started. Waiting for jobs...");
