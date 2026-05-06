// Flow TV — rename asset tiles inside a Flow project.
//
// The UI flow (verified via scripts/flow-tv-inspect-rename-dialog.ts):
//   1. Locate the asset tile.
//   2. Right-click → context menu appears.
//   3. Click the menuitem whose text contains "Rename".
//   4. The tile's caption becomes an inline editable <input aria="Editable
//      text"> at the bottom of the tile, with the current name pre-selected.
//   5. Type the new name and press Enter (or click the ✓ "Done" button).
//
// All page.evaluate calls use stringified-function form (`new Function(...)`)
// to dodge tsx's `__name()` runtime helper which is not present in the page.

import type { Page } from "puppeteer-core";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AssetTile {
  rect: Rect;
  /** url found inside the tile's <img>, when present (for matching to registry). */
  imgSrc: string | null;
  /** current label/caption text under the tile (Flow's auto-name). */
  text: string;
  /** true if the tile contains a <video> element or play affordance. */
  isVideo: boolean;
}

const ALL_TILES_SRC = `
() => {
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    // Was 100x60 — too strict for narrow sidebar tiles. Match the smaller
    // image-tile threshold below so both finders agree.
    if (r.width < 60 || r.height < 60) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  function pickImgSrc(el) {
    // Prefer absolute http(s) src, then srcset, then descendant <picture>'s img.
    var imgs = Array.prototype.slice.call(el.querySelectorAll('img'));
    for (var i = 0; i < imgs.length; i++) {
      var s = imgs[i].getAttribute('src') || '';
      if (/^https?:\\/\\//i.test(s)) return s;
    }
    for (var i = 0; i < imgs.length; i++) {
      var ss = imgs[i].getAttribute('srcset') || '';
      if (/https?:/i.test(ss)) return ss.split(',')[0].split(' ')[0];
    }
    var srcs = Array.prototype.slice.call(el.querySelectorAll('source'));
    for (var i = 0; i < srcs.length; i++) {
      var ss = srcs[i].getAttribute('srcset') || srcs[i].getAttribute('src') || '';
      if (/https?:/i.test(ss)) return ss.split(',')[0].split(' ')[0];
    }
    return null;
  }
  var out = [];
  var all = Array.prototype.slice.call(document.querySelectorAll('*'));
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (!visible(el)) continue;
    var hasImg = !!el.querySelector('img, picture, source[srcset]');
    var hasVideo = !!el.querySelector('video');
    var hasPlay = !!el.querySelector("[aria-label*='lay'], [aria-label*='Play']");
    var thumbBg = false;
    try {
      var bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg.indexOf('url(') !== -1 && bg.indexOf('http') !== -1) thumbBg = true;
    } catch(_) {}
    if (!hasImg && !hasVideo && !hasPlay && !thumbBg) continue;
    var r = rectOf(el);
    if (r.w > 750 || r.h > 750) continue;
    // Was 200x110 — too strict for narrow sidebar tiles. Sidebar tiles in
    // Flow's "All Media" panel are typically 90x100 to 140x160. Allow any
    // visible thumbnail >= 80x80; below that is icons / chips / spinners.
    if (r.w < 80 || r.h < 80) continue;
    out.push({
      rect: r,
      imgSrc: pickImgSrc(el),
      text: ((el.innerText || '') + '').trim().slice(0, 120),
      isVideo: hasVideo || hasPlay,
    });
  }
  // Dedup overlapping tiles by approximate rect (round to 16px buckets) so
  // nested wrappers around the same tile collapse to one record. Keep the
  // largest record per bucket.
  var buckets = {};
  for (var i = 0; i < out.length; i++) {
    var t = out[i];
    var key = (t.rect.x >> 4) + '|' + (t.rect.y >> 4) + '|' + (t.rect.w >> 5) + '|' + (t.rect.h >> 5);
    var prev = buckets[key];
    if (!prev || (t.rect.w * t.rect.h) > (prev.rect.w * prev.rect.h)) {
      buckets[key] = t;
    }
  }
  var uniq = [];
  for (var k in buckets) uniq.push(buckets[k]);
  // Sort by reading order: top-to-bottom, then left-to-right (rows by y bucket).
  uniq.sort(function(a, b) {
    if (Math.abs(a.rect.y - b.rect.y) > 80) return a.rect.y - b.rect.y;
    return a.rect.x - b.rect.x;
  });
  return uniq;
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
        return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
      }
    }
  }
  return null;
}
`;

