// Recovery script: ensures the project ends with exactly:
//   - 2 video tiles (clip-01, clip-02)  → already renamed canonically
//   - 4 image tiles (character-01, image-01, image-02, image-03)
//
// Steps performed:
//   1. Read every tile's persisted display name (via right-click → Rename →
//      read the input → Escape).
//   2. Archive duplicate image tiles (same name appears more than once).
//   3. For each canonical image (character-01, image-01..03), upload the
//      local file IF it isn't already present in the project. Uploads use
//      the prompt-bar's "+ Add reference" picker which creates a persistent
//      project asset. We never submit any prompt — the staged ingredient is
//      discarded when we navigate away.
//   4. Print the final tile list.

import "dotenv/config";
import path from "path";
import fsSync from "fs";
import {
  launchBrowser,
  prepPage,
  focusChromeOnMac,
  isLoggedInToFlow,
  waitForLogin,
  loadProjectCache,
  isHeadless,
  FLOW_DATA_DIR,
} from "../src/services/flow-tv-phase1";
import {
  showAllMediaPanel,
  waitForTiles,
  archiveAssetTile,
} from "../src/services/flow-tv-rename";
import { loadRegistry } from "../src/services/flow-tv-naming";
import type { Page } from "puppeteer-core";

const STORY_SLUG = "the-discovered-sketchbook";
const REQUIRED_KEYS = [
  "character-01",
  "image-01-rainy-underpass-sketch",
  "image-02-gallery-curator-discovery",
  "image-03-exhibition-crowd-applause",
] as const;

// ── name-reading helpers (round-trip via the rename inline editor) ──
const FIND_RENAME_MENU_SRC = `
() => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 14) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var sels = ["[role='menuitem']", "[role='menu'] *", "li[tabindex]", "div[tabindex='0']"];
  var seen = [];
  function notSeen(el) { for (var i=0;i<seen.length;i++) if (seen[i]===el) return false; seen.push(el); return true; }
  for (var s = 0; s < sels.length; s++) {
    var els = Array.prototype.slice.call(document.querySelectorAll(sels[s]));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!notSeen(el)) continue;
      if (!visible(el)) continue;
      var t = ((el.innerText || el.textContent || '') + '').toLowerCase();
      if (t.indexOf('rename') !== -1) {
        var r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
      }
    }
  }
  return null;
}
`;

const READ_INPUT_VALUE_SRC = `
() => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 100 || r.height < 18) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var inputs = Array.prototype.slice.call(document.querySelectorAll("input[type='text'], input:not([type]), [contenteditable='true']"));
  var best = null;
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (!visible(el)) continue;
    var v = el.value !== undefined ? el.value : (el.textContent || '');
    if (!v || (best && best.length > v.length)) continue;
    best = v;
  }
  return best;
}
`;

interface NamedTile {
  rect: { x: number; y: number; w: number; h: number };
  isVideo: boolean;
  name: string | null;
}

async function readTileName(
  page: Page,
  rect: { x: number; y: number; w: number; h: number },
): Promise<string | null> {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  await page.mouse.move(cx, cy);
  await new Promise((r) => setTimeout(r, 250));
  await page.mouse.click(cx, cy, { button: "right" });
  await new Promise((r) => setTimeout(r, 800));
  const ren = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_RENAME_MENU_SRC})`)() as any,
  )) as { x: number; y: number } | null;
  if (!ren) {
    await page.keyboard.press("Escape").catch(() => {});
    return null;
  }
  await page.mouse.click(ren.x, ren.y);
  await new Promise((r) => setTimeout(r, 700));
  const value = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${READ_INPUT_VALUE_SRC})`)() as any,
  )) as string | null;
  await page.keyboard.press("Escape").catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  return value;
}

// ── upload helper using the top-toolbar "+ Add Media" flow ──────────
// Steps:
//   1. Click "+ Add Media" button (top-right toolbar).
//   2. In the resulting menu, click "Upload image".
//   3. Fulfil the native file chooser with the local path.
const FIND_ADD_MEDIA_BTN_SRC = `
() => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 18 || r.height < 14) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var btns = Array.prototype.slice.call(document.querySelectorAll("button, [role='button']"));
  for (var i = 0; i < btns.length; i++) {
    var el = btns[i];
    if (!visible(el)) continue;
    var t = ((el.innerText || el.textContent || '') + '').trim();
    var aria = el.getAttribute('aria-label') || '';
    var combined = (t + '|' + aria).toLowerCase();
    if (combined.indexOf('add media') === -1) continue;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  }
  return null;
}
`;

