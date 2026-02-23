import OpenAI from "openai";
import type { LlmProviderInterface, ScriptInput, GeneratedScript } from "./types";
import { buildPrompt, getSceneCount } from "./prompt";
import { safeParseLlmJson } from "./parse-json";

export class DeepSeekLlmProvider implements LlmProviderInterface {
  async generateScript(input: ScriptInput): Promise<GeneratedScript> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

    const sceneCount = getSceneCount(input.duration);
    const prompt = buildPrompt(input, sceneCount);

    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com",
    });

    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.9,
    });

    const text = response.choices[0]?.message?.content ?? "{}";
    const parsed = safeParseLlmJson(text) as Record<string, unknown>;
    const scenes = (parsed.scenes as { text: string; visualDescription: string }[]) || [];
    const fullScript = scenes.map((s) => s.text).join(" ");

    return {
      title: (parsed.title as string) || "Untitled",
      description: (parsed.description as string) || "",
      hashtags: (parsed.hashtags as string[]) || [],
      scenes,
      fullScript,
    };
  }
}