// Find the per-tile "more options" button (⋮ icon, Material text "more_vert"
// or "more_horiz", or aria-label containing "more"/"options"). The button is
// hover-revealed in Flow's current UI — callers must hover the tile first
// for the action toolbar to render.
//
// Restricted to the supplied tile rect (with a small slack) so we don't pick
// up the project-level "more" button in the top bar.
const FIND_MORE_VERT_BTN_SRC = `
(rect) => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 16 || r.width > 80 || r.height > 80) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var els = Array.prototype.slice.call(
    document.querySelectorAll("button, [role='button'], [aria-label]")
  );
  var best = null;
  var bestDist = 1e9;
  var slack = 12;
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (!visible(el)) continue;
    var r = el.getBoundingClientRect();
    if (r.x < rect.x - slack) continue;
    if (r.y < rect.y - slack) continue;
    if (r.x + r.width > rect.x + rect.w + slack) continue;
    if (r.y + r.height > rect.y + rect.h + slack) continue;
    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
    var txt = ((el.innerText || el.textContent || '') + '').toLowerCase();
    var isMore =
      aria.indexOf('more') !== -1 ||
      aria.indexOf('options') !== -1 ||
      aria.indexOf('menu') !== -1 ||
      txt === 'more_vert' ||
      txt === 'more_horiz' ||
      txt.indexOf('⋮') !== -1;
    if (!isMore) continue;
    var bx = r.x + r.width / 2;
    var by = r.y + r.height / 2;
    // Prefer the button closest to the top-right of the tile (Flow's
    // convention places ⋮ at the top of the per-tile toolbar).
    var d = Math.abs(bx - (rect.x + rect.w - 20)) + Math.abs(by - (rect.y + 20));
    if (d < bestDist) {
      bestDist = d;
      best = { x: Math.round(bx), y: Math.round(by) };
    }
  }
  return best;
}
`;

// Find the inline rename input that appears inside/near the renamed tile.
// We disambiguate from the project-title input (top-left) by:
//   - aria-label "Editable text"
//   - bounding rect intersecting / very close to the target tile
const FIND_RENAME_INPUT_SRC = `
(target) => {
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
  var inputs = Array.prototype.slice.call(document.querySelectorAll("input[aria-label='Editable text']"));
  var best = null;
  var bestDist = 1e9;
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (!visible(el)) continue;
    var r = rectOf(el);
    // Ignore project-title input (anchored top-left, x < 200, y < 60).
    if (r.x < 200 && r.y < 60) continue;
    // Prefer inputs whose rect overlaps or touches the tile (within 80px).
    var cx = target.x + target.w / 2;
    var cy = target.y + target.h / 2;
    var dx = Math.max(0, Math.abs(cx - (r.x + r.w/2)) - target.w/2);
    var dy = Math.max(0, Math.abs(cy - (r.y + r.h/2)) - target.h/2);
    var d = dx + dy;
    if (d < bestDist) { bestDist = d; best = r; }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, w: best.w, h: best.h, dist: bestDist };
}
`;

// Find the "Done" / checkmark button that confirms the rename. It appears next
// to the rename input, and contains the icon "done".
const FIND_DONE_BTN_SRC = `
(target) => {
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
  var btns = Array.prototype.slice.call(document.querySelectorAll("button, [role='button']"));
  var best = null;
  var bestDist = 1e9;
  for (var i = 0; i < btns.length; i++) {
    var el = btns[i];
    if (!visible(el)) continue;
    var t = ((el.innerText || el.textContent || '') + '').trim().toLowerCase();
    // Material icon "done" produces text "done" plus an optional label.
    if (t.indexOf('done') === -1) continue;
    if (t.indexOf('cancel') !== -1) continue;
    var r = rectOf(el);
    var cx = target.x + target.w / 2;
    var cy = target.y + target.h;  // bottom of tile
    var bx = r.x + r.w/2, by = r.y + r.h/2;
    var d = Math.abs(bx - cx) + Math.abs(by - cy);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  if (!best) return null;
  return { x: best.x + best.w/2, y: best.y + best.h/2 };
}
`;

const ALL_MEDIA_BTN_SRC = `
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

/**
 * Click the left-sidebar "All Media" button so every project asset is visible.
 * Safe to call multiple times — it's a no-op if already on that view.
 */
export async function showAllMediaPanel(page: Page): Promise<boolean> {
  const pos = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${ALL_MEDIA_BTN_SRC})`)() as any,
  )) as { x: number; y: number } | null;
  if (!pos) return false;
  await page.mouse.click(pos.x, pos.y);
  await new Promise((r) => setTimeout(r, 1500));
  return true;
}

/**
 * Snapshot every asset tile currently visible in the project's media grid,
 * sorted top-to-bottom, left-to-right (reading order).
 */
