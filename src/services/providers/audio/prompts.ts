/**
 * Prompt engineering for AI-generated BGM and SFX.
 * Maps tone/niche to MusicGen prompts and extracts SFX cues from scene descriptions.
 */

// ─── BGM prompt templates ────────────────────────────────────────

const NICHE_BGM_HINTS: Record<string, string> = {
  "scary-stories": "dark suspenseful horror, eerie pads, low drones, tension strings",
  "true-crime": "tense investigative atmosphere, dark piano, suspenseful strings",
  "conspiracy-theories": "mysterious electronic, uneasy atmosphere, deep pulsing bass",
  "dark-psychology": "unsettling ambient, dissonant tones, minimal and haunting",
  "survival": "intense survival tension, urgent percussion, primal energy",
  mythology: "epic ancient orchestral, chanting voices, grand and mythical",
  "religious-epics": "sacred orchestral, choir, reverent and powerful",
  history: "documentary orchestral, warm strings, nostalgic woodwinds",
  motivation: "uplifting cinematic, powerful drums, soaring strings, triumphant",
  "space-cosmos": "ethereal space ambient, deep synth pads, cosmic reverb, celestial",
  "anime-recaps": "energetic j-pop inspired instrumental, fast synths, anime action",
  "life-hacks": "cheerful upbeat pop, bright acoustic guitar, positive vibes",
  "science-facts": "curious ambient electronic, gentle pulse, wonder and discovery",
  "what-if": "mysterious thoughtful ambient, ethereal synths, contemplative",
  "animal-kingdom": "nature documentary, warm organic instruments, gentle wonder",
  "money-wealth": "confident corporate cinematic, bold brass, success energy",
  "funny-stories": "playful quirky comedy, bouncy bass, lighthearted woodwinds",
  "zero-to-hero": "inspiring build-up orchestral, triumph, emotional crescendo",
  "character-storytelling": "cinematic emotional, piano and strings, story arc",
  satisfying: "calm lofi chill, gentle beats, relaxing minimalist",
};

const TONE_BGM_BASE: Record<string, string> = {
  dramatic: "dramatic cinematic orchestral background music, emotional and powerful",
  casual: "light casual background music, easy listening, relaxed mood",
  funny: "playful comedic background music, quirky and bouncy, fun energy",
  educational: "calm ambient background music, soft and thoughtful, gentle rhythm",
};

export function buildBGMPrompt(tone: string, niche: string): string {
  const base = TONE_BGM_BASE[tone] ?? TONE_BGM_BASE.dramatic;
  const nicheHint = NICHE_BGM_HINTS[niche] ?? "";
  const parts = [base];
  if (nicheHint) parts.push(nicheHint);
  parts.push("instrumental only, no vocals, background music for short video");
  return parts.join(", ");
}

// ─── SFX prompt extraction ───────────────────────────────────────

