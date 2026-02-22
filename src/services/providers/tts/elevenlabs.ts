import fs from "fs/promises";
import path from "path";
import os from "os";
import type { TtsProviderInterface, TTSResult } from "./types";
import { estimateSceneTimings, getAudioDuration } from "./audio-utils";

export class ElevenLabsTtsProvider implements TtsProviderInterface {
  async generateSpeech(
    scriptText: string,
    voiceId: string,
    scenes: { text: string }[]
  ): Promise<TTSResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: scriptText,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.5,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-tts-"));
    const audioPath = path.join(tmpDir, "voiceover.mp3");
    await fs.writeFile(audioPath, audioBuffer);

    const durationMs = await getAudioDuration(audioPath, "mp3");
    const sceneTimings = estimateSceneTimings(scenes, durationMs);

    console.log(`[TTS:ElevenLabs] Audio saved: ${audioPath} (${durationMs}ms, ${(audioBuffer.length / 1024).toFixed(0)}KB)`);

    return { audioPath, durationMs, sceneTimings };
  }
}
