// One-shot: call approveClips() then enqueue an advance so the worker
// runs finalizeFlowRun (creates NarrateAI Video row, schedules to platforms).
//
// Usage:
//   npx tsx scripts/flow-tv-approve-clips.ts <runId>

import "dotenv/config";
import { approveClips } from "@/services/flow-tv-run";
import { enqueueFlowTvAdvance } from "@/services/queue";

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-approve-clips.ts <runId>");
    process.exit(2);
  }
  const run = await approveClips(runId);
  console.log(`approveClips → stage=${run.stage}  message="${run.lastMessage}"`);
  const jobId = await enqueueFlowTvAdvance(runId);
  console.log(`Enqueued advance jobId=${jobId}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[approve] fatal:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
