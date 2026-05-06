// One-shot: walk every storySlug/registryKey in the URL graveyard, look up
// the live Flow gallery tile by `name=<assetId>`, and rename it to its
// canonical Flow display name via the new hover→⋮→Rename path.
//
// Use this to clean up gallery tiles that got renamed-failed during a
// recent run without re-rendering anything.
//
// Usage:
//   npx tsx scripts/flow-tv-rename-orphans.ts [storySlug]
//
// If storySlug is omitted, processes ALL slugs in the graveyard.

import "dotenv/config";
import {
  launchBrowser,
  prepPage,
  ensureProject,
} from "@/services/flow-tv-phase1";
import {
  showAllMediaPanel,
  findImageTilesWithSrc,
  findVideoTilesWithSrc,
  renameAndVerify,
} from "@/services/flow-tv-rename";
import {
  loadRegistry,
  clearOrphanedFlowUrls,
  buildAssetName,
  recordAsset,
} from "@/services/flow-tv-naming";
import {
  waitForGalleryQuiescent,
  scrollGalleryFully,
  extractAssetIdFromUrl,
  findImageTileByPromptPrefix,
  scanProjectAssetsByDisplayName,
} from "@/services/flow-tv-gallery";
import path from "path";
import fs from "fs/promises";

interface OrphanItem {
  storySlug: string;
  registryKey: string;
  urls: string[];
}

function parseRegistryKey(key: string):
  | { kind: "image" | "character" | "video" | "clip"; index: number; sceneSlug?: string }
  | null {
  // Examples: "image-03-the-punchline", "character-01", "video-02-foo-bar"
  const m = key.match(/^(image|character|video|clip)-(\d+)(?:-(.+))?$/);
  if (!m) return null;
  return {
    kind: m[1] as "image" | "character" | "video" | "clip",
    index: parseInt(m[2], 10),
    sceneSlug: m[3] || undefined,
  };
}

