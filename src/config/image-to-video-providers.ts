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
  type: "replicate" | "huggingface" | "local" | "pollinations" | "freepik" | "gradio-space" | "wavespeed" | "fal" | "siliconflow" | "deapi" | "pixverse" | "leonardo" | "gemini-veo";
  /** Base URL for local backend (e.g. http://localhost:8000) when type === "local" */
  localBaseUrl?: string;
  /** Replicate model (e.g. "owner/name") when type === "replicate" */
  replicateModel?: string;
  /** Hugging Face model ID (e.g. "Lightricks/LTX-Video-0.9.7-distilled") when type === "huggingface" */
  hfModelId?: string;
  /** HF Router inference provider (e.g. "fal-ai", "hf-inference"). Default "hf-inference". */
  hfProvider?: string;
  /** URL to Hugging Face Space or similar when type === "external" */
  externalUrl?: string;
  /** Pollinations video model name (e.g. "grok-video", "wan") when type === "pollinations" */
  pollinationsModel?: string;
  /** Freepik model path (e.g. "kling-v2") when type === "freepik" */
  freepikModel?: string;
  /** Gradio Space subdomain (e.g. "lightricks-ltx-video-distilled") for gradio-space type */
  gradioSpaceId?: string;
  /** Gradio API endpoint name (e.g. "image_to_video") */
  gradioApiName?: string;
  /** WaveSpeed model ID via HF Router (e.g. "wavespeed-ai/wan-2.1/i2v-480p") */
  wavespeedModelId?: string;
  /** fal.ai model path (e.g. "fal-ai/minimax/hailuo-02/standard/image-to-video") */
  falModelId?: string;
  /** fal.ai resolution param (e.g. "768p", "512p") */
  falResolution?: string;
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
    description: "Lightricks LTX-Video — fast image-to-video. Free $0.10/mo credits via hf-inference.",
    type: "huggingface",
    hfModelId: "Lightricks/LTX-Video",
    hfProvider: "hf-inference",
    costEstimate: "Free (HF)",
    envVar: "HUGGINGFACE_API_KEY",
  },
  HF_WAN_I2V: {
    id: "HF_WAN_I2V",
    name: "Wan 2.1 I2V (Hugging Face)",
    description: "Wan-AI image-to-video (14B-480P). Free $0.10/mo credits via hf-inference.",
    type: "huggingface",
    hfModelId: "Wan-AI/Wan2.1-I2V-14B-480P",
    hfProvider: "hf-inference",
    costEstimate: "Free (HF)",
    envVar: "HUGGINGFACE_API_KEY",
  },
  WAVESPEED_WAN_480P: {
    id: "WAVESPEED_WAN_480P",
    name: "Wan 2.1 I2V 480p (WaveSpeed)",
    description: "Wan-AI I2V via WaveSpeed through HF Router. ~5s clips, 464×768 portrait. Uses HF free $0.10/mo credits.",
    type: "wavespeed",
    wavespeedModelId: "wavespeed-ai/wan-2.1/i2v-480p",
    costEstimate: "Free (HF credits)",
    envVar: "HUGGINGFACE_API_KEY",
  },
  WAVESPEED_WAN_720P: {
    id: "WAVESPEED_WAN_720P",
    name: "Wan 2.1 I2V 720p (WaveSpeed)",
    description: "Wan-AI I2V 720p via WaveSpeed through HF Router. Higher quality, uses more credits per clip.",
    type: "wavespeed",
    wavespeedModelId: "wavespeed-ai/wan-2.1/i2v-720p",
    costEstimate: "Free (HF credits)",
    envVar: "HUGGINGFACE_API_KEY",
  },
  GRADIO_LTX_VIDEO: {
    id: "GRADIO_LTX_VIDEO",
    name: "LTX-Video Distilled (HF Space)",
    description: "Lightricks LTX-Video via free HF Space (ZeroGPU). 4 min/account GPU time. Best free I2V option.",
    type: "gradio-space",
    gradioSpaceId: "Lightricks-LTX-Video-Distilled",
    gradioApiName: "image_to_video",
    costEstimate: "Free (ZeroGPU)",
    envVar: "HUGGINGFACE_API_KEY",
  },
  FAL_HAILUO_768P: {
    id: "FAL_HAILUO_768P",
    name: "Hailuo 02 768p (fal.ai)",
    description: "MiniMax Hailuo 02 via fal.ai. Great quality, ~$0.27/clip. $10 free credits on signup.",
    type: "fal",
    falModelId: "fal-ai/minimax/hailuo-02/standard/image-to-video",
    falResolution: "768p",
    costEstimate: "~$0.27/clip",
    envVar: "FAL_API_KEY",
  },
  FAL_HAILUO_512P: {
    id: "FAL_HAILUO_512P",
    name: "Hailuo 02 512p (fal.ai)",
    description: "MiniMax Hailuo 02 via fal.ai. Good quality at lowest cost, ~$0.10/clip. $10 free credits on signup.",
    type: "fal",
    falModelId: "fal-ai/minimax/hailuo-02/standard/image-to-video",
    falResolution: "512p",
    costEstimate: "~$0.10/clip",
    envVar: "FAL_API_KEY",
  },
  SILICONFLOW_WAN: {
    id: "SILICONFLOW_WAN",
    name: "Wan 2.2 I2V (SiliconFlow)",
    description: "Wan-AI/Wan2.2-I2V-A14B via SiliconFlow. $1 free signup credits (~3 clips). 720×1280 portrait.",
    type: "siliconflow",
    costEstimate: "~$0.29/clip ($1 free)",
    envVar: "SILICONFLOW_API_KEY",
  },
  DEAPI_LTX: {
    id: "DEAPI_LTX",
    name: "LTX-2.3 (deAPI)",
    description: "LTX-Video distilled via deAPI decentralized network. $5 free signup credits (~100 clips). Fast.",
    type: "deapi",
    costEstimate: "~$0.05/clip ($5 free)",
    envVar: "DEAPI_API_KEY",
  },
  PIXVERSE_V5: {
    id: "PIXVERSE_V5",
    name: "PixVerse V5 I2V",
    description: "PixVerse V5 image-to-video. Good quality, 540p 5s clips. Free plan available, separate credit pool.",
    type: "pixverse",
    costEstimate: "~$0.22/clip (free plan available)",
    envVar: "PIXVERSE_API_KEY",
  },
  LEONARDO_I2V: {
    id: "LEONARDO_I2V",
    name: "Leonardo AI Motion (I2V)",
    description: "Leonardo AI Motion 2.0 Fast. 150 daily tokens reset every day (=6 clips). Good quality, reliable.",
    type: "leonardo",
    costEstimate: "Free 150 tokens/day (25/clip)",
    envVar: "LEONARDO_API_KEY",
  },
  GEMINI_VEO: {
    id: "GEMINI_VEO",
    name: "Veo 3.1 Fast (Gemini)",
    description: "Google Veo 3.1 Fast via Gemini API. High quality 720p/1080p. Paid: ~$0.75 per 5s clip.",
    type: "gemini-veo",
    costEstimate: "~$0.75/5s clip (paid)",
    envVar: "GEMINI_API_KEY",
  },
  LOCAL_BACKEND: {
    id: "LOCAL_BACKEND",
    name: "Local Backend (I2V)",
    description: "Your local server POST /api/video — image + prompt → short video clip.",
    type: "local",
    costEstimate: "Free",
    envVar: "",
  },
  POLLINATIONS_SEEDANCE: {
    id: "POLLINATIONS_SEEDANCE",
    name: "Seedance (Pollinations)",
    description: "BytePlus Seedance I2V via Pollinations. Good quality, cheapest video model (~0.007 pollen/s).",
    type: "pollinations",
    pollinationsModel: "seedance",
    costEstimate: "Free (pollen balance)",
    envVar: "POLLINATIONS_API_KEY",
  },
  POLLINATIONS_WAN: {
    id: "POLLINATIONS_WAN",
    name: "Wan (Pollinations)",
    description: "Wan video generation via Pollinations. ~5s clips with audio support.",
    type: "pollinations",
    pollinationsModel: "wan",
    costEstimate: "Free (pollen balance)",
    envVar: "POLLINATIONS_API_KEY",
  },
  POLLINATIONS_GROK_VIDEO: {
    id: "POLLINATIONS_GROK_VIDEO",
    name: "Grok Video (Pollinations)",
    description: "xAI Grok video generation via Pollinations. ~5s clips, costs ~0.015 pollen/request.",
    type: "pollinations",
    pollinationsModel: "grok-video",
    costEstimate: "Free (pollen balance)",
    envVar: "POLLINATIONS_API_KEY",
  },
  KLING_FREEPIK: {
    id: "KLING_FREEPIK",
    name: "Kling v2 (Freepik)",
    description: "Kling v2 image-to-video via Freepik API. Async (submit + poll). 5 EUR free trial credits (~15-25 clips).",
    type: "freepik",
    freepikModel: "kling-v2",
    costEstimate: "Free 5 EUR credits",
    envVar: "FREEPIK_API_KEY",
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
    if (p.envVar === "FREEPIK_API_KEY") return !!process.env.FREEPIK_API_KEY;
    if (p.envVar === "FAL_API_KEY") return !!process.env.FAL_API_KEY;
    if (p.envVar === "SILICONFLOW_API_KEY") return !!process.env.SILICONFLOW_API_KEY;
    if (p.envVar === "DEAPI_API_KEY") return !!process.env.DEAPI_API_KEY;
    if (p.envVar === "PIXVERSE_API_KEY") return !!process.env.PIXVERSE_API_KEY;
    if (p.envVar === "LEONARDO_API_KEY") return !!process.env.LEONARDO_API_KEY;
    if (p.envVar === "GEMINI_API_KEY") return !!process.env.GEMINI_API_KEY;
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
