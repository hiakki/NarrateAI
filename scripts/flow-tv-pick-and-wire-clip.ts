// One-shot: pick a downloaded gallery-video-NN.mp4 and wire it as the
// canonical clip-NN.mp4 for a given Flow TV run. Updates the asset registry
// and the run state's clipPaths. NEVER touches Flow TV's UI.
//
// Usage:
//   npx tsx scripts/flow-tv-pick-and-wire-clip.ts <runId> <galleryIdx> <clipIdx>
//
//   <runId>       Flow TV run UUID
//   <galleryIdx>  1-based index of the source file (gallery-video-01.mp4 = 1)
//   <clipIdx>     1-based clip slot to fill (clip-01 = 1)

import "dotenv/config";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { loadRun, saveRun } from "@/services/flow-tv-run";
import { recordAsset, buildAssetName } from "@/services/flow-tv-naming";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const runId = process.argv[2];
  const galleryIdxArg = parseInt(process.argv[3] ?? "0", 10);
  const clipIdxArg = parseInt(process.argv[4] ?? "0", 10);

  if (!runId || !galleryIdxArg || !clipIdxArg) {
    console.error("Usage: tsx scripts/flow-tv-pick-and-wire-clip.ts <runId> <galleryIdx> <clipIdx>");
    process.exit(2);
  }

  const run = await loadRun(runId);
  if (!run || !run.storySlug || !run.storyline) throw new Error(`Run not found / incomplete: ${runId}`);

  const phase2Dir = run.phase2RunDir ?? path.join(run.runDir, "phase2");
  const sourcePath = path.join(
    phase2Dir,
    `gallery-video-${String(galleryIdxArg).padStart(2, "0")}.mp4`,
  );
  if (!fsSync.existsSync(sourcePath)) throw new Error(`Source mp4 missing: ${sourcePath}`);

  // Validate it's a real mp4.
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    sourcePath,
  ]);
  const meta = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const v = (meta.streams ?? []).find((s) => s.codec_type === "video");
  if (!v) throw new Error(`Source has no video stream: ${sourcePath}`);
  const durSec = parseFloat(meta.format?.duration ?? "0");
  if (!Number.isFinite(durSec) || durSec < 1) throw new Error(`Source duration too short: ${durSec}s`);
  console.log(
    `Source: ${sourcePath}  (${v.width}x${v.height}, ${durSec.toFixed(2)}s, ${fsSync.statSync(sourcePath).size}B)`,
  );

  // Compute canonical clip name.
  const storyline = run.storyline;
  const startTitle = storyline.imagePrompts[clipIdxArg - 1]?.title ?? `scene-${clipIdxArg}`;
  const endTitle = storyline.imagePrompts[clipIdxArg]?.title ?? `scene-${clipIdxArg + 1}`;
  const sceneSlug = `${startTitle}-to-${endTitle}`;
  const name = buildAssetName({
    storyTitle: storyline.title,
    storySlug: run.storySlug,
    kind: "video",
    index: clipIdxArg,
    sceneSlug,
    ext: "mp4",
  });
  const destPath = path.join(phase2Dir, name.filename);
  console.log(`Dest:   ${destPath}`);
  console.log(`Display: "${name.flowDisplayName}"`);

  if (fsSync.existsSync(destPath)) {
    console.log(`(replacing existing ${destPath})`);
    await fs.unlink(destPath);
  }
  await fs.copyFile(sourcePath, destPath);

  await recordAsset({
    storySlug: run.storySlug,
    kind: "video",
    index: clipIdxArg,
    sceneSlug,
    filename: name.filename,
    flowDisplayName: name.flowDisplayName,
    localPath: destPath,
    // No flowUrl: the original CDN signature has expired; the registry's
    // flowUrl field is best-effort and doesn't affect downstream finalize.
  });

  if (!run.clipPaths) run.clipPaths = [];
  run.clipPaths[clipIdxArg - 1] = destPath;
  run.lastMessage = `Wired gallery-video-${String(galleryIdxArg).padStart(2, "0")} → clip-${String(clipIdxArg).padStart(2, "0")}`;
  run.events.push({
    ts: Date.now(),
    stage: run.stage,
    level: "info",
    message: `Operator wired ${path.basename(sourcePath)} → ${name.filename} for clip-${clipIdxArg}`,
  });
  await saveRun(run);
  console.log("\nDone. Run state + asset registry updated.");
}

main().catch((e) => {
  console.error("[wire] fatal:", e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
