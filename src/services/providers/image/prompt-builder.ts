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
  characterPrompt?: string,
): ImagePromptResult {
  const cinematicCues = [
    "cinematic establishing shot, layered foreground/midground/background",
    "dynamic medium shot with implied motion and directional energy",
    "intense close-up with facial/subject detail and dramatic focus falloff",
    "low-angle dramatic perspective with depth and scale",
    "over-the-shoulder storytelling composition with contextual action",
    "wide environmental shot with atmospheric depth and moving elements",
  ];
  const cue = cinematicCues[sceneIndex % cinematicCues.length];
  const progressionCue =
    sceneIndex === 0
      ? "high-hook opening frame, immediate visual intrigue"
      : sceneIndex === totalScenes - 1
        ? "strong closing frame, visual resolution and payoff"
        : "escalating tension and visual intensity";

  const charPrefix = characterPrompt
    ? `[MAIN CHARACTER — must appear in this image: ${characterPrompt}] `
    : "";

  const prompt = [
    charPrefix + visualDescription,
    cue,
    progressionCue,
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
