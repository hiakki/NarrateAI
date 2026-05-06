// One-shot: trigger a retry on an errored Flow TV run, bypassing auth.
//
// Usage:
//   npx tsx scripts/flow-tv-retry.ts <runId>

import "dotenv/config";
import { retryRun } from "@/services/flow-tv-run";

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-retry.ts <runId>");
    process.exit(2);
  }
  const run = await retryRun(runId);
  console.log(
    `Retried run ${runId}: stage=${run.stage} message="${run.lastMessage}"`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[retry] fatal:", e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
