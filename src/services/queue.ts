import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createLogger } from "@/lib/logger";

const log = createLogger("Queue");

export interface VideoJobData {
  videoId: string;
  seriesId: string;
  userId: string;
  userName: string;
  automationId?: string;
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
        log.warn(`Job ${jobId} is active — force-removing for re-enqueue (stale lock from dead worker?)`);
        await existing.moveToFailed(new Error("Replaced by retry"), "0", true);
        await existing.remove();
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

// ---------------------------------------------------------------------------
// Clip-repurpose queue
// ---------------------------------------------------------------------------

export interface ClipRepurposeJobData {
  videoId: string;
  seriesId: string;
  userId: string;
  userName: string;
  automationId?: string;
  automationName?: string;
  niche: string;
  language: string;
  tone: string;
  clipConfig: {
    clipNiche: string;
    clipDurationSec: number;
    cropMode: "blur-bg" | "center-crop";
    creditOriginal: boolean;
    preferPlatform?: "youtube" | "facebook" | "instagram";
    enableBgm?: boolean;
    enableHflip?: boolean;
  };
  targetPlatforms: string[];
}

let clipQueueInstance: Queue<ClipRepurposeJobData> | null = null;

function getClipQueue(): Queue<ClipRepurposeJobData> {
  if (!clipQueueInstance) {
    clipQueueInstance = new Queue<ClipRepurposeJobData>("clip-repurpose", {
      connection: createRedisConnection() as never,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return clipQueueInstance;
}

export async function enqueueClipRepurpose(data: ClipRepurposeJobData): Promise<string> {
  const queue = getClipQueue();
  const jobId = data.videoId;

  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed" || state === "completed" || state === "unknown") {
        await existing.remove();
      } else if (state === "active") {
        await existing.moveToFailed(new Error("Replaced by retry"), "0", true);
        await existing.remove();
      } else if (state === "waiting" || state === "delayed") {
        await existing.remove();
      }
    }
  } catch (e) {
    log.warn(`Could not check/remove existing clip job ${jobId}:`, e);
  }

  log.log(`Enqueuing clip-repurpose job ${jobId}`);
  const job = await queue.add("clip-repurpose", data, { jobId });
  return job.id ?? jobId;
}

// ---------------------------------------------------------------------------
// Scheduled-post queue (delayed BullMQ jobs for exact-time posting)
// ---------------------------------------------------------------------------

export interface PostVideoJobData {
  videoId: string;
  platforms: string[];
  scheduledAt?: string;
}

let postQueueInstance: Queue<PostVideoJobData> | null = null;

function getPostQueue(): Queue<PostVideoJobData> {
  if (!postQueueInstance) {
    postQueueInstance = new Queue<PostVideoJobData>("post-video", {
      connection: createRedisConnection() as never,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "fixed", delay: 30000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return postQueueInstance;
}

export function getPostVideoQueue(): Queue<PostVideoJobData> {
  return getPostQueue();
}

export async function enqueueScheduledPost(
  videoId: string,
  scheduledPostTime: Date | null,
  platforms: string[],
): Promise<string> {
  const queue = getPostQueue();
  const jobId = `post-${videoId}`;
  const delay = scheduledPostTime
    ? Math.max(0, scheduledPostTime.getTime() - Date.now())
    : 0;

  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (["failed", "completed", "unknown", "waiting", "delayed"].includes(state)) {
        await existing.remove();
      } else if (state === "active") {
        log.log(`Post job ${jobId} already active, skipping re-enqueue`);
        return jobId;
      }
    }
  } catch (e) {
    log.warn(`Could not check/remove existing post job ${jobId}:`, e);
  }

  const delaySec = Math.round(delay / 1000);
  const at = scheduledPostTime?.toISOString() ?? "immediate";
  log.log(`Enqueuing post job ${jobId}: ${platforms.join(",")} at ${at} (delay=${delaySec}s)`);

  const job = await queue.add("post-video", {
    videoId,
    platforms,
    scheduledAt: scheduledPostTime?.toISOString(),
  }, { jobId, delay });

  return job.id ?? jobId;
}
