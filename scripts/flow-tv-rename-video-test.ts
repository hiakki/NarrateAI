// Focused test: locate the (unique) video tile in the project and rename it
// to the canonical Flow display name from the registry. Verifies the helper
// end-to-end before wiring into Phase 1/2.
//
// Usage: FLOW_TV_HEADLESS=false pnpm tsx scripts/flow-tv-rename-video-test.ts

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
import { loadRegistry } from "../src/services/flow-tv-naming";
import {
  showAllMediaPanel,
  waitForTiles,
  renameAssetTile,
} from "../src/services/flow-tv-rename";

async function main() {
  const project = await loadProjectCache();
  if (!project) throw new Error("No project cache.");
  const reg = await loadRegistry();
  const stories = Object.keys(reg.stories);
  if (stories.length === 0) throw new Error("Empty registry.");
  const storySlug = stories[stories.length - 1];

  // Find the most-recently-created video record (the only clip in this project).
  const videos = Object.values(reg.stories[storySlug])
    .filter((r) => r.kind === "video")
    .sort((a, b) => b.createdAt - a.createdAt);
  if (videos.length === 0) throw new Error("No video record in registry.");
  // Prefer video-02 (the one actually rendered in this project).
  const target = videos.find((v) => v.index === 2) ?? videos[0];
  console.log(` target rename → "${target.flowDisplayName}"`);

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    if (!isHeadless()) await focusChromeOnMac().catch(() => {});

    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    if (!(await isLoggedInToFlow(page))) await waitForLogin(page);
    await new Promise((r) => setTimeout(r, 2_000));
    await showAllMediaPanel(page);
    await new Promise((r) => setTimeout(r, 2_500));

    const tiles = await waitForTiles(page, 1, 20_000);
    console.log(` tiles found: ${tiles.length}`);
    const videoTile = tiles.find((t) => t.isVideo);
    if (!videoTile) {
      console.log(" no video tile detected — aborting.");
      return;
    }
    console.log(` video tile @(${videoTile.rect.x},${videoTile.rect.y}) ${videoTile.rect.w}x${videoTile.rect.h}`);

    const ok = await renameAssetTile(page, videoTile.rect, {
      displayName: target.flowDisplayName,
    });
    console.log(ok ? " ✓ rename applied" : " ✗ rename FAILED (best-effort)");
    console.log(" leaving browser open 10s for inspection…");
    await new Promise((r) => setTimeout(r, 10_000));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
