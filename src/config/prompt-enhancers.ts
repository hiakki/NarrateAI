export interface PromptEnhancer {
  storytellingRules: string[];
  visualStyleGuide: string[];
  moodKeywords: string;
}

const ENHANCERS: Record<string, Record<string, PromptEnhancer>> = {
  "scary-stories": {
    dramatic: {
      storytellingRules: [
        "Open with an unsettling detail that creates immediate dread — something is WRONG",
        "Use the rule of three: two normal things, then something deeply disturbing",
        "Never fully reveal the horror — let the viewer's imagination fill the gap",
        "Each scene MUST escalate tension — never plateau or repeat the same energy level",
        "End on an unresolved, haunting note — the viewer should feel uneasy even after the video ends",
        "Use sensory language: describe sounds, textures, smells, the feeling of being watched",
        "Include a moment of false safety before the final scare",
      ],
      visualStyleGuide: [
        "HOOK: Extreme close-up of a disturbing detail — an unblinking eye, a hand reaching from darkness, a shadow that shouldn't be there",
        "BUILD: Wide shot showing isolation and emptiness — an abandoned hallway, a dark forest path, an empty room with one chair",
        "ESCALATE: Dutch angle, distorted perspective — something barely visible lurking in the background, a face in the window",
        "TENSION: Close-up of a character's terrified expression, or an object that has moved from its original position",
        "REVEAL: The most visceral image — partial reveal of the horror, silhouette against lightning, reflection showing something behind the viewer",
        "CLIMAX: The final haunting image — an empty space where something just was, an open door that was closed, eyes in the darkness",
      ],
      moodKeywords: "dread, creeping unease, isolation, something watching from the dark, liminal spaces, uncanny valley, suffocating silence, wrongness",
    },
    casual: {
      storytellingRules: [
        "Tell the scary story like sharing it around a campfire — conversational but building tension",
        "Use 'you' to put the viewer IN the story",
        "Include specific details that make it feel real",
        "End with a twist that recontextualizes everything",
      ],
      visualStyleGuide: [
        "HOOK: A normal scene with one unsettling detail",
        "BUILD: Show the environment getting darker or more distorted",
        "CLIMAX: The scary reveal — keep it suggestive, not explicit",
      ],
      moodKeywords: "creepy, unsettling, eerie, campfire horror, that feeling when you're alone at night",
    },
  },
  "mythology": {
    dramatic: {
      storytellingRules: [
        "Open with the scale of the myth — gods, titans, the fabric of reality at stake",
        "Use powerful, almost biblical language — short declarative sentences that hit hard",
        "Build to the central conflict: god vs god, hero vs fate, mortal vs immortal",
        "Include the moment of hubris or sacrifice that defines the myth",
        "End with the eternal consequence — what this myth explains about the world",
      ],
      visualStyleGuide: [
        "HOOK: A godlike figure silhouetted against a cosmic backdrop — storms, fire, celestial bodies",
        "BUILD: Epic wide shots of mythological landscapes — towering mountains, infinite oceans, the underworld",
        "CONFLICT: Dynamic action composition — clash of forces, lightning strikes, weapons raised",
        "SACRIFICE: Intimate close-up showing emotion — a hero's determination, a god's wrath, tears of a titan",
        "CONSEQUENCE: The aftermath — a transformed landscape, a new constellation, an eternal punishment",
      ],
      moodKeywords: "epic grandeur, divine wrath, ancient power, cosmic scale, fate and destiny, immortal tragedy",
    },
    educational: {
      storytellingRules: [
        "Present the myth as a fascinating story first, lesson second",
        "Compare the myth to modern parallels the viewer would recognize",
        "Explain what ancient people were trying to understand with this myth",
      ],
      visualStyleGuide: [
        "HOOK: The most iconic image from the myth",
        "BUILD: Rich detailed scenes showing the mythological world",
        "CLIMAX: The pivotal moment of the myth in dramatic composition",
      ],
      moodKeywords: "ancient wisdom, mythological grandeur, timeless stories, epic landscapes",
    },
  },
  "true-crime": {
    dramatic: {
      storytellingRules: [
        "Open with the most chilling fact about the case — a detail that makes the viewer's blood run cold",
        "Present clues like a detective — each scene reveals a new piece of the puzzle",
        "Use timeline jumps to create suspense: 'But what they didn't know...'",
        "Include the moment everything changed — the break in the case or the darkest revelation",
        "End with what remains unsolved, or the chilling aftermath",
        "Use precise details: dates, locations, exact quotes from witnesses",
      ],
      visualStyleGuide: [
        "HOOK: A crime scene element — police tape, evidence markers, a redacted document, a dark alley",
        "INVESTIGATION: Noir-style shots — detective's desk with files, shadowy interrogation room, surveillance footage aesthetic",
        "EVIDENCE: Close-ups of clues — a photograph, a map with pins, fingerprints, a timeline on a wall",
        "REVELATION: High contrast dramatic lighting — the suspect's silhouette, a shocking document, security camera angle",
        "AFTERMATH: Empty locations where events occurred — an abandoned house, a courtroom, a memorial",
      ],
      moodKeywords: "noir tension, forensic detail, shadowy investigation, cold case atmosphere, unsettling evidence, documentary grit",
    },
  },
  "history": {
    educational: {
      storytellingRules: [
        "Open with a vivid 'you are there' moment — transport the viewer to the historical scene",
        "Use surprising facts that challenge common knowledge",
        "Connect historical events to their modern consequences",
        "Include human details that make historical figures feel real",
        "End with the lasting impact — why this moment still matters today",
      ],
      visualStyleGuide: [
        "HOOK: A dramatic moment frozen in time — the explosion, the speech, the discovery",
        "CONTEXT: Wide establishing shots of the historical setting — the city, the battlefield, the palace",
        "DETAIL: Close-ups of period-accurate elements — documents, artifacts, architecture",
        "TURNING POINT: The pivotal moment with dramatic composition and lighting",
        "LEGACY: Split between past and present — the historical site then and now",
      ],
      moodKeywords: "historical gravitas, documentary realism, cinematic period atmosphere, immersive time travel",
    },
    dramatic: {
      storytellingRules: [
        "Tell history like a thriller — open in medias res at the most intense moment",
        "Use countdown tension: 'They had 24 hours before...'",
        "Humanize the key players — what were they thinking, feeling, risking?",
        "End with the dramatic irony of what came next",
      ],
      visualStyleGuide: [
        "HOOK: The single most dramatic image from this historical moment",
        "BUILD: The calm before the storm — the world before everything changed",
        "ESCALATE: Increasing chaos, scale, and stakes in each scene",
        "CLIMAX: The moment of no return — maximum visual drama",
      ],
      moodKeywords: "historical drama, epic turning points, human cost of history, cinematic grandeur",
    },
  },
  "conspiracy-theories": {
    dramatic: {
      storytellingRules: [
        "Open with the official story, then immediately plant doubt: 'But here's what doesn't add up...'",
        "Present evidence layer by layer — each revelation more unsettling than the last",
        "Use rhetorical questions to make the viewer think: 'Why would they hide this?'",
        "Include the 'smoking gun' — the one detail that's impossible to explain away",
        "End with an open question that keeps the viewer thinking for days",
      ],
      visualStyleGuide: [
        "HOOK: A glitched or distorted version of something familiar — a government building, a famous photo",
        "EVIDENCE: Documents with redacted sections, surveillance-style imagery, connected evidence boards with string",
        "REVELATION: Hidden symbols, aerial views of mysterious locations, split-screen comparisons",
        "SMOKING GUN: The most compelling visual evidence — enhanced, highlighted, impossible to ignore",
        "QUESTION: An unsettling final image that lingers — an empty chair, a closed door, static",
      ],
      moodKeywords: "paranoid tension, hidden truths, surveillance aesthetic, glitch reality, something they don't want you to see",
    },
  },
  "urban-legends": {
    dramatic: {
      storytellingRules: [
        "Start as if telling a friend: 'You know that road on the edge of town? Don't go there after midnight.'",
        "Ground the legend in a specific place and time to make it feel real",
        "Build dread through small, specific details — not jump scares",
        "Include the 'rules' of the legend: what triggers it, how to survive",
        "End with 'and some say...' — leave the legend alive",
      ],
      visualStyleGuide: [
        "HOOK: A familiar place at an unfamiliar time — an empty highway at 3am, a bathroom mirror in moonlight",
        "BUILD: Increasingly unsettling environments — fog rolling in, lights flickering, shadows lengthening",
        "ESCALATE: Something wrong in a normal scene — a figure in the distance, a face in the window",
        "REVEAL: The entity/phenomenon — partially obscured, more terrifying for what you can't see",
        "AFTERMATH: The empty scene after — proving someone was just there, or that nothing was ever there at all",
      ],
      moodKeywords: "suburban dread, familiar places turned threatening, midnight atmosphere, foggy roads, that feeling of being followed",
    },
  },
  "biblical-stories": {
    dramatic: {
      storytellingRules: [
        "Open with the divine stakes — what hangs in the balance between God and man",
        "Use powerful, reverent language that matches the gravity of the story",
        "Build to the moment of faith being tested — the impossible choice",
        "Include the miracle or divine intervention with awe and wonder",
        "End with the covenant, lesson, or transformation that echoes through history",
      ],
      visualStyleGuide: [
        "HOOK: A single powerful image — parting waters, a burning bush, a giant's shadow",
        "BUILD: Renaissance-style compositions showing the human struggle — prayer, doubt, journey",
        "DIVINE: Beams of light from above, angelic presences, supernatural phenomena with golden tones",
        "TRIAL: The darkest moment — the flood, the desert, the cross — painted with dramatic chiaroscuro",
        "GLORY: The triumphant resolution — light breaking through darkness, salvation, promise fulfilled",
      ],
      moodKeywords: "divine awe, sacred grandeur, Renaissance masterpiece, heavenly light against earthly darkness, faith tested and proven",
    },
  },
  "heists": {
    dramatic: {
      storytellingRules: [
        "Open with what was stolen — the impossible target, the astronomical value",
        "Introduce the crew or mastermind with respect: 'They weren't ordinary criminals...'",
        "Walk through the plan step by step — make the viewer feel like an accomplice",
        "Include the moment it almost went wrong — the twist, the close call",
        "End with the aftermath: caught or vanished? Where is the loot today?",
      ],
      visualStyleGuide: [
        "HOOK: The prize — diamonds, gold bars, a vault door, cash stacks — lit dramatically",
        "PLAN: Blueprint-style layouts, surveillance angles, team silhouettes, equipment close-ups",
        "EXECUTION: Split-second action — gloved hands on keypads, laser grids, ticking clocks",
        "TENSION: The moment of near-failure — alarms, spotlights, a guard turning the corner",
        "AFTERMATH: Empty vault, newspaper headlines, mugshots or question marks for unsolved cases",
      ],
      moodKeywords: "heist thriller, Ocean's Eleven tension, blueprint precision, adrenaline, the perfect crime",
    },
  },
  "anime-recaps": {
    casual: {
      storytellingRules: [
        "Open with the most jaw-dropping moment: 'This character just broke the internet...'",
        "Use anime community language: 'power scaling', 'plot armor', 'peak fiction'",
        "Build hype with each scene — escalating power reveals or plot twists",
        "Include the emotional gut-punch moment that defines the arc",
        "End with a hype cliffhanger: 'But wait until you see what happens next...'",
      ],
      visualStyleGuide: [
        "HOOK: The most iconic frame from the anime moment — a power-up, a reveal, a shocked face",
        "BUILD: Dynamic action poses, speed lines, energy effects, dramatic character entrances",
        "ESCALATE: Power scaling visuals — transformations, clashing attacks, shattered environments",
        "EMOTION: The quiet moment — a character's determined face, tears, a farewell",
        "PEAK: The ultimate attack, transformation, or reveal in maximum visual spectacle",
      ],
      moodKeywords: "anime hype, shonen energy, peak fiction vibes, jaw-dropping action, emotional devastation",
    },
  },
  "motivation": {
    dramatic: {
      storytellingRules: [
        "Open at rock bottom — the darkest moment that would make anyone give up",
        "Use 'they said it was impossible' to establish the odds",
        "Show the grind: the 4am mornings, the failures, the rejection letters",
        "Build to the breakthrough moment — when everything changed",
        "End with the transformation and a direct challenge to the viewer: 'What's your excuse?'",
      ],
      visualStyleGuide: [
        "HOOK: The contrast — before and after, poverty and success, failure and triumph",
        "STRUGGLE: Raw, gritty imagery — rain-soaked streets, empty wallets, closed doors",
        "GRIND: Training montage energy — sweat, determination, sunrise workouts, late-night studying",
        "BREAKTHROUGH: Golden hour lighting, the first win — a handshake, an acceptance letter, a finish line",
        "TRIUMPH: The peak — standing on top, the audience, the achievement — bathed in warm light",
      ],
      moodKeywords: "underdog triumph, against all odds, raw determination, from nothing to everything, cinematic inspiration",
    },
  },
  "science-facts": {
    educational: {
      storytellingRules: [
        "Open with the most mind-blowing fact that makes the viewer say 'wait, WHAT?'",
        "Explain complex science through vivid analogies the viewer already understands",
        "Build curiosity with each scene — each fact more incredible than the last",
        "Include the 'so what?' — why this matters for the viewer's life",
        "End with the biggest unanswered question in this field",
      ],
      visualStyleGuide: [
        "HOOK: A stunning visualization of the concept — a galaxy, a cell dividing, a black hole",
        "EXPLAIN: Detailed scientific imagery — molecular structures, cross-sections, scale comparisons",
        "SCALE: Show impossible scales — zoom from atoms to galaxies, time-lapses of millions of years",
        "IMPACT: The real-world application — technology, medicine, the viewer's daily life",
        "MYSTERY: The frontier of knowledge — artistic visualization of what we don't yet understand",
      ],
      moodKeywords: "cosmic wonder, scientific awe, microscopic detail, the beauty of the universe, mind-expanding",
    },
  },
  "life-hacks": {
    casual: {
      storytellingRules: [
        "Open with the problem everyone has but nobody talks about",
        "Present each hack as a revelation: 'Here's what nobody tells you...'",
        "Make each hack immediately actionable — the viewer should want to try it NOW",
        "Include the 'pro tip' that takes it to the next level",
        "End with the most valuable hack saved for last — reward viewers who watch to the end",
      ],
      visualStyleGuide: [
        "HOOK: The frustrating problem visualized — cluttered space, wasted money, wasted time",
        "SOLUTION: Clean, bright before/after comparisons — the hack in action",
        "DETAIL: Close-up of the technique — hands demonstrating, step-by-step visual",
        "RESULT: The satisfying outcome — organized, saved, optimized — bright and clean",
      ],
      moodKeywords: "bright, clean, satisfying, before-and-after transformation, clever simplicity",
    },
  },
};

const DEFAULT_ENHANCER: PromptEnhancer = {
  storytellingRules: [
    "Open with a hook that creates immediate curiosity or emotion",
    "Each scene must advance the story — no filler or repetition",
    "Use specific details instead of vague generalities",
    "Build to a climax or revelation in the second half",
    "End with something memorable — a twist, a question, or a powerful statement",
  ],
  visualStyleGuide: [
    "HOOK: The most visually striking image that captures the theme",
    "BUILD: Establish the world and context with detailed environments",
    "ESCALATE: Increase visual intensity — closer shots, more dramatic lighting",
    "CLIMAX: The most impactful visual moment with maximum composition drama",
  ],
  moodKeywords: "engaging, cinematic, visually rich, emotionally resonant",
};

export function getPromptEnhancer(niche: string, tone: string): PromptEnhancer {
  return ENHANCERS[niche]?.[tone] ?? ENHANCERS[niche]?.dramatic ?? ENHANCERS[niche]?.casual ?? DEFAULT_ENHANCER;
}
