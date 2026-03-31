/**
 * One-time script: remove a stale video job from the queue and delete the video record.
 * Use when a job keeps failing because the video was deleted or never existed.
 *
 * Run: npx tsx scripts/remove-stale-video-job.ts <videoId>
 * Example: npx tsx scripts/remove-stale-video-job.ts cmmdgy15z0001vhmsivi33y44
 */

import "dotenv/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";

const videoId = process.argv[2];
if (!videoId) {
  console.error("Usage: npx tsx scripts/remove-stale-video-job.ts <videoId>");
  process.exit(1);
}

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const db = new PrismaClient();

async function main() {
  console.log(`Cleaning up video/job: ${videoId}`);

  const queue = new Queue("video-generation", {
    connection: redis as never,
  });

  try {
    const job = await queue.getJob(videoId);
    if (job) {
      const state = await job.getState();
      await job.remove();
      console.log(`Removed job ${videoId} from queue (was ${state}).`);
    } else {
      console.log(`No job found in queue for ${videoId}.`);
    }
  } catch (e) {
    console.log("Queue get/remove:", e instanceof Error ? e.message : e);
  }

  try {
    const deleted = await db.video.deleteMany({ where: { id: videoId } });
    if (deleted.count > 0) {
      console.log(`Deleted video record ${videoId} from DB.`);
    } else {
      console.log(`No video record found in DB for ${videoId}.`);
    }
  } catch (e) {
    console.log("DB delete:", e instanceof Error ? e.message : e);
  }

  await queue.close();
  await redis.quit();
  await db.$disconnect();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
