// Recover Flow TV clips from an existing project gallery WITHOUT re-rendering.
//
//   --probe-only       Open the project, list every gallery video tile (find
//                      <video> elements + their bounding ancestor) and write
//                      an inventory JSON. Zero downloads, zero Veo submits.
//
//   --download-all     Download every <video> src from the gallery to
//                      `runDir/phase2/gallery-video-NN.mp4` and run ffprobe
//                      on each. Useful when tiles aren't named (helps you
//                      visually identify which Veo render is which clip).
//                      Zero Veo submits.
//
//   (default)          As `--download-all`, then for each expected clip in
//                      the storyline: if exactly one downloaded gallery video
//                      whose first frame visually matches the clip's start
//                      scene exists → use it. Otherwise stop and surface the
//                      ambiguity to the user. NEVER auto-submits Veo.
//
// Usage:
//   npx tsx scripts/flow-tv-recover-from-gallery.ts <runId> [flag]
//
// Design rationale: the previous click-into-detail-view approach didn't
// reliably open Flow's detail viewer in this account. The <video>-element
// approach is reliable because every gallery video tile preloads its mp4
// into a hidden <video> with the real URL. We extract those URLs, then
// fetch each via tab.goto + flow-content.google CDN-redirect listener
// (proven in scripts/flow-tv-test-download.ts).

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

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
import { loadRun, saveRun, type FlowRun } from "@/services/flow-tv-run";
import { recordAsset } from "@/services/flow-tv-naming";

const execFileAsync = promisify(execFile);
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface VideoEntry {
  index: number;
  src: string;
  rect: { x: number; y: number; w: number; h: number };
  cdnUrl?: string;
  contentType?: string;
  size?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  mp4Path?: string;
  ftypOk?: boolean;
}

function logI(msg: string): void {
  console.log(`[recover] ${msg}`);
}
function logE(msg: string): void {
  console.error(`[recover] ${msg}`);
}

async function launch(): Promise<Browser> {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome not found. Set CHROME_PATH or install Chrome.");
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
      "--disable-extensions",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

async function scrollGalleryToEnd(page: Page, maxSteps = 20): Promise<void> {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < maxSteps; i++) {
    const count = await page.evaluate(() => document.querySelectorAll("img").length);
    if (count === last) {
      if (++stable >= 2) return;
    } else {
      stable = 0;
    }
    last = count;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 800));
  }
}

async function listGalleryVideos(page: Page): Promise<Array<{ src: string; rect: VideoEntry["rect"] }>> {
  return (await page.evaluate(() => {
    const out: Array<{ src: string; rect: { x: number; y: number; w: number; h: number } }> = [];
    document.querySelectorAll("video").forEach((v) => {
      const el = v as HTMLVideoElement;
      const src = el.src || el.currentSrc || "";
      if (!src || !/^https?:/i.test(src)) return;
      let anc: HTMLElement | null = el as unknown as HTMLElement;
      let rect = { x: 0, y: 0, w: 0, h: 0 };
      for (let d = 0; d < 20 && anc; d++) {
        const r = anc.getBoundingClientRect();
        if (r.width > 200 && r.height > 100) {
          rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          break;
        }
        anc = anc.parentElement;
      }
      out.push({ src, rect });
    });
    return out;
  })) as Array<{ src: string; rect: VideoEntry["rect"] }>;
}

