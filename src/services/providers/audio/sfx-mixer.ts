/**
 * Combines per-scene SFX clips into a single time-aligned audio track
 * that can be mixed into the final video alongside narration and BGM.
 */

import { spawn } from "child_process";
import { createLogger } from "@/lib/logger";

const log = createLogger("SFXMixer");

export interface SfxMixerInput {
  sfxPaths: (string | null)[];
  sceneTimings: { startMs: number; endMs: number }[];
  totalDurationMs: number;
  outputPath: string;
}

/**
 * Creates a single audio file with all SFX clips placed at their scene start times.
 *
 * Strategy: generate a silent base track, then overlay each SFX clip
 * delayed to its scene's startMs using FFmpeg adelay + amix.
 *
 * Returns outputPath on success, null if no SFX clips or FFmpeg fails.
 */
export async function createSfxTrack(input: SfxMixerInput): Promise<string | null> {
  const { sfxPaths, sceneTimings, totalDurationMs, outputPath } = input;

  const validClips: { path: string; delayMs: number; sceneDurMs: number }[] = [];
  for (let i = 0; i < sfxPaths.length; i++) {
    if (sfxPaths[i] && sceneTimings[i]) {
      validClips.push({
        path: sfxPaths[i]!,
        delayMs: sceneTimings[i].startMs,
        sceneDurMs: sceneTimings[i].endMs - sceneTimings[i].startMs,
      });
    }
  }

  if (validClips.length === 0) return null;

  const totalSec = (totalDurationMs / 1000).toFixed(3);
  const args: string[] = ["-y"];

  // Input 0: silent base track matching video duration
  args.push("-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo:d=${totalSec}`);

  // Inputs 1..N: each SFX clip
  for (const clip of validClips) {
    args.push("-i", clip.path);
  }

  // Build filter: delay each SFX to its scene start, trim to scene duration, then mix all
  const filterParts: string[] = [];
  const mixInputs: string[] = ["[0:a]"];

  for (let i = 0; i < validClips.length; i++) {
    const inputIdx = i + 1;
    const { delayMs, sceneDurMs } = validClips[i];
    const trimSec = (sceneDurMs / 1000).toFixed(3);
    const label = `sfx${i}`;

    // Fade in/out for smooth blending, trim to scene duration, delay to scene start
    filterParts.push(
      `[${inputIdx}:a]atrim=0:${trimSec},afade=t=in:st=0:d=0.15,afade=t=out:st=${Math.max(0, sceneDurMs / 1000 - 0.3).toFixed(3)}:d=0.3,adelay=${delayMs}|${delayMs},apad=whole_dur=${totalSec}[${label}]`,
    );
    mixInputs.push(`[${label}]`);
  }

  // Mix all SFX together with the silent base
  filterParts.push(
    `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0,volume=${(1.0 + validClips.length * 0.15).toFixed(2)}[sfxout]`,
  );

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", "[sfxout]", "-c:a", "aac", "-b:a", "128k", outputPath);

  try {
    await runFfmpeg(args);
    log.log(`SFX track mixed: ${validClips.length} clips → ${outputPath}`);
    return outputPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`SFX mix failed (non-fatal): ${msg.slice(0, 200)}`);
    return null;
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const lines = stderr.split("\n");
        const errorLines = lines.filter((l) =>
          /error|invalid|no such|matches no|not found|cannot|failed/i.test(l),
        );
        const useful = errorLines.length > 0
          ? errorLines.slice(-5).join(" | ")
          : stderr.slice(-400);
        reject(new Error(`ffmpeg exited ${code}: ${useful}`));
      }
    });
    proc.on("error", (err) => reject(new Error(`ffmpeg spawn: ${err.message}`)));
  });
}
