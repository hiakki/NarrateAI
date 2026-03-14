import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createLogger } from "@/lib/logger";

const log = createLogger("Queue");

export interface VideoJobData {
  videoId: string;
  seriesId: string;
  userId: string;
  userName: string;
  automationName?: string;
  title?: string;
  scriptText?: string;
  scenes?: { text: string; visualDescription: string }[];
  artStyle: string;
  artStylePrompt: string;
  negativePrompt: string;
  tone: string;
  niche: string;
  voiceId: string;
  language: string;
  musicPath?: string;
  duration: number;
  llmProvider: string;
  ttsProvider: string;
  imageProvider: string;
  /** If set, run image-to-video per scene (e.g. SVD_REPLICATE) and use clips in assembly. */
  imageToVideoProvider?: string;
  reviewMode?: boolean;
  characterPrompt?: string;
  /** Output aspect ratio. Default 9:16 (Reels/Shorts). Use 16:9 for cinematic/long-form (e.g. character-storytelling niche). */
  aspectRatio?: "9:16" | "16:9";
}

function createRedisConnection() {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const conn = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  conn.on("error", (err) => log.error("Redis Error:", err.message));
  return conn;
}

let queueInstance: Queue<VideoJobData> | null = null;

function getQueue(): Queue<VideoJobData> {
  if (!queueInstance) {
    queueInstance = new Queue<VideoJobData>("video-generation", {
      connection: createRedisConnection() as never,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return queueInstance;
}

export async function enqueueVideoGeneration(data: VideoJobData): Promise<string> {
  const queue = getQueue();
  const jobId = data.videoId;

  // BullMQ silently ignores add() when a job with the same ID already exists
  // (even in failed/completed state). Remove stale jobs first so retries work.
  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed" || state === "completed" || state === "unknown") {
        await existing.remove();
        log.log(`Removed stale ${state} job ${jobId} before re-enqueue`);
      } else if (state === "active") {
        log.warn(`Job ${jobId} already active in queue, skipping duplicate enqueue`);
        return jobId;
      } else if (state === "waiting" || state === "delayed") {
        await existing.remove();
        log.log(`Removed ${state} job ${jobId} so it can be re-enqueued immediately (retry or stuck)`);
      }
    }
  } catch (e) {
    log.warn(`Could not check/remove existing job ${jobId}:`, e);
  }

  log.log(`Enqueuing job ${jobId} (LLM: ${data.llmProvider}, TTS: ${data.ttsProvider}, Image: ${data.imageProvider})`);
  const job = await queue.add("generate", data, { jobId });
  log.log(`Job enqueued: ${job.id}`);
  return job.id ?? jobId;
}
