import Replicate from "replicate";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createReadStream } from "fs";
import { createLogger } from "@/lib/logger";
import {
  getImageToVideoProvider,
  getAvailableImageToVideoProviders,
  IMAGE_TO_VIDEO_PROVIDERS,
  type ImageToVideoProviderInfo,
} from "@/config/image-to-video-providers";
import { getLocalBackendUrl, wrapLocalBackendFetchError } from "@/lib/local-backend";
import { requireHuggingFaceToken } from "@/lib/huggingface";
import { getKeyRotator, resetDailyExhaustion, DEFAULT_EXHAUSTION_TTL_MS, RATE_LIMIT_TTL_MS, getAllExhaustionStatus } from "@/lib/api-key-rotation";
import type { ProviderExhaustionStatus } from "@/lib/api-key-rotation";
import { recordMetric } from "@/lib/ops-metrics";

const log = createLogger("ImageToVideo");

/** Build a short, story-relevant motion prompt for image-to-video from scene visual description. */
export function buildImageToVideoPrompt(visualDescription: string, index: number, total: number): string {
  const clean = visualDescription.trim().slice(0, 200).replace(/\n/g, " ");
  const motion = index === 0
    ? "subtle camera push-in, cinematic"
    : index === total - 1
      ? "slow zoom out, gentle resolution"
      : "subtle motion, slight parallax, cinematic";
  return clean ? `${clean}, ${motion}` : motion;
}

export interface ImageToVideoResult {
  videoPath: string;
  tmpDir: string;
  /** The provider ID that actually generated this clip (may differ from selected due to fallback). */
  actualProvider?: string;
}

const RETRYABLE_STATUS_RE = /\b(401|402|403|404|429|503)\b/;

function isRetryableI2VError(err: Error): boolean {
  return RETRYABLE_STATUS_RE.test(err.message);
}

const KEY_ROTATABLE_TYPES = new Set<string>(["pollinations", "huggingface", "freepik", "gradio-space", "wavespeed", "fal", "siliconflow", "deapi", "pixverse", "leonardo", "gemini-veo"]);

const PROVIDER_FRIENDLY_NAMES: Record<string, string> = {
  POLLINATIONS_SEEDANCE: "Seedance (Pollinations)",
  POLLINATIONS_WAN: "Wan (Pollinations)",
  POLLINATIONS_GROK_VIDEO: "Grok Video (Pollinations)",
  KLING_FREEPIK: "Kling (Freepik)",
  HF_LTX_VIDEO: "HuggingFace LTX-Video",
  HF_WAN_I2V: "HuggingFace Wan I2V",
  WAVESPEED_WAN_480P: "WaveSpeed Wan I2V 480p",
  WAVESPEED_WAN_720P: "WaveSpeed Wan I2V 720p",
  GRADIO_LTX_VIDEO: "LTX-Video (HF Space)",
  SVD_REPLICATE: "Replicate SVD",
  FAL_HAILUO_768P: "Hailuo 768p (fal.ai)",
  FAL_HAILUO_512P: "Hailuo 512p (fal.ai)",
  SILICONFLOW_WAN: "Wan I2V (SiliconFlow)",
  DEAPI_LTX: "LTX-2.3 (deAPI)",
  PIXVERSE_V5: "PixVerse V5",
  LEONARDO_I2V: "Leonardo AI Motion",
  GEMINI_VEO: "Veo 3.1 Fast (Gemini)",
  LOCAL_BACKEND: "Local Backend",
};

function userFriendlyI2VError(providerId: string, err: Error): Error {
  const name = PROVIDER_FRIENDLY_NAMES[providerId] ?? providerId;
  const msg = err.message;

  if (msg.includes("401"))
    return new Error(`${name} API key is invalid or expired. Check your key or add a new one.`);
  if (msg.includes("402"))
    return new Error(`${name} free quota exhausted. Add more API keys in Settings or switch to a different I2V provider.`);
  if (msg.includes("404"))
    return new Error(`${name} model not available for this API key. Enable inference providers at huggingface.co/settings/inference-providers, or switch to a different I2V provider.`);
  if (msg.toLowerCase().includes("daily limit") || msg.toLowerCase().includes("daily quota"))
    return new Error(`${name} daily limit reached. Try again tomorrow or switch to a different I2V provider.`);
  if (msg.includes("429"))
    return new Error(`${name} rate limit reached. Wait a few minutes or add more API keys to rotate.`);
  if (msg.includes("503"))
    return new Error(`${name} is temporarily unavailable. Try again later.`);
  if (msg.includes("not configured"))
    return new Error(`${name} API key is not configured. Add it in your .env file.`);

  return new Error(`${name} video generation failed: ${msg.slice(0, 200)}`);
}

async function dispatchToProvider(
  provider: ImageToVideoProviderInfo,
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  options: { prompt?: string; durationSec?: number; aspectRatio?: "9:16" | "16:9" },
  apiKey?: string,
): Promise<ImageToVideoResult> {
  const dur = options.durationSec ?? 5;
  if (provider.type === "local") {
    return generateClipViaLocalBackend(
      imagePath, outputPath, tmpDir,
      provider.localBaseUrl ?? getLocalBackendUrl(), options.prompt, dur,
    );
  }
  if (provider.type === "huggingface" && provider.hfModelId) {
    const token = apiKey ?? requireHuggingFaceToken("Hugging Face image-to-video");
    return generateClipViaHuggingFace(
      imagePath, outputPath, tmpDir, provider.hfModelId, token, options.prompt, dur,
      provider.hfProvider ?? "hf-inference",
    );
  }
  if (provider.type === "replicate" && provider.replicateModel) {
    return generateClipViaReplicate(imagePath, outputPath, tmpDir, provider.replicateModel, dur);
  }
  if (provider.type === "pollinations" && provider.pollinationsModel) {
    const key = apiKey ?? process.env.POLLINATIONS_API_KEY;
    if (!key) throw new Error("POLLINATIONS_API_KEY is not configured");
    return generateClipViaPollinations(
      imagePath, outputPath, tmpDir, provider.pollinationsModel, key,
      options.prompt, dur, options.aspectRatio ?? "9:16",
    );
  }
  if (provider.type === "freepik" && provider.freepikModel) {
    const key = apiKey ?? process.env.FREEPIK_API_KEY;
    if (!key) throw new Error("FREEPIK_API_KEY is not configured");
    return generateClipViaFreepik(
      imagePath, outputPath, tmpDir, provider.freepikModel, key, options.prompt, dur,
    );
  }
  if (provider.type === "gradio-space" && provider.gradioSpaceId) {
    const token = apiKey ?? requireHuggingFaceToken("HF Space image-to-video");
    return generateClipViaGradioSpace(
      imagePath, outputPath, tmpDir, provider.gradioSpaceId,
      provider.gradioApiName ?? "image_to_video", token, options.prompt, dur,
      options.aspectRatio ?? "9:16",
    );
  }
  if (provider.type === "wavespeed" && provider.wavespeedModelId) {
    const token = apiKey ?? requireHuggingFaceToken("WaveSpeed image-to-video");
    return generateClipViaWaveSpeed(
      imagePath, outputPath, tmpDir, provider.wavespeedModelId, token, options.prompt, dur,
    );
  }
  if (provider.type === "fal" && provider.falModelId) {
    const key = apiKey ?? process.env.FAL_API_KEY;
    if (!key) throw new Error("FAL_API_KEY is not configured");
    return generateClipViaFal(
      imagePath, outputPath, tmpDir, provider.falModelId, key,
      provider.falResolution ?? "768p", options.prompt, dur,
    );
  }
  if (provider.type === "siliconflow") {
    const key = apiKey ?? process.env.SILICONFLOW_API_KEY;
    if (!key) throw new Error("SILICONFLOW_API_KEY is not configured");
    return generateClipViaSiliconFlow(
      imagePath, outputPath, tmpDir, key, options.prompt, dur,
      options.aspectRatio ?? "9:16",
    );
  }
  if (provider.type === "deapi") {
    const key = apiKey ?? process.env.DEAPI_API_KEY;
    if (!key) throw new Error("DEAPI_API_KEY is not configured");
    return generateClipViaDeApi(
      imagePath, outputPath, tmpDir, key, options.prompt, dur,
      options.aspectRatio ?? "9:16",
    );
  }
  if (provider.type === "pixverse") {
    const key = apiKey ?? process.env.PIXVERSE_API_KEY;
    if (!key) throw new Error("PIXVERSE_API_KEY is not configured");
    return generateClipViaPixVerse(
      imagePath, outputPath, tmpDir, key, options.prompt, dur,
      options.aspectRatio ?? "9:16",
    );
  }
  if (provider.type === "leonardo") {
    const key = apiKey ?? process.env.LEONARDO_API_KEY;
    if (!key) throw new Error("LEONARDO_API_KEY is not configured");
    return generateClipViaLeonardo(
      imagePath, outputPath, tmpDir, key, options.prompt, dur,
    );
  }
  if (provider.type === "gemini-veo") {
    const key = apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not configured");
    return generateClipViaGeminiVeo(
      imagePath, outputPath, tmpDir, key, options.prompt, dur,
      options.aspectRatio ?? "9:16",
    );
  }
  if (provider.type === "flow-tv") {
    throw new Error("FLOW_TV runs as an end-to-end scene pipeline (image+clip chaining) via worker and is not callable as generic I2V provider here.");
  }
  throw new Error(`Missing config for image-to-video provider: ${provider.id}`);
}

