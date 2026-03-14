import type { ScriptInput } from "./types";
import { getLanguageName } from "@/config/languages";
import { getPromptEnhancer } from "@/config/prompt-enhancers";

const NARRATIVE_VARIETY_RULES = [
  "Open with a shocking statistic, specific number, or little-known fact — not a generic question or 'you're being...' statement.",
  "Start in the middle of the action (in medias res); reveal context only as the story unfolds.",
  "Open with a specific real-world scenario: name a place, a year, or a person — ground the story in concrete reality.",
  "Use a countdown or timeline structure (e.g. 'In 24 hours...', 'By day 3...') to drive the story.",
  "Open with a myth, legend, or historical parallel that connects to the main premise.",
  "Begin with a contradiction or paradox that the story will resolve or deepen.",
  "Open with a vivid sensory detail or single image, then expand into the full story.",
  "Start with a bold claim or 'what if' that sounds impossible, then prove it step by step.",
  "Open with a short dialogue or quote from a real person, then reveal who said it and why it matters.",
  "Begin with the consequence or ending first, then show how we got there.",
  "Open with a question the viewer has never considered — something non-obvious that reframes the topic.",
  "Start with a mini story about a specific person (real or composite) who experienced this — humanize the concept.",
  "Open by describing a common everyday moment, then reveal the hidden psychology/science behind it.",
  "Begin with 'In [year], [specific event happened]...' — anchor in a real historical moment.",
  "Open with two contrasting images or ideas side-by-side, then explain the hidden connection.",
  "Start with something the viewer does every day without thinking — then explain what's really happening.",
];

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function getNarrativeVarietyConstraint(varietySeed: string | undefined): string {
  if (!varietySeed) return "";
  const index = hashSeed(varietySeed) % NARRATIVE_VARIETY_RULES.length;
  const rule = NARRATIVE_VARIETY_RULES[index];
  return `\n═══ THIS SCRIPT ONLY (narrative constraint — follow exactly) ═══\n- ${rule}\n`;
}

export function getSceneCount(duration: number): number {
  if (duration <= 30) return 4;
  if (duration <= 45) return 5;
  if (duration <= 60) return 6;
  if (duration <= 90) return 8;
  return Math.min(12, Math.round(duration / 10));
}

