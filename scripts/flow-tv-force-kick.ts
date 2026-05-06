// Force-clear stale advance jobs and re-enqueue. The flow-tv-run worker
// uses lockDuration=30m + maxStalledCount=0, so when the worker dies
// mid-stage BullMQ refuses to recover the job for 30 minutes. This script
// drains the queue directly via low-level commands to break the lock.

import "dotenv/config";
import IORedis from "ioredis";
import { getFlowTvRunQueue } from "../src/services/queue";

async function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-force-kick.ts <runId>");
    process.exit(2);
  }

  const queue = getFlowTvRunQueue();
  const jobId = `advance-${runId}`;
  const queueName = queue.name;
  const prefix = queue.opts.prefix ?? "bull";

  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState().catch(() => "unknown");
    console.log(`Existing advance job state=${state}`);
    if (state !== "completed" && state !== "failed") {
      // Free the job lock manually via raw redis. The lock key is at
      // `<prefix>:<queueName>:<jobId>:lock` per BullMQ source.
      const r = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        maxRetriesPerRequest: null,
      });
      const lockKey = `${prefix}:${queueName}:${jobId}:lock`;
      const removed = await r.del(lockKey);
      console.log(`Lock key=${lockKey} deleted=${removed}`);
      // Also pop it out of the active list so workers can re-enter waiting.
      const activeKey = `${prefix}:${queueName}:active`;
      await r.lrem(activeKey, 0, jobId);
      console.log(`Removed ${jobId} from ${activeKey}`);
      await r.quit();
    }
    try {
      await existing.remove();
      console.log(`Removed job ${jobId}`);
    } catch (e) {
      console.warn(`remove() still failed: ${(e as Error).message}`);
      // Force-delete the job hash directly.
      const r2 = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        maxRetriesPerRequest: null,
      });
      const jobKey = `${prefix}:${queueName}:${jobId}`;
      await r2.del(jobKey);
      // Remove from any sorted sets
      for (const list of ["active", "waiting", "delayed", "completed", "failed", "wait", "paused"]) {
        await r2.lrem(`${prefix}:${queueName}:${list}`, 0, jobId).catch(() => {});
        await r2.zrem(`${prefix}:${queueName}:${list}`, jobId).catch(() => {});
      }
      await r2.quit();
      console.log(`Force-deleted job hash ${jobKey}`);
    }
  } else {
    console.log("No existing advance job found.");
  }

  const job = await queue.add("advance", { kind: "advance", runId }, { jobId });
  console.log(`Re-enqueued: ${job.id ?? jobId}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
