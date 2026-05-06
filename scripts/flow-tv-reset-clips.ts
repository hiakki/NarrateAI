// Reset a Flow TV run from `done` (or any later stage) back to
// `generating_clips`. Used to recover from bad clip downloads where the
// state machine accepted JPEGs as MP4s and finalized the run.
//
// Steps:
//   1. Delete every file in <runDir>/phase2 (clips + final).
//   2. Clear `clipPaths`, `finalVideoPath`, `videoId` on the run state.
//   3. Set stage back to `generating_clips`.
//   4. Delete the NarrateAI Video row (and its assets/clips/posts).
//   5. Append an event marking the reset.

import "dotenv/config";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { loadRun, saveRun } from "../src/services/flow-tv-run";
import { db } from "../src/lib/db";

async function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-reset-clips.ts <runId>");
    process.exit(2);
  }

  const run = await loadRun(runId);
  if (!run) {
    console.error(`No run with id=${runId}`);
    process.exit(1);
  }
  console.log(`Run ${runId} stage=${run.stage} videoId=${run.videoId ?? "(none)"}`);

  // 1. Delete phase2 directory contents.
  const phase2Dir = run.phase2RunDir;
  if (fsSync.existsSync(phase2Dir)) {
    const entries = await fs.readdir(phase2Dir);
    for (const e of entries) {
      const full = path.join(phase2Dir, e);
      const stat = await fs.stat(full);
      if (stat.isFile()) {
        await fs.unlink(full);
        console.log(`  deleted ${full}`);
      }
    }
  }

  // 2. Delete the NarrateAI Video row if present.
  if (run.videoId) {
    try {
      // Cascade-deletes via Prisma relations.
      await db.video.delete({ where: { id: run.videoId } });
      console.log(`  deleted Video ${run.videoId}`);
    } catch (e) {
      console.warn(`  could not delete Video ${run.videoId}: ${(e as Error).message}`);
    }
  }

  // 3. Reset state.
  run.clipPaths = [];
  run.finalVideoPath = undefined;
  run.videoId = undefined;
  run.stage = "generating_clips";
  run.error = undefined;
  run.lastMessage = "Reset by flow-tv-reset-clips";
  run.events.push({
    ts: Date.now(),
    stage: "generating_clips",
    level: "info",
    message: "Reset by operator: clipPaths/finalVideoPath/videoId cleared, retry from clips",
  });

  await saveRun(run);
  console.log(`Run state reset. stage=${run.stage}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
