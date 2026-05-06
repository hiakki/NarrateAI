// Focused diagnostic: open Flow project, locate the right-side bar chip
// (currently labelled "🍌 Nano Banana 2 □ x2"), inspect its inner DOM
// structure (to see if model/ratio/count are 3 separate buttons), then click
// it and dump the resulting popover/panel.
//
// Outputs into data/flow-tv/inspect/<ts>/

import "dotenv/config";
import puppeteer from "puppeteer-core";
import type { Page } from "puppeteer-core";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

const FLOW_DATA_DIR = path.join(process.cwd(), "data", "flow-tv");
const PROJECT_FILE = path.join(FLOW_DATA_DIR, "project.json");
const PROFILE_DIR = path.join(process.cwd(), "data", "flow-chrome-profile");
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(FLOW_DATA_DIR, "inspect", TS);

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function findChrome(): string {
  for (const p of CHROME_PATHS) if (fsSync.existsSync(p)) return p;
  throw new Error("Chrome not found");
}

async function snap(page: Page, label: string, clip?: { x: number; y: number; width: number; height: number }) {
  const file = path.join(OUT_DIR, `${label}.png`);
  await page.screenshot({ path: file as `${string}.png`, clip });
  console.log("  screenshot:", file);
}

async function dumpJson(label: string, data: unknown) {
  const file = path.join(OUT_DIR, `${label}.json`);
  await fs.writeFile(file, JSON.stringify(data, null, 2));
  console.log("  dump:", file);
}

async function dumpText(label: string, text: string) {
  const file = path.join(OUT_DIR, `${label}.html`);
  await fs.writeFile(file, text);
  console.log("  dump:", file);
}

const FIND_CHIP_SRC = `
  () => {
    // The right-side chip is the button whose text contains "Nano Banana"
    // (the model name). It sits at the right of the prompt bar.
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
    var hits = [];
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var t = (b.textContent || '').toLowerCase();
      if (t.indexOf('nano banana') >= 0 || t.indexOf('imagen') >= 0 || t.indexOf('veo') >= 0) {
        var r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        hits.push({
          text: (b.textContent || '').trim().slice(0, 200),
          ariaLabel: b.getAttribute('aria-label') || '',
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
          html: b.outerHTML.slice(0, 4000),
          children: (function() {
            var kids = b.querySelectorAll('*');
            var out = [];
            for (var k = 0; k < kids.length; k++) {
              var kid = kids[k];
              var kr = kid.getBoundingClientRect();
              if (kr.width === 0 || kr.height === 0) continue;
              out.push({
                tag: kid.tagName,
                role: kid.getAttribute('role') || '',
                ariaLabel: kid.getAttribute('aria-label') || '',
                text: (kid.textContent || '').trim().slice(0, 80),
                rect: { x: Math.round(kr.left), y: Math.round(kr.top), w: Math.round(kr.width), h: Math.round(kr.height) },
                clickable: kid.tagName === 'BUTTON' || kid.getAttribute('role') === 'button' || (kid.onclick != null),
              });
            }
            return out;
          })(),
        });
      }
    }
    return hits;
  }
`;

const COLLECT_VISIBLE_INTERACTIVES_SRC = `
  () => {
    // Snapshot every visible interactive element on the page right now.
    var sels = ['button', '[role="button"]', '[role="menuitem"]', '[role="option"]', '[role="radio"]', 'input', 'select'];
    var seen = new Set();
    var out = [];
    for (var s = 0; s < sels.length; s++) {
      var nodes = document.querySelectorAll(sels[s]);
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (seen.has(el)) continue;
        seen.add(el);
        var r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        out.push({
          tag: el.tagName,
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          ariaChecked: el.getAttribute('aria-checked') || '',
          ariaSelected: el.getAttribute('aria-selected') || '',
          text: (el.textContent || '').trim().slice(0, 120),
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
          disabled: !!el.disabled,
        });
      }
    }
    out.sort(function(a, b) {
      if (Math.abs(a.rect.y - b.rect.y) > 20) return a.rect.y - b.rect.y;
      return a.rect.x - b.rect.x;
    });
    return out;
  }
`;

