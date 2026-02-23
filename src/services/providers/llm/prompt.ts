import type { ScriptInput } from "./types";
import { getLanguageName } from "@/config/languages";
import { getPromptEnhancer } from "@/config/prompt-enhancers";

export function getSceneCount(duration: number): number {
  if (duration <= 30) return 4;
  if (duration <= 45) return 5;
  if (duration <= 60) return 6;
  if (duration <= 90) return 8;
  return Math.min(12, Math.round(duration / 10));
}

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

  return `You are an expert short-form video scriptwriter AND cinematic image prompt engineer who creates VIRAL content. Create a script for a ~${input.duration}-second faceless narration video.

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

═══ NARRATION RULES ═══
- The "text" field is narration spoken by AI voiceover — write it to be HEARD, not read
- Target approximately ${input.duration} seconds of narration across all ${sceneCount} scenes
- Use short, punchy sentences. Every word must earn its place.
- Build emotional intensity across scenes — never repeat the same energy level
- Tell a COMPLETE story with a beginning, rising tension, climax, and resolution — do NOT leave the story unfinished
${languageRule}

═══ VISUAL DESCRIPTION RULES (CRITICAL — READ CAREFULLY) ═══
The "visualDescription" field is THE MOST IMPORTANT PART. It is the ONLY input an AI image generator receives.
Each visualDescription MUST be 60-100 words of rich, specific, cinematic detail. NEVER write generic or vague descriptions.

EVERY visualDescription MUST contain ALL of these elements:
1. SUBJECT: Exactly what/who is shown — specific person, object, creature with physical details (age, clothing, expression, posture)
2. ENVIRONMENT: Precise setting with tangible details — not "a dark room" but "a dimly lit Victorian study with peeling wallpaper, a single candle flickering on a mahogany desk"
3. CAMERA: Shot type (extreme close-up, wide establishing, low angle, over-shoulder, bird's eye, dutch angle)
4. LIGHTING: Specific light source and quality (rim lighting from a cracked window, volumetric god rays through fog, warm firelight casting long shadows, cold moonlight)
5. COLOR PALETTE: Dominant colors and contrast (desaturated blues with a single red accent, warm amber tones fading to black, neon pink reflecting on wet surfaces)
6. ATMOSPHERE: Mood-setting details (rising dust particles, curling smoke, falling rain, swirling fog, lens flare, film grain)

BAD example (too vague — will produce DULL images):
"A scary dark hallway with a ghost"

GOOD example (specific, cinematic — will produce STUNNING images):
"Extreme close-up of a pale hand with cracked fingernails gripping a rusted doorframe, a long dark Victorian corridor stretching behind into pitch blackness, single bare light bulb swinging overhead casting oscillating shadows on peeling wallpaper, sickly yellow-green light against deep charcoal shadows, dust particles floating in the cone of light, oppressive claustrophobic atmosphere with visible breath condensation in cold air"

Return ONLY valid JSON:
{
  "title": "catchy title under 60 chars",
  "description": "1-2 sentence hook for social media",
  "hashtags": ["relevant", "trending", "hashtags"],
  "scenes": [
    {
      "text": "narration text spoken by voiceover for this scene",
      "visualDescription": "60-100 word cinematic image prompt with SUBJECT + ENVIRONMENT + CAMERA + LIGHTING + COLOR PALETTE + ATMOSPHERE — ALWAYS in English"
    }
  ]
}

Generate exactly ${sceneCount} scenes. Every scene must be visually DISTINCT — different camera angle, different color temperature, different subject focus. ESCALATE visual intensity with the story.`;
}
