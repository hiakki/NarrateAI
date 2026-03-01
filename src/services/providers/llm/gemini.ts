import { GoogleGenAI } from "@google/genai";
import type { LlmProviderInterface, ScriptInput, GeneratedScript, Scene } from "./types";
import { buildPrompt, getSceneCount } from "./prompt";
import { safeParseLlmJson } from "./parse-json";
import { createLogger } from "@/lib/logger";

const log = createLogger("LLM:Gemini");

function humanizeGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const code = parsed.error?.code;
      const status = parsed.error?.status;
      const retryInfo = parsed.error?.details?.find((d: { retryDelay?: string }) => d.retryDelay);
      const retryDelay = retryInfo?.retryDelay ?? "";

      if (code === 429 || status === "RESOURCE_EXHAUSTED") {
        return `Gemini rate limit exceeded (free tier: 20 req/day). Retry in ${retryDelay || "~60s"}.`;
      }
      if (code === 403) return `Gemini API forbidden — check your API key permissions.`;
      if (code === 400) return `Gemini rejected the request — ${(parsed.error?.message ?? "").slice(0, 100)}`;
      return `Gemini API error ${code}: ${(parsed.error?.message ?? "").slice(0, 120)}`;
    }
  } catch { /* not JSON, fall through */ }
  return raw.slice(0, 200);
}

export class GeminiLlmProvider implements LlmProviderInterface {
  async generateScript(input: ScriptInput): Promise<GeneratedScript> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const sceneCount = getSceneCount(input.duration);
    const prompt = buildPrompt(input, sceneCount, input.characterPrompt);

    log.log(`Generating script: niche=${input.niche}, tone=${input.tone}, duration=${input.duration}s, scenes=${sceneCount}`);
    log.debug(`LLM prompt (${prompt.length} chars):\n${prompt}`);

    const ai = new GoogleGenAI({ apiKey });
    const configured = (process.env.GEMINI_MODEL ?? "").trim();
    log.debug(`GEMINI_MODEL="${configured || "gemini-2.5-flash (default)"}"`);
    const modelCandidates = [...new Set([
      configured || "gemini-2.5-flash",
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
        log.warn(`Model "${model}" failed: ${humanizeGeminiError(err)}`);
      }
    }

    if (!response) {
      const msg = humanizeGeminiError(lastErr);
      throw new Error(msg);
    }

    const text = response.text ?? "";
    log.debug(`Raw response: ${text.length} chars (model=${usedModel})`);

    const parsed = safeParseLlmJson(text) as Record<string, unknown>;
    const scenes: Scene[] = (parsed.scenes as Scene[]) || [];
    const fullScript = scenes.map((s) => s.text).join(" ");

    log.log(`Script OK: "${(parsed.title as string) || "Untitled"}" — ${scenes.length} scenes, ${fullScript.length} chars (model=${usedModel})`);

    return {
      title: (parsed.title as string) || "Untitled",
      description: (parsed.description as string) || "",
      hashtags: (parsed.hashtags as string[]) || [],
      scenes,
      fullScript,
    };
  }
}
