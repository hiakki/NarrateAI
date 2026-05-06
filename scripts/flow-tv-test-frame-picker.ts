// Dry-run test of the frame-slot picker. ZERO submits, ZERO uploads:
//
//   1. Open the project + wait for gallery to be quiescent.
//   2. Pre-flight scan: read display names of large gallery tiles via
//      right-click → rename input → readback → Escape.
//   3. For each Phase-1 image filename, look up its expected display name
//      in the inventory; resolve its Flow asset id.
//   4. Open the Frames sub-mode + click the Start slot to reveal the
//      picker popover.
//   5. For each known asset id, scan the popover's 40×40 thumbs for a
//      matching `name=<id>` <img src> and report whether it was found.
//   6. Press Escape to close the popover. Never click any thumb.
//
// Usage:
//   FLOW_TV_HEADLESS=false npx tsx scripts/flow-tv-test-frame-picker.ts <runId>

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import fs from "fs/promises";
import path from "path";

import {
  findChrome,
  isHeadless,
  prepPage,
  takeScreenshot,
  loadProjectCache,
  isLoggedInToFlow,
  PROFILE_DIR,
  FLOW_URL,
  clickPanelTabBySuffix,
} from "@/services/flow-tv-phase1";
import {
  findImageTilesWithSrc,
  findVideoTilesWithSrc,
  readTileName,
} from "@/services/flow-tv-rename";
import { loadRun, type FlowRun } from "@/services/flow-tv-run";
import { buildAssetName } from "@/services/flow-tv-naming";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function launch(): Promise<Browser> {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome not found.");
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  return puppeteer.launch({
    executablePath: chromePath,
    headless: isHeadless(),
    userDataDir: PROFILE_DIR,
    defaultViewport: { width: 1366, height: 850 },
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

function extractAssetIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?&]name=([a-f0-9-]+)/i);
  return m ? m[1] : null;
}

