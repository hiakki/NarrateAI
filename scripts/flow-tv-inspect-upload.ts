// Diagnostic: probe Flow's "Upload image" flow under the + button popover.
// 1. Open project
// 2. Click + button -> popover opens
// 3. Click "Upload image" inside the popover (intercept fileChooser)
// 4. Attach a known local PNG
// 5. Capture before/after screenshots and dump prompt-bar controls so we can
//    see the staged-ingredient UI (chip / thumbnail / cancel button)
//
// Spends zero Flow credits — we ESC out before submitting.

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
const OUT_DIR = path.join(FLOW_DATA_DIR, "inspect", `${TS}-upload`);
const TEST_IMAGE = path.join(
  FLOW_DATA_DIR,
  "runs",
  "2026-04-26T04-15-49-684Z-imgs3",
  "image-01-cubicle-despair.png",
);

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

async function pause(ms: number) { await new Promise((r) => setTimeout(r, ms)); }

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

const FIND_PLUS_SRC = `
  () => {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      if (t === 'add_2Create' || t === 'add_2') {
        var r = btns[i].getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
    }
    return null;
  }
`;

const FIND_UPLOAD_BTN_SRC = `
  () => {
    // Match anything containing "Upload image" or the file_upload icon name.
    var els = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], [role="menuitem"], div, span'));
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || '').trim();
      if (t === 'Upload image' || t === 'file_uploadUpload image' || /upload image/i.test(t) && t.length < 40) {
        var r = els[i].getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: t };
      }
    }
    return null;
  }
`;

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  if (!fsSync.existsSync(TEST_IMAGE)) throw new Error(`Test image missing: ${TEST_IMAGE}`);

  const projectUrl = JSON.parse(await fs.readFile(PROJECT_FILE, "utf-8")).projectUrl as string;
  console.log("Output dir :", OUT_DIR);
  console.log("Project    :", projectUrl);
  console.log("Test image :", TEST_IMAGE);

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
    const text = await page.evaluate(() => (document.body?.textContent ?? "").trim().toLowerCase()).catch(() => "");
    if (text !== "loading…" && text !== "loading...") break;
    await pause(500);
  }
  await pause(2500);

  await snap(page, "A-rest");

  // Step 1: click +
  const plus = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_PLUS_SRC})`)() as any,
  )) as { x: number; y: number } | null;
  if (!plus) throw new Error("+ button not found");
  console.log("\nClicking + at", plus);
  await page.mouse.click(plus.x, plus.y);
  await pause(1500);
  await snap(page, "B-popover-open");

  // Step 2: find the upload button inside the popover
  const upload = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${FIND_UPLOAD_BTN_SRC})`)() as any,
  )) as { x: number; y: number; text: string } | null;
  if (!upload) {
    console.log("Upload image button not found, dumping current controls");
    await dumpJson("Z-no-upload-controls", await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${COLLECT_VISIBLE_SRC})`)() as any,
    ));
    await pause(60_000);
    await browser.close();
    return;
  }
  console.log("\nUpload button at", upload);

  // Step 3: arm the file chooser, then click upload
  console.log("\nArming file chooser, clicking Upload image…");
  const [fileChooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 10_000 }),
    page.mouse.click(upload.x, upload.y),
  ]);
  console.log("  fileChooser ready, accepting:", TEST_IMAGE);
  await fileChooser.accept([TEST_IMAGE]);
  await pause(3500);
  await snap(page, "C-after-upload-accept");

  // Step 4: dump prompt-bar region controls to see the staged-ingredient UI
  const after = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${COLLECT_VISIBLE_SRC})`)() as any,
  )) as Array<{ tag: string; role: string; ariaLabel: string; text: string; rect: { x: number; y: number; w: number; h: number } }>;
  await dumpJson("D-controls-after-upload", after);

  console.log("\nControls in prompt-bar region (y > 700):");
  for (const it of after) {
    if (it.rect.y < 700) continue;
    const t = (it.text || "").replace(/\s+/g, " ");
    console.log(`    [${String(it.rect.x).padStart(4)},${String(it.rect.y).padStart(4)} ${String(it.rect.w).padStart(4)}x${String(it.rect.h).padStart(4)}] ${it.tag.padEnd(6)} role="${it.role}" "${t}"`);
  }
  console.log("\nAll thumbnails / images in prompt area:");
  const imgs = (await page.evaluate(() => {
    const out: Array<{ src: string; rect: { x: number; y: number; w: number; h: number } }> = [];
    const all = Array.from(document.querySelectorAll("img"));
    for (const i of all) {
      const r = (i as HTMLImageElement).getBoundingClientRect();
      if (r.top < 700) continue;
      if (r.width < 10 || r.height < 10) continue;
      out.push({
        src: ((i as HTMLImageElement).src || "").slice(0, 200),
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      });
    }
    return out;
  })) as Array<{ src: string; rect: { x: number; y: number; w: number; h: number } }>;
  for (const i of imgs) {
    console.log(`    [${i.rect.x},${i.rect.y} ${i.rect.w}x${i.rect.h}] src="${i.src.slice(0, 80)}…"`);
  }

  console.log("\nLeaving browser open 60s for visual verification (do NOT submit) …");
  await pause(60_000);
  await browser.close();
  console.log("\nAll outputs in:", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
