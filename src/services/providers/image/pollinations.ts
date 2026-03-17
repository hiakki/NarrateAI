import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import { getKeyRotator, DEFAULT_EXHAUSTION_TTL_MS, RATE_LIMIT_TTL_MS } from "@/lib/api-key-rotation";
import type { ImageProviderInterface, ImageGenResult, OnImageProgress, ImageGenCallOptions } from "./types";

const log = createLogger("Image:Pollinations");
const API_URL = "https://gen.pollinations.ai/image";
const KEY_EXHAUSTION_RE = /\b(401|402|429|503)\b/;

export class PollinationsImageProvider implements ImageProviderInterface {
  async generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    _negativePrompt?: string,
    onProgress?: OnImageProgress,
    options?: ImageGenCallOptions,
  ): Promise<ImageGenResult> {
    const rotator = getKeyRotator("POLLINATIONS_API_KEY");
    if (!rotator.hasKeys) {
      throw new Error(
        "POLLINATIONS_API_KEY is not configured. Get a free key at https://enter.pollinations.ai",
      );
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-img-"));
    const imagePaths: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imagePath = path.join(tmpDir, `scene-${i.toString().padStart(3, "0")}.jpg`);

      const rawPrompt = `${scene.visualDescription}`.slice(0, 1500);
      const encoded = encodeURIComponent(rawPrompt);
      const seed = (Date.now() % 1_000_000) + i;
      const isLandscape = options?.aspectRatio === "16:9";
      const width = isLandscape ? 1344 : 832;
      const height = isLandscape ? 768 : 1472;

      const buffer = await this.generateWithRotation(
        rotator, encoded, width, height, seed, i,
      );

      await fs.writeFile(imagePath, buffer);
      imagePaths.push(imagePath);
      await onProgress?.(i, imagePath);
      log.debug(`Scene ${i + 1}/${scenes.length} saved (${(buffer.length / 1024).toFixed(0)}KB)`);

      if (i < scenes.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    return { imagePaths, tmpDir };
  }

  private async generateWithRotation(
    rotator: ReturnType<typeof getKeyRotator>,
    encodedPrompt: string,
    width: number,
    height: number,
    seed: number,
    sceneIdx: number,
  ): Promise<Buffer> {
    let lastError: string | null = null;

    while (true) {
      const apiKey = rotator.getNextKey();
      if (!apiKey) {
        throw new Error(
          `Pollinations image generation failed for scene ${sceneIdx}: all API keys exhausted. `
          + `${lastError ? `Last error: ${lastError.slice(0, 200)}. ` : ""}`
          + `Add more keys (comma-separated) in POLLINATIONS_API_KEY or wait for quota to reset.`,
        );
      }

      const url = `${API_URL}/${encodedPrompt}?width=${width}&height=${height}&nologo=true&model=flux&seed=${seed}&key=${apiKey}`;

      let buffer: Buffer | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(url, {
            redirect: "follow",
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(120_000),
          });

          if (!response.ok) {
            const errText = await response.text();
            lastError = `HTTP ${response.status}: ${errText.slice(0, 300)}`;
            if (KEY_EXHAUSTION_RE.test(lastError)) throw new Error(lastError);
            log.warn(`Pollinations scene ${sceneIdx} attempt ${attempt + 1}/3 failed: ${lastError}`);
            if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          const contentType = response.headers.get("content-type") ?? "";
          if (!contentType.startsWith("image/")) {
            const body = await response.text();
            lastError = `Not an image (${contentType}): ${body.slice(0, 150)}`;
            log.warn(`Pollinations scene ${sceneIdx} attempt ${attempt + 1}/3 failed: ${lastError}`);
            if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length < 1024) {
            lastError = `Image too small (${buffer.length} bytes)`;
            log.warn(`Pollinations scene ${sceneIdx} attempt ${attempt + 1}/3 failed: ${lastError}`);
            buffer = null;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          return buffer;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lastError = msg;

          if (KEY_EXHAUSTION_RE.test(msg)) {
            const ttl = msg.includes("429") ? RATE_LIMIT_TTL_MS : DEFAULT_EXHAUSTION_TTL_MS;
            rotator.markExhausted(apiKey, ttl, msg.slice(0, 100));
            break;
          }

          log.warn(`Pollinations scene ${sceneIdx} attempt ${attempt + 1}/3 failed: ${msg.slice(0, 300)}`);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }
}
