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

async function generateSingleImage(prompt: string): Promise<Buffer | null> {
  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp-image-generation",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith("image/")) {
        return Buffer.from(part.inlineData.data, "base64");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[ImageGen] Failed: ${msg.slice(0, 150)}`);
  }
  return null;
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

    const prompt = `${artStylePrompt}, vertical composition 9:16 aspect ratio: ${scene.visualDescription}, high quality, cinematic lighting, no text, no watermarks`;

    let buffer: Buffer | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      buffer = await generateSingleImage(prompt);
      if (buffer) break;
      console.log(`[ImageGen] Retry ${attempt + 1}/3 for scene ${i}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }

    if (!buffer) {
      throw new Error(`Failed to generate image for scene ${i} after 3 attempts`);
    }

    await fs.writeFile(imagePath, buffer);
    imagePaths.push(imagePath);
    console.log(`[ImageGen] Scene ${i + 1}/${scenes.length} saved (${(buffer.length / 1024).toFixed(0)}KB)`);
  }

  return { imagePaths, tmpDir };
}
