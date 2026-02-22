import type { ArtStyle } from "@/config/art-styles";

const COMPOSITION_CYCLE = [
  "extreme close-up, shallow depth of field",
  "wide establishing shot, full environment visible",
  "medium shot, subject centered",
  "low angle looking up, imposing perspective",
  "close-up with bokeh background",
  "wide cinematic shot, rule of thirds composition",
  "dutch angle, tilted perspective for unease",
  "over-the-shoulder framing",
  "bird's eye view, looking down",
  "tight crop, intense detail focus",
];

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
  const composition = COMPOSITION_CYCLE[sceneIndex % COMPOSITION_CYCLE.length];

  const position = getScenePosition(sceneIndex, totalScenes);
  const positionBoost = POSITION_BOOSTERS[position];

  const prompt = [
    artStyle.promptModifier,
    `${composition}, vertical 9:16 portrait composition`,
    positionBoost,
    visualDescription,
    "masterpiece, best quality, no text, no watermarks, no logos",
  ]
    .filter(Boolean)
    .join(", ");

  return {
    prompt: prompt.slice(0, 1500),
    negativePrompt: artStyle.negativePrompt,
  };
}

type ScenePosition = "hook" | "build" | "escalate" | "climax" | "resolve";

function getScenePosition(index: number, total: number): ScenePosition {
  if (index === 0) return "hook";
  if (index === total - 1) return "resolve";
  const progress = index / (total - 1);
  if (progress < 0.35) return "build";
  if (progress < 0.75) return "escalate";
  return "climax";
}

const POSITION_BOOSTERS: Record<ScenePosition, string> = {
  hook: "dramatic reveal, maximum visual impact, attention-grabbing, the most striking image",
  build: "atmospheric establishing shot, rich environmental detail, world-building",
  escalate: "increasing intensity, dynamic energy, rising tension, dramatic lighting shift",
  climax: "peak dramatic intensity, maximum contrast, visceral visual impact, unforgettable image",
  resolve: "lingering atmosphere, haunting stillness, emotional resonance, the final image that stays with you",
};
