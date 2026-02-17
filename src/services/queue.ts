import { Queue } from "bullmq";
import IORedis from "ioredis";

export interface VideoJobData {
  videoId: string;
  seriesId: string;
  title: string;
  scriptText: string;
  scenes: { text: string; visualDescription: string }[];
  artStyle: string;
  artStylePrompt: string;
  voiceId: string;
  musicPath?: string;
  duration: number;
}

function createRedisConnection() {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const conn = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  conn.on("error", (err) => console.error("[Queue Redis] Error:", err.message));
  return conn;
}

let queueInstance: Queue<VideoJobData> | null = null;

function getQueue(): Queue<VideoJobData> {
  if (!queueInstance) {
    queueInstance = new Queue<VideoJobData>("video-generation", {
      connection: createRedisConnection() as never,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return queueInstance;
}

export async function enqueueVideoGeneration(data: VideoJobData): Promise<string> {
  const queue = getQueue();
  const jobId = `${data.videoId}-${Date.now()}`;
  console.log(`[Queue] Enqueuing job ${jobId}`);
  const job = await queue.add("generate", data, { jobId });
  console.log(`[Queue] Job enqueued: ${job.id}`);
  return job.id ?? jobId;
}
