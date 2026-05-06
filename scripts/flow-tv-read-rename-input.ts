// Verify the rename actually persisted by re-opening the rename inline
// editor on each video tile and reading the current value out of the input
// field. The editor shows the CURRENT display name pre-filled, so this is a
// reliable round-trip check.

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
import { showAllMediaPanel, waitForTiles } from "../src/services/flow-tv-rename";
import type { Page } from "puppeteer-core";

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

async function readNameOnTile(page: Page, rect: { x: number; y: number; w: number; h: number }): Promise<string | null> {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  await page.mouse.move(cx, cy);
  await new Promise((r) => setTimeout(r, 300));
  await page.mouse.click(cx, cy, { button: "right" });
  await new Promise((r) => setTimeout(r, 900));
  const ren = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_RENAME_MENU_SRC})`)() as any,
  )) as { x: number; y: number } | null;
  if (!ren) {
    await page.keyboard.press("Escape").catch(() => {});
    return null;
  }
  await page.mouse.click(ren.x, ren.y);
  await new Promise((r) => setTimeout(r, 800));
  const value = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${READ_INPUT_VALUE_SRC})`)() as any,
  )) as string | null;
  // Cancel the editor without saving (Escape).
  await page.keyboard.press("Escape").catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  return value;
}

async function main() {
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
    await new Promise((r) => setTimeout(r, 2_500));

    const tiles = await waitForTiles(page, 1, 20_000);
    console.log(`tiles=${tiles.length}`);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const name = await readNameOnTile(page, t.rect);
      console.log(
        `[${i.toString().padStart(2, "0")}] isVideo=${t.isVideo}  rect=(${t.rect.x},${t.rect.y})  current_name="${name ?? "(read failed)"}"`,
      );
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
