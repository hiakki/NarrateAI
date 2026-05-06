// Open the project and dump every tile's current caption text to verify a
// rename persisted. Also takes a screenshot for visual confirmation.

import "dotenv/config";
import path from "path";
import fs from "fs/promises";
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
    await new Promise((r) => setTimeout(r, 3_000));

    const tiles = await waitForTiles(page, 1, 20_000);
    const TEXT_NEAR_SRC = `
      (rect) => {
        function visible(el) {
          var r = el.getBoundingClientRect();
          if (r.width < 30 || r.height < 12) return false;
          var cs = window.getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
          return true;
        }
        var out = [];
        var all = Array.prototype.slice.call(document.querySelectorAll('span, div, p, h1, h2, h3, h4, h5, h6'));
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (!visible(el)) continue;
          var r = el.getBoundingClientRect();
          // Only text inside-or-just-below the tile rect.
          if (r.x < rect.x - 20 || r.x > rect.x + rect.w + 40) continue;
          if (r.y < rect.y - 10 || r.y > rect.y + rect.h + 80) continue;
          var t = ((el.innerText || el.textContent || '') + '').trim();
          if (!t || t.length > 200 || t.length < 3) continue;
          if (/^play_circle$/i.test(t)) continue;
          out.push({ text: t.slice(0, 200), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
        }
        return out;
      }
    `;
    const outDir = path.join(FLOW_DATA_DIR, "inspect", "verify-rename");
    await fs.mkdir(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "01-all-media.png") as `${string}.png` });

    console.log(`tiles=${tiles.length}`);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const labels = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Function(`return (${TEXT_NEAR_SRC})`)() as any,
        t.rect,
      )) as Array<{ text: string; x: number; y: number; w: number; h: number }>;
      // pick the longest non-trivial label
      const best = labels.sort((a, b) => b.text.length - a.text.length)[0];
      console.log(
        `tile[${i}] ${t.rect.w}x${t.rect.h}@(${t.rect.x},${t.rect.y}) isVideo=${t.isVideo} caption="${best?.text ?? "(none)"}"`,
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
