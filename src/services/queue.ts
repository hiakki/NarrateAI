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
  reviewMode?: boolean;
  characterPrompt?: string;
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
      } else if (state === "active" || state === "waiting" || state === "delayed") {
        log.warn(`Job ${jobId} already ${state} in queue, skipping duplicate enqueue`);
        return jobId;
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