/**
 * Try a single provider with key rotation. Returns result on success, null on
 * quota/key exhaustion (so we can fall through to the next provider).
 * Throws on non-retryable errors (bad config, unexpected failures).
 */
interface TryProviderResult {
  clip: ImageToVideoResult | null;
  /** When clip is null, the reason the provider couldn't produce a clip. */
  exhaustedReason?: string;
}

async function tryProviderWithRotation(
  provider: ImageToVideoProviderInfo,
  imagePath: string,
  options: { prompt?: string; durationSec?: number; aspectRatio?: "9:16" | "16:9" },
): Promise<TryProviderResult> {
  if (KEY_ROTATABLE_TYPES.has(provider.type) && provider.envVar) {
    const rotator = getKeyRotator(provider.envVar);
    if (!rotator.hasKeys) return { clip: null, exhaustedReason: "no API keys configured" };

    let lastKeyError: Error | null = null;
    while (true) {
      const key = rotator.getNextKey();
      if (!key) {
        const name = PROVIDER_FRIENDLY_NAMES[provider.id] ?? provider.id;
        const reason = lastKeyError?.message.slice(0, 200) ?? "no available keys";
        log.warn(`[I2V]`, `${name}: ${rotator.count} key(s) exhausted — ${reason}`);
        return { clip: null, exhaustedReason: reason };
      }

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-i2v-"));
      const outputPath = path.join(tmpDir, "clip.mp4");
      try {
        const result = await dispatchToProvider(provider, imagePath, outputPath, tmpDir, options, key);
        return { clip: result };
      } catch (err) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        lastKeyError = err instanceof Error ? err : new Error(String(err));
        if (isRetryableI2VError(lastKeyError)) {
          const msg = lastKeyError.message.toLowerCase();
          const isOneTime = provider.creditType === "one-time";
          const isQuota = /\b(402|403)\b/.test(lastKeyError.message) || msg.includes("insufficient") || msg.includes("quota");
          const isAccountLevel = /\b(401|404)\b/.test(lastKeyError.message);
          const isRateLimit = /\b429\b/.test(lastKeyError.message);
          const ttl = isOneTime && isQuota
            ? 24 * 60 * 60 * 1000  // 24h for one-time providers with depleted credits
            : isRateLimit
              ? RATE_LIMIT_TTL_MS
              : isAccountLevel
                ? 4 * 60 * 60 * 1000
                : DEFAULT_EXHAUSTION_TTL_MS;
          rotator.markExhausted(key, ttl, lastKeyError.message.slice(0, 100));
          continue;
        }
        throw lastKeyError;
      }
    }
  }

  // Non-rotatable provider (local backend, replicate)
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-i2v-"));
  const outputPath = path.join(tmpDir, "clip.mp4");
  try {
    const result = await dispatchToProvider(provider, imagePath, outputPath, tmpDir, options);
    return { clip: result };
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Build a prioritized fallback order:
 *   1. User-selected provider first
 *   2. Group A (one-time credits) — use these first while they last
 *   3. Group B (daily-reset credits) — conserve these, used when Group A exhausted
 *
 * Within each group, providers are sorted by type priority.
 */
const PROVIDER_PRIORITY: Record<string, number> = {
  fal: 1,
  deapi: 2,
  pixverse: 3,
  siliconflow: 4,
  freepik: 5,
  "gemini-veo": 6,
  replicate: 7,
  leonardo: 10,
  pollinations: 11,
  huggingface: 12,
  wavespeed: 13,
  "gradio-space": 14,
};

/** Env vars that belong to daily-reset providers — used for selective exhaustion reset. */
const DAILY_RESET_ENV_VARS = new Set<string>();

function buildFallbackChain(primaryId: string): ImageToVideoProviderInfo[] {
  const primary = getImageToVideoProvider(primaryId);
  const available = getAvailableImageToVideoProviders()
    .filter((p) => p.type !== "local" && p.id !== primaryId);

  const groupA = available
    .filter((p) => p.creditType === "one-time")
    .sort((a, b) => (PROVIDER_PRIORITY[a.type] ?? 99) - (PROVIDER_PRIORITY[b.type] ?? 99));
  const groupB = available
    .filter((p) => p.creditType === "daily-reset")
    .sort((a, b) => (PROVIDER_PRIORITY[a.type] ?? 99) - (PROVIDER_PRIORITY[b.type] ?? 99));

  for (const p of groupB) {
    if (p.envVar) DAILY_RESET_ENV_VARS.add(p.envVar);
  }

  const chain: ImageToVideoProviderInfo[] = [];
  if (primary) chain.push(primary);
  for (const p of [...groupA, ...groupB]) {
    if (!chain.some((c) => c.id === p.id)) chain.push(p);
  }
  return chain;
}

function getDailyResetEnvVars(): Set<string> {
  if (DAILY_RESET_ENV_VARS.size === 0) {
    for (const p of Object.values(getAvailableImageToVideoProviders())) {
      if (p.creditType === "daily-reset" && p.envVar) DAILY_RESET_ENV_VARS.add(p.envVar);
    }
  }
  return DAILY_RESET_ENV_VARS;
}

/**
 * Generate a short video clip from a single image.
 * Uses the specified provider with per-provider API key rotation.
 * On quota exhaustion, automatically falls back to every other available
 * provider before giving up.
 */
export async function generateClipFromImage(
  imagePath: string,
  options: {
    providerId?: string;
    prompt?: string;
    durationSec?: number;
    aspectRatio?: "9:16" | "16:9";
  } = {}
): Promise<ImageToVideoResult> {
  const startedAt = Date.now();
  const providerId = options.providerId ?? "SVD_REPLICATE";
  const chain = buildFallbackChain(providerId);
  if (chain.length === 0) {
    throw new Error(`No I2V providers available. Check your API key settings.`);
  }

  const exhausted: string[] = [];

  for (const provider of chain) {
    try {
      const { clip, exhaustedReason } = await tryProviderWithRotation(provider, imagePath, options);
      if (clip) {
        clip.actualProvider = PROVIDER_FRIENDLY_NAMES[provider.id] ?? provider.name;
        if (provider.id !== providerId) {
          log.log(`[I2V]`, `Fallback: ${PROVIDER_FRIENDLY_NAMES[provider.id] ?? provider.id} succeeded (primary ${providerId} exhausted)`);
        } else {
          log.log(`[I2V]`, `${provider.id} succeeded`);
        }
        recordMetric("i2v.provider.call", {
          requestedProvider: providerId,
          actualProvider: provider.id,
          durationMs: Date.now() - startedAt,
          fallbackUsed: provider.id !== providerId,
        });
        return clip;
      }
      const name = PROVIDER_FRIENDLY_NAMES[provider.id] ?? provider.id;
      const reasonTag = exhaustedReason ? ` [${exhaustedReason}]` : "";
      log.warn(`[I2V]`, `${name} exhausted${reasonTag}, trying next provider...`);
      exhausted.push(`${name}${reasonTag}`);
    } catch (err) {
      const name = PROVIDER_FRIENDLY_NAMES[provider.id] ?? provider.id;
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[I2V]`, `${name} error: ${msg.slice(0, 120)}`);
      exhausted.push(`${name} (error: ${msg.slice(0, 80)})`);
    }
  }

  throw new Error(
    `All I2V providers exhausted (tried ${exhausted.join(", ")}). ` +
    `Free tier credits will reset — HuggingFace monthly, ZeroGPU daily. ` +
    `Add more API keys in Settings to increase capacity.`
  );
}

// ---------------------------------------------------------------------------
// Gradio Space I2V — uses ZeroGPU free compute (not Inference API credits)
// ---------------------------------------------------------------------------

async function generateClipViaGradioSpace(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  spaceId: string,
  apiName: string,
  token: string,
  prompt?: string,
  durationSec: number = 3,
  aspectRatio: "9:16" | "16:9" = "9:16",
): Promise<ImageToVideoResult> {
  const baseUrl = `https://${spaceId.toLowerCase()}.hf.space`;
  const headers = { Authorization: `Bearer ${token}` };

  // 1. Upload image to Space
  const imageBuffer = await fs.readFile(imagePath);
  const boundary = `----NarrateAI${Date.now()}`;
  const fname = path.basename(imagePath);
  const uploadBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fname}"\r\nContent-Type: image/jpeg\r\n\r\n`),
    imageBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const uploadRes = await fetch(`${baseUrl}/gradio_api/upload`, {
    method: "POST",
    headers: { ...headers, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: uploadBody,
    signal: AbortSignal.timeout(30_000),
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "");
    throw new Error(`Gradio Space upload ${uploadRes.status}: ${body.slice(0, 200)}`);
  }
  const uploadedPaths = await uploadRes.json() as string[];
  const remotePath = uploadedPaths[0];
  log.debug(`[GradioSpace] Uploaded image: ${remotePath}`);

  // 2. Compute dimensions for aspect ratio
  const [h, w] = aspectRatio === "9:16" ? [480, 272] : [272, 480];

  // 3. Submit generation job
  const callRes = await fetch(`${baseUrl}/gradio_api/call/${apiName}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        (prompt ?? "Cinematic motion, subtle parallax, smooth camera movement").slice(0, 500),
        "worst quality, inconsistent motion, blurry, jittery, distorted",
        { path: remotePath },
        null,     // video_i (unused for I2V)
        h,        // height
        w,        // width
        "image-to-video",
        Math.min(durationSec, 8),
        9,        // frames from input (min for I2V)
        42,       // seed
        true,     // randomize seed
        1,        // guidance scale
        false,    // improve texture (false for speed)
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!callRes.ok) {
    const body = await callRes.text().catch(() => "");
    throw new Error(`Gradio Space ${callRes.status}: ${body.slice(0, 300)}`);
  }
  const { event_id } = await callRes.json() as { event_id: string };
  log.debug(`[GradioSpace] Job submitted: ${event_id}`);

  // 4. Poll SSE stream for completion (up to 5 min for ZeroGPU queue + generation)
  const sseRes = await fetch(`${baseUrl}/gradio_api/call/${apiName}/${event_id}`, {
    headers,
    signal: AbortSignal.timeout(300_000),
  });
  if (!sseRes.ok) {
    throw new Error(`Gradio Space SSE ${sseRes.status}`);
  }
  const sseText = await sseRes.text();

  // Parse SSE events — look for "event: complete" followed by "data: [...]"
  const completeMatch = sseText.match(/event:\s*complete\ndata:\s*(.+)/);
  if (!completeMatch) {
    const errorMatch = sseText.match(/event:\s*error\ndata:\s*(.+)/);
    if (errorMatch) {
      throw new Error(`Gradio Space error: ${errorMatch[1].slice(0, 300)}`);
    }
    throw new Error(`Gradio Space: no completion event in response (${sseText.slice(0, 200)})`);
  }

  // 5. Extract video URL from completion data
  let videoUrl: string;
  try {
    const data = JSON.parse(completeMatch[1]) as unknown[];
    const result = data[0] as { video?: { url?: string; path?: string } };
    videoUrl = result?.video?.url ?? "";
    if (!videoUrl && result?.video?.path) {
      videoUrl = `${baseUrl}/gradio_api/file=${result.video.path}`;
    }
  } catch {
    throw new Error(`Gradio Space: failed to parse result — ${completeMatch[1].slice(0, 200)}`);
  }
  if (!videoUrl) throw new Error("Gradio Space returned no video URL");
  log.debug(`[GradioSpace] Video ready: ${videoUrl}`);

  // 6. Download the video
  const dlRes = await fetch(videoUrl, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!dlRes.ok) throw new Error(`Gradio Space download ${dlRes.status}`);
  const videoBuffer = Buffer.from(await dlRes.arrayBuffer());

  validateVideoBuffer(videoBuffer, "Gradio Space LTX-Video");
  await fs.writeFile(outputPath, videoBuffer);
  log.log(`[GradioSpace]`, `Generated ${(videoBuffer.length / 1024).toFixed(0)}KB video`);

  return { videoPath: outputPath, tmpDir };
}

// ---------------------------------------------------------------------------
// WaveSpeed I2V — async submit + poll via HF Router
// ---------------------------------------------------------------------------

const WAVESPEED_ROUTER = "https://router.huggingface.co/wavespeed";
const WAVESPEED_MAX_POLL_MS = 5 * 60 * 1000;
const WAVESPEED_POLL_INTERVAL_MS = 5_000;

async function generateClipViaWaveSpeed(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  modelId: string,
  token: string,
  prompt?: string,
  durationSec: number = 5,
): Promise<ImageToVideoResult> {
  const imageBuffer = await fs.readFile(imagePath);
  const base64Image = imageBuffer.toString("base64");

  const submitUrl = `${WAVESPEED_ROUTER}/api/v3/${modelId}`;
  log.debug(`[WaveSpeed] POST ${submitUrl}`);

  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image: `data:image/jpeg;base64,${base64Image}`,
      prompt: (prompt ?? "cinematic subtle motion, smooth camera movement").slice(0, 500),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => "");
    throw new Error(`WaveSpeed ${submitRes.status}: ${errText.slice(0, 300)}`);
  }

  const submitJson = (await submitRes.json()) as {
    data?: { id?: string; status?: string; urls?: { get?: string } };
  };
  const jobId = submitJson.data?.id;
  if (!jobId) {
    throw new Error(`WaveSpeed submit returned no job ID: ${JSON.stringify(submitJson).slice(0, 200)}`);
  }
  log.debug(`[WaveSpeed] Job submitted: ${jobId}`);

  const pollUrl = `${WAVESPEED_ROUTER}/api/v3/predictions/${jobId}/result`;
  const startTime = Date.now();

  while (Date.now() - startTime < WAVESPEED_MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, WAVESPEED_POLL_INTERVAL_MS));

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!pollRes.ok) {
      const errText = await pollRes.text().catch(() => "");
      throw new Error(`WaveSpeed poll ${pollRes.status}: ${errText.slice(0, 300)}`);
    }

    const pollJson = (await pollRes.json()) as {
      data?: {
        status?: string;
        outputs?: string[];
        error?: string;
      };
    };
    const status = pollJson.data?.status;

    if (status === "completed") {
      const videoUrl = pollJson.data?.outputs?.[0];
      if (!videoUrl) throw new Error("WaveSpeed completed but no video URL");

      const dlRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
      if (!dlRes.ok) throw new Error(`WaveSpeed download ${dlRes.status}`);
      const videoBuffer = Buffer.from(await dlRes.arrayBuffer());

      validateVideoBuffer(videoBuffer, "WaveSpeed");
      await fs.writeFile(outputPath, videoBuffer);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log.log(`[WaveSpeed]`, `Generated ${(videoBuffer.length / 1024).toFixed(0)}KB video in ${elapsed}s`);
      return { videoPath: outputPath, tmpDir };
    }

    if (status === "failed" || status === "error") {
      throw new Error(`WaveSpeed job failed: ${pollJson.data?.error ?? "unknown error"}`);
    }

    log.debug(`[WaveSpeed] Job ${jobId}: ${status} (${((Date.now() - startTime) / 1000).toFixed(0)}s)`);
  }

  throw new Error(`WaveSpeed job ${jobId} timed out after ${WAVESPEED_MAX_POLL_MS / 1000}s`);
}

const HF_ROUTER_BASE = "https://router.huggingface.co";

/**
 * Local backend video API contract:
 * POST /api/video
 * Request (JSON): { imageBase64: string, prompt?: string, durationSec?: number }
 * Response: binary video (Content-Type: video/mp4) OR JSON { videoBase64: string }
 */
async function generateClipViaLocalBackend(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  baseUrl: string,
  prompt?: string,
  durationSec: number = 5,
): Promise<ImageToVideoResult> {
  const imageBuffer = await fs.readFile(imagePath);
  const imageBase64 = imageBuffer.toString("base64");
  const url = `${baseUrl.replace(/\/+$/, "")}/api/video`;
  const body = JSON.stringify({
    imageBase64,
    prompt: prompt?.slice(0, 500),
    durationSec,
  });

  log.debug(`POST ${url} (${(imageBuffer.length / 1024).toFixed(0)}KB image, ${durationSec}s)`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(300_000),
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
    throw new Error(`Local backend /api/video ${res.status}: ${detail}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const arrayBuffer = await res.arrayBuffer();

  let videoBuffer: Buffer;
  if (contentType.includes("application/json")) {
    const json = JSON.parse(Buffer.from(arrayBuffer).toString("utf-8")) as { videoBase64?: string };
    const b64 = json.videoBase64;
    if (typeof b64 !== "string") {
      throw new Error("Local backend /api/video response missing videoBase64");
    }
    videoBuffer = Buffer.from(b64, "base64");
  } else {
    videoBuffer = Buffer.from(arrayBuffer);
  }

  validateVideoBuffer(videoBuffer, "Local backend");

  await fs.writeFile(outputPath, videoBuffer);
  log.debug(`Local backend clip saved: ${outputPath} (${(videoBuffer.length / 1024).toFixed(0)}KB)`);
  return { videoPath: outputPath, tmpDir };
}

/**
 * Call Hugging Face Inference API for image-to-video or text-to-video.
 * Sends image as binary body; optional prompt via query or JSON params depending on model.
 * Returns video bytes in response body (or in JSON) per HF Inference API behavior.
 */
async function generateClipViaHuggingFace(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  modelId: string,
  token: string,
  prompt?: string,
  durationSec: number = 5,
  hfProvider: string = "hf-inference",
): Promise<ImageToVideoResult> {
  const imageBuffer = await fs.readFile(imagePath);
  const isPng = imagePath.toLowerCase().endsWith(".png");
  const contentType = isPng ? "image/png" : "image/jpeg";

  const url = `${HF_ROUTER_BASE}/${hfProvider}/models/${modelId}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": contentType,
  };

  // Optional prompt for text-conditioned models; append as query param so body stays binary.
  const urlWithParams = prompt
    ? `${url}?${new URLSearchParams({ prompt: prompt.slice(0, 300) }).toString()}`
    : url;

  let res: Response;
  try {
    res = await fetch(urlWithParams, {
      method: "POST",
      headers,
      body: imageBuffer,
      signal: AbortSignal.timeout(300_000), // 5 min
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Hugging Face image-to-video request failed: ${msg}`);
  }

  const responseContentType = res.headers.get("content-type") ?? "";
  const isJson = responseContentType.includes("application/json");

  if (!res.ok) {
    const body = await res.text();
    let errMsg = `Hugging Face ${res.status}: ${res.statusText}`;
    if (body) {
      try {
        const j = JSON.parse(body);
        errMsg += ` — ${(j.error ?? j.message ?? body).toString().slice(0, 300)}`;
      } catch {
        errMsg += ` — ${body.slice(0, 300)}`;
      }
    }
    throw new Error(errMsg);
  }

  const arrayBuffer = await res.arrayBuffer();
  let videoBuffer: Buffer;

  if (isJson) {
    const json = JSON.parse(Buffer.from(arrayBuffer).toString("utf-8")) as unknown;
    const videoB64 = (json as { generated_video?: string; video?: string; output?: string }).generated_video
      ?? (json as { generated_video?: string; video?: string; output?: string }).video
      ?? (json as { generated_video?: string; video?: string; output?: string }).output;
    if (typeof videoB64 !== "string") {
      throw new Error("Hugging Face response did not contain video (generated_video / video / output)");
    }
    videoBuffer = Buffer.from(videoB64, "base64");
  } else {
    videoBuffer = Buffer.from(arrayBuffer);
  }

  validateVideoBuffer(videoBuffer, "Hugging Face");

  await fs.writeFile(outputPath, videoBuffer);
  log.debug(`HF image-to-video clip saved: ${outputPath} (${(videoBuffer.length / 1024).toFixed(0)}KB)`);
  return { videoPath: outputPath, tmpDir };
}

const MIN_CLIP_SIZE = 10_000; // 10 KB — Gradio Space clips (272×480 ~3s) can be 40-50KB

function isValidMp4Buffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const boxType = buf.toString("ascii", 4, 8);
  return boxType === "ftyp";
}

function validateVideoBuffer(buf: Buffer, source: string): void {
  if (buf.length < MIN_CLIP_SIZE) {
    throw new Error(`${source} returned too little data (${buf.length} bytes, need ≥${MIN_CLIP_SIZE})`);
  }
  if (!isValidMp4Buffer(buf)) {
    const preview = buf.toString("utf-8", 0, Math.min(120, buf.length)).replace(/\n/g, " ");
    throw new Error(`${source} returned invalid MP4 (starts with: ${preview.slice(0, 80)}…)`);
  }
}

/** Check if a file on disk is a valid MP4 (ftyp header + minimum size). */
export async function isValidMp4File(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size < MIN_CLIP_SIZE) return false;
    const fd = await fs.open(filePath, "r");
    const header = Buffer.alloc(12);
    await fd.read(header, 0, 12, 0);
    await fd.close();
    return header.toString("ascii", 4, 8) === "ftyp";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Freepik (Kling v2) — async submit + poll
// ---------------------------------------------------------------------------

const FREEPIK_API_BASE = "https://api.freepik.com/v1/ai/image-to-video";

async function generateClipViaFreepik(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  freepikModel: string,
  apiKey: string,
  prompt?: string,
  durationSec: number = 5,
): Promise<ImageToVideoResult> {
  const imageBuffer = await fs.readFile(imagePath);
  const base64Image = imageBuffer.toString("base64");

  const submitUrl = `${FREEPIK_API_BASE}/${freepikModel}`;
  log.debug(`POST ${submitUrl} (Freepik ${freepikModel}, ${durationSec}s)`);

  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-freepik-api-key": apiKey,
    },
    body: JSON.stringify({
      image: `data:image/jpeg;base64,${base64Image}`,
      prompt: (prompt ?? "cinematic subtle motion").slice(0, 500),
      duration: String(Math.min(durationSec, 10)),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => "");
    throw new Error(`Freepik ${freepikModel} ${submitRes.status}: ${errText.slice(0, 300)}`);
  }

  const submitJson = (await submitRes.json()) as {
    data?: { task_id?: string; status?: string };
  };
  const taskId = submitJson.data?.task_id;
  if (!taskId) {
    throw new Error(`Freepik ${freepikModel} submit returned no task_id: ${JSON.stringify(submitJson).slice(0, 200)}`);
  }
  log.debug(`Freepik task submitted: ${taskId}`);

  const pollUrl = `${FREEPIK_API_BASE}/${freepikModel}/${taskId}`;
  const maxPollMs = 5 * 60 * 1000;
  const pollIntervalMs = 5_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const pollRes = await fetch(pollUrl, {
      headers: { "x-freepik-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });

    if (!pollRes.ok) {
      const errText = await pollRes.text().catch(() => "");
      throw new Error(`Freepik poll ${pollRes.status}: ${errText.slice(0, 300)}`);
    }

    const pollJson = (await pollRes.json()) as {
      data?: {
        status?: string;
        generated?: string[];
        error?: string;
      };
    };
    const status = pollJson.data?.status;
    log.debug(`Freepik task ${taskId} status: ${status}`);

    if (status === "COMPLETED") {
      const videoUrl = pollJson.data?.generated?.[0];
      if (!videoUrl) {
        throw new Error("Freepik COMPLETED but no video URL in response");
      }
      const dlRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
      if (!dlRes.ok) {
        throw new Error(`Failed to download Freepik video: ${dlRes.status}`);
      }
      const videoBuffer = Buffer.from(await dlRes.arrayBuffer());
      validateVideoBuffer(videoBuffer, "Freepik");
      await fs.writeFile(outputPath, videoBuffer);
      log.debug(`Freepik clip saved: ${outputPath} (${(videoBuffer.length / 1024).toFixed(0)}KB)`);
      return { videoPath: outputPath, tmpDir };
    }

    if (status === "FAILED" || status === "ERROR") {
      throw new Error(`Freepik task ${taskId} failed: ${pollJson.data?.error ?? "unknown error"}`);
    }
  }

  throw new Error(`Freepik task ${taskId} timed out after ${maxPollMs / 1000}s`);
}

// ---------------------------------------------------------------------------
// fal.ai (MiniMax Hailuo, Kling, Wan, etc.)
// ---------------------------------------------------------------------------

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_MAX_POLL_MS = 5 * 60 * 1000;
const FAL_POLL_INTERVAL_MS = 4_000;

async function uploadImageToFal(imagePath: string, apiKey: string): Promise<string> {
  const imageBuffer = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const fileName = `scene-${Date.now()}${ext || ".jpg"}`;

  const initRes = await fetch(
    "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
    {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content_type: mimeType, file_name: fileName }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => "");
    throw new Error(`fal.ai upload init ${initRes.status}: ${errText.slice(0, 200)}`);
  }

  const { upload_url, file_url } = (await initRes.json()) as { upload_url: string; file_url: string };
  if (!upload_url || !file_url) throw new Error("fal.ai upload init returned no URLs");

  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: imageBuffer,
    signal: AbortSignal.timeout(30_000),
  });

  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => "");
    throw new Error(`fal.ai upload PUT ${putRes.status}: ${errText.slice(0, 200)}`);
  }

  return file_url;
}

