// Flow TV — niche-aware Gemini prompt builder.
//
// Replaces the static `sample_prompt` template with a function that produces a
// niche-specific prompt for the storyline generation step. The output JSON
// schema is identical across niches so the rest of the pipeline (cache, image
// gen, clip gen) stays niche-agnostic.
//
// Design notes:
//   - Visual prompts ALWAYS in English (Veo grounds best in English).
//   - When language=hindi + dialogue=on, Gemini emits dialogueHi (Devanagari)
//     for Veo to lip-sync, and dialogueRoman (Latin script) for ffmpeg subtitle
//     burn-in. For language=english, dialogueHi === dialogueRoman === English.
//   - characterStyle is woven into both characterPrompt and every imagePrompt
//     so Phase 1 image generation honors the style without further edits.
//   - aspectRatio is woven verbatim into framing instructions ("9:16 vertical
//     mobile-first" or "16:9 horizontal cinematic").
//   - bgm / sfx cues are per-scene strings that Phase 2 appends to the Veo
//     clip prompt only when those toggles are ON.

import type {
  FlowAspectRatio,
  FlowCharacterStyle,
  FlowLanguage,
  FlowNiche,
} from "./flow-tv-run";

export interface StorylineBuildOpts {
  imageCount: number;
  niche: FlowNiche;
  language: FlowLanguage;
  characterStyle: FlowCharacterStyle;
  aspectRatio: FlowAspectRatio;
  dialogue: boolean;
  bgm: boolean;
  sfx: boolean;
  avoidTitles?: string[];
  storyTitleHint?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Per-niche templates
// ──────────────────────────────────────────────────────────────────────────────

interface NicheTemplate {
  goal: string;
  archetypes: string[];
  arcStructure: string;
  toneNotes: string;
}

const NICHE_TEMPLATES: Record<FlowNiche, NicheTemplate> = {
  "zero-to-hero": {
    goal: "Tell ONE concrete zero-to-hero arc — a single protagonist who starts at rock bottom and reaches a clear hero moment.",
    archetypes: [
      "underdog athlete who finally wins",
      "broke founder whose product finally clicks",
      "overlooked employee who saves the company",
      "homeless artist whose work finally gets discovered",
      "injured musician returning to the stage",
      "struggling student who tops the class",
      "rescued shelter animal trained into a champion",
      "washed-up boxer returning for one last fight",
    ],
    arcStructure:
      "The arc has three phases — rock-bottom (loss, exhaustion, isolation, rejection), turning point (decision, training, mentor, breakthrough), hero moment (recognition, victory, vindication, calm pride). The LAST scene must always be the hero moment so the viewer feels the protagonist has arrived.",
    toneNotes:
      "Grounded, emotional, motivational. Avoid clichéd hero shots — favour intimate, specific moments.",
  },
  funny: {
    goal: "Tell ONE short comedic story with a clear setup, escalation, and punchline. BandarApnaDost-style — character-driven slapstick with a wholesome heart.",
    archetypes: [
      "mischievous monkey who outsmarts a vendor",
      "lazy office worker whose shortcut spectacularly backfires",
      "village kid trying to ride a runaway buffalo",
      "auntie who turns a wedding into chaos",
      "stray dog who steals a chef's signature dish",
      "rickshaw driver caught in an absurd traffic jam",
      "two friends arguing over the last samosa",
      "uncle who tries 'modern technology' for the first time",
    ],
    arcStructure:
      "Opening = setup (introduce the situation + character motivation in one beat). Middle = escalation (the plan goes hilariously wrong). Final = punchline (visual gag or twist that lands the laugh). Distribute beats so the funniest moment lands in the LAST scene.",
    toneNotes:
      "Exaggerated facial expressions, comic timing, big takes after small surprises. Slapstick should feel safe (no real harm). Punchlines should land on a visual beat, not just dialogue.",
  },
  moral: {
    goal: "Tell ONE Panchatantra-style fable — a short story where a character faces a choice and the consequence teaches a clear moral lesson.",
    archetypes: [
      "greedy crow who loses everything trying to grab more",
      "patient turtle who outsmarts a boastful rabbit",
      "kind farmer who is rewarded for sharing scarce food",
      "lazy student who learns the value of practice",
      "boastful peacock who is humbled by a quiet sparrow",
      "honest woodcutter rewarded by a forest spirit",
      "selfish merchant whose gold turns to leaves",
      "young prince who learns wisdom from a beggar",
    ],
    arcStructure:
      "Opening = the character's flaw is established (greed, laziness, pride, cruelty). Middle = the choice or temptation is laid before them. Final = the consequence — visual reveal of the lesson. The moral must be felt visually, never narrated as 'the moral is…'.",
    toneNotes:
      "Warm, parable-like, illustrative. Settings tend toward forests, villages, ancient kingdoms. Animals can speak via expressions and body language; humans via clear, emotive faces.",
  },
  horror: {
    goal: "Tell ONE short horror vignette built on dread, not gore. A character encounters something wrong and the tension escalates to a visual chill.",
    archetypes: [
      "lone traveller in an abandoned haveli at midnight",
      "girl who hears her name called from an empty room",
      "watchman who notices the same stranger in every photograph",
      "child who finds an old mirror that reflects someone else",
      "couple stranded on a forest road after their car dies",
      "tenant whose new flat has a door that won't stay locked",
      "researcher exploring a flooded basement at low tide",
      "village priest investigating a silent, uninhabited temple",
    ],
    arcStructure:
      "Opening = quiet, mundane setup (establish normality). Middle = a single wrong detail breaks the calm (a shadow that shouldn't be there, a sound, a misplaced object). Final = the reveal — the wrong detail becomes undeniable. End on a held image, NOT a jump scare.",
    toneNotes:
      "Atmospheric. Lighting heavy on shadow, cool desaturated palette, slow camera moves. Avoid blood, mutilation, or explicit ghosts — the threat is mostly off-screen. Tension lives in faces and negative space.",
  },
  mythological: {
    goal: "Tell ONE short vignette from Indian mythology (Ramayana, Mahabharata, Puranas, Bhagavata) — a single legendary moment captured cinematically.",
    archetypes: [
      "young Krishna stealing butter from a clay pot",
      "Hanuman lifting the Sanjeevani mountain",
      "Arjuna aiming at the rotating fish target",
      "Shiva opening his third eye to vanquish Kamadeva",
      "Karna donating his armour to a disguised Indra",
      "Ganesha writing the Mahabharata with his broken tusk",
      "young Prahlada protected from his father's wrath",
      "Draupadi's saree becoming endless during the disrobing",
    ],
    arcStructure:
      "Opening = establish the divine setting and the protagonist (god, hero, sage). Middle = the test, sacrifice, or divine choice. Final = the legendary visual moment — the act that the story is remembered for. Treat each beat as a frieze — composition matters more than action.",
    toneNotes:
      "Epic, reverent, painterly. Rich colour palettes (saffron, deep blue, gold), traditional Indian wardrobes, temple/forest/palace settings. No cartoon irreverence — even comedic moments (e.g. baby Krishna) are framed lovingly.",
  },
};

// ──────────────────────────────────────────────────────────────────────────────
//  Style + ratio injection
// ──────────────────────────────────────────────────────────────────────────────

const STYLE_DESCRIPTORS: Record<FlowCharacterStyle, string> = {
  cartoon_3d:
    "3D animated cartoon character, Pixar/DreamWorks style — expressive eyes, exaggerated proportions, clean stylized rendering, vibrant colours, soft shading. NOT photoreal. NOT anime. NOT realistic.",
  photoreal:
    "Photoreal cinematic character — natural skin tones, realistic clothing materials, grounded lighting. NOT cartoon, NOT illustrated.",
};

const RATIO_DESCRIPTORS: Record<FlowAspectRatio, string> = {
  "9:16":
    "9:16 vertical mobile-first composition — frame the protagonist top-to-bottom, leave headroom and lower-third space, suitable for YouTube Shorts and Instagram Reels.",
  "16:9":
    "16:9 horizontal cinematic composition — standard widescreen framing for YouTube long-form.",
};

// ──────────────────────────────────────────────────────────────────────────────
//  Output JSON schema (per-niche shared)
// ──────────────────────────────────────────────────────────────────────────────

function buildOutputSchema(opts: StorylineBuildOpts): string {
  const dialogueFields = opts.dialogue
    ? `,
      "dialogueHi": "${opts.language === "hindi" ? "EXACT Devanagari text (हिन्दी) the character speaks in this scene, 1 short sentence, max 12 words." : "Empty string."}",
      "dialogueRoman": "${opts.language === "hindi" ? "Romanized (Latin script) transliteration of dialogueHi for subtitles. Same meaning. Max 12 words." : "EXACT English line the character speaks in this scene, max 12 words. (Use as both dialogueHi and dialogueRoman so downstream code is uniform.)"}"`
    : "";
  const bgmField = opts.bgm
    ? `,
      "bgmCue": "Short instruction for background music in this scene (e.g. 'soft tabla loop, low energy', 'rising orchestral swell', 'comedic xylophone stings'). Keep under 12 words."`
    : "";
  const sfxField = opts.sfx
    ? `,
      "sfxCue": "Short instruction for diegetic sound effects in this scene (e.g. 'distant temple bell, soft footsteps on grass', 'glass shattering, crowd gasp'). Keep under 14 words."`
    : "";

  return `{
  "title": "<= 60 chars, no clickbait, names the arc",
  "logline": "1 sentence describing the full arc in plain language",
  "protagonist": "1 sentence locking in look + key prop",
  "characterPrompt": "40-80 word cinematic portrait prompt for the reference image. Starts with the protagonist description verbatim, then the neutral setting, then camera + lens + lighting + framing. ALWAYS English.",
  "imagePrompts": [
    {
      "title": "short scene label, kebab-case, <= 40 chars",
      "prompt": "60-100 word cinematic prompt. ALWAYS English. Start with the protagonist description verbatim, then setting, then action, then camera + lens + lighting + mood."${dialogueFields}${bgmField}${sfxField}
    }
  ]
}`;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Public entrypoint
// ──────────────────────────────────────────────────────────────────────────────

export function buildStorylinePrompt(opts: StorylineBuildOpts): string {
  const tpl = NICHE_TEMPLATES[opts.niche];
  const styleLine = STYLE_DESCRIPTORS[opts.characterStyle];
  const ratioLine = RATIO_DESCRIPTORS[opts.aspectRatio];

  const archetypeList = tpl.archetypes.map((a) => `  - ${a}`).join("\n");

  const avoidLine =
    (opts.avoidTitles?.length ?? 0) > 0
      ? `\nAvoid titles or premises that resemble any of these previous attempts: ${opts.avoidTitles!
          .map((t) => `"${t}"`)
          .join(
            ", ",
          )}. Pick a clearly different protagonist, setting, and arc.\n`
      : "";

  const titleHintLine = opts.storyTitleHint
    ? `\nThe user gave a soft title hint: "${opts.storyTitleHint}". Use it as inspiration; you are free to refine the wording.\n`
    : "";

  const audioNote = (() => {
    const audioOn: string[] = [];
    if (opts.dialogue) audioOn.push("dialogue (lip-synced speech)");
    if (opts.bgm) audioOn.push("background music");
    if (opts.sfx) audioOn.push("sound effects");
    if (audioOn.length === 0) {
      return "Audio: clips are silent. Do NOT include dialogueHi, dialogueRoman, bgmCue, or sfxCue fields.";
    }
    return `Audio plan: clips will include ${audioOn.join(", ")}. Generate the corresponding fields (${[
      opts.dialogue ? "dialogueHi, dialogueRoman" : null,
      opts.bgm ? "bgmCue" : null,
      opts.sfx ? "sfxCue" : null,
    ]
      .filter(Boolean)
      .join(", ")}) for EVERY scene.`;
  })();

  const dialogueLanguageNote = opts.dialogue
    ? opts.language === "hindi"
      ? "Dialogue language: HINDI. dialogueHi MUST be in Devanagari script (हिन्दी). dialogueRoman is the Latin-script transliteration. Keep lines short, natural, and child-friendly."
      : "Dialogue language: ENGLISH. dialogueHi and dialogueRoman should both contain the same English line. Keep lines short and natural."
    : "";

  return `You are a visual story director writing for Google Flow's "${opts.niche}" niche.
Output is consumed by an image generator and a video chainer, so every visual
must be self-contained, cinematic, and free of on-screen text overlays.

Goal
----
${tpl.goal}

Pick ONE archetype per generation (let yourself choose, do not always default
to the first):
${archetypeList}
${titleHintLine}${avoidLine}

Hard rules
----------
1. Exactly N image prompts (N is provided by the caller).
2. Each prompt is one visual moment. No on-screen text, captions, or UI overlays.
3. Maintain the SAME protagonist across all N prompts AND the character
   reference image — same age range, same wardrobe family, same key prop.
4. Visual continuity: location/lighting can shift, but the protagonist's
   identity must stay recognizable so chained clips feel like the same person.
5. Cinematic specificity in every prompt: camera angle, lens hint, lighting,
   time of day, mood, one strong physical action. Avoid abstract adjectives.
6. Aspect ratio: ${ratioLine}. Do NOT reference any other ratio.
7. Character style: ${styleLine} Every visual prompt must reaffirm this style.

Story completeness (NON-NEGOTIABLE)
-----------------------------------
The N scenes MUST tell a COMPLETE, SELF-CONTAINED story that fully resolves
within those exact N beats. The video this produces stands alone — there is
no "Part 2", no continuation, no follow-up upload. Treat N as a hard budget
and compress the arc to fit, never as a chapter count for a longer tale.

  - Scene 1 establishes the protagonist, their goal/conflict, and the world.
  - The MIDDLE scene(s) deliver the rising action, complication, and turn.
  - The LAST scene delivers the definitive resolution — the punchline,
    the moral reveal, the hero moment, the horror reveal, or the legendary
    moment. After the last scene, the audience must feel the story is
    over, not paused.

If N is small (2–3), shrink the middle and land the resolution clearly in
the final scene. NEVER end on a cliffhanger, "to be continued", a question,
or a scene that obviously needs another beat to finish. The viewer must
walk away with closure.

Self-check before you output: read the imagePrompts in order, ignore titles,
and ask "if this were the entire video, would it feel like a finished
${opts.niche === "funny" ? "comedic short" : opts.niche === "horror" ? "horror vignette" : opts.niche === "moral" ? "fable with a clear lesson" : opts.niche === "mythological" ? "mythological vignette" : "zero-to-hero arc"}?" If the answer is "no, it stops too early", rewrite scenes so the
LAST scene resolves the arc.

Tone
----
${tpl.toneNotes}

Arc structure (scaled to N=${opts.imageCount})
${"-".repeat(20 + String(opts.imageCount).length)}
${tpl.arcStructure}

For N=${opts.imageCount} specifically, distribute beats like this:
${(() => {
  const n = opts.imageCount;
  if (n <= 2) {
    return "  - Scene 1 = setup + inciting moment fused into one beat (the protagonist's situation AND the trigger).\n  - Scene 2 = the resolution beat — punchline / moral reveal / hero moment / horror reveal. No middle, no fade-out, the ending lands here.";
  }
  if (n === 3) {
    return "  - Scene 1 = setup (introduce protagonist, goal, world).\n  - Scene 2 = escalation / turn (complication or decision).\n  - Scene 3 = resolution (definitive ending — the story is fully told).";
  }
  if (n === 4) {
    return "  - Scene 1 = setup.\n  - Scene 2 = first complication.\n  - Scene 3 = climax / turning point.\n  - Scene 4 = resolution beat that wraps the arc.";
  }
  if (n <= 6) {
    return `  - Scene 1 = setup.\n  - Scenes 2..${n - 2} = rising complications, each escalating the stakes.\n  - Scene ${n - 1} = climax / turning point.\n  - Scene ${n} = resolution beat that wraps the arc.`;
  }
  return `  - Scene 1 = setup; Scenes 2..${Math.floor(n / 3)} = world-building + introduction of conflict; Scenes ${Math.floor(n / 3) + 1}..${n - 2} = rising complications; Scene ${n - 1} = climax; Scene ${n} = resolution. Pace deliberately so each beat is a meaningful step, not filler.`;
})()}

Character reference image
-------------------------
Before the N scene prompts, write ONE additional standalone prompt under the
field "characterPrompt". This produces a clean reference portrait used as an
ingredient when each scene is rendered, keeping the protagonist consistent.

The character prompt MUST:
  - Repeat the protagonist's locked look verbatim (age, ethnicity, hair, wardrobe, key prop)
  - Show a full-body / 3/4 body cinematic portrait, not a tight headshot
  - Use a neutral backdrop that does NOT match any scene environment
  - Specify soft, even lighting, neutral expression, eye-level camera, 50mm lens
  - Reaffirm the character style (${opts.characterStyle})
  - Reaffirm the aspect ratio (${opts.aspectRatio})
  - Be 40-80 words, English

Audio
-----
${audioNote}
${dialogueLanguageNote}

Output format (STRICT JSON, no prose around it)
-----------------------------------------------
${buildOutputSchema(opts)}

The "imagePrompts" array MUST contain exactly N items in narrative order.
The FIRST item is the opening beat. The LAST item (index N-1) is the
RESOLUTION beat — after it, the story is finished. Do NOT generate scenes
that imply more story is coming.

The "logline" must describe the COMPLETE arc end-to-end (setup → resolution),
not just the opening situation. If your logline doesn't describe how the
story ends, the story is not complete; rewrite.

Do NOT include any text outside this JSON object.

---
N = ${opts.imageCount} (this is the entire story — make it complete)
---
Return the JSON object now.`;
}
