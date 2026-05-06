// Diagnostic: inspect what happens when we click the "+" button on the
// bottom prompt bar — that's the "add ingredient / reference image" affordance
// we need for chaining a single protagonist across all scene generations.
//
// Outputs go into data/flow-tv/inspect/<ts>/
//   - A-rest.png                      page at rest
//   - B-after-plus-click.png          after clicking the + button
//   - C-controls-after-click.json     every visible interactive control after the click

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

async function snap(page: Page, label: string) {
  const file = path.join(OUT_DIR, `${label}.png`);
  await page.screenshot({ path: file as `${string}.png` });
  console.log("  screenshot:", file);
}

async function dumpJson(label: string, data: unknown) {
  const file = path.join(OUT_DIR, `${label}.json`);
  await fs.writeFile(file, JSON.stringify(data, null, 2));
  console.log("  dump:", file);
}

async function pause(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

const COLLECT_VISIBLE_SRC = `
  () => {
    var sels = ['button', '[role="button"]', '[role="menuitem"]', '[role="option"]', '[role="dialog"]', 'input', '[contenteditable="true"]'];
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
          text: (el.textContent || '').trim().slice(0, 120),
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
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

const FIND_PLUS_BTN_SRC = `
  () => {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      // Material Icons name "add_2" + visible label "Create" -> textContent "add_2Create"
      if (t === 'add_2Create' || t === 'add_2' || t === 'addAdd ingredient' || /add_2/i.test(t)) {
        var r = btns[i].getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: t, w: Math.round(r.width), h: Math.round(r.height) };
      }
    }
    return null;
  }
`;

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

  console.log("\nStep A: page at rest");
  await snap(page, "A-rest");

  console.log("\nStep B: locate the + button");
  const plus = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_PLUS_BTN_SRC})`)() as any,
  )) as { x: number; y: number; text: string; w: number; h: number } | null;
  if (!plus) {
    console.log("  + button not found, leaving browser open 30s");
    await pause(30_000);
    await browser.close();
    return;
  }
  console.log(`  + button at (${plus.x},${plus.y}) text="${plus.text}" size ${plus.w}x${plus.h}`);

  console.log("\nStep C: click the + button");
  await page.mouse.click(plus.x, plus.y);
  await pause(1500);
  await snap(page, "B-after-plus-click");
  const after = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${COLLECT_VISIBLE_SRC})`)() as any,
  );
  await dumpJson("C-controls-after-click", after);
  console.log(`  ${(after as Array<unknown>).length} controls visible after click`);
  // Print just the new things in y < 700 area or those near the prompt bar
  // (likely the menu/dialog items).
  const items = (after as Array<{ tag: string; role: string; ariaLabel: string; text: string; rect: { x: number; y: number; w: number; h: number } }>);
  for (const it of items) {
    if (it.text && it.text.length > 0 && it.text.length < 80) {
      const t = it.text.replace(/\s+/g, " ");
      console.log(`    [${String(it.rect.x).padStart(4)},${String(it.rect.y).padStart(4)}] ${it.tag.padEnd(6)} role="${it.role}" "${t}"`);
    }
  }

  console.log("\nLeaving browser open 60s for visual inspection…");
  await pause(60_000);
  await browser.close();
  console.log("\nAll outputs in:", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
