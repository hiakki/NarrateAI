import OpenAI from "openai";
import type { LlmProviderInterface, ScriptInput, GeneratedScript } from "./types";
import { buildPrompt } from "./prompt";

export class OpenAILlmProvider implements LlmProviderInterface {
  async generateScript(input: ScriptInput): Promise<GeneratedScript> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const sceneCount = Math.max(4, Math.round(input.duration / 7));
    const prompt = buildPrompt(input, sceneCount);

    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.9,
    });

    const text = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);
    const fullScript = (parsed.scenes || []).map((s: { text: string }) => s.text).join(" ");

    return {
      title: parsed.title || "Untitled",
      description: parsed.description || "",
      hashtags: parsed.hashtags || [],
      scenes: parsed.scenes || [],
      fullScript,
    };
  }
}
