import type { ArtStyle } from "@/config/art-styles";

const COMPOSITION_CYCLE = [
  "extreme close-up, razor-sharp focus on subject with creamy bokeh background, f/1.4 aperture",
  "wide establishing shot, full environment visible, deep depth of field, epic scale",
  "medium shot, subject centered with environmental context, balanced composition",
  "low angle looking up, imposing and powerful perspective, dramatic foreshortening",
  "intimate close-up, emotional detail, soft background blur, 85mm portrait lens",
  "wide cinematic shot, rule of thirds, leading lines drawing the eye, anamorphic widescreen feel",
  "dutch angle, tilted 15 degrees for psychological unease, dynamic diagonal lines",
  "over-the-shoulder framing, voyeuristic perspective, shallow depth of field",
  "bird's eye view, looking straight down, abstract geometric patterns in the scene",
  "tight crop on texture and detail, macro-like focus, every pore and fiber visible",
];

const LIGHTING_CYCLE = [
  "harsh single-source rim lighting with deep shadows, chiaroscuro contrast",
  "soft diffused golden hour light, warm amber tones wrapping around the subject",
  "cold moonlight from above, steel-blue highlights with pitch-black shadows",
  "volumetric god rays piercing through fog, atmospheric haze scattering light",
  "neon-colored practical lights reflecting on wet surfaces, cyberpunk glow",
  "dramatic split lighting, half the face lit and half in total darkness",
  "backlit silhouette with bright halo edge, lens flare blooming around the subject",
  "overhead fluorescent casting sickly green, institutional and unsettling",
  "candlelight warmth, flickering orange tones, intimate and mysterious shadows",
  "overcast flat light with rich color saturation, moody and contemplative",
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
  const lighting = LIGHTING_CYCLE[sceneIndex % LIGHTING_CYCLE.length];

  const position = getScenePosition(sceneIndex, totalScenes);
  const positionBoost = POSITION_BOOSTERS[position];

  const prompt = [
    artStyle.promptModifier,
    composition,
    lighting,
    "vertical 9:16 portrait composition",
    positionBoost,
    visualDescription,
    QUALITY_SUFFIX,
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
  hook: "dramatic reveal, maximum visual impact, stop-scrolling image, the single most striking frame",
  build: "rich environmental storytelling, atmospheric world-building, layered depth with foreground and background elements",
  escalate: "rising intensity, dynamic energy, dramatic lighting shift, heightened contrast and saturation",
  climax: "peak dramatic intensity, maximum contrast, visceral emotional impact, the most unforgettable image in the sequence",
  resolve: "lingering haunting atmosphere, eerie stillness, emotional weight, the final image that stays in your mind",
};

const QUALITY_SUFFIX =
  "masterpiece, award-winning photography, ultra-detailed, 8k resolution, professional color grading, cinematic depth of field, no text, no watermarks, no logos, no UI elements";
