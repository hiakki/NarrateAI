import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import type { TtsProviderInterface, TTSResult } from "./types";
import { estimateSceneTimings, getAudioDuration } from "./audio-utils";

import { requireHuggingFaceToken } from "@/lib/huggingface";

const log = createLogger("TTS:HF");

const HF_INFERENCE = "https://router.huggingface.co/hf-inference/models";

/** voiceId -> HF model (SpeechT5 for EN; MMS-TTS for HI when available). */
const VOICE_TO_MODEL: Record<string, string> = {
  en: "microsoft/speecht5_tts",
  eng: "microsoft/speecht5_tts",
  hi: "facebook/mms-tts-hin",
  hin: "facebook/mms-tts-hin",
};

function getToken(): string {
  return requireHuggingFaceToken("Hugging Face TTS");
}

function getModel(voiceId: string): string {
  const normalized = voiceId.toLowerCase().slice(0, 3);
  const model = VOICE_TO_MODEL[normalized] ?? VOICE_TO_MODEL[voiceId.toLowerCase()] ?? VOICE_TO_MODEL.en;
  return model;
}

export class HuggingFaceTtsProvider implements TtsProviderInterface {
  async generateSpeech(
    scriptText: string,
    voiceId: string,
    scenes: { text: string }[]
  ): Promise<TTSResult> {
    const token = getToken();
    const model = getModel(voiceId);
    const url = `${HF_INFERENCE}/${model}`;

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-tts-hf-"));
    const audioPath = path.join(tmpDir, "voiceover.wav");

    log.log(`HF TTS: model=${model}, text length=${scriptText.length}`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: scriptText, text_inputs: scriptText }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 500);
      log.error(`HF TTS ${res.status}: ${errText}`);
      const hint =
        res.status === 404
          ? ` Model "${model}" may not be available on Inference Providers. Enable it at https://huggingface.co/settings/inference-providers or use another TTS provider (e.g. Gemini, ElevenLabs).`
          : "";
      throw new Error(
        `Hugging Face TTS failed (${res.status}). ${errText}.${hint}`.slice(0, 500)
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1000) {
      throw new Error(`Hugging Face TTS returned too little data (${buffer.length} bytes)`);
    }

    // Inference API may return raw waveform or WAV; write as-is and rely on ffprobe
    await fs.writeFile(audioPath, buffer);

    const durationMs = await getAudioDuration(audioPath, contentType.includes("wav") ? "wav" : "wav");
    const sceneTimings = estimateSceneTimings(scenes, durationMs);

    const stat = await fs.stat(audioPath);
    log.debug(`HF TTS saved: ${audioPath} (${durationMs}ms, ${(stat.size / 1024).toFixed(0)}KB)`);

    return { audioPath, durationMs, sceneTimings };
  }
}
