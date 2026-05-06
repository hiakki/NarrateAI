// Drive a Flow TV run, auto-approving at every approval gate and tailing
// events to stdout so you can watch progress.
//
// IMPORTANT: This script does NOT auto-retry on `error` stage. The earlier
// implementation auto-retried errors blindly — for credit-burning operations
// (Veo render in `generating_clips`), every retry consumed another Veo Lite
// credit even when the original render had already succeeded but our local
// download/validation failed. To prevent that, errors now stop the driver
// and ask the operator to investigate (typically via
// scripts/flow-tv-recover-from-gallery.ts which downloads existing renders
// without re-rendering).
//
// Pass `--auto-retry-cheap` to opt into one retry for stages that don't
// burn Veo credits (storyline / image generation). Veo errors still stop.
//
// Usage:
//   npx tsx scripts/flow-tv-drive-run.ts <runId> [--auto-retry-cheap]

import "dotenv/config";
import {
  loadRun,
  retryRun,
  approveStoryline,
  approveImages,
  approveClips,
} from "../src/services/flow-tv-run";
import { enqueueFlowTvAdvance } from "../src/services/queue";

const POLL_MS = 4_000;
const MAX_WAIT_MIN = 120;

// Stages where errors are CHEAP to retry (no Veo credits at risk).
const CHEAP_RETRY_STAGES = new Set([
  "queued",
  "generating_storyline",
  "awaiting_storyline_approval",
  "generating_images",
  "awaiting_images_approval",
]);
// Stages where errors are EXPENSIVE (Veo credits) — never auto-retry.
const EXPENSIVE_RETRY_STAGES = new Set([
  "generating_clips",
  "stitching",
]);

async function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-drive-run.ts <runId> [--auto-retry-cheap]");
    process.exit(2);
  }
  const allowCheapRetry = process.argv.includes("--auto-retry-cheap");

  const start = Date.now();
  const seenEventCounts = new Map<string, number>();
  let lastStage = "";
  let lastMessage = "";
  let cheapRetriesUsed = 0;
  const CHEAP_RETRY_LIMIT = 1;

  while (Date.now() - start < MAX_WAIT_MIN * 60_000) {
    const run = await loadRun(runId);
    if (!run) {
      console.error(`No run with id=${runId}`);
      process.exit(1);
    }

    const seen = seenEventCounts.get(runId) ?? 0;
    for (let i = seen; i < run.events.length; i++) {
      const e = run.events[i];
      console.log(
        `[${new Date(e.ts).toISOString()}] [${e.level.toUpperCase().padEnd(5)}] ${e.stage}: ${e.message}`,
      );
    }
    seenEventCounts.set(runId, run.events.length);

    if (run.stage !== lastStage || run.lastMessage !== lastMessage) {
      console.log(`--- stage=${run.stage}  message=${run.lastMessage}`);
      lastStage = run.stage;
      lastMessage = run.lastMessage;
    }

    if (run.stage === "done") {
      console.log("Run COMPLETED. videoId=" + (run.videoId ?? "(none)"));
      console.log("finalVideoPath=" + (run.finalVideoPath ?? "(none)"));
      return;
    }

    if (run.stage === "error") {
      // Determine the LAST non-error stage from the event log so we know
      // whether this error was in a cheap or expensive stage.
      let lastNonError = "";
      for (let i = run.events.length - 1; i >= 0; i--) {
        if (run.events[i].stage !== "error") {
          lastNonError = run.events[i].stage;
          break;
        }
      }
      console.log(
        `Run in ERROR. error="${run.error ?? "?"}"  lastNonError=${lastNonError}`,
      );

      if (EXPENSIVE_RETRY_STAGES.has(lastNonError)) {
        console.log(
          "REFUSING to auto-retry — last stage was credit-burning (Veo). Investigate manually.",
        );
        console.log(
          "  → run scripts/flow-tv-recover-from-gallery.ts to download already-rendered Veo clips",
        );
        console.log("  → or POST /api/dashboard/flow-tv/runs/<id>/action {action:'retry'} to retry");
        process.exit(2);
      }

      if (allowCheapRetry && CHEAP_RETRY_STAGES.has(lastNonError) && cheapRetriesUsed < CHEAP_RETRY_LIMIT) {
        cheapRetriesUsed++;
        console.log(`Auto-retrying CHEAP stage (${cheapRetriesUsed}/${CHEAP_RETRY_LIMIT}): ${lastNonError}`);
        try {
          await retryRun(runId);
          await enqueueFlowTvAdvance(runId);
        } catch (e) {
          console.error("Retry failed:", e);
          process.exit(1);
        }
        await sleep(POLL_MS);
        continue;
      }

      console.log("Stopping driver. Pass --auto-retry-cheap to allow one retry for non-credit stages.");
      process.exit(2);
    }

    if (run.stage === "awaiting_storyline_approval") {
      console.log("Auto-approving STORYLINE…");
      await approveStoryline(runId);
      await enqueueFlowTvAdvance(runId);
      await sleep(POLL_MS);
      continue;
    }
    if (run.stage === "awaiting_images_approval") {
      console.log("Auto-approving IMAGES…");
      await approveImages(runId);
      await enqueueFlowTvAdvance(runId);
      await sleep(POLL_MS);
      continue;
    }
    if (run.stage === "awaiting_clips_approval") {
      console.log("Auto-approving CLIPS…");
      await approveClips(runId);
      await enqueueFlowTvAdvance(runId);
      await sleep(POLL_MS);
      continue;
    }

    await sleep(POLL_MS);
  }

  console.error(`Timed out after ${MAX_WAIT_MIN} minutes.`);
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
