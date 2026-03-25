import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { probeAllNicheTrends } from "../src/services/clip-repurpose/trending-probe";

const db = new PrismaClient();

async function main() {
  console.log("=== Scorecard Dry Run ===");
  console.log("Probing all niches via YouTube search...\n");

  await probeAllNicheTrends(db);

  const rows = await db.nicheTrending.findMany({
    orderBy: [{ niche: "asc" }, { date: "desc" }],
  });

  console.log(`\n=== Results: ${rows.length} rows in NicheTrending ===\n`);

  for (const row of rows) {
    const stats = row.stats as Record<string, unknown>;
    const top20 = stats.top20 as Record<string, number> | undefined;
    console.log(
      `  ${row.niche.padEnd(16)} | date=${row.date.toISOString().slice(0, 10)} | candidates=${stats.candidateCount ?? 0} | avgScore=${top20?.avgScore ?? 0} | avgViews=${top20?.avgViews ?? 0}`,
    );
  }

  console.log("\n=== Done. Refresh http://localhost:3000/dashboard/scorecard ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
