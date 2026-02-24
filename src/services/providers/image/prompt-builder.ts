import type { ArtStyle } from "@/config/art-styles";

export interface ImagePromptResult {
  prompt: string;
  negativePrompt: string;
}

export function buildImagePrompt(
  visualDescription: string,
  artStyle: ArtStyle,
  sceneIndex: number,
  totalScenes: number,
): ImagePromptResult {
  const prompt = [
    visualDescription,
    artStyle.promptModifier,
    "vertical 9:16 portrait composition",
    QUALITY_SUFFIX,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    prompt: prompt.slice(0, 1500),
    negativePrompt: artStyle.negativePrompt,
  };
}

const QUALITY_SUFFIX =
  "masterpiece, ultra-detailed, 8k resolution, professional color grading, cinematic depth of field, no text, no watermarks, no logos";
