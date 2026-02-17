import ffmpeg from "fluent-ffmpeg";
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
}

export async function assembleVideo(input: AssemblyInput): Promise<string> {
  const { imagePaths, audioPath, sceneTimings, scenes, musicPath, outputPath } = input;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-asm-"));

  const scenePaths: string[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const durationSec = (sceneTimings[i].endMs - sceneTimings[i].startMs) / 1000;
    const clipPath = path.join(tmpDir, `clip-${i.toString().padStart(3, "0")}.mp4`);
    await createKenBurnsClip(imagePaths[i], clipPath, durationSec);
    scenePaths.push(clipPath);
  }

  const concatFile = path.join(tmpDir, "concat.txt");
  await fs.writeFile(concatFile, scenePaths.map((p) => `file '${p}'`).join("\n"));

  const silentVideo = path.join(tmpDir, "silent.mp4");
  await concatClips(concatFile, silentVideo);

  const srtPath = path.join(tmpDir, "captions.srt");
  await writeSRT(scenes, sceneTimings, srtPath);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await mergeAll(silentVideo, audioPath, srtPath, musicPath, outputPath);

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  console.log(`[Assembly] Final video: ${outputPath}`);
  return outputPath;
}

function createKenBurnsClip(imagePath: string, outputPath: string, durationSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const frames = Math.round(durationSec * 30);
    ffmpeg(imagePath)
      .loop(1)
      .inputOptions([`-t ${durationSec}`])
      .videoFilter([
        `zoompan=z='min(zoom+0.0005,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30`,
      ])
      .outputOptions(["-c:v libx264", "-pix_fmt yuv420p", "-preset fast", "-an"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Ken Burns: ${err.message}`)))
      .run();
  });
}

function concatClips(concatFile: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatFile)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Concat: ${err.message}`)))
      .run();
  });
}

function mergeAll(
  videoPath: string,
  audioPath: string,
  srtPath: string,
  musicPath: string | undefined,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg().input(videoPath).input(audioPath);

    const filterParts: string[] = [];
    let audioMap: string;

    if (musicPath) {
      cmd.input(musicPath);
      filterParts.push("[1:a]volume=1.0[voice]");
      filterParts.push("[2:a]volume=0.15,afade=t=in:st=0:d=2[music]");
      filterParts.push("[voice][music]amix=inputs=2:duration=shortest[aout]");
      audioMap = "[aout]";
    } else {
      audioMap = "1:a:0";
    }

    const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\\\:");

    cmd
      .outputOptions([
        "-c:v libx264",
        "-c:a aac",
        "-b:a 192k",
        "-map 0:v:0",
        ...(musicPath ? [`-filter_complex`, filterParts.join(";"), "-map", audioMap] : ["-map", audioMap]),
        `-vf subtitles='${escapedSrt}':force_style='FontName=Arial,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=60,Bold=1'`,
        "-shortest",
        "-preset fast",
        "-pix_fmt yuv420p",
        "-movflags +faststart",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Merge: ${err.message}`)))
      .run();
  });
}

async function writeSRT(
  scenes: { text: string }[],
  timings: { startMs: number; endMs: number }[],
  outputPath: string
): Promise<void> {
  const lines: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    lines.push(`${i + 1}`);
    lines.push(`${fmtTime(timings[i].startMs)} --> ${fmtTime(timings[i].endMs)}`);
    lines.push(scenes[i].text);
    lines.push("");
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
