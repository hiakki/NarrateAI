// Flow TV — subtitle burn-in.
//
// When a run has dialogue=true and subtitles=true, we burn the romanized
// dialogue text on top of the stitched final MP4 using ffmpeg's `subtitles`
// filter driving an SRT file we generate from per-clip durations + the
// storyline's per-scene `dialogueRoman` strings.
//
// Romanized output is intentional — it keeps us font-agnostic. Arial is
// universally available on macOS and most Linux distros via fontconfig; if
// it's missing, ffmpeg falls back to its default sans-serif.
//
// The burned MP4 is written next to the source as `<basename>-subbed.mp4`
// and returned. Caller is responsible for swapping `run.finalVideoPath` to
// the subbed file.

import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createLogger } from "@/lib/logger";
import type { Storyline } from "@/services/flow-tv-phase1";

const log = createLogger("FlowTV:Subtitles");
const execFileAsync = promisify(execFile);

interface ProbeMeta {
  durationSec: number;
}

async function probeDuration(filePath: string): Promise<ProbeMeta> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const dur = parseFloat(stdout.trim());
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(`ffprobe returned invalid duration for ${filePath}: ${stdout}`);
  }
  return { durationSec: dur };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function srtTimestamp(totalMs: number): string {
  const ms = Math.max(0, Math.round(totalMs));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(milli)}`;
}

/**
 * Build a SubRip (.srt) string from clip durations + per-clip subtitle text.
 *
 * Each clip becomes a single subtitle entry that spans the entire clip. We
 * leave a small (60ms) gap between entries so players don't briefly stack
 * two subtitles on the boundary.
 */
export function buildSrt(
  entries: Array<{ durationSec: number; text: string }>,
): string {
  const out: string[] = [];
  let cursorMs = 0;
  let idx = 1;
  for (const e of entries) {
    if (!e.text || e.text.trim().length === 0) {
      // Still advance the cursor so subsequent timings stay correct.
      cursorMs += Math.round(e.durationSec * 1000);
      continue;
    }
    const startMs = cursorMs;
    const endMs = cursorMs + Math.round(e.durationSec * 1000) - 60;
    out.push(String(idx));
    out.push(`${srtTimestamp(startMs)} --> ${srtTimestamp(Math.max(startMs + 200, endMs))}`);
    // SRT lets us split long lines with a literal newline; we keep one line.
    out.push(e.text.trim());
    out.push("");
    cursorMs += Math.round(e.durationSec * 1000);
    idx += 1;
  }
  return out.join("\n");
}

/**
 * ffmpeg subtitles-filter `force_style` snippet. Romanized output → Arial is
 * fine; we only need a readable, mobile-shorts-friendly style.
 *
 * Style ref: https://aegisub.org/docs/3.2/ASS_Tags/
 */
function forceStyle(): string {
  return [
    "FontName=Arial",
    "FontSize=22",
    "PrimaryColour=&H00FFFFFF",
    "OutlineColour=&H80000000",
    "BorderStyle=1",
    "Outline=2",
    "Shadow=0",
    "Alignment=2", // bottom-center
    "MarginV=80",
  ].join(",");
}

export interface BurnSubtitlesOpts {
  /** Source MP4 (the stitched final video). */
  finalMp4Path: string;
  /** Phase-2 run dir; we drop the .srt + subbed mp4 here. */
  runDir: string;
  /** Per-clip MP4 paths in chain order; durations are probed from each. */
  clipPaths: string[];
  /** Storyline (carries per-scene dialogueRoman). */
  storyline: Storyline;
}

/**
 * Generate an SRT alongside the final MP4 and return the burned-in mp4 path.
 *
 * Returns `null` if there's nothing to burn (no dialogue text on any scene)
 * — caller can then leave finalVideoPath untouched.
 */
export async function burnSubtitles(
  opts: BurnSubtitlesOpts,
): Promise<string | null> {
  if (!fsSync.existsSync(opts.finalMp4Path)) {
    throw new Error(`burnSubtitles: missing final mp4 ${opts.finalMp4Path}`);
  }
  if (opts.clipPaths.length === 0) {
    log.warn("burnSubtitles: no clipPaths provided — skipping");
    return null;
  }

  // Each clip-N maps to imagePrompts[N] (the END scene of the chained pair),
  // because the clip lands on that scene's emotional pay-off. Falls back to
  // imagePrompts[N-1] if the end scene has no dialogue.
  const entries: Array<{ durationSec: number; text: string }> = [];
  for (let i = 0; i < opts.clipPaths.length; i++) {
    const clipPath = opts.clipPaths[i];
    if (!fsSync.existsSync(clipPath)) {
      log.warn(`burnSubtitles: missing clip ${clipPath} — skipping (will skew timing!)`);
      entries.push({ durationSec: 8, text: "" });
      continue;
    }
    const { durationSec } = await probeDuration(clipPath);
    const endScene = opts.storyline.imagePrompts[i + 1];
    const startScene = opts.storyline.imagePrompts[i];
    const text =
      (endScene?.dialogueRoman ?? "").trim() ||
      (startScene?.dialogueRoman ?? "").trim() ||
      "";
    entries.push({ durationSec, text });
  }

  const hasAnyText = entries.some((e) => e.text.length > 0);
  if (!hasAnyText) {
    log.warn("burnSubtitles: no romanized dialogue text on any clip — skipping");
    return null;
  }

  const srt = buildSrt(entries);
  const srtPath = path.join(opts.runDir, "final.srt");
  await fs.writeFile(srtPath, srt, "utf-8");
  log.log(
    `wrote ${srt.split("\n\n").filter(Boolean).length} subtitle entries → ${srtPath}`,
  );

  // Build the subbed MP4 path next to the source.
  const dir = path.dirname(opts.finalMp4Path);
  const stem = path.basename(opts.finalMp4Path, path.extname(opts.finalMp4Path));
  const subbedPath = path.join(dir, `${stem}-subbed.mp4`);

  // ffmpeg subtitles filter requires ffmpeg-escaped paths inside the filter
  // graph. Single quotes around the path + escape any single quotes in the
  // path itself. We also escape colons (filter graph delimiter).
  const filterPath = srtPath.replace(/\\/g, "/").replace(/'/g, "\\'").replace(/:/g, "\\:");
  const filter = `subtitles='${filterPath}':force_style='${forceStyle()}'`;

  log.log(`ffmpeg subtitles burn → ${subbedPath}`);
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        opts.finalMp4Path,
        "-vf",
        filter,
        "-c:a",
        "copy",
        subbedPath,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`ffmpeg subtitles burn FAILED: ${msg.slice(0, 600)}`);
    throw new Error(`Subtitles burn failed: ${msg.slice(0, 200)}`);
  }
  if (!fsSync.existsSync(subbedPath)) {
    throw new Error(`Subtitles burn produced no output at ${subbedPath}`);
  }
  return subbedPath;
}
