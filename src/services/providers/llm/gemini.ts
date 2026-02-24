import { GoogleGenAI } from "@google/genai";
import type { LlmProviderInterface, ScriptInput, GeneratedScript, Scene } from "./types";
import { buildPrompt, getSceneCount } from "./prompt";
import { safeParseLlmJson } from "./parse-json";
import { createLogger } from "@/lib/logger";

const log = createLogger("LLM:Gemini");

export class GeminiLlmProvider implements LlmProviderInterface {
  async generateScript(input: ScriptInput): Promise<GeneratedScript> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const sceneCount = getSceneCount(input.duration);
    const prompt = buildPrompt(input, sceneCount);

    log.log(`Generating script: niche=${input.niche}, tone=${input.tone}, art=${input.artStyle}, duration=${input.duration}s, lang=${input.language ?? "en"}, scenes=${sceneCount}`);
    log.log(`LLM prompt:\n${"─".repeat(60)}\n${prompt}\n${"─".repeat(60)}`);

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text ?? "";
    log.log(`Raw response length: ${text.length} chars`);

    const parsed = safeParseLlmJson(text) as Record<string, unknown>;
    const scenes: Scene[] = (parsed.scenes as Scene[]) || [];
    const fullScript = scenes.map((s) => s.text).join(" ");

    log.log(`Script generated: "${(parsed.title as string) || "Untitled"}" — ${scenes.length} scenes, ${fullScript.length} chars`);

    return {
      title: (parsed.title as string) || "Untitled",
      description: (parsed.description as string) || "",
      hashtags: (parsed.hashtags as string[]) || [],
      scenes,
      fullScript,
    };
  }
}
