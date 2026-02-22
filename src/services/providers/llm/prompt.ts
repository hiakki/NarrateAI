import type { ScriptInput } from "./types";
import { getLanguageName } from "@/config/languages";
import { getPromptEnhancer } from "@/config/prompt-enhancers";

export function buildPrompt(input: ScriptInput, sceneCount: number): string {
  const lang = input.language ?? "en";
  const langName = getLanguageName(lang);
  const isNonEnglish = lang !== "en";

  const enhancer = getPromptEnhancer(input.niche, input.tone);

  const languageRule = isNonEnglish
    ? `- IMPORTANT: Write ALL narration text ("text" field) in ${langName}. Use natural, conversational ${langName} — not transliteration.
- The "visualDescription" field MUST remain in English (for image generation).
- The "title", "description", and "hashtags" should be in ${langName}.`
    : `- Write all narration in English.`;

  const storytellingBlock = enhancer.storytellingRules
    .map((r) => `- ${r}`)
    .join("\n");

  const visualGuideBlock = enhancer.visualStyleGuide
    .map((g, i) => `  Scene ${i + 1}: ${g}`)
    .join("\n");

  return `You are an expert short-form video scriptwriter who creates VIRAL content. Create a script for a ${input.duration}-second faceless narration video.

NICHE: ${input.niche}
TONE: ${input.tone}
ART STYLE: ${input.artStyle}
MOOD: ${enhancer.moodKeywords}
LANGUAGE: ${langName}
${input.topic ? `TOPIC: ${input.topic}` : "Choose a trending, highly engaging topic for this niche."}

STORYTELLING RULES (follow these precisely):
${storytellingBlock}

VISUAL DESCRIPTION GUIDE (match each scene to this structure):
${visualGuideBlock}

TECHNICAL RULES:
- The "text" field is narration spoken by AI voiceover — write it to be HEARD, not read
- The "visualDescription" field is a detailed prompt for AI image generation (ALWAYS in English)
- Each visualDescription MUST be a vivid, specific, cinematic image prompt — NOT a vague summary
- Include composition (close-up, wide shot, dutch angle), lighting (rim light, volumetric fog, golden hour), and atmosphere in EVERY visualDescription
- Each scene should be 5-8 seconds of narration
- Use short, punchy sentences. Every word must earn its place.
${languageRule}

Return ONLY valid JSON:
{
  "title": "catchy title under 60 chars",
  "description": "1-2 sentence hook for social media",
  "hashtags": ["relevant", "trending", "hashtags"],
  "scenes": [
    {
      "text": "narration text spoken by voiceover for this scene",
      "visualDescription": "DETAILED cinematic image prompt: [composition] [subject] [lighting] [atmosphere] [style details] — ALWAYS in English"
    }
  ]
}

Generate exactly ${sceneCount} scenes. Every scene must be visually distinct and escalate the story.`;
}
