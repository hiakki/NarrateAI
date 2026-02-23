import { GoogleGenAI } from "@google/genai";
import type { LlmProviderInterface, ScriptInput, GeneratedScript, Scene } from "./types";
import { buildPrompt, getSceneCount } from "./prompt";

export class GeminiLlmProvider implements LlmProviderInterface {
  async generateScript(input: ScriptInput): Promise<GeneratedScript> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const sceneCount = getSceneCount(input.duration);
    const prompt = buildPrompt(input, sceneCount);

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text ?? "";
    const parsed = JSON.parse(text);
    const scenes: Scene[] = parsed.scenes || [];
    const fullScript = scenes.map((s) => s.text).join(" ");

    return {
      title: parsed.title || "Untitled",
      description: parsed.description || "",
      hashtags: parsed.hashtags || [],
      scenes,
      fullScript,
    };
  }
}
