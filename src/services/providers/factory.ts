import type { LlmProviderInterface } from "./llm/types";
import type { TtsProviderInterface } from "./tts/types";
import type { ImageProviderInterface } from "./image/types";

import { GeminiLlmProvider } from "./llm/gemini";
import { OpenAILlmProvider } from "./llm/openai";
import { DeepSeekLlmProvider } from "./llm/deepseek";
import { QwenLlmProvider } from "./llm/qwen";

import { GeminiTtsProvider } from "./tts/gemini";
import { ElevenLabsTtsProvider } from "./tts/elevenlabs";
import { CosyVoiceTtsProvider } from "./tts/cosyvoice";
import { FishAudioTtsProvider } from "./tts/fishaudio";
import { EdgeTtsProvider } from "./tts/edge-tts";

import { GeminiImageProvider } from "./image/gemini";
import { DalleImageProvider } from "./image/dalle";
import { FluxImageProvider } from "./image/flux";
import { KolorsImageProvider } from "./image/kolors";
import { SdxlImageProvider } from "./image/sdxl";
import { FluxSchnellImageProvider } from "./image/flux-schnell";
import { TogetherImageProvider } from "./image/together";
import { SiliconFlowImageProvider } from "./image/siliconflow";
import { LeonardoImageProvider } from "./image/leonardo";
import { IdeogramImageProvider } from "./image/ideogram";
import { PollinationsImageProvider } from "./image/pollinations";

const LLM_MAP: Record<string, () => LlmProviderInterface> = {
  GEMINI_FLASH: () => new GeminiLlmProvider(),
  OPENAI_GPT4O_MINI: () => new OpenAILlmProvider(),
  DEEPSEEK_V3: () => new DeepSeekLlmProvider(),
  QWEN: () => new QwenLlmProvider(),
};

const TTS_MAP: Record<string, () => TtsProviderInterface> = {
  GEMINI_TTS: () => new GeminiTtsProvider(),
  ELEVENLABS: () => new ElevenLabsTtsProvider(),
  COSYVOICE: () => new CosyVoiceTtsProvider(),
  FISH_AUDIO: () => new FishAudioTtsProvider(),
  EDGE_TTS: () => new EdgeTtsProvider(),
};

const IMAGE_MAP: Record<string, () => ImageProviderInterface> = {
  GEMINI_IMAGEN: () => new GeminiImageProvider(),
  DALLE3: () => new DalleImageProvider(),
  FLUX: () => new FluxImageProvider(),
  KOLORS: () => new KolorsImageProvider(),
  SDXL: () => new SdxlImageProvider(),
  FLUX_SCHNELL: () => new FluxSchnellImageProvider(),
  TOGETHER: () => new TogetherImageProvider(),
  SILICONFLOW: () => new SiliconFlowImageProvider(),
  LEONARDO: () => new LeonardoImageProvider(),
  IDEOGRAM: () => new IdeogramImageProvider(),
  POLLINATIONS: () => new PollinationsImageProvider(),
};

export function getLlmProvider(provider: string): LlmProviderInterface {
  const factory = LLM_MAP[provider];
  if (!factory) {
    throw new Error(`Unknown LLM provider: "${provider}". Valid: ${Object.keys(LLM_MAP).join(", ")}`);
  }
  return factory();
}

export function getTtsProvider(provider: string): TtsProviderInterface {
  const factory = TTS_MAP[provider];
  if (!factory) {
    throw new Error(`Unknown TTS provider: "${provider}". Valid: ${Object.keys(TTS_MAP).join(", ")}`);
  }
  return factory();
}

export function getImageProvider(provider: string): ImageProviderInterface {
  const factory = IMAGE_MAP[provider];
  if (!factory) {
    throw new Error(`Unknown Image provider: "${provider}". Valid: ${Object.keys(IMAGE_MAP).join(", ")}`);
  }
  return factory();
}
