import { getTtsProvider } from "./providers/factory";
import { PLATFORM_DEFAULTS } from "@/config/providers";

export type { TTSResult } from "./providers/tts/types";
import type { TTSResult } from "./providers/tts/types";

export async function generateSpeech(
  scriptText: string,
  voiceId: string,
  scenes: { text: string }[],
  provider?: string
): Promise<TTSResult> {
  const tts = getTtsProvider(provider ?? PLATFORM_DEFAULTS.tts);
  return tts.generateSpeech(scriptText, voiceId, scenes);
}
