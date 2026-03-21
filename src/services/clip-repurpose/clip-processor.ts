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

// Anti-fingerprint transforms applied to every clip-repurpose output.
// 1.05x speed + hflip + hue shift + contrast nudge break Content ID matching
// while remaining imperceptible to viewers.
export const SPEED_FACTOR = 1.05;
const HUE_SHIFT = 10;         // degrees
const SAT_FACTOR = 1.05;
const CONTRAST = 1.03;
const BRIGHTNESS = 0.02;
const ANTI_FP_AUDIO = `atempo=${SPEED_FACTOR}`;

function buildAntiFpVideo(hflip: boolean): string {
  const parts: string[] = [];
  if (hflip) parts.push("hflip");
  parts.push(`hue=h=${HUE_SHIFT}:s=${SAT_FACTOR}`);
  parts.push(`eq=contrast=${CONTRAST}:brightness=${BRIGHTNESS}`);
  parts.push(`setpts=PTS/${SPEED_FACTOR}`);
  return parts.join(",");
}

/**
 * Extract a segment from a video and convert to 9:16 with blur background.
 * Applies anti-fingerprint transforms (hue shift, speed change, optional mirror)
 * to both foreground and background layers to evade Content ID.
 */
export async function extractAndCrop(
  sourcePath: string,
  outputPath: string,
  segment: PeakSegment,
  cropMode: "blur-bg" | "center-crop" = "blur-bg",
  hflip = true,
): Promise<void> {
  const duration = segment.endSec - segment.startSec;
  const antiFpVideo = buildAntiFpVideo(hflip);

  let filterComplex: string;
  if (cropMode === "blur-bg") {
    filterComplex = [
      `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},boxblur=25:25,${antiFpVideo}[bg]`,
      `[0:v]scale=${OUT_W}:-2:force_original_aspect_ratio=decrease,${antiFpVideo}[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[vout]`,
      `[0:a]${ANTI_FP_AUDIO}[aout]`,
    ].join(";");
  } else {
    filterComplex = [
      `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},${antiFpVideo}[vout]`,
      `[0:a]${ANTI_FP_AUDIO}[aout]`,
    ].join(";");
  }

  const useFastSeek = segment.startSec > 30;
  const args: string[] = [];

  if (useFastSeek) {
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
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "20",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  );

  log.log(`Extracting ${segment.startSec}-${segment.endSec}s, mode=${cropMode}, anti-fp=on (speed=${SPEED_FACTOR}x, hflip=${hflip}, hue=${HUE_SHIFT}°)`);
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
 *
 * speedFactor adjusts all timestamps to compensate for the anti-fingerprint
 * speed change applied in extractAndCrop. E.g. at 1.05x, a cue at 5000ms
 * in the original maps to 5000/1.05 ≈ 4762ms in the sped-up clip.
 */
export function parseVttForSegment(
  vttContent: string,
  segmentStart: number,
  segmentEnd: number,
  speedFactor = 1.0,
): Array<{ startMs: number; endMs: number; text: string }> {
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
  const rawLines = vttContent.split("\n");
  const sf = speedFactor || 1.0;

  let i = 0;
  while (i < rawLines.length) {
    const timeLine = rawLines[i];
    const timeMatch = timeLine?.match(
      /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/,
    );

    if (!timeMatch) { i++; continue; }

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

    // Collect text lines for this cue
    const textLines: string[] = [];
    i++;
    while (i < rawLines.length && !rawLines[i]?.trim()) i++;
    while (i < rawLines.length && rawLines[i]?.trim()) {
      textLines.push(rawLines[i].trim());
      i++;
    }

    // Skip 10ms snapshot cues (YouTube duplicates without word timestamps)
    if (cueEndSec - cueStartSec < 0.05) continue;
    if (cueStartSec >= segmentEnd || cueEndSec <= segmentStart) continue;

    // YouTube multi-line cues: line 1 = carry-over (no tags), line 2+ = new words (with <c> tags).
    // Only use lines that contain `<` (word-timestamp tags) to avoid duplicating carry-over text.
    const taggedLines = textLines.filter(l => l.includes("<"));
    const useLines = taggedLines.length > 0 ? taggedLines : textLines;
    const rawText = useLines.join(" ");

    const wordTimestampRe = /<(\d{2}):(\d{2}):(\d{2})\.(\d{3})>/g;
    const wordTimestamps: number[] = [];
    let wm: RegExpExecArray | null;
    while ((wm = wordTimestampRe.exec(rawText))) {
      wordTimestamps.push(
        parseInt(wm[1]) * 3600 + parseInt(wm[2]) * 60 + parseInt(wm[3]) + parseInt(wm[4]) / 1000,
      );
    }

    let cleanText = rawText.replace(/<[^>]+>/g, "");
    cleanText = decodeHtmlEntities(cleanText);
    cleanText = cleanText
      .replace(/\[music\]/gi, "")
      .replace(/\[applause\]/gi, "")
      .replace(/\[laughter\]/gi, "")
      .replace(/^\s*>>+\s*/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText) continue;

    if (wordTimestamps.length >= 2) {
      const words = cleanText.split(/\s+/);
      const stamps = [cueStartSec, ...wordTimestamps];
      for (let w = 0; w < words.length; w++) {
        const wStart = stamps[Math.min(w, stamps.length - 1)];
        const wEnd = stamps[Math.min(w + 1, stamps.length - 1)] || cueEndSec;
        if (wStart >= segmentEnd || wEnd <= segmentStart) continue;
        const adjStart = Math.max(0, ((wStart - segmentStart) * 1000) / sf);
        const adjEnd = Math.max(adjStart + 80, ((wEnd - segmentStart) * 1000) / sf);
        cues.push({ startMs: Math.round(adjStart), endMs: Math.round(adjEnd), text: words[w] });
      }
    } else {
      const adjStart = Math.max(0, ((cueStartSec - segmentStart) * 1000) / sf);
      const adjEnd = Math.max(adjStart + 100, ((cueEndSec - segmentStart) * 1000) / sf);
      cues.push({ startMs: Math.round(adjStart), endMs: Math.round(adjEnd), text: cleanText });
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

  // Collect raw chunks: 3 words per group
  const WORDS_PER_CHUNK = 3;
  const MIN_DISPLAY_MS = 600;
  const rawChunks: Array<{ startMs: number; endMs: number; text: string }> = [];

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
        rawChunks.push({ startMs: chunkStartMs, endMs: chunkEndMs, text: chunkWords.join(" ") });
        chunkWords = [];
      }
    } else {
      if (chunkWords.length > 0) {
        rawChunks.push({ startMs: chunkStartMs, endMs: chunkEndMs, text: chunkWords.join(" ") });
        chunkWords = [];
      }
      const words = cue.text.split(/\s+/);
      const cDur = (cue.endMs - cue.startMs) / Math.ceil(words.length / WORDS_PER_CHUNK);
      for (let w = 0; w < words.length; w += WORDS_PER_CHUNK) {
        const chunk = words.slice(w, w + WORDS_PER_CHUNK).join(" ");
        const cs = cue.startMs + (w / WORDS_PER_CHUNK) * cDur;
        const ce = Math.min(cue.endMs, cs + cDur);
        rawChunks.push({ startMs: cs, endMs: ce, text: chunk });
      }
    }
  }
  if (chunkWords.length > 0) {
    rawChunks.push({ startMs: chunkStartMs, endMs: chunkEndMs, text: chunkWords.join(" ") });
  }

  // Each chunk stays visible until the next chunk starts (or min display time)
  for (let ci = 0; ci < rawChunks.length; ci++) {
    const c = rawChunks[ci];
    const nextStart = rawChunks[ci + 1]?.startMs;
    const displayEnd = nextStart != null
      ? Math.max(c.startMs + MIN_DISPLAY_MS, nextStart)
      : Math.max(c.endMs, c.startMs + MIN_DISPLAY_MS);
    lines.push(
      `Dialogue: 0,${formatAssTime(c.startMs)},${formatAssTime(displayEnd)},Default,,0,0,0,,${c.text}`,
    );
  }

  return lines.join("\n");
}

