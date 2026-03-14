import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import type { ImageProviderInterface, ImageGenResult, OnImageProgress } from "./types";
import { requireHuggingFaceToken } from "@/lib/huggingface";

const log = createLogger("Image:HF");

const HF_INFERENCE = "https://router.huggingface.co/hf-inference/models";

/** Default: FLUX.1-schnell (fast, good quality). Override with HF_IMAGE_MODEL. */
const DEFAULT_MODEL = "black-forest-labs/FLUX.1-schnell";

function getToken(): string {
  return requireHuggingFaceToken("Hugging Face image generation");
}

function getModel(): string {
  return (process.env.HF_IMAGE_MODEL ?? DEFAULT_MODEL).trim();
}

export class HuggingFaceImageProvider implements ImageProviderInterface {
  async generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    _negativePrompt?: string,
    onProgress?: OnImageProgress,
    _options?: import("./types").ImageGenCallOptions,
  ): Promise<ImageGenResult> {
    const token = getToken();
    const model = getModel();
    const url = `${HF_INFERENCE}/${model}`;

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-img-hf-"));
    const imagePaths: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const prompt = `${scene.visualDescription}`.slice(0, 1500);
      const imagePath = path.join(tmpDir, `scene-${i.toString().padStart(3, "0")}.png`);

      const body: Record<string, unknown> = {
        inputs: prompt,
        parameters: {
          width: 832,
          height: 1472,
          num_inference_steps: model.includes("schnell") ? 4 : 28,
        },
      };

      let buffer: Buffer | null = null;
      let lastError: string | null = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120_000),
          });

          if (!res.ok) {
            const errText = await res.text();
            lastError = `HTTP ${res.status}: ${errText.slice(0, 300)}`;
            if (res.status === 503) {
              const wait = 5000 * (attempt + 1);
              log.warn(`HF image model loading (503), retry in ${wait / 1000}s`);
              await new Promise((r) => setTimeout(r, wait));
            }
            continue;
          }

          const contentType = res.headers.get("content-type") ?? "";
          if (!contentType.startsWith("image/")) {
            const text = await res.text();
            lastError = `Not an image (${contentType}): ${text.slice(0, 200)}`;
            continue;
          }

          buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length < 1024) {
            lastError = `Image too small (${buffer.length} bytes)`;
            buffer = null;
            continue;
          }
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          log.warn(`HF image attempt ${attempt + 1}/3: ${lastError.slice(0, 150)}`);
        }

        if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
      }

      if (!buffer) {
        throw new Error(
          `Hugging Face image failed for scene ${i + 1} after 3 attempts. ${lastError ?? ""}. Enable the model at https://huggingface.co/settings/inference-providers.`
        );
      }

      await fs.writeFile(imagePath, buffer);
      imagePaths.push(imagePath);
      await onProgress?.(i, imagePath);
      log.debug(`Scene ${i + 1}/${scenes.length} saved (${(buffer.length / 1024).toFixed(0)}KB)`);

      if (i < scenes.length - 1) await new Promise((r) => setTimeout(r, 1500));
    }

    return { imagePaths, tmpDir };
  }
}