export async function listAssetTiles(page: Page): Promise<AssetTile[]> {
  const tiles = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${ALL_TILES_SRC})`)() as any,
  )) as AssetTile[];
  return tiles;
}

/**
 * Wait until at least `minCount` tiles are present (or timeout).
 */
export async function waitForTiles(page: Page, minCount = 1, timeoutMs = 30_000): Promise<AssetTile[]> {
  const start = Date.now();
  let tiles: AssetTile[] = [];
  while (Date.now() - start < timeoutMs) {
    tiles = await listAssetTiles(page);
    if (tiles.length >= minCount) return tiles;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return tiles;
}

interface RenameOptions {
  /** new name to apply in Flow's UI (the human-friendly display name). */
  displayName: string;
  /** soft retry budget; renames are network-driven and occasionally fail. */
  retries?: number;
}

/**
 * Rename a single asset tile, given its bounding rect.
 *
 * Returns true on success, false if the inline editor never appeared / the
 * confirm step couldn't be found. Failures are non-fatal (best-effort).
 */
export async function renameAssetTile(
  page: Page,
  rect: Rect,
  opts: RenameOptions,
): Promise<boolean> {
  const { displayName } = opts;
  const retries = Math.max(1, opts.retries ?? 2);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;

      // STRATEGY A — hover → ⋮ "more" button → "Rename" menu item.
      // This is the canonical path in Flow's CURRENT UI. The right-click
      // context menu no longer exposes a Rename action (it shows
      // "Add to Scene / Favorite / Download / Share" only, per probe).
      let renameMenu: { x: number; y: number } | null = null;
      let openedVia: "more-vert" | "right-click" | null = null;

      // Scroll the tile into view, hover until the toolbar reveals.
      await page.evaluate(
        (r: Rect) => window.scrollTo(0, Math.max(0, r.y - 200)),
        rect,
      );
      await new Promise((r) => setTimeout(r, 300));
      await page.mouse.move(cx, cy);
      await new Promise((r) => setTimeout(r, 600));

      const moreBtn = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Function(`return (${FIND_MORE_VERT_BTN_SRC})`)() as any,
        rect,
      )) as { x: number; y: number } | null;
      if (moreBtn) {
        await page.mouse.click(moreBtn.x, moreBtn.y);
        await new Promise((r) => setTimeout(r, 1000));
        renameMenu = (await page.evaluate(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          new Function(`return (${FIND_RENAME_MENU_SRC})`)() as any,
        )) as { x: number; y: number } | null;
        if (renameMenu) openedVia = "more-vert";
      }

      // STRATEGY B (fallback) — right-click context menu. Kept for older
      // Flow UI versions that still have Rename in the right-click menu.
      if (!renameMenu) {
        await page.keyboard.press("Escape").catch(() => {});
        await new Promise((r) => setTimeout(r, 300));
        await page.mouse.move(cx, cy);
        await new Promise((r) => setTimeout(r, 300));
        await page.mouse.click(cx, cy, { button: "right" });
        await new Promise((r) => setTimeout(r, 1000));
        renameMenu = (await page.evaluate(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          new Function(`return (${FIND_RENAME_MENU_SRC})`)() as any,
        )) as { x: number; y: number } | null;
        if (renameMenu) openedVia = "right-click";
      }

      if (!renameMenu) {
        await page.keyboard.press("Escape").catch(() => {});
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        return false;
      }
      void openedVia; // (kept for future debug)
      await page.mouse.click(renameMenu.x, renameMenu.y);
      await new Promise((r) => setTimeout(r, 800));

      // Locate the inline rename <input> for this tile.
      let input: { x: number; y: number; w: number; h: number; dist: number } | null = null;
      const inputDeadline = Date.now() + 5_000;
      while (Date.now() < inputDeadline) {
        input = (await page.evaluate(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          new Function(`return (${FIND_RENAME_INPUT_SRC})`)() as any,
          rect,
        )) as { x: number; y: number; w: number; h: number; dist: number } | null;
        if (input && input.dist < 200) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!input) {
        await page.keyboard.press("Escape").catch(() => {});
        if (attempt < retries) continue;
        return false;
      }

      // Click into the input, select-all, type new name.
      await page.mouse.click(input.x + 8, input.y + input.h / 2, { clickCount: 3 });
      await new Promise((r) => setTimeout(r, 200));
      // Cross-platform select all.
      await page.keyboard.down("Meta");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Meta");
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(displayName, { delay: 6 });
      await new Promise((r) => setTimeout(r, 250));

      // Try Enter first; if Flow ignores Enter, fall back to clicking ✓ Done.
      await page.keyboard.press("Enter");
      await new Promise((r) => setTimeout(r, 600));

      // Verify the inline editor closed (no rename input near tile anymore).
      const stillEditing = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Function(`return (${FIND_RENAME_INPUT_SRC})`)() as any,
        rect,
      )) as { dist: number } | null;
      if (!stillEditing || stillEditing.dist > 200) {
        return true;
      }

      // Fallback: click ✓ Done.
      const doneBtn = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Function(`return (${FIND_DONE_BTN_SRC})`)() as any,
        rect,
      )) as { x: number; y: number } | null;
      if (doneBtn) {
        await page.mouse.click(doneBtn.x, doneBtn.y);
        await new Promise((r) => setTimeout(r, 800));
        return true;
      }

      // Last resort: Tab + Enter, then Escape to close.
      await page.keyboard.press("Tab").catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      return true;
    } catch {
      await page.keyboard.press("Escape").catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      if (attempt >= retries) return false;
    }
  }
  return false;
}

/**
 * Rename the most-recently-generated asset (top-left tile in All Media view).
 *
 * Useful right after `generateOneImage()` / `generateOneClip()` succeeds: the
 * fresh asset is always at index 0 in reading order.
 */
export async function renameMostRecentAsset(
  page: Page,
  displayName: string,
): Promise<boolean> {
  await showAllMediaPanel(page);
  const tiles = await waitForTiles(page, 1, 12_000);
  if (tiles.length === 0) return false;
  return renameAssetTile(page, tiles[0].rect, { displayName });
}

// ──────────────────────────────────────────────────────────────────────────────
//  Verified rename — strict mode (verify_fail)
// ──────────────────────────────────────────────────────────────────────────────

// Read a tile's *current* visible name by triggering rename and reading back
// the input value, then pressing Escape to cancel without persisting.
const READ_INPUT_VALUE_SRC = `
(target) => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 14) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var inputs = Array.prototype.slice.call(document.querySelectorAll("input[aria-label='Editable text']"));
  var best = null;
  var bestDist = 1e9;
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (!visible(el)) continue;
    var r = el.getBoundingClientRect();
    if (r.x < 200 && r.y < 60) continue; // skip project title input
    var cx = target.x + target.w / 2;
    var cy = target.y + target.h / 2;
    var ix = r.x + r.width/2, iy = r.y + r.height/2;
    var dx = Math.max(0, Math.abs(cx - ix) - target.w/2);
    var dy = Math.max(0, Math.abs(cy - iy) - target.h/2);
    var d = dx + dy;
    if (d < bestDist) { bestDist = d; best = el; }
  }
  if (!best) return null;
  return { value: best.value || '', dist: bestDist };
}
`;

export async function readTileName(
  page: Page,
  rect: Rect,
): Promise<string | null> {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  try {
    await page.evaluate(
      (r: Rect) => window.scrollTo(0, Math.max(0, r.y - 200)),
      rect,
    );
    await new Promise((r) => setTimeout(r, 250));
    await page.mouse.move(cx, cy);
    await new Promise((r) => setTimeout(r, 600));

    // Try the hover → ⋮ → Rename path first (current Flow UI). Fall back
    // to right-click for older UIs.
    let renameMenu: { x: number; y: number } | null = null;
    const moreBtn = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${FIND_MORE_VERT_BTN_SRC})`)() as any,
      rect,
    )) as { x: number; y: number } | null;
    if (moreBtn) {
      await page.mouse.click(moreBtn.x, moreBtn.y);
      await new Promise((r) => setTimeout(r, 800));
      renameMenu = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Function(`return (${FIND_RENAME_MENU_SRC})`)() as any,
      )) as { x: number; y: number } | null;
    }
    if (!renameMenu) {
      await page.keyboard.press("Escape").catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
      await page.mouse.move(cx, cy);
      await new Promise((r) => setTimeout(r, 250));
      await page.mouse.click(cx, cy, { button: "right" });
      await new Promise((r) => setTimeout(r, 700));
      renameMenu = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Function(`return (${FIND_RENAME_MENU_SRC})`)() as any,
      )) as { x: number; y: number } | null;
    }
    if (!renameMenu) {
      await page.keyboard.press("Escape").catch(() => {});
      return null;
    }
    await page.mouse.click(renameMenu.x, renameMenu.y);
    await new Promise((r) => setTimeout(r, 600));
    const got = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${READ_INPUT_VALUE_SRC})`)() as any,
      rect,
    )) as { value: string; dist: number } | null;
    await page.keyboard.press("Escape").catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    if (!got || got.dist > 200) return null;
    return got.value.trim();
  } catch {
    await page.keyboard.press("Escape").catch(() => {});
    return null;
  }
}

/**
 * Rename a tile and verify the change took effect by reading the name back.
 * Throws if the post-rename name doesn't match `displayName` after retries.
 *
 * Used by Phase 1 / Phase 2 in "verify_fail" mode: a generation step that
 * succeeded server-side but couldn't be renamed in Flow's UI gets aborted so
 * the user knows their assets are mislabelled (and so subsequent steps that
 * locate assets by name don't silently break).
 */
export async function renameAndVerify(
  page: Page,
  rect: Rect,
  displayName: string,
  attempts = 2,
): Promise<void> {
  let lastErr = "";
  for (let i = 1; i <= attempts; i++) {
    const ok = await renameAssetTile(page, rect, { displayName });
    if (!ok) {
      lastErr = `rename click failed on attempt ${i}`;
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    // Re-fetch the tile rect (reflow) and read its name back.
    const tiles = await listAssetTiles(page);
    // Find the tile whose rect best matches the original (closest centre).
    let best: AssetTile | null = null;
    let bestDist = Infinity;
    for (const t of tiles) {
      const dx = (t.rect.x + t.rect.w / 2) - (rect.x + rect.w / 2);
      const dy = (t.rect.y + t.rect.h / 2) - (rect.y + rect.h / 2);
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (!best) {
      lastErr = "could not relocate tile after rename";
      continue;
    }
    const readBack = await readTileName(page, best.rect);
    if (readBack === displayName) return;
    lastErr = `verify: expected "${displayName}", got "${readBack ?? "<null>"}"`;
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`renameAndVerify failed for "${displayName}": ${lastErr}`);
}

/**
 * Strict variant of `renameMostRecentAsset` that THROWS when verification
 * fails. Use immediately after a fresh generation step where the new asset is
 * the top-left tile.
 */
export async function renameMostRecentAssetVerified(
  page: Page,
  displayName: string,
  attempts = 2,
): Promise<void> {
  await showAllMediaPanel(page);
  const tiles = await waitForTiles(page, 1, 12_000);
  if (tiles.length === 0) {
    throw new Error(`renameMostRecentAssetVerified: no tiles visible for "${displayName}"`);
  }
  await renameAndVerify(page, tiles[0].rect, displayName, attempts);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Rename by <video> src — target the actual rendered Veo clip
// ──────────────────────────────────────────────────────────────────────────────

interface MediaTileRect {
  rect: Rect;
  src: string;
}

// Find every <video> in the project gallery view, returning each one's <src>
// AND the bounding-rect of its enclosing tile container (the first ancestor
// whose box is at least 200×100px). The tile rect is what we need for
// right-click-rename / hover / click-into-detail-view operations.
const FIND_VIDEO_TILES_SRC = `
() => {
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  var out = [];
  var vids = Array.prototype.slice.call(document.querySelectorAll("video"));
  for (var i = 0; i < vids.length; i++) {
    var v = vids[i];
    var src = v.src || v.currentSrc || "";
    if (!src) continue;
    if (!/^https?:/i.test(src)) continue;
    var anc = v;
    var rect = null;
    // Walk up to find a per-tile container (100..320 wide, 100..360 tall).
    // Without the upper cap we get the parent flex-row containing all
    // sibling tiles — right-clicks at its centre then hit empty space
    // between tiles and Flow shows the canvas context menu (no Rename).
    for (var d = 0; d < 20 && anc; d++) {
      var r = anc.getBoundingClientRect();
      var w = r.width;
      var h = r.height;
      if (w >= 100 && h >= 100 && w <= 320 && h <= 360) {
        rect = rectOf(anc);
        break;
      }
      anc = anc.parentElement;
    }
    if (!rect) continue;
    out.push({ rect: rect, src: src });
  }
  return out;
}
`;

export async function findVideoTilesWithSrc(page: Page): Promise<MediaTileRect[]> {
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_VIDEO_TILES_SRC})`)() as any,
  )) as MediaTileRect[];
}

