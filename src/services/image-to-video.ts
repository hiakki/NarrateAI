import Replicate from "replicate";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createReadStream } from "fs";
import { createLogger } from "@/lib/logger";
import {
  getImageToVideoProvider,
} from "@/config/image-to-video-providers";
import { getLocalBackendUrl, wrapLocalBackendFetchError } from "@/lib/local-backend";
import { requireHuggingFaceToken } from "@/lib/huggingface";

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

/**
 * Generate a short video clip (typically 4–10s) from a single image using the given provider.
 * Supports Replicate (SVD), Hugging Face Inference (LTX-Video, Wan I2V), and Pollinations (Grok Video, Wan 2.6, Seedance).
 */
export async function generateClipFromImage(
  imagePath: string,
  options: {
    providerId?: string;
    /** Optional motion prompt (used by some models; SVD typically uses image only) */
    prompt?: string;
    /** Target duration in seconds; may be capped by model (e.g. 5–10s) */
    durationSec?: number;
  } = {}
): Promise<ImageToVideoResult> {
  const providerId = options.providerId ?? "SVD_REPLICATE";
  const provider = getImageToVideoProvider(providerId);
  if (!provider) {
    throw new Error(`Unsupported image-to-video provider: ${providerId}`);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-i2v-"));
  const outputPath = path.join(tmpDir, "clip.mp4");

  try {
    if (provider.type === "local") {
      return await generateClipViaLocalBackend(
        imagePath,
        outputPath,
        tmpDir,
        provider.localBaseUrl ?? getLocalBackendUrl(),
        options.prompt,
        options.durationSec ?? 5,
      );
    }
    if (provider.type === "huggingface" && provider.hfModelId) {
      return await generateClipViaHuggingFace(
        imagePath,
        outputPath,
        tmpDir,
        provider.hfModelId,
        options.prompt,
        options.durationSec ?? 5,
      );
    }
    if (provider.type === "replicate" && provider.replicateModel) {
      return await generateClipViaReplicate(
        imagePath,
        outputPath,
        tmpDir,
        provider.replicateModel,
        options.durationSec ?? 5,
      );
    }
    if (provider.type === "pollinations" && provider.pollinationsModel) {
      return await generateClipViaPollinations(
        imagePath,
        outputPath,
        tmpDir,
        provider.pollinationsModel,
        options.prompt,
        options.durationSec ?? 5,
      );
    }
    throw new Error(`Missing config for image-to-video provider: ${providerId}`);
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

const HF_INFERENCE_URL = "https://router.huggingface.co/hf-inference/models";

function getHfToken(): string {
  return requireHuggingFaceToken("Hugging Face image-to-video");
}

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
  prompt?: string,
  durationSec: number = 5,
): Promise<ImageToVideoResult> {
  const token = getHfToken();
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

const POLLINATIONS_API_URL = "https://gen.pollinations.ai";
const POLLINATIONS_MEDIA_URL = "https://media.pollinations.ai";

function getPollinationsApiKey(): string {
  const key = process.env.POLLINATIONS_API_KEY;
  if (!key) {
    throw new Error(
      "POLLINATIONS_API_KEY is not configured. Get a free key at https://enter.pollinations.ai",
    );
  }
  return key;
}

async function uploadImageToPollinations(imagePath: string): Promise<string> {
  const apiKey = getPollinationsApiKey();
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
  prompt?: string,
  durationSec: number = 5,
): Promise<ImageToVideoResult> {
  const apiKey = getPollinationsApiKey();
  const maxAttempts = 5;

  const encodedPrompt = encodeURIComponent(
    (prompt ?? "cinematic motion, subtle parallax").slice(0, 500),
  );

  let videoBuffer: Buffer | null = null;
  let lastError = "";
  let imageUrl: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Upload (or re-upload) image on first attempt and after every failure
      if (!imageUrl || attempt > 0) {
        imageUrl = await uploadImageToPollinations(imagePath);
      }

      const params = new URLSearchParams({
        model,
        image: imageUrl,
        duration: String(durationSec),
        aspectRatio: "9:16",
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
      lastError = msg;
      log.warn(`Pollinations video attempt ${attempt + 1}/${maxAttempts} failed: ${msg.slice(0, 200)}`);
      videoBuffer = null;
      imageUrl = null; // force re-upload on next attempt
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

const I2V_CONCURRENCY = 3;

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
