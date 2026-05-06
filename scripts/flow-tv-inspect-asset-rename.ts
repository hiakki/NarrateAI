// Flow TV — asset rename UI tour. Opens the cached project, then explores:
//   • the left sidebar (grid / image / video / frames icons)
//   • the right-side icon buttons (panels)
// snapshotting the page after each click, dumping any candidate asset tiles +
// their hover/right-click menus so we can locate the rename affordance.
//
// Usage:  pnpm tsx scripts/flow-tv-inspect-asset-rename.ts
//
// All page.evaluate calls use stringified-function form to dodge tsx's
// `__name()` runtime helper.

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
import type { Page } from "puppeteer-core";

interface Tile {
  tag: string;
  cls: string;
  role: string | null;
  ariaLabel: string | null;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  hasImg: boolean;
  hasVideo: boolean;
}
interface IconButton {
  tag: string;
  text: string;
  ariaLabel: string | null;
  role: string | null;
  rect: { x: number; y: number; w: number; h: number };
}
interface MenuItem {
  text: string;
  aria: string | null;
  role: string | null;
  rect: { x: number; y: number; w: number; h: number };
}

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
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: ((el.getAttribute('class') || '') + '').slice(0, 80),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      text: ((el.innerText || '') + '').trim().slice(0, 80),
      rect: r,
      hasImg: hasImg,
      hasVideo: hasVideo,
    });
  }
  return out.sort(function(a, b) { return b.rect.w * b.rect.h - a.rect.w * a.rect.h; }).slice(0, 16);
}
`;

const ICONS_NEAR_SRC = `
(rect) => {
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 16) return false;
    if (r.width > 80 || r.height > 80) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  function within(r, ref) {
    return r.x + r.w > ref.x - 30 && r.x < ref.x + ref.w + 30 && r.y + r.h > ref.y - 30 && r.y < ref.y + ref.h + 30;
  }
  var out = [];
  var all = Array.prototype.slice.call(document.querySelectorAll("button, [role='button'], div[role='menuitem'], span, i"));
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (!visible(el)) continue;
    var r = rectOf(el);
    if (!within(r, rect)) continue;
    var text = ((el.innerText || el.textContent || '') + '').trim();
    out.push({
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, 40),
      ariaLabel: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      rect: r,
    });
  }
  return out;
}
`;

const MENU_ITEMS_SRC = `
() => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 14) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var sels = ["[role='menuitem']", "[role='menu'] *", ".menu-item", "li[tabindex]", "div[tabindex='0']", "[role='dialog'] button"];
  var seen = [];
  function notSeen(el) { for (var i=0;i<seen.length;i++) if (seen[i]===el) return false; seen.push(el); return true; }
  var out = [];
  for (var s = 0; s < sels.length; s++) {
    var els = Array.prototype.slice.call(document.querySelectorAll(sels[s]));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!notSeen(el)) continue;
      if (!visible(el)) continue;
      var r = el.getBoundingClientRect();
      out.push({
        text: ((el.innerText || el.textContent || '') + '').trim().slice(0, 60),
        aria: el.getAttribute('aria-label'),
        role: el.getAttribute('role'),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    }
  }
  return out;
}
`;

// Sidebar icon buttons on the left edge of viewport.
const LEFT_SIDEBAR_SRC = `
() => {
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 16) return false;
    if (r.width > 60 || r.height > 60) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var out = [];
  var btns = Array.prototype.slice.call(document.querySelectorAll("button, [role='button']"));
  for (var i = 0; i < btns.length; i++) {
    var el = btns[i];
    if (!visible(el)) continue;
    var r = rectOf(el);
    if (r.x > 60) continue; // only left edge
    out.push({
      tag: el.tagName.toLowerCase(),
      text: ((el.innerText || el.textContent || '') + '').trim().slice(0, 40),
      ariaLabel: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      rect: r,
    });
  }
  return out.sort(function(a,b){ return a.rect.y - b.rect.y; });
}
`;

async function snapshotTiles(page: Page): Promise<Tile[]> {
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${TILES_SRC})`)() as any,
  )) as Tile[];
}

