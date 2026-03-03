import OpenAI from "openai";
import type { LlmProviderInterface, ScriptInput, GeneratedScript } from "./types";
import { buildPrompt, getSceneCount } from "./prompt";
import { safeParseLlmJson } from "./parse-json";
import { createLogger } from "@/lib/logger";

const log = createLogger("LLM:Local");

export class LocalLlmProvider implements LlmProviderInterface {
  private get baseURL() {
    const url = (process.env.LOCAL_LLM_URL ?? "").trim();
    if (!url) throw new Error("LOCAL_LLM_URL is not configured");
    return url;
  }
  private get model() {
    return (process.env.LOCAL_LLM_MODEL ?? "").trim() || "default";
  }
  private get headers() {
    const apiKey = process.env.LOCAL_LLM_API_KEY || "not-needed";
    return {
      "Content-Type": "application/json",
      ...(apiKey !== "not-needed" ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
  }

  private async streamChat(
    messages: { role: string; content: string }[],
    maxTokens: number,
    temperature: number,
  ): Promise<{ content: string; finishReason: string }> {
    const endpoint = `${this.baseURL}/chat/completions`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
      }),
    });

    if (!res.ok) {
      const ct = res.headers.get("content-type") ?? "";
      let detail: string;
      if (ct.includes("json")) {
        const errJson = await res.json().catch(() => null);
        detail = errJson?.error?.message ?? JSON.stringify(errJson).slice(0, 300);
      } else {
        const snippet = (await res.text()).slice(0, 300);
        detail = snippet.includes("<html") || snippet.includes("<!DOCTYPE")
          ? "Got HTML error page (likely Cloudflare/proxy error, is your local LLM running?)"
          : snippet;
      }
      log.error(`── RESPONSE ERROR ── HTTP ${res.status}: ${detail}`);
      throw new Error(`Local LLM ${res.status}: ${detail}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body from local LLM");

    const decoder = new TextDecoder();
    let content = "";
    let finishReason = "unknown";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) content += delta;
          const fr = parsed.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;
        } catch { /* partial JSON chunk, skip */ }
      }
    }

    return { content, finishReason };
  }

  async generateScript(input: ScriptInput): Promise<GeneratedScript> {
    const sceneCount = getSceneCount(input.duration);
    const prompt = buildPrompt(input, sceneCount, input.characterPrompt);

    log.log(`── REQUEST ── model=${this.model} niche=${input.niche} duration=${input.duration}s scenes=${sceneCount}`);
    log.log(`   Endpoint : ${this.baseURL}/chat/completions (streaming)`);
    log.log(`   Prompt (${prompt.length} chars):\n${prompt}`);

    const { content: text, finishReason } = await this.streamChat(
      [
        { role: "system", content: "You are a scriptwriter. You MUST respond with valid JSON only. No markdown fences, no explanation — just the raw JSON object." },
        { role: "user", content: prompt },
      ],
      4096,
      0.9,
    );

    log.log(`── RESPONSE ── ${text.length} chars, finish=${finishReason}`);
    log.log(`   Output:\n${text}`);

    const parsed = safeParseLlmJson(text) as Record<string, unknown>;
    const scenes = (parsed.scenes as { text: string; visualDescription: string }[]) || [];

    if (scenes.length === 0) {
      log.error(`── PARSE FAIL ── No scenes found. Raw output (first 500 chars):\n${text.slice(0, 500)}`);
      throw new Error("Local LLM returned no scenes — the model may not be following the JSON format.");
    }

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

  async expandText(text: string, targetWords: number): Promise<string> {
    const currentWords = text.split(/\s+/).filter(Boolean).length;
    log.log(`── EXPAND ── ${currentWords} → ${targetWords} words`);

    const { content: expanded } = await this.streamChat(
      [
        {
          role: "system",
          content:
            "You are a narration writer. You expand short narration into longer, richer narration. " +
            "Respond with ONLY the expanded narration text. No JSON, no quotes, no explanations.",
        },
        {
          role: "user",
          content:
            `Expand this narration from ${currentWords} words to approximately ${targetWords} words.\n` +
            `Add vivid sensory details, dramatic pacing, and descriptive language. ` +
            `Keep the same events, meaning, and tone.\n\n` +
            `Original (${currentWords} words):\n${text}\n\n` +
            `Expanded (${targetWords} words):`,
        },
      ],
      1024,
      0.7,
    );

    let cleaned = expanded.trim()
      .replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "")
      .replace(/^["']|["']$/g, "")
      .replace(/^Expanded.*?:\s*/i, "")
      .trim();

    const expandedWords = cleaned.split(/\s+/).filter(Boolean).length;
    log.log(`── EXPAND RESULT ── ${expandedWords} words (target ${targetWords})`);

    if (expandedWords < currentWords) {
      log.warn(`Expansion produced fewer words (${expandedWords}) than original (${currentWords}), keeping original`);
      return text;
    }

    return cleaned;
  }
}
