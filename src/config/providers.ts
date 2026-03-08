import {
  getAllStoryModels,
  storyModelToProviderId,
} from "@/config/story-models";
import { isHuggingFaceConfigured } from "@/lib/huggingface";

export type ProviderStage = "llm" | "tts" | "image";

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  costEstimate: string;
  qualityLabel: "Good" | "Great" | "Best";
  envVar: string;
}

function getGeminiDisplayName(): string {
  const model = (process.env.GEMINI_MODEL ?? "").trim();
  if (!model) return "Gemini 2.5 Flash";
  if (/gemini-3.*flash/i.test(model)) return "Gemini 3 Flash Preview";
  return `Gemini (${model})`;
}

function getLocalLlmName(): string {
  const model = (process.env.LOCAL_LLM_MODEL ?? "").trim();
  if (model) return `Local LLM (${model})`;
  const url = (process.env.LOCAL_LLM_URL ?? "").trim();
  if (url) {
    try { return `Local LLM (${new URL(url).hostname})`; } catch { /* ignore */ }
  }
  return "Local LLM";
}

export const LLM_PROVIDERS: Record<string, ProviderInfo> = {
  GEMINI_FLASH: {
    id: "GEMINI_FLASH",
    name: getGeminiDisplayName(),
    description: "Fast, structured output, configurable via GEMINI_MODEL",
    costEstimate: "~$0.003/script",
    qualityLabel: "Great",
    envVar: "GEMINI_API_KEY",
  },
  OPENAI_GPT4O_MINI: {
    id: "OPENAI_GPT4O_MINI",
    name: "GPT-4o Mini",
    description: "OpenAI's efficient model, strong writing",
    costEstimate: "~$0.005/script",
    qualityLabel: "Great",
    envVar: "OPENAI_API_KEY",
  },
  DEEPSEEK_V3: {
    id: "DEEPSEEK_V3",
    name: "DeepSeek V3",
    description: "Ultra low cost, good quality",
    costEstimate: "~$0.001/script",
    qualityLabel: "Good",
    envVar: "DEEPSEEK_API_KEY",
  },
  QWEN: {
    id: "QWEN",
    name: "Qwen Plus",
    description: "Alibaba's model, strong multilingual support",
    costEstimate: "~$0.002/script",
    qualityLabel: "Great",
    envVar: "DASHSCOPE_API_KEY",
  },
  LOCAL_LLM: {
    id: "LOCAL_LLM",
    name: getLocalLlmName(),
    description: "Your own LLM — Ollama, vLLM, llama.cpp, or any OpenAI-compatible endpoint",
    costEstimate: "Free",
    qualityLabel: "Good",
    envVar: "LOCAL_LLM_URL",
  },
  // HF_STORY removed: only concrete HF models are shown (e.g. HF: Qwen 7B Instruct).
  // Existing automations with llmProvider "HF_STORY" still work via factory fallback and resolve to the single model.
  ...Object.fromEntries(
    getAllStoryModels().map((m) => [
      storyModelToProviderId(m.id),
      {
        id: storyModelToProviderId(m.id),
        name: `HF: ${m.name}`,
        description: `Hugging Face ${m.name}. Temp ${m.temperature}. Best for: ${m.niches.length ? m.niches.slice(0, 3).join(", ") : "all"}${m.tones.length ? ` (${m.tones.join(", ")})` : ""}.`,
        costEstimate: "Free (rate limits apply)",
        qualityLabel: "Good" as const,
        envVar: "HUGGINGFACE_API_KEY",
      },
    ])
  ),
};

export const TTS_PROVIDERS: Record<string, ProviderInfo> = {
  GEMINI_TTS: {
    id: "GEMINI_TTS",
    name: "Gemini TTS",
    description: "Google's built-in text-to-speech, natural sounding",
    costEstimate: "~$0.02/voiceover",
    qualityLabel: "Great",
    envVar: "GEMINI_API_KEY",
  },
  ELEVENLABS: {
    id: "ELEVENLABS",
    name: "ElevenLabs",
    description: "Industry-leading voice quality and cloning",
    costEstimate: "~$0.08/voiceover",
    qualityLabel: "Best",
    envVar: "ELEVENLABS_API_KEY",
  },
  COSYVOICE: {
    id: "COSYVOICE",
    name: "CosyVoice",
    description: "Alibaba's TTS, excellent Chinese + multilingual voices",
    costEstimate: "~$0.01/voiceover",
    qualityLabel: "Great",
    envVar: "DASHSCOPE_API_KEY",
  },
  FISH_AUDIO: {
    id: "FISH_AUDIO",
    name: "Fish Audio",
    description: "Fast TTS with free tier, 30+ languages",
    costEstimate: "~$0.01/voiceover",
    qualityLabel: "Good",
    envVar: "FISH_AUDIO_API_KEY",
  },
  EDGE_TTS: {
    id: "EDGE_TTS",
    name: "Edge TTS",
    description: "100% free Microsoft neural voices, no API key needed",
    costEstimate: "Free",
    qualityLabel: "Great",
    envVar: "",
  },
  HF_TTS: {
    id: "HF_TTS",
    name: "Hugging Face TTS",
    description: "Unavailable: no TTS on Inference Providers yet. Use Gemini TTS or Edge TTS.",
    costEstimate: "—",
    qualityLabel: "Good",
    envVar: "HUGGINGFACE_API_KEY",
  },
};