const SFX_KEYWORDS: [RegExp, string][] = [
  // Satisfying / ASMR
  [/\b(cut|cutting|slice|slicing|carv)\b/i, "knife cutting through soft material, satisfying slice ASMR"],
  [/\b(sand|kinetic)\b/i, "kinetic sand crunching and crumbling ASMR"],
  [/\b(drip|drop|dripping|dropping)\b/i, "liquid dripping slowly, satisfying drip sound"],
  [/\b(pour|pouring|flow)\b/i, "thick liquid pouring smoothly, satisfying pour"],
  [/\b(squish|squeeze|press|mold)\b/i, "soft material squishing under pressure ASMR"],
  [/\b(crunch|crunching|crisp)\b/i, "satisfying crunch sound, crispy material breaking"],
  [/\b(marble|ball|roll)\b/i, "marble rolling on smooth track, clinking and rolling sounds"],
  [/\b(mix|stir|swirl)\b/i, "slow stirring thick liquid, creamy swirl sounds"],
  [/\b(peel|peeling|unwrap)\b/i, "peeling tape or wrapping off surface, satisfying peel"],
  [/\b(soap|foam|lather|bubble)\b/i, "soap lather foam bubbles, soft fizzing ASMR"],
  [/\b(honey|syrup|caramel|glaze)\b/i, "thick honey drizzling slowly, viscous liquid ASMR"],
  [/\b(tap|tapping|click)\b/i, "rhythmic tapping sound on hard surface"],

  // Nature / Weather
  [/\b(explosion|explod|blast|bomb)\b/i, "explosion blast boom"],
  [/\b(thunder|lightning|storm)\b/i, "thunder rumble crack"],
  [/\b(rain|raining|downpour)\b/i, "rain falling on surface"],
  [/\b(wind|breeze|gust|windy)\b/i, "wind blowing howling"],
  [/\b(fire|flame|burning|inferno)\b/i, "crackling fire flames"],
  [/\b(ocean|sea|waves?|shore)\b/i, "ocean waves crashing on shore"],
  [/\b(forest|trees?|jungle|woods)\b/i, "forest ambient birds rustling leaves"],
  [/\b(water|river|stream|waterfall)\b/i, "flowing water stream"],
  [/\b(snow|ice|frozen|cold|winter)\b/i, "icy wind frozen ambient"],
  [/\b(desert|arid)\b/i, "desert wind sand blowing"],

  // Urban / Mechanical
  [/\b(city|street|urban|traffic)\b/i, "city ambient traffic distant horns"],
  [/\b(car|vehicle|driv)\b/i, "car engine driving past"],
  [/\b(robot|machine|mechanical|cyber)\b/i, "mechanical robotic servo whirr"],
  [/\b(alarm|siren|warning)\b/i, "alarm siren blaring"],
  [/\b(door|gate|entrance)\b/i, "heavy door creaking open"],
  [/\b(clock|time|tick)\b/i, "clock ticking"],

  // Human / Dramatic
  [/\b(crowd|people|audience|cheering)\b/i, "crowd murmur ambient"],
  [/\b(footstep|walk|running|sprint)\b/i, "footsteps walking"],
  [/\b(heartbeat|heart|pulse)\b/i, "heartbeat thumping"],
  [/\b(whisper|murmur|secret)\b/i, "eerie whisper ambient"],
  [/\b(scream|shout|cry)\b/i, "distant scream echo"],

  // Atmospheric
  [/\b(space|galaxy|nebula|cosmos|stars?|orbit)\b/i, "deep space ambient low frequency hum"],
  [/\b(war|battle|fight|sword|combat|weapon)\b/i, "battle clash metal swords"],
  [/\b(fly|flying|soar|wing)\b/i, "whooshing air swoosh"],
  [/\b(cave|underground|tunnel|deep)\b/i, "cave dripping echo ambient"],
  [/\b(night|dark|shadow|midnight)\b/i, "crickets night ambient"],
  [/\b(magic|spell|mystical|supernatural)\b/i, "magical shimmer sparkle whoosh"],
  [/\b(book|page|scroll|ancient)\b/i, "page turning paper rustling"],
];

const TONE_SFX_BED: Record<string, string> = {
  dramatic: "cinematic low rumble tension riser",
  casual: "soft ambient room tone",
  funny: "cartoon boing comedy accent",
  educational: "gentle transition whoosh",
};

export function buildSFXPrompt(visualDescription: string, tone?: string): string {
  const matches: string[] = [];
  for (const [re, sfx] of SFX_KEYWORDS) {
    if (re.test(visualDescription)) {
      matches.push(sfx);
    }
  }

  if (matches.length === 0) {
    const bed = TONE_SFX_BED[tone ?? "dramatic"] ?? TONE_SFX_BED.dramatic;
    return `${bed}, ambient background atmosphere`;
  }

  const unique = [...new Set(matches)].slice(0, 3);
  return unique.join(", ");
}
