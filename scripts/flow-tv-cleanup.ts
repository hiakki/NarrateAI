// Cleanup helper for the Flow TV project: archives extra image tiles, keeping
// only the top N most-recently-modified tiles (default 5 = 1 video + 4 image
// tiles to match the "1 character + 3 scenes + 1 clip" target). The video
// tile is protected via `shouldArchive` so it can never be archived even if
// it falls outside the keep window.
//
// Usage:
//   FLOW_TV_HEADLESS=false pnpm tsx scripts/flow-tv-cleanup.ts          # apply
//   FLOW_TV_HEADLESS=false pnpm tsx scripts/flow-tv-cleanup.ts --dry-run
//   ... --keep 6           # keep top 6 instead of 5
//   ... --max  20          # archive at most 20 tiles
//
// Tiles are sorted by Flow's grid order (top-left → bottom-right), which is
// reverse-chronological by last-modification time. After our wired-up
// renameMostRecentAsset calls, the most-recently-renamed tile sits at the
// top — exactly what we want to preserve.

import "dotenv/config";
import {
  launchBrowser,
  prepPage,
  focusChromeOnMac,
  isLoggedInToFlow,
  waitForLogin,
  loadProjectCache,
  isHeadless,
} from "../src/services/flow-tv-phase1";
import {
  showAllMediaPanel,
  waitForTiles,
  archiveKeepTopN,
} from "../src/services/flow-tv-rename";

interface CliOpts {
  keepTopN: number;
  maxArchives: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const out: CliOpts = { keepTopN: 5, maxArchives: 50, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--keep" && argv[i + 1]) out.keepTopN = parseInt(argv[++i], 10);
    else if (a === "--max" && argv[i + 1]) out.maxArchives = parseInt(argv[++i], 10);
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("─".repeat(72));
  console.log(" Flow TV — project cleanup (archive extra tiles)");
  console.log(`  keep-top: ${opts.keepTopN}    max-archives: ${opts.maxArchives}    dry-run: ${opts.dryRun}`);
  console.log("─".repeat(72));

  const project = await loadProjectCache();
  if (!project) throw new Error("No project cache.");
  console.log(` project: ${project.projectName} → ${project.projectUrl}`);

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    if (!isHeadless()) await focusChromeOnMac().catch(() => {});

    // Use a *very* tall viewport so EVERY tile in the grid renders within
    // clickable page coordinates without needing to scroll between archive
    // operations. With 18+ tiles this needs ~3500px.
    await page.setViewport({ width: 1280, height: 3600 });

    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    if (!(await isLoggedInToFlow(page))) await waitForLogin(page);
    await new Promise((r) => setTimeout(r, 2_000));
    await showAllMediaPanel(page);
    await new Promise((r) => setTimeout(r, 2_500));

    const tiles = await waitForTiles(page, 1, 20_000);
    console.log(`\n Tiles before: ${tiles.length}`);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      console.log(
        `   [${i.toString().padStart(2, "0")}] ${t.rect.w}x${t.rect.h}@(${t.rect.x},${t.rect.y}) isVideo=${t.isVideo}`,
      );
    }

    const toArchive = Math.max(0, tiles.length - opts.keepTopN);
    console.log(`\n Plan: archive bottom ${toArchive} tile(s); keep top ${opts.keepTopN}.`);
    console.log(" Note: video tiles (with play_circle) are PROTECTED and never archived.");

    if (opts.dryRun) {
      console.log("\n --dry-run set; nothing applied.");
      return;
    }
    if (toArchive === 0) {
      console.log("\n Nothing to do — already at or below keep-top.");
      return;
    }

    const archived = await archiveKeepTopN(page, {
      keepTopN: opts.keepTopN,
      maxArchives: opts.maxArchives,
      shouldArchive: (tile) => !tile.isVideo, // protect any video tile
      onArchived: (rect, remaining) =>
        console.log(`  archived tile @(${rect.x},${rect.y})  → remaining ≈ ${remaining}`),
    });
    console.log(`\n Archived ${archived} tile(s).`);

    const after = await waitForTiles(page, 1, 8_000);
    console.log(` Tiles after: ${after.length}`);
    for (let i = 0; i < after.length; i++) {
      const t = after[i];
      console.log(
        `   [${i.toString().padStart(2, "0")}] ${t.rect.w}x${t.rect.h}@(${t.rect.x},${t.rect.y}) isVideo=${t.isVideo}`,
      );
    }
    console.log("\n Browser stays open 8s for inspection.");
    await new Promise((r) => setTimeout(r, 8_000));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
