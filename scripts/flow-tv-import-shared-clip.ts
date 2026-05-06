// Import an already-rendered Veo clip from its Flow share URL into our local
// registry, so Phase 2 can reuse it instead of re-rendering (no Veo credits).
//
// Why this exists: the `media.getMediaUrlRedirect?name=<uuid>` URL we capture
// during a live render is short-lived and cannot be replayed across sessions
// (returns 404). The only reliable way to recover an existing render is to
// open its share page in an authenticated browser tab and read the actual
// MP4 URL from the loaded `<video>` element, then in-page-fetch the bytes.
//
// Usage:
//   pnpm tsx scripts/flow-tv-import-shared-clip.ts <kind-NN> <share-url>
//
// kind-NN examples:
//   video-01   →  becomes clip-1 of the storyline (start=image-01, end=image-02)
//   video-02   →  becomes clip-2 of the storyline (start=image-02, end=image-03)
//
// Example:
//   pnpm tsx scripts/flow-tv-import-shared-clip.ts \
//     video-01 \
//     https://labs.google/fx/tools/flow/shared/video/c47f014f-586c-4ec9-8b66-beb461df17fd

import "dotenv/config";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import {
  launchBrowser,
  prepPage,
  focusChromeOnMac,
  dismissCookieWall,
  isLoggedInToFlow,
  waitForLogin,
  isHeadless,
  FLOW_URL,
  FLOW_DATA_DIR,
} from "../src/services/flow-tv-phase1";
import {
  buildAssetName,
  recordAsset,
  slug as slugify,
} from "../src/services/flow-tv-naming";

interface Storyline {
  title: string;
  imagePrompts: Array<{ title: string; prompt: string }>;
}

async function loadStoryline(): Promise<Storyline> {
  const file = path.join(FLOW_DATA_DIR, "storyline.json");
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw) as Storyline;
}

function parseKindArg(arg: string): { kind: "video" | "character" | "image"; index: number } {
  const m = arg.match(/^(video|character|image)-(\d{1,3})$/);
  if (!m) throw new Error(`Invalid kind-NN arg "${arg}". Expected e.g. video-01.`);
  return { kind: m[1] as "video" | "character" | "image", index: parseInt(m[2], 10) };
}

function parseShareUrl(url: string): { uuid: string; canonical: string } {
  // Accept either the full share URL or a bare UUID.
  const uuidRe = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const m = url.match(uuidRe);
  if (!m) throw new Error(`Could not extract UUID from "${url}"`);
  const uuid = m[1];
  const canonical = `https://labs.google/fx/tools/flow/shared/video/${uuid}`;
  return { uuid, canonical };
}