// Open the trpc redirect URL in a new tab; capture the signed flow-content.google
// /video/<id>?Expires=... URL via response listener. Validate strictly.
async function downloadOneGalleryVideo(
  browser: Browser,
  trpcUrl: string,
  destPath: string,
): Promise<{ cdnUrl: string; contentType: string; size: number; ftypOk: boolean }> {
  type Resp = import("puppeteer-core").HTTPResponse;
  const tab = await browser.newPage();
  const cdnUrls: string[] = [];

  const onResp = (resp: Resp) => {
    const u = resp.url();
    if (/flow-content\.google\/video\/[^?]+\?.*Expires=\d+/i.test(u)) cdnUrls.push(u);
  };
  tab.on("response", onResp);

  try {
    await tab.setUserAgent(UA);
    await tab.goto(trpcUrl, { waitUntil: "networkidle2", timeout: 60_000 }).catch(() => {});
    const start = Date.now();
    while (cdnUrls.length === 0 && Date.now() - start < 10_000) {
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    tab.off("response", onResp);
    await tab.close().catch(() => {});
  }

  const cdnUrl = cdnUrls[0];
  if (!cdnUrl) throw new Error(`no signed CDN URL captured (likely a non-video tile)`);

  const ctrl = new AbortController();
  const guard = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const resp = await fetch(cdnUrl, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ct = resp.headers.get("content-type") || "";
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!/^video\//i.test(ct)) throw new Error(`non-video content-type ${ct}`);
    if (buf.length < 200_000) throw new Error(`too small ${buf.length}B`);
    const ftypOk =
      buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
    if (!ftypOk) throw new Error(`bytes are not a real mp4 (no ftyp magic)`);
    await fs.writeFile(destPath, buf);
    return { cdnUrl, contentType: ct, size: buf.length, ftypOk };
  } finally {
    clearTimeout(guard);
  }
}

async function ffprobeSummary(filePath: string): Promise<{ width: number; height: number; durationSec: number }> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);
  const meta = JSON.parse(stdout);
  const v = (meta.streams as Array<{ codec_type?: string; width?: number; height?: number }>).find(
    (s) => s.codec_type === "video",
  );
  if (!v) throw new Error("no video stream");
  return {
    width: v.width ?? 0,
    height: v.height ?? 0,
    durationSec: parseFloat(meta.format?.duration ?? "0"),
  };
}

interface RunOpts {
  runId: string;
  mode: "probe-only" | "download-all" | "auto-match";
}

function parseArgs(argv: string[]): RunOpts {
  const args = argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: tsx scripts/flow-tv-recover-from-gallery.ts <runId> [--probe-only|--download-all|--auto-match]",
    );
    process.exit(2);
  }
  let mode: RunOpts["mode"] = "auto-match";
  if (args.includes("--probe-only")) mode = "probe-only";
  else if (args.includes("--download-all")) mode = "download-all";
  const runId = args.find((a) => !a.startsWith("--"));
  if (!runId) {
    console.error("Missing runId.");
    process.exit(2);
  }
  return { runId, mode };
}

