// Flow TV — shared gallery scanner.
//
// Both Phase 1 (image generation) and Phase 2 (clip generation + frame slot
// upload) need to look at the project gallery and find existing assets BEFORE
// kicking off any new credit-burning operation. Without this pre-flight scan,
// any failure between "Veo finished rendering" and "tile renamed locally"
// looks like "asset missing" on retry and we re-render the same prompt,
// burning credits and leaving duplicate tiles.
//
// This module owns:
//   - GalleryAssetEntry            shape returned to callers
//   - extractAssetIdFromUrl        parser for Flow's media-redirect URLs
//   - waitForGalleryQuiescent      block until no upload-progress / "Generating…"
//   - scrollGalleryFully           load lazy tiles, then scroll back to top
//   - scanProjectAssetsByDisplayName
//                                  enumerate every visible <img> + <video>,
//                                  read each tile's visible name via right-click
//                                  → rename input → readback, return
//                                  Map<key, entry> keyed by displayName AND
//                                  by `__id__:<assetId>`.
//
// Phase 2 originally owned these. Phase 1 now imports them too so the
// runPhase1 character + scene loop can do the exact same "scan first, generate
// only what's missing" handshake.

import type { Page } from "puppeteer-core";
import { createLogger } from "@/lib/logger";
import {
  findImageTilesWithSrc,
  findVideoTilesWithSrc,
  readTileName,
  debugDumpVisibleImages,
} from "@/services/flow-tv-rename";

const log = createLogger("FlowTV:Gallery");

export interface GalleryAssetEntry {
  /**
   * The visible tile name. May be either our canonical Flow display name
   * (e.g. "<story> — Image NN — <slug>") if the rename succeeded, or the
   * original upload filename (e.g. "<story-slug>-image-NN-<slug>.png") if
   * the rename step crashed before completing.
   */
  displayName: string;
  rect: { x: number; y: number; w: number; h: number };
  src: string;
  assetId: string;
  isVideo: boolean;
}

/** Extract the `name=<id>` query param from Flow's media-redirect URLs. */
export function extractAssetIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?&]name=([a-f0-9-]+)/i);
  return m ? m[1] : null;
}

/**
 * Block until the project gallery has no in-flight upload progress text
 * ("<n>%") and no "Generating…" placeholder visible. We need this before any
 * scan because lazy-loaded tile srcs aren't stable while uploads are running.
 */
export async function waitForGalleryQuiescent(
  page: Page,
  timeoutMs = 90_000,
): Promise<void> {
  const start = Date.now();
  let lastReason = "";
  while (Date.now() - start < timeoutMs) {
    const reason = (await page.evaluate(() => {
      const body = document.body?.innerText ?? "";
      const pct = body.match(/(\d{1,3})\s?%/);
      if (pct) return `upload progress ${pct[0]}`;
      if (/generating/i.test(body)) return "render placeholder visible";
      if (/uploading/i.test(body)) return "uploading text visible";
      return "";
    })) as string;
    if (!reason) return;
    if (reason !== lastReason) {
      log.log(`  gallery not yet quiescent: ${reason}`);
      lastReason = reason;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  log.warn(`waitForGalleryQuiescent: timed out (last reason: ${lastReason || "n/a"})`);
}

/**
 * Scroll the project gallery to load all lazy tiles, then back to top so
 * readback can right-click each tile inside the viewport. Returns once the
 * tile count stabilises across two consecutive samples.
 */
export async function scrollGalleryFully(
  page: Page,
  maxSteps = 12,
): Promise<void> {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < maxSteps; i++) {
    const count = (await page.evaluate(() => document.querySelectorAll("img").length)) as number;
    if (count === last) {
      if (++stable >= 2) break;
    } else {
      stable = 0;
    }
    last = count;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 700));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 500));
}

/**
 * Scan the project gallery: enumerate every visible <img> + <video> tile,
 * extract each tile's Flow asset id from the media-redirect URL, AND read
 * its visible tile name via right-click → rename input → readback.
 *
 * Keys the output map by:
 *   • the visible display name (canonical or auto-named)
 *   • `__id__:<assetId>` (so callers with just an id can still look up)
 *
 * Returns an empty map on listing failure (best-effort).
 */
