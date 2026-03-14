import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import type { ImageProviderInterface, ImageGenResult, OnImageProgress } from "./types";
import { getLocalBackendUrl, wrapLocalBackendFetchError } from "@/lib/local-backend";

const log = createLogger("Image:LocalBackend");

/**
 * Local backend image API contract:
 * POST /api/image
 * Request: { scenes: [{ visualDescription }], artStylePrompt, negativePrompt? }
 * Response: { images: string[] } — each element is base64 (with or without "data:image/...;base64," prefix)
 */
export class LocalBackendImageProvider implements ImageProviderInterface {
  private get baseUrl(): string {
    return getLocalBackendUrl();
  }

  async generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    negativePrompt?: string,
    onProgress?: OnImageProgress,
    _options?: import("./types").ImageGenCallOptions,
  ): Promise<ImageGenResult> {
    const url = `${this.baseUrl}/api/image`;
    const body = {
      scenes: scenes.map((s) => ({ visualDescription: s.visualDescription })),
      artStylePrompt,
      negativePrompt: negativePrompt ?? "",
    };

    log.log(`POST ${url} — ${scenes.length} scenes`);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      log.error(`Local backend image ${res.status}: ${detail}`);
      throw new Error(`Local backend /api/image ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as { images?: string[] };
    const rawImages = data.images;
    if (!Array.isArray(rawImages) || rawImages.length < scenes.length) {
      throw new Error(
        `Local backend /api/image must return { images: string[] } with at least ${scenes.length} base64 images`
      );
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-img-"));
    const imagePaths: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      let b64 = rawImages[i];
      if (typeof b64 !== "string") {
        throw new Error(`Local backend image[${i}] is not a string`);
      }
      if (b64.includes("base64,")) {
        b64 = b64.split("base64,")[1] ?? b64;
      }
      const buffer = Buffer.from(b64, "base64");
      const imagePath = path.join(tmpDir, `scene-${i.toString().padStart(3, "0")}.png`);
      await fs.writeFile(imagePath, buffer);
      imagePaths.push(imagePath);
      await onProgress?.(i, imagePath);
      log.debug(`Scene ${i + 1}/${scenes.length} saved`);
    }

    return { imagePaths, tmpDir };
  }
}
