import OpenAI from "openai";
import type { LlmProviderInterface, ScriptInput, GeneratedScript } from "./types";
import { buildPrompt, getSceneCount } from "./prompt";
import { safeParseLlmJson } from "./parse-json";
import { createLogger } from "@/lib/logger";

const log = createLogger("LLM:Qwen");

export class QwenLlmProvider implements LlmProviderInterface {
  async generateScript(input: ScriptInput): Promise<GeneratedScript> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not configured");

    const sceneCount = getSceneCount(input.duration);
    const prompt = buildPrompt(input, sceneCount, input.characterPrompt);

    log.log(`Generating script: niche=${input.niche}, tone=${input.tone}, duration=${input.duration}s, scenes=${sceneCount}`);
    log.debug(`LLM prompt (${prompt.length} chars):\n${prompt}`);

    const client = new OpenAI({
      apiKey,
      baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    });

    const response = await client.chat.completions.create({
      model: "qwen-plus",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.9,
    });

    const text = response.choices[0]?.message?.content ?? "{}";
    log.debug(`Raw response: ${text.length} chars`);

    const parsed = safeParseLlmJson(text) as Record<string, unknown>;
    const scenes = (parsed.scenes as { text: string; visualDescription: string }[]) || [];
    const fullScript = scenes.map((s) => s.text).join(" ");

    log.log(`Script OK: "${(parsed.title as string) || "Untitled"}" — ${scenes.length} scenes, ${fullScript.length} chars`);

    return {
      title: (parsed.title as string) || "Untitled",
      description: (parsed.description as string) || "",
      hashtags: (parsed.hashtags as string[]) || [],
      scenes,
      fullScript,
    };
  }
}
