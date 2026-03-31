/**
 * Extract a user-facing message from a platform error string (e.g. Meta API JSON).
 * Use when displaying error in UI so raw JSON is not shown.
 */
export function formatPlatformError(error: string | undefined): string {
  if (!error || typeof error !== "string") return "";
  const trimmed = error.trim();
  if (!trimmed) return "";
  try {
    if (trimmed.startsWith("{") && trimmed.includes("error")) {
      const parsed = JSON.parse(trimmed) as {
        error?: { message?: string; error_user_msg?: string };
        message?: string;
      };
      const err = parsed?.error;
      const msg = err?.error_user_msg || err?.message || parsed?.message;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    }
  } catch {
    // not JSON
  }
  return trimmed;
}
