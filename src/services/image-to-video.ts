import Replicate from "replicate";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createReadStream } from "fs";
import { createLogger } from "@/lib/logger";
import {
  getImageToVideoProvider,
  type ImageToVideoProviderInfo,
} from "@/config/image-to-video-providers";
import { getLocalBackendUrl, wrapLocalBackendFetchError } from "@/lib/local-backend";
import { requireHuggingFaceToken } from "@/lib/huggingface";
import { getKeyRotator, DEFAULT_EXHAUSTION_TTL_MS, RATE_LIMIT_TTL_MS } from "@/lib/api-key-rotation";

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
}

const RETRYABLE_STATUS_RE = /\b(402|429|503)\b/;

function isRetryableI2VError(err: Error): boolean {
  return RETRYABLE_STATUS_RE.test(err.message);
}

const KEY_ROTATABLE_TYPES = new Set<string>(["pollinations", "huggingface", "freepik"]);

const PROVIDER_FRIENDLY_NAMES: Record<string, string> = {
  POLLINATIONS_GROK_VIDEO: "Pollinations",
  KLING_FREEPIK: "Kling (Freepik)",
  HF_LTX_VIDEO: "HuggingFace LTX-Video",
  HF_WAN_I2V: "HuggingFace Wan I2V",
  SVD_REPLICATE: "Replicate SVD",
  LOCAL_BACKEND: "Local Backend",
};

function userFriendlyI2VError(providerId: string, err: Error): Error {
  const name = PROVIDER_FRIENDLY_NAMES[providerId] ?? providerId;
  const msg = err.message;

  if (msg.includes("402"))
    return new Error(`${name} free quota exhausted. Add more API keys in Settings or switch to a different I2V provider.`);
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
  throw new Error(`Missing config for image-to-video provider: ${provider.id}`);
}

/**
 * Generate a short video clip from a single image.
 * Uses the specified provider with per-provider API key rotation.
 */