async function pause(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const projectUrl = JSON.parse(await fs.readFile(PROJECT_FILE, "utf-8")).projectUrl as string;
  console.log("Output dir :", OUT_DIR);
  console.log("Project    :", projectUrl);

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: false,
    userDataDir: PROFILE_DIR,
    defaultViewport: { width: 1366, height: 850 },
    args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.goto(projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });

  for (let i = 0; i < 60; i++) {
    const text = await page
      .evaluate(() => (document.body?.textContent ?? "").trim().toLowerCase())
      .catch(() => "");
    if (text !== "loading…" && text !== "loading...") break;
    await pause(500);
  }
  await pause(2500);

  console.log("\nStep A: state at rest");
  await snap(page, "A-rest-full");
  await snap(page, "A-rest-bar", { x: 0, y: 700, width: 1366, height: 140 });

  console.log("\nStep B: locate the chip and inspect its inner structure");
  const chipHits = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_CHIP_SRC})`)() as any,
  )) as Array<{
    text: string;
    rect: { x: number; y: number; w: number; h: number };
    html: string;
    children: Array<{ tag: string; text: string; rect: { x: number; y: number; w: number; h: number }; clickable: boolean }>;
  }>;
  console.log(`  found ${chipHits.length} chip-like button(s)`);
  for (const h of chipHits) {
    console.log(
      `    text="${h.text.slice(0, 80)}" at (${h.rect.x},${h.rect.y}) size ${h.rect.w}x${h.rect.h}, ${h.children.length} children`,
    );
  }
  await dumpJson("B-chip-structure", chipHits);
  if (chipHits.length === 0) {
    console.log("  no chip found — leaving browser open and bailing");
    await pause(20_000);
    await browser.close();
    return;
  }

  await dumpText("B-chip-outer-html", chipHits[0].html);

  console.log("\nStep C: click the chip and capture the panel that opens");
  const chip = chipHits[0];
  await snap(page, "C1-before-click");
  // Click slightly to the LEFT of center so we don't accidentally click the
  // count or ratio sub-region; we want the model-name area.
  const cx = chip.rect.x + Math.round(chip.rect.w * 0.25);
  const cy = chip.rect.y + chip.rect.h / 2;
  console.log(`  clicking model area at (${cx},${cy})`);
  await page.mouse.click(cx, cy);
  await pause(1200);
  await snap(page, "C2-after-click-model-area");

  // Dump everything visible right now (likely a panel/popover is open).
  const after1 = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${COLLECT_VISIBLE_INTERACTIVES_SRC})`)() as any,
  );
  await dumpJson("C3-after-click-model-area-controls", after1);

  // Dismiss
  await page.keyboard.press("Escape");
  await pause(500);
  await page.mouse.click(50, 200);
  await pause(500);

  // Now click the RIGHT 30% of the chip — that's where "x2" sits.
  console.log("\nStep D: click the RIGHT side of the chip (count area)");
  await snap(page, "D1-before-click");
  const cxR = chip.rect.x + Math.round(chip.rect.w * 0.85);
  console.log(`  clicking count area at (${cxR},${cy})`);
  await page.mouse.click(cxR, cy);
  await pause(1200);
  await snap(page, "D2-after-click-count-area");
  const after2 = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${COLLECT_VISIBLE_INTERACTIVES_SRC})`)() as any,
  );
  await dumpJson("D3-after-click-count-area-controls", after2);

  // Click middle area too (ratio)
  await page.keyboard.press("Escape");
  await pause(500);
  await page.mouse.click(50, 200);
  await pause(500);

  console.log("\nStep E: click the MIDDLE of the chip (ratio area)");
  await snap(page, "E1-before-click");
  const cxM = chip.rect.x + Math.round(chip.rect.w * 0.6);
  console.log(`  clicking ratio area at (${cxM},${cy})`);
  await page.mouse.click(cxM, cy);
  await pause(1200);
  await snap(page, "E2-after-click-ratio-area");
  const after3 = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${COLLECT_VISIBLE_INTERACTIVES_SRC})`)() as any,
  );
  await dumpJson("E3-after-click-ratio-area-controls", after3);

  console.log("\nLeaving browser open 60s for visual inspection…");
  await pause(60_000);
  await browser.close();
  console.log("\nAll outputs in:", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
