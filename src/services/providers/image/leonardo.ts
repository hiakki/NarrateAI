import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import type { ImageProviderInterface, ImageGenResult, OnImageProgress } from "./types";

const log = createLogger("Image:Leonardo");

export class LeonardoImageProvider implements ImageProviderInterface {
  async generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    negativePrompt?: string,
    onProgress?: OnImageProgress,
  ): Promise<ImageGenResult> {
    const apiKey = process.env.LEONARDO_API_KEY;
    if (!apiKey) throw new Error("LEONARDO_API_KEY is not configured");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-img-"));
    const imagePaths: string[] = [];
    const negPrompt = negativePrompt ?? "text, watermark, low quality, blurry, deformed";

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imagePath = path.join(tmpDir, `scene-${i.toString().padStart(3, "0")}.png`);

      let buffer: Buffer | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const createRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              prompt: scene.visualDescription.slice(0, 1000),
              negative_prompt: negPrompt,
              width: 768,
              height: 1344,
              num_images: 1,
              guidance_scale: 9,
              alchemy: true,
            }),
          });

          if (!createRes.ok) {
            const errText = await createRes.text();
            throw new Error(`Create failed (${createRes.status}): ${errText.slice(0, 150)}`);
          }

          const createData = await createRes.json();
          const generationId = createData.sdGenerationJob?.generationId;
          if (!generationId) throw new Error("No generationId returned");

          // Step 2: Poll for completion
          let imageUrl: string | null = null;
          for (let poll = 0; poll < 30; poll++) {
            await new Promise((r) => setTimeout(r, 3000));

            const statusRes = await fetch(
              `https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`,
              { headers: { Authorization: `Bearer ${apiKey}` } }
            );

            if (!statusRes.ok) continue;
            const statusData = await statusRes.json();
            const gen = statusData.generations_by_pk;

            if (gen?.status === "COMPLETE" && gen.generated_images?.length > 0) {
              imageUrl = gen.generated_images[0].url;
              break;
            } else if (gen?.status === "FAILED") {
              throw new Error("Leonardo generation failed");
            }
          }

          if (!imageUrl) throw new Error("Leonardo: generation timed out");

          const imgResponse = await fetch(imageUrl);
          if (imgResponse.ok) {
            buffer = Buffer.from(await imgResponse.arrayBuffer());
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.log(`Failed attempt ${attempt + 1}: ${msg.slice(0, 150)}`);
        }

        if (buffer) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      }

      if (!buffer) {
        throw new Error(`Failed to generate Leonardo image for scene ${i} after 3 attempts`);
      }

      await fs.writeFile(imagePath, buffer);
      imagePaths.push(imagePath);
      await onProgress?.(i, imagePath);
      log.log(`Scene ${i + 1}/${scenes.length} saved (${(buffer.length / 1024).toFixed(0)}KB)`);
    }

    return { imagePaths, tmpDir };
  }
}
