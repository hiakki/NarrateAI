import type { LlmProviderInterface, ScriptInput, GeneratedScript, Scene } from "./types";
import { getSceneCount, buildPrompt } from "./prompt";
import { getLocalBackendUrl, wrapLocalBackendFetchError } from "@/lib/local-backend";
import { createLogger } from "@/lib/logger";

const log = createLogger("LLM:LocalBackend");

/** Consume SSE stream from /api/story (stream=true); return accumulated text. */
async function readStorySSE(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body from local backend story stream");
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let done = false;
  while (!done) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]" || payload === "") continue;
      try {
        const parsed = JSON.parse(payload) as { delta?: string; done?: boolean };
        if (parsed.done) {
          done = true;
          break;
        }
        if (typeof parsed.delta === "string") fullText += parsed.delta;
      } catch { /* skip malformed chunk */ }
    }
  }
  return fullText;
}

/** Parse backend story text (extract JSON, handle ```json fences). */
function parseStoryJSON(raw: string): { title?: string; description?: string; hashtags?: string[]; scenes?: { text: string; visualDescription: string }[] } {
  let text = raw.trim();
  if (text.includes("```json")) {
    text = text.split("```json", 1)[1]?.split("```", 1)[0]?.trim() ?? text;
  } else if (text.includes("```")) {
    text = text.split("```", 1)[1]?.split("```", 1)[0]?.trim() ?? text;
  }
  try {
    return JSON.parse(text) as { title?: string; description?: string; hashtags?: string[]; scenes?: { text: string; visualDescription: string }[] };
  } catch {
    return { title: "Untitled", description: "", hashtags: [], scenes: [{ text: text.slice(0, 500), visualDescription: "Scene" }] };
  }
}

/**
 * Local backend story API contract:
 * POST /api/story
 * Body must include: prompt (string). Optional: system, max_tokens, and/or structured fields.
 * Response: { title, description, hashtags, scenes: [{ text, visualDescription }] }
 */
export class LocalBackendLlmProvider implements LlmProviderInterface {
  private get baseUrl(): string {
    return getLocalBackendUrl();
  }

  private get storyTimeoutMs(): number {
    const v = process.env.LOCAL_BACKEND_STORY_TIMEOUT_MS;
    if (v != null && v !== "") {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) return Math.min(n, 1_800_000); // cap 30 min
    }
    return 600_000; // 10 min default for large local models
  }

  async generateScript(input: ScriptInput): Promise<GeneratedScript> {
    const sceneCount = getSceneCount(input.duration);
    const promptText = buildPrompt(input, sceneCount, input.characterPrompt);
    const url = `${this.baseUrl}/api/story`;
    const body = {
      prompt: promptText,
      system: "You are a scriptwriter. Respond with valid JSON only: { title, description, hashtags, scenes: [{ text, visualDescription }] }. No markdown, no explanation.",
      max_tokens: 4096,
      stream: true,
      niche: input.niche,
      tone: input.tone,
      artStyle: input.artStyle,
      duration: input.duration,
      topic: input.topic,
      language: input.language,
      characterPrompt: input.characterPrompt,
      avoidThemes: input.avoidThemes,
      varietySeed: input.varietySeed,
      sceneCount,
      ...(input.videoId != null && input.videoId !== "" ? { video_id: input.videoId } : {}),
    };

    log.log(`POST ${url} — niche=${input.niche} duration=${input.duration}s scenes=${sceneCount} (timeout ${this.storyTimeoutMs / 1000}s)`);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.storyTimeoutMs),
      });
    } catch (err) {
      throw wrapLocalBackendFetchError(err, url);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail: string;
      if (res.status === 524 || (text && (text.trimStart().startsWith("<!") || text.includes("<html")))) {
        if (res.status === 524) {
          detail = "Cloudflare timeout (524). The request took longer than the proxy allows. Use the backend on the same network without a tunnel, or a tunnel with a longer timeout.";
        } else {
          detail = "Proxy or origin returned an HTML error page instead of JSON. If using Cloudflare tunnel, the request may have timed out (524) or the origin may be unreachable.";
        }
      } else if (res.status === 503 && text.includes("Text model disabled")) {
        detail = "Local backend text/LLM model is disabled or not loaded. On the backend server set enable_text=1 in .env and restart; ensure the model loads (check ParleyAI logs).";
      } else {
        detail = text.slice(0, 300);
        try {
          const j = JSON.parse(text);
          detail = (j.error ?? j.detail ?? j.message ?? detail) as string;
        } catch { /* use text */ }
      }
      log.error(`Local backend story ${res.status}: ${detail}`);
      throw new Error(`Local backend /api/story ${res.status}: ${detail}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    let data: { title?: string; description?: string; hashtags?: string[]; scenes?: { text: string; visualDescription: string }[] };

    if (contentType.includes("text/event-stream")) {
      const fullText = await readStorySSE(res);
      data = parseStoryJSON(fullText);
    } else {
      const json = (await res.json()) as { data?: typeof data } & typeof data;
      data = json.data ?? json;
    }

    const scenes: Scene[] = Array.isArray(data.scenes)
      ? data.scenes.map((s) => ({ text: s.text ?? "", visualDescription: s.visualDescription ?? "" }))
      : [];

    if (scenes.length === 0) {
      log.error("Local backend returned no scenes");
      throw new Error("Local backend /api/story returned no scenes");
    }

    const fullScript = scenes.map((s) => s.text).join(" ");
    log.log(`Script OK: "${data.title ?? "Untitled"}" — ${scenes.length} scenes`);

    return {
      title: data.title ?? "Untitled",
      description: data.description ?? "",
      hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
      scenes,
      fullScript,
    };
  }
}
