/**
 * Single base URL for the local server. Used by:
 * - LOCAL_BACKEND: /api/story, /api/tts, /api/image, /api/video
 * - LOCAL_LLM (OpenAI-compatible chat): base + /v1/chat/completions
 * Default: http://localhost:8000
 */
export function getLocalBackendUrl(): string {
  const url = (process.env.LOCAL_BACKEND_URL ?? "http://localhost:8000").trim();
  return url.replace(/\/+$/, "");
}

/** Base URL for OpenAI-compatible chat (LOCAL_LLM). Uses LOCAL_BACKEND_URL + /v1, or LOCAL_LLM_URL if set (legacy). */
export function getLocalChatBaseUrl(): string {
  const legacy = (process.env.LOCAL_LLM_URL ?? "").trim();
  if (legacy) return legacy.replace(/\/+$/, "");
  return getLocalBackendUrl() + "/v1";
}

export function isLocalBackendConfigured(): boolean {
  return true; // Always available with default localhost:8000
}

/** Turn fetch/network errors into a clear message for LOCAL_BACKEND. */
export function wrapLocalBackendFetchError(err: unknown, url: string): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  const msg = e.message;
  const cause = e.cause as Error & { code?: string; errors?: Array<{ code?: string }> } | undefined;
  const code = (e as NodeJS.ErrnoException).code ?? cause?.code ?? cause?.errors?.[0]?.code;
  const baseUrl = getLocalBackendUrl();

  if (msg.includes("timeout") || msg.includes("aborted") || e.name === "TimeoutError") {
    return new Error(
      `Local backend request to ${url} timed out. Large models may need longer: set LOCAL_BACKEND_STORY_TIMEOUT_MS (default 600000).`
    );
  }
  if (code === "ECONNREFUSED" || msg.includes("ECONNREFUSED") || (cause && String(cause).includes("ECONNREFUSED"))) {
    return new Error(
      `Local backend at ${baseUrl} is not reachable (connection refused). ` +
        "Start your backend server, or if the worker runs in Docker set LOCAL_BACKEND_URL to the host (e.g. http://host.docker.internal:8000)."
    );
  }
  if (code === "ENOTFOUND" || msg.includes("ENOTFOUND")) {
    return new Error(
      `Local backend host not found for ${baseUrl}. Check LOCAL_BACKEND_URL (e.g. use host.docker.internal instead of localhost if the worker runs in Docker).`
    );
  }
  if (msg.includes("fetch failed") || msg.includes("network")) {
    return new Error(
      `Local backend request to ${url} failed: ${msg}. Ensure the server at ${baseUrl} is running and reachable.`
    );
  }
  return e;
}
