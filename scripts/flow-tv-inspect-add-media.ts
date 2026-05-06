// Probe the top toolbar "+ Add Media" button. Clicking it should open a
// native file chooser OR a menu with upload options.

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

const FIND_ADD_MEDIA_SRC = `
() => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 18 || r.height < 14) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  var btns = Array.prototype.slice.call(document.querySelectorAll("button, [role='button']"));
  var out = [];
  for (var i = 0; i < btns.length; i++) {
    var el = btns[i];
    if (!visible(el)) continue;
    var t = ((el.innerText || el.textContent || '') + '').trim();
    var aria = el.getAttribute('aria-label') || '';
    var combined = (t + '|' + aria).toLowerCase();
    if (combined.indexOf('add media') === -1 && combined.indexOf('add\\nmedia') === -1) continue;
    var r = el.getBoundingClientRect();
    out.push({ text: t.slice(0, 60), aria: aria.slice(0, 60), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return out;
}
`;

async function main() {
  const outDir = path.join(FLOW_DATA_DIR, "inspect", "add-media");
  await fs.mkdir(outDir, { recursive: true });

  const project = await loadProjectCache();
  if (!project) throw new Error("No project cache.");

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    if (!isHeadless()) await focusChromeOnMac().catch(() => {});
    await page.setViewport({ width: 1280, height: 1000 });

    await page.goto(project.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    if (!(await isLoggedInToFlow(page))) await waitForLogin(page);
    await new Promise((r) => setTimeout(r, 2_500));
    await page.screenshot({ path: path.join(outDir, "00-project.png") as `${string}.png` });

    const found = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${FIND_ADD_MEDIA_SRC})`)() as any,
    )) as Array<{ text: string; aria: string; x: number; y: number; w: number; h: number }>;
    console.log(`Add Media buttons: ${found.length}`);
    for (const b of found) console.log(`  text="${b.text}" aria="${b.aria}" @(${b.x},${b.y}) ${b.w}x${b.h}`);

    if (found.length === 0) {
      console.log("Nothing matched 'Add Media' — dumping all top-bar buttons:");
      const allTop = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Function(`return (${`
          () => {
            var btns = Array.prototype.slice.call(document.querySelectorAll("button, [role='button']"));
            var out = [];
            for (var i = 0; i < btns.length; i++) {
              var el = btns[i];
              var r = el.getBoundingClientRect();
              if (r.top > 100 || r.width < 18 || r.height < 14) continue;
              var t = ((el.innerText || el.textContent || '') + '').trim();
              out.push({ text: t.slice(0, 50), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) });
            }
            return out;
          }
        `})`)() as any,
      )) as Array<{ text: string; x: number; y: number; w: number }>;
      for (const b of allTop) console.log(`  top: text="${b.text}" @(${b.x},${b.y})`);
      return;
    }

    const target = found[0];
    console.log(`\nClicking Add Media @(${target.x},${target.y})`);

    // Set up file chooser handler BEFORE clicking, in case it triggers a
    // native chooser directly (no menu).
    let fileChooserSeen = false;
    const cleanup = page.on("dialog", async (d) => {
      console.log("dialog event:", d.type(), d.message());
      await d.dismiss();
    });
    void cleanup;

    const chooserPromise = page.waitForFileChooser({ timeout: 4_000 }).catch(() => null);
    await page.mouse.click(target.x, target.y);
    const chooser = await chooserPromise;
    if (chooser) {
      fileChooserSeen = true;
      console.log("→ Native file chooser opened immediately");
      // Don't actually pick a file in probe mode.
    }

    await new Promise((r) => setTimeout(r, 1_500));
    await page.screenshot({ path: path.join(outDir, "01-after-click.png") as `${string}.png` });

    if (!fileChooserSeen) {
      // Look for a menu/popover with options.
      const menu = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Function(`return (${`
          () => {
            function visible(el) {
              var r = el.getBoundingClientRect();
              if (r.width < 30 || r.height < 14) return false;
              var cs = window.getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
              return true;
            }
            var els = Array.prototype.slice.call(document.querySelectorAll("[role='menuitem'], [role='menu'] *, [role='dialog'] button, [role='dialog'] [role='button']"));
            var out = [];
            for (var i = 0; i < els.length; i++) {
              var el = els[i];
              if (!visible(el)) continue;
              var t = ((el.innerText || el.textContent || '') + '').trim();
              if (!t || t.length > 80) continue;
              var r = el.getBoundingClientRect();
              out.push({ text: t.slice(0, 80), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
            }
            return out;
          }
        `})`)() as any,
      )) as Array<{ text: string; x: number; y: number }>;
      console.log(`Menu/dialog items after click:`);
      for (const m of menu) console.log(`  text="${m.text}" @(${m.x},${m.y})`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
