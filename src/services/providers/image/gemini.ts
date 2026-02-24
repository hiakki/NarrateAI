import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import type { ImageProviderInterface, ImageGenResult, OnImageProgress } from "./types";

const log = createLogger("Image:Gemini");

async function generateSingleImage(prompt: string, apiKey: string): Promise<Buffer | null> {
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp-image-generation",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseModalities: ["TEXT", "IMAGE"] },
    });

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith("image/")) {
        return Buffer.from(part.inlineData.data, "base64");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.log(`Failed: ${msg.slice(0, 150)}`);
  }
  return null;
}

export class GeminiImageProvider implements ImageProviderInterface {
  async generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    _negativePrompt?: string,
    onProgress?: OnImageProgress,
  ): Promise<ImageGenResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-img-"));
    const imagePaths: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imagePath = path.join(tmpDir, `scene-${i.toString().padStart(3, "0")}.png`);
      const prompt = scene.visualDescription;

      let buffer: Buffer | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        buffer = await generateSingleImage(prompt, apiKey);
        if (buffer) break;
        log.log(`Retry ${attempt + 1}/3 for scene ${i}`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      }

      if (!buffer) {
        throw new Error(`Failed to generate image for scene ${i} after 3 attempts`);
      }

      await fs.writeFile(imagePath, buffer);
      imagePaths.push(imagePath);
      await onProgress?.(i, imagePath);
      log.log(`Scene ${i + 1}/${scenes.length} saved (${(buffer.length / 1024).toFixed(0)}KB)`);
    }

    return { imagePaths, tmpDir };
  }
}
