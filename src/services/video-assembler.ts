import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";

const log = createLogger("Assembly");

export interface AssemblyInput {
  imagePaths: string[];
  audioPath: string;
  sceneTimings: { startMs: number; endMs: number }[];
  scenes: { text: string }[];
  captionScenes?: { text: string }[];
  captionTimings?: { startMs: number; endMs: number }[];
  musicPath?: string;
  outputPath: string;
  tone?: string;
  niche?: string;
  language?: string;
}

const MUSIC_VOLUME: Record<string, number> = {
  dramatic: 0.30,
  casual: 0.20,
  educational: 0.12,
};

const TRANSITION_SECONDS = 0.18;

const DRAMATIC_TONES = new Set(["dramatic"]);
const HORROR_NICHES = new Set(["scary-stories", "true-crime", "conspiracy-theories", "dark-psychology", "survival"]);

type KenBurnsEffect = {
  zExpr: string;
  xExpr: string;
  yExpr: string;
};

function getKenBurnsEffect(
  sceneIndex: number,
  totalScenes: number,
  isDramatic: boolean,
): KenBurnsEffect {
  const speed = isDramatic ? 0.0015 : 0.0008;
  const maxZoom = isDramatic ? 1.25 : 1.15;

  const effects: KenBurnsEffect[] = [
    {
      zExpr: `min(zoom+${speed * 2},${maxZoom})`,
      xExpr: "iw/2-(iw/zoom/2)",
      yExpr: "ih/2-(ih/zoom/2)",
    },
    {
      zExpr: `min(zoom+${speed * 0.3},1.08)`,
      xExpr: `min(on*2,iw/zoom/4)`,
      yExpr: "ih/2-(ih/zoom/2)",
    },
    {
      zExpr: `max(${maxZoom}-on*${speed},1.0)`,
      xExpr: "iw/2-(iw/zoom/2)",
      yExpr: "ih/2-(ih/zoom/2)",
    },
    {
      zExpr: `min(zoom+${speed * 0.3},1.08)`,
      xExpr: `max(iw/zoom/4-on*2,0)`,
      yExpr: "ih/2-(ih/zoom/2)",
    },
    {
      zExpr: `min(zoom+${speed},${maxZoom * 0.9})`,
      xExpr: "iw/2-(iw/zoom/2)",
      yExpr: `max(ih/3-(ih/zoom/2),0)`,
    },
    {
      zExpr: `min(zoom+${speed * 1.5},${maxZoom})`,
      xExpr: "iw/2-(iw/zoom/2)",
      yExpr: `min(ih*2/3-(ih/zoom/2),ih-ih/zoom)`,
    },
  ];

  let idx: number;
  if (sceneIndex === 0) {
    idx = 0;
  } else if (sceneIndex === totalScenes - 1) {
    idx = 2;
  } else {
    idx = ((sceneIndex - 1) % (effects.length - 2)) + 1;
  }

  return effects[idx % effects.length];
}

// ─── Font & caption style resolution ──────────────────────────────

const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");

const DEVANAGARI_REGEX = /[\u0900-\u097F]/;

function resolveFont(language?: string, sampleText?: string): string {
  const hasDevanagari = sampleText ? DEVANAGARI_REGEX.test(sampleText) : language === "hi";

  if (hasDevanagari) {
    return "Noto Sans Devanagari";
  }
  return "Noto Sans";
}

interface CaptionStyle {
  fontName: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  backColor: string;
  outline: number;
  shadow: number;
  marginV: number;
  bold: boolean;
  spacing: number;
  borderStyle: number;
}

function getCaptionStyle(tone?: string, niche?: string, language?: string, sampleText?: string): CaptionStyle {
  const fontName = resolveFont(language, sampleText);
  const isHorror = HORROR_NICHES.has(niche ?? "");
  const isDramatic = DRAMATIC_TONES.has(tone ?? "");

  if (isHorror) {
    return {
      fontName, fontSize: 28, bold: true, spacing: 1,
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00000000",
      backColor: "&HA0000000",
      outline: 4, shadow: 0, marginV: 80,
      borderStyle: 4,
    };
  }
  if (isDramatic) {
    return {
      fontName, fontSize: 26, bold: true, spacing: 1,
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00000000",
      backColor: "&H90000000",
      outline: 4, shadow: 0, marginV: 85,
      borderStyle: 4,
    };
  }
  return {
    fontName, fontSize: 24, bold: true, spacing: 0,
    primaryColor: "&H00FFFFFF",
    outlineColor: "&H00000000",
    backColor: "&H80000000",
    outline: 3, shadow: 0, marginV: 90,
    borderStyle: 4,
  };
}

