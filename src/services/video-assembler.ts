import ffmpeg from "fluent-ffmpeg";
import fs from "fs/promises";
import path from "path";
import os from "os";

export interface AssemblyInput {
  imagePaths: string[];
  audioPath: string;
  sceneTimings: { startMs: number; endMs: number }[];
  scenes: { text: string }[];
  outputPath: string;
}

export async function assembleVideo(input: AssemblyInput): Promise<string> {
  const { imagePaths, audioPath, sceneTimings, scenes, outputPath } = input;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-asm-"));
  const scenePaths: string[] = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const durationSec = (sceneTimings[i].endMs - sceneTimings[i].startMs) / 1000;
    const sceneClipPath = path.join(tmpDir, `clip-${i.toString().padStart(3, "0")}.mp4`);

    await createKenBurnsClip(imagePaths[i], sceneClipPath, durationSec);
    scenePaths.push(sceneClipPath);
  }

  const concatFilePath = path.join(tmpDir, "concat.txt");
  const concatContent = scenePaths.map((p) => `file '${p}'`).join("\n");
  await fs.writeFile(concatFilePath, concatContent);

  const silentVideoPath = path.join(tmpDir, "silent.mp4");
  await concatClips(concatFilePath, silentVideoPath);

  const subtitlePath = path.join(tmpDir, "captions.srt");
  await generateSRT(scenes, sceneTimings, subtitlePath);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await mergeAudioAndCaptions(silentVideoPath, audioPath, subtitlePath, outputPath);

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  return outputPath;
}

function createKenBurnsClip(
  imagePath: string,
  outputPath: string,
  durationSec: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const totalFrames = Math.round(durationSec * 30);

    ffmpeg(imagePath)
      .loop(1)
      .inputOptions([`-t ${durationSec}`])
      .videoFilter([
        `zoompan=z='min(zoom+0.0005,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=30`,
      ])
      .outputOptions([
        "-c:v libx264",
        "-pix_fmt yuv420p",
        "-preset fast",
        "-an",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Ken Burns failed: ${err.message}`)))
      .run();
  });
}

function concatClips(concatFilePath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatFilePath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Concat failed: ${err.message}`)))
      .run();
  });
}

function mergeAudioAndCaptions(
  videoPath: string,
  audioPath: string,
  subtitlePath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        "-c:v libx264",
        "-c:a aac",
        "-b:a 192k",
        "-map 0:v:0",
        "-map 1:a:0",
        "-shortest",
        `-vf subtitles='${subtitlePath.replace(/'/g, "'\\''")}':force_style='FontName=Arial,FontSize=14,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=60'`,
        "-preset fast",
        "-pix_fmt yuv420p",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Merge failed: ${err.message}`)))
      .run();
  });
}

async function generateSRT(
  scenes: { text: string }[],
  timings: { startMs: number; endMs: number }[],
  outputPath: string
): Promise<void> {
  const lines: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const start = formatSRTTime(timings[i].startMs);
    const end = formatSRTTime(timings[i].endMs);
    lines.push(`${i + 1}`);
    lines.push(`${start} --> ${end}`);
    lines.push(scenes[i].text);
    lines.push("");
  }

  await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
}

function formatSRTTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${millis.toString().padStart(3, "0")}`;
}
