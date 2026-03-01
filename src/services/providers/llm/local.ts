import OpenAI from "openai";
import type { LlmProviderInterface, ScriptInput, GeneratedScript } from "./types";
import { buildPrompt, getSceneCount } from "./prompt";
import { safeParseLlmJson } from "./parse-json";
import { createLogger } from "@/lib/logger";

const log = createLogger("LLM:Local");

export class LocalLlmProvider implements LlmProviderInterface {
  async generateScript(input: ScriptInput): Promise<GeneratedScript> {
    const baseURL = (process.env.LOCAL_LLM_URL ?? "").trim();
    if (!baseURL) throw new Error("LOCAL_LLM_URL is not configured");

    const model = (process.env.LOCAL_LLM_MODEL ?? "").trim() || "default";
    const apiKey = process.env.LOCAL_LLM_API_KEY || "not-needed";

    const sceneCount = getSceneCount(input.duration);
    const prompt = buildPrompt(input, sceneCount);

    const endpoint = `${baseURL}/chat/completions`;
    log.log(`── REQUEST ── model=${model} niche=${input.niche} duration=${input.duration}s scenes=${sceneCount}`);
    log.log(`   Endpoint : ${endpoint}`);
    log.log(`   Prompt (${prompt.length} chars):\n${prompt}`);

    const systemMsg = "You are a scriptwriter. You MUST respond with valid JSON only. No markdown fences, no explanation — just the raw JSON object.";
    const body = {
      model,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: prompt },
      ],
      max_tokens: 4096,
      temperature: 0.9,
      stream: false,
    };

    log.log(`   Body size: ${JSON.stringify(body).length} bytes, max_tokens=4096, temp=0.9`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey !== "not-needed" ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const contentType = res.headers.get("content-type") ?? "";
      let detail: string;
      if (contentType.includes("json")) {
        const errJson = await res.json().catch(() => null);
        detail = errJson?.error?.message ?? JSON.stringify(errJson).slice(0, 300);
      } else {
        const snippet = (await res.text()).slice(0, 300);
        const isHtml = snippet.includes("<html") || snippet.includes("<!DOCTYPE");
        detail = isHtml
          ? `Got HTML error page (likely Cloudflare/proxy error, is your local LLM running?)`
          : snippet;
      }
      log.error(`── RESPONSE ERROR ── HTTP ${res.status}: ${detail}`);
      throw new Error(`Local LLM ${res.status}: ${detail}`);
    }

    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? "{}";
    const finishReason = json.choices?.[0]?.finish_reason ?? "unknown";
    log.log(`── RESPONSE ── ${res.status} OK, ${text.length} chars, finish=${finishReason}`);
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
    const baseURL = (process.env.LOCAL_LLM_URL ?? "").trim();
    if (!baseURL) throw new Error("LOCAL_LLM_URL is not configured");

    const model = (process.env.LOCAL_LLM_MODEL ?? "").trim() || "default";
    const apiKey = process.env.LOCAL_LLM_API_KEY || "not-needed";
    const currentWords = text.split(/\s+/).filter(Boolean).length;

    log.log(`── EXPAND ── ${currentWords} → ${targetWords} words`);

    const body = {
      model,
      messages: [
        {
          role: "system" as const,
          content:
            "You are a narration writer. You expand short narration into longer, richer narration. " +
            "Respond with ONLY the expanded narration text. No JSON, no quotes, no explanations.",
        },
        {
          role: "user" as const,
          content:
            `Expand this narration from ${currentWords} words to approximately ${targetWords} words.\n` +
            `Add vivid sensory details, dramatic pacing, and descriptive language. ` +
            `Keep the same events, meaning, and tone.\n\n` +
            `Original (${currentWords} words):\n${text}\n\n` +
            `Expanded (${targetWords} words):`,
        },
      ],
      max_tokens: 1024,
      temperature: 0.7,
      stream: false,
    };

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey !== "not-needed" ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Expand failed: HTTP ${res.status}`);

    const json = await res.json();
    let expanded = (json.choices?.[0]?.message?.content ?? "").trim();

    // Strip markdown fences, surrounding quotes, or "Expanded:" prefixes
    expanded = expanded
      .replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "")
      .replace(/^["']|["']$/g, "")
      .replace(/^Expanded.*?:\s*/i, "")
      .trim();

    const expandedWords = expanded.split(/\s+/).filter(Boolean).length;
    log.log(`── EXPAND RESULT ── ${expandedWords} words (target ${targetWords})`);

    if (expandedWords < currentWords) {
      log.warn(`Expansion produced fewer words (${expandedWords}) than original (${currentWords}), keeping original`);
      return text;
    }

    return expanded;
  }
}
