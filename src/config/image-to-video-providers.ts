/**
 * Image-to-video options for shorts/reels.
 *
 * Important: 30–90s length
 * Most generators output short clips (about 4–10 seconds) per run. For 30–90s
 * final videos you typically need to either:
 * - Generate several clips and stitch them in an editor (CapCut, DaVinci, etc.), or
 * - Use per-scene image-to-video in this app (each scene becomes a short clip).
 *
 * BGM / SFX: Hugging Face has no single free API that does image→video with
 * built-in BGM and sound effects. Research models (e.g. Ovi) generate video+audio
 * but are not available as a callable serverless API. For now, add music/SFX in
 * post (e.g. in the app’s assembly step or in an external editor).
 */

export interface ImageToVideoProviderInfo {
  id: string;
  name: string;
  description: string;
  type: "replicate" | "huggingface" | "local" | "pollinations";
  /** Base URL for local backend (e.g. http://localhost:8000) when type === "local" */
  localBaseUrl?: string;
  /** Replicate model (e.g. "owner/name") when type === "replicate" */
  replicateModel?: string;
  /** Hugging Face model ID (e.g. "Lightricks/LTX-Video-0.9.7-distilled") when type === "huggingface" */
  hfModelId?: string;
  /** URL to Hugging Face Space or similar when type === "external" */
  externalUrl?: string;
  /** Pollinations video model name (e.g. "grok-video", "wan") when type === "pollinations" */
  pollinationsModel?: string;
  costEstimate?: string;
  envVar: string;
}

/** Providers we can call from the pipeline. */
export const IMAGE_TO_VIDEO_PROVIDERS: Record<string, ImageToVideoProviderInfo> = {
  SVD_REPLICATE: {
    id: "SVD_REPLICATE",
    name: "Stable Video Diffusion (Replicate)",
    description: "Single image → short video via Replicate API. Paid (~$0.18/run).",
    type: "replicate",
    replicateModel: "christophy/stable-video-diffusion",
    costEstimate: "~$0.18/run (Replicate)",
    envVar: "REPLICATE_API_TOKEN",
  },
  HF_LTX_VIDEO: {
    id: "HF_LTX_VIDEO",
    name: "LTX-Video (Hugging Face)",
    description: "Lightricks LTX-Video distilled — fast image/text-to-video. Free tier (HF rate limits). Enable in HF Inference Providers.",
    type: "huggingface",
    hfModelId: "Lightricks/LTX-Video-0.9.7-distilled",
    costEstimate: "Free (HF)",
    envVar: "HUGGINGFACE_API_KEY",
  },
  HF_WAN_I2V: {
    id: "HF_WAN_I2V",
    name: "Wan 2.2 I2V (Hugging Face)",
    description: "Wan-AI image-to-video (e.g. 5B). Free tier (HF rate limits). Enable in HF Inference Providers.",
    type: "huggingface",
    hfModelId: "Wan-AI/Wan2.2-TI2V-5B",
    costEstimate: "Free (HF)",
    envVar: "HUGGINGFACE_API_KEY",
  },
  LOCAL_BACKEND: {
    id: "LOCAL_BACKEND",
    name: "Local Backend (I2V)",
    description: "Your local server POST /api/video — image + prompt → short video clip.",
    type: "local",
    costEstimate: "Free",
    envVar: "",
  },
  POLLINATIONS_GROK_VIDEO: {
    id: "POLLINATIONS_GROK_VIDEO",
    name: "Grok Video (Pollinations)",
    description: "xAI Grok video generation via Pollinations — the only model available on the free tier. ~5s clips, ~40s generation time.",
    type: "pollinations",
    pollinationsModel: "grok-video",
    costEstimate: "Free (tier balance)",
    envVar: "POLLINATIONS_API_KEY",
  },
};

/** Recommended external Spaces (image + text → video) for manual or future API use. */
export const RECOMMENDED_IMAGE_TO_VIDEO_SPACES = [
  {
    name: "Wan2.2 Animate (Wan-AI)",
    why: "Top likes, image + text → video. Strong for varied, high-quality motion (cosmos, anime, scary).",
    url: "https://huggingface.co/spaces/Wan-AI/Wan2.2-Animate",
  },
  {
    name: "Wan2.2 14B Fast (zerogpu-aoti)",
    why: "Same family, fast variant. Good balance of quality and speed for many clips.",
    url: "https://huggingface.co/spaces/zerogpu-aoti/Wan2.2-14B-Fast",
  },
  {
    name: "Stable Video Diffusion 1.1 (multimodalart)",
    why: "Single image → short video. Simple, reliable.",
    url: "https://huggingface.co/spaces/multimodalart/stable-video-diffusion-1-1",
  },
  {
    name: "LTX Video Fast (Lightricks)",
    why: "Very fast, image + text. Good for cranking out lots of 5–10s clips.",
    url: "https://huggingface.co/spaces/Lightricks/LTX-Video-Fast",
  },
  {
    name: "Wan 2 2 First Last Frame (multimodalart)",
    why: "Start image + end image → video in between. Great for cosmos→explosion, normal→scary.",
    url: "https://huggingface.co/spaces/multimodalart/Wan-2-2-First-Last-Frame",
  },
  {
    name: "ToonCrafter (Doubiiu)",
    why: "Two cartoon images → animated clip. Best for anime/cartoon style reels.",
    url: "https://huggingface.co/spaces/Doubiiu/ToonCrafter",
  },
] as const;

import { isHuggingFaceConfigured } from "@/lib/huggingface";

export function getImageToVideoProvider(id: string): ImageToVideoProviderInfo | undefined {
  return IMAGE_TO_VIDEO_PROVIDERS[id];
}

export function getAvailableImageToVideoProviders(): ImageToVideoProviderInfo[] {
  return Object.values(IMAGE_TO_VIDEO_PROVIDERS).filter((p) => {
    if (p.type === "local") return true;
    if (!p.envVar) return true;
    if (p.envVar === "HUGGINGFACE_API_KEY") return isHuggingFaceConfigured();
    if (p.envVar === "POLLINATIONS_API_KEY") return !!process.env.POLLINATIONS_API_KEY;
    return !!process.env[p.envVar];
  });
}

/** For Settings UI: list suitable for ProviderCard (id, name, description, costEstimate, envVar). Includes "Off" option. */
export interface ImageToVideoProviderOption {
  id: string;
  name: string;
  description: string;
  costEstimate: string;
  envVar: string;
}

export function getImageToVideoProviderOptionsForSettings(): ImageToVideoProviderOption[] {
  const off: ImageToVideoProviderOption = {
    id: "",
    name: "Static images → final video",
    description: "Use scene images as-is (Ken Burns effect) and stitch into the final video. No AI animation.",
    costEstimate: "Free",
    envVar: "",
  };
  const rest = Object.values(IMAGE_TO_VIDEO_PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    costEstimate: p.costEstimate ?? "—",
    envVar: p.envVar,
  }));
  return [off, ...rest];
}