function styleToAss(s: CaptionStyle): string {
  return [
    `FontName=${s.fontName}`,
    `FontSize=${s.fontSize}`,
    `PrimaryColour=${s.primaryColor}`,
    `OutlineColour=${s.outlineColor}`,
    `BackColour=${s.backColor}`,
    `Outline=${s.outline}`,
    `Shadow=${s.shadow}`,
    `Alignment=2`,
    `MarginV=${s.marginV}`,
    `MarginL=40`,
    `MarginR=40`,
    `Bold=${s.bold ? 1 : 0}`,
    `Spacing=${s.spacing}`,
    `BorderStyle=${s.borderStyle}`,
  ].join(",");
}

// ─── Assembly ─────────────────────────────────────────────────────

export async function assembleVideo(input: AssemblyInput): Promise<string> {
  const { imagePaths, audioPath, sceneTimings, scenes, captionScenes, captionTimings, musicPath, outputPath, tone, niche, language } = input;

  const totalDurSec = (sceneTimings.at(-1)?.endMs ?? 0) / 1000;
  log.log(`Single-pass: ${totalDurSec.toFixed(1)}s, ${imagePaths.length} images, tone=${tone}, niche=${niche}, lang=${language ?? "en"}`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-asm-"));
  const srtPath = path.join(tmpDir, "captions.srt");
  const srtScenes = captionScenes ?? scenes;
  const srtTimings = captionTimings ?? sceneTimings;

  const sampleText = srtScenes.map((s) => s.text).join(" ");
  await writeWordChunkSRT(srtScenes, srtTimings, srtPath, language);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const isDramatic = DRAMATIC_TONES.has(tone ?? "");
  const musicVol = MUSIC_VOLUME[tone ?? ""] ?? 0.20;
  const captionStyleObj = getCaptionStyle(tone, niche, language, sampleText);
  const captionStyle = styleToAss(captionStyleObj);

  const args: string[] = ["-y"];

  for (let i = 0; i < imagePaths.length; i++) {
    const dur = Math.max(1, (sceneTimings[i].endMs - sceneTimings[i].startMs) / 1000);
    args.push("-framerate", "2", "-loop", "1", "-t", `${(dur + 2).toFixed(3)}`, "-i", imagePaths[i]);
  }

  const audioIdx = imagePaths.length;
  args.push("-i", audioPath);

  const includeMusic = musicPath ? await hasAudioStream(musicPath) : false;
  if (musicPath && !includeMusic) {
    log.warn(`Music input has no audio stream, skipping BGM: ${musicPath}`);
  }

  let musicIdx = -1;
  if (musicPath && includeMusic) {
    musicIdx = audioIdx + 1;
    args.push("-i", musicPath);
  }

  const FPS = 30;
  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const dur = Math.max(1, (sceneTimings[i].endMs - sceneTimings[i].startMs) / 1000);
    const frames = Math.round(dur * FPS);
    const kb = getKenBurnsEffect(i, imagePaths.length, isDramatic);
    const fadeIn = i === 0 ? 0 : Math.min(TRANSITION_SECONDS, dur / 4);
    const fadeOut = i === imagePaths.length - 1 ? 0 : Math.min(TRANSITION_SECONDS, dur / 4);
    const fadeOutStart = Math.max(0, dur - fadeOut);

    log.debug(`Scene ${i + 1}: ${dur.toFixed(2)}s, ${frames}f, effect=${i === 0 ? "hook-zoom" : i === imagePaths.length - 1 ? "resolve-out" : "varied"}`);

    filterParts.push(
      `[${i}:v]zoompan=z='${kb.zExpr}':x='${kb.xExpr}':y='${kb.yExpr}':d=${frames}:s=1080x1920:fps=${FPS},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS`
      + `${fadeIn > 0 ? `,fade=t=in:st=0:d=${fadeIn.toFixed(3)}` : ""}`
      + `${fadeOut > 0 ? `,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)}` : ""}`
      + `[v${i}]`,
    );
    concatInputs.push(`[v${i}]`);
  }

  filterParts.push(
    `${concatInputs.join("")}concat=n=${imagePaths.length}:v=1:a=0[vraw]`
  );

  const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const escapedFontsDir = FONTS_DIR.replace(/\\/g, "/").replace(/:/g, "\\:");
  filterParts.push(
    `[vraw]subtitles='${escapedSrt}':fontsdir='${escapedFontsDir}':force_style='${captionStyle}'[vout]`
  );

  let audioMap: string;
  if (musicPath && includeMusic) {
    // ffmpeg 8+ forbids using the same filter pad as input to multiple filters.
    // Use asplit to fan the voice stream into two copies.
    filterParts.push(`[${audioIdx}:a]volume=1.0,asplit=2[va][vb]`);
    filterParts.push(`[${musicIdx}:a]aloop=loop=-1:size=2e+09,volume=${musicVol.toFixed(2)},afade=t=in:st=0:d=2[bgm]`);
    filterParts.push(`[bgm][vb]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=220:makeup=1[ducked]`);
    filterParts.push(`[va][ducked]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
    audioMap = "[aout]";
  } else {
    audioMap = `${audioIdx}:a:0`;
  }

  args.push("-filter_complex", filterParts.join(";"));

  args.push(
    "-map", "[vout]",
    "-map", audioMap,
    "-c:v", "libx264",
    "-c:a", "aac",
    "-b:a", "192k",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  );

  await runFfmpeg(args);

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  log.log(`Final video: ${outputPath}`);
  return outputPath;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Extract meaningful error lines instead of dumping raw filter text
        const lines = stderr.split("\n");
        const errorLines = lines.filter((l) =>
          /error|invalid|no such|matches no|not found|cannot|failed/i.test(l),
        );
        const useful = errorLines.length > 0
          ? errorLines.slice(-5).join(" | ")
          : stderr.slice(-600);
        reject(new Error(`ffmpeg exited ${code}: ${useful}`));
      }
    });
    proc.on("error", (err) => reject(new Error(`ffmpeg spawn: ${err.message}`)));
  });
}

function hasAudioStream(inputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_type",
      "-of", "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ];
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) return resolve(false);
      resolve(/\baudio\b/i.test(out));
    });
    proc.on("error", () => resolve(false));
  });
}

// ─── SRT generation ───────────────────────────────────────────────

function getChunkSize(language?: string): number {
  if (language === "hi") return 3;
  return 3;
}

async function writeWordChunkSRT(
  scenes: { text: string }[],
  timings: { startMs: number; endMs: number }[],
  outputPath: string,
  language?: string,
): Promise<void> {
  const lines: string[] = [];
  let counter = 1;
  const maxChunk = getChunkSize(language);
  const minChunkMs = 500;
  const maxChunkMs = 2200;

  for (let i = 0; i < scenes.length; i++) {
    const text = scenes[i].text.trim();
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const sceneStart = timings[i].startMs;
    const sceneDur = timings[i].endMs - timings[i].startMs;
    const chunks: string[] = [];

    // Prefer phrase boundaries first; fallback to word chunking.
    const phraseCandidates = text
      .split(/(?<=[,.;:!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (phraseCandidates.length >= 2) {
      for (const p of phraseCandidates) {
        const pw = p.split(/\s+/).filter(Boolean);
        if (pw.length <= maxChunk + 1) {
          chunks.push(p);
        } else {
          for (let w = 0; w < pw.length; w += maxChunk) {
            chunks.push(pw.slice(w, w + maxChunk).join(" "));
          }
        }
      }
    } else {
      const chunkSize = Math.min(maxChunk, Math.max(2, Math.ceil(words.length / 4)));
      for (let w = 0; w < words.length; w += chunkSize) {
        chunks.push(words.slice(w, w + chunkSize).join(" "));
      }
    }

    // Allocate chunk duration proportionally by character length for tighter sync.
    const lengths = chunks.map((c) => Math.max(1, c.replace(/\s+/g, "").length));
    const totalLen = lengths.reduce((a, b) => a + b, 0);
    let cursor = sceneStart;

    for (let c = 0; c < chunks.length; c++) {
      const baseDur = Math.round((lengths[c] / totalLen) * sceneDur);
      const dur = Math.max(minChunkMs, Math.min(maxChunkMs, baseDur));
      const start = cursor;
      const end = c === chunks.length - 1
        ? sceneStart + sceneDur
        : Math.min(sceneStart + sceneDur, cursor + dur);
      cursor = end;
      lines.push(`${counter}`);
      lines.push(`${fmtTime(start)} --> ${fmtTime(end)}`);
      lines.push(chunks[c]);
      lines.push("");
      counter++;
    }
  }

  await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
}

function fmtTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ml = ms % 1000;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ml.toString().padStart(3, "0")}`;
}
