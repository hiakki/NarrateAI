/**
 * Sound effects + BGM generation via ElevenLabs Sound Generation API.
 * Fast (~3-4s), high quality, exact duration control.
 * Uses the same ELEVENLABS_API_KEY as TTS.
 */

import fs from "fs/promises";
import { createLogger } from "@/lib/logger";

const log = createLogger("ElevenLabsSFX");

const API_URL = "https://api.elevenlabs.io/v1/sound-generation";
const TIMEOUT_MS = 30_000;
const MIN_AUDIO_SIZE = 500;

function getApiKey(): string | undefined {
  return process.env.ELEVENLABS_API_KEY;
}

export interface ElevenLabsSFXOptions {
  prompt: string;
  durationSec?: number;
  outputPath: string;
}

/**
 * Generate audio (SFX or BGM) via ElevenLabs Sound Generation API.
 * Returns outputPath on success, null if key missing or API fails.
 */
export async function generateViaElevenLabs(opts: ElevenLabsSFXOptions): Promise<string | null> {
  const { prompt, durationSec = 5, outputPath } = opts;
  const key = getApiKey();
  if (!key) return null;

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: prompt.slice(0, 500),
        duration_seconds: Math.min(22, Math.max(1, durationSec)),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        log.warn(`API key invalid (${res.status})`);
      } else if (res.status === 429) {
        log.warn(`Rate limited, skipping SFX`);
      } else {
        log.warn(`API error ${res.status}: ${body.slice(0, 150)}`);
      }
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < MIN_AUDIO_SIZE) {
      log.warn(`Audio too small (${buffer.length} bytes)`);
      return null;
    }

    await fs.writeFile(outputPath, buffer);
    log.debug(`Generated ${(buffer.length / 1024).toFixed(0)}KB audio → ${outputPath}`);
    return outputPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|abort/i.test(msg)) {
      log.warn("Generation timed out");
    } else {
      log.warn(`Error: ${msg.slice(0, 150)}`);
    }
    return null;
  }
}
