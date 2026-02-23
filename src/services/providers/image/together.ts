import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { ImageProviderInterface, ImageGenResult, OnImageProgress } from "./types";

export class TogetherImageProvider implements ImageProviderInterface {
  async generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    _negativePrompt?: string,
    onProgress?: OnImageProgress,
  ): Promise<ImageGenResult> {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) throw new Error("TOGETHER_API_KEY is not configured");

    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.together.xyz/v1",
    });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-img-"));
    const imagePaths: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imagePath = path.join(tmpDir, `scene-${i.toString().padStart(3, "0")}.png`);
      const prompt = scene.visualDescription;

      let buffer: Buffer | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await client.images.generate({
            model: "black-forest-labs/FLUX.1-schnell-Free",
            prompt: prompt.slice(0, 2000),
            n: 1,
            size: "1024x1792" as never,
          });

          const imageData = response.data?.[0];
          if (imageData?.b64_json) {
            buffer = Buffer.from(imageData.b64_json, "base64");
          } else if (imageData?.url) {
            const imgResponse = await fetch(imageData.url);
            if (imgResponse.ok) {
              buffer = Buffer.from(await imgResponse.arrayBuffer());
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[Image:Together] Failed attempt ${attempt + 1}: ${msg.slice(0, 150)}`);
        }

        if (buffer) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      }

      if (!buffer) {
        throw new Error(`Failed to generate Together image for scene ${i} after 3 attempts`);
      }

      await fs.writeFile(imagePath, buffer);
      imagePaths.push(imagePath);
      await onProgress?.(i, imagePath);
      console.log(`[Image:Together] Scene ${i + 1}/${scenes.length} saved (${(buffer.length / 1024).toFixed(0)}KB)`);
    }

    return { imagePaths, tmpDir };
  }
}
