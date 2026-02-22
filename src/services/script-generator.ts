import { getLlmProvider } from "./providers/factory";
import { PLATFORM_DEFAULTS } from "@/config/providers";

export type { ScriptInput, Scene, GeneratedScript } from "./providers/llm/types";
import type { ScriptInput, GeneratedScript } from "./providers/llm/types";

export async function generateScript(
  input: ScriptInput,
  provider?: string
): Promise<GeneratedScript> {
  const llm = getLlmProvider(provider ?? PLATFORM_DEFAULTS.llm);
  return llm.generateScript(input);
}
