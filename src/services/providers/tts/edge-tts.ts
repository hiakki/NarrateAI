import fs from "fs/promises";
import path from "path";
import os from "os";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { TtsProviderInterface, TTSResult } from "./types";
import { estimateSceneTimings, getAudioDuration } from "./audio-utils";

export class EdgeTtsProvider implements TtsProviderInterface {
  async generateSpeech(
    scriptText: string,
    voiceId: string,
    scenes: { text: string }[]
  ): Promise<TTSResult> {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-tts-"));
    const audioPath = path.join(tmpDir, "voiceover.mp3");

    const { audioFilePath } = await tts.toFile(tmpDir, scriptText);
    await fs.rename(audioFilePath, audioPath);

    const durationMs = await getAudioDuration(audioPath, "mp3");
    const sceneTimings = estimateSceneTimings(scenes, durationMs);

    const stat = await fs.stat(audioPath);
    console.log(
      `[TTS:EdgeTTS] Audio saved: ${audioPath} (${durationMs}ms, ${(stat.size / 1024).toFixed(0)}KB)`
    );

    return { audioPath, durationMs, sceneTimings };
  }
}