async function snapshotMenuItems(page: Page): Promise<MenuItem[]> {
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${MENU_ITEMS_SRC})`)() as any,
  )) as MenuItem[];
}

async function snapshotLeftSidebar(page: Page): Promise<IconButton[]> {
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${LEFT_SIDEBAR_SRC})`)() as any,
  )) as IconButton[];
}

async function snapshotIconsNearTile(page: Page, rect: Tile["rect"]): Promise<IconButton[]> {
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${ICONS_NEAR_SRC})`)() as any,
    rect,
  )) as IconButton[];
}

async function waitForTilesToLoad(page: Page, timeoutMs = 25_000): Promise<Tile[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tiles = await snapshotTiles(page);
    if (tiles.length > 0) return tiles;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return [];
}

async function main() {
  const outDir = path.join(FLOW_DATA_DIR, "inspect", "asset-rename");
  await fs.mkdir(outDir, { recursive: true });
  console.log("─".repeat(72));
  console.log(" Flow TV — asset rename UI tour");
  console.log(`  output: ${outDir}`);
  console.log("─".repeat(72));

  const project = await loadProjectCache();
  if (!project) throw new Error("No project cache; run Phase 1 first.");
  console.log(` project URL: ${project.projectUrl}`);

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    if (!isHeadless()) await focusChromeOnMac().catch(() => {});

    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    if (!(await isLoggedInToFlow(page))) {
      console.log(" not logged in — please sign in.");
      await waitForLogin(page);
    }
    console.log(" project loaded; waiting for tiles to populate…");
    await new Promise((r) => setTimeout(r, 2_000));
    await page.screenshot({ path: path.join(outDir, "01-project-loaded.png") as `${string}.png`, fullPage: false });

    const sidebar = await snapshotLeftSidebar(page);
    console.log(`\n Left sidebar buttons: ${sidebar.length}`);
    for (const b of sidebar) {
      console.log(`   [${b.tag}] @(${b.rect.x},${b.rect.y}) aria="${b.ariaLabel}" text="${b.text}"`);
    }
    await fs.writeFile(path.join(outDir, "02-left-sidebar.json"), JSON.stringify(sidebar, null, 2));

    // Visit each left-sidebar icon, screenshot, dump tiles.
    // Skip "Go Back" / arrow_back which navigates out of the project.
    const SKIP = /^(arrow_back|Go Back)/i;
    for (let i = 0; i < sidebar.length; i++) {
      const btn = sidebar[i];
      const txt = (btn.text || "") + (btn.ariaLabel || "");
      if (SKIP.test(btn.text) || SKIP.test(btn.ariaLabel || "") || /Go Back/i.test(txt)) {
        console.log(`\n→ Skipping sidebar #${i} ("${btn.text.split("\n")[0]}") — would exit project`);
        continue;
      }
      const safeAria = (btn.ariaLabel || btn.text || `idx-${i}`).replace(/[^a-zA-Z0-9-]+/g, "-").slice(0, 30);
      console.log(`\n→ Clicking sidebar #${i} aria="${btn.ariaLabel}" text="${btn.text.split("\n")[0]}" (${btn.rect.x},${btn.rect.y})`);

      // Defensive: if URL drifted away from the project, re-navigate.
      const cur = page.url();
      if (!cur.includes("/project/")) {
        console.log("   (re-navigating to project URL)");
        await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
        await new Promise((r) => setTimeout(r, 1500));
      }
      await page.mouse.click(btn.rect.x + btn.rect.w / 2, btn.rect.y + btn.rect.h / 2);
      await new Promise((r) => setTimeout(r, 2500));
      const shotPath = path.join(outDir, `sidebar-${String(i).padStart(2, "0")}-${safeAria}.png`);
      await page.screenshot({ path: shotPath as `${string}.png`, fullPage: false });

      const tiles = await waitForTilesToLoad(page, 8_000);
      console.log(`   tiles found: ${tiles.length}`);
      await fs.writeFile(
        path.join(outDir, `sidebar-${String(i).padStart(2, "0")}-${safeAria}-tiles.json`),
        JSON.stringify(tiles, null, 2),
      );
      for (const t of tiles.slice(0, 4)) {
        console.log(
          `     [${t.tag}] ${t.rect.w}x${t.rect.h}@(${t.rect.x},${t.rect.y}) text="${t.text.slice(0, 50)}"`,
        );
      }

      // For each sidebar tab that yields tiles, probe interaction.
      if (tiles.length > 0) {
        console.log("   probing tile #0 (hover/right-click/icon-click)…");
        const target = tiles[0];
        const cx = target.rect.x + target.rect.w / 2;
        const cy = target.rect.y + target.rect.h / 2;

        await page.mouse.move(cx, cy);
        await new Promise((r) => setTimeout(r, 800));
        await page.screenshot({
          path: path.join(outDir, `sidebar-${String(i).padStart(2, "0")}-hover.png`) as `${string}.png`,
        });

        const iconButtons = await snapshotIconsNearTile(page, target.rect);
        await fs.writeFile(
          path.join(outDir, `sidebar-${String(i).padStart(2, "0")}-icons-near-tile.json`),
          JSON.stringify(iconButtons, null, 2),
        );
        console.log(`     icon-button candidates near tile: ${iconButtons.length}`);

        await page.mouse.click(cx, cy, { button: "right" });
        await new Promise((r) => setTimeout(r, 1200));
        await page.screenshot({
          path: path.join(outDir, `sidebar-${String(i).padStart(2, "0")}-rightclick.png`) as `${string}.png`,
        });
        const menu1 = await snapshotMenuItems(page);
        await fs.writeFile(
          path.join(outDir, `sidebar-${String(i).padStart(2, "0")}-menu-after-rightclick.json`),
          JSON.stringify(menu1, null, 2),
        );
        console.log(`     menu items after right-click: ${menu1.length}`);
        for (const m of menu1) console.log(`       text="${m.text}" aria="${m.aria}"`);
        await page.keyboard.press("Escape").catch(() => {});
        await new Promise((r) => setTimeout(r, 400));

        // Try a 3-dot icon if present (smallest button at top-right of tile).
        const candIcons = iconButtons
          .filter((b) => b.rect.w <= 40 && b.rect.h <= 40)
          .sort((a, b) => b.rect.x - a.rect.x || a.rect.y - b.rect.y);
        const topRightIcon = candIcons[0];
        if (topRightIcon) {
          console.log(`     clicking small icon @(${topRightIcon.rect.x},${topRightIcon.rect.y}) aria="${topRightIcon.ariaLabel}"`);
          await page.mouse.move(cx, cy);
          await new Promise((r) => setTimeout(r, 400));
          await page.mouse.click(
            topRightIcon.rect.x + topRightIcon.rect.w / 2,
            topRightIcon.rect.y + topRightIcon.rect.h / 2,
          );
          await new Promise((r) => setTimeout(r, 1200));
          await page.screenshot({
            path: path.join(outDir, `sidebar-${String(i).padStart(2, "0")}-icon-clicked.png`) as `${string}.png`,
          });
          const menu2 = await snapshotMenuItems(page);
          await fs.writeFile(
            path.join(outDir, `sidebar-${String(i).padStart(2, "0")}-menu-after-icon.json`),
            JSON.stringify(menu2, null, 2),
          );
          console.log(`     menu items after icon click: ${menu2.length}`);
          for (const m of menu2.slice(0, 25)) console.log(`       text="${m.text}" aria="${m.aria}"`);
          await page.keyboard.press("Escape").catch(() => {});
          await new Promise((r) => setTimeout(r, 400));
        }

        // Try double-click which sometimes opens detail view with rename.
        await page.mouse.click(cx, cy, { clickCount: 2 });
        await new Promise((r) => setTimeout(r, 1500));
        await page.screenshot({
          path: path.join(outDir, `sidebar-${String(i).padStart(2, "0")}-dblclick.png`) as `${string}.png`,
        });
        const menu3 = await snapshotMenuItems(page);
        await fs.writeFile(
          path.join(outDir, `sidebar-${String(i).padStart(2, "0")}-menu-after-dblclick.json`),
          JSON.stringify(menu3, null, 2),
        );
        console.log(`     menu items after double-click: ${menu3.length}`);
        for (const m of menu3.slice(0, 15)) console.log(`       text="${m.text}" aria="${m.aria}"`);
        await page.keyboard.press("Escape").catch(() => {});
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    console.log("\n Inspector finished — review screenshots/json in", outDir);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
