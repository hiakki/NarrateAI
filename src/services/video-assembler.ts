import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

export interface AssemblyInput {
  imagePaths: string[];
  audioPath: string;
  sceneTimings: { startMs: number; endMs: number }[];
  scenes: { text: string }[];
  musicPath?: string;
  outputPath: string;
  tone?: string;
  niche?: string;
}

const MUSIC_VOLUME: Record<string, number> = {
  dramatic: 0.30,
  casual: 0.20,
  educational: 0.12,
};

const DRAMATIC_TONES = new Set(["dramatic"]);
const HORROR_NICHES = new Set(["scary-stories", "urban-legends", "true-crime", "conspiracy-theories"]);

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
    // Fast zoom-in to center (hook / dramatic reveal)
    {
      zExpr: `min(zoom+${speed * 2},${maxZoom})`,
      xExpr: "iw/2-(iw/zoom/2)",
      yExpr: "ih/2-(ih/zoom/2)",
    },
    // Slow pan left-to-right (establishing)
    {
      zExpr: `min(zoom+${speed * 0.3},1.08)`,
      xExpr: `min(on*2,iw/zoom/4)`,
      yExpr: "ih/2-(ih/zoom/2)",
    },
    // Zoom-out from center (reveals context)
    {
      zExpr: `max(${maxZoom}-on*${speed},1.0)`,
      xExpr: "iw/2-(iw/zoom/2)",
      yExpr: "ih/2-(ih/zoom/2)",
    },
    // Pan right-to-left (building tension)
    {
      zExpr: `min(zoom+${speed * 0.3},1.08)`,
      xExpr: `max(iw/zoom/4-on*2,0)`,
      yExpr: "ih/2-(ih/zoom/2)",
    },
    // Slow zoom-in from slightly above center (intimacy)
    {
      zExpr: `min(zoom+${speed},${maxZoom * 0.9})`,
      xExpr: "iw/2-(iw/zoom/2)",
      yExpr: `max(ih/3-(ih/zoom/2),0)`,
    },
    // Dramatic zoom-in to lower third (climax)
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

function getCaptionStyle(tone?: string, niche?: string): string {
  const isHorror = HORROR_NICHES.has(niche ?? "");
  const isDramatic = DRAMATIC_TONES.has(tone ?? "");

  if (isHorror) {
    return "FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,SecondaryColour=&H000000FF,OutlineColour=&H00000000,BackColour=&H80000000,Outline=3,Shadow=2,Alignment=2,MarginV=50,Bold=1,Spacing=1";
  }
  if (isDramatic) {
    return "FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H60000000,Outline=2,Shadow=1,Alignment=2,MarginV=55,Bold=1";
  }
  return "FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=60,Bold=1";
}

/**
 * Assembles the final video in a SINGLE ffmpeg pass:
 *   images -> zoompan -> trim -> setpts -> concat filter -> subtitles -> audio mix -> output
 */
export async function assembleVideo(input: AssemblyInput): Promise<string> {
  const { imagePaths, audioPath, sceneTimings, scenes, musicPath, outputPath, tone, niche } = input;

  const totalDurSec = (sceneTimings.at(-1)?.endMs ?? 0) / 1000;
  console.log(`[Assembly] Single-pass: ${totalDurSec.toFixed(1)}s, ${imagePaths.length} scenes, tone=${tone}, niche=${niche}`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-asm-"));
  const srtPath = path.join(tmpDir, "captions.srt");
  await writeWordChunkSRT(scenes, sceneTimings, srtPath);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const isDramatic = DRAMATIC_TONES.has(tone ?? "");
  const musicVol = MUSIC_VOLUME[tone ?? ""] ?? 0.20;
  const captionStyle = getCaptionStyle(tone, niche);

  const args: string[] = ["-y"];

  for (let i = 0; i < imagePaths.length; i++) {
    const dur = Math.max(1, (sceneTimings[i].endMs - sceneTimings[i].startMs) / 1000);
    args.push("-framerate", "2", "-loop", "1", "-t", `${(dur + 2).toFixed(3)}`, "-i", imagePaths[i]);
  }

  const audioIdx = imagePaths.length;
  args.push("-i", audioPath);

  let musicIdx = -1;
  if (musicPath) {
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

    console.log(`[Assembly] Scene ${i + 1}: ${dur.toFixed(2)}s, ${frames}f, effect=${i === 0 ? "hook-zoom" : i === imagePaths.length - 1 ? "resolve-out" : "varied"}`);

    filterParts.push(
      `[${i}:v]zoompan=z='${kb.zExpr}':x='${kb.xExpr}':y='${kb.yExpr}':d=${frames}:s=1080x1920:fps=${FPS},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
    );
    concatInputs.push(`[v${i}]`);
  }

  filterParts.push(
    `${concatInputs.join("")}concat=n=${imagePaths.length}:v=1:a=0[vraw]`
  );

  const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  filterParts.push(
    `[vraw]subtitles='${escapedSrt}':force_style='${captionStyle}'[vout]`
  );

  let audioMap: string;
  if (musicPath) {
    filterParts.push(`[${audioIdx}:a]volume=1.0[voice]`);
    filterParts.push(`[${musicIdx}:a]volume=${musicVol.toFixed(2)},afade=t=in:st=0:d=2[music]`);
    filterParts.push(`[voice][music]amix=inputs=2:duration=shortest[aout]`);
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
    "-shortest",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  );

  await runFfmpeg(args);

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  console.log(`[Assembly] Final video: ${outputPath}`);
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
        const tail = stderr.slice(-800);
        reject(new Error(`ffmpeg exited ${code}: ${tail}`));
      }
    });
    proc.on("error", (err) => reject(new Error(`ffmpeg spawn: ${err.message}`)));
  });
}

/**
 * Splits scene text into 3-4 word chunks for TikTok-style captions,
 * distributing timing evenly across each scene's duration.
 */
async function writeWordChunkSRT(
  scenes: { text: string }[],
  timings: { startMs: number; endMs: number }[],
  outputPath: string
): Promise<void> {
  const lines: string[] = [];
  let counter = 1;

  for (let i = 0; i < scenes.length; i++) {
    const words = scenes[i].text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const sceneStart = timings[i].startMs;
    const sceneDur = timings[i].endMs - timings[i].startMs;
    const chunkSize = Math.min(4, Math.max(2, Math.ceil(words.length / 3)));
    const chunks: string[] = [];

    for (let w = 0; w < words.length; w += chunkSize) {
      chunks.push(words.slice(w, w + chunkSize).join(" "));
    }

    const chunkDur = sceneDur / chunks.length;

    for (let c = 0; c < chunks.length; c++) {
      const start = Math.round(sceneStart + c * chunkDur);
      const end = Math.round(sceneStart + (c + 1) * chunkDur);
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
