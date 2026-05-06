import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { createLogger } from "../src/lib/logger";
import type { FlowTvJobData } from "../src/services/queue";
import {
  advanceRun,
  refreshImage,
  refreshClip,
  loadRun,
  saveRun,
} from "../src/services/flow-tv-run";

const log = createLogger("FlowTvRunWorker");

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// concurrency=1 — every Flow TV step (advance OR refresh) launches Chrome via
// puppeteer, which we treat as an exclusive resource. Higher concurrency
// would race for the same Flow project and Veo credits.
const worker = new Worker<FlowTvJobData>(
  "flow-tv-run",
  async (job) => {
    const data = job.data;
    const t0 = Date.now();
    log.log(`[JOB] start ${job.id} kind=${data.kind} runId=${data.runId}`);

    try {
      switch (data.kind) {
        case "advance": {
          const final = await advanceRun(data.runId);
          log.log(
            `[JOB] advance ${data.runId} → stage=${final.stage} (${Math.round(
              (Date.now() - t0) / 1000,
            )}s)`,
          );
          // If the run progressed past a gate to another non-gated stage,
          // advanceRun already chained through to completion / next gate.
          // If we ended on awaiting_*, a future API approval call will
          // re-enqueue an advance.
          break;
        }
        case "refresh-image": {
          await refreshImage({
            runId: data.runId,
            kind: data.assetKind,
            index: data.index,
          });
          log.log(
            `[JOB] refresh-image ${data.runId} ${data.assetKind}-${data.index} done (${Math.round(
              (Date.now() - t0) / 1000,
            )}s)`,
          );
          break;
        }
        case "refresh-clip": {
          await refreshClip({ runId: data.runId, index: data.index });
          log.log(
            `[JOB] refresh-clip ${data.runId} clip-${data.index} done (${Math.round(
              (Date.now() - t0) / 1000,
            )}s)`,
          );
          break;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`[JOB] ${job.id} kind=${data.kind} runId=${data.runId} failed: ${msg}`);
      // Persist the failure on the run state so the UI sees it without
      // having to query BullMQ.
      try {
        const run = await loadRun(data.runId);
        if (run && run.stage !== "done") {
          run.error = msg;
          run.stage = "error";
          run.events.push({
            ts: Date.now(),
            stage: "error",
            level: "error",
            message: `Worker job failed (${data.kind}): ${msg}`,
          });
          run.lastMessage = msg;
          await saveRun(run);
        }
      } catch (saveErr) {
        log.error(
          `[JOB] could not persist failure for run ${data.runId}: ${(saveErr as Error).message}`,
        );
      }
      throw e;
    }
  },
  {
    connection: redis as never,
    concurrency: 1,
    // Flow TV runs are SLOW: Phase 1 ~3 minutes, Phase 2 ~10 minutes for 2
    // clips. Set a generous lock so the worker doesn't lose its job mid-run
    // while puppeteer is waiting on Veo.
    lockDuration: 30 * 60_000,
    lockRenewTime: 5 * 60_000,
    stalledInterval: 5 * 60_000,
    maxStalledCount: 0,
  },
);

worker.on("completed", (job) => log.log(`[JOB] DONE ${job.id}`));
worker.on("failed", (job, err) => {
  const msg = err?.message ?? String(err);
  log.error(`[JOB] FAIL ${job?.id}: ${msg}`);
});

log.log(`Flow TV run worker started (pid=${process.pid})`);
