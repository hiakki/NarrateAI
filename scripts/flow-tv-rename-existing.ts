// Walk the Flow TV project's "All Media" grid and rename every tile that
// corresponds to a canonical asset record in the registry. Flow lists tiles
// newest → oldest, so we sort our registry entries by `createdAt DESC` and
// pair them positionally with the tiles in reading order.
//
// Usage (visible browser):
//   FLOW_TV_HEADLESS=false pnpm tsx scripts/flow-tv-rename-existing.ts
//
// Pass --limit N to cap how many tiles to rename (defaults to "all known
// canonical assets"). Pass --dry-run to print the mapping without renaming.

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
  loadRegistry,
  type AssetRecord,
} from "../src/services/flow-tv-naming";
import {
  showAllMediaPanel,
  waitForTiles,
  renameAssetTile,
  type AssetTile,
} from "../src/services/flow-tv-rename";

interface CliOpts {
  limit?: number;
  dryRun: boolean;
  storySlug?: string;
}

function parseArgs(argv: string[]): CliOpts {
  const out: CliOpts = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--limit" && argv[i + 1]) {
      out.limit = parseInt(argv[++i], 10);
    } else if (a === "--story" && argv[i + 1]) {
      out.storySlug = argv[++i];
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("─".repeat(72));
  console.log(" Flow TV — retro-rename existing assets in project");
  console.log(`  dry-run: ${opts.dryRun}  limit: ${opts.limit ?? "all"}  story: ${opts.storySlug ?? "(latest)"}`);
  console.log("─".repeat(72));

  const project = await loadProjectCache();
  if (!project) throw new Error("No project cache; run Phase 1 first.");
  console.log(` project: ${project.projectName} → ${project.projectUrl}`);

  const reg = await loadRegistry();
  const stories = Object.keys(reg.stories);
  if (stories.length === 0) throw new Error("Registry is empty.");
  const storySlug = opts.storySlug ?? stories[stories.length - 1];
  const records = Object.values(reg.stories[storySlug] ?? {});
  if (records.length === 0) throw new Error(`No registry records for story '${storySlug}'.`);

  // Skip records that don't correspond to in-project tiles:
  //   • "final" is the locally stitched output; never lives in Flow.
  //   • clips imported from a `/shared/video/...` URL are not part of the
  //     authenticated project library (they live in the public share
  //     namespace), so they have no tile to rename.
  const isImportedShareClip = (r: AssetRecord) =>
    r.kind === "video" && !!r.flowUrl && /\/shared\/video\//.test(r.flowUrl);
  const candidates = records
    .filter((r) => r.kind !== "final" && !isImportedShareClip(r))
    .sort((a, b) => b.createdAt - a.createdAt);

  console.log(`\n Registry candidates (newest first), ${candidates.length}:`);
  for (let i = 0; i < candidates.length; i++) {
    const r = candidates[i];
    const created = new Date(r.createdAt).toISOString();
    console.log(`  [${i.toString().padStart(2, "0")}] ${r.kind}/${r.index} → "${r.flowDisplayName}"   (created ${created})`);
  }

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    if (!isHeadless()) await focusChromeOnMac().catch(() => {});

    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    if (!(await isLoggedInToFlow(page))) {
      console.log(" not logged in — waiting for sign in.");
      await waitForLogin(page);
    }

    await new Promise((r) => setTimeout(r, 2_000));
    await showAllMediaPanel(page);
    console.log("\n Loading All Media panel…");
    await new Promise((r) => setTimeout(r, 2_500));

    let tiles: AssetTile[] = await waitForTiles(page, 1, 20_000);
    console.log(` Tiles visible: ${tiles.length}`);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      console.log(
        `   tile[${i.toString().padStart(2, "0")}] ${t.rect.w}x${t.rect.h}@(${t.rect.x},${t.rect.y}) text="${(t.text || "").split("\n").join(" ").slice(0, 80)}"`,
      );
    }

    if (tiles.length === 0) {
      console.log(" no tiles found — exiting.");
      return;
    }

    // Build mapping (positional pairing).
    const limit = opts.limit ?? Math.min(tiles.length, candidates.length);
    const planned = candidates.slice(0, limit);
    console.log(`\n Planned renames (${planned.length}):`);
    for (let i = 0; i < planned.length; i++) {
      console.log(
        `  tile[${i}] (${tiles[i].rect.w}x${tiles[i].rect.h}@(${tiles[i].rect.x},${tiles[i].rect.y}))  →  "${planned[i].flowDisplayName}"`,
      );
    }

    if (opts.dryRun) {
      console.log("\n --dry-run set; no renames applied.");
      return;
    }

    let ok = 0,
      fail = 0;
    for (let i = 0; i < planned.length; i++) {
      const target = tiles[i];
      const record: AssetRecord = planned[i];
      console.log(`\n→ renaming tile[${i}] to "${record.flowDisplayName}"…`);
      const success = await renameAssetTile(page, target.rect, {
        displayName: record.flowDisplayName,
      });
      if (success) {
        ok++;
        console.log(`  ✓ done`);
      } else {
        fail++;
        console.log(`  ✗ failed (best-effort; continuing)`);
      }
      // After each rename, Flow may shift the grid. Re-snapshot to keep
      // positions accurate.
      await new Promise((r) => setTimeout(r, 1_000));
      const fresh = await waitForTiles(page, 1, 6_000);
      if (fresh.length >= tiles.length) tiles = fresh;
    }

    console.log("\n─".repeat(72));
    console.log(` Done — renamed ${ok}/${planned.length} (failures: ${fail})`);
    console.log(" Browser will stay open briefly so you can verify; closing in 8s.");
    await new Promise((r) => setTimeout(r, 8_000));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