export async function scanProjectAssetsByDisplayName(
  page: Page,
  maxTiles = 16,
): Promise<Map<string, GalleryAssetEntry>> {
  await scrollGalleryFully(page);

  let imageTiles: Awaited<ReturnType<typeof findImageTilesWithSrc>>;
  let videoTiles: Awaited<ReturnType<typeof findVideoTilesWithSrc>>;
  try {
    imageTiles = await findImageTilesWithSrc(page);
    videoTiles = await findVideoTilesWithSrc(page);
  } catch (e) {
    log.warn(`scanProjectAssetsByDisplayName: tile listing failed (${(e as Error).message})`);
    return new Map();
  }

  type RawTile = { rect: { x: number; y: number; w: number; h: number }; src: string; isVideo: boolean };
  const all: RawTile[] = [
    ...imageTiles.map((t) => ({ rect: t.rect, src: t.src, isVideo: false })),
    ...videoTiles.map((t) => ({ rect: t.rect, src: t.src, isVideo: true })),
  ];
  // Reading order: top-to-bottom, then left-to-right.
  all.sort((a, b) => {
    if (Math.abs(a.rect.y - b.rect.y) > 80) return a.rect.y - b.rect.y;
    return a.rect.x - b.rect.x;
  });

  log.log(`Pre-flight gallery: ${imageTiles.length} image tile(s), ${videoTiles.length} video tile(s)`);
  // If we saw zero, dump what's actually in the DOM so we can diagnose
  // whether tiles exist but were filtered out (size threshold, visibility,
  // shadow DOM, iframe, etc.) vs. genuinely empty project.
  if (imageTiles.length === 0 && videoTiles.length === 0) {
    try {
      const all = await debugDumpVisibleImages(page);
      const visible = all.filter((i) => i.visible);
      const buckets = visible.reduce<Record<string, number>>((acc, i) => {
        const k = `${Math.round(i.w / 20) * 20}x${Math.round(i.h / 20) * 20}`;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
      const bucketStr = Object.entries(buckets)
        .map(([k, n]) => `${k}=${n}`)
        .join(",");
      log.warn(
        `Pre-flight gallery: empty scan but DOM has ${all.length} <img> total (${visible.length} visible). Size buckets: ${bucketStr || "—"}. Top 8 visible: ${visible
          .slice(0, 8)
          .map((i) => `${i.w}×${i.h} ${i.src.slice(0, 60)}`)
          .join(" | ")}`,
      );
    } catch (e) {
      log.warn(`Pre-flight gallery: empty scan and debug dump failed: ${(e as Error).message}`);
    }
  }
  const limited = all.slice(0, maxTiles);
  const out = new Map<string, GalleryAssetEntry>();
  for (const t of limited) {
    const assetId = extractAssetIdFromUrl(t.src);
    if (!assetId) {
      log.log(`  • skipping tile @(${t.rect.x},${t.rect.y}) — no name= in src`);
      continue;
    }
    // Scroll the tile into the viewport BEFORE right-click readback —
    // tiles below the fold can't be right-clicked at their original rect.
    try {
      await page.evaluate(
        (rect: { x: number; y: number; w: number; h: number }) =>
          window.scrollTo(0, Math.max(0, rect.y - 200)),
        t.rect,
      );
      await new Promise((r) => setTimeout(r, 350));
    } catch {
      // best-effort
    }
    // Re-fetch the tile rect after scrolling — its y will have changed.
    const rectAfterScroll = (await page.evaluate(
      (src: string) => {
        const imgs = Array.from(document.querySelectorAll("img"));
        const im = imgs.find((i) => (i as HTMLImageElement).src === src);
        if (im) {
          let anc: Element | null = im;
          for (let d = 0; d < 20 && anc; d++) {
            const r = (anc as HTMLElement).getBoundingClientRect();
            if (r.width > 200 && r.height > 100) {
              return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
            }
            anc = anc.parentElement;
          }
        }
        const vids = Array.from(document.querySelectorAll("video"));
        const vd = vids.find((v) => ((v as HTMLVideoElement).src || (v as HTMLVideoElement).currentSrc || "") === src);
        if (vd) {
          let anc: Element | null = vd;
          for (let d = 0; d < 20 && anc; d++) {
            const r = (anc as HTMLElement).getBoundingClientRect();
            if (r.width > 200 && r.height > 100) {
              return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
            }
            anc = anc.parentElement;
          }
        }
        return null;
      },
      t.src,
    )) as { x: number; y: number; w: number; h: number } | null;
    const liveRect = rectAfterScroll ?? t.rect;
    let displayName: string | null = null;
    try {
      displayName = await readTileName(page, liveRect);
    } catch {
      // ignore — best-effort read
    }
    const label = displayName ? displayName.trim() : `(unnamed id=${assetId.slice(0, 8)})`;
    const entry: GalleryAssetEntry = {
      displayName: label,
      rect: liveRect,
      src: t.src,
      assetId,
      isVideo: t.isVideo,
    };
    if (displayName) {
      out.set(displayName.trim(), entry);
    }
    out.set(`__id__:${assetId}`, entry);
    log.log(
      `  • ${t.isVideo ? "video" : "image"}  "${label}"  (id=${assetId})`,
    );
  }
  const uniqueIds = new Set(
    Array.from(out.values()).map((e) => e.assetId),
  );
  log.log(
    `Pre-flight gallery summary: ${imageTiles.length} images, ${videoTiles.length} videos (${uniqueIds.size} unique assets)`,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 300));
  return out;
}

/**
 * Find an image tile already in the project gallery whose visible display
 * name matches one of:
 *
 *   1. the canonical Flow display name (rename succeeded), OR
 *   2. the canonical upload filename — case-insensitive, with or without the
 *      file extension (rename crashed; Flow auto-named it from the upload
 *      filename, e.g. "iron-bar-hero-06052026-image-03-the-hero-moment.png").
 *
 * Returns the entry or null if not found. Skips video tiles.
 */
export function findImageTileForCanonicalName(
  gallery: Map<string, GalleryAssetEntry>,
  canonical: { flowDisplayName: string; filename: string },
): GalleryAssetEntry | null {
  // 1. exact canonical display name
  const exact = gallery.get(canonical.flowDisplayName);
  if (exact && !exact.isVideo) return exact;

  // 2. fuzzy: visible name contains the upload filename or its stem
  const filenameLc = canonical.filename.toLowerCase();
  const stem = filenameLc.replace(/\.[a-z0-9]+$/i, "");
  for (const [, entry] of gallery) {
    if (entry.isVideo) continue;
    const lc = entry.displayName.toLowerCase();
    if (lc === filenameLc || lc === stem || lc.includes(stem)) {
      return entry;
    }
  }
  return null;
}

/**
 * Best-effort: find an image tile whose visible display name was AUTO-named
 * by Flow from the GENERATION PROMPT (i.e. when our rename step crashed
 * after Veo rendered, Flow defaults the tile's name to a prefix of the
 * prompt that produced it).
 *
 * Strategy: take the first ~40 chars of the scene prompt as a "fingerprint"
 * and check whether any unmatched image tile's display name contains that
 * fingerprint (case-insensitive, ignoring punctuation). Skips video tiles.
 *
 * Returns the entry or null if no match.
 */
export function findImageTileByPromptPrefix(
  gallery: Map<string, GalleryAssetEntry>,
  prompt: string,
  fingerprintLen = 40,
): GalleryAssetEntry | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const fingerprint = norm(prompt).slice(0, fingerprintLen);
  if (fingerprint.length < 12) return null; // too generic

  for (const [, entry] of gallery) {
    if (entry.isVideo) continue;
    if (norm(entry.displayName).includes(fingerprint)) return entry;
  }
  return null;
}

/**
 * Find an image tile by its asset id (the `name=<id>` query param of the
 * media-redirect URL). Used to adopt previously-orphaned URLs persisted
 * across runs by `rememberOrphanedFlowUrl`.
 */
export function findImageTileByAssetId(
  gallery: Map<string, GalleryAssetEntry>,
  assetId: string,
): GalleryAssetEntry | null {
  const entry = gallery.get(`__id__:${assetId}`);
  if (entry && !entry.isVideo) return entry;
  return null;
}
