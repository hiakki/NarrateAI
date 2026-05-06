// One-shot probe: open the project, click an empty Start frame slot, and
// dump the popover's DOM (every visible button + every image/video tile in
// the popover) to a JSON file. Used to figure out the "Pick from project"
// option in Flow's frame-slot popover so we can wire frame uploads to
// reuse existing project gallery tiles instead of re-uploading from disk.
//
// Usage:
//   FLOW_TV_HEADLESS=false npx tsx scripts/flow-tv-probe-frame-popover.ts <runId>

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import fs from "fs/promises";
import path from "path";

import {
  findChrome,
  isHeadless,
  prepPage,
  takeScreenshot,
  loadProjectCache,
  isLoggedInToFlow,
  PROFILE_DIR,
  FLOW_URL,
} from "@/services/flow-tv-phase1";
import { loadRun, type FlowRun } from "@/services/flow-tv-run";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function launch(): Promise<Browser> {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome not found.");
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  return puppeteer.launch({
    executablePath: chromePath,
    headless: isHeadless(),
    userDataDir: PROFILE_DIR,
    defaultViewport: { width: 1366, height: 850 },
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

async function ensureFramesMode(page: Page): Promise<void> {
  // The Phase 2 driver clicks "Frames" sub-mode on the chip — to probe the
  // frame slots we need to be in the same state. Easier: just click the chip
  // and the Frames tab.
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']"));
    const framesTab = all.find((el) => /^frames$/i.test((el.innerText || "").trim()));
    if (framesTab) framesTab.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
}

async function locateStartSlot(page: Page): Promise<{ x: number; y: number } | null> {
  return (await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], div"));
    for (const el of all) {
      const txt = (el.innerText || "").trim();
      if (/^start$/i.test(txt)) {
        const r = el.getBoundingClientRect();
        if (r.width > 30 && r.height > 30 && r.y > 400) {
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }
      }
    }
    return null;
  })) as { x: number; y: number } | null;
}

interface DomDump {
  buttons: Array<{ text: string; x: number; y: number; w: number; h: number; tag: string; testid?: string }>;
  images: Array<{ src: string; alt: string; x: number; y: number; w: number; h: number }>;
  videos: Array<{ src: string; x: number; y: number; w: number; h: number }>;
  textBlocks: Array<{ text: string; x: number; y: number; w: number; h: number; tag: string }>;
}

// Build the DOM-dump function as a string and inject via `new Function(...)`
// to avoid tsx's __name() wrapper polluting the page-side function scope.
const DOM_DUMP_SRC = `
() => {
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  var buttons = [];
  // Include divs/spans that have onclick or look click-handled (Flow renders
  // many actions as plain divs).
  document.querySelectorAll("button, [role='button'], [aria-label], [data-testid]").forEach(function (el) {
    if (!visible(el)) return;
    var txt = (el.innerText || "").replace(/\\s+/g, " ").trim();
    var aria = el.getAttribute("aria-label") || "";
    if (!txt && !aria) return;
    var r = rectOf(el);
    if (r.w > 1000 || r.h > 600) return; // skip page-level wrappers
    buttons.push({
      text: (txt || aria).slice(0, 100),
      aria: aria || undefined,
      x: r.x, y: r.y, w: r.w, h: r.h,
      tag: el.tagName,
      testid: el.getAttribute("data-testid") || undefined,
    });
  });
  var images = [];
  document.querySelectorAll("img").forEach(function (el) {
    if (!visible(el)) return;
    var r = rectOf(el);
    if (r.w < 30 || r.h < 30) return;
    images.push({
      src: el.src,
      alt: el.alt || "",
      title: el.getAttribute("title") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      x: r.x, y: r.y, w: r.w, h: r.h
    });
  });
  var videos = [];
  document.querySelectorAll("video").forEach(function (el) {
    if (!visible(el)) return;
    var r = rectOf(el);
    videos.push({ src: el.src || el.currentSrc || "", x: r.x, y: r.y, w: r.w, h: r.h });
  });
  var textBlocks = [];
  document.querySelectorAll("p, span, label, h1, h2, h3, h4, [role='heading']").forEach(function (el) {
    if (!visible(el)) return;
    var txt = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (txt.length < 2 || txt.length > 200) return;
    var r = rectOf(el);
    textBlocks.push({ text: txt, x: r.x, y: r.y, w: r.w, h: r.h, tag: el.tagName });
  });
  return { buttons: buttons, images: images, videos: videos, textBlocks: textBlocks };
}
`;

