import Replicate from "replicate";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { ImageProviderInterface, ImageGenResult } from "./types";

export class FluxSchnellImageProvider implements ImageProviderInterface {
  async generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    _negativePrompt?: string,
  ): Promise<ImageGenResult> {
    const auth = process.env.REPLICATE_API_TOKEN;
    if (!auth) throw new Error("REPLICATE_API_TOKEN is not configured");

    const replicate = new Replicate({ auth });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-img-"));
    const imagePaths: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imagePath = path.join(tmpDir, `scene-${i.toString().padStart(3, "0")}.png`);
      const prompt = scene.visualDescription;

      let buffer: Buffer | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const output = await replicate.run("black-forest-labs/flux-schnell", {
            input: {
              prompt: prompt.slice(0, 2000),
              aspect_ratio: "9:16",
              output_format: "png",
              num_inference_steps: 4,
            },
          });

          const imageUrl = Array.isArray(output) ? output[0] : typeof output === "string" ? output : null;
          if (imageUrl && typeof imageUrl === "string") {
            const imgResponse = await fetch(imageUrl);
            if (imgResponse.ok) {
              buffer = Buffer.from(await imgResponse.arrayBuffer());
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[Image:FluxSchnell] Failed attempt ${attempt + 1}: ${msg.slice(0, 150)}`);
        }

        if (buffer) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      }

      if (!buffer) {
        throw new Error(`Failed to generate Flux Schnell image for scene ${i} after 3 attempts`);
      }

      await fs.writeFile(imagePath, buffer);
      imagePaths.push(imagePath);
      console.log(`[Image:FluxSchnell] Scene ${i + 1}/${scenes.length} saved (${(buffer.length / 1024).toFixed(0)}KB)`);
    }

    return { imagePaths, tmpDir };
  }
}
