// Diagnostic: open the cached Flow project URL with the persistent profile and
// produce a thorough map of the bottom prompt bar — the prompt input, every
// chip next to it (model, aspect ratio, output count), and every popover that
// opens when those chips are clicked. Captures focused screenshots at each
// step so we can visually confirm what each control does before automating it.
//
// Outputs go into data/flow-tv/inspect/<timestamp>/
//   - 01-overview.png            full prompt-bar area
//   - 02-bar-zoom.png            tight crop of just the bar
//   - 03-bar-controls.json       every interactive element in the bar region
//   - 10-chip-N-before.png       page state before clicking chip N
//   - 11-chip-N-after.png        page state after clicking chip N
//   - 12-chip-N-popover.json     dump of any popover/menu that appeared
//
// Usage:  pnpm tsx scripts/flow-tv-inspect.ts

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

// Returns every visible interactive element whose bounding box overlaps the
// bottom prompt-bar band (y >= 600 by default), with detailed info we need to
// later target them programmatically.
const COLLECT_BAR_CONTROLS_SRC = `
  (yMin) => {
    function info(el) {
      var r = el.getBoundingClientRect();
      var attrs = {};
      for (var i = 0; i < el.attributes.length; i++) {
        attrs[el.attributes[i].name] = el.attributes[i].value;
      }
      var parentChain = [];
      var p = el.parentElement;
      var hop = 0;
      while (p && hop < 4) {
        parentChain.push(p.tagName + (p.getAttribute('data-testid') ? '[data-testid=' + p.getAttribute('data-testid') + ']' : '') + (p.className ? '.' + (typeof p.className === 'string' ? p.className.split(' ').slice(0, 2).join('.') : '') : ''));
        p = p.parentElement; hop++;
      }
      return {
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        ariaHaspopup: el.getAttribute('aria-haspopup') || '',
        ariaExpanded: el.getAttribute('aria-expanded') || '',
        title: el.getAttribute('title') || '',
        placeholder: el.getAttribute('placeholder') || '',
        text: (el.textContent || '').trim().slice(0, 120),
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        disabled: !!el.disabled,
        attrs: attrs,
        parents: parentChain.slice(0, 4),
      };
    }
    var sels = [
      'button',
      '[role="button"]',
      '[role="combobox"]',
      '[role="listbox"]',
      '[role="menuitem"]',
      'input',
      'textarea',
      '[contenteditable="true"]',
    ];
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
        if (r.top < yMin) continue;
        out.push(info(el));
      }
    }
    out.sort(function(a, b){
      if (Math.abs(a.rect.y - b.rect.y) > 30) return a.rect.y - b.rect.y;
      return a.rect.x - b.rect.x;
    });
    return out;
  }
`;

const COLLECT_POPOVER_SRC = `
  () => {
    function info(el) {
      var r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        text: (el.textContent || '').trim().slice(0, 200),
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      };
    }
    var sels = [
      '[role="menu"]',
      '[role="listbox"]',
      '[role="dialog"]',
      '[data-radix-popper-content-wrapper]',
      '[class*="popover" i]',
      '[class*="menu" i][class*="open" i]',
    ];
    var seen = new Set();
    var containers = [];
    for (var s = 0; s < sels.length; s++) {
      var nodes = document.querySelectorAll(sels[s]);
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (seen.has(el)) continue;
        seen.add(el);
        var r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        containers.push({ container: info(el), items: [] });
        var items = el.querySelectorAll('[role="menuitem"], [role="option"], button, [role="button"]');
        for (var j = 0; j < items.length; j++) {
          var ir = items[j].getBoundingClientRect();
          if (ir.width === 0 || ir.height === 0) continue;
          containers[containers.length - 1].items.push(info(items[j]));
        }
      }
    }
    return containers;
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
    const text = await page
      .evaluate(() => (document.body?.textContent ?? "").trim().toLowerCase())
      .catch(() => "");
    if (text !== "loading…" && text !== "loading...") break;
    await pause(500);
  }
  await pause(2500);

  console.log("\nStep 1: full overview");
  await snap(page, "01-overview");

  console.log("\nStep 2: tight crop of the bottom prompt bar (y=700-840)");
  await snap(page, "02-bar-zoom", { x: 0, y: 700, width: 1366, height: 140 });

  console.log("\nStep 3: dump every interactive element in y >= 700");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = (await page.evaluate(new Function(`return (${COLLECT_BAR_CONTROLS_SRC})`)() as any, 700)) as Array<{
    tag: string;
    text: string;
    ariaLabel: string;
    rect: { x: number; y: number; w: number; h: number };
  }>;
  await dumpJson("03-bar-controls", controls);
  console.log(`  found ${controls.length} controls in the bar region`);
  for (const c of controls) {
    console.log(
      `    [${String(c.rect.x).padStart(4)},${String(c.rect.y).padStart(4)}] ${String(c.rect.w).padStart(4)}x${String(c.rect.h).padStart(3)}  ${c.tag.padEnd(8)}  aria="${c.ariaLabel}"  text="${c.text.slice(0, 60)}"`,
    );
  }

  // Identify chip candidates: small-ish buttons whose text isn't empty and not
  // the round arrow. Heuristic: width 60-280, height 24-60, has visible text.
  const chips = controls.filter((c) => {
    if (c.tag !== "BUTTON" && c.tag !== "DIV") return false;
    if (!c.text || /^arrow_forward/i.test(c.text)) return false;
    if (c.rect.w < 40 || c.rect.w > 320) return false;
    if (c.rect.h < 20 || c.rect.h > 60) return false;
    return true;
  });

  console.log(`\nStep 4: probing ${chips.length} chip candidate(s)`);
  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
    const label = `chip-${String(i + 1).padStart(2, "0")}`;
    console.log(
      `\n  ${label}: text="${chip.text.slice(0, 60)}" at (${chip.rect.x},${chip.rect.y}) size ${chip.rect.w}x${chip.rect.h}`,
    );
    await snap(page, `10-${label}-before`);
    const cx = chip.rect.x + chip.rect.w / 2;
    const cy = chip.rect.y + chip.rect.h / 2;
    await page.mouse.click(cx, cy);
    await pause(800);
    await snap(page, `11-${label}-after`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const popover = await page.evaluate(new Function(`return (${COLLECT_POPOVER_SRC})`)() as any);
    await dumpJson(`12-${label}-popover`, popover);
    // dismiss
    await page.keyboard.press("Escape");
    await pause(400);
    // also click empty area to be safe
    await page.mouse.click(50, 200);
    await pause(400);
  }

  console.log("\nLeaving browser open 30s for manual inspection…");
  await pause(30_000);
  await browser.close();
  console.log("\nAll outputs in:", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