export const IMAGE_PROVIDERS: Record<string, ProviderInfo> = {
  GEMINI_IMAGEN: {
    id: "GEMINI_IMAGEN",
    name: "Gemini Imagen",
    description: "Google's image generation, integrated with Gemini",
    costEstimate: "~$0.02/image",
    qualityLabel: "Great",
    envVar: "GEMINI_API_KEY",
  },
  DALLE3: {
    id: "DALLE3",
    name: "DALL-E 3",
    description: "OpenAI's image model, excellent prompt following",
    costEstimate: "~$0.08/image",
    qualityLabel: "Best",
    envVar: "OPENAI_API_KEY",
  },
  FLUX: {
    id: "FLUX",
    name: "Flux",
    description: "Fast, high quality via Replicate",
    costEstimate: "~$0.03/image",
    qualityLabel: "Great",
    envVar: "REPLICATE_API_TOKEN",
  },
  KOLORS: {
    id: "KOLORS",
    name: "Kolors",
    description: "Kuaishou's model, ultra low cost, strong photorealism",
    costEstimate: "~$0.004/image",
    qualityLabel: "Great",
    envVar: "REPLICATE_API_TOKEN",
  },
  SDXL: {
    id: "SDXL",
    name: "SDXL",
    description: "Stable Diffusion XL, reliable open source workhorse",
    costEstimate: "~$0.004/image",
    qualityLabel: "Good",
    envVar: "REPLICATE_API_TOKEN",
  },
  FLUX_SCHNELL: {
    id: "FLUX_SCHNELL",
    name: "Flux Schnell",
    description: "Fastest Flux variant, great speed-to-quality ratio",
    costEstimate: "~$0.003/image",
    qualityLabel: "Good",
    envVar: "REPLICATE_API_TOKEN",
  },
  TOGETHER: {
    id: "TOGETHER",
    name: "Together.ai",
    description: "Fast inference, free Flux Schnell tier available",
    costEstimate: "~$0.002/image",
    qualityLabel: "Good",
    envVar: "TOGETHER_API_KEY",
  },
  SILICONFLOW: {
    id: "SILICONFLOW",
    name: "SiliconFlow",
    description: "Cheapest option, Chinese infra, free tier available",
    costEstimate: "~$0.001/image",
    qualityLabel: "Good",
    envVar: "SILICONFLOW_API_KEY",
  },
  LEONARDO: {
    id: "LEONARDO",
    name: "Leonardo.ai",
    description: "150 free images/day, Alchemy for enhanced quality",
    costEstimate: "Free/~$0.01",
    qualityLabel: "Great",
    envVar: "LEONARDO_API_KEY",
  },
  IDEOGRAM: {
    id: "IDEOGRAM",
    name: "Ideogram 3.0",
    description: "Best text rendering in images, high creativity",
    costEstimate: "~$0.04/image",
    qualityLabel: "Best",
    envVar: "IDEOGRAM_API_KEY",
  },
  POLLINATIONS: {
    id: "POLLINATIONS",
    name: "Pollinations",
    description: "Free image generation via Pollinations.ai (free key at enter.pollinations.ai)",
    costEstimate: "Free",
    qualityLabel: "Good",
    envVar: "POLLINATIONS_API_KEY",
  },
  HF_IMAGE: {
    id: "HF_IMAGE",
    name: "Hugging Face Image",
    description: "Free FLUX.1-schnell via Inference API. Set HF_IMAGE_MODEL to override.",
    costEstimate: "Free (rate limits)",
    qualityLabel: "Great",
    envVar: "HUGGINGFACE_API_KEY",
  },
};

const PROVIDER_MAPS: Record<ProviderStage, Record<string, ProviderInfo>> = {
  llm: LLM_PROVIDERS,
  tts: TTS_PROVIDERS,
  image: IMAGE_PROVIDERS,
};

export const PLATFORM_DEFAULTS = {
  llm: "GEMINI_FLASH" as const,
  tts: "GEMINI_TTS" as const,
  image: "GEMINI_IMAGEN" as const,
};

function isEnvAvailable(envVar: string): boolean {
  if (!envVar) return true;
  if (envVar === "HUGGINGFACE_API_KEY") return isHuggingFaceConfigured();
  return !!process.env[envVar];
}

/** Hugging Face providers use the same token from any of the 3 env vars. */
function isHfStoryEnvAvailable(): boolean {
  return isHuggingFaceConfigured();
}

function isLlmProviderAvailable(p: ProviderInfo): boolean {
  if (p.id === "HF_STORY" || p.id.startsWith("HF_STORY_")) {
    return isHfStoryEnvAvailable();
  }
  return isEnvAvailable(p.envVar);
}

/** HF TTS is not offered on Inference Providers (router returns 404 for all TTS models). */
function isTtsProviderAvailable(p: ProviderInfo): boolean {
  if (p.id === "HF_TTS") return false;
  return isEnvAvailable(p.envVar);
}

export function getAvailableProviders(stage: ProviderStage): ProviderInfo[] {
  const map = PROVIDER_MAPS[stage];
  if (stage === "llm") {
    return Object.values(map).filter((p) => isLlmProviderAvailable(p));
  }
  if (stage === "tts") {
    return Object.values(map).filter((p) => isTtsProviderAvailable(p));
  }
  return Object.values(map).filter((p) => isEnvAvailable(p.envVar));
}

export function isProviderAvailable(stage: ProviderStage, providerId: string): boolean {
  const map = PROVIDER_MAPS[stage];
  const info = map[providerId];
  if (!info) return false;
  if (stage === "llm" && (info.id === "HF_STORY" || info.id.startsWith("HF_STORY_"))) {
    return isHfStoryEnvAvailable();
  }
  if (stage === "tts" && info.id === "HF_TTS") return false;
  return isEnvAvailable(info.envVar);
}

export function getProviderInfo(stage: ProviderStage, providerId: string): ProviderInfo | undefined {
  return PROVIDER_MAPS[stage][providerId];
}

export function getAllProviders(stage: ProviderStage): ProviderInfo[] {
  return Object.values(PROVIDER_MAPS[stage]);
}
