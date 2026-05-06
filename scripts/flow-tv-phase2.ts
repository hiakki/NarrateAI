// Standalone Phase 2 runner. Picks the latest Phase-1 run dir, generates
// `clipCount` chained Veo clips (default 2), then stitches them.
//
// Usage:
//   pnpm tsx scripts/flow-tv-phase2.ts                  # 2 clips, Veo Lite
//   pnpm tsx scripts/flow-tv-phase2.ts 2 Lite           # explicit
//   pnpm tsx scripts/flow-tv-phase2.ts 2 Fast           # cheaper-but-richer
//   FLOW_TV_HEADLESS=true pnpm tsx scripts/flow-tv-phase2.ts
//
// You can pin a specific Phase-1 source dir via env:
//   FLOW_TV_PHASE1_RUN=data/flow-tv/runs/2026-04-26T04-50-28-187Z-imgs3 \
//     pnpm tsx scripts/flow-tv-phase2.ts

import "dotenv/config";

async function main() {
  const argClips = parseInt(process.argv[2] ?? "2", 10);
  const clipCount = Number.isFinite(argClips) ? Math.max(1, Math.min(argClips, 4)) : 2;
  const argVariant = (process.argv[3] ?? process.env.FLOW_TV_VEO_VARIANT ?? "Lite").trim();
  const veoVariant = (argVariant === "Fast" || argVariant === "Quality" ? argVariant : "Lite") as "Lite" | "Fast" | "Quality";
  const sourceRunDir = process.env.FLOW_TV_PHASE1_RUN || undefined;
  // Standalone runners require a storySlug + projectName. If not provided
  // explicitly, derive them from the most-recent storyline cache so this
  // script "just works" against whatever Phase 1 last ran.
  const fs = await import("fs/promises");
  const fsSync = await import("fs");
  const path = await import("path");
  const { STORYLINES_DIR } = await import("../src/services/flow-tv-phase1");
  const { dateSuffixedSlug, flowProjectNameFromStorySlug } = await import(
    "../src/services/flow-tv-naming"
  );
  let storySlug = process.env.FLOW_TV_STORY_SLUG ?? "";
  if (!storySlug) {
    if (fsSync.existsSync(STORYLINES_DIR)) {
      const files = await fs.readdir(STORYLINES_DIR);
      const json = files.filter((f) => f.endsWith(".json"));
      if (json.length === 0) {
        throw new Error(
          "No cached storylines under data/flow-tv/storylines/. Run Phase 1 first or set FLOW_TV_STORY_SLUG.",
        );
      }
      let newest = json[0];
      let newestMtime = 0;
      for (const f of json) {
        const stat = await fs.stat(path.join(STORYLINES_DIR, f));
        if (stat.mtimeMs > newestMtime) {
          newestMtime = stat.mtimeMs;
          newest = f;
        }
      }
      storySlug = newest.replace(/\.json$/, "");
    } else {
      throw new Error(
        "data/flow-tv/storylines/ does not exist — run Phase 1 first or set FLOW_TV_STORY_SLUG.",
      );
    }
  }
  void dateSuffixedSlug; // re-exported for ad-hoc use; not needed here
  const projectName =
    process.env.FLOW_TV_PROJECT_NAME ?? flowProjectNameFromStorySlug(storySlug);

  console.log("─".repeat(72));
  console.log(` Flow TV — Phase 2 runner (chained Veo clips)`);
  console.log(`   clipCount    : ${clipCount}`);
  console.log(`   veoVariant   : Veo 3.1 - ${veoVariant}`);
  console.log(`   storySlug    : ${storySlug}`);
  console.log(`   projectName  : ${projectName}`);
  console.log(`   sourceRunDir : ${sourceRunDir ?? "(latest Phase-1 run)"}`);
  console.log(`   headless     : ${process.env.FLOW_TV_HEADLESS ?? "false"} (visible by default)`);
  console.log("─".repeat(72));

  const { runPhase2, getPhase2Progress } = await import("../src/services/flow-tv-phase2");

  let lastStatus = "";
  const ticker = setInterval(() => {
    const p = getPhase2Progress();
    if (!p) return;
    const line = `[${new Date().toISOString().slice(11, 19)}] ${p.status.padEnd(22)} | ${p.message} (${p.clipsDone}/${p.clipCount})`;
    if (line !== lastStatus) {
      console.log(line);
      lastStatus = line;
    }
  }, 1000);

  try {
    const result = await runPhase2({
      storySlug,
      projectName,
      clipCount,
      veoVariant,
      sourceRunDir,
    });
    clearInterval(ticker);
    console.log("─".repeat(72));
    console.log(` Final status   : ${result.status}`);
    console.log(` Message        : ${result.message}`);
    if (result.runDir) console.log(` Run dir        : ${result.runDir}`);
    if (result.sourceRunDir) console.log(` Source Phase-1 : ${result.sourceRunDir}`);
    if (result.clipPaths.length > 0) {
      console.log(` Clips          :`);
      for (const p of result.clipPaths) console.log(`                 ${p}`);
    }
    if (result.finalVideoPath) console.log(` Final stitched : ${result.finalVideoPath}`);
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
