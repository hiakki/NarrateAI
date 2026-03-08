import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import type { ImageProviderInterface, ImageGenResult, OnImageProgress } from "./types";

const log = createLogger("Image:Pollinations");
const API_URL = "https://gen.pollinations.ai/image";

export class PollinationsImageProvider implements ImageProviderInterface {
  async generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    _negativePrompt?: string,
    onProgress?: OnImageProgress,
  ): Promise<ImageGenResult> {
    const apiKey = process.env.POLLINATIONS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "POLLINATIONS_API_KEY is not configured. Get a free key at https://enter.pollinations.ai",
      );
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-img-"));
    const imagePaths: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imagePath = path.join(tmpDir, `scene-${i.toString().padStart(3, "0")}.jpg`);

      // scene.visualDescription is already style-enhanced upstream.
      // Appending artStylePrompt again can over-compress/truncate useful specifics.
      const rawPrompt = `${scene.visualDescription}`.slice(0, 1500);
      const encoded = encodeURIComponent(rawPrompt);
      const seed = (Date.now() % 1_000_000) + i;
      const url = `${API_URL}/${encoded}?width=832&height=1472&nologo=true&model=flux&seed=${seed}&key=${apiKey}`;

      let buffer: Buffer | null = null;
      let lastError: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(url, {
            redirect: "follow",
            signal: AbortSignal.timeout(120_000),
          });

          if (!response.ok) {
            const errText = await response.text();
            lastError = `HTTP ${response.status}: ${errText.slice(0, 300)}`;
            throw new Error(lastError);
          }

          const contentType = response.headers.get("content-type") ?? "";
          if (!contentType.startsWith("image/")) {
            const body = await response.text();
            lastError = `Not an image (${contentType}): ${body.slice(0, 150)}`;
            throw new Error(lastError);
          }

          buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length < 1024) {
            lastError = `Image too small (${buffer.length} bytes)`;
            throw new Error(lastError);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lastError = msg;
          log.warn(`Pollinations scene ${i} attempt ${attempt + 1}/3 failed: ${msg.slice(0, 300)}`);
          buffer = null;
        }

        if (buffer) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
      }

      if (!buffer) {
        const hint = lastError
          ? ` Last error: ${lastError.slice(0, 250)}.`
          : "";
        const fullMessage = `Failed to generate Pollinations image for scene ${i} after 3 attempts.${hint} Check POLLINATIONS_API_KEY and rate limits (https://enter.pollinations.ai).`;
        if (lastError) {
          log.warn(`Pollinations scene ${i} failed after 3 attempts. Last error: ${lastError.slice(0, 400)}`);
        }
        throw new Error(fullMessage);
      }

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
}