async function locateStartSlot(page: Page): Promise<{ x: number; y: number } | null> {
  const PROBE_SRC = `
    () => {
      var all = Array.prototype.slice.call(document.querySelectorAll("button, [role='button'], div, span"));
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var txt = ((el.innerText || "") + "").trim();
        if (!/^start$/i.test(txt)) continue;
        var r = el.getBoundingClientRect();
        if (r.width < 30 || r.height < 30) continue;
        if (r.y < 400) continue;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }
      return null;
    }
  `;
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${PROBE_SRC})`)() as any,
  ).catch(() => null)) as { x: number; y: number } | null;
}

async function findThumbInPopoverByAssetId(
  page: Page,
  assetId: string,
): Promise<{ x: number; y: number } | null> {
  const PICKER_PROBE_SRC = `
    (assetId) => {
      var imgs = Array.prototype.slice.call(document.querySelectorAll("img"));
      for (var i = 0; i < imgs.length; i++) {
        var im = imgs[i];
        var r = im.getBoundingClientRect();
        if (r.width < 30 || r.width > 80) continue;
        if (r.height < 30 || r.height > 80) continue;
        var src = im.src || "";
        if (src.indexOf("name=" + assetId) === -1) continue;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }
      return null;
    }
  `;
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${PICKER_PROBE_SRC})`)() as any,
    assetId,
  ).catch(() => null)) as { x: number; y: number } | null;
}

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-test-frame-picker.ts <runId>");
    process.exit(2);
  }
  const run = (await loadRun(runId)) as FlowRun | null;
  if (!run?.storySlug || !run.storyline) throw new Error(`Run not found / no storySlug: ${runId}`);
  const cached = await loadProjectCache(run.storySlug);
  if (!cached) throw new Error(`No project cache for ${run.storySlug}`);

  const browser = await launch();
  try {
    const page = await prepPage(browser);
    await page.setUserAgent(UA);
    await page.goto(cached.projectUrl, { waitUntil: "networkidle2", timeout: 90_000 });
    if (!(await isLoggedInToFlow(page))) throw new Error(`Not logged in. Open ${FLOW_URL}.`);
    await new Promise((r) => setTimeout(r, 2500));

    const phase2Dir = run.phase2RunDir ?? path.join(run.runDir, "phase2");
    await fs.mkdir(phase2Dir, { recursive: true });
    await takeScreenshot(page, phase2Dir, "test-picker-00-project-opened");

    // ── Step 1: pre-flight scan ────────────────────────────────────────
    console.log("\n=== STEP 1: Pre-flight gallery inventory ===");
    // Force lazy-loaded tiles to materialise.
    for (let i = 0; i < 8; i++) {
      const last = await page.evaluate(() => document.querySelectorAll("img").length);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 700));
      const cur = await page.evaluate(() => document.querySelectorAll("img").length);
      if (cur === last) break;
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 500));

    const imageTiles = await findImageTilesWithSrc(page);
    const videoTiles = await findVideoTilesWithSrc(page);
    console.log(`<img> tiles: ${imageTiles.length}`);
    console.log(`<video> tiles: ${videoTiles.length}`);
    const inventory = new Map<string, { assetId: string; isVideo: boolean }>();
    type RawTile = { rect: { x: number; y: number; w: number; h: number }; src: string; isVideo: boolean };
    const all: RawTile[] = [
      ...imageTiles.map((t) => ({ rect: t.rect, src: t.src, isVideo: false })),
      ...videoTiles.map((t) => ({ rect: t.rect, src: t.src, isVideo: true })),
    ];
    all.sort((a, b) => {
      if (Math.abs(a.rect.y - b.rect.y) > 80) return a.rect.y - b.rect.y;
      return a.rect.x - b.rect.x;
    });
    for (const t of all.slice(0, 16)) {
      const assetId = extractAssetIdFromUrl(t.src);
      if (!assetId) {
        console.log(`  • skip @(${t.rect.x},${t.rect.y}) — no name= in src`);
        continue;
      }
      // Scroll the tile into the viewport before right-click readback.
      await page.evaluate((y: number) => window.scrollTo(0, Math.max(0, y - 200)), t.rect.y);
      await new Promise((r) => setTimeout(r, 300));
      const liveRect = (await page.evaluate(
        (src: string) => {
          const imgs = Array.from(document.querySelectorAll("img"));
          const im = imgs.find((i) => (i as HTMLImageElement).src === src);
          if (!im) return null;
          let anc: Element | null = im;
          for (let d = 0; d < 20 && anc; d++) {
            const r = (anc as HTMLElement).getBoundingClientRect();
            if (r.width > 200 && r.height > 100) {
              return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
            }
            anc = anc.parentElement;
          }
          return null;
        },
        t.src,
      )) as { x: number; y: number; w: number; h: number } | null;
      const useRect = liveRect ?? t.rect;
      let displayName: string | null = null;
      try {
        displayName = await readTileName(page, useRect);
      } catch {
        // ignore
      }
      const label = displayName ? displayName.trim() : `(unnamed id=${assetId.slice(0, 8)})`;
      if (displayName) inventory.set(displayName.trim(), { assetId, isVideo: t.isVideo });
      console.log(`  • ${t.isVideo ? "video" : "image"}  "${label}"  id=${assetId}`);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 300));
    console.log(`Inventory: ${inventory.size} named tile(s)`);

    // ── Step 2: resolve expected asset ids ─────────────────────────────
    console.log("\n=== STEP 2: Resolve expected Phase-1 image asset ids ===");
    const expectedIds: Record<string, string | null> = {};
    for (let idx = 1; idx <= run.storyline.imagePrompts.length; idx++) {
      const ip = run.storyline.imagePrompts[idx - 1];
      const name = buildAssetName({
        storyTitle: run.storyline.title,
        storySlug: run.storySlug,
        kind: "image",
        index: idx,
        sceneSlug: ip.title,
        ext: "png",
      });
      // Try canonical display name first, then upload filename.
      let entry = inventory.get(name.flowDisplayName);
      let matchedKey = name.flowDisplayName;
      if (!entry) {
        entry = inventory.get(name.filename);
        if (entry) matchedKey = name.filename;
      }
      expectedIds[name.flowDisplayName] = entry?.assetId ?? null;
      console.log(
        `  • image-${String(idx).padStart(2, "0")} → ${entry?.assetId ?? "(NOT FOUND)"}${entry ? ` via key="${matchedKey}"` : ""}`,
      );
    }

    // ── Step 3: open Start slot popover ────────────────────────────────
    console.log("\n=== STEP 3: Open Start slot popover ===");
    // Switch to Frames sub-mode (Flow's chip controls). The chip's Frames
    // tab toggle is found by suffix.
    await clickPanelTabBySuffix(page, "Frames").catch(() => false);
    await new Promise((r) => setTimeout(r, 800));
    const slot = await locateStartSlot(page);
    if (!slot) {
      console.log("Start slot not visible — Frames mode may not be active. Skipping picker test.");
      await takeScreenshot(page, phase2Dir, "test-picker-99-no-start-slot");
      return;
    }
    console.log(`Start slot @(${slot.x},${slot.y}) — clicking…`);
    await page.mouse.click(slot.x, slot.y);
    await new Promise((r) => setTimeout(r, 1500));
    await takeScreenshot(page, phase2Dir, "test-picker-01-popover-open");

    // ── Step 4: probe popover for each expected asset id ───────────────
    console.log("\n=== STEP 4: Look up each expected asset id in popover ===");
    for (const [displayName, assetId] of Object.entries(expectedIds)) {
      if (!assetId) {
        console.log(`  ✗ ${displayName} — no assetId from inventory; skipping popover probe`);
        continue;
      }
      const thumb = await findThumbInPopoverByAssetId(page, assetId);
      if (thumb) {
        console.log(`  ✓ ${displayName}  →  popover thumb @(${thumb.x},${thumb.y})`);
      } else {
        console.log(`  ✗ ${displayName}  →  NO thumb with name=${assetId} in popover`);
      }
    }

    // ── Step 5: close popover safely ───────────────────────────────────
    await page.keyboard.press("Escape").catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    await takeScreenshot(page, phase2Dir, "test-picker-02-popover-closed");
    console.log("\nDone — no slot was filled, no upload was performed.");
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("[test-picker] fatal:", e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
