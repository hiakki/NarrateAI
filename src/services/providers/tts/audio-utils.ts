import fs from "fs/promises";
import { createLogger } from "@/lib/logger";

const log = createLogger("AudioUtils");

export function estimateSceneTimings(
  scenes: { text: string }[],
  totalDurationMs: number
): { startMs: number; endMs: number }[] {
  const totalChars = scenes.reduce((sum, s) => sum + s.text.length, 0);
  if (totalChars === 0) return scenes.map(() => ({ startMs: 0, endMs: 0 }));

  const timings: { startMs: number; endMs: number }[] = [];
  let currentMs = 0;

  for (const scene of scenes) {
    const proportion = scene.text.length / totalChars;
    const sceneDurationMs = Math.round(proportion * totalDurationMs);
    timings.push({ startMs: currentMs, endMs: currentMs + sceneDurationMs });
    currentMs += sceneDurationMs;
  }

  if (timings.length > 0) {
    timings[timings.length - 1].endMs = totalDurationMs;
  }
  return timings;
}

export async function getAudioDuration(filePath: string, format: "wav" | "mp3" = "wav"): Promise<number> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const exec = promisify(execFile);

  try {
    const { stdout } = await exec("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const duration = parseFloat(stdout.trim());
    if (!isNaN(duration) && duration > 0) {
      return Math.round(duration * 1000);
    }
  } catch {
    // ffprobe unavailable, use file-size estimate
  }

  try {
    const stat = await fs.stat(filePath);
    if (format === "wav") {
      const fileSizeBytes = Math.max(0, stat.size - 44);
      const bytesPerSecond = 48000;
      const estimatedMs = Math.round(Math.max(10, fileSizeBytes / bytesPerSecond) * 1000);
      log.log(`WAV estimate from file size: ${Math.round(estimatedMs / 1000)}s`);
      return estimatedMs;
    } else {
      const bitrate = 128000;
      const estimatedMs = Math.round((stat.size * 8 * 1000) / bitrate);
      const result = Math.max(5000, estimatedMs);
      log.log(`MP3 estimate from file size: ${Math.round(result / 1000)}s`);
      return result;
    }
  } catch {
    log.warn("All duration methods failed, defaulting to 45s");
    return 45000;
  }
}