async function main(): Promise<void> {
  const { runId, mode } = parseArgs(process.argv);

  const run = (await loadRun(runId)) as FlowRun | null;
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!run.storySlug) throw new Error(`Run has no storySlug: ${runId}`);
  if (!run.storyline) throw new Error(`Run has no storyline: ${runId}`);

  logI(`run=${runId} story="${run.storyline.title}" slug=${run.storySlug}`);
  logI(`mode=${mode}`);

  const browser = await launch();
  try {
    const page = await prepPage(browser);
    const cached = await loadProjectCache(run.storySlug);
    if (!cached) throw new Error(`No cached project for storySlug=${run.storySlug}`);
    logI(`opening project: ${cached.projectName}`);

    await page.setUserAgent(UA);
    await page.goto(cached.projectUrl, { waitUntil: "networkidle2", timeout: 90_000 });
    if (!(await isLoggedInToFlow(page))) {
      throw new Error(`Not logged in. Open ${FLOW_URL} and sign in first.`);
    }

    await new Promise((r) => setTimeout(r, 2500));
    const phase2Dir = run.phase2RunDir ?? path.join(run.runDir, "phase2");
    await fs.mkdir(phase2Dir, { recursive: true });
    await takeScreenshot(page, phase2Dir, "recover-00-project-opened");

    logI("scrolling gallery to load lazy tiles…");
    await scrollGalleryToEnd(page);

    const raw = await listGalleryVideos(page);
    const videos: VideoEntry[] = raw.map((v, i) => ({ index: i, src: v.src, rect: v.rect }));
    logI(`gallery: ${videos.length} <video> tile(s) found`);
    for (const v of videos) {
      logI(`  • [${String(v.index).padStart(2, "0")}] @(${v.rect.x},${v.rect.y}) ${v.src.slice(0, 100)}…`);
    }

    if (mode === "probe-only") {
      const out = path.join(phase2Dir, "recover-inventory.json");
      await fs.writeFile(out, JSON.stringify({ runId, scannedAt: new Date().toISOString(), videos }, null, 2), "utf-8");
      logI(`inventory saved → ${out}`);
      logI("probe-only: exiting without downloads.");
      return;
    }

    // Download every video tile.
    for (const v of videos) {
      const dest = path.join(phase2Dir, `gallery-video-${String(v.index + 1).padStart(2, "0")}.mp4`);
      logI(`[${String(v.index + 1).padStart(2, "0")}] downloading → ${dest}`);
      try {
        const meta = await downloadOneGalleryVideo(browser, v.src, dest);
        v.cdnUrl = meta.cdnUrl;
        v.contentType = meta.contentType;
        v.size = meta.size;
        v.ftypOk = meta.ftypOk;
        v.mp4Path = dest;
        try {
          const ff = await ffprobeSummary(dest);
          v.width = ff.width;
          v.height = ff.height;
          v.durationSec = ff.durationSec;
          logI(`    ok: ${meta.size}B, ${ff.width}x${ff.height}, ${ff.durationSec.toFixed(2)}s`);
        } catch (e) {
          logE(`    ffprobe failed: ${(e as Error).message}`);
        }
      } catch (e) {
        logE(`    download failed: ${(e as Error).message}`);
      }
    }

    const reportPath = path.join(phase2Dir, "recover-report.json");
    await fs.writeFile(
      reportPath,
      JSON.stringify({ runId, completedAt: new Date().toISOString(), videos }, null, 2),
      "utf-8",
    );
    logI(`report saved → ${reportPath}`);

    if (mode === "download-all") {
      logI("download-all complete; not modifying run state.");
      logI("→ inspect each gallery-video-NN.mp4 (e.g. open in Quick Look) and decide which one is which clip.");
      logI("→ to wire up clip-NN.mp4: rename the file accordingly and rerun the worker, or finalize manually.");
      return;
    }

    // mode === "auto-match"
    // We can't reliably auto-match without prompts/captions on the tiles.
    // Refuse to guess — surface to user.
    const ok = videos.filter((v) => v.mp4Path && v.ftypOk);
    const expectedClipCount = run.clipCount ?? 2;
    logI(`auto-match: ${ok.length} valid mp4s downloaded vs ${expectedClipCount} expected clips`);
    if (ok.length === expectedClipCount && ok.length > 0) {
      // Trivial 1:1 mapping in tile order.
      for (let i = 0; i < ok.length; i++) {
        const v = ok[i];
        const storyline = run.storyline!;
        const startTitle = storyline.imagePrompts[i]?.title ?? `scene-${i + 1}`;
        const endTitle = storyline.imagePrompts[i + 1]?.title ?? `scene-${i + 2}`;
        const sceneSlug = `${startTitle}-to-${endTitle}`;
        const filename = `${run.storySlug}-video-${String(i + 1).padStart(2, "0")}-${sceneSlug}.mp4`;
        const destPath = path.join(phase2Dir, filename);
        await fs.copyFile(v.mp4Path!, destPath);
        await recordAsset({
          storySlug: run.storySlug!,
          kind: "video",
          index: i + 1,
          sceneSlug,
          filename,
          flowDisplayName: `${storyline.title} — Video ${String(i + 1).padStart(2, "0")} — ${sceneSlug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())}`,
          localPath: destPath,
          flowUrl: v.src,
        });
        logI(`  matched gallery-video-${String(v.index + 1).padStart(2, "0")} → ${filename}`);
        if (!run.clipPaths) run.clipPaths = [];
        run.clipPaths[i] = destPath;
      }
      run.events.push({
        ts: Date.now(),
        stage: "generating_clips",
        level: "info",
        message: `Recovery: matched ${ok.length} gallery videos to ${expectedClipCount} clip slots (no Veo renders)`,
      });
      run.lastMessage = `Recovered ${ok.length} clips from gallery`;
      await saveRun(run);
      logI("run state updated. Trigger the worker to stitch + finalize, or run finalize manually.");
    } else {
      logI(`auto-match cannot proceed: gallery has ${ok.length} videos, run wants ${expectedClipCount}.`);
      logI(`→ inspect ${path.join(phase2Dir, "gallery-video-*.mp4")} and decide which to keep.`);
      logI(`→ rerun with --download-all to refresh, or wipe duplicates from Flow gallery before retry.`);
      // Set the run to error so the worker doesn't auto-advance.
      run.events.push({
        ts: Date.now(),
        stage: "error",
        level: "error",
        message: `Recovery ambiguous: gallery has ${ok.length} videos, run wants ${expectedClipCount}. Manual review required.`,
      });
      run.stage = "error";
      run.lastMessage = `Gallery has ${ok.length} videos vs ${expectedClipCount} expected — manual review`;
      await saveRun(run);
      process.exitCode = 2;
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("[recover] fatal:", e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