async function generateClipViaFal(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  falModelId: string,
  apiKey: string,
  resolution: string,
  prompt?: string,
  durationSec: number = 5,
): Promise<ImageToVideoResult> {
  const imageUrl = await uploadImageToFal(imagePath, apiKey);
  const submitUrl = `${FAL_QUEUE_BASE}/${falModelId}`;
  const falDuration = durationSec <= 6 ? "6" : "10";

  log.debug(`POST ${submitUrl} (fal.ai ${resolution}, ${falDuration}s)`);

  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: (prompt ?? "cinematic subtle motion, high quality").slice(0, 500),
      image_url: imageUrl,
      resolution: resolution.toUpperCase(),
      duration: falDuration,
      prompt_optimizer: true,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => "");
    throw new Error(`fal.ai ${falModelId} ${submitRes.status}: ${errText.slice(0, 300)}`);
  }

  const submitJson = (await submitRes.json()) as {
    request_id?: string;
    status?: string;
    status_url?: string;
    response_url?: string;
  };
  const requestId = submitJson.request_id;
  if (!requestId) {
    throw new Error(`fal.ai submit returned no request_id: ${JSON.stringify(submitJson).slice(0, 200)}`);
  }
  log.debug(`fal.ai request submitted: ${requestId}`);

  const statusUrl = submitJson.status_url ?? `${submitUrl}/requests/${requestId}/status`;
  const resultUrl = submitJson.response_url ?? `${submitUrl}/requests/${requestId}`;
  const startTime = Date.now();

  while (Date.now() - startTime < FAL_MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, FAL_POLL_INTERVAL_MS));

    const pollRes = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!pollRes.ok) {
      const errText = await pollRes.text().catch(() => "");
      if (pollRes.status === 429 || pollRes.status === 402) {
        throw new Error(`fal.ai ${pollRes.status}: ${errText.slice(0, 300)}`);
      }
      log.debug(`fal.ai poll ${pollRes.status}, retrying...`);
      continue;
    }

    const pollJson = (await pollRes.json()) as { status?: string };
    const status = pollJson.status;
    log.debug(`fal.ai request ${requestId} status: ${status}`);

    if (status === "COMPLETED") {
      const resultRes = await fetch(resultUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resultRes.ok) {
        throw new Error(`fal.ai result fetch ${resultRes.status}`);
      }
      const resultJson = (await resultRes.json()) as { video?: { url?: string } };
      const videoUrl = resultJson.video?.url;
      if (!videoUrl) {
        throw new Error("fal.ai COMPLETED but no video URL in response");
      }

      const dlRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
      if (!dlRes.ok) {
        throw new Error(`Failed to download fal.ai video: ${dlRes.status}`);
      }
      const videoBuffer = Buffer.from(await dlRes.arrayBuffer());
      validateVideoBuffer(videoBuffer, "fal.ai");
      await fs.writeFile(outputPath, videoBuffer);
      log.debug(`fal.ai clip saved: ${outputPath} (${(videoBuffer.length / 1024).toFixed(0)}KB)`);
      return { videoPath: outputPath, tmpDir };
    }

    if (status === "FAILED") {
      throw new Error(`fal.ai request ${requestId} failed`);
    }
  }

  throw new Error(`fal.ai request ${requestId} timed out after ${FAL_MAX_POLL_MS / 1000}s`);
}

