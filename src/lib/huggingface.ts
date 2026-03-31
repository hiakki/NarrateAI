/**
 * Single source of truth for Hugging Face API token.
 * If the user sets any of HUGGINGFACE_API_KEY, HUGGINGFACE_API_TOKEN, or HF_TOKEN,
 * we use that value for all HF features (story, TTS, image, image-to-video).
 */

const HF_ENV_VARS = ["HUGGINGFACE_API_KEY", "HUGGINGFACE_API_TOKEN", "HF_TOKEN"] as const;

/** Returns the HF token if any of the three env vars is set; otherwise null. */
export function getHuggingFaceToken(): string | null {
  for (const key of HF_ENV_VARS) {
    const v = process.env[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** True if any of HUGGINGFACE_API_KEY, HUGGINGFACE_API_TOKEN, HF_TOKEN is set. */
export function isHuggingFaceConfigured(): boolean {
  return getHuggingFaceToken() != null;
}

/** Returns the HF token or throws. Use when the feature requires a token. */
export function requireHuggingFaceToken(feature: string): string {
  const token = getHuggingFaceToken();
  if (token) return token;
  throw new Error(
    `${feature} requires one of HUGGINGFACE_API_KEY, HUGGINGFACE_API_TOKEN, or HF_TOKEN to be set in .env`
  );
}
