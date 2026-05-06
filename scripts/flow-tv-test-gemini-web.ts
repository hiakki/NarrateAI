// One-off dry-run for the Gemini-web storyline path. Does NOT touch Flow,
// does NOT enqueue a run, and burns ZERO Veo credits — it only opens
// gemini.google.com/app and verifies we can drive the chat and parse a JSON
// storyline back.
//
// Run with:
//   npx tsx scripts/flow-tv-test-gemini-web.ts
//
// Optional env:
//   FLOW_TV_HEADLESS=true  -> run silently (default false: visible window)
//   GEMINI_WEB_NICHE=funny|moral|horror|mythological|zero-to-hero
//   GEMINI_WEB_LANGUAGE=hindi|english
//   GEMINI_WEB_IMAGES=2..12

import { generateStorylineViaWeb } from "../src/services/flow-tv-gemini-web";
import type { StorylineBuildOpts } from "../src/services/flow-tv-prompts";

function envEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = (process.env[key] ?? "").toLowerCase().trim() as T;
  return (allowed as readonly string[]).includes(v) ? v : fallback;
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
  const imageCount = Math.max(
    2,
    Math.min(12, Number(process.env.GEMINI_WEB_IMAGES ?? "3") || 3),
  );

  const opts: StorylineBuildOpts = {
    imageCount,
    niche,
    language,
    characterStyle: "cartoon_3d",
    aspectRatio: "9:16",
    dialogue: true,
    bgm: true,
    sfx: true,
    storyTitleHint: undefined,
  };

  console.log("[flow-tv-test-gemini-web] options:", opts);
  console.log("[flow-tv-test-gemini-web] starting browser…");

  const t0 = Date.now();
  const { partial, modelUsed } = await generateStorylineViaWeb(opts);
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(
    `\n[flow-tv-test-gemini-web] OK in ${elapsedSec}s; model=${modelUsed ?? "default"}`,
  );
  console.log("─".repeat(78));
  console.log(`title:      ${partial.title}`);
  console.log(`logline:    ${partial.logline}`);
  console.log(`protagonist:${partial.protagonist.slice(0, 120)}…`);
  console.log(`character:  ${partial.characterPrompt.slice(0, 120)}…`);
  console.log(`scenes:     ${partial.imagePrompts.length}`);
  for (let i = 0; i < partial.imagePrompts.length; i++) {
    const p = partial.imagePrompts[i];
    console.log(
      `  [${i + 1}] ${p.title}\n      prompt:   ${p.prompt.slice(0, 110)}…`,
    );
    if (p.dialogueHi || p.dialogueRoman) {
      console.log(`      dialogue: ${p.dialogueHi}  /  ${p.dialogueRoman}`);
    }
    if (p.bgmCue) console.log(`      bgm:      ${p.bgmCue}`);
    if (p.sfxCue) console.log(`      sfx:      ${p.sfxCue}`);
  }
  console.log("─".repeat(78));
  console.log("[flow-tv-test-gemini-web] PASS");
}

main().catch((err) => {
  console.error("[flow-tv-test-gemini-web] FAIL:", err);
  console.error(
    "Screenshots (if any) at: data/flow-tv/gemini-web-debug/  — inspect to see why a selector failed.",
  );
  process.exit(1);
});
