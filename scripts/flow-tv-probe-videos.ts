// One-shot probe: for the run's project, dump every <video> element on the
// page (with its rect, src, and computed-style) and every tile from the
// gallery scanner. Used to figure out the right way to associate gallery
// tiles with their actual mp4 sources without clicking into a detail view
// (which hasn't worked reliably).

import puppeteer from "puppeteer-core";
import fs from "fs/promises";
import path from "path";

import {
  findChrome,
  isHeadless,
  prepPage,
  loadProjectCache,
  isLoggedInToFlow,
  PROFILE_DIR,
  takeScreenshot,
} from "@/services/flow-tv-phase1";
import { listAssetTiles } from "@/services/flow-tv-rename";
import { loadRun } from "@/services/flow-tv-run";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-probe-videos.ts <runId>");
    process.exit(2);
  }

  const run = await loadRun(runId);
  if (!run || !run.storySlug) throw new Error(`Run not found: ${runId}`);

  const cached = await loadProjectCache(run.storySlug);
  if (!cached) throw new Error(`No project cache for ${run.storySlug}`);

  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome not found");

  await fs.mkdir(PROFILE_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: isHeadless(),
    userDataDir: PROFILE_DIR,
    defaultViewport: { width: 1366, height: 850 },
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  try {
    const page = await prepPage(browser);
    await page.setUserAgent(UA);
    await page.goto(cached.projectUrl, { waitUntil: "networkidle2", timeout: 90_000 });
    if (!(await isLoggedInToFlow(page))) throw new Error("Not logged in");

    await new Promise((r) => setTimeout(r, 3000));

    // Scroll to load all lazy-loaded items.
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 1000));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 1000));

    const phase2Dir = run.phase2RunDir ?? path.join(run.runDir, "phase2");
    await takeScreenshot(page, phase2Dir, "probe-videos-overview");

    // Dump every <video>, <source>, every <a> with .mp4 in href, every
    // element whose innerText looks like a clip caption.
    const probeSrc = `() => {
      function rectOf(el) {
        var r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }
      var vids = Array.prototype.slice.call(document.querySelectorAll("video"));
      var videoData = vids.map(function (v) {
        // Walk up to find the closest sized ancestor (the visible tile).
        var anc = v;
        var ancRect = null;
        var ancTag = null;
        var ancAria = null;
        var ancText = null;
        for (var depth = 0; depth < 20 && anc; depth++) {
          var r = anc.getBoundingClientRect();
          if (r.width > 200 && r.height > 100) {
            ancRect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
            ancTag = anc.tagName;
            ancAria = anc.getAttribute && anc.getAttribute("aria-label");
            ancText = (anc.innerText || "").trim().slice(0, 200);
            break;
          }
          anc = anc.parentElement;
        }
        return {
          src: v.src || v.currentSrc || null,
          poster: v.poster || null,
          rect: rectOf(v),
          duration: v.duration || null,
          paused: v.paused,
          muted: v.muted,
          autoplay: v.autoplay,
          parentTag: v.parentElement ? v.parentElement.tagName : null,
          ariaLabel: v.getAttribute("aria-label"),
          ancestorRect: ancRect,
          ancestorTag: ancTag,
          ancestorAria: ancAria,
          ancestorText: ancText,
        };
      });
      var sources = Array.prototype.slice.call(document.querySelectorAll("source"));
      var sourceData = sources.map(function (s) {
        return {
          src: s.src || null,
          srcset: s.getAttribute("srcset") || null,
          type: s.type || null,
          rect: rectOf(s),
        };
      });
      var anchors = Array.prototype.slice.call(document.querySelectorAll("a[href]"));
      var anchorData = anchors
        .filter(function (a) {
          var h = a.getAttribute("href") || "";
          return /\\.(mp4|webm|m3u8)/i.test(h) || /labs\\.google\\/fx\\/tools\\/flow\\/shared\\/video/i.test(h);
        })
        .map(function (a) {
          return { href: a.getAttribute("href"), text: (a.innerText || "").trim().slice(0, 100) };
        });
      // Tile captions: try data-attrs, [data-testid], aria-labels, and any
      // visible text that includes "Video " (our naming convention).
      var caps = [];
      var els = Array.prototype.slice.call(document.querySelectorAll("*"));
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var t = (el.innerText || "").trim();
        if (!t) continue;
        if (t.length < 8 || t.length > 200) continue;
        if (!/(Video |Image |Character |Founder|breakthrough|Generation)/i.test(t)) continue;
        if (el.children.length > 1) continue; // skip wrappers
        caps.push({ tag: el.tagName, text: t.slice(0, 200), rect: rectOf(el) });
      }
      // Dedup captions
      var seen = {};
      var dedup = [];
      for (var i = 0; i < caps.length; i++) {
        var k = caps[i].text + "|" + caps[i].rect.x + "|" + caps[i].rect.y;
        if (seen[k]) continue;
        seen[k] = 1;
        dedup.push(caps[i]);
      }
      return { videos: videoData, sources: sourceData, mp4Anchors: anchorData, captions: dedup };
    }`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await page.evaluate(new Function(`return (${probeSrc})`)() as any)) as {
      videos: unknown[];
      sources: unknown[];
      mp4Anchors: unknown[];
      captions: unknown[];
    };

    const tiles = await listAssetTiles(page);
    console.log(`[probe] tiles=${tiles.length} videos=${result.videos.length} sources=${result.sources.length} mp4Anchors=${result.mp4Anchors.length} captions=${result.captions.length}`);

    const out = path.join(phase2Dir, "probe-videos.json");
    await fs.writeFile(out, JSON.stringify({ tiles, ...result }, null, 2), "utf-8");
    console.log(`[probe] dumped → ${out}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("[probe] fatal:", e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
