// One-shot migrator: rename legacy `character-NN-*.png`, `image-NN-*.png`,
// `clip-NN-*.mp4`, `story-*.mp4` files in every run dir to the canonical
// `<story-slug>-<kind>-NN[-<sceneSlug>].<ext>` convention, and seed the
// asset registry from the storyline.
//
// Also pre-populates the URL graveyard with any Veo URLs we previously
// generated but failed to download (so Phase 2 retries those before burning
// new credits).
//
// Run with:
//   pnpm tsx scripts/flow-tv-migrate-names.ts
//
// Add additional orphan URLs to seed via env, comma separated:
//   FLOW_TV_ORPHAN_VIDEO_01_URLS="https://...A,https://...B" pnpm tsx ...
//   FLOW_TV_ORPHAN_VIDEO_02_URLS="https://..." pnpm tsx ...

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import {
  FLOW_DATA_DIR,
  buildAssetName,
  migrateRunDir,
  rememberOrphanedFlowUrl,
  slug as slugify,
} from "../src/services/flow-tv-naming";

interface Storyline {
  title: string;
  protagonist: string;
  characterPrompt: string;
  imagePrompts: Array<{ title: string; prompt: string }>;
}

async function loadStoryline(): Promise<Storyline | null> {
  const file = path.join(FLOW_DATA_DIR, "storyline.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as Storyline;
  } catch {
    return null;
  }
}

async function main() {
  console.log("─".repeat(72));
  console.log(` Flow TV — asset name migrator`);
  console.log(`   data dir : ${FLOW_DATA_DIR}`);
  console.log("─".repeat(72));

  const storyline = await loadStoryline();
  if (!storyline) {
    console.log("No storyline cache; nothing to migrate.");
    return;
  }
  const storySlug = slugify(storyline.title, 50);
  console.log(` Story    : "${storyline.title}"`);
  console.log(` Slug     : ${storySlug}`);

  const runsDir = path.join(FLOW_DATA_DIR, "runs");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    entries = [];
  }
  let totalMoves = 0;
  for (const e of entries.sort()) {
    const dir = path.join(runsDir, e);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const moves = await migrateRunDir(dir, storyline.title);
    if (moves.length === 0) continue;
    console.log(`\n ▸ ${e}`);
    for (const m of moves) {
      console.log(`     ${m.from}  →  ${m.to}`);
    }
    totalMoves += moves.length;
  }
  console.log(`\n Total renames: ${totalMoves}`);

  // Seed the URL graveyard. We always remember the two Veo clip-01 URLs that
  // were generated during recent dry-runs and never downloaded (so Phase 2
  // retries them before submitting Veo for clip-01 a third time).
  const SEEDED_CLIP_01_URLS = [
    "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=0af5642f-47d4-4904-b9a2-1abbf0354c26",
    "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=c47f014f-586c-4ec9-8b66-beb461df17fd",
  ];

  // Build the registry keys for clip-01 and clip-02 to seed against.
  const seedClip = async (clipIndex: number, urls: string[]) => {
    if (urls.length === 0 || !storyline) return;
    const start = storyline.imagePrompts[clipIndex - 1]?.title;
    const end = storyline.imagePrompts[clipIndex]?.title;
    if (!start || !end) {
      console.log(`   (skip clip-${clipIndex}: storyline missing scene title)`);
      return;
    }
    const sceneSlug = `${slugify(start)}-to-${slugify(end)}`;
    const name = buildAssetName({
      storyTitle: storyline.title,
      kind: "video",
      index: clipIndex,
      sceneSlug,
      ext: "mp4",
    });
    for (const u of urls) {
      await rememberOrphanedFlowUrl(name.storySlug, name.registryKey, u.trim());
      console.log(`   seeded URL for ${name.registryKey}: ${u.slice(0, 80)}…`);
    }
  };

  const envClip01 = (process.env.FLOW_TV_ORPHAN_VIDEO_01_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const envClip02 = (process.env.FLOW_TV_ORPHAN_VIDEO_02_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`\n Seeding URL graveyard:`);
  await seedClip(1, [...SEEDED_CLIP_01_URLS, ...envClip01]);
  await seedClip(2, envClip02);

  console.log("\nMigration complete.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(2);
});
