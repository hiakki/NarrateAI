import { getImageProvider } from "./providers/factory";
import { PLATFORM_DEFAULTS } from "@/config/providers";

export type { ImageGenResult } from "./providers/image/types";
import type { ImageGenResult } from "./providers/image/types";

export async function generateSceneImages(
  scenes: { visualDescription: string }[],
  artStylePrompt: string,
  provider?: string
): Promise<ImageGenResult> {
  const img = getImageProvider(provider ?? PLATFORM_DEFAULTS.image);
  return img.generateImages(scenes, artStylePrompt);
}