async function dumpVisibleDom(page: Page): Promise<DomDump> {
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${DOM_DUMP_SRC})`)() as any,
  )) as DomDump;
}

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-probe-frame-popover.ts <runId>");
    process.exit(2);
  }
  const run = (await loadRun(runId)) as FlowRun | null;
  if (!run?.storySlug) throw new Error(`Run not found / no storySlug: ${runId}`);
  const cached = await loadProjectCache(run.storySlug);
  if (!cached) throw new Error(`No project cache for ${run.storySlug}`);

  const browser = await launch();
  try {
    const page = await prepPage(browser);
    await page.setUserAgent(UA);
    await page.goto(cached.projectUrl, { waitUntil: "networkidle2", timeout: 90_000 });
    if (!(await isLoggedInToFlow(page))) throw new Error(`Not logged in. Open ${FLOW_URL} first.`);
    await new Promise((r) => setTimeout(r, 2500));

    const phase2Dir = run.phase2RunDir ?? path.join(run.runDir, "phase2");
    await fs.mkdir(phase2Dir, { recursive: true });

    // Make sure we're in Frames mode (so Start/End slots are visible).
    await ensureFramesMode(page);
    await takeScreenshot(page, phase2Dir, "probe-popover-00-frames-mode");

    // Locate Start slot.
    const slot = await locateStartSlot(page);
    if (!slot) {
      console.error("Start slot not found");
      await takeScreenshot(page, phase2Dir, "probe-popover-01-no-start-slot");
      process.exit(2);
    }
    console.log(`Start slot @(${slot.x},${slot.y})`);

    // Click it; popover should open.
    await page.mouse.click(slot.x, slot.y);
    await new Promise((r) => setTimeout(r, 1500));
    await takeScreenshot(page, phase2Dir, "probe-popover-02-popover-open");

    // Dump everything visible.
    const dump = await dumpVisibleDom(page);
    const out = path.join(phase2Dir, "probe-popover-dom.json");
    await fs.writeFile(out, JSON.stringify({ scannedAt: new Date().toISOString(), slot, dump }, null, 2), "utf-8");
    console.log(`DOM dump written → ${out}`);
    console.log(`buttons: ${dump.buttons.length}`);
    console.log(`images:  ${dump.images.length}`);
    console.log(`videos:  ${dump.videos.length}`);
    console.log(`textBlocks: ${dump.textBlocks.length}`);

    // Print first 30 buttons to console for quick inspection.
    console.log("\n--- buttons (first 30) ---");
    dump.buttons.slice(0, 30).forEach((b, i) => {
      console.log(`  [${i}] @(${b.x},${b.y}) ${b.w}x${b.h} "${b.text.slice(0, 60)}"`);
    });
    console.log("\n--- images (first 30) ---");
    dump.images.slice(0, 30).forEach((im, i) => {
      console.log(`  [${i}] @(${im.x},${im.y}) ${im.w}x${im.h} alt="${im.alt.slice(0, 30)}" src=${im.src.slice(0, 80)}`);
    });
    console.log("\n--- text blocks (first 30) ---");
    dump.textBlocks.slice(0, 30).forEach((t, i) => {
      console.log(`  [${i}] @(${t.x},${t.y}) ${t.tag} "${t.text.slice(0, 60)}"`);
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("[probe] fatal:", e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