// Same idea for <img>: enumerate every full-size gallery image (rect >= 200×100)
// and resolve its visible tile container. Excludes <img> elements with
// alt="Video thumbnail" because those are Veo video posters (the same asset
// is also returned by findVideoTilesWithSrc — we don't want it appearing
// twice in inventories).
const FIND_IMAGE_TILES_SRC = `
() => {
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var out = [];
  var imgs = Array.prototype.slice.call(document.querySelectorAll("img"));
  for (var i = 0; i < imgs.length; i++) {
    var im = imgs[i];
    if (!visible(im)) continue;
    var ir = im.getBoundingClientRect();
    // Was: >= 200x100, which discarded ~80x80 sidebar thumbnails. Now allow
    // any image >= 60x60 (skips icons / spinners / 32x32 chips) and rely on
    // the parent-tile lookup below to find the clickable container rect.
    if (ir.width < 60 || ir.height < 60) continue;
    var src = im.src || "";
    if (!/^https?:/i.test(src)) continue;
    var alt = im.getAttribute("alt") || "";
    // Skip Veo video posters and search-preview overlays.
    if (/video thumbnail|search preview/i.test(alt)) continue;
    var anc = im;
    var rect = null;
    // Walk up to find the FIRST ancestor that's big enough to be a tile
    // (>= 100x100) BUT NOT so big that it's a row/grid container (cap
    // width at 320 and height at 360). Without the upper cap we'd return
    // the parent flex-row containing all sibling tiles, which means
    // right-clicking the rect's centre hits empty space between tiles
    // and Flow opens the project canvas's context menu instead of the
    // per-tile rename menu.
    for (var d = 0; d < 20 && anc; d++) {
      var r = anc.getBoundingClientRect();
      var w = r.width;
      var h = r.height;
      if (w >= 100 && h >= 100 && w <= 320 && h <= 360) {
        rect = rectOf(anc);
        break;
      }
      anc = anc.parentElement;
    }
    if (!rect) rect = rectOf(im);
    out.push({ rect: rect, src: src });
  }
  return out;
}
`;

