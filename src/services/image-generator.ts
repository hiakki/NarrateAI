import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import os from "os";

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
}

export interface ImageGenResult {
  imagePaths: string[];
  tmpDir: string;
}

export async function generateSceneImages(
  scenes: { visualDescription: string }[],
  artStylePrompt: string
): Promise<ImageGenResult> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-img-"));

  const imagePaths: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const imagePath = path.join(tmpDir, `scene-${i.toString().padStart(3, "0")}.png`);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const prompt = `${artStylePrompt}, vertical composition 9:16 aspect ratio: ${scene.visualDescription}, high quality, cinematic, no text, no watermarks`;

        const ai = getAI();
        const response = await ai.models.generateImages({
          model: "imagen-3.0-generate-002",
          prompt,
          config: {
            numberOfImages: 1,
            aspectRatio: "9:16",
          },
        });

        const imageData = response.generatedImages?.[0]?.image?.imageBytes;
        if (!imageData) {
          throw new Error(`No image data for scene ${i}`);
        }

        const buffer = Buffer.from(imageData, "base64");
        await fs.writeFile(imagePath, buffer);
        lastError = null;
        break;
      } catch (err) {
        lastError = err as Error;
        console.error(`Image gen attempt ${attempt + 1}/3 failed for scene ${i}:`, lastError.message);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (lastError) {
      throw new Error(`Failed to generate image for scene ${i} after 3 attempts: ${lastError.message}`);
    }

    imagePaths.push(imagePath);
  }

  return { imagePaths, tmpDir };
}
