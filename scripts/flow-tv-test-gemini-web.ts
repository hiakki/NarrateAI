// One-off dry-run for the Gemini-web storyline path. Does NOT touch Flow,
// does NOT enqueue a run, and burns ZERO Veo credits — it only opens
// gemini.google.com/app and verifies we can drive the chat and parse a JSON
// storyline back.
//
// Variety hints (avoidTitles / avoidArchetypes / bannedCategories) are
// computed from the cached storylines in `data/flow-tv/storylines/` so the
// test reflects what a real run would feed Gemini.
//
// Run with:
//   npx tsx scripts/flow-tv-test-gemini-web.ts
//
// Optional env:
//   FLOW_TV_HEADLESS=true  -> run silently (default false: visible window)
//   GEMINI_WEB_NICHE=funny|moral|horror|mythological|zero-to-hero
//   GEMINI_WEB_LANGUAGE=hindi|english
//   GEMINI_WEB_IMAGES=2..12
//   GEMINI_WEB_STYLE=cartoon_3d|hyperreal_3d|photoreal
//   GEMINI_WEB_OUT=path/to/output.json  -> save the parsed storyline here

import { promises as fs } from "fs";
import path from "path";
import { generateStorylineViaWeb } from "../src/services/flow-tv-gemini-web";
import { buildVarietyHintsForNiche } from "../src/services/flow-tv-phase1";
import type { StorylineBuildOpts } from "../src/services/flow-tv-prompts";
import type { FlowNiche } from "../src/services/flow-tv-run";

function envEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = (process.env[key] ?? "").toLowerCase().trim() as T;
  return (allowed as readonly string[]).includes(v) ? v : fallback;
}

function clip(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n) + "…";
}