// Title-case helper, but lowercase common articles/preps that the LLM
// preserves verbatim ("Uncle and the Smart Mirror", not "Uncle And The
// Smart Mirror"). Used only as a fallback when the storyline cache and
// registry both don't contain the canonical title.
function deriveTitle(storySlug: string): string {
  const SMALL = new Set([
    "a", "an", "and", "or", "but", "the", "of", "in", "on", "at", "to",
    "for", "with", "from", "by",
  ]);
  const stripped = storySlug.replace(/-\d{8}$/, "");
  return stripped
    .split("-")
    .map((w, i) => {
      if (!w) return "";
      if (i > 0 && SMALL.has(w.toLowerCase())) return w.toLowerCase();
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

interface StorylineCache {
  title?: string;
  characterPrompt?: string;
  imagePrompts?: Array<{ title?: string; prompt?: string }>;
}

async function loadStorylineCache(storySlug: string): Promise<StorylineCache | null> {
  const storylineFile = path.join(
    process.cwd(),
    "data/flow-tv/storylines",
    `${storySlug}.json`,
  );
  try {
    const raw = await fs.readFile(storylineFile, "utf-8");
    return JSON.parse(raw) as StorylineCache;
  } catch {
    return null;
  }
}

async function findFlowProjectUrl(storySlug: string): Promise<string | null> {
  const projFile = path.join(
    process.cwd(),
    "data/flow-tv/projects",
    `${storySlug}.json`,
  );
  try {
    const raw = await fs.readFile(projFile, "utf-8");
    const data = JSON.parse(raw);
    if (data?.projectUrl) return data.projectUrl as string;
  } catch {
    // ignore
  }
  return null;
}

async function main(): Promise<void> {
  const filterSlug = process.argv[2];
  const reg = await loadRegistry();
  const orphans = new Map<string, OrphanItem>(); // dedup key = `${slug}|${key}`

  // Source 1 — explicit graveyard (rename failed AFTER `clearOrphanedFlowUrls`
  // was no longer called pre-rename).
  for (const [id, urls] of Object.entries(reg.urlGraveyard ?? {})) {
    const [storySlug, registryKey] = id.split("|");
    if (!storySlug || !registryKey) continue;
    if (filterSlug && storySlug !== filterSlug) continue;
    if (!urls || urls.length === 0) continue;
    orphans.set(`${storySlug}|${registryKey}`, { storySlug, registryKey, urls });
  }

  // Source 2 — every asset record (image OR video) — even those without a
  // flowUrl. For records with a URL we still match by `name=<assetId>`.
  // For records without a URL (Phase 1 images never persist flowUrl),
  // we fall back to matching the gallery tile by PROMPT PREFIX (Flow
  // auto-names tiles from the prompt when our rename step misses).
  for (const [storySlug, story] of Object.entries(reg.stories ?? {})) {
    if (filterSlug && storySlug !== filterSlug) continue;
    for (const [registryKey, rec] of Object.entries(story ?? {})) {
      if (!rec || typeof rec !== "object") continue;
      const url = (rec as { flowUrl?: string }).flowUrl;
      const compositeId = `${storySlug}|${registryKey}`;
      const existing = orphans.get(compositeId);
      if (url) {
        if (existing) {
          if (!existing.urls.includes(url)) existing.urls.push(url);
        } else {
          orphans.set(compositeId, { storySlug, registryKey, urls: [url] });
        }
      } else if (!existing) {
        // No URL — still queue for prompt-prefix rescue (only for images;
        // videos always have a flowUrl recorded by Phase 2).
        const isImage = registryKey.startsWith("image-") || registryKey === "character-01" || registryKey.startsWith("character-");
        if (isImage) {
          orphans.set(compositeId, { storySlug, registryKey, urls: [] });
        }
      }
    }
  }

  if (orphans.size === 0) {
    console.log("No tiles to check. Nothing to rename.");
    process.exit(0);
  }
  console.log(`Will check ${orphans.size} slot(s) (graveyard + registry-recorded URLs).`);
  for (const o of orphans.values()) {
    console.log(`  - ${o.storySlug} :: ${o.registryKey} (${o.urls.length} url(s))`);
  }
  // Convert back to array for downstream loop.
  const orphanList = Array.from(orphans.values());

  // Group by storySlug so we open each project once.
  const bySlug = new Map<string, OrphanItem[]>();
  for (const o of orphanList) {
    const arr = bySlug.get(o.storySlug) ?? [];
    arr.push(o);
    bySlug.set(o.storySlug, arr);
  }

  const browser = await launchBrowser();
  const page = await prepPage(browser);
  try {
    for (const [storySlug, items] of bySlug) {
      const projectUrl = await findFlowProjectUrl(storySlug);
      if (!projectUrl) {
        console.warn(`  [${storySlug}] no cached project URL — opening Flow home for manual nav`);
        await page.goto("https://labs.google/fx/tools/flow", { waitUntil: "networkidle2" });
        await new Promise((r) => setTimeout(r, 2000));
        const ensured = await ensureProject(page, storySlug, "/tmp", "");
        if (!ensured) {
          console.warn(`  [${storySlug}] ensureProject failed; skipping`);
          continue;
        }
      } else {
        console.log(`  [${storySlug}] opening ${projectUrl}`);
        await page.goto(projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
      }
      await new Promise((r) => setTimeout(r, 2500));
      await showAllMediaPanel(page).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await waitForGalleryQuiescent(page, 30_000);
      } catch {
        // best-effort
      }
      await scrollGalleryFully(page);

      const imageTiles = await findImageTilesWithSrc(page);
      const videoTiles = await findVideoTilesWithSrc(page);
      const allTiles = [
        ...imageTiles.map((t) => ({ ...t, isVideo: false })),
        ...videoTiles.map((t) => ({ ...t, isVideo: true })),
      ];
      console.log(
        `  [${storySlug}] gallery: ${imageTiles.length} image(s), ${videoTiles.length} video(s)`,
      );

      const storyline = await loadStorylineCache(storySlug);
      const storyTitle = storyline?.title ?? deriveTitle(storySlug);
      console.log(
        `  [${storySlug}] story title: "${storyTitle}" (${storyline?.title ? "from storyline cache" : "derived from slug"})`,
      );

      // Build the gallery map (used for prompt-prefix lookups for images
      // that don't have a flowUrl recorded). The map keys tiles by their
      // visible display name and by `__id__:<assetId>`.
      const galleryByName = await scanProjectAssetsByDisplayName(page, 32);

      for (const item of items) {
        const parsed = parseRegistryKey(item.registryKey);
        if (!parsed) {
          console.warn(`    skipping ${item.registryKey}: unparseable`);
          continue;
        }
        const ext =
          parsed.kind === "video" || parsed.kind === "clip" ? "mp4" : "png";
        const canonicalKind =
          parsed.kind === "clip" ? "video" : parsed.kind;
        // Prefer the existing registry record's flowDisplayName — it's the
        // exact canonical the original run computed (with proper casing for
        // articles like "and"/"the"). Fall back to re-deriving from the
        // slug only if no record exists.
        const existingRec = (reg.stories?.[storySlug]?.[item.registryKey] ?? null) as
          | { flowDisplayName?: string; filename?: string }
          | null;
        const fallback = buildAssetName({
          storyTitle,
          storySlug,
          kind: canonicalKind,
          index: parsed.index,
          sceneSlug: parsed.sceneSlug,
          ext,
        });
        const name = {
          ...fallback,
          flowDisplayName: existingRec?.flowDisplayName ?? fallback.flowDisplayName,
          filename: existingRec?.filename ?? fallback.filename,
        };
        let renamed = false;

        // STRATEGY A — by URL `name=<assetId>` (videos, sometimes images).
        for (const url of item.urls.slice().reverse()) {
          const assetId = extractAssetIdFromUrl(url);
          if (!assetId) continue;
          const tile = allTiles.find((t) => t.src.includes(`name=${assetId}`));
          if (!tile) {
            console.log(
              `    ${item.registryKey}: assetId=${assetId.slice(0, 8)} not in gallery (URL signature may have rotated)`,
            );
            continue;
          }
          console.log(
            `    ${item.registryKey}: by URL → tile @${tile.rect.x},${tile.rect.y} (${tile.isVideo ? "video" : "image"}); renaming → "${name.flowDisplayName}"`,
          );
          try {
            await renameAndVerify(page, tile.rect, name.flowDisplayName, 3);
            console.log(`    ✓ renamed`);
            renamed = true;
            try {
              await recordAsset({
                storySlug: name.storySlug,
                kind: name.kind,
                index: name.index,
                sceneSlug: name.sceneSlug,
                filename: name.filename,
                flowDisplayName: name.flowDisplayName,
                localPath: "",
                flowUrl: url,
              });
            } catch {
              // best-effort
            }
            break;
          } catch (e) {
            console.warn(`    ✗ rename failed: ${(e as Error).message.slice(0, 200)}`);
          }
        }

        // STRATEGY B — prompt-prefix rescue for images without a flowUrl.
        // Look up the prompt this slot was generated from in the storyline
        // cache, then find a gallery tile whose visible name contains the
        // prompt's prefix (Flow's default auto-name when our rename
        // missed). Skip if STRATEGY A already succeeded.
        if (!renamed && (parsed.kind === "image" || parsed.kind === "character")) {
          let prompt: string | undefined;
          if (parsed.kind === "character") {
            prompt = storyline?.characterPrompt;
          } else {
            const ip = (storyline?.imagePrompts ?? []).find(
              (x) =>
                x.title === parsed.sceneSlug ||
                (parsed.index > 0 && (storyline?.imagePrompts ?? [])[parsed.index - 1] === x),
            );
            prompt = ip?.prompt;
          }
          if (prompt) {
            const tile = findImageTileByPromptPrefix(galleryByName, prompt);
            if (tile) {
              console.log(
                `    ${item.registryKey}: by prompt-prefix → "${tile.displayName.slice(0, 60)}…" @${tile.rect.x},${tile.rect.y}; renaming → "${name.flowDisplayName}"`,
              );
              try {
                await renameAndVerify(page, tile.rect, name.flowDisplayName, 3);
                console.log(`    ✓ renamed`);
                renamed = true;
              } catch (e) {
                console.warn(
                  `    ✗ rename failed: ${(e as Error).message.slice(0, 200)}`,
                );
              }
            } else {
              console.log(
                `    ${item.registryKey}: no gallery tile matched the prompt prefix (already renamed elsewhere or missing)`,
              );
            }
          } else {
            console.log(`    ${item.registryKey}: no prompt available in storyline cache`);
          }
        }

        if (renamed) {
          await clearOrphanedFlowUrls(storySlug, item.registryKey);
        }
      }
    }
    console.log("\nDone.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("[rename-orphans] fatal:", e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