// Pitch shift: ~-1 semitone (2^(-1/12) ≈ 0.9439).
// asetrate changes pitch but also stretches duration; atempo compensates
// to keep audio in sync with the video track.
const PITCH_FACTOR = 0.9439;
const PITCH_TEMPO_COMPENSATION = (1 / PITCH_FACTOR).toFixed(5);
const PITCH_AF = `asetrate=44100*${PITCH_FACTOR},aresample=44100,atempo=${PITCH_TEMPO_COMPENSATION}`;

const BGM_DIR = path.join(process.cwd(), "assets", "music");
const BGM_ORIGINAL_VOL = 0.80;
const BGM_MIX_VOL = 0.20;
const BGM_FADE_SEC = 2;

async function pickRandomBgm(): Promise<string | null> {
  try {
    const files = (await fs.readdir(BGM_DIR)).filter((f) => /\.(mp3|aac|m4a|ogg|wav)$/i.test(f));
    if (files.length === 0) return null;
    return path.join(BGM_DIR, files[Math.floor(Math.random() * files.length)]);
  } catch {
    return null;
  }
}

async function getAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ], { timeout: 10_000 });
  return parseFloat(stdout.trim()) || 0;
}

/**
 * Apply captions, hook text overlay, audio pitch shift, and optional BGM mix.
 * When enableBgm is true, a random royalty-free track from assets/music/ is
 * mixed underneath the original audio at low volume to further break the
 * audio fingerprint while keeping dialog clearly audible.
 */