export async function findImageTilesWithSrc(page: Page): Promise<MediaTileRect[]> {
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_IMAGE_TILES_SRC})`)() as any,
  )) as MediaTileRect[];
}

/**
 * Rename the tile whose hidden `<video src>` matches `expectedVideoUrl`. Use
 * this immediately after `waitForNewVideoUrl` returns a fresh clip URL. This
 * is reliable across UI refreshes because it pins the rename to the actual
 * Veo render rather than to "most-recent" position (which can be a stale
 * frame upload thumbnail).
 *
 * Throws if no <video> tile carrying that URL is found within timeoutMs, or
 * if the rename can't be verified.
 */
export async function renameTileByVideoSrcVerified(
  page: Page,
  expectedVideoUrl: string,
  displayName: string,
  attempts = 2,
  timeoutMs = 30_000,
): Promise<void> {
  await showAllMediaPanel(page);
  const start = Date.now();
  let target: MediaTileRect | null = null;
  while (Date.now() - start < timeoutMs) {
    const tiles = await findVideoTilesWithSrc(page);
    target = tiles.find((t) => t.src === expectedVideoUrl) ?? null;
    if (!target) {
      // Loose match: same `name=` query param, in case the URL was
      // re-issued with a different signature/expiry between our snapshot
      // and the rename moment.
      const qm = expectedVideoUrl.match(/[?&]name=([^&]+)/);
      if (qm) {
        const name = qm[1];
        target = tiles.find((t) => t.src.includes(`name=${name}`)) ?? null;
      }
    }
    if (target) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!target) {
    throw new Error(
      `renameTileByVideoSrcVerified: no <video> tile carrying src="${expectedVideoUrl.slice(0, 100)}…" within ${timeoutMs / 1000}s`,
    );
  }
  await renameAndVerify(page, target.rect, displayName, attempts);
}

/**
 * Image analogue of `renameTileByVideoSrcVerified`. Matches the freshly
 * rendered tile by its <img src> — exact-equal first, then by the `name=<id>`
 * query param if the URL was re-signed between our snapshot and the rename.
 *
 * Returns the matched tile rect on success so the caller can re-use it for
 * subsequent operations (e.g. download by src).
 *
 * STRICT: throws if the tile cannot be located within `timeoutMs`. This
 * forces upstream code to either retry the lookup or persist the
 * `expectedImageUrl` as an orphan-tile signal, instead of silently falling
 * back to "rename the most recent tile" (the brittle path that produced
 * "no tiles visible" / wrong-tile renames).
 */
export async function renameTileByImageSrcVerified(
  page: Page,
  expectedImageUrl: string,
  displayName: string,
  attempts = 3,
  timeoutMs = 30_000,
): Promise<MediaTileRect> {
  await showAllMediaPanel(page);
  const start = Date.now();
  let target: MediaTileRect | null = null;
  const expectedName = expectedImageUrl.match(/[?&]name=([^&]+)/)?.[1];
  while (Date.now() - start < timeoutMs) {
    const tiles = await findImageTilesWithSrc(page);
    target = tiles.find((t) => t.src === expectedImageUrl) ?? null;
    if (!target && expectedName) {
      target = tiles.find((t) => t.src.includes(`name=${expectedName}`)) ?? null;
    }
    if (target) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!target) {
    throw new Error(
      `renameTileByImageSrcVerified: no <img> tile carrying src="${expectedImageUrl.slice(0, 100)}…" within ${timeoutMs / 1000}s`,
    );
  }
  await renameAndVerify(page, target.rect, displayName, attempts);
  return target;
}

/**
 * Snapshot every <img> src currently visible in the project gallery. Used as
 * a "before" baseline so a subsequent call to `findNewlyAddedImageTile` can
 * identify the freshly-rendered tile by *set difference* — robust to Flow
 * resolving the trpc redirect URL into a CDN URL between submit and render.
 */
export async function snapshotGalleryImageSrcs(page: Page): Promise<Set<string>> {
  await showAllMediaPanel(page).catch(() => {});
  const tiles = await findImageTilesWithSrc(page).catch(() => [] as MediaTileRect[]);
  return new Set(tiles.map((t) => t.src));
}

/**
 * Diagnostic: enumerate every visible <img> in the page along with its
 * dimensions and source. Logged when our scanners return 0 tiles so we can
 * understand exactly what the DOM looks like in the failing state — vital
 * for catching Flow UI changes that move tiles into shadow DOM, iframes,
 * or under unexpected size thresholds.
 */
export async function debugDumpVisibleImages(page: Page): Promise<Array<{ w: number; h: number; src: string; alt: string; visible: boolean }>> {
  const dumpSrc = `
    () => {
      var out = [];
      var imgs = Array.prototype.slice.call(document.querySelectorAll('img'));
      for (var i = 0; i < imgs.length; i++) {
        var im = imgs[i];
        var r = im.getBoundingClientRect();
        var cs = window.getComputedStyle(im);
        var vis = !(cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0');
        out.push({
          w: Math.round(r.width),
          h: Math.round(r.height),
          src: (im.src || '').slice(0, 140),
          alt: (im.getAttribute('alt') || '').slice(0, 60),
          visible: vis,
        });
      }
      return out;
    }
  `;
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${dumpSrc})`)() as any,
  )) as Array<{ w: number; h: number; src: string; alt: string; visible: boolean }>;
}