// ---------------------------------------------------------------------------
// Pollinations
// ---------------------------------------------------------------------------

const POLLINATIONS_API_URL = "https://gen.pollinations.ai";
const POLLINATIONS_MEDIA_URL = "https://media.pollinations.ai";

async function uploadImageToPollinations(imagePath: string, apiKey: string): Promise<string> {
  const imageBuffer = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
  const fileName = `scene${ext || ".jpg"}`;

  const boundary = `----NarrateAI${Date.now()}`;
  const parts: Buffer[] = [];

  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  parts.push(Buffer.from(header, "utf-8"));
  parts.push(imageBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8"));

  const body = Buffer.concat(parts);

  const res = await fetch(`${POLLINATIONS_MEDIA_URL}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${apiKey}`,
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Pollinations media upload failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const json = await res.json() as { url?: string; hash?: string };
  const url = json.url ?? (json.hash ? `${POLLINATIONS_MEDIA_URL}/${json.hash}` : undefined);
  if (!url) {
    throw new Error("Pollinations media upload returned no URL or hash");
  }
  log.debug(`Uploaded image to Pollinations: ${url}`);
  return url;
}

async function generateClipViaPollinations(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  model: string,
  apiKey: string,
  prompt?: string,
  durationSec: number = 5,
  aspectRatio: "9:16" | "16:9" = "9:16",
): Promise<ImageToVideoResult> {
  const maxAttempts = 5;

  const encodedPrompt = encodeURIComponent(
    (prompt ?? "cinematic motion, subtle parallax").slice(0, 500),
  );

  let videoBuffer: Buffer | null = null;
  let lastError = "";
  let imageUrl: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (!imageUrl || attempt > 0) {
        imageUrl = await uploadImageToPollinations(imagePath, apiKey);
      }

      const params = new URLSearchParams({
        model,
        image: imageUrl,
        duration: String(durationSec),
        aspectRatio,
        key: apiKey,
        seed: String(Math.floor(Math.random() * 999999)),
      });
      const url = `${POLLINATIONS_API_URL}/video/${encodedPrompt}?${params.toString()}`;

      log.debug(`GET Pollinations video (${model}, ${durationSec}s, attempt ${attempt + 1}/${maxAttempts})`);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(300_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let detail = errText.slice(0, 300);
        try {
          const j = JSON.parse(errText);
          detail = ((j.error as { message?: string })?.message ?? j.error ?? detail) as string;
        } catch { /* use text */ }
        throw new Error(`Pollinations video ${res.status}: ${detail}`);
      }

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("text/html")) {
        const html = await res.text().catch(() => "");
        throw new Error(`Pollinations returned HTML instead of video: ${html.slice(0, 120)}`);
      }

      if (contentType.includes("application/json")) {
        const json = await res.json() as { url?: string; video?: string; videoUrl?: string };
        const videoUrl = json.url ?? json.videoUrl ?? json.video;
        if (typeof videoUrl === "string" && videoUrl.startsWith("http")) {
          const dlRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
          if (!dlRes.ok) throw new Error(`Failed to download video from ${videoUrl}: ${dlRes.status}`);
          videoBuffer = Buffer.from(await dlRes.arrayBuffer());
        } else {
          throw new Error("Pollinations video response JSON missing video URL");
        }
      } else {
        videoBuffer = Buffer.from(await res.arrayBuffer());
      }

      validateVideoBuffer(videoBuffer, "Pollinations");
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (RETRYABLE_STATUS_RE.test(msg)) throw err;
      lastError = msg;
      log.warn(`Pollinations video attempt ${attempt + 1}/${maxAttempts} failed: ${msg.slice(0, 200)}`);
      videoBuffer = null;
      imageUrl = null;
      if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, 10_000 + attempt * 5_000));
    }
  }

  if (!videoBuffer) {
    throw new Error(`Pollinations video generation failed after ${maxAttempts} attempts. Last error: ${lastError.slice(0, 300)}`);
  }

  await fs.writeFile(outputPath, videoBuffer);
  log.debug(`Pollinations video clip saved: ${outputPath} (${(videoBuffer.length / 1024).toFixed(0)}KB)`);
  return { videoPath: outputPath, tmpDir };
}

