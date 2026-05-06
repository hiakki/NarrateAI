// One-shot: enqueue a Flow TV advance job for a given runId.
//
// Usage:
//   npx tsx scripts/flow-tv-trigger-advance.ts <runId>

import "dotenv/config";
import { enqueueFlowTvAdvance } from "@/services/queue";

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-trigger-advance.ts <runId>");
    process.exit(2);
  }
  const jobId = await enqueueFlowTvAdvance(runId);
  console.log(`Enqueued advance for runId=${runId}, jobId=${jobId}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[trigger] fatal:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
