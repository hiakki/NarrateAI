import type { LlmProviderInterface, ScriptInput, GeneratedScript, Scene } from "./types";
import { buildPrompt, getSceneCount } from "./prompt";
import { safeParseLlmJson } from "./parse-json";
import { createLogger } from "@/lib/logger";
import { resolveStoryModel, getStoryModelById, providerIdToStoryModelId } from "@/config/story-models";
import { requireHuggingFaceToken } from "@/lib/huggingface";

const log = createLogger("LLM:HFStory");

/** Single endpoint: router chat-completions (no fallbacks). */
const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";

/**
 * Hugging Face story/script generation via router chat-completions only.
 * Uses the model from story-models config (resolved by niche/tone or fixed by provider id).
 */
export class HuggingFaceStoryLlmProvider implements LlmProviderInterface {
  constructor(private readonly providerId: string = "HF_STORY") {}

  private getToken(): string {
    return requireHuggingFaceToken("Hugging Face story generation");
  }

  private resolveModelAndTemp(input: ScriptInput): { modelId: string; temperature: number; modelName: string } {
    const forcedStoryModelId = providerIdToStoryModelId(this.providerId);
    if (forcedStoryModelId) {
      const config = getStoryModelById(forcedStoryModelId);
      if (config) {
        return {
          modelId: config.modelId,
          temperature: config.temperature,
          modelName: config.name,
        };
      }
    }
    return resolveStoryModel(input.niche, input.tone, "");
  }

  async generateScript(input: ScriptInput): Promise<GeneratedScript> {
    const token = this.getToken();
    const { modelId, temperature, modelName } = this.resolveModelAndTemp(input);
    const sceneCount = getSceneCount(input.duration);
    const prompt = buildPrompt(input, sceneCount, input.characterPrompt);

    log.log(
      `Generating script: niche=${input.niche}, tone=${input.tone}, duration=${input.duration}s, language=${input.language ?? "en"}, scenes=${sceneCount}, model=${modelName} (${modelId}), temp=${temperature}`
    );

    const res = await fetch(HF_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user" as const, content: prompt }],
        max_tokens: 4096,
        temperature,
        stream: false,
      }),
    });

    const resBody = await res.text();

    if (!res.ok) {
      const errLine = `[HF] ${res.status} ${res.statusText} | model: ${modelId} | body: ${resBody.slice(0, 600)}`;
      log.error(errLine);
      console.error(errLine);
      let msg = `Hugging Face ${res.status}: ${res.statusText}`;
      try {
        const j = JSON.parse(resBody);
        const d = j?.error?.message ?? j?.error ?? j?.message ?? resBody;
        msg += ` — ${(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 280)}`;
      } catch {
        if (resBody.length) msg += ` — ${resBody.slice(0, 280)}`;
      }
      throw new Error(msg.slice(0, 500));
    }

    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      data = resBody ? (JSON.parse(resBody) as { choices?: Array<{ message?: { content?: string } }> }) : {};
    } catch {
      log.error(`[HF] Invalid JSON: ${resBody.slice(0, 300)}`);
      console.error(`[HF] Invalid JSON: ${resBody.slice(0, 300)}`);
      throw new Error("Hugging Face returned invalid JSON");
    }

    const content = data.choices?.[0]?.message?.content;
    if (content == null || typeof content !== "string") {
      log.error(`[HF] Missing choices[0].message.content: ${resBody.slice(0, 400)}`);
      console.error(`[HF] Missing choices[0].message.content: ${resBody.slice(0, 400)}`);
      throw new Error("Hugging Face response missing choices[0].message.content");
    }

    const text = content.trim();
    log.log(`LLM output received; full output saved and logged in video context file.`);

    const parsed = safeParseLlmJson(text) as Record<string, unknown>;
    const scenes = (parsed.scenes as Scene[]) || [];

    if (scenes.length === 0) {
      const errLine = `[HF] No scenes in output. First 400 chars: ${text.slice(0, 400)}`;
      log.error(errLine);
      console.error(errLine);
      throw new Error("Hugging Face model returned no scenes — try again or use a different LLM provider.");
    }

    const fullScript = scenes.map((s) => s.text).join(" ");
    log.log(`Script OK: "${(parsed.title as string) || "Untitled"}" — ${scenes.length} scenes, ${fullScript.length} chars`);

    return {
      title: (parsed.title as string) || "Untitled",
      description: (parsed.description as string) || "",
      hashtags: Array.isArray(parsed.hashtags) ? (parsed.hashtags as string[]) : [],
      scenes,
      fullScript,
    };
  }
}
