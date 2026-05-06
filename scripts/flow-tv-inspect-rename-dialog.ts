// Probe what UI appears after right-click → "Rename" on a Flow TV asset tile.
// Usage: pnpm tsx scripts/flow-tv-inspect-rename-dialog.ts

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

const TILES_SRC = `
() => {
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 100 || r.height < 60) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var out = [];
  var all = Array.prototype.slice.call(document.querySelectorAll('*'));
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (!visible(el)) continue;
    var hasImg = !!el.querySelector("img[src^='http']");
    var hasVideo = !!el.querySelector('video');
    var hasPlay = !!el.querySelector("[aria-label*='lay'], [aria-label*='Play']");
    var thumbBg = false;
    try {
      var bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg.indexOf('url(') !== -1 && bg.indexOf('http') !== -1) thumbBg = true;
    } catch(_) {}
    if (!hasImg && !hasVideo && !hasPlay && !thumbBg) continue;
    var r = rectOf(el);
    if (r.w > 700 || r.h > 700) continue;
    out.push({ rect: r });
  }
  return out.sort(function(a, b) { return b.rect.w * b.rect.h - a.rect.w * a.rect.h; }).slice(0, 1);
}
`;

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
        return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), text: t.slice(0, 60) };
      }
    }
  }
  return null;
}
`;

const DIALOG_SCAN_SRC = `
() => {
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 14) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var out = { dialogs: [], inputs: [], buttons: [] };
  var dialogs = Array.prototype.slice.call(document.querySelectorAll("[role='dialog'], [aria-modal='true'], .modal, dialog"));
  for (var i = 0; i < dialogs.length; i++) {
    var el = dialogs[i];
    if (!visible(el)) continue;
    out.dialogs.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      text: ((el.innerText || '') + '').trim().slice(0, 200),
      rect: rectOf(el),
    });
  }
  var inputs = Array.prototype.slice.call(document.querySelectorAll("input, [contenteditable='true'], textarea"));
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (!visible(el)) continue;
    out.inputs.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      ariaLabel: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'),
      value: (el.value !== undefined ? el.value : (el.innerText || '')).slice(0, 80),
      rect: rectOf(el),
    });
  }
  var buttons = Array.prototype.slice.call(document.querySelectorAll("button, [role='button']"));
  for (var i = 0; i < buttons.length; i++) {
    var el = buttons[i];
    if (!visible(el)) continue;
    var r = rectOf(el);
    if (r.w > 320 || r.h > 80) continue;
    var t = ((el.innerText || el.textContent || '') + '').trim();
    if (!t) continue;
    out.buttons.push({
      text: t.slice(0, 40),
      ariaLabel: el.getAttribute('aria-label'),
      rect: r,
    });
  }
  return out;
}
`;

async function main() {
  const outDir = path.join(FLOW_DATA_DIR, "inspect", "rename-dialog");
  await fs.mkdir(outDir, { recursive: true });
  console.log(" Output:", outDir);

  const project = await loadProjectCache();
  if (!project) throw new Error("No project cache");

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    if (!isHeadless()) await focusChromeOnMac().catch(() => {});

    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    if (!(await isLoggedInToFlow(page))) await waitForLogin(page);

    // Click "All Media" sidebar (button #1) so tiles are visible.
    await new Promise((r) => setTimeout(r, 2_000));
    const ALL_MEDIA_SRC = `
      () => {
        var btns = Array.prototype.slice.call(document.querySelectorAll("button, [role='button']"));
        for (var i = 0; i < btns.length; i++) {
          var t = ((btns[i].innerText || btns[i].textContent || '') + '');
          if (t.indexOf('nav_rail_all_media') !== -1 || t.indexOf('All Media') !== -1) {
            var r = btns[i].getBoundingClientRect();
            return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
          }
        }
        return null;
      }
    `;
    const allMediaBtn = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${ALL_MEDIA_SRC})`)() as any,
    )) as { x: number; y: number } | null;
    if (allMediaBtn) {
      await page.mouse.click(allMediaBtn.x, allMediaBtn.y);
      console.log(" clicked All Media");
      await new Promise((r) => setTimeout(r, 3_000));
    }

    // Find first tile.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiles = (await page.evaluate(new Function(`return (${TILES_SRC})`)() as any)) as Array<{ rect: { x: number; y: number; w: number; h: number } }>;
    if (tiles.length === 0) {
      console.log(" no tiles — aborting");
      return;
    }
    const t = tiles[0].rect;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    console.log(` tile rect ${t.w}x${t.h}@(${t.x},${t.y})`);

    // Right-click.
    await page.mouse.click(cx, cy, { button: "right" });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(outDir, "01-rightclick.png") as `${string}.png` });

    // Find Rename menu item.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ren = (await page.evaluate(new Function(`return (${FIND_RENAME_MENU_SRC})`)() as any)) as
      | { x: number; y: number; text: string }
      | null;
    if (!ren) {
      console.log(" no Rename menu item — aborting");
      return;
    }
    console.log(` Rename menu at (${ren.x},${ren.y}) text="${ren.text}"`);
    await page.mouse.click(ren.x, ren.y);
    await new Promise((r) => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(outDir, "02-after-rename-click.png") as `${string}.png` });

    // Scan dialogs/inputs/buttons.
    const scan = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${DIALOG_SCAN_SRC})`)() as any,
    )) as {
      dialogs: Array<{ tag: string; role: string | null; ariaLabel: string | null; text: string; rect: { x: number; y: number; w: number; h: number } }>;
      inputs: Array<{ tag: string; type: string | null; ariaLabel: string | null; placeholder: string | null; value: string; rect: { x: number; y: number; w: number; h: number } }>;
      buttons: Array<{ text: string; ariaLabel: string | null; rect: { x: number; y: number; w: number; h: number } }>;
    };
    console.log(`\n dialogs: ${scan.dialogs.length}`);
    for (const d of scan.dialogs) console.log(`   role=${d.role} aria="${d.ariaLabel}" text="${d.text.slice(0,80)}"`);
    console.log(`\n inputs: ${scan.inputs.length}`);
    for (const i of scan.inputs) {
      console.log(`   [${i.tag}] type=${i.type} aria="${i.ariaLabel}" placeholder="${i.placeholder}" value="${i.value}" @(${i.rect.x},${i.rect.y}) ${i.rect.w}x${i.rect.h}`);
    }
    console.log(`\n buttons (first 20):`);
    for (const b of scan.buttons.slice(0, 20)) {
      console.log(`   text="${b.text}" aria="${b.ariaLabel}" @(${b.rect.x},${b.rect.y})`);
    }
    await fs.writeFile(path.join(outDir, "03-scan.json"), JSON.stringify(scan, null, 2));

    // If we found a single new input that became visible (likely the rename
    // input), try typing into it and screenshot.
    const candidate = scan.inputs.find(
      (i) =>
        i.tag === "input" ||
        i.tag === "textarea" ||
        i.placeholder?.toLowerCase().includes("name") ||
        i.ariaLabel?.toLowerCase().includes("name"),
    );
    if (candidate) {
      console.log(`\n Typing into candidate input @(${candidate.rect.x},${candidate.rect.y})…`);
      await page.mouse.click(candidate.rect.x + 12, candidate.rect.y + candidate.rect.h / 2, { clickCount: 3 });
      await new Promise((r) => setTimeout(r, 200));
      await page.keyboard.type("RENAME-PROBE-TEST", { delay: 8 });
      await new Promise((r) => setTimeout(r, 600));
      await page.screenshot({ path: path.join(outDir, "04-typed.png") as `${string}.png` });

      // DON'T press Enter / Save — we're only probing. Press Escape to dismiss.
      await page.keyboard.press("Escape").catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      await page.screenshot({ path: path.join(outDir, "05-after-escape.png") as `${string}.png` });
    }

    console.log(" done — review screenshots & 03-scan.json");
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