/**
 * Find the tile in the project gallery whose <img src> is NOT in `beforeSrcs`.
 * This identifies tiles freshly added since the snapshot — the only reliable
 * way to pin the just-rendered Veo tile when its URL format differs between
 * the trpc redirect URL we captured and the resolved CDN URL the gallery
 * actually renders.
 *
 * Polls up to `timeoutMs`. Returns the FIRST new tile (Flow inserts new
 * tiles at the top of the gallery in reading order), or null on timeout.
 *
 * STRICT: throws on `requireMatch` (callers can opt out for soft probes).
 */
export async function findNewlyAddedImageTile(
  page: Page,
  beforeSrcs: Set<string>,
  opts: { timeoutMs?: number; requireMatch?: boolean } = {},
): Promise<MediaTileRect | null> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const requireMatch = opts.requireMatch ?? false;
  await showAllMediaPanel(page).catch(() => {});
  const start = Date.now();
  let lastCount = -1;
  while (Date.now() - start < timeoutMs) {
    const tiles = await findImageTilesWithSrc(page).catch(() => [] as MediaTileRect[]);
    if (tiles.length !== lastCount) lastCount = tiles.length;
    const fresh = tiles.find((t) => !beforeSrcs.has(t.src));
    if (fresh) return fresh;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (requireMatch) {
    // Dump DOM state so we can see why our scan came up empty.
    let dumpSummary = "(no dump)";
    try {
      const all = await debugDumpVisibleImages(page);
      const visible = all.filter((i) => i.visible);
      const sized = visible.filter((i) => i.w >= 60 && i.h >= 60);
      const buckets = sized.reduce<Record<string, number>>((acc, i) => {
        const k = `${Math.round(i.w / 20) * 20}x${Math.round(i.h / 20) * 20}`;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
      const bucketStr = Object.entries(buckets)
        .map(([k, n]) => `${k}=${n}`)
        .join(",");
      dumpSummary = `total <img>=${all.length} visible=${visible.length} >=60×60=${sized.length} sizes=${bucketStr || "—"}`;
    } catch {
      // best-effort
    }
    throw new Error(
      `findNewlyAddedImageTile: no new <img> tile appeared in the gallery within ${timeoutMs / 1000}s (had ${beforeSrcs.size} before, ${lastCount} now). DOM probe: ${dumpSummary}`,
    );
  }
  return null;
}

/**
 * Like `renameTileByImageSrcVerified` but identifies the new tile by SET
 * DIFFERENCE against a pre-submit gallery snapshot (`beforeSrcs`). Robust to
 * Flow resolving the redirect URL into a CDN URL post-render.
 *
 * Returns the matched tile (so the caller can use the rect for subsequent
 * operations like download-by-src).
 */
export async function renameNewlyAddedImageTileVerified(
  page: Page,
  beforeSrcs: Set<string>,
  displayName: string,
  attempts = 3,
  findTimeoutMs = 60_000,
): Promise<MediaTileRect> {
  const fresh = await findNewlyAddedImageTile(page, beforeSrcs, {
    timeoutMs: findTimeoutMs,
    requireMatch: true,
  });
  if (!fresh) {
    throw new Error(`renameNewlyAddedImageTileVerified: no new tile detected (impossible — set requireMatch)`);
  }
  await renameAndVerify(page, fresh.rect, displayName, attempts);
  return fresh;
}

/**
 * Locate the tile whose displayed name matches `displayName` (case-insensitive
 * exact match after trim). Returns the tile or null if not found.
 *
 * Reads each tile's name via the rename round-trip — slow (~1s per tile) but
 * unambiguous. Use sparingly (refresh-one-asset paths only).
 */
export async function findTileByName(
  page: Page,
  displayName: string,
): Promise<AssetTile | null> {
  await showAllMediaPanel(page);
  await new Promise((r) => setTimeout(r, 700));
  const target = displayName.trim().toLowerCase();
  const tiles = await waitForTiles(page, 1, 8_000);
  for (const t of tiles) {
    const name = await readTileName(page, t.rect);
    if (name && name.trim().toLowerCase() === target) return t;
  }
  return null;
}

/**
 * Archive the tile whose displayed name matches `displayName`. Returns true
 * if the archive click was sent successfully, false if no matching tile was
 * found. Note: Flow's grid reflows asynchronously after archive — caller
 * should call `waitForTiles` again to confirm the count dropped.
 */
export async function archiveTileByName(
  page: Page,
  displayName: string,
): Promise<boolean> {
  const tile = await findTileByName(page, displayName);
  if (!tile) return false;
  return archiveAssetTile(page, tile.rect);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Archive / cleanup
// ──────────────────────────────────────────────────────────────────────────────

const FIND_ARCHIVE_MENU_SRC = `
() => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 14) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  // Restrict to actual menuitems (not the sidebar's "View Archive" button).
  var sels = ["[role='menuitem']", "[role='menu'] [role='menuitem']", "[role='menu'] li", "[role='menu'] div[tabindex='0']"];
  var seen = [];
  function notSeen(el) { for (var i=0;i<seen.length;i++) if (seen[i]===el) return false; seen.push(el); return true; }
  for (var s = 0; s < sels.length; s++) {
    var els = Array.prototype.slice.call(document.querySelectorAll(sels[s]));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!notSeen(el)) continue;
      if (!visible(el)) continue;
      var t = ((el.innerText || el.textContent || '') + '').toLowerCase();
      // Match "archive" but reject "view archive" (sidebar button) and
      // anything containing "archived".
      if (t.indexOf('archive') === -1) continue;
      if (t.indexOf('view archive') !== -1) continue;
      if (t.indexOf('archived') !== -1) continue;
      var r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), text: t.slice(0, 60) };
    }
  }
  return null;
}
`;

/**
 * Archive a single asset tile via right-click → "Archive". No confirmation
 * dialog appears; Flow shows an "Undo / View in Archive" snackbar.
 *
 * Returns true if the menuitem was clicked successfully (the actual reflow
 * is asynchronous, so we don't poll for tile-count change here).
 */
export async function archiveAssetTile(page: Page, rect: Rect): Promise<boolean> {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  try {
    await page.mouse.move(cx, cy);
    await new Promise((r) => setTimeout(r, 250));
    await page.mouse.click(cx, cy, { button: "right" });
    await new Promise((r) => setTimeout(r, 900));

    const arch = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${FIND_ARCHIVE_MENU_SRC})`)() as any,
    )) as { x: number; y: number; text: string } | null;
    if (!arch) {
      await page.keyboard.press("Escape").catch(() => {});
      return false;
    }
    await page.mouse.click(arch.x, arch.y);
    // Give Flow a moment to process and start the grid reflow.
    await new Promise((r) => setTimeout(r, 800));
    return true;
  } catch {
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
}

interface CleanupOptions {
  /** how many tiles to keep, counting from the TOP of the grid. */
  keepTopN: number;
  /** safety cap on archive operations, defaults to 50. */
  maxArchives?: number;
  /** if provided, called for each archived tile (for logging). */
  onArchived?: (rect: Rect, remaining: number) => void;
  /** if provided, predicate that decides whether a tile is allowed to be
   *  archived. Useful to protect specific tiles (e.g. the video clip). */
  shouldArchive?: (tile: AssetTile) => boolean;
}

const SCROLL_BOTTOM_SRC = `
() => {
  // Scroll the document AND every overflow:auto/scroll ancestor to its
  // maximum scrollTop. Flow may use a custom scrollable container — we
  // hit them all to be safe.
  try { window.scrollTo(0, 1e9); } catch {}
  try { if (document.scrollingElement) document.scrollingElement.scrollTop = 1e9; } catch {}
  try { document.documentElement.scrollTop = 1e9; } catch {}
  try { document.body.scrollTop = 1e9; } catch {}
  var els = document.querySelectorAll('*');
  for (var i = 0; i < els.length; i++) {
    try {
      var cs = window.getComputedStyle(els[i]);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && els[i].scrollHeight > els[i].clientHeight) {
        els[i].scrollTop = els[i].scrollHeight;
      }
    } catch {}
  }
  return true;
}
`;

async function scrollGridToBottom(page: Page): Promise<void> {
  await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${SCROLL_BOTTOM_SRC})`)() as any,
  );
}

