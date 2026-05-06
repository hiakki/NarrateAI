// Probe Flow TV's "Archive" view structure: how to navigate to it, what tiles
// look like inside, and what the right-click "Unarchive/Restore" menu item is
// called. We click "View Archive" via the sidebar (text contains "Archive")
// and snapshot.

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

const FIND_VIEW_ARCHIVE_BTN_SRC = `
() => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 14) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var btns = Array.prototype.slice.call(document.querySelectorAll("button, [role='button'], a"));
  var out = [];
  for (var i = 0; i < btns.length; i++) {
    var el = btns[i];
    if (!visible(el)) continue;
    var t = ((el.innerText || el.textContent || '') + '').trim();
    if (!t) continue;
    if (t.toLowerCase().indexOf('archive') === -1) continue;
    var r = el.getBoundingClientRect();
    out.push({ text: t.slice(0, 60), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), aria: el.getAttribute('aria-label') });
  }
  return out;
}
`;

async function main() {
  const outDir = path.join(FLOW_DATA_DIR, "inspect", "archive-view");
  await fs.mkdir(outDir, { recursive: true });
  const project = await loadProjectCache();
  if (!project) throw new Error("No project cache.");

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    if (!isHeadless()) await focusChromeOnMac().catch(() => {});
    await page.setViewport({ width: 1280, height: 1400 });
    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    if (!(await isLoggedInToFlow(page))) await waitForLogin(page);
    await new Promise((r) => setTimeout(r, 2_000));
    await showAllMediaPanel(page);
    await new Promise((r) => setTimeout(r, 2_000));

    await page.screenshot({ path: path.join(outDir, "01-all-media.png") as `${string}.png` });

    // Find ALL buttons with "archive" in text.
    const btns = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${FIND_VIEW_ARCHIVE_BTN_SRC})`)() as any,
    )) as Array<{ text: string; x: number; y: number; aria: string | null }>;
    console.log(`Buttons with "archive": ${btns.length}`);
    for (const b of btns) console.log(`  text="${b.text}" @(${b.x},${b.y}) aria="${b.aria}"`);

    // Pick the one most likely to be the sidebar "View Archive" — the
    // bottom-leftmost (sidebar is on the left, sits at x ≈ 10-50 typically).
    let target = btns.find((b) => b.x < 100 && b.text.toLowerCase().indexOf('view') === -1) ||
                 btns.find((b) => b.text.toLowerCase().indexOf('view') !== -1) ||
                 btns[0];
    if (!target) {
      console.log("No archive button found.");
      return;
    }
    console.log(`\nClicking archive nav button: text="${target.text}" @(${target.x},${target.y})`);
    await page.mouse.click(target.x, target.y);
    await new Promise((r) => setTimeout(r, 2_500));
    await page.screenshot({ path: path.join(outDir, "02-archive-view.png") as `${string}.png` });

    // Snapshot tiles inside archive view.
    const tiles = await waitForTiles(page, 0, 8_000);
    console.log(`\nTiles in archive: ${tiles.length}`);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      console.log(
        `  [${i.toString().padStart(2, "0")}] ${t.rect.w}x${t.rect.h}@(${t.rect.x},${t.rect.y}) isVideo=${t.isVideo}`,
      );
    }

    if (tiles.length > 0) {
      // Right-click first archive tile to see the menu items.
      const t = tiles[0];
      const cx = t.rect.x + t.rect.w / 2;
      const cy = t.rect.y + t.rect.h / 2;
      await page.mouse.move(cx, cy);
      await new Promise((r) => setTimeout(r, 250));
      await page.mouse.click(cx, cy, { button: "right" });
      await new Promise((r) => setTimeout(r, 1200));
      await page.screenshot({ path: path.join(outDir, "03-archive-rightclick.png") as `${string}.png` });

      // Dump menu items.
      const MENU_ITEMS_SRC = `
        () => {
          function visible(el) {
            var r = el.getBoundingClientRect();
            if (r.width < 30 || r.height < 14) return false;
            var cs = window.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
            return true;
          }
          var sels = ["[role='menuitem']", "[role='menu'] *"];
          var seen = [];
          var out = [];
          for (var s = 0; s < sels.length; s++) {
            var els = Array.prototype.slice.call(document.querySelectorAll(sels[s]));
            for (var i = 0; i < els.length; i++) {
              var el = els[i];
              if (seen.indexOf(el) !== -1) continue;
              seen.push(el);
              if (!visible(el)) continue;
              var t = ((el.innerText || el.textContent || '') + '').trim();
              if (!t || t.length > 80) continue;
              var r = el.getBoundingClientRect();
              out.push({ text: t.slice(0, 80), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
            }
          }
          return out;
        }
      `;
      const items = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Function(`return (${MENU_ITEMS_SRC})`)() as any,
      )) as Array<{ text: string; x: number; y: number }>;
      console.log(`\nMenu items in archive right-click:`);
      for (const m of items) console.log(`  text="${m.text}" @(${m.x},${m.y})`);

      await page.keyboard.press("Escape").catch(() => {});
    }

    console.log("\n Done. Screenshots saved.");
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