async function main() {
  const kindArg = process.argv[2];
  const urlArg = process.argv[3];
  if (!kindArg || !urlArg) {
    console.error("Usage: pnpm tsx scripts/flow-tv-import-shared-clip.ts <kind-NN> <share-url>");
    console.error("Example: video-01 https://labs.google/fx/tools/flow/shared/video/<uuid>");
    process.exit(1);
  }
  const { kind, index } = parseKindArg(kindArg);
  const { uuid, canonical } = parseShareUrl(urlArg);

  const storyline = await loadStoryline();
  console.log("─".repeat(72));
  console.log(` Flow TV — import shared clip`);
  console.log(`   story    : ${storyline.title}`);
  console.log(`   kind/idx : ${kind} / ${index}`);
  console.log(`   share    : ${canonical}`);
  console.log(`   uuid     : ${uuid}`);
  console.log("─".repeat(72));

  // Build the canonical scene-slug.
  // For videos: "<startScene>-to-<endScene>" using the storyline ordering.
  let sceneSlug: string | undefined;
  if (kind === "video") {
    const start = storyline.imagePrompts[index - 1]?.title;
    const end = storyline.imagePrompts[index]?.title;
    if (!start || !end) {
      throw new Error(`Storyline doesn't have scenes for video-${index} (need imagePrompts[${index - 1}] and [${index}])`);
    }
    sceneSlug = `${slugify(start)}-to-${slugify(end)}`;
  }

  const name = buildAssetName({
    storyTitle: storyline.title,
    kind,
    index,
    sceneSlug,
    ext: kind === "video" ? "mp4" : "png",
  });
  const outDir = path.join(FLOW_DATA_DIR, "imports");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, name.filename);
  console.log(` target   : ${outPath}`);

  if (fsSync.existsSync(outPath) && (await fs.stat(outPath)).size > 50_000) {
    console.log(` already on disk (${(await fs.stat(outPath)).size} bytes) — re-registering only.`);
    await recordAsset({
      storySlug: name.storySlug,
      kind: name.kind,
      index: name.index,
      sceneSlug: name.sceneSlug,
      filename: name.filename,
      flowDisplayName: name.flowDisplayName,
      localPath: outPath,
      flowUrl: canonical,
      flowAssetId: uuid,
    });
    console.log(" registry updated. done.");
    return;
  }

  const headless = isHeadless();
  console.log(` browser  : ${headless ? "headless" : "visible"}`);
  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);

    // Verify login (the share URL needs auth for non-public videos).
    console.log(" opening Flow homepage to verify login…");
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
    await dismissCookieWall(page).catch(() => {});
    if (!(await isLoggedInToFlow(page))) {
      if (!headless) await focusChromeOnMac().catch(() => {});
      console.log(" not logged in — please sign in in the visible Chrome window.");
      await waitForLogin(page);
    }
    console.log(" login ok.");

    console.log(` opening share page: ${canonical}`);
    await page.goto(canonical, { waitUntil: "networkidle2", timeout: 60_000 });

    // Wait for a video element to appear with a usable src or a poster.
    console.log(" waiting for <video> element with src…");
    const mediaUrl: string | null = await page
      .waitForFunction(
        () => {
          const vids = Array.from(document.querySelectorAll("video"));
          for (const v of vids) {
            // Direct src on the element.
            if (v.src && v.src.startsWith("http")) return v.src;
            // <source> children.
            const sources = Array.from(v.querySelectorAll("source")) as HTMLSourceElement[];
            for (const s of sources) {
              if (s.src && s.src.startsWith("http")) return s.src;
            }
            // currentSrc set by HLS / MSE pickers.
            if ((v as HTMLVideoElement).currentSrc && (v as HTMLVideoElement).currentSrc.startsWith("http")) {
              return (v as HTMLVideoElement).currentSrc;
            }
          }
          return false;
        },
        { timeout: 60_000, polling: 500 },
      )
      .then((h) => h.jsonValue() as Promise<string>)
      .catch(() => null);

    if (!mediaUrl) {
      // Fallback: dump the page so we can see what's on it (e.g. "sign in" wall
      // or "video not found").
      const dump = path.join(outDir, `import-fail-${uuid}.png`);
      try {
        await page.screenshot({ path: dump as `${string}.png`, fullPage: true });
      } catch {
        // ignore
      }
      throw new Error(
        `No <video> source found on ${canonical}. Screenshot: ${dump}. The share might be private to a different account, or the page UI changed.`,
      );
    }
    console.log(` resolved media URL → ${mediaUrl.slice(0, 120)}${mediaUrl.length > 120 ? "…" : ""}`);

    // The signed CDN URL (`flow-content.google/...?Expires=...&Signature=...`)
    // is on a different origin than the labs.google share page, so an in-page
    // fetch hits CORS. The signature is enough authorization on its own, so we
    // download via Node's fetch instead — no cookies needed.
    console.log(" downloading via Node fetch (signed URL, no cookies needed)…");
    const ctrl = new AbortController();
    const guard = setTimeout(() => ctrl.abort(), 180_000);
    let buf: Buffer;
    let ct = "";
    try {
      const resp = await fetch(mediaUrl, { signal: ctrl.signal });
      if (!resp.ok) throw new Error(`Download HTTP ${resp.status} ${resp.statusText}`);
      ct = resp.headers.get("content-type") || "";
      const ab = await resp.arrayBuffer();
      buf = Buffer.from(ab);
    } finally {
      clearTimeout(guard);
    }
    if (buf.length < 50_000) throw new Error(`Download too small (${buf.length}B, ct=${ct})`);

    await fs.writeFile(outPath, buf);
    console.log(` saved ${buf.byteLength} bytes (ct=${ct}) → ${outPath}`);

    const rec = await recordAsset({
      storySlug: name.storySlug,
      kind: name.kind,
      index: name.index,
      sceneSlug: name.sceneSlug,
      filename: name.filename,
      flowDisplayName: name.flowDisplayName,
      localPath: outPath,
      flowUrl: canonical,
      flowAssetId: uuid,
    });
    console.log(` registry: ${rec.storySlug} / ${rec.kind}-${String(rec.index).padStart(2, "0")} → ok`);
    console.log("\nNext run of Phase 2 will reuse this clip and skip the Veo render.");
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? `${e.message}\n${e.stack}` : e);
  process.exit(2);
});
