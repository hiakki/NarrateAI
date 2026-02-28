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
    const configured = (process.env.GEMINI_MODEL ?? "").trim();
    log.log(`Configured GEMINI_MODEL="${configured || "gemini-2.5-flash (default)"}"`);
    const modelCandidates = [...new Set([
      configured || "gemini-2.5-flash",
      // Optional preview fallback if user explicitly configures it.
      "gemini-2.5-flash",
    ])].filter(Boolean);

    let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
    let lastErr: unknown = null;
    let usedModel = modelCandidates[0];

    for (const model of modelCandidates) {
      try {
        usedModel = model;
        response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });
        break;
      } catch (err) {
        lastErr = err;
        log.warn(`Model "${model}" failed, trying fallback if available: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!response) {
      throw (lastErr instanceof Error ? lastErr : new Error("Gemini generation failed for all model candidates"));
    }

    const text = response.text ?? "";
    log.log(`Raw response length: ${text.length} chars (model=${usedModel})`);

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
