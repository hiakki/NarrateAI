/**
 * SFX generation via HuggingFace AudioGen / MusicGen (free inference API)
 * with fallback to Stable Audio Open Gradio Space (ZeroGPU).
 */

import fs from "fs/promises";
import { createLogger } from "@/lib/logger";
import { getKeyRotator, DEFAULT_EXHAUSTION_TTL_MS, RATE_LIMIT_TTL_MS } from "@/lib/api-key-rotation";
import { buildSFXPrompt } from "./prompts";
import { generateViaElevenLabs } from "./elevenlabs-sfx";
import { generateViaStableAudio } from "./stable-audio";

const log = createLogger("AudioGen");

const HF_INFERENCE_URL = "https://router.huggingface.co/hf-inference/models";
const MODEL_ID = "facebook/audiogen-medium";
const FALLBACK_MODEL_ID = "facebook/musicgen-small";
const TIMEOUT_MS = 120_000;

const DAILY_LIMIT_RE = /daily.?(limit|quota)/i;
const RETRYABLE_RE = /\b(401|402|429|503)\b/;

export interface GenerateSFXOptions {
  visualDescription: string;
  tone?: string;
  /** SFX duration in seconds (default 4). */
  durationSec?: number;
  outputPath: string;
}

async function callHfAudio(
  modelId: string,
  prompt: string,
  maxTokens: number,
  apiKey: string,
): Promise<Buffer | null> {
  const res = await fetch(`${HF_INFERENCE_URL}/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
    throw new Error(`HF audio ${res.status}: ${body.slice(0, 300)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) return null;
  return buf;
}

export interface SFXGenResult {
  path: string;
  provider: string;
}

/**
 * Generate an SFX clip for a single scene.
 * Tries HF AudioGen → HF MusicGen → ElevenLabs → Stable Audio.
 */
export async function generateSFX(opts: GenerateSFXOptions): Promise<SFXGenResult | null> {
  const { visualDescription, tone, durationSec = 4, outputPath } = opts;
  const prompt = buildSFXPrompt(visualDescription, tone);
  const maxTokens = Math.min(512, Math.max(128, Math.round(durationSec * 50)));

  const hfResult = await tryHfSFX(prompt, maxTokens, outputPath);
  if (hfResult) return { path: hfResult, provider: "HuggingFace AudioGen" };

  const elResult = await generateViaElevenLabs({
    prompt,
    durationSec: Math.min(10, durationSec),
    outputPath: outputPath.replace(/\.\w+$/, ".mp3"),
  });
  if (elResult) return { path: elResult, provider: "ElevenLabs" };

  const saResult = await generateViaStableAudio({
    prompt,
    durationSec: Math.min(10, durationSec),
    steps: 30,
    cfgScale: 5,
    outputPath: outputPath.replace(/\.\w+$/, ".wav"),
  });
  if (saResult) return { path: saResult, provider: "Stable Audio" };
  return null;
}

async function tryHfSFX(prompt: string, maxTokens: number, outputPath: string): Promise<string | null> {
  const rotator = getKeyRotator("HUGGINGFACE_API_KEY");
  if (!rotator.hasKeys) return null;

  while (true) {
    const key = rotator.getNextKey();
    if (!key) return null;

    try {
      let buffer: Buffer | null = null;

      try {
        buffer = await callHfAudio(MODEL_ID, prompt, maxTokens, key);
      } catch (primaryErr) {
        const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        if (RETRYABLE_RE.test(msg)) throw primaryErr;
        log.debug(`AudioGen unavailable (${msg.slice(0, 80)}), trying MusicGen fallback`);
        buffer = await callHfAudio(FALLBACK_MODEL_ID, prompt, maxTokens, key);
      }

      if (!buffer) {
        log.debug(`SFX empty for: "${prompt.slice(0, 60)}"`);
        return null;
      }

      await fs.writeFile(outputPath, buffer);
      log.debug(`SFX saved: ${outputPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
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

      if (/timeout|abort/i.test(msg)) return null;
      log.debug(`SFX failed: ${msg.slice(0, 120)}`);
      return null;
    }
  }
}

/**
 * Generate SFX clips for multiple scenes.
 * Concurrency is kept low for Gradio Space fallback (serialized to avoid queue saturation).
 */
export async function generateAllSFX(
  scenes: { visualDescription: string }[],
  sceneTimings: { startMs: number; endMs: number }[],
  outputDir: string,
  tone?: string,
  concurrency = 2,
): Promise<{ paths: (string | null)[]; sfxProvider?: string }> {
  const paths: (string | null)[] = new Array(scenes.length).fill(null);
  let generated = 0;
  const providerCounts: Record<string, number> = {};

  const queue = scenes.map((_, i) => i);

  async function worker() {
    while (queue.length > 0) {
      const idx = queue.shift()!;
      const dur = Math.max(2, Math.min(6, (sceneTimings[idx].endMs - sceneTimings[idx].startMs) / 1000));
      const pad = idx.toString().padStart(3, "0");
      const outPath = `${outputDir}/sfx-${pad}.flac`;

      const result = await generateSFX({
        visualDescription: scenes[idx].visualDescription,
        tone,
        durationSec: Math.round(dur),
        outputPath: outPath,
      });

      if (result) {
        paths[idx] = result.path;
        providerCounts[result.provider] = (providerCounts[result.provider] ?? 0) + 1;
        generated++;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, scenes.length) }, () => worker());
  await Promise.all(workers);

  const sfxProvider = Object.entries(providerCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  log.log(`SFX: ${generated}/${scenes.length} scenes generated`);
  return { paths, sfxProvider };
}
