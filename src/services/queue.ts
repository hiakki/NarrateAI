import { Queue } from "bullmq";

export interface VideoJobData {
  videoId: string;
  seriesId: string;
  title: string;
  scriptText: string;
  scenes: { text: string; visualDescription: string }[];
  artStyle: string;
  artStylePrompt: string;
  voiceId: string;
  duration: number;
}

export const videoGenerationQueue = new Queue<VideoJobData>("video-generation", {
  connection: {
    host: process.env.REDIS_URL?.includes("://")
      ? new URL(process.env.REDIS_URL).hostname
      : "localhost",
    port: process.env.REDIS_URL?.includes("://")
      ? parseInt(new URL(process.env.REDIS_URL).port || "6379")
      : 6379,
    maxRetriesPerRequest: null,
  },
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export async function enqueueVideoGeneration(data: VideoJobData): Promise<string> {
  const job = await videoGenerationQueue.add("generate", data, {
    jobId: data.videoId,
  });
  return job.id ?? data.videoId;
}