async function generateClipViaReplicate(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  replicateModel: string,
  _durationSec: number = 5,
): Promise<ImageToVideoResult> {
  const auth = process.env.REPLICATE_API_TOKEN;
  if (!auth) throw new Error("REPLICATE_API_TOKEN is not configured");

  const replicate = new Replicate({ auth });
  const imageStream = createReadStream(imagePath);

  const input: Record<string, unknown> = {
    input_image: imageStream,
    motion_bucket_id: 127,
    frames_per_second: 6,
    video_length: "25_frames_with_svd_xt",
    cond_aug: 0.02,
    decoding_t: 14,
  };

  const output = await replicate.run(replicateModel as `${string}/${string}`, { input });

  const videoUrl =
    typeof output === "string"
      ? output
      : Array.isArray(output)
        ? output[0]
        : (output as { video?: string })?.video;
  if (!videoUrl || typeof videoUrl !== "string") {
    throw new Error("No video URL in Replicate output");
  }

  const resp = await fetch(videoUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download video: ${resp.status}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(outputPath, buf);
  log.debug(`Image-to-video clip saved: ${outputPath} (${(buf.length / 1024).toFixed(0)}KB)`);
  return { videoPath: outputPath, tmpDir };
}

// ---------------------------------------------------------------------------
// SiliconFlow – Wan2.2-I2V-A14B (async submit → poll)
// ---------------------------------------------------------------------------
async function generateClipViaSiliconFlow(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  apiKey: string,
  prompt?: string,
  durationSec: number = 5,
  aspectRatio: "9:16" | "16:9" = "9:16",
): Promise<ImageToVideoResult> {
  const imageData = await fs.readFile(imagePath);
  const base64 = `data:image/png;base64,${imageData.toString("base64")}`;
  const imageSize = aspectRatio === "9:16" ? "720x1280" : "1280x720";

  const submitRes = await fetch("https://api.siliconflow.cn/v1/video/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "Wan-AI/Wan2.2-I2V-A14B",
      prompt: prompt ?? "Smooth cinematic motion, gentle camera movement",
      image: base64,
      image_size: imageSize,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => "");
    throw new Error(`SiliconFlow submit ${submitRes.status}: ${body.slice(0, 300)}`);
  }
  const { requestId } = (await submitRes.json()) as { requestId: string };
  log.debug(`SiliconFlow job submitted: ${requestId}`);

  const maxPollMs = Math.max(durationSec * 60_000, 300_000);
  const start = Date.now();
  let videoUrl = "";
  while (Date.now() - start < maxPollMs) {
    await new Promise((r) => setTimeout(r, 8_000));
    const statusRes = await fetch("https://api.siliconflow.cn/v1/video/status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ requestId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!statusRes.ok) {
      const body = await statusRes.text().catch(() => "");
      if (RETRYABLE_STATUS_RE.test(String(statusRes.status))) throw new Error(`SiliconFlow status ${statusRes.status}: ${body.slice(0, 200)}`);
      log.warn(`SiliconFlow poll non-OK ${statusRes.status}, retrying...`);
      continue;
    }
    const data = (await statusRes.json()) as {
      status: string;
      reason?: string;
      results?: { videos?: { url: string }[] };
    };
    if (data.status === "Failed") throw new Error(`SiliconFlow generation failed: ${data.reason ?? "unknown"}`);
    if (data.status === "Succeed" && data.results?.videos?.[0]?.url) {
      videoUrl = data.results.videos[0].url;
      break;
    }
  }
  if (!videoUrl) throw new Error(`SiliconFlow timed out after ${(maxPollMs / 1000).toFixed(0)}s`);

  const dlRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
  if (!dlRes.ok) throw new Error(`SiliconFlow download ${dlRes.status}`);
  const videoBuffer = Buffer.from(await dlRes.arrayBuffer());
  validateVideoBuffer(videoBuffer, "SiliconFlow");
  await fs.writeFile(outputPath, videoBuffer);
  log.debug(`SiliconFlow clip saved: ${outputPath} (${(videoBuffer.length / 1024).toFixed(0)}KB)`);
  return { videoPath: outputPath, tmpDir };
}

