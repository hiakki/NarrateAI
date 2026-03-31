import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import type { TtsProviderInterface, TTSResult } from "./types";
import { estimateSceneTimings, getAudioDuration } from "./audio-utils";
import { getLocalBackendUrl, wrapLocalBackendFetchError } from "@/lib/local-backend";

const log = createLogger("TTS:LocalBackend");

/**
 * Local backend TTS API contract:
 * POST /api/tts
 * Request: { scriptText, voiceId, scenes: [{ text }], language? }
 * Response: { audioBase64: string, mimeType?: "audio/wav"|"audio/mpeg", durationMs?: number }
 */
export class LocalBackendTtsProvider implements TtsProviderInterface {
  private get baseUrl(): string {
    return getLocalBackendUrl();
  }

  async generateSpeech(
    scriptText: string,
    voiceId: string,
    scenes: { text: string }[]
  ): Promise<TTSResult> {
    const url = `${this.baseUrl}/api/tts`;
    const body = { scriptText, voiceId, scenes, language: "en" };

    log.log(`POST ${url} — voice=${voiceId} textLen=${scriptText.length}`);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw wrapLocalBackendFetchError(err, url);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        detail = (j.error ?? j.message ?? detail) as string;
      } catch { /* use text */ }
      log.error(`Local backend TTS ${res.status}: ${detail}`);
      throw new Error(`Local backend /api/tts ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as {
      audioBase64?: string;
      mimeType?: string;
      durationMs?: number;
    };

    const b64 = data.audioBase64;
    if (!b64 || typeof b64 !== "string") {
      throw new Error("Local backend /api/tts response missing audioBase64");
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-tts-"));
    const ext = (data.mimeType ?? "audio/wav").includes("mpeg") ? "mp3" : "wav";
    const audioPath = path.join(tmpDir, `voiceover.${ext}`);
    const buffer = Buffer.from(b64, "base64");
    await fs.writeFile(audioPath, buffer);

    let durationMs = data.durationMs;
    if (typeof durationMs !== "number" || durationMs <= 0) {
      durationMs = await getAudioDuration(audioPath, ext === "mp3" ? "mp3" : "wav");
    }

    const sceneTimings = estimateSceneTimings(scenes, durationMs);
    log.debug(`Audio saved: ${audioPath} (${durationMs}ms)`);

    return { audioPath, durationMs, sceneTimings };
  }
}
