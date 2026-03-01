import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import type { TtsProviderInterface, TTSResult } from "./types";
import { estimateSceneTimings, getAudioDuration } from "./audio-utils";

const log = createLogger("TTS:Gemini");

export class GeminiTtsProvider implements TtsProviderInterface {
  async generateSpeech(
    scriptText: string,
    voiceId: string,
    scenes: { text: string }[]
  ): Promise<TTSResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: scriptText,
      config: {
        responseModalities: ["audio"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceId },
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

    const durationMs = await getAudioDuration(audioPath, "wav");
    const sceneTimings = estimateSceneTimings(scenes, durationMs);

    log.debug(`Audio saved: ${audioPath} (${durationMs}ms, ${(audioBuffer.length / 1024).toFixed(0)}KB)`);

    return { audioPath, durationMs, sceneTimings };
  }
}