// ---------------------------------------------------------------------------
// deAPI.ai – LTX-2.3 (multipart submit → poll)
// ---------------------------------------------------------------------------
async function generateClipViaDeApi(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  apiKey: string,
  prompt?: string,
  durationSec: number = 5,
  aspectRatio: "9:16" | "16:9" = "9:16",
): Promise<ImageToVideoResult> {
  const [width, height] = aspectRatio === "9:16" ? [512, 768] : [768, 512];
  const frames = Math.min(Math.max(Math.round(durationSec * 30), 30), 97);

  const imageData = await fs.readFile(imagePath);
  const blob = new Blob([imageData], { type: "image/png" });

  const form = new FormData();
  form.append("prompt", prompt ?? "Smooth cinematic motion, gentle camera movement");
  form.append("first_frame_image", blob, "frame.png");
  form.append("model", "Ltxv_13B_0_9_8_Distilled_FP8");
  form.append("width", String(width));
  form.append("height", String(height));
  form.append("guidance", "1");
  form.append("steps", "1");
  form.append("frames", String(frames));
  form.append("fps", "30");
  form.append("seed", String(Math.floor(Math.random() * 2147483647)));

  const submitRes = await fetch("https://api.deapi.ai/api/v1/client/img2video", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => "");
    throw new Error(`deAPI submit ${submitRes.status}: ${body.slice(0, 300)}`);
  }
  const submitData = (await submitRes.json()) as { data?: { request_id?: string } };
  const requestId = submitData?.data?.request_id;
  if (!requestId) throw new Error(`deAPI returned no request_id: ${JSON.stringify(submitData).slice(0, 200)}`);
  log.debug(`deAPI job submitted: ${requestId}`);

  const maxPollMs = Math.max(durationSec * 60_000, 300_000);
  const start = Date.now();
  let resultUrl = "";
  while (Date.now() - start < maxPollMs) {
    await new Promise((r) => setTimeout(r, 8_000));
    const statusRes = await fetch(`https://api.deapi.ai/api/v1/client/request-status/${requestId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!statusRes.ok) {
      const body = await statusRes.text().catch(() => "");
      if (RETRYABLE_STATUS_RE.test(String(statusRes.status))) throw new Error(`deAPI status ${statusRes.status}: ${body.slice(0, 200)}`);
      log.warn(`deAPI poll non-OK ${statusRes.status}, retrying...`);
      continue;
    }
    const data = (await statusRes.json()) as {
      status: string;
      result_url?: string | null;
    };
    if (data.status === "error") throw new Error("deAPI generation failed");
    if (data.status === "done" && data.result_url) {
      resultUrl = data.result_url;
      break;
    }
  }
  if (!resultUrl) throw new Error(`deAPI timed out after ${(maxPollMs / 1000).toFixed(0)}s`);

  const dlRes = await fetch(resultUrl, { signal: AbortSignal.timeout(60_000) });
  if (!dlRes.ok) throw new Error(`deAPI download ${dlRes.status}`);
  const videoBuffer = Buffer.from(await dlRes.arrayBuffer());
  validateVideoBuffer(videoBuffer, "deAPI");
  await fs.writeFile(outputPath, videoBuffer);
  log.debug(`deAPI clip saved: ${outputPath} (${(videoBuffer.length / 1024).toFixed(0)}KB)`);
  return { videoPath: outputPath, tmpDir };
}

// ---------------------------------------------------------------------------
// PixVerse – V5/V5.5 (upload image → submit I2V → poll → download)
// ---------------------------------------------------------------------------
async function generateClipViaPixVerse(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  apiKey: string,
  prompt?: string,
  durationSec: number = 5,
  aspectRatio: "9:16" | "16:9" = "9:16",
): Promise<ImageToVideoResult> {
  const PIXVERSE_BASE = "https://app-api.pixverse.ai/openapi/v2";

  const imageData = await fs.readFile(imagePath);
  const blob = new Blob([imageData], { type: "image/png" });
  const uploadForm = new FormData();
  uploadForm.append("image", blob, "frame.png");

  const uploadTraceId = crypto.randomUUID();
  const uploadRes = await fetch(`${PIXVERSE_BASE}/image/upload`, {
    method: "POST",
    headers: { "API-KEY": apiKey, "Ai-trace-id": uploadTraceId },
    body: uploadForm,
    signal: AbortSignal.timeout(60_000),
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "");
    throw new Error(`PixVerse upload ${uploadRes.status}: ${body.slice(0, 300)}`);
  }
  const uploadData = (await uploadRes.json()) as { ErrCode: number; ErrMsg: string; Resp?: { img_id: number } };
  if (uploadData.ErrCode !== 0 || !uploadData.Resp?.img_id) {
    throw new Error(`PixVerse upload error: ${uploadData.ErrMsg ?? JSON.stringify(uploadData).slice(0, 200)}`);
  }
  const imgId = uploadData.Resp.img_id;
  log.debug(`PixVerse image uploaded: img_id=${imgId}`);

  const duration = durationSec <= 5 ? 5 : 8;
  const genTraceId = crypto.randomUUID();
  const genRes = await fetch(`${PIXVERSE_BASE}/video/img/generate`, {
    method: "POST",
    headers: { "API-KEY": apiKey, "Ai-trace-id": genTraceId, "Content-Type": "application/json" },
    body: JSON.stringify({
      duration,
      img_id: imgId,
      model: "v5",
      motion_mode: "normal",
      prompt: prompt ?? "Smooth cinematic motion, gentle camera movement",
      quality: "540p",
      seed: Math.floor(Math.random() * 2147483647),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!genRes.ok) {
    const body = await genRes.text().catch(() => "");
    throw new Error(`PixVerse generate ${genRes.status}: ${body.slice(0, 300)}`);
  }
  const genData = (await genRes.json()) as { ErrCode: number; ErrMsg: string; Resp?: { video_id: number } };
  if (genData.ErrCode !== 0 || !genData.Resp?.video_id) {
    const msg = genData.ErrMsg ?? JSON.stringify(genData).slice(0, 200);
    const isBalance = /insufficient balance|unable to generate|no credits/i.test(msg);
    throw new Error(`PixVerse ${isBalance ? "402" : "generate error"}: ${msg}`);
  }
  const videoId = genData.Resp.video_id;
  log.debug(`PixVerse job submitted: video_id=${videoId}`);

  const maxPollMs = 300_000;
  const start = Date.now();
  let videoUrl = "";
  while (Date.now() - start < maxPollMs) {
    await new Promise((r) => setTimeout(r, 8_000));
    const pollTraceId = crypto.randomUUID();
    const statusRes = await fetch(`${PIXVERSE_BASE}/video/result/${videoId}`, {
      headers: { "API-KEY": apiKey, "Ai-trace-id": pollTraceId },
      signal: AbortSignal.timeout(30_000),
    });
    if (!statusRes.ok) {
      const body = await statusRes.text().catch(() => "");
      if (RETRYABLE_STATUS_RE.test(String(statusRes.status))) throw new Error(`PixVerse status ${statusRes.status}: ${body.slice(0, 200)}`);
      log.warn(`PixVerse poll non-OK ${statusRes.status}, retrying...`);
      continue;
    }
    const data = (await statusRes.json()) as {
      ErrCode: number;
      Resp?: { status: number; url?: string };
    };
    const st = data.Resp?.status;
    if (st === 7) throw new Error("PixVerse generation failed: content moderation");
    if (st === 8) throw new Error("PixVerse generation failed");
    if (st === 1 && data.Resp?.url) {
      videoUrl = data.Resp.url;
      break;
    }
  }
  if (!videoUrl) throw new Error(`PixVerse timed out after ${(maxPollMs / 1000).toFixed(0)}s`);

  const dlRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
  if (!dlRes.ok) throw new Error(`PixVerse download ${dlRes.status}`);
  const videoBuffer = Buffer.from(await dlRes.arrayBuffer());
  validateVideoBuffer(videoBuffer, "PixVerse");
  await fs.writeFile(outputPath, videoBuffer);
  log.debug(`PixVerse clip saved: ${outputPath} (${(videoBuffer.length / 1024).toFixed(0)}KB)`);
  return { videoPath: outputPath, tmpDir };
}

// ---------------------------------------------------------------------------
// Leonardo AI – Motion 2.0 Fast (upload → generate → poll → download)
// ---------------------------------------------------------------------------
const LEONARDO_BASE = "https://cloud.leonardo.ai/api/rest/v1";
const LEONARDO_MAX_POLL_MS = 5 * 60 * 1000;
const LEONARDO_POLL_INTERVAL_MS = 4_000;

async function uploadImageToLeonardo(imagePath: string, apiKey: string): Promise<string> {
  const ext = path.extname(imagePath).toLowerCase().replace(".", "") || "jpg";
  const extension = ["png", "jpg", "jpeg", "webp"].includes(ext) ? ext : "jpg";

  const initRes = await fetch(`${LEONARDO_BASE}/init-image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ extension }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => "");
    throw new Error(`Leonardo init-image ${initRes.status}: ${errText.slice(0, 200)}`);
  }

  const initData = (await initRes.json()) as {
    uploadInitImage?: { id?: string; url?: string; fields?: string; key?: string };
  };
  const upload = initData.uploadInitImage;
  if (!upload?.id || !upload.url || !upload.fields) {
    throw new Error("Leonardo init-image returned incomplete data");
  }

  const fields = JSON.parse(upload.fields) as Record<string, string>;
  const imageBuffer = await fs.readFile(imagePath);

  const boundary = `----LeoUpload${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
    ));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.${extension}"\r\nContent-Type: image/${extension === "jpg" ? "jpeg" : extension}\r\n\r\n`,
  ));
  parts.push(imageBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const uploadRes = await fetch(upload.url, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(parts),
    signal: AbortSignal.timeout(30_000),
  });

  if (!uploadRes.ok && uploadRes.status !== 204) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`Leonardo S3 upload ${uploadRes.status}: ${errText.slice(0, 200)}`);
  }

  log.debug(`[Leonardo] Image uploaded: id=${upload.id}`);
  return upload.id;
}

