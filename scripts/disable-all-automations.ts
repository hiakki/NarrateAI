/**
 * Disable all automations in the database (set enabled = false).
 * Uses DATABASE_URL from env (or .env). No new schedules will run until you re-enable.
 *
 * Run: npx tsx scripts/disable-all-automations.ts
 * With explicit DB: DATABASE_URL="postgresql://user:pass@host:5432/db" npx tsx scripts/disable-all-automations.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const result = await db.automation.updateMany({
    where: { enabled: true },
    data: { enabled: false },
  });
  console.log(`Disabled ${result.count} automation(s).`);
  if (result.count === 0) {
    console.log("No automations were enabled (all already paused).");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
