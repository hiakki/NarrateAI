import Replicate from "replicate";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createReadStream } from "fs";
import { createLogger } from "@/lib/logger";
import {
  getImageToVideoProvider,
} from "@/config/image-to-video-providers";
import { requireHuggingFaceToken } from "@/lib/huggingface";

const log = createLogger("ImageToVideo");

export interface ImageToVideoResult {
  videoPath: string;
  tmpDir: string;
}

/**
 * Generate a short video clip (typically 4–10s) from a single image using the given provider.
 * Supports Replicate (SVD) and Hugging Face Inference (LTX-Video, Wan I2V).
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
    if (provider.type === "huggingface" && provider.hfModelId) {
      return await generateClipViaHuggingFace(
        imagePath,
        outputPath,
        tmpDir,
        provider.hfModelId,
        options.prompt,
      );
    }
    if (provider.type === "replicate" && provider.replicateModel) {
      return await generateClipViaReplicate(
        imagePath,
        outputPath,
        tmpDir,
        provider.replicateModel,
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

  // Some models accept prompt in JSON body with image as base64; others accept binary image only.
  // Try binary image first (standard for image-input tasks).
  let res: Response;
  try {
    res = await fetch(url, {
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

  if (videoBuffer.length < 256) {
    throw new Error(`Hugging Face returned too little data (${videoBuffer.length} bytes), likely not a video`);
  }

  await fs.writeFile(outputPath, videoBuffer);
  log.debug(`HF image-to-video clip saved: ${outputPath} (${(videoBuffer.length / 1024).toFixed(0)}KB)`);
  return { videoPath: outputPath, tmpDir };
}

async function generateClipViaReplicate(
  imagePath: string,
  outputPath: string,
  tmpDir: string,
  replicateModel: string,
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
 * Generate clips for multiple scene images. Returns one video path per scene; on failure for a scene,
 * returns null for that index so the caller can fall back to the static image.
 */
export async function generateClipsFromImages(
  imagePaths: string[],
  options: {
    providerId?: string;
    prompts?: string[];
    onProgress?: (index: number, videoPath: string | null) => void | Promise<void>;
  } = {}
): Promise<(string | null)[]> {
  const results: (string | null)[] = new Array(imagePaths.length).fill(null);
  const tmpDirs: string[] = [];

  for (let i = 0; i < imagePaths.length; i++) {
    try {
      const { videoPath, tmpDir } = await generateClipFromImage(imagePaths[i], {
        providerId: options.providerId,
        prompt: options.prompts?.[i],
      });
      tmpDirs.push(tmpDir);
      results[i] = videoPath;
      await options.onProgress?.(i, videoPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Scene ${i + 1} image-to-video failed, will use static image: ${msg.slice(0, 120)}`);
      results[i] = null;
      await options.onProgress?.(i, null);
    }
  }

  // Caller is responsible for copying desired outputs to final dir; we don't clean tmpDirs here
  // so that the worker can copy before cleanup.
  return results;
}
