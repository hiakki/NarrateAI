import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { createLogger } from "@/lib/logger";
import type { PeakSegment } from "./heatmap";

const execFileAsync = promisify(execFile);
const log = createLogger("ClipProcessor");

const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");
const OUT_W = 1080;
const OUT_H = 1920;

// ── Audio speech detection via FFmpeg silencedetect ──

interface SpeechSegment {
  startSec: number;
  endSec: number;
}

/**
 * Detect speech regions in a video by finding gaps between silence.
 * Uses FFmpeg silencedetect to find silent regions, then inverts to find speech.
 */
export async function detectSpeechSegments(
  videoPath: string,
  noiseTolerance = -30,
  minSilenceDuration = 0.4,
): Promise<SpeechSegment[]> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-i", videoPath,
      "-af", `silencedetect=noise=${noiseTolerance}dB:d=${minSilenceDuration}`,
      "-f", "null", "-",
    ], { timeout: 60_000, maxBuffer: 5 * 1024 * 1024 });

    const silenceStarts: number[] = [];
    const silenceEnds: number[] = [];

    for (const line of stderr.split("\n")) {
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      const endMatch = line.match(/silence_end:\s*([\d.]+)/);
      if (startMatch) silenceStarts.push(parseFloat(startMatch[1]));
      if (endMatch) silenceEnds.push(parseFloat(endMatch[1]));
    }

    // Get video duration from ffmpeg output
    const durMatch = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
    const totalDur = durMatch
      ? parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseInt(durMatch[3]) + parseInt(durMatch[4]) / 100
      : 300;

    // Invert silence regions to get speech regions
    const speechSegments: SpeechSegment[] = [];
    let cursor = 0;

    for (let i = 0; i < silenceStarts.length; i++) {
      if (silenceStarts[i] > cursor + 0.1) {
        speechSegments.push({ startSec: cursor, endSec: silenceStarts[i] });
      }
      cursor = silenceEnds[i] ?? silenceStarts[i] + minSilenceDuration;
    }

    if (cursor < totalDur - 0.1) {
      speechSegments.push({ startSec: cursor, endSec: totalDur });
    }

    log.log(`Audio analysis: ${speechSegments.length} speech segments detected (${silenceStarts.length} silence gaps)`);
    return speechSegments;
  } catch (err) {
    log.warn(`Speech detection failed: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    return [];
  }
}

/**
 * Align VTT subtitle cues to actual audio speech segments.
 * Shifts cues that fall in silence to the nearest speech region.
 */
export function alignCuesToAudio(
  cues: Array<{ startMs: number; endMs: number; text: string }>,
  speechSegments: SpeechSegment[],
): Array<{ startMs: number; endMs: number; text: string }> {
  if (speechSegments.length === 0 || cues.length === 0) return cues;

  return cues.map((cue) => {
    const cueMidSec = ((cue.startMs + cue.endMs) / 2) / 1000;
    const cueDurMs = cue.endMs - cue.startMs;

    // Check if cue already falls within a speech segment
    const inSpeech = speechSegments.find(
      (s) => cueMidSec >= s.startSec && cueMidSec <= s.endSec,
    );
    if (inSpeech) return cue;

    // Find the nearest speech segment
    let nearestSeg = speechSegments[0];
    let nearestDist = Infinity;
    for (const seg of speechSegments) {
      const segMid = (seg.startSec + seg.endSec) / 2;
      const dist = Math.abs(cueMidSec - segMid);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestSeg = seg;
      }
    }

    // Only shift if drift is less than 3 seconds — beyond that it's likely a different segment
    if (nearestDist > 3) return cue;

    // Shift the cue to align with the speech segment
    const segStartMs = nearestSeg.startSec * 1000;
    const segEndMs = nearestSeg.endSec * 1000;
    const newStart = Math.max(segStartMs, Math.min(cue.startMs, segEndMs - cueDurMs));
    return { startMs: Math.round(newStart), endMs: Math.round(newStart + cueDurMs), text: cue.text };
  });
}

/**
 * Extract a segment from a video and convert to 9:16 with blur background.
 * Uses -ss after -i for frame-accurate seeking (avoids keyframe drift that
 * causes subtitle timing misalignment).
 */
export async function extractAndCrop(
  sourcePath: string,
  outputPath: string,
  segment: PeakSegment,
  cropMode: "blur-bg" | "center-crop" = "blur-bg",
): Promise<void> {
  const duration = segment.endSec - segment.startSec;

  let videoFilter: string;
  if (cropMode === "blur-bg") {
    videoFilter = [
      `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},boxblur=25:25[bg]`,
      `[0:v]scale=${OUT_W}:-2:force_original_aspect_ratio=decrease[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[vout]`,
    ].join(";");
  } else {
    videoFilter = `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H}[vout]`;
  }

  // Use -ss after -i for frame-accurate seeking (slower but no keyframe drift)
  // For long source videos (>300s), use fast seek to nearby keyframe then accurate trim
  const useFastSeek = segment.startSec > 30;
  const args: string[] = [];

  if (useFastSeek) {
    // Fast seek to ~10s before target, then accurate seek
    const fastSeekPoint = Math.max(0, segment.startSec - 10);
    args.push("-ss", String(fastSeekPoint));
    args.push("-i", sourcePath);
    args.push("-ss", String(segment.startSec - fastSeekPoint));
  } else {
    args.push("-i", sourcePath);
    args.push("-ss", String(segment.startSec));
  }

  args.push(
    "-t", String(duration),
    "-filter_complex", videoFilter,
    "-map", "[vout]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "20",
    "-c:a", "aac",
    "-b:a", "192k",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  );

  log.log(`Extracting ${segment.startSec}-${segment.endSec}s, mode=${cropMode}, accurate-seek=${useFastSeek ? "hybrid" : "full"}`);
  await execFileAsync("ffmpeg", args, { timeout: 180_000 });

  const stat = await fs.stat(outputPath);
  log.log(`Clip extracted: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
  "&#39;": "'", "&#x27;": "'", "&nbsp;": " ", "&#38;": "&", "&#60;": "<",
  "&#62;": ">", "&#34;": '"',
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&(?:#\d+|#x[\da-fA-F]+|[a-zA-Z]+);/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
    .replace(/&#x([\da-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
}

/**
 * Parse VTT subtitles into timed segments for the clipped portion.
 * Uses word-level timestamps from VTT when available (YouTube auto-subs
 * embed `<HH:MM:SS.mmm>` inside cue text for each word).
 */
export function parseVttForSegment(
  vttContent: string,
  segmentStart: number,
  segmentEnd: number,
): Array<{ startMs: number; endMs: number; text: string }> {
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
  const lines = vttContent.split("\n");

  // Deduplicate: YouTube VTT repeats cues with slight offsets; track seen text+time combos
  const seen = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    const timeLine = lines[i];
    const timeMatch = timeLine?.match(
      /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/,
    );

    if (timeMatch) {
      const cueStartSec =
        parseInt(timeMatch[1]) * 3600 +
        parseInt(timeMatch[2]) * 60 +
        parseInt(timeMatch[3]) +
        parseInt(timeMatch[4]) / 1000;
      const cueEndSec =
        parseInt(timeMatch[5]) * 3600 +
        parseInt(timeMatch[6]) * 60 +
        parseInt(timeMatch[7]) +
        parseInt(timeMatch[8]) / 1000;

      if (cueStartSec < segmentEnd && cueEndSec > segmentStart) {
        const textLines: string[] = [];
        i++;
        while (i < lines.length && lines[i]?.trim()) {
          textLines.push(lines[i].trim());
          i++;
        }
        const rawText = textLines.join(" ");

        // Extract word-level timestamps: <01:23:45.678><c> word </c>
        const wordTimestampRe = /<(\d{2}):(\d{2}):(\d{2})\.(\d{3})>/g;
        const wordTimestamps: number[] = [];
        let wm: RegExpExecArray | null;
        while ((wm = wordTimestampRe.exec(rawText))) {
          wordTimestamps.push(
            parseInt(wm[1]) * 3600 + parseInt(wm[2]) * 60 + parseInt(wm[3]) + parseInt(wm[4]) / 1000,
          );
        }

        // Clean text: strip VTT tags and decode HTML entities
        const cleanText = decodeHtmlEntities(
          rawText.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
        );

        if (!cleanText) { continue; }

        // Dedup key
        const dedupKey = `${Math.round(cueStartSec * 10)}:${cleanText.slice(0, 30)}`;
        if (seen.has(dedupKey)) { continue; }
        seen.add(dedupKey);

        if (wordTimestamps.length >= 2) {
          // Word-level timing available — split into per-word cues
          const words = cleanText.split(/\s+/);
          const stamps = [cueStartSec, ...wordTimestamps];
          for (let w = 0; w < words.length; w++) {
            const wStart = stamps[Math.min(w, stamps.length - 1)];
            const wEnd = stamps[Math.min(w + 1, stamps.length - 1)] || cueEndSec;
            if (wStart >= segmentEnd || wEnd <= segmentStart) continue;
            const adjStart = Math.max(0, (wStart - segmentStart) * 1000);
            const adjEnd = Math.max(adjStart + 80, (wEnd - segmentStart) * 1000);
            cues.push({ startMs: Math.round(adjStart), endMs: Math.round(adjEnd), text: words[w] });
          }
        } else {
          // No word-level timing — use cue-level timing
          const adjStart = Math.max(0, (cueStartSec - segmentStart) * 1000);
          const adjEnd = Math.max(adjStart + 100, (cueEndSec - segmentStart) * 1000);
          cues.push({ startMs: Math.round(adjStart), endMs: Math.round(adjEnd), text: cleanText });
        }
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return cues;
}

function formatAssTime(ms: number): string {
  const totalSec = ms / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/**
 * Generate an ASS subtitle file from parsed VTT cues, using NarrateAI caption styling.
 */
export function buildAssFile(
  cues: Array<{ startMs: number; endMs: number; text: string }>,
  hookText?: string,
): string {
  const fontName = "Montserrat ExtraBold";
  const styleLine = `Style: Default,${fontName},58,&H0000D7FF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,3,2,40,40,550,1`;
  const hookStyleLine = `Style: Hook,${fontName},72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,3,5,4,8,40,40,200,1`;

  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${OUT_W}`,
    `PlayResY: ${OUT_H}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleLine,
    hookStyleLine,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  if (hookText) {
    lines.push(
      `Dialogue: 1,${formatAssTime(0)},${formatAssTime(3000)},Hook,,0,0,0,,${hookText}`,
    );
  }

  // Group cues into 3-word chunks, preserving individual word timestamps
  const WORDS_PER_CHUNK = 3;
  let chunkWords: string[] = [];
  let chunkStartMs = 0;
  let chunkEndMs = 0;

  for (const cue of cues) {
    const isWordLevel = !cue.text.includes(" ");

    if (isWordLevel) {
      if (chunkWords.length === 0) chunkStartMs = cue.startMs;
      chunkWords.push(cue.text);
      chunkEndMs = cue.endMs;

      if (chunkWords.length >= WORDS_PER_CHUNK) {
        lines.push(
          `Dialogue: 0,${formatAssTime(chunkStartMs)},${formatAssTime(chunkEndMs)},Default,,0,0,0,,${chunkWords.join(" ")}`,
        );
        chunkWords = [];
      }
    } else {
      // Flush any pending word-level chunk
      if (chunkWords.length > 0) {
        lines.push(
          `Dialogue: 0,${formatAssTime(chunkStartMs)},${formatAssTime(chunkEndMs)},Default,,0,0,0,,${chunkWords.join(" ")}`,
        );
        chunkWords = [];
      }
      // Cue-level: split by words and distribute evenly
      const words = cue.text.split(/\s+/);
      const cDur = (cue.endMs - cue.startMs) / Math.ceil(words.length / WORDS_PER_CHUNK);
      for (let w = 0; w < words.length; w += WORDS_PER_CHUNK) {
        const chunk = words.slice(w, w + WORDS_PER_CHUNK).join(" ");
        const cs = cue.startMs + (w / WORDS_PER_CHUNK) * cDur;
        const ce = Math.min(cue.endMs, cs + cDur);
        lines.push(
          `Dialogue: 0,${formatAssTime(cs)},${formatAssTime(ce)},Default,,0,0,0,,${chunk}`,
        );
      }
    }
  }
  // Flush remaining words
  if (chunkWords.length > 0) {
    lines.push(
      `Dialogue: 0,${formatAssTime(chunkStartMs)},${formatAssTime(chunkEndMs)},Default,,0,0,0,,${chunkWords.join(" ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * Apply captions and optional hook text overlay to a clip via FFmpeg.
 */
export async function enhanceClip(
  inputPath: string,
  outputPath: string,
  assContent: string,
  tmpDir: string,
): Promise<void> {
  const assPath = path.join(tmpDir, "captions.ass");
  await fs.writeFile(assPath, assContent, "utf-8");

  const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const escapedFonts = FONTS_DIR.replace(/\\/g, "/").replace(/:/g, "\\:");

  const args = [
    "-i", inputPath,
    "-vf", `ass='${escapedAss}':fontsdir='${escapedFonts}'`,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "20",
    "-c:a", "copy",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ];

  log.log("Applying captions and hook text...");
  await execFileAsync("ffmpeg", args, { timeout: 120_000 });

  const stat = await fs.stat(outputPath);
  log.log(`Enhanced clip: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
}
