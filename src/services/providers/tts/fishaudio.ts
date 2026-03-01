import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import type { TtsProviderInterface, TTSResult } from "./types";
import { estimateSceneTimings, getAudioDuration } from "./audio-utils";

const log = createLogger("TTS:FishAudio");

export class FishAudioTtsProvider implements TtsProviderInterface {
  async generateSpeech(
    scriptText: string,
    voiceId: string,
    scenes: { text: string }[]
  ): Promise<TTSResult> {
    const apiKey = process.env.FISH_AUDIO_API_KEY;
    if (!apiKey) throw new Error("FISH_AUDIO_API_KEY is not configured");

    const response = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model: "speech-1.6",
      },
      body: JSON.stringify({
        text: scriptText,
        reference_id: voiceId,
        format: "mp3",
        mp3_bitrate: 128,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Fish Audio TTS failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-tts-"));
    const audioPath = path.join(tmpDir, "voiceover.mp3");
    await fs.writeFile(audioPath, audioBuffer);

    const durationMs = await getAudioDuration(audioPath, "mp3");
    const sceneTimings = estimateSceneTimings(scenes, durationMs);

    log.debug(`Audio saved: ${audioPath} (${durationMs}ms, ${(audioBuffer.length / 1024).toFixed(0)}KB)`);

    return { audioPath, durationMs, sceneTimings };
  }
}