const FIND_UPLOAD_MENU_ITEM_SRC = `
() => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 14) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var sels = ["[role='menuitem']", "[role='menu'] *", "li[tabindex]", "div[tabindex='0']"];
  var seen = [];
  function notSeen(el) { for (var i=0;i<seen.length;i++) if (seen[i]===el) return false; seen.push(el); return true; }
  for (var s = 0; s < sels.length; s++) {
    var els = Array.prototype.slice.call(document.querySelectorAll(sels[s]));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!notSeen(el)) continue;
      if (!visible(el)) continue;
      var t = ((el.innerText || el.textContent || '') + '').toLowerCase();
      // 'uploadUpload image' (Material Icons name + label) — match
      // 'upload' but not 'upload media' or other unrelated strings.
      if (t.indexOf('upload image') === -1 && !/^upload\\s*upload$/i.test(t.replace(/\\s+/g,' '))) {
        // Be lenient: any visible item whose text BEGINS with 'upload'
        // and is short enough (<20 chars) qualifies.
        if (!/^upload\\b/i.test(t.trim()) || t.trim().length > 20) continue;
      }
      var r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), text: t.slice(0, 60) };
    }
  }
  return null;
}
`;

async function uploadFileToProject(
  page: Page,
  filePath: string,
): Promise<boolean> {
  const addBtn = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_ADD_MEDIA_BTN_SRC})`)() as any,
  )) as { x: number; y: number } | null;
  if (!addBtn) {
    console.warn("     ✗ Add Media button not found");
    return false;
  }
  await page.mouse.click(addBtn.x, addBtn.y);
  await new Promise((r) => setTimeout(r, 700));

  const item = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_UPLOAD_MENU_ITEM_SRC})`)() as any,
  )) as { x: number; y: number; text: string } | null;
  if (!item) {
    console.warn("     ✗ Upload image menuitem not found");
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }

  // Set up file chooser handler BEFORE the click (the click triggers the
  // native <input type="file"> and Puppeteer must be listening).
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 10_000 }),
    page.mouse.click(item.x, item.y),
  ]);
  await chooser.accept([filePath]);
  return true;
}

async function snapshotNamedTiles(page: Page): Promise<NamedTile[]> {
  await showAllMediaPanel(page);
  await new Promise((r) => setTimeout(r, 1_500));
  const tiles = await waitForTiles(page, 1, 12_000);
  const out: NamedTile[] = [];
  for (const t of tiles) {
    const name = await readTileName(page, t.rect);
    out.push({ rect: t.rect, isVideo: t.isVideo, name });
  }
  return out;
}

