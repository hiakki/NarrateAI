// Rename the SECOND video tile in the project (clip-01) to its canonical
// `flowDisplayName`. Run once after cleanup so video-02 is at index 0 and
// the surviving second video sits as the only other isVideo=true tile.

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
  renameAssetTile,
} from "../src/services/flow-tv-rename";
import { loadRegistry } from "../src/services/flow-tv-naming";

const STORY_SLUG = "the-discovered-sketchbook";
const VIDEO_01_KEY =
  "video-01-rainy-underpass-sketch-to-gallery-curator-discovery";

async function main() {
  console.log("─".repeat(72));
  console.log(" Flow TV — rename clip-01 (second video tile)");
  console.log("─".repeat(72));

  const project = await loadProjectCache();
  if (!project) throw new Error("No project cache.");
  console.log(` project: ${project.projectName} → ${project.projectUrl}`);

  const registry = await loadRegistry();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const story = (registry.stories as any)[STORY_SLUG];
  if (!story) throw new Error(`No registry story "${STORY_SLUG}".`);
  const v1 = story[VIDEO_01_KEY];
  if (!v1) throw new Error(`No registry asset "${VIDEO_01_KEY}".`);
  const displayName: string = v1.flowDisplayName;
  console.log(` target display name: "${displayName}"`);

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    if (!isHeadless()) await focusChromeOnMac().catch(() => {});
    await page.setViewport({ width: 1280, height: 1400 });

    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    if (!(await isLoggedInToFlow(page))) await waitForLogin(page);
    await new Promise((r) => setTimeout(r, 2_000));
    await showAllMediaPanel(page);
    await new Promise((r) => setTimeout(r, 2_500));

    const tiles = await waitForTiles(page, 1, 20_000);
    console.log(`\n Tiles visible: ${tiles.length}`);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      console.log(
        `   [${i.toString().padStart(2, "0")}] ${t.rect.w}x${t.rect.h}@(${t.rect.x},${t.rect.y}) isVideo=${t.isVideo} caption="${t.text ? t.text.slice(0, 60) : ""}"`,
      );
    }

    // Find video tiles. The first one is video-02 (already renamed). The
    // second one is clip-01 (the target we want to rename).
    const videos = tiles.filter((t) => t.isVideo);
    if (videos.length < 2) {
      console.error(
        `\n Expected at least 2 video tiles, found ${videos.length}. Aborting.`,
      );
      process.exit(2);
    }
    const target = videos[1];
    console.log(
      `\n Target second-video tile: @(${target.rect.x},${target.rect.y}) ${target.rect.w}x${target.rect.h}`,
    );

    const ok = await renameAssetTile(page, target.rect, { displayName });
    console.log(`\n rename result: ${ok ? "OK" : "FAILED"}`);

    // Verify by re-snapshotting (the tile should now be at index 0 since
    // rename = last-modified).
    await new Promise((r) => setTimeout(r, 2_000));
    const post = await waitForTiles(page, 1, 8_000);
    console.log(`\n Tiles after rename:`);
    for (let i = 0; i < post.length; i++) {
      const t = post[i];
      console.log(
        `   [${i.toString().padStart(2, "0")}] isVideo=${t.isVideo} caption="${t.text ? t.text.slice(0, 80) : ""}"`,
      );
    }
    console.log("\n Browser stays open 10s for visual inspection.");
    await new Promise((r) => setTimeout(r, 10_000));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
