// Probe Flow TV's "Archive" right-click menu behaviour. Right-clicks the
// LAST tile in the grid, clicks "Archive", and screenshots before/after to
// see whether a confirmation modal appears and what its buttons read.
//
// Targets the last tile (likely the oldest, hence safest to potentially
// archive) — but we DON'T confirm any modal that appears; we Escape out.

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
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
import { showAllMediaPanel, waitForTiles } from "../src/services/flow-tv-rename";

async function main() {
  const outDir = path.join(FLOW_DATA_DIR, "inspect", "archive");
  await fs.mkdir(outDir, { recursive: true });
  console.log(" output:", outDir);

  const project = await loadProjectCache();
  if (!project) throw new Error("No project cache.");

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    if (!isHeadless()) await focusChromeOnMac().catch(() => {});
    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    if (!(await isLoggedInToFlow(page))) await waitForLogin(page);
    await new Promise((r) => setTimeout(r, 2_000));
    await showAllMediaPanel(page);
    await new Promise((r) => setTimeout(r, 2_500));

    // Use a taller viewport so most tiles are visible.
    await page.setViewport({ width: 1280, height: 1400 });
    await new Promise((r) => setTimeout(r, 1500));
    const tiles = await waitForTiles(page, 1, 20_000);
    console.log(` tiles: ${tiles.length}`);
    if (tiles.length === 0) return;
    // Pick the LAST tile that's in viewport; if none is offscreen, just take
    // the last entry.
    const vh = 1400;
    const inView = tiles.filter((t) => t.rect.y >= 0 && t.rect.y + t.rect.h <= vh - 50);
    const target = (inView.length > 0 ? inView : tiles)[((inView.length > 0 ? inView : tiles).length - 1)];
    const cx = target.rect.x + target.rect.w / 2;
    const cy = target.rect.y + target.rect.h / 2;
    console.log(` target tile @(${cx},${cy}) ${target.rect.w}x${target.rect.h}`);

    await page.mouse.click(cx, cy, { button: "right" });
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(outDir, "01-rightclick.png") as `${string}.png` });

    const ARCHIVE_FIND_SRC = `
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
            if (t.indexOf('archive') !== -1 && t.indexOf('rchived') === -1 /* skip 'View Archive' label dupes if present */) {
              var r = el.getBoundingClientRect();
              return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), text: t.slice(0, 60) };
            }
          }
        }
        return null;
      }
    `;
    const arch = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${ARCHIVE_FIND_SRC})`)() as any,
    )) as { x: number; y: number; text: string } | null;
    if (!arch) {
      console.log(" no Archive menu item — aborting");
      return;
    }
    console.log(` Archive menu @(${arch.x},${arch.y}) text="${arch.text}"`);

    // Take screenshot showing the menu item we're about to click.
    await page.mouse.move(arch.x, arch.y);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(outDir, "02-pre-archive-click.png") as `${string}.png` });

    await page.mouse.click(arch.x, arch.y);
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(outDir, "03-post-archive-click.png") as `${string}.png` });

    // Look for any modal/dialog with confirm/cancel buttons.
    const SCAN_SRC = `
      () => {
        function rectOf(el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }
        function visible(el) {
          var r = el.getBoundingClientRect();
          if (r.width < 30 || r.height < 14) return false;
          var cs = window.getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
          return true;
        }
        var dialogs = Array.prototype.slice.call(document.querySelectorAll("[role='dialog'], [aria-modal='true'], .modal, dialog"));
        var dlg = [];
        for (var i = 0; i < dialogs.length; i++) {
          var el = dialogs[i];
          if (!visible(el)) continue;
          dlg.push({
            role: el.getAttribute('role'),
            aria: el.getAttribute('aria-label'),
            text: ((el.innerText || '') + '').trim().slice(0, 200),
            rect: rectOf(el),
          });
        }
        var btns = Array.prototype.slice.call(document.querySelectorAll("button, [role='button']"));
        var bb = [];
        for (var i = 0; i < btns.length; i++) {
          var el = btns[i];
          if (!visible(el)) continue;
          var t = ((el.innerText || el.textContent || '') + '').trim();
          if (!t) continue;
          var r = rectOf(el);
          if (r.w > 320 || r.h > 80) continue;
          bb.push({ text: t.slice(0, 40), rect: r, aria: el.getAttribute('aria-label') });
        }
        return { dialogs: dlg, buttons: bb };
      }
    `;
    const scan = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${SCAN_SRC})`)() as any,
    );
    await fs.writeFile(path.join(outDir, "04-scan.json"), JSON.stringify(scan, null, 2));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dialogs = (scan as any).dialogs as Array<{ role: string | null; aria: string | null; text: string }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const btns = (scan as any).buttons as Array<{ text: string; rect: { x: number; y: number; w: number; h: number }; aria: string | null }>;
    console.log(`\n dialogs: ${dialogs.length}`);
    for (const d of dialogs) console.log(`   role=${d.role} text="${d.text.slice(0, 100)}"`);
    console.log(`\n buttons (first 15):`);
    for (const b of btns.slice(0, 15)) console.log(`   text="${b.text}" aria="${b.aria}"`);

    // Re-count tiles to see if the tile was archived directly.
    const after = await waitForTiles(page, 1, 4_000);
    console.log(`\n tiles after click: ${after.length} (was ${tiles.length})`);

    // If a confirm dialog showed up, DON'T click it — escape.
    if (after.length === tiles.length) {
      await page.keyboard.press("Escape").catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      await page.screenshot({ path: path.join(outDir, "05-after-escape.png") as `${string}.png` });
    }
    console.log(" done");
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