export function buildPrompt(input: ScriptInput, sceneCount: number, characterPrompt?: string): string {
  const lang = input.language ?? "en";
  const langName = getLanguageName(lang);
  const isNonEnglish = lang !== "en";

  const enhancer = getPromptEnhancer(input.niche, input.tone);

  // TTS speaks at ~2 w/s. Platform limit is 90s for Reels/Shorts.
  const PLATFORM_MAX_SECS = 88; // 2s safety margin
  const minTotalWords = Math.max(1, Math.floor(input.duration * 0.9 * 2.0));
  const targetTotalWords = Math.round(input.duration * 2.5);
  const maxTotalWords = Math.floor(PLATFORM_MAX_SECS * 2.0);
  const minWordsPerScene = Math.ceil(minTotalWords / sceneCount);
  const targetWordsPerScene = Math.ceil(targetTotalWords / sceneCount);
  const maxWordsPerScene = Math.floor(maxTotalWords / sceneCount);

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

  const characterBlock = characterPrompt ? `
═══ CHARACTER MODE (ACTIVE) ═══
This video features a RECURRING MAIN CHARACTER who MUST appear in EVERY scene.

CHARACTER APPEARANCE (include this description VERBATIM at the start of every visualDescription):
"${characterPrompt}"

CHARACTER RULES:
1. The character above is the PROTAGONIST — every scene shows THEM doing something.
2. EVERY visualDescription MUST begin with the full character description, then describe the character's specific action, expression, and pose for that scene.
3. VISUAL CONSISTENCY IS CRITICAL: same body type, same clothing, same features in EVERY image. AI image generators have no memory between scenes — the ONLY way to maintain consistency is repeating the exact same character description.
4. Narration should reference the character's actions, reactions, and dialogue.
5. Vary the character's EXPRESSION and POSE per scene to match the story beat, but NEVER change their physical appearance or outfit.

` : "";

  const videoTypeLabel = characterPrompt ? "character-driven narration" : "faceless narration";

  return `You are an expert short-form video scriptwriter AND cinematic image prompt engineer who creates VIRAL content. Create a script for a ~${input.duration}-second ${videoTypeLabel} video.

NICHE: ${input.niche}
TONE: ${input.tone}
ART STYLE: ${input.artStyle}
MOOD: ${enhancer.moodKeywords}
LANGUAGE: ${langName}
${input.topic ? `TOPIC: ${input.topic}` : "Choose a trending, highly engaging topic for this niche."}
${input.avoidThemes?.length
    ? `\nAVOID THESE THEMES/PREMISES AND OPENING LINES (do NOT repeat or closely mimic ANY of these):\n${input.avoidThemes.map(t => `  ✗ ${t}`).join("\n")}`
    : ""}
${characterBlock}
═══ UNIQUENESS (CRITICAL — EVERY VIDEO MUST BE DIFFERENT) ═══
- Create a UNIQUE story. Do NOT reuse the same premise, twist, or concept. Pick a FRESH angle, an unexpected interpretation, or a rarely-told aspect.
- THE OPENING LINE IS THE MOST IMPORTANT THING TO VARY. Never start two videos the same way. If the avoid list above contains opening lines, your first sentence MUST be completely different in structure, topic, and phrasing.
- Avoid overused tropes and clichés for this niche (e.g. for dark-psychology: NOT "you're being manipulated" every time — vary with specific studies, historical events, real scenarios, unusual angles).
- If no specific topic was given, actively choose something DISTINCT from typical viral repeats. Surprise the viewer with a premise they haven't seen before.
- Each script must feel like a different episode: different hook, different conflict, different payoff. Never output the "default" or most obvious idea for the niche.
${input.varietySeed ? `- This run (seed: ${input.varietySeed}) must produce a story that feels different from any other — use the seed as a mental nudge to pick a non-obvious premise.` : ""}
${getNarrativeVarietyConstraint(input.varietySeed)}

STORYTELLING RULES (follow these precisely):
${storytellingBlock}

VISUAL DESCRIPTION GUIDE (match each scene to this structure):
${visualGuideBlock}

═══ NARRATION RULES ═══
- The "text" field is narration spoken by AI voiceover — write it to be HEARD, not read
- LENGTH (NON-NEGOTIABLE — script REJECTED if outside range):
  * Target: ${targetTotalWords} words of narration total (across all ${sceneCount} scenes).
  * MINIMUM: ${minTotalWords} words — shorter = video too short = REJECTED.
  * MAXIMUM: ${maxTotalWords} words — longer = video exceeds 90-second platform limit for Reels/Shorts = REJECTED.
  * Acceptable range: ${minTotalWords}–${maxTotalWords} words. Aim for exactly ${targetTotalWords}.
  * Per scene: ${minWordsPerScene}–${maxWordsPerScene} words each — 3-5 full sentences, not one.
  * Common mistake: writing a single 8-12 word sentence per scene. That produces a 20-second video instead of ${input.duration}s.
- Use short, punchy sentences. Every word must earn its place.
- Scene 1 MUST open with a strong hook in the first 2 seconds (surprise, conflict, shocking fact, or emotional trigger).
- Build emotional intensity across scenes — never repeat the same energy level
- COMPLETE STORY (CRITICAL): The story must feel finished, not cut off. Structure: (1) Hook/setup, (2) Rising tension or conflict, (3) Climax, (4) Clear resolution or payoff. The final scene MUST deliver closure — answer the hook, resolve the conflict, or give a satisfying takeaway. Never end on a cliffhanger or mid-thought; the viewer should feel the story is complete.
- Keep pacing tight for reels/shorts but ensure EACH scene has enough dialogue to fill ~${(input.duration / sceneCount).toFixed(0)} seconds when spoken.
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
- Scene ${sceneCount}: Resolution — closure, payoff, or clear takeaway. The viewer must feel the story is DONE, not that it was cut short. No cliffhangers.

FINAL CHECK — Ask yourself for EACH scene:
1. Does the image show EXACTLY what the narration describes? (If text says "he ran", does the image show running?)
2. Does the image feel ALIVE — with motion, energy, and a captured-in-the-moment quality?
3. Would a viewer IMMEDIATELY understand what is happening in the story just from the image?
4. WORD COUNT CHECK: Count every word in "text" across ALL scenes. Must be between ${minTotalWords}–${maxTotalWords} words (target ${targetTotalWords}). Too few → expand scenes. Too many → trim sentences.
5. Does the story feel COMPLETE? Does the last scene give closure (resolution, answer to the hook, or clear takeaway)? Would a viewer feel satisfied, not cut off? If the ending feels abrupt or like a cliffhanger, rewrite the final scene(s).${characterPrompt ? `
6. CHARACTER CHECK: Does every visualDescription start with the full character description? Is the character the main focus of every scene? Are their appearance and outfit IDENTICAL across all scenes?` : ""}
If any answer is NO, rewrite until all are YES.`;
}
