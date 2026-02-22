import { PLATFORM_DEFAULTS } from "@/config/providers";

interface SeriesProviders {
  llmProvider: string | null;
  ttsProvider: string | null;
  imageProvider: string | null;
}

interface UserProviders {
  defaultLlmProvider: string | null;
  defaultTtsProvider: string | null;
  defaultImageProvider: string | null;
}

export interface ResolvedProviders {
  llm: string;
  tts: string;
  image: string;
}

export function resolveProviders(
  series: SeriesProviders | null,
  user: UserProviders | null
): ResolvedProviders {
  return {
    llm:
      series?.llmProvider ??
      user?.defaultLlmProvider ??
      PLATFORM_DEFAULTS.llm,
    tts:
      series?.ttsProvider ??
      user?.defaultTtsProvider ??
      PLATFORM_DEFAULTS.tts,
    image:
      series?.imageProvider ??
      user?.defaultImageProvider ??
      PLATFORM_DEFAULTS.image,
  };
}