async function generateClipViaLeonardo(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  apiKey: string,
  prompt?: string,
  durationSec: number = 5,
): Promise<ImageToVideoResult> {
  const imageId = await uploadImageToLeonardo(imagePath, apiKey);

  const genRes = await fetch(`${LEONARDO_BASE}/generations-image-to-video`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imageId,
      imageType: "UPLOADED",
      prompt: (prompt ?? "Smooth cinematic motion, gentle camera movement").slice(0, 500),
      model: "MOTION2FAST",
      isPublic: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!genRes.ok) {
    const body = await genRes.text().catch(() => "");
    throw new Error(`Leonardo I2V ${genRes.status}: ${body.slice(0, 300)}`);
  }

  const genData = (await genRes.json()) as {
    motionVideoGenerationJob?: { generationId?: string };
  };
  const generationId = genData.motionVideoGenerationJob?.generationId;
  if (!generationId) {
    throw new Error(`Leonardo I2V returned no generationId: ${JSON.stringify(genData).slice(0, 200)}`);
  }
  log.debug(`[Leonardo] I2V job submitted: ${generationId}`);

  const startTime = Date.now();
  while (Date.now() - startTime < LEONARDO_MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, LEONARDO_POLL_INTERVAL_MS));

    const pollRes = await fetch(`${LEONARDO_BASE}/generations/${generationId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!pollRes.ok) {
      if (RETRYABLE_STATUS_RE.test(String(pollRes.status))) {
        throw new Error(`Leonardo poll ${pollRes.status}`);
      }
      log.debug(`[Leonardo] Poll non-OK ${pollRes.status}, retrying...`);
      continue;
    }

    const pollData = (await pollRes.json()) as {
      generations_by_pk?: {
        status?: string;
        generated_images?: Array<{ url?: string; motionMP4URL?: string }>;
      };
    };
    const gen = pollData.generations_by_pk;
    const status = gen?.status;

    if (status === "COMPLETE") {
      const videoUrl =
        gen?.generated_images?.[0]?.motionMP4URL ??
        gen?.generated_images?.[0]?.url;
      if (!videoUrl) {
        throw new Error("Leonardo I2V COMPLETE but no video URL in response");
      }

      const dlRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
      if (!dlRes.ok) throw new Error(`Leonardo download ${dlRes.status}`);
      const videoBuffer = Buffer.from(await dlRes.arrayBuffer());

      validateVideoBuffer(videoBuffer, "Leonardo AI");
      await fs.writeFile(outputPath, videoBuffer);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log.log(`[Leonardo]`, `Generated ${(videoBuffer.length / 1024).toFixed(0)}KB video in ${elapsed}s`);
      return { videoPath: outputPath, tmpDir };
    }

    if (status === "FAILED") {
      throw new Error("Leonardo I2V generation failed");
    }

    log.debug(`[Leonardo] Generation ${generationId}: ${status} (${((Date.now() - startTime) / 1000).toFixed(0)}s)`);
  }

  throw new Error(`Leonardo I2V timed out after ${LEONARDO_MAX_POLL_MS / 1000}s`);
}

// ---------------------------------------------------------------------------
// Gemini Veo 3.1 Fast – via @google/genai SDK (submit → poll → download)
// ---------------------------------------------------------------------------
const VEO_MAX_POLL_MS = 5 * 60 * 1000;
const VEO_POLL_INTERVAL_MS = 5_000;

async function generateClipViaGeminiVeo(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  apiKey: string,
  prompt?: string,
  durationSec: number = 5,
  aspectRatio: "9:16" | "16:9" = "9:16",
): Promise<ImageToVideoResult> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const imageBuffer = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

  log.debug(`[Veo] Submitting I2V (${aspectRatio}, ${durationSec}s)`);

  let operation = await ai.models.generateVideos({
    model: "veo-3.1-fast-generate-preview",
    prompt: (prompt ?? "Smooth cinematic motion, gentle camera movement").slice(0, 500),
    image: {
      imageBytes: imageBuffer.toString("base64"),
      mimeType,
    },
    config: {
      aspectRatio,
      numberOfVideos: 1,
    },
  });

  log.debug(`[Veo] Job submitted, polling...`);

  const startTime = Date.now();
  while (!operation.done && Date.now() - startTime < VEO_MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, VEO_POLL_INTERVAL_MS));
    operation = await ai.operations.getVideosOperation({ operation });
    log.debug(`[Veo] Poll: done=${operation.done} (${((Date.now() - startTime) / 1000).toFixed(0)}s)`);
  }

  if (!operation.done) {
    throw new Error(`Veo timed out after ${VEO_MAX_POLL_MS / 1000}s`);
  }

  if (operation.error) {
    const errMsg = JSON.stringify(operation.error).slice(0, 300);
    const isQuota = /quota|limit|429|402|billing/i.test(errMsg);
    throw new Error(`Veo ${isQuota ? "402" : "generation error"}: ${errMsg}`);
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) {
    throw new Error("Veo completed but no video URI in response");
  }

  const dlRes = await fetch(videoUri, {
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(120_000),
  });
  if (!dlRes.ok) throw new Error(`Veo download ${dlRes.status}`);
  const videoBuffer = Buffer.from(await dlRes.arrayBuffer());

  validateVideoBuffer(videoBuffer, "Gemini Veo");
  await fs.writeFile(outputPath, videoBuffer);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log.log(`[Veo]`, `Generated ${(videoBuffer.length / 1024).toFixed(0)}KB video in ${elapsed}s`);
  return { videoPath: outputPath, tmpDir };
}

// ---------------------------------------------------------------------------
// Daily I2V budget tracker — file-based, resets each calendar day
// ---------------------------------------------------------------------------
const BUDGET_FILE = path.join(os.tmpdir(), "narrateai-i2v-daily.json");

interface DailyUsage { date: string; clips: number }

export async function getI2VDailyUsage(): Promise<DailyUsage> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = await fs.readFile(BUDGET_FILE, "utf-8");
    const data = JSON.parse(raw) as DailyUsage;
    if (data.date === today) return data;
  } catch { /* file missing or corrupt → fresh day */ }
  return { date: today, clips: 0 };
}

async function recordI2VClips(count: number): Promise<void> {
  const usage = await getI2VDailyUsage();
  usage.clips += count;
  await fs.writeFile(BUDGET_FILE, JSON.stringify(usage), "utf-8").catch(() => {});
}

/**
 * Calculate how many I2V slots this video should use, given the daily budget.
 * Always reserves at least 1 slot for the hook (scene 0).
 */
export function calculateI2VAllocation(totalSlots: number, cachedSlots: number): {
  maxSlots: number;
  reason: string;
} {
  const perVideo = parseInt(process.env.I2V_MAX_CLIPS_PER_VIDEO ?? "0") || totalSlots;
  const cap = Math.min(totalSlots, perVideo);
  const slotsNeeded = Math.max(0, cap - cachedSlots);

  if (slotsNeeded <= 0) return { maxSlots: totalSlots, reason: "all cached" };
  return { maxSlots: cap, reason: `${cap}/${totalSlots} slots (I2V_MAX_CLIPS_PER_VIDEO=${perVideo})` };
}

/** Return per-provider exhaustion status for the dashboard. */
export function getI2VProviderStatus(): Array<{
  id: string;
  name: string;
  creditType: "one-time" | "daily-reset";
  costEstimate: string;
  configured: boolean;
  totalKeys: number;
  availableKeys: number;
  exhaustedKeys: ProviderExhaustionStatus["exhaustedKeys"];
}> {
  const available = getAvailableImageToVideoProviders();
  const allProviders = Object.values(IMAGE_TO_VIDEO_PROVIDERS);

  return allProviders
    .filter((p) => p.type !== "local")
    .map((p) => {
      const configured = available.some((a) => a.id === p.id);
      const rotator = configured && KEY_ROTATABLE_TYPES.has(p.type) && p.envVar
        ? getKeyRotator(p.envVar)
        : null;
      const status = rotator ? rotator.getStatus(p.envVar) : null;

      return {
        id: p.id,
        name: PROVIDER_FRIENDLY_NAMES[p.id] ?? p.name,
        creditType: p.creditType,
        costEstimate: p.costEstimate ?? "—",
        configured,
        totalKeys: status?.totalKeys ?? 0,
        availableKeys: status?.availableKeys ?? 0,
        exhaustedKeys: status?.exhaustedKeys ?? [],
      };
    });
}

/**
 * Generate clips for multiple scene images (parallel, concurrency-limited).
 * When noFallback is true, any scene failure throws (no static-image fallback).
 * Pass existingClips to reuse already-valid clips and only regenerate missing ones.
 * `maxSlots` limits how many slots (starting from 0) will attempt I2V; remaining
 * get null immediately so the caller can use static images for them.
 * Returns { results, ctxLines } — ctxLines are detailed log lines for context.txt.
 */
export async function generateClipsFromImages(
  imagePaths: string[],
  options: {
    providerId?: string;
    prompts?: string[];
    durationSec?: number;
    noFallback?: boolean;
    existingClips?: Map<number, string>;
    concurrency?: number;
    aspectRatio?: "9:16" | "16:9";
    maxSlots?: number;
  } = {}
): Promise<{ results: (string | null)[]; ctxLines: string[]; actualI2VProvider?: string }> {
  let concurrency = options.concurrency ?? 3;
  const results: (string | null)[] = new Array(imagePaths.length).fill(null);
  const durationSec = options.durationSec ?? 5;
  const noFallback = options.noFallback === true;
  const existing = options.existingClips;
  const maxSlots = options.maxSlots ?? imagePaths.length;
  const ctx: string[] = [];
  const providerCounts: Record<string, number> = {};

  const primaryId = options.providerId ?? "SVD_REPLICATE";
  ctx.push(`Provider : ${primaryId}`);
  ctx.push(`Scenes   : ${imagePaths.length}  MaxI2V: ${maxSlots}  Concurrency: ${concurrency}  Duration: ${durationSec}s  NoFallback: ${noFallback}`);
  ctx.push("");

  const toGenerate: number[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const tag = `scene-${i.toString().padStart(3, "0")}`;
    if (existing?.has(i)) {
      results[i] = existing.get(i)!;
      ctx.push(`${tag}  CACHED  ${path.basename(existing.get(i)!)}`);
      continue;
    }
    if (i >= maxSlots) {
      ctx.push(`${tag}  SKIP    budget limit (slot ${i} >= maxSlots ${maxSlots})`);
      continue;
    }
    toGenerate.push(i);
    ctx.push(`${tag}  QUEUED  src=${path.basename(imagePaths[i])}  prompt="${options.prompts?.[i] ?? ""}"`);
  }
  ctx.push("");

  if (toGenerate.length === 0) {
    log.log(`[I2V]`, `All ${imagePaths.length} clips cached`);
    ctx.push(`Result: all cached, nothing to generate`);
    return { results, ctxLines: ctx };
  }

  // Only reset daily-reset providers (Leonardo, Pollinations, HF, etc.).
  // One-time credit providers keep exhaustion state across builds.
  resetDailyExhaustion(getDailyResetEnvVars());

  const chain = buildFallbackChain(primaryId);

  // Check group availability
  let groupAAvailable = false;
  let groupBAvailable = false;
  const exhaustedProviders: string[] = [];
  for (const p of chain) {
    if (KEY_ROTATABLE_TYPES.has(p.type) && p.envVar) {
      const rotator = getKeyRotator(p.envVar);
      if (rotator.availableCount > 0) {
        if (p.creditType === "one-time") groupAAvailable = true;
        else groupBAvailable = true;
      } else {
        exhaustedProviders.push(PROVIDER_FRIENDLY_NAMES[p.id] ?? p.id);
      }
    } else if (p.type === "local" || p.type === "replicate") {
      groupAAvailable = true;
    }
  }

  const anyAvailable = groupAAvailable || groupBAvailable;
  const groupBOnly = !groupAAvailable && groupBAvailable;

  const chainNames = chain.map((p) => {
    const name = PROVIDER_FRIENDLY_NAMES[p.id] ?? p.id;
    const rotator = KEY_ROTATABLE_TYPES.has(p.type) && p.envVar ? getKeyRotator(p.envVar) : null;
    const keys = rotator ? `${rotator.availableCount}/${rotator.count} keys` : (p.type === "local" ? "local" : "n/a");
    const group = p.creditType === "one-time" ? "A" : "B";
    return `${name} [${group}] (${keys})`;
  });
  ctx.push(`Fallback chain (${chain.length} providers): ${chainNames.join(" → ")}`);
  if (groupBOnly) {
    ctx.push(`⚠ Group A (one-time) exhausted — running on Group B (daily-reset) only, concurrency=1`);
    concurrency = 1;
  }
  ctx.push("");

  if (!anyAvailable && chain.length > 0) {
    const msg = `All ${exhaustedProviders.length} I2V providers currently exhausted — skipping I2V entirely. Exhausted: ${exhaustedProviders.join(", ")}`;
    log.warn(`[I2V]`, msg);
    ctx.push(`SKIPPED: ${msg}`);
    ctx.push("");
    ctx.push(`Result: 0 ok, 0 failed, ${existing?.size ?? 0} cached, ${toGenerate.length} skipped (all providers exhausted)`);
    return { results, ctxLines: ctx };
  }

  log.log(`[I2V]`, `Generating ${toGenerate.length}/${imagePaths.length} clips (×${concurrency} parallel, ${primaryId}${groupBOnly ? " [Group B only]" : ""})`);

  let active = 0;
  let nextIdx = 0;
  let doneCount = 0;
  let circuitOpen = false;
  const errors: Array<{ idx: number; msg: string }> = [];

  await new Promise<void>((resolve) => {
    let completed = 0;

    function launch() {
      while (active < concurrency && nextIdx < toGenerate.length) {
        const qIdx = nextIdx++;
        const i = toGenerate[qIdx];
        const tag = `scene-${i.toString().padStart(3, "0")}`;
        active++;

        if (circuitOpen) {
          const msg = "skipped (all providers exhausted by earlier scene)";
          ctx.push(`${tag}  SKIP    ${msg}`);
          errors.push({ idx: i, msg });
          active--;
          completed++;
          if (completed === toGenerate.length) { resolve(); return; }
          continue;
        }

        const start = Date.now();
        generateClipFromImage(imagePaths[i], {
          providerId: options.providerId,
          prompt: options.prompts?.[i],
          durationSec,
          aspectRatio: options.aspectRatio ?? "9:16",
        })
          .then(async ({ videoPath, actualProvider }) => {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            const size = await fs.stat(videoPath).then(s => (s.size / 1024).toFixed(0)).catch(() => "?");
            results[i] = videoPath;
            doneCount++;
            if (actualProvider) providerCounts[actualProvider] = (providerCounts[actualProvider] ?? 0) + 1;
            log.log(`[I2V]`, `${tag} done (${doneCount}/${toGenerate.length}) ${elapsed}s ${size}KB via ${actualProvider ?? "?"}`);
            ctx.push(`${tag}  OK      ${elapsed}s  ${size}KB  via=${actualProvider ?? "?"}  output=${videoPath}`);
          })
          .catch(async (err) => {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`[I2V]`, `${tag} FAILED ${elapsed}s`);
            ctx.push(`${tag}  FAILED  ${elapsed}s  error=${msg}`);
            errors.push({ idx: i, msg });
            results[i] = null;
            if (msg.includes("All I2V providers exhausted")) {
              circuitOpen = true;
              log.warn(`[I2V]`, `Circuit breaker tripped — remaining scenes will use static images`);
            }
          })
          .finally(() => {
            active--;
            completed++;
            if (completed === toGenerate.length) resolve();
            else launch();
          });
      }
    }

    launch();
  });

  if (doneCount > 0) await recordI2VClips(doneCount);

  const skipped = imagePaths.length - (toGenerate.length + (existing?.size ?? 0));
  const summary = `${doneCount} ok, ${errors.length} failed, ${existing?.size ?? 0} cached, ${skipped} skipped (budget)`;
  log.log(`[I2V]`, `Done: ${summary}`);
  ctx.push("");
  ctx.push(`Result: ${summary}`);

  if (noFallback && errors.length > 0) {
    const detail = errors.map(e => `scene-${e.idx.toString().padStart(3, "0")}: ${e.msg.slice(0, 100)}`).join(" | ");
    throw new Error(`${errors.length} scene(s) I2V failed (no fallback): ${detail}`);
  }

  const actualI2VProvider = Object.entries(providerCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return { results, ctxLines: ctx, actualI2VProvider };
}

