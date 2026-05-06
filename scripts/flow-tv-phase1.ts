// Standalone Phase 1 runner. Bypasses Next.js auth so we can validate
// end-to-end without logging into the dashboard. Reads .env automatically.
//
// Usage:
//   pnpm tsx scripts/flow-tv-phase1.ts             # 3 images (default)
//   pnpm tsx scripts/flow-tv-phase1.ts 2           # 2 images
//   FLOW_TV_HEADLESS=true pnpm tsx scripts/flow-tv-phase1.ts  # invisible

import "dotenv/config";

async function main() {
  const argCount = parseInt(process.argv[2] ?? "3", 10);
  const imageCount = Number.isFinite(argCount) ? Math.max(1, Math.min(argCount, 5)) : 3;

  // Build a synthetic storySlug for standalone testing. Real Flow TV runs
  // get this from the run-machine; for the standalone script we pre-generate
  // a storyline (or load the most recent cached one) and derive the slug.
  const { dateSuffixedSlug, flowProjectNameFromStorySlug } = await import(
    "../src/services/flow-tv-naming"
  );
  const standaloneTitle =
    process.env.FLOW_TV_STORY_TITLE ?? "Standalone Phase 1 Test";
  const storySlug = dateSuffixedSlug(standaloneTitle);
  const projectName = flowProjectNameFromStorySlug(storySlug);

  console.log("─".repeat(72));
  console.log(` Flow TV — Phase 1 runner`);
  console.log(`   imageCount   : ${imageCount}`);
  console.log(`   storySlug    : ${storySlug}`);
  console.log(`   projectName  : ${projectName}`);
  console.log(`   FLOW_TV_HEADLESS=${process.env.FLOW_TV_HEADLESS ?? "false"} (visible by default)`);
  console.log("─".repeat(72));

  const { runPhase1, getPhase1Progress } = await import("../src/services/flow-tv-phase1");

  let lastStatus = "";
  const ticker = setInterval(() => {
    const p = getPhase1Progress();
    if (!p) return;
    const line = `[${new Date().toISOString().slice(11, 19)}] ${p.status.padEnd(20)} | ${p.message} (${p.imagesDone}/${p.imageCount})`;
    if (line !== lastStatus) {
      console.log(line);
      lastStatus = line;
    }
  }, 1000);

  try {
    const result = await runPhase1({ imageCount, storySlug, projectName });
    clearInterval(ticker);
    console.log("─".repeat(72));
    console.log(` Final status: ${result.status}`);
    console.log(` Message    : ${result.message}`);
    if (result.runDir) console.log(` Run dir    : ${result.runDir}`);
    if (result.storyline) {
      console.log(` Storyline  : "${result.storyline.title}"`);
      console.log(`              ${result.storyline.logline}`);
      console.log(`              Protagonist: ${result.storyline.protagonist}`);
    }
    if (result.project) {
      console.log(` Project    : ${result.project.projectName}`);
      console.log(`              ${result.project.projectUrl}`);
    }
    if (result.characterPath) {
      console.log(` Character  : ${result.characterPath}`);
    }
    if (result.imagePaths.length > 0) {
      console.log(` Scenes     :`);
      for (const p of result.imagePaths) console.log(`              ${p}`);
    }
    console.log("─".repeat(72));
    if (result.status !== "done") process.exitCode = 1;
  } catch (e) {
    clearInterval(ticker);
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    console.error("FAILED:", msg);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error("UNCAUGHT:", e);
  process.exit(3);
});
