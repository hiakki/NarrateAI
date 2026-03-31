/**
 * BGM generation via HuggingFace MusicGen (free inference API)
 * with fallback to Stable Audio Open Gradio Space (ZeroGPU).
 */

import fs from "fs/promises";
import { createLogger } from "@/lib/logger";
import { getKeyRotator, DEFAULT_EXHAUSTION_TTL_MS, RATE_LIMIT_TTL_MS } from "@/lib/api-key-rotation";
import { buildBGMPrompt } from "./prompts";
import { generateViaElevenLabs } from "./elevenlabs-sfx";
import { generateViaStableAudio } from "./stable-audio";

const log = createLogger("MusicGen");

const HF_INFERENCE_URL = "https://router.huggingface.co/hf-inference/models";
const MODEL_ID = "facebook/musicgen-small";
const TIMEOUT_MS = 180_000;

const DAILY_LIMIT_RE = /daily.?(limit|quota)/i;
const RETRYABLE_RE = /\b(401|402|429|503)\b/;

export interface GenerateBGMOptions {
  tone: string;
  niche: string;
  /** Target duration in seconds (capped at ~20s by musicgen-small). */
  durationSec?: number;
  outputPath: string;
}

export interface AudioGenResult {
  path: string;
  provider: string;
}

/**
 * Try HF Inference API first, fall back to ElevenLabs, then Stable Audio.
 * Returns { path, provider } on success, null if everything fails (non-fatal).
 */
export async function generateBGM(opts: GenerateBGMOptions): Promise<AudioGenResult | null> {
  const { tone, niche, durationSec = 15, outputPath } = opts;
  const prompt = buildBGMPrompt(tone, niche);
  const maxTokens = Math.min(1500, Math.max(256, Math.round(durationSec * 50)));

  const hfResult = await tryHfMusicGen(prompt, maxTokens, outputPath);
  if (hfResult) return { path: hfResult, provider: "HuggingFace MusicGen" };

  log.log(`HF depleted, trying ElevenLabs for BGM`);
  const elResult = await generateViaElevenLabs({
    prompt,
    durationSec: Math.min(22, durationSec),
    outputPath: outputPath.replace(/\.\w+$/, ".mp3"),
  });
  if (elResult) return { path: elResult, provider: "ElevenLabs" };

  log.log(`Trying Stable Audio Open for BGM`);
  const saResult = await generateViaStableAudio({
    prompt,
    durationSec: Math.min(30, durationSec),
    steps: 50,
    cfgScale: 5,
    outputPath: outputPath.replace(/\.\w+$/, ".wav"),
  });
  if (saResult) return { path: saResult, provider: "Stable Audio" };
  return null;
}

async function tryHfMusicGen(prompt: string, maxTokens: number, outputPath: string): Promise<string | null> {
  const rotator = getKeyRotator("HUGGINGFACE_API_KEY");
  if (!rotator.hasKeys) {
    log.debug("No HF keys configured, skipping MusicGen");
    return null;
  }

  log.log(`Generating BGM: "${prompt.slice(0, 80)}…" (~${maxTokens} tokens)`);

  while (true) {
    const key = rotator.getNextKey();
    if (!key) {
      log.debug("All HF keys exhausted for MusicGen");
      return null;
    }

    try {
      const res = await fetch(`${HF_INFERENCE_URL}/${MODEL_ID}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { max_new_tokens: maxTokens },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const errMsg = `MusicGen ${res.status}: ${body.slice(0, 300)}`;

        if (RETRYABLE_RE.test(errMsg)) {
          const ttl = DAILY_LIMIT_RE.test(errMsg) ? 6 * 3600_000
            : res.status === 429 ? RATE_LIMIT_TTL_MS
            : DEFAULT_EXHAUSTION_TTL_MS;
          rotator.markExhausted(key, ttl, errMsg.slice(0, 120));
          continue;
        }
        throw new Error(errMsg);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1000) {
        throw new Error(`MusicGen returned suspiciously small audio (${buffer.length} bytes)`);
      }

      await fs.writeFile(outputPath, buffer);
      log.log(`BGM saved: ${outputPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
      return outputPath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (RETRYABLE_RE.test(msg)) {
        const ttl = DAILY_LIMIT_RE.test(msg) ? 6 * 3600_000
          : /429/.test(msg) ? RATE_LIMIT_TTL_MS
          : DEFAULT_EXHAUSTION_TTL_MS;
        rotator.markExhausted(key, ttl, msg.slice(0, 120));
        continue;
      }

      if (/timeout|abort/i.test(msg)) {
        log.warn(`MusicGen timed out`);
        return null;
      }

      log.error(`MusicGen failed: ${msg}`);
      return null;
    }
  }
}