async function main() {
  console.log("─".repeat(72));
  console.log(" Flow TV — restore missing project images (with smart dedup)");
  console.log("─".repeat(72));

  const project = await loadProjectCache();
  if (!project) throw new Error("No project cache.");
  console.log(` project: ${project.projectName} → ${project.projectUrl}`);

  const registry = await loadRegistry();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const story = (registry.stories as any)[STORY_SLUG];
  if (!story) throw new Error(`No registry story "${STORY_SLUG}".`);

  // Build list of expected canonical filenames.
  const expectedFilenames: { key: string; filename: string; localPath: string }[] = [];
  for (const k of REQUIRED_KEYS) {
    const rec = story[k];
    if (!rec) {
      console.warn(`! No registry entry for ${k}; skipping`);
      continue;
    }
    expectedFilenames.push({ key: k, filename: rec.filename, localPath: rec.localPath });
  }
  console.log(`\n Expected canonical images: ${expectedFilenames.length}`);
  for (const f of expectedFilenames) console.log(`   - ${f.key} → ${f.filename}`);

  const runDir = path.join(
    FLOW_DATA_DIR,
    "runs",
    new Date().toISOString().replace(/[:.]/g, "-") + "-restore",
  );
  await fsSync.promises.mkdir(runDir, { recursive: true });

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    if (!isHeadless()) await focusChromeOnMac().catch(() => {});

    // === 1. Snapshot starting state and read all names ================
    console.log("\n[1/4] Open project + read every tile's name…");
    await page.setViewport({ width: 1280, height: 1400 });
    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    if (!(await isLoggedInToFlow(page))) await waitForLogin(page);
    await new Promise((r) => setTimeout(r, 2_000));

    let named = await snapshotNamedTiles(page);
    console.log(` Tiles before: ${named.length}`);
    for (let i = 0; i < named.length; i++) {
      const t = named[i];
      console.log(
        `   [${i.toString().padStart(2, "0")}] isVideo=${t.isVideo} rect=(${t.rect.x},${t.rect.y}) name="${t.name ?? "(?)"}"`,
      );
    }

    // === 2. Archive duplicate IMAGE tiles by name =====================
    console.log("\n[2/4] Archive duplicate image tiles…");
    const imageByName = new Map<string, NamedTile[]>();
    for (const t of named) {
      if (t.isVideo) continue;
      const key = (t.name ?? "").trim() || `__unknown_${t.rect.y}_${t.rect.x}`;
      const arr = imageByName.get(key) ?? [];
      arr.push(t);
      imageByName.set(key, arr);
    }
    const toArchive: NamedTile[] = [];
    for (const [name, tiles] of imageByName.entries()) {
      if (tiles.length > 1) {
        // Keep the FIRST one in grid order (which is the most recently
        // modified), archive the rest.
        const dupes = tiles.slice(1);
        console.log(`   "${name}" has ${tiles.length} copies → archiving ${dupes.length}`);
        toArchive.push(...dupes);
      }
    }
    if (toArchive.length === 0) {
      console.log(`   no duplicates found`);
    } else {
      // Sort by descending y so we archive bottom-up (avoids reflow shifting
      // tile positions we still need to click).
      toArchive.sort((a, b) => b.rect.y - a.rect.y || b.rect.x - a.rect.x);
      for (const t of toArchive) {
        const ok = await archiveAssetTile(page, t.rect);
        console.log(
          `   archive @(${t.rect.x},${t.rect.y}) name="${t.name ?? "?"}": ${ok ? "OK" : "FAIL"}`,
        );
        // Wait for reflow.
        await new Promise((r) => setTimeout(r, 2_500));
      }
    }

    // Re-snapshot after dedup.
    named = await snapshotNamedTiles(page);
    console.log(` Tiles after dedup: ${named.length}`);

    // === 3. Determine which canonical images are still missing ========
    const presentNames = new Set(named.filter((t) => !t.isVideo).map((t) => (t.name ?? "").trim()));
    const missing: { key: string; filename: string; localPath: string }[] = [];
    for (const exp of expectedFilenames) {
      if (presentNames.has(exp.filename)) continue;
      // Also accept Flow-display-name match if user already renamed to
      // canonical display: "The Discovered Sketchbook — Image 01 — ..."
      // (the rename helper sets that as the displayName).
      const story = (registry.stories as Record<string, Record<string, { flowDisplayName?: string }>>)[STORY_SLUG];
      const flowDisplay = story?.[exp.key]?.flowDisplayName;
      if (flowDisplay && presentNames.has(flowDisplay.trim())) continue;
      missing.push(exp);
    }
    console.log(`\n[3/4] Missing canonical images: ${missing.length}`);
    for (const m of missing) console.log(`   - ${m.key} (${m.filename})`);

    // === 4. Upload missing files via the top-toolbar "+ Add Media" flow ===
    if (missing.length > 0) {
      console.log(`\n[4/4] Uploading ${missing.length} missing image(s) via Add Media…`);
      for (const f of missing) {
        if (!fsSync.existsSync(f.localPath)) {
          console.warn(`   ✗ local file missing for ${f.key}: ${f.localPath}`);
          continue;
        }
        console.log(`\n   uploading ${f.key} (${path.basename(f.localPath)})`);
        const ok = await uploadFileToProject(page, f.localPath);
        if (!ok) continue;

        // Wait for the upload to register as a NEW tile in the grid (the
        // tile count must increase by 1 OR a tile with our filename must
        // appear). 6s is often not enough for the network round-trip.
        const expectedName = path.basename(f.localPath);
        const deadline = Date.now() + 30_000;
        let confirmed = false;
        while (Date.now() < deadline) {
          const grid = await waitForTiles(page, 1, 2_000);
          // Quick check: any tile near the top with rect.y < 200 whose
          // name matches expectedName?
          for (const t of grid.slice(0, 4)) {
            if (t.rect.y > 250) continue;
            const name = await readTileName(page, t.rect);
            if (name && name.includes(expectedName)) {
              confirmed = true;
              break;
            }
          }
          if (confirmed) break;
          await new Promise((r) => setTimeout(r, 2_000));
        }
        if (confirmed) console.log(`     ✓ confirmed in grid`);
        else console.warn(`     ! upload accepted but tile not seen in 30s; continuing anyway`);
      }
    } else {
      console.log("\n[4/4] No missing files; skipping uploads.");
    }

    // === 5. Final verification ========================================
    console.log("\n[verify] Final state");
    await page.setViewport({ width: 1280, height: 1400 });
    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 2_500));
    const final = await snapshotNamedTiles(page);
    console.log(` Tiles final: ${final.length}`);
    for (let i = 0; i < final.length; i++) {
      const t = final[i];
      console.log(
        `   [${i.toString().padStart(2, "0")}] isVideo=${t.isVideo} name="${t.name ?? "?"}"`,
      );
    }
    console.log("\n Browser stays open 10s for inspection.");
    await new Promise((r) => setTimeout(r, 10_000));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