export async function enhanceClip(
  inputPath: string,
  outputPath: string,
  assContent: string,
  tmpDir: string,
  enableBgm = false,
): Promise<void> {
  const assPath = path.join(tmpDir, "captions.ass");
  await fs.writeFile(assPath, assContent, "utf-8");

  const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const escapedFonts = FONTS_DIR.replace(/\\/g, "/").replace(/:/g, "\\:");

  const bgmPath = enableBgm ? await pickRandomBgm() : null;

  if (!bgmPath) {
    const args = [
      "-i", inputPath,
      "-vf", `ass='${escapedAss}':fontsdir='${escapedFonts}'`,
      "-af", PITCH_AF,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "20",
      "-c:a", "aac",
      "-b:a", "192k",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ];
    log.log(`Applying captions + pitch shift (${PITCH_FACTOR}), bgm=off...`);
    await execFileAsync("ffmpeg", args, { timeout: 120_000 });
  } else {
    const clipDur = await getAudioDuration(inputPath);
    const bgmDur = await getAudioDuration(bgmPath);
    const bgmStart = bgmDur > clipDur + 5 ? Math.floor(Math.random() * (bgmDur - clipDur - 2)) : 0;
    const fadeOut = Math.max(0, clipDur - BGM_FADE_SEC);

    // filter_complex: pitch-shift original, trim+fade BGM, mix both
    const fc = [
      `[0:a]${PITCH_AF}[orig]`,
      `[orig]volume=${BGM_ORIGINAL_VOL}[origv]`,
      `[1:a]atrim=start=${bgmStart},asetpts=PTS-STARTPTS,volume=${BGM_MIX_VOL},afade=t=in:d=${BGM_FADE_SEC},afade=t=out:st=${fadeOut}:d=${BGM_FADE_SEC}[bgm]`,
      `[origv][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
    ].join(";");

    const args = [
      "-i", inputPath,
      "-i", bgmPath,
      "-filter_complex", fc,
      "-vf", `ass='${escapedAss}':fontsdir='${escapedFonts}'`,
      "-map", "0:v",
      "-map", "[aout]",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "20",
      "-c:a", "aac",
      "-b:a", "192k",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-shortest",
      "-y",
      outputPath,
    ];
    log.log(`Applying captions + pitch shift + BGM mix (orig=${BGM_ORIGINAL_VOL}, bgm=${BGM_MIX_VOL}, track=${path.basename(bgmPath)})...`);
    await execFileAsync("ffmpeg", args, { timeout: 120_000 });
  }

  const stat = await fs.stat(outputPath);
  log.log(`Enhanced clip: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
}