export async function generateClipFromImage(
  imagePath: string,
  options: {
    providerId?: string;
    /** Optional motion prompt (used by some models; SVD typically uses image only) */
    prompt?: string;
    /** Target duration in seconds; may be capped by model (e.g. 5–10s) */
    durationSec?: number;
    /** Output aspect ratio; 16:9 for cinematic long-form. */
    aspectRatio?: "9:16" | "16:9";
  } = {}
): Promise<ImageToVideoResult> {
  const providerId = options.providerId ?? "SVD_REPLICATE";
  const provider = getImageToVideoProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown I2V provider "${providerId}". Check your automation settings.`);
  }

  if (KEY_ROTATABLE_TYPES.has(provider.type) && provider.envVar) {
    const rotator = getKeyRotator(provider.envVar);
    if (!rotator.hasKeys) {
      throw userFriendlyI2VError(providerId, new Error(`${provider.envVar} is not configured`));
    }

    let lastKeyError: Error | null = null;
    while (true) {
      const key = rotator.getNextKey();
      if (!key) {
        throw userFriendlyI2VError(
          providerId,
          lastKeyError ?? new Error("All API keys exhausted (402/429)"),
        );
      }

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-i2v-"));
      const outputPath = path.join(tmpDir, "clip.mp4");
      try {
        const result = await dispatchToProvider(provider, imagePath, outputPath, tmpDir, options, key);
        log.log(`[I2V]`, `${providerId} succeeded`);
        return result;
      } catch (err) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        lastKeyError = err instanceof Error ? err : new Error(String(err));
        if (isRetryableI2VError(lastKeyError)) {
          const ttl = lastKeyError.message.includes("429") ? RATE_LIMIT_TTL_MS : DEFAULT_EXHAUSTION_TTL_MS;
          rotator.markExhausted(key, ttl, lastKeyError.message.slice(0, 100));
          continue;
        }
        throw userFriendlyI2VError(providerId, lastKeyError);
      }
    }
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-i2v-"));
  const outputPath = path.join(tmpDir, "clip.mp4");
  try {
    const result = await dispatchToProvider(provider, imagePath, outputPath, tmpDir, options);
    log.log(`[I2V]`, `${providerId} succeeded`);
    return result;
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    const wrapped = err instanceof Error ? err : new Error(String(err));
    throw userFriendlyI2VError(providerId, wrapped);
  }
}

const HF_INFERENCE_URL = "https://router.huggingface.co/hf-inference/models";

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
): Promise<ImageToVideoResult> {
  const imageBuffer = await fs.readFile(imagePath);
  const isPng = imagePath.toLowerCase().endsWith(".png");
  const contentType = isPng ? "image/png" : "image/jpeg";

  const url = `${HF_INFERENCE_URL}/${modelId}`;
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

const MIN_CLIP_SIZE = 50_000; // 50 KB — real 5s clips are typically 500KB+

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

/**
 * Generate clips for multiple scene images (parallel, concurrency-limited).
 * When noFallback is true, any scene failure throws (no static-image fallback).
 * Pass existingClips to reuse already-valid clips and only regenerate missing ones.
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
  } = {}
): Promise<{ results: (string | null)[]; ctxLines: string[] }> {
  const concurrency = options.concurrency ?? 3;
  const results: (string | null)[] = new Array(imagePaths.length).fill(null);
  const durationSec = options.durationSec ?? 5;
  const noFallback = options.noFallback === true;
  const existing = options.existingClips;
  const ctx: string[] = [];

  ctx.push(`Provider : ${options.providerId}`);
  ctx.push(`Scenes   : ${imagePaths.length}  Concurrency: ${concurrency}  Duration: ${durationSec}s  NoFallback: ${noFallback}`);
  ctx.push("");

  const toGenerate: number[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const tag = `scene-${i.toString().padStart(3, "0")}`;
    if (existing?.has(i)) {
      results[i] = existing.get(i)!;
      ctx.push(`${tag}  CACHED  ${path.basename(existing.get(i)!)}`);
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

  log.log(`[I2V]`, `Generating ${toGenerate.length}/${imagePaths.length} clips (×${concurrency} parallel, ${options.providerId})`);

  let active = 0;
  let nextIdx = 0;
  let doneCount = 0;
  const errors: Array<{ idx: number; msg: string }> = [];

  await new Promise<void>((resolve) => {
    let completed = 0;

    function launch() {
      while (active < concurrency && nextIdx < toGenerate.length) {
        const qIdx = nextIdx++;
        const i = toGenerate[qIdx];
        const tag = `scene-${i.toString().padStart(3, "0")}`;
        active++;

        const start = Date.now();
        generateClipFromImage(imagePaths[i], {
          providerId: options.providerId,
          prompt: options.prompts?.[i],
          durationSec,
          aspectRatio: options.aspectRatio ?? "9:16",
        })
          .then(async ({ videoPath }) => {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            const size = await fs.stat(videoPath).then(s => (s.size / 1024).toFixed(0)).catch(() => "?");
            results[i] = videoPath;
            doneCount++;
            log.log(`[I2V]`, `${tag} done (${doneCount}/${toGenerate.length}) ${elapsed}s ${size}KB`);
            ctx.push(`${tag}  OK      ${elapsed}s  ${size}KB  output=${videoPath}`);
          })
          .catch(async (err) => {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`[I2V]`, `${tag} FAILED ${elapsed}s`);
            ctx.push(`${tag}  FAILED  ${elapsed}s  error=${msg}`);
            errors.push({ idx: i, msg });
            results[i] = null;
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

  const summary = `${doneCount} ok, ${errors.length} failed, ${existing?.size ?? 0} cached`;
  log.log(`[I2V]`, `Done: ${summary}`);
  ctx.push("");
  ctx.push(`Result: ${summary}`);

  if (noFallback && errors.length > 0) {
    const detail = errors.map(e => `scene-${e.idx.toString().padStart(3, "0")}: ${e.msg.slice(0, 100)}`).join(" | ");
    throw new Error(`${errors.length} scene(s) I2V failed (no fallback): ${detail}`);
  }

  return { results, ctxLines: ctx };
}