/**
 * Archive every tile EXCEPT the top `keepTopN` (in reading order = top-to-
 * bottom, left-to-right). After each archive the grid reflows, so we re-
 * snapshot tiles every iteration. We also scroll to the bottom of the grid
 * each iteration so the target tile is always within viewport coordinates
 * (Flow's grid is taller than the viewport with many assets).
 *
 * Returns the count of tiles successfully archived.
 */
export async function archiveKeepTopN(
  page: Page,
  opts: CleanupOptions,
): Promise<number> {
  const { keepTopN, maxArchives = 50, onArchived, shouldArchive } = opts;
  await showAllMediaPanel(page);
  await new Promise((r) => setTimeout(r, 1_000));

  // Get the configured viewport height once so we can verify clicks land
  // inside the visible region.
  const vpH = page.viewport()?.height ?? 1400;

  let archived = 0;
  let stuckLoops = 0;
  while (archived < maxArchives) {
    // Scroll the grid all the way down so the bottom tile is in viewport.
    await scrollGridToBottom(page);
    await new Promise((r) => setTimeout(r, 1_200));

    const tiles = await waitForTiles(page, 1, 8_000);
    if (tiles.length === 0) break;
    if (tiles.length <= keepTopN) break;

    // Pick the LAST tile that's allowed to be archived.
    let target: AssetTile | null = null;
    for (let i = tiles.length - 1; i >= keepTopN; i--) {
      if (!shouldArchive || shouldArchive(tiles[i])) {
        target = tiles[i];
        break;
      }
    }
    if (!target) break;

    // Sanity-check that the target is inside the viewport. If not, advance
    // to the next-shallower archivable tile (or bail).
    if (target.rect.y < 0 || target.rect.y + target.rect.h > vpH) {
      // eslint-disable-next-line no-console
      console.warn(
        `[archive] target rect (${target.rect.x},${target.rect.y}) ${target.rect.w}x${target.rect.h} is outside vpH=${vpH}; skipping`,
      );
      stuckLoops++;
      if (stuckLoops >= 3) break;
      // Scroll to the target and retry next loop.
      await page.evaluate(
        (y: number) => {
          window.scrollTo(0, Math.max(0, y - 100));
        },
        Math.max(0, target.rect.y - 100),
      );
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }

    const ok = await archiveAssetTile(page, target.rect);
    if (!ok) {
      stuckLoops++;
      if (stuckLoops >= 3) break;
      await new Promise((r) => setTimeout(r, 1_500));
      continue;
    }
    archived++;
    stuckLoops = 0;
    onArchived?.(target.rect, Math.max(0, tiles.length - 1));

    // Wait for grid to reflow (tile count drops by 1).
    const reflowDeadline = Date.now() + 6_000;
    while (Date.now() < reflowDeadline) {
      const post = await waitForTiles(page, 0, 1_500);
      if (post.length === tiles.length - 1) break;
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return archived;
}
