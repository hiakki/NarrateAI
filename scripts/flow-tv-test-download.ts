// One-shot test: open the project, query <video src> URLs, fetch each with
// Accept: video/mp4 from inside the page (so cookies are sent), and report
// the resulting Content-Type + size. NO writes, NO submissions, NO renders.

import puppeteer from "puppeteer-core";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import {
  findChrome,
  isHeadless,
  prepPage,
  loadProjectCache,
  isLoggedInToFlow,
  PROFILE_DIR,
} from "@/services/flow-tv-phase1";
import { loadRun } from "@/services/flow-tv-run";

const execFileAsync = promisify(execFile);
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: tsx scripts/flow-tv-test-download.ts <runId>");
    process.exit(2);
  }
  const writeFiles = process.argv.includes("--write");

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
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 1000));
    }

    const urls = (await page.evaluate(() => {
      const out: Array<{ src: string; rect: { x: number; y: number; w: number; h: number } }> = [];
      document.querySelectorAll("video").forEach((v) => {
        const el = v as HTMLVideoElement;
        const s = el.src || el.currentSrc || "";
        if (!s) return;
        // Walk up to find a sized ancestor.
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
        out.push({ src: s, rect });
      });
      return out;
    })) as Array<{ src: string; rect: { x: number; y: number; w: number; h: number } }>;

    console.log(`[test] found ${urls.length} <video> URLs in DOM`);
    for (const u of urls) console.log(`  • @(${u.rect.x},${u.rect.y}) ${u.src.slice(0, 110)}…`);

    // Listen for ALL responses to learn which hosts Flow uses for CDN.
    type Resp = import("puppeteer-core").HTTPResponse;
    const seenCdnHosts = new Map<string, string>(); // host → first full URL seen
    const allCdnUrls: string[] = [];
    page.on("response", (resp: Resp) => {
      const url = resp.url();
      const ct = resp.headers()["content-type"] || "";
      // Capture anything that smells like a video CDN.
      if (
        /\.(mp4|webm|m3u8)/i.test(url) ||
        /^video\//i.test(ct) ||
        /flow-content\.google/i.test(url) ||
        /storage\.googleapis\.com/i.test(url) ||
        /labs-flow-prod-cdn/i.test(url)
      ) {
        try {
          const host = new URL(url).host;
          if (!seenCdnHosts.has(host)) seenCdnHosts.set(host, url);
        } catch {}
        allCdnUrls.push(url);
      }
    });

    for (let i = 0; i < urls.length; i++) {
      const u = urls[i];
      console.log(`\n[test] [${i}] capturing CDN redirect for ${u.src.slice(0, 110)}…`);

      const before = allCdnUrls.length;

      // Use page.goto in a fresh tab to actually trigger the redirect chain.
      // The redirect target is what we want — the response listener at the
      // browser level should catch it before it 404s us.
      const tab = await browser.newPage();
      await tab.setUserAgent(UA);

      tab.on("response", (resp) => {
        const url = resp.url();
        const ct = resp.headers()["content-type"] || "";
        if (
          /\.(mp4|webm|m3u8)/i.test(url) ||
          /^video\//i.test(ct) ||
          /flow-content\.google/i.test(url) ||
          /storage\.googleapis\.com/i.test(url) ||
          /labs-flow-prod-cdn/i.test(url)
        ) {
          allCdnUrls.push(url);
        }
      });

      try {
        await tab.goto(u.src, { waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
      } catch (e) {
        console.log(`    goto error: ${(e as Error).message}`);
      }

      const newUrls = allCdnUrls.slice(before);
      console.log(`    captured ${newUrls.length} candidate URLs:`);
      newUrls.slice(0, 8).forEach((url) => console.log(`      • ${url.slice(0, 140)}`));

      // Pick the most-promising one: prefer flow-content.google or storage.googleapis with Expires param.
      const cdnUrl =
        newUrls.find((url) => /flow-content\.google\/.+\?.*Expires=/i.test(url)) ??
        newUrls.find((url) => /storage\.googleapis\.com/i.test(url)) ??
        newUrls.find((url) => /\.mp4(\?|$)/i.test(url)) ??
        null;

      await tab.close().catch(() => {});

      if (!cdnUrl) {
        console.log(`    no CDN URL captured`);
        continue;
      }
      console.log(`    cdnUrl: ${cdnUrl.slice(0, 140)}…`);

      // Now Node-fetch the signed CDN URL directly (signed querystring is
      // self-authenticating).
      try {
        const ctrl = new AbortController();
        const guard = setTimeout(() => ctrl.abort(), 60_000);
        const resp = await fetch(cdnUrl, { signal: ctrl.signal });
        clearTimeout(guard);
        const ct = resp.headers.get("content-type") || "";
        const buf = Buffer.from(await resp.arrayBuffer());
        const head = Array.from(new Uint8Array(buf.subarray(0, 16)));
        const hex = head.map((b: number) => b.toString(16).padStart(2, "0")).join(" ");
        const isMp4 = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
        const isJpeg = head[0] === 0xff && head[1] === 0xd8;
        console.log(
          `    status=${resp.status} ct=${ct} size=${buf.length}B`,
        );
        console.log(`    first 16 bytes: ${hex}  → ${isMp4 ? "MP4" : isJpeg ? "JPEG" : "OTHER"}`);

        if (writeFiles && isMp4 && buf.length > 200_000) {
          const phase2Dir = run.phase2RunDir ?? path.join(run.runDir, "phase2");
          const filename = `gallery-video-${String(i + 1).padStart(2, "0")}.mp4`;
          const filePath = path.join(phase2Dir, filename);
          await fs.writeFile(filePath, buf);
          console.log(`    saved → ${filePath}`);
          try {
            const { stdout } = await execFileAsync("ffprobe", [
              "-v", "error",
              "-print_format", "json",
              "-show_streams",
              "-show_format",
              filePath,
            ]);
            const meta = JSON.parse(stdout);
            const vs = (meta.streams as Array<{ codec_type?: string; width?: number; height?: number }>).find(
              (s) => s.codec_type === "video",
            );
            console.log(`    ffprobe: ${vs?.width}x${vs?.height}, duration=${meta.format?.duration}s`);
          } catch (e) {
            console.log(`    ffprobe failed: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        console.log(`    Node-fetch failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("[test] fatal:", e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
