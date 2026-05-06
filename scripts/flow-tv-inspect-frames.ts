// Phase 2 inspection step 2: locate the inline "Start" / "End" frame slot
// buttons in Video mode. Confirm clicking them opens a media picker, then
// dump that picker so we know how to upload images. ZERO Flow credits.

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
const OUT_DIR = path.join(FLOW_DATA_DIR, "inspect", `${TS}-frames`);

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
function findChrome(): string {
  for (const p of CHROME_PATHS) if (fsSync.existsSync(p)) return p;
  throw new Error("Chrome not found");
}
async function snap(page: Page, label: string) {
  const f = path.join(OUT_DIR, `${label}.png`);
  await page.screenshot({ path: f as `${string}.png` });
  console.log("  screenshot:", f);
}
async function dumpJson(label: string, data: unknown) {
  const f = path.join(OUT_DIR, `${label}.json`);
  await fs.writeFile(f, JSON.stringify(data, null, 2));
  console.log("  dump:", f);
}
async function pause(ms: number) { await new Promise((r) => setTimeout(r, ms)); }

// Find any visible element whose trimmed textContent is exactly "Start" or "End"
// — ignore the icons row and the chip row by requiring length <= 8.
const FIND_FRAME_SLOT_SRC = `
  (label) => {
    var els = Array.prototype.slice.call(document.querySelectorAll('*'));
    var hits = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var t = (el.textContent || '').trim();
      if (t.length > 12) continue;
      if (t.toLowerCase() !== label.toLowerCase()) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // The Start/End buttons sit just above the prompt input — y between 700-770
      // for our viewport (1366x850). Skip anything outside that band.
      if (r.top < 650 || r.top > 800) continue;
      hits.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        text: t,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
    return hits;
  }
`;

const COLLECT_VISIBLE_SRC = `
  () => {
    var sels = ['button', '[role="button"]', '[role="menuitem"]', '[role="option"]', '[role="dialog"]', 'input', 'select'];
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
          text: (el.textContent || '').trim().slice(0, 200),
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
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.goto(projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });

  for (let i = 0; i < 60; i++) {
    const text = await page.evaluate(() => (document.body?.textContent ?? "").trim().toLowerCase()).catch(() => "");
    if (text !== "loading…" && text !== "loading...") break;
    await pause(500);
  }
  await pause(2500);
  await snap(page, "00-rest");

  // 1. Locate Start and End slot buttons
  const startHits = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_FRAME_SLOT_SRC})`)() as any,
    "Start",
  )) as Array<{ tag: string; role: string; text: string; x: number; y: number; w: number; h: number }>;
  const endHits = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_FRAME_SLOT_SRC})`)() as any,
    "End",
  )) as Array<{ tag: string; role: string; text: string; x: number; y: number; w: number; h: number }>;
  console.log("\nStart hits:", startHits);
  console.log("End hits  :", endHits);
  await dumpJson("01-frame-slots", { startHits, endHits });

  if (startHits.length === 0) {
    console.log("Start slot not found — bailing");
    await pause(15_000);
    await browser.close();
    return;
  }

  // 2. Click the Start slot, see what opens
  const start = startHits[0];
  console.log(`\nClicking Start slot at (${start.x},${start.y})`);
  await page.mouse.click(start.x, start.y);
  await pause(1200);
  await snap(page, "02-start-clicked");
  await dumpJson("02-start-popover-controls", await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${COLLECT_VISIBLE_SRC})`)() as any,
  ));

  // Print interesting matches
  const all = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${COLLECT_VISIBLE_SRC})`)() as any,
  )) as Array<{ tag: string; role: string; ariaLabel: string; text: string; rect: { x: number; y: number; w: number; h: number } }>;
  const kw = /upload|frame|asset|gallery|media|recent|search|library|ingredient/i;
  console.log("\nStart popover controls (filtered):");
  for (const c of all) {
    const t = (c.text || "").replace(/\s+/g, " ");
    if (!kw.test(t) && !kw.test(c.ariaLabel)) continue;
    console.log(`    [${String(c.rect.x).padStart(4)},${String(c.rect.y).padStart(4)} ${String(c.rect.w).padStart(4)}x${String(c.rect.h).padStart(4)}] ${c.tag.padEnd(6)} role="${c.role}" aria="${c.ariaLabel}" text="${t.slice(0, 80)}"`);
  }

  // Close popover
  await page.keyboard.press("Escape");
  await pause(500);

  // 3. Click End slot too (to confirm same UI)
  if (endHits.length > 0) {
    const end = endHits[0];
    console.log(`\nClicking End slot at (${end.x},${end.y})`);
    await page.mouse.click(end.x, end.y);
    await pause(1200);
    await snap(page, "03-end-clicked");
    await dumpJson("03-end-popover-controls", await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${COLLECT_VISIBLE_SRC})`)() as any,
    ));
    await page.keyboard.press("Escape");
    await pause(500);
  }

  console.log("\nLeaving browser open 60s for visual verification…");
  await pause(60_000);
  await browser.close();
  console.log("\nAll outputs in:", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
