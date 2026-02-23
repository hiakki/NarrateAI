import fs from "fs/promises";
import path from "path";
import os from "os";
import type { ImageProviderInterface, ImageGenResult, OnImageProgress } from "./types";

export class IdeogramImageProvider implements ImageProviderInterface {
  async generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    negativePrompt?: string,
    onProgress?: OnImageProgress,
  ): Promise<ImageGenResult> {
    const apiKey = process.env.IDEOGRAM_API_KEY;
    if (!apiKey) throw new Error("IDEOGRAM_API_KEY is not configured");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-img-"));
    const imagePaths: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imagePath = path.join(tmpDir, `scene-${i.toString().padStart(3, "0")}.png`);
      let buffer: Buffer | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const formData = new FormData();
          formData.append("prompt", scene.visualDescription.slice(0, 2000));
          formData.append("aspect_ratio", "ASPECT_9_16");
          formData.append("rendering_speed", "DEFAULT");
          formData.append("num_images", "1");
          if (negativePrompt) formData.append("negative_prompt", negativePrompt);

          const response = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
            method: "POST",
            headers: { "Api-Key": apiKey },
            body: formData,
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Ideogram failed (${response.status}): ${errText.slice(0, 150)}`);
          }

          const data = await response.json();
          const imageUrl = data.data?.[0]?.url;

          if (imageUrl) {
            const imgResponse = await fetch(imageUrl);
            if (imgResponse.ok) {
              buffer = Buffer.from(await imgResponse.arrayBuffer());
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[Image:Ideogram] Failed attempt ${attempt + 1}: ${msg.slice(0, 150)}`);
        }

        if (buffer) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      }

      if (!buffer) {
        throw new Error(`Failed to generate Ideogram image for scene ${i} after 3 attempts`);
      }

      await fs.writeFile(imagePath, buffer);
      imagePaths.push(imagePath);
      await onProgress?.(i, imagePath);
      console.log(`[Image:Ideogram] Scene ${i + 1}/${scenes.length} saved (${(buffer.length / 1024).toFixed(0)}KB)`);
    }

    return { imagePaths, tmpDir };
  }
}
