import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import os from "os";

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
}

export interface TTSResult {
  audioPath: string;
  durationMs: number;
  sceneTimings: { startMs: number; endMs: number }[];
}

export async function generateSpeech(
  scriptText: string,
  voiceId: string,
  scenes: { text: string }[]
): Promise<TTSResult> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: scriptText,
    config: {
      responseModalities: ["audio"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voiceId,
          },
        },
      },
    },
  });

  const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!audioData?.data) {
    throw new Error("No audio data returned from Gemini TTS");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-tts-"));
  const audioPath = path.join(tmpDir, "voiceover.wav");
  const audioBuffer = Buffer.from(audioData.data, "base64");
  await fs.writeFile(audioPath, audioBuffer);

  const durationMs = await getAudioDuration(audioPath);

  const sceneTimings = estimateSceneTimings(scenes, durationMs);

  return { audioPath, durationMs, sceneTimings };
}

function estimateSceneTimings(
  scenes: { text: string }[],
  totalDurationMs: number
): { startMs: number; endMs: number }[] {
  const totalChars = scenes.reduce((sum, s) => sum + s.text.length, 0);
  const timings: { startMs: number; endMs: number }[] = [];
  let currentMs = 0;

  for (const scene of scenes) {
    const proportion = scene.text.length / totalChars;
    const sceneDurationMs = Math.round(proportion * totalDurationMs);
    timings.push({
      startMs: currentMs,
      endMs: currentMs + sceneDurationMs,
    });
    currentMs += sceneDurationMs;
  }

  if (timings.length > 0) {
    timings[timings.length - 1].endMs = totalDurationMs;
  }

  return timings;
}

async function getAudioDuration(filePath: string): Promise<number> {
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
    return Math.round(parseFloat(stdout.trim()) * 1000);
  } catch {
    return 45000;
  }
}
