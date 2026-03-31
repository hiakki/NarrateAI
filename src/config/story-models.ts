/**
 * Hugging Face story models — only models verified to work with router chat-completions.
 * Tested with: curl POST https://router.huggingface.co/v1/chat/completions (2026-03-07).
 * Only Qwen/Qwen2.5-7B-Instruct returned 200; Zephyr, Mistral, Qwen2.5-1.5B returned 400 (provider not enabled).
 */

export interface StoryModelConfig {
  id: string;
  name: string;
  modelId: string;
  niches: string[];
  tones: string[];
  temperature: number;
  ambience: string[];
  priority: number;
}

export const STORY_MODELS: StoryModelConfig[] = [
  {
    id: "qwen-7b",
    name: "Qwen 7B Instruct",
    modelId: "Qwen/Qwen2.5-7B-Instruct",
    niches: [],
    tones: [],
    temperature: 0.9,
    ambience: ["engaging", "instruction", "concise", "conversational"],
    priority: 0,
  },
];

export interface ResolvedStoryModel {
  modelId: string;
  temperature: number;
  modelName: string;
}

export function resolveStoryModel(
  niche: string,
  tone: string,
  ambienceKeywords: string
): ResolvedStoryModel {
  const envModel = process.env.HF_STORY_MODEL?.trim();
  if (envModel) {
    const known = STORY_MODELS.find((m) => m.modelId === envModel);
    return {
      modelId: envModel,
      temperature: known?.temperature ?? 0.9,
      modelName: known?.name ?? envModel,
    };
  }
  const chosen = STORY_MODELS[0];
  return {
    modelId: chosen.modelId,
    temperature: chosen.temperature,
    modelName: chosen.name,
  };
}

export function getStoryModelById(id: string): StoryModelConfig | undefined {
  return STORY_MODELS.find((m) => m.id === id);
}

export function getAllStoryModels(): StoryModelConfig[] {
  return [...STORY_MODELS];
}

export function storyModelToProviderId(storyModelId: string): string {
  return `HF_STORY_${storyModelId.replace(/-/g, "_").toUpperCase()}`;
}

export function providerIdToStoryModelId(providerId: string): string | undefined {
  if (providerId === "HF_STORY") return undefined;
  if (!providerId.startsWith("HF_STORY_")) return undefined;
  const suffix = providerId.slice("HF_STORY_".length).replace(/_/g, "-").toLowerCase();
  return STORY_MODELS.some((m) => m.id === suffix) ? suffix : undefined;
}