async function main(): Promise<void> {
  const niche = envEnum(
    "GEMINI_WEB_NICHE",
    ["funny", "moral", "horror", "mythological", "zero-to-hero"] as const,
    "funny",
  );
  const language = envEnum(
    "GEMINI_WEB_LANGUAGE",
    ["hindi", "english"] as const,
    "hindi",
  );
  const characterStyle = envEnum(
    "GEMINI_WEB_STYLE",
    ["cartoon_3d", "hyperreal_3d", "photoreal"] as const,
    "cartoon_3d",
  );
  const imageCount = Math.max(
    2,
    Math.min(12, Number(process.env.GEMINI_WEB_IMAGES ?? "3") || 3),
  );

  // Pull variety hints from prior cached storylines for this niche so the
  // test matches a real run's avoid-list & banned-category set.
  const hints = await buildVarietyHintsForNiche(niche as FlowNiche, 6).catch(
    () => ({ avoidTitles: [], avoidArchetypes: [], bannedCategories: [] }),
  );

  const opts: StorylineBuildOpts = {
    imageCount,
    niche,
    language,
    characterStyle,
    aspectRatio: "9:16",
    dialogue: true,
    bgm: true,
    sfx: true,
    storyTitleHint: undefined,
    avoidTitles: hints.avoidTitles,
    avoidArchetypes: hints.avoidArchetypes,
    bannedCategories: hints.bannedCategories,
  };

  console.log("[flow-tv-test-gemini-web] options:", {
    ...opts,
    avoidTitles: hints.avoidTitles,
    avoidArchetypes: hints.avoidArchetypes,
    bannedCategories: hints.bannedCategories,
  });
  console.log("[flow-tv-test-gemini-web] starting browser…");

  const t0 = Date.now();
  const { partial, modelUsed } = await generateStorylineViaWeb(opts);
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(
    `\n[flow-tv-test-gemini-web] OK in ${elapsedSec}s; model=${modelUsed ?? "default"}`,
  );
  console.log("═".repeat(78));
  console.log(`niche:       ${niche}    language: ${language}    style: ${characterStyle}`);
  console.log(`title:       ${partial.title}`);
  console.log(`logline:     ${partial.logline}`);
  console.log(`protagonist: ${clip(partial.protagonist, 220)}`);
  console.log(`character:   ${clip(partial.characterPrompt, 220)}`);

  if (partial.supportingCast && partial.supportingCast.length > 0) {
    console.log(`\nsupportingCast (${partial.supportingCast.length}):`);
    for (const c of partial.supportingCast) {
      console.log(`  · ${c.name} [${c.role}]`);
      console.log(`      ${clip(c.description, 200)}`);
    }
  } else {
    console.log("\nsupportingCast: <none — Gemini did not declare any!>");
  }

  console.log(`\nscenes (${partial.imagePrompts.length}):`);
  for (let i = 0; i < partial.imagePrompts.length; i++) {
    const p = partial.imagePrompts[i];
    console.log(`  [${i + 1}] ${p.title}`);
    console.log(`      prompt:   ${clip(p.prompt, 200)}`);
    if (p.dialogues && p.dialogues.length > 0) {
      console.log(`      dialogues (${p.dialogues.length}):`);
      const speakers = new Set(p.dialogues.map((d) => d.speaker));
      for (const d of p.dialogues) {
        console.log(`        ${d.speaker}: ${d.lineHi}`);
        if (d.lineRoman && d.lineRoman !== d.lineHi) {
          console.log(`           (${d.lineRoman})`);
        }
      }
      if (speakers.size === 1) {
        console.log(`        ⚠️  only one speaker in this scene`);
      }
    } else if (p.dialogueHi || p.dialogueRoman) {
      console.log(
        `      dialogue (legacy single-line): ${p.dialogueHi}  /  ${p.dialogueRoman}`,
      );
    }
    if (p.bgmCue) console.log(`      bgm:      ${p.bgmCue}`);
    if (p.sfxCue) console.log(`      sfx:      ${p.sfxCue}`);
  }
  console.log("═".repeat(78));

  // Self-check summary
  const totalScenes = partial.imagePrompts.length;
  const scenesWithDialogues = partial.imagePrompts.filter(
    (p) => p.dialogues && p.dialogues.length > 0,
  ).length;
  const scenesMultiSpeaker = partial.imagePrompts.filter((p) => {
    if (!p.dialogues || p.dialogues.length === 0) return false;
    const set = new Set(p.dialogues.map((d) => d.speaker));
    return set.size >= 2;
  }).length;
  const supportingCount = partial.supportingCast?.length ?? 0;

  console.log("[flow-tv-test-gemini-web] self-check:");
  console.log(
    `  supportingCast count:           ${supportingCount} ${supportingCount >= 1 ? "✓" : "✗"}`,
  );
  console.log(
    `  scenes with dialogues[]:        ${scenesWithDialogues} / ${totalScenes} ${
      scenesWithDialogues === totalScenes ? "✓" : "✗"
    }`,
  );
  console.log(
    `  scenes with 2+ distinct speakers: ${scenesMultiSpeaker} / ${totalScenes} ${
      scenesMultiSpeaker >= Math.ceil(totalScenes * 0.6) ? "✓" : "✗ (target ≥60%)"
    }`,
  );

  // Optionally write the full parsed storyline to disk so the user can
  // inspect/share it without re-running the browser.
  const outPath = process.env.GEMINI_WEB_OUT
    ? path.resolve(process.env.GEMINI_WEB_OUT)
    : path.resolve(
        `data/flow-tv/storyline-tests/${niche}-${imageCount}sc-${Date.now()}.json`,
      );
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    JSON.stringify({ modelUsed, opts, hints, storyline: partial }, null, 2),
    "utf-8",
  );
  console.log(`\nstoryline saved → ${outPath}`);
  console.log("[flow-tv-test-gemini-web] PASS");
}

main().catch((err) => {
  console.error("[flow-tv-test-gemini-web] FAIL:", err);
  console.error(
    "Screenshots (if any) at: data/flow-tv/gemini-web-debug/  — inspect to see why a selector failed.",
  );
  process.exit(1);
});
