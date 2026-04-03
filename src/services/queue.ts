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
  triggerSource?: string;
  triggerType?: "manual" | "scheduler" | "recovery" | "system";
  triggerLabel?: string;
  triggerReason?: string;
  triggeredAt?: string;
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
  triggerSource?: string;
  triggerType?: "manual" | "scheduler" | "recovery" | "system";
  triggerLabel?: string;
  triggerReason?: string;
  triggeredAt?: string;
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
// Scheduled-post queue — fires immediately; platforms handle go-live timing
// via native scheduling (YT publishAt, FB scheduled_publish_time, IG native).
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

export async function clearPostQueueJobsForVideo(videoId: string): Promise<void> {
  const queue = getPostQueue();
  const jobIds = [`post-${videoId}`, `post-${videoId}-ig`];
  for (const jobId of jobIds) {
    try {
      const existing = await queue.getJob(jobId);
      if (!existing) continue;
      const state = await existing.getState();
      if (["waiting", "delayed", "failed", "completed", "unknown"].includes(state)) {
        await existing.remove();
        log.log(`Removed post queue job ${jobId} (${state})`);
      } else if (state === "active") {
        log.warn(`Post queue job ${jobId} is active; skip remove`);
      }
    } catch (e) {
      log.warn(`Could not clear post queue job ${jobId}:`, e);
    }
  }
}

async function clearExistingJob(queue: Queue<PostVideoJobData>, jobId: string): Promise<boolean> {
  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (["failed", "completed", "unknown", "waiting", "delayed"].includes(state)) {
        await existing.remove();
      } else if (state === "active") {
        log.log(`Post job ${jobId} already active, skipping re-enqueue`);
        return false;
      }
    }
  } catch (e) {
    log.warn(`Could not check/remove existing post job ${jobId}:`, e);
  }
  return true;
}

/**
 * Enqueue post jobs with the correct strategy per platform:
 *
 *   YT / FB  → delay=0, scheduledAt passed to platform API for native scheduling
 *   IG       → delay until scheduledAt, then posts directly (app-level scheduling)
 */
// ---------------------------------------------------------------------------
// Reconcile queue — exact-time check that natively-scheduled posts went live
// ---------------------------------------------------------------------------

export interface ReconcileJobData {
  videoId: string;
  attempt: number;
}

const MAX_RECONCILE_ATTEMPTS = 6;
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

let reconcileQueueInstance: Queue<ReconcileJobData> | null = null;

function getReconcileQueue(): Queue<ReconcileJobData> {
  if (!reconcileQueueInstance) {
    reconcileQueueInstance = new Queue<ReconcileJobData>("reconcile-video", {
      connection: createRedisConnection() as never,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return reconcileQueueInstance;
}

export function getReconcileVideoQueue(): Queue<ReconcileJobData> {
  return getReconcileQueue();
}

export async function clearReconcileQueueJobsForVideo(videoId: string): Promise<void> {
  const queue = getReconcileQueue();
  try {
    const delayed = await queue.getDelayed();
    const waiting = await queue.getWaiting();
    const failed = await queue.getFailed();
    const completed = await queue.getCompleted();
    const all = [...delayed, ...waiting, ...failed, ...completed];
    for (const job of all) {
      const data = job.data as Partial<ReconcileJobData>;
      if (data.videoId !== videoId) continue;
      try {
        await job.remove();
        log.log(`Removed reconcile job ${job.id} for video ${videoId}`);
      } catch (err) {
        log.warn(`Failed removing reconcile job ${job.id} for ${videoId}:`, err);
      }
    }
  } catch (e) {
    log.warn(`Could not clear reconcile queue jobs for ${videoId}:`, e);
  }
}

export async function enqueueReconcileCheck(
  videoId: string,
  reconcileAt: Date,
  attempt: number = 0,
): Promise<string | null> {
  if (attempt >= MAX_RECONCILE_ATTEMPTS) {
    log.log(`Reconcile for ${videoId}: max attempts (${MAX_RECONCILE_ATTEMPTS}) reached, safetyNet will handle`);
    return null;
  }
  const queue = getReconcileQueue();
  const jobId = `reconcile-${videoId}-${attempt}`;

  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (["failed", "completed", "unknown", "waiting", "delayed"].includes(state)) {
        await existing.remove();
      } else if (state === "active") {
        return null;
      }
    }
  } catch {
    // best-effort cleanup
  }

  const delay = Math.max(0, reconcileAt.getTime() - Date.now());
  log.log(`Enqueuing ${jobId}: check in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${MAX_RECONCILE_ATTEMPTS})`);
  const job = await queue.add("reconcile-video", { videoId, attempt }, { jobId, delay });
  return job.id ?? jobId;
}

export { MAX_RECONCILE_ATTEMPTS, RECONCILE_INTERVAL_MS };

export async function enqueueScheduledPost(
  videoId: string,
  scheduledPostTime: Date | null,
  platforms: string[],
): Promise<string> {
  const queue = getPostQueue();

  const nativePlatforms = platforms.filter((p) => p !== "INSTAGRAM");
  const igPlatforms = platforms.filter((p) => p === "INSTAGRAM");

  const ids: string[] = [];

  if (nativePlatforms.length > 0) {
    const jobId = `post-${videoId}`;
    const ok = await clearExistingJob(queue, jobId);
    if (ok) {
      const at = scheduledPostTime?.toISOString() ?? "immediate";
      log.log(`Enqueuing ${jobId}: ${nativePlatforms.join(",")} nativeSchedule=${at}`);
      for (const platform of nativePlatforms) {
        log.log(`Scheduling ${platform} for video=${videoId} at ${at} (native platform scheduler)`);
      }
      const job = await queue.add("post-video", {
        videoId,
        platforms: nativePlatforms,
        scheduledAt: scheduledPostTime?.toISOString(),
      }, { jobId, delay: 0 });
      ids.push(job.id ?? jobId);
    }
  }

  if (igPlatforms.length > 0) {
    const jobId = `post-${videoId}-ig`;
    const ok = await clearExistingJob(queue, jobId);
    if (ok) {
      const delay = scheduledPostTime
        ? Math.max(0, scheduledPostTime.getTime() - Date.now())
        : 0;
      const delaySec = Math.round(delay / 1000);
      const at = scheduledPostTime?.toISOString() ?? "immediate";
      log.log(`Enqueuing ${jobId}: IG appSchedule=${at} (delay=${delaySec}s)`);
      log.log(`Scheduling INSTAGRAM for video=${videoId} at ${at} (app-level delayed post job)`);
      // No scheduledAt → worker posts immediately when the delayed job fires
      const job = await queue.add("post-video", {
        videoId,
        platforms: igPlatforms,
      }, { jobId, delay });
      ids.push(job.id ?? jobId);
    }
  }

  return ids[0] ?? `post-${videoId}`;
}
