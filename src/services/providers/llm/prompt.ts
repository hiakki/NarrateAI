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
- Scene 1 MUST open with a strong hook in the first 2 seconds (surprise, conflict, shocking fact, or emotional trigger).
- Build emotional intensity across scenes — never repeat the same energy level
- Tell a COMPLETE story with a beginning, rising tension, climax, and resolution — do NOT leave the story unfinished
- Keep each scene narration in a tight 1-2 lines so pacing stays fast for reels/shorts.
${languageRule}

═══ VISUAL DESCRIPTION RULES (CRITICAL — READ CAREFULLY) ═══
The "visualDescription" field is THE MOST IMPORTANT PART. It is the ONLY input an AI image generator receives.
Each visualDescription MUST be 80-120 words of rich, specific, cinematic detail. NEVER write generic or vague descriptions.

CRITICAL RULE — MATCH NARRATION EXACTLY:
Each scene's visualDescription MUST directly illustrate EXACTLY what is being narrated in the "text" field for that scene.
If the text says "she opened the old letter", the image MUST show someone opening an old letter — NOT a generic atmospheric shot.
The image should capture the SPECIFIC MOMENT, ACTION, and SUBJECT described in the narration. Every image must feel like a frame from the exact second the narration is happening.

EVERY visualDescription MUST contain ALL of these elements:
1. SUBJECT: Exactly what/who is shown — specific person, object, creature with physical details (age, clothing, expression, posture). Must match the narration's subject precisely.
2. ACTION/GESTURE: What the subject is DOING right now — hands reaching, eyes widening, body turning, object falling. Images must feel ALIVE and IN-MOTION, not static poses. Capture the peak moment of the action described in narration.
3. ENVIRONMENT: Precise setting with tangible details — not "a dark room" but "a dimly lit Victorian study with peeling wallpaper, a single candle flickering on a mahogany desk"
4. CAMERA: Shot type (extreme close-up, wide establishing, low angle, over-shoulder, bird's eye, dutch angle)
5. LIGHTING: Specific light source and quality (rim lighting from a cracked window, volumetric god rays through fog, warm firelight casting long shadows, cold moonlight)
6. COLOR PALETTE: Dominant colors and contrast (desaturated blues with a single red accent, warm amber tones fading to black, neon pink reflecting on wet surfaces)
7. ATMOSPHERE & ENERGY: Mood-setting details that convey movement and life — rising dust particles, curling smoke, falling rain, swirling fog, flying debris, rippling water, fluttering fabric, sparks, wind-blown hair. The scene must feel DYNAMIC, not frozen.

BAD example (too vague, static — will produce DULL images):
"A scary dark hallway with a ghost"

BAD example (doesn't match narration — misleading image):
Narration: "He picked up the broken mirror" → Image: "A dark spooky room with cobwebs" (WRONG — must show someone picking up a broken mirror)

GOOD example (specific, dynamic, matches narration — will produce STUNNING images):
Narration: "He reached into the darkness, and something cold gripped his wrist"
Image: "Extreme close-up of a pale hand with cracked fingernails gripping a trembling human wrist emerging from pitch blackness, fingers tightening with visible tension in the tendons, a long dark Victorian corridor stretching behind into pitch blackness, single bare light bulb swinging overhead casting oscillating shadows on peeling wallpaper, sickly yellow-green light against deep charcoal shadows, dust particles disturbed by sudden movement swirling in the cone of light, oppressive claustrophobic atmosphere with visible breath condensation in cold air"

Return ONLY valid JSON:
{
  "title": "catchy title under 60 chars",
  "description": "1-2 sentence hook for social media",
  "hashtags": ["relevant", "trending", "hashtags"],
  "scenes": [
    {
      "text": "narration text spoken by voiceover for this scene",
      "visualDescription": "80-120 word cinematic image prompt with SUBJECT + ACTION + ENVIRONMENT + CAMERA + LIGHTING + COLOR PALETTE + ATMOSPHERE & ENERGY — must depict EXACTLY what is narrated — ALWAYS in English"
    }
  ]
}

Generate exactly ${sceneCount} scenes. Every scene must be visually DISTINCT — different camera angle, different color temperature, different subject focus. ESCALATE visual intensity with the story.
Intensity curve guidance:
- Scene 1: Hook (high curiosity/shock)
- Scenes 2-${Math.max(2, sceneCount - 2)}: Build tension and stakes with progressively stronger visual/action beats
- Scene ${Math.max(2, sceneCount - 1)}: Peak intensity / climax frame
- Scene ${sceneCount}: Resolution frame with payoff (still emotionally strong, but narratively conclusive)

FINAL CHECK — Ask yourself for EACH scene:
1. Does the image show EXACTLY what the narration describes? (If text says "he ran", does the image show running?)
2. Does the image feel ALIVE — with motion, energy, and a captured-in-the-moment quality?
3. Would a viewer IMMEDIATELY understand what is happening in the story just from the image?
If any answer is NO, rewrite that visualDescription until all three are YES.`;
}
