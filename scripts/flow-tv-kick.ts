// Re-enqueue an advance for a Flow TV run. Useful when the worker died
// mid-stage and the run is sitting at an in-flight stage with no job in
// the queue.

import "dotenv/config";
import { enqueueFlowTvAdvance } from "../src/services/queue";

async function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-kick.ts <runId>");
    process.exit(2);
  }
  await enqueueFlowTvAdvance(runId);
  console.log(`Enqueued advance for ${runId}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
