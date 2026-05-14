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
  /**
   * Loose archetype labels Gemini has used recently (within the same niche).
   * The prompt asks Gemini to pick a clearly different protagonist + premise.
   * Optional — when omitted no avoid-line is rendered.
   */
  avoidArchetypes?: string[];
  /**
   * Coarse protagonist categories (e.g. "uncle", "auntie", "schoolKid",
   * "groom", "delivery_boy", "monkey") detected from prior runs. The prompt
   * imposes a HARD ban on these categories — Gemini must pick from a
   * clearly different category. This is the strongest variety lever.
   */
  bannedCategories?: string[];
  storyTitleHint?: string;
}

/**
 * Loose archetype-category classifier. Maps a protagonist description
 * (typically Gemini's `protagonist` field, ~1 sentence) to a coarse category
 * label. Used to enforce category-level variety across consecutive
 * generations. Returns `null` when nothing recognisable is detected.
 */
export function classifyProtagonist(text: string): string | null {
  const s = (text || "").toLowerCase();
  if (!s.trim()) return null;
  // Order matters — more specific / female-coded tests first so a phrase
  // like "middle-aged Indian woman" doesn't get caught by the uncle regex.
  if (/\b(grandmother|grandma|dadi|nani|elderly\s+woman|old\s+woman)\b/.test(s)) return "grandmother";
  if (/\b(grandfather|grandpa|dadu|nana|elderly\s+man|old\s+man)\b/.test(s)) return "grandfather";
  if (/\b(aunt|aunty|auntie|amma|chachi|tai|middle[-\s]?aged\s+(woman|lady|indian\s+woman|indian\s+lady))\b/.test(s)) return "auntie";
  if (/\b(uncle|chacha|tau|baba\s+ji|salt[-\s]?and[-\s]?pepper|middle[-\s]?aged\s+(man|indian\s+man|gentleman))\b/.test(s)) return "uncle";
  if (/\b(school\s*kid|schoolboy|schoolgirl|student|young\s+(boy|girl)|child|preteen)\b/.test(s)) return "schoolKid";
  if (/\b(teenager|teen\s|college\s+(kid|student|boy|girl))\b/.test(s)) return "teen";
  if (/\b(bride|dulhan|mehendi|bridal)\b/.test(s)) return "bride";
  if (/\b(groom|dulha|sherwani|baraat)\b/.test(s)) return "groom";
  if (/\b(delivery\s+(boy|guy|man)|courier|swiggy|zomato|dunzo)\b/.test(s)) return "deliveryBoy";
  if (/\b(auto[\s-]?(driver|rickshaw)|rickshaw|auto\s+wallah)\b/.test(s)) return "autoDriver";
  if (/\b(watchman|chowkidar|security\s+guard)\b/.test(s)) return "watchman";
  if (/\b(office\s+worker|employee|clerk|babu|cubicle)\b/.test(s)) return "officeWorker";
  if (/\b(rwa\s+secretary|society\s+secretary|housing[-\s]?society)\b/.test(s)) return "rwaSecretary";
  if (/\b(yoga\s+(teacher|instructor|guru))\b/.test(s)) return "yogaTeacher";
  if (/\b(dj|sangeet|wedding\s+dj)\b/.test(s)) return "dj";
  if (/\b(chef|cook|halwai|dhaba)\b/.test(s)) return "chef";
  if (/\b(monkey|bandar|langur|chimp)\b/.test(s)) return "monkey";
  if (/\b(stray\s+dog|dog|kutta|puppy|doggie)\b/.test(s)) return "dog";
  if (/\b(cat|kitten|tomcat|billi)\b/.test(s)) return "cat";
  if (/\b(bear|bhaalu|panda)\b/.test(s)) return "bear";
  if (/\b(pigeon|kabootar|dove)\b/.test(s)) return "pigeon";
  if (/\b(parrot|tota|mynah|crow|kauwa)\b/.test(s)) return "parrot";
  if (/\b(cow|gaay|bull|calf|buffalo|bhains)\b/.test(s)) return "cow";
  if (/\b(donkey|gadha|mule|horse|ghoda)\b/.test(s)) return "donkey";
  if (/\b(elephant|haathi|tusker)\b/.test(s)) return "elephant";
  if (/\b(squirrel|gilehri)\b/.test(s)) return "squirrel";
  if (/\b(peacock|mor|peahen)\b/.test(s)) return "peacock";
  if (/\b(turtle|tortoise|kachua)\b/.test(s)) return "turtle";
  if (/\b(goat|bakri|sheep|lamb)\b/.test(s)) return "goat";
  if (/\b(rabbit|bunny|khargosh)\b/.test(s)) return "rabbit";
  if (/\b(lizard|chipkali|gecko|frog|mendak|snake|saanp)\b/.test(s)) return "reptile";
  if (/\b(cricket(er)?|gully\s+cricket|batsman|bowler)\b/.test(s)) return "cricketer";
  if (/\b(principal|teacher|professor|master[-\s]?ji)\b/.test(s)) return "teacher";
  if (/\b(groom|young\s+(man|husband))\b/.test(s)) return "youngMan";
  if (/\b(young\s+(woman|wife|lady))\b/.test(s)) return "youngWoman";
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Per-niche templates
// ──────────────────────────────────────────────────────────────────────────────

interface NicheTemplate {
  goal: string;
  archetypes: string[];
  arcStructure: string;
  toneNotes: string;
  /**
   * Optional extra block injected verbatim after the niche's `toneNotes`.
   * Use it for niche-specific craft rules that we want Gemini to honor
   * literally (e.g. comedy escalation patterns, dramatic-stakes prescriptions).
   */
  craftBoosters?: string;
}

const NICHE_TEMPLATES: Record<FlowNiche, NicheTemplate> = {
  "zero-to-hero": {
    goal:
      "Tell ONE concrete zero-to-hero arc where SOCIETY actively pushes back on the hero. The conflict is interpersonal — antagonist characters (rival, boss, in-laws, neighbour, judge, classroom bully, society aunty, training mate) try to demean, doubt, or block the hero. The hero's victory is not a solo moment; it lands BECAUSE the doubters witness it and have to swallow their words.",
    archetypes: [
      "underdog athlete vs. mocking teammates and a sceptical coach",
      "broke founder vs. dismissive investor + know-it-all uncle who calls the venture stupid",
      "overlooked clerk vs. bossy manager and gossipy colleagues",
      "village girl chasing higher education vs. her own panchayat / society",
      "small-town singer vs. cousins who say singing is not a 'real' career",
      "young entrepreneur vs. classmate who ridiculed her plan in school",
      "homeless artist vs. art-gallery curator who waved him off, plus best friend who believed",
      "struggling student vs. classroom bully + strict teacher",
      "rescued shelter dog + trainer vs. the show judge who said the dog 'won't ever compete'",
      "washed-up boxer vs. former trainer who walked out on him",
    ],
    arcStructure:
      "Three phases driven by SOCIAL pressure: (1) rock-bottom — antagonist demeans the hero on-screen, hero swallows it; (2) turning point — hero makes the quiet decision to prove them wrong, often with one supportive ally (best friend, mentor, mother, dog); (3) hero moment — hero triumphs IN FRONT OF the antagonist, who reacts (jaw drop, slow clap, shame). LAST scene must always include the antagonist's reaction shot so the vindication is felt.",
    toneNotes:
      "Grounded, emotional, motivational. Avoid clichéd hero shots — favour intimate, specific moments. Antagonist isn't cartoonish; they're a believable doubter (auntie at a wedding, a school principal, a senior colleague). The supportive ally can ground the hero in a single warm beat.",
    craftBoosters:
      "Relationship engine:\n  - At least 1 antagonist (the one who demeans) and 1 supporter (the one who believes) MUST appear in supportingCast. Add a second antagonist for chorus effect (peers, neighbours) when imageCount >= 4.\n  - Dialogue rule: scene 1 carries the demeaning line verbatim — the antagonist says something cutting that the audience remembers in scene N. Scene N closes with the antagonist's reaction (could be a single word, a stunned silence beat, a clap).\n  - Show the supporter at least once in the middle (a hand on the shoulder, a 'tu kar lega', a packed tiffin slipped to the hero).\n  - End on the hero's calm pride + the doubter's reaction in the SAME frame.",
  },
  funny: {
    goal:
      "Write ONE BandarApnaDost-grade Hindi comedy short driven by a RELATIONSHIP — pati-patni nok-jhok, dadi vs. pota's gadgets, two-friend bickering, boss vs. his own peon, mother and her naughty kid, in-laws meeting, two-shop-rivalry, elephant-and-ant style mismatched-duo physical comedy. The CHANNEL'S SIGNATURE is anthropomorphic animal protagonists — funky monkey, cool bear, sneaky stray dog, mischievous langur, dramatic pigeon, philosophical cow — interacting with another character (animal hybrid OR plain human OR object-as-character) and getting into a hilarious back-and-forth. Tiny, everyday desi conflict treated like a full-blown action movie. Big drama, bigger reactions. The MAIN character suffers magnificently and the OTHER character either teases / panics / scolds / cheers them on. The pair lands the punchline together — sometimes with a final wordless reaction shared between them. Solo soliloquy is forbidden when the niche is funny: there must always be a SECOND speaking presence in at least 80% of the scenes.",
    archetypes: [
      // ── ANTHRO HUMAN-ANIMAL HYBRIDS (PREFERRED — pick from this top half ~80% of the time) ──
      // Each is a HUMAN BODY with an ANIMAL HEAD + animal fur/feathers/skin, in
      // desi wardrobe (gamcha, kaala chashma, kurta, lungi, monkey cap, etc.).
      "funky monkey-headed dada — human body, monkey face, kaala chashma, white baniyan + lungi, gamcha on shoulder — runs a banana side-hustle near a chai stall",
      "cool bear-headed bouncer — human body, bear face, aviator goggles, kurta-pyjama, gold chain — wanders into a wedding and gets mistaken for the DJ",
      "sneaky stray-dog-headed thela boy — human body, mongrel face, vest + rolled jeans, tied gamcha bandana — has memorised every chef's blind-spot at a roadside dhaba",
      "dramatic pigeon-headed yoga aunty pair — human bodies, pigeon faces, salwar-kameez, dupattas — running a rooftop yoga class that explodes when a kite arrives",
      "philosophical cow-headed pandit — human body, cow face, dhoti + rudraksha mala — keeps interrupting a yoga teacher's asanas with judgemental head-tilts",
      "mischievous langur-headed traveller — human body, langur face, hoodie + cargo shorts, GoPro on a chest harness — steals a tourist's camera and shoots a better vlog",
      "rascal squirrel-headed flower girl — human body, squirrel face, lehenga + flower veni — decides a bridal mehendi tray is HER personal nut buffet",
      "indignant peacock-headed colony auntie — human body, peacock face, sequinned saree, sandalwood fan — turns a colony power cut into a one-being talent show",
      "lazy tomcat-headed tiffin-walla — human body, tomcat face, bow-tie + half-shirt — tries to deliver one tiffin and ends up in a kitchen chase",
      "young donkey-headed school admit — human body, donkey face, school uniform, oversized backpack — gets enrolled in assembly line and refuses to leave",
      "anxious turtle-headed devotee — human body, turtle face, white kurta, prayer cloth — running late for temple aarti while the mohalla cheers her on",
      "smug parrot-headed peon — human body, parrot face, peon's khaki, hand-fan — keeps mimicking the school principal's announcements on the PA",
      "tiny puppy-headed apprentice — human body, puppy face, halwai's white apron + monkey cap — accidentally cordons off the laddoos from paying customers",
      "fashionable elephant-headed nephew — human body, elephant face, sherwani + giant turban — tries on the bride's tiara at a sangeet and brings the stage down",
      "neighbourhood goat-headed self-appointed guard — human body, goat face, security uniform + whistle — runs the RWA's unofficial security desk",
      // ── plain humans (rare — only when the comedy specifically needs one) ──
      "school kid attempting one slick lunch-break maggi heist that snowballs into chaos",
      "young bride managing a chaotic mehendi function while her phone keeps dying",
      "courier delivery boy whose package starts barking, glowing, and ringing all at once",
      "DJ at a sangeet whose laptop battery, speaker cable, and a runaway toddler combine to derail the night",
      "RWA secretary trying to chair a meeting while a pigeon, a leaking tap, and a generator alarm all stage a coup",
      "auto driver whose meter, GPS, and customer all start a three-way argument",
      "groom whose sherwani, sehra, and mother-in-law conspire on his baraat day",
      "watchman who installs a 'smart' colony gate that locks every legitimate resident out",
    ],
    arcStructure:
      "Opening = the duo / trio is introduced and the tiny stake is established (they WILL get the samosa / make the kite fly / fix the geyser / nail the mehendi / win the aarti competition). Their RELATIONSHIP is locked in immediately via a short back-and-forth (e.g. wife rolls eyes at husband, dadi swats pota's phone, friend mocks friend's haircut). Middle = the universe pushes back AND the partner reacts — every escalation involves both characters: one creates chaos, the other panics / scolds / encourages / mocks them. Each subsequent middle scene MUST double the chaos AND the partner's reaction intensity. Final = the punchline — a shared beat where the duo either embraces defeat together (matching defeated faces, one apologetic shrug from the main char and a long stare from the partner), OR the supporting character delivers a one-line zinger that closes the loop on the joke. Land the laugh on a TWO-SHOT held beat, not a soliloquy.",
    toneNotes:
      "BandarApnaDost-grade physical comedy with anthropomorphic-animal whimsy. Operatic, melodramatic reactions to tiny problems — a missed bus elicits the same panic as missing a flight, a single drop of curd on a kurta triggers a slow-motion 'NOOOO'. Slapstick MUST feel safe (no real harm, no blood, no humiliation that punches down). The duo are the butt of the joke but never mean-spirited — we laugh WITH them. Wholesome desi heart underneath the chaos.",
    craftBoosters:
      "Drama dial — turn it to 11:\n  - Two-handler default: design every funny short as a DUO act. Pin the dynamic in supportingCast (e.g. \"wife: long-suffering, deadpan one-liners\", \"dadi: traditionalist, hits with chappal threats\", \"best friend: enabler who makes things worse\", \"naughty kid: chaos engine\").\n  - Big takes: every reaction is a full-body, eyes-wide, mouth-open take. Think Mr. Bean by way of a Bollywood mass-hero entry.\n  - Pin a SIGNATURE physical gesture to the MAIN protagonist (paw-on-forehead smack, dramatic tail flick, sunglasses slide, palms-on-cheeks shock, theatrical mic-drop, anguished sky-look) and reuse it across scenes — DIFFERENT signature for different protagonists. Pin a CONTRASTING gesture to the partner (deadpan blink, slow head shake, hand on hip, threatened chappal).\n  - Each escalation scene MUST add at least one new chaotic element to the frame: an extra prop flying, a witness reacting, a pet, a rival, a falling object — never just 'more of the same'.\n  - Bystander reactions: at least one neighbour / auntie / kid / dog / pigeon / watchman / security guard / kirana wallah / fellow animals visibly reacts in the middle scenes — gasps, slow clap, peeking from behind a wall, paw over mouth. They can become a one-line bystander voice in dialogues.\n  - Heightened physics: the world is slightly cartoon-elastic — pressure cookers shoot dal six feet up, monkeys backflip off scooters, kites curl into perfect knots, gel fur holds impossible shapes. Lean into it.\n  - Specific desi texture: real settings (chai stall, pan shop, autorickshaw stand, RWA notice board, kirana shop, school corridor, sangeet stage, terrace, balcony grill, Hero Splendor scooter, Maruti 800, banyan-tree square), real props (steel tiffin, ghadi, kurta, dupatta, lota, mehendi cone, dhoop, laptop on tripod, mic stand, JBL speaker, paper plates, banana bunches).\n  - Dialogue rule: at least 60% of scenes carry a back-and-forth — main char says A, partner replies with B (often a deadpan callback). The exchange should feel like a real domestic / friendly fight, not a script reading. Two-three liners per scene is plenty.\n  - Punchline beat: hold on a TWO-SHOT — main char's defeated face beside the partner's reaction. Optional final visual button: bystander silent reaction.\n  - Logline rule: the logline MUST mention BOTH characters and the absurd middle complication AND the goofy resolution, not just the setup.\n\nRelationship templates (pick one and lock the duo in supportingCast):\n  - Pati-patni nok-jhok — the husband (main) attempts a 'simple' fix and the wife (partner) catches every disaster mid-flight with a deadpan one-liner.\n  - Dadi-pota gen-gap — the grandkid (main) tries to use a smart gadget; dadi (partner) waves chappal at the AI / TV / phone.\n  - Two-friend bickering — best friend (main) tries to look cool at a sangeet / wedding / college fest; the other friend (partner) sabotages by accident, then by purpose.\n  - Mom and naughty kid — mother (partner) is trying to feed / bathe / dress the kid (main); kid weaponises every household object.\n  - Boss vs. peon — peon (main) tries to do one task right; boss (partner) ruins it with stupid instructions.\n  - In-laws meeting — son-in-law (main) tries to impress the saas / sasur (partner) and accidentally implodes the dinner.\n  - Mismatched-duo (elephant-and-ant style) — a tiny anthro creature (ant-headed clerk, mouse-headed apprentice) attempts a job sized for a giant anthro creature (elephant-headed boss, bear-headed bouncer). Comedy from the size mismatch.\n\nProtagonist variety (NON-NEGOTIABLE):\n  - DEFAULT the MAIN character to an ANTHRO HUMAN-ANIMAL HYBRID — that's BandarApnaDost's signature. The character has a HUMAN body (human hands, fingers, legs, upright bipedal posture) but an ANIMAL head with photoreal animal fur/feathers/skin. Roll dice across the hybrids at the top of the archetype list FIRST.\n  - The supporting partner can EITHER be another anthro hybrid (a different species — pigeon paired with cow, monkey with goat) OR a plain human (especially for husband-wife / mom-kid / dadi-pota templates). Either is fine. Do NOT mirror the main char's species.\n  - When in doubt: pick a desi anthro hybrid as the main — monkey-headed dada, bear-headed bouncer, dog-headed thela boy, pigeon-headed aunty, cow-headed pandit, langur-headed traveller, squirrel-headed flower girl, peacock-headed auntie, tomcat-headed tiffin-walla, donkey-headed school kid, parrot-headed peon, etc.\n  - The hybrid wears photoreal everyday desi clothes: kaala chashma (black sunglasses), aviator goggles, gamcha or angocha on shoulder, white kurta or baniyan, lungi or rolled-up jeans, leather chappals, monkey cap in winter, gold chain, digital wristwatch, paan masala packet behind ear, transistor radio, handloom shoulder bag.\n  - The hybrid walks on TWO LEGS, uses HUMAN HANDS to hold things (chai cup, samosa, mobile phone, bicycle handle), sits on chairs, drives a scooter — but the head, fur/feathers/skin texture, ears, tail (if any) are 100% animal. NEVER quadrupedal. NEVER human-headed.\n  - Across consecutive generations the protagonist MUST rotate species: if the last story used a monkey-hybrid, this one cannot. Rotate to bear / dog / pigeon / cow / parrot / cat / squirrel / elephant / goat / etc.\n  - HARD STOP: do NOT keep producing 'middle-aged Indian uncle' or 'middle-aged Indian woman' plain-human protagonists. Default to the anthro hybrid. Plain humans are the EXCEPTION, not the rule.",
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
  hyperreal_3d:
    "Hyperrealistic 3D-CG anthropomorphic character (BandarApnaDost-grade VFX). " +
    "**ANATOMY (non-negotiable):** the protagonist is a HUMAN-ANIMAL HYBRID — a HUMAN body with HUMAN hands (5 articulated fingers, opposable thumb, human nail-beds) and HUMAN legs (upright bipedal posture, human knees/ankles, normal-length human shins). " +
    "The HEAD is an animal head (e.g. monkey, bear, dog, cow, parrot, peacock — depending on the chosen archetype) with photoreal animal facial features and animal eyes. " +
    "The whole body is covered in the chosen animal's natural skin / fur / feathers / scales — visible individual fur strands or feather barbs, subsurface scattering, realistic shedding patterns, ear shape and tail (if the species has one) preserved in human-body proportions. " +
    "Think 'man wearing a hyperreal animal head and animal-fur skin', NOT a four-legged cartoon animal. Walks on two legs, picks up props with human hands, sits on chairs, holds phones, drinks chai — all with human dexterity. " +
    "**WARDROBE (desi everyday — pick 1-3 per scene):** kaala chashma (black sunglasses) or aviator goggles, gamcha or angocha (cotton towel/scarf draped over shoulder), white or coloured kurta, plain baniyan, lungi or dhoti or rolled-up jeans, leather chappals or worn sneakers, monkey cap in winter, pagdi or printed bandana, gold chain, digital wristwatch, handloom shoulder bag, transistor radio, paan masala packet tucked behind ear. Wardrobe is photoreal cotton/wool/leather — visible weave, fibre detail, dust, sweat marks. " +
    "**RENDER QUALITY:** cinematic VFX — fur with strand-level detail and grooming, accurate cloth simulation with fibre weight and folds, photoreal eyes with wet caustics + catchlights + realistic iris/pupil dilation, naturalistic skin/fur shading. " +
    "**LIGHTING:** golden-hour sun, dappled banyan-tree shadows, warm tungsten interiors, key + rim + fill, realistic shadow falloff and bounced light. " +
    "**CAMERA:** 50–85mm cinematic lens, shallow DoF with creamy bokeh, photoreal motion blur, gentle handheld micro-movement, Hollywood VFX colour grading (rich shadows, healthy mid-tones, controlled highlights). " +
    "**HARD NEGATIVES:** no full-quadruped animals, no Pixar plastic-shaded look, no flat 2D, no anime line-work, no live-action human heads (animal head is mandatory), no animal paws on a human body (hands must be HUMAN, not paws). The vibe is 'BandarApnaDost monkey character' — anthro hybrid with hyperreal fur and human dexterity.",
  photoreal:
    "Photoreal live-action cinematic character — natural human/animal anatomy, real skin tones, realistic clothing materials, grounded naturalistic lighting (golden hour / overcast / interior tungsten), shallow DoF, 35–85mm cinema lens look. NOT cartoon, NOT illustrated, NOT stylized.",
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
  const langLabel = opts.language === "hindi" ? "Devanagari (हिन्दी)" : "English";
  const dialogueDoc = opts.dialogue
    ? `,
      "dialogues": [
        {
          "speaker": "main",   // EITHER "main" (the protagonist) OR a supportingCast.role string OR a free-form one-off label like "auntie passing by".
          "lineHi": "${opts.language === "hindi" ? "EXACT Devanagari (हिन्दी) line, 4-12 words, natural conversational tone." : "EXACT English line, 4-12 words, natural conversational tone."}",
          "lineRoman": "${opts.language === "hindi" ? "Latin-script transliteration of lineHi. Same meaning. 4-12 words." : "Same as lineHi (so downstream code is uniform)."}"
        }
        // 1 to 4 lines per scene. PREFER multi-speaker conversations when supportingCast exists — alternate speakers like a real exchange. Single-speaker monologue only when nobody else is present.
      ]`
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
  "logline": "1 sentence describing the full arc in plain language (must include resolution, not just setup)",
  "protagonist": "1 sentence locking in the MAIN character's look + key prop. ONE consistent character across all scenes.",
  "characterPrompt": "40-80 word cinematic portrait prompt for the MAIN character's reference image. Starts with the protagonist description verbatim, then the neutral setting, then camera + lens + lighting + framing. ALWAYS English.",
  "supportingCast": [
    // 0 to 3 entries. These are non-protagonist characters that recur in dialogue (e.g. wife, dadi, rival boss, best friend). They are NOT visually consistent across scenes (no separate reference image) — Gemini describes them inline in each scene's prompt and Veo renders them per-frame.
    {
      "role": "wife",                                // Short stable label, kebab-case if multi-word, used as the dialogue speaker tag.
      "name": "Geeta",                               // Display name (any).
      "description": "30-60 word description: appearance, wardrobe, age band, vibe — used by Veo when the supporting char appears in a scene. ALWAYS English."
    }
  ],
  "imagePrompts": [
    {
      "title": "short scene label, kebab-case, <= 40 chars",
      "prompt": "70-120 word cinematic prompt. ALWAYS English. Start with the MAIN character description verbatim, then setting, then action. If supporting cast appear in this scene, describe them HERE (use the supportingCast description verbatim, possibly trimmed). End with camera + lens + lighting + mood."${dialogueDoc}${bgmField}${sfxField}
    }
  ]
}

Dialogue speaker rules:
  - Use "main" as the speaker tag for the protagonist's lines.
  - Use the EXACT supportingCast[].role string as the speaker tag for those characters.
  - Free-form labels (e.g. "passing chai walla") are allowed for one-off bystanders not in supportingCast.
  - Dialogue language: ${langLabel}. lineHi MUST be in ${langLabel}; lineRoman is the Latin-script romanization for subtitles.`;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Public entrypoint
// ──────────────────────────────────────────────────────────────────────────────

export function buildStorylinePrompt(opts: StorylineBuildOpts): string {
  const tpl = NICHE_TEMPLATES[opts.niche];
  const styleLine = STYLE_DESCRIPTORS[opts.characterStyle];
  const ratioLine = RATIO_DESCRIPTORS[opts.aspectRatio];

  const archetypeList = tpl.archetypes.map((a) => `  - ${a}`).join("\n");

  const avoidTitleLine =
    (opts.avoidTitles?.length ?? 0) > 0
      ? `\nAvoid titles or premises that resemble any of these previous attempts: ${opts.avoidTitles!
          .map((t) => `"${t}"`)
          .join(
            ", ",
          )}. Pick a clearly different protagonist, setting, and arc.\n`
      : "";

  const avoidArchetypeLine =
    (opts.avoidArchetypes?.length ?? 0) > 0
      ? `\nRecent protagonists for this niche have been: ${opts.avoidArchetypes!
          .map((t) => `"${t}"`)
          .join(
            ", ",
          )}. Do NOT reuse the same archetype family — pick a clearly different age, gender, occupation, or species. Variety is mandatory.\n`
      : "";

  const HUMAN_CATEGORIES = new Set([
    "uncle",
    "auntie",
    "grandfather",
    "grandmother",
    "schoolKid",
    "teen",
    "bride",
    "groom",
    "deliveryBoy",
    "autoDriver",
    "watchman",
    "officeWorker",
    "rwaSecretary",
    "yogaTeacher",
    "dj",
    "chef",
    "cricketer",
    "teacher",
    "youngMan",
    "youngWoman",
  ]);
  const bannedCats = opts.bannedCategories ?? [];
  const onlyHumansBanned =
    bannedCats.length > 0 && bannedCats.every((c) => HUMAN_CATEGORIES.has(c));
  const animalNudge = onlyHumansBanned
    ? `\n**STRONG NUDGE — pick an ANTHRO HUMAN-ANIMAL HYBRID this run.**\nAll banned categories are plain-human roles. The cleanest way to satisfy the ban AND match the BandarApnaDost signature is to pick an anthro hybrid: HUMAN body + HUMAN hands + ANIMAL head + photoreal animal fur/feathers/skin, dressed in everyday desi wardrobe (kaala chashma, gamcha, kurta, lungi, monkey cap, leather chappals). Examples: monkey-headed dada, bear-headed bouncer, dog-headed thela boy, pigeon-headed aunty, cow-headed pandit, langur-headed traveller, squirrel-headed flower girl, peacock-headed auntie, tomcat-headed tiffin-walla, donkey-headed school kid, parrot-headed peon. The hybrid walks bipedally and uses human hands (NOT paws). Animals-as-pure-quadrupeds are NOT what we want — animal head, human body. Hybrids are the PREFERRED pick for this niche, not a fallback.\n`
    : "";

  const bannedCategoriesLine =
    bannedCats.length > 0
      ? `\n**HARD BAN — protagonist category**\nThe following protagonist categories have been used in recent runs and are FORBIDDEN for this generation: ${bannedCats
          .map((t) => `\`${t}\``)
          .join(", ")}.\n` +
        `Picking ANY of these counts as a failure even if you change wardrobe, accessories, gadgets, or names. ` +
        `Specifically: if "uncle" is banned, do NOT pick a middle-aged man, salt-and-pepper-mustache man, chacha, tau, or any "uncle"-coded protagonist — pick a clearly different demographic (animal, kid, teenager, woman, bride, groom, watchman, courier, auto-driver, etc.). The same rule applies to every other banned category.\n` +
        `Roll the dice across the archetype list above and PICK SOMETHING THE AUDIENCE HAS NOT SEEN RECENTLY.\n` +
        animalNudge
      : "";

  const avoidLine = `${avoidTitleLine}${avoidArchetypeLine}${bannedCategoriesLine}`;

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
      ? "Dialogue language: HINDI. Each `dialogues[].lineHi` MUST be in Devanagari script (हिन्दी). `dialogues[].lineRoman` is the Latin-script transliteration of the same line for subtitles. Keep lines short, natural, conversational, child-friendly. PREFER multi-speaker exchanges (alternating speaker tags) over monologue when supportingCast is non-empty."
      : "Dialogue language: ENGLISH. Each `dialogues[].lineHi` and `dialogues[].lineRoman` should contain the same English line. Keep lines short, natural, conversational. PREFER multi-speaker exchanges (alternating speaker tags) over monologue when supportingCast is non-empty."
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

Multi-character story (NON-NEGOTIABLE)
--------------------------------------
A real story has CONVERSATION, not soliloquy. Build the arc around 2-4 distinct characters interacting:
  1. The MAIN character (protagonist) is visually CONSISTENT across all scenes — same face/wardrobe/prop. Used as a reference image for every render.
  2. 1-3 SUPPORTING characters (wife, dadi, rival, best friend, society aunty, boss, kid, sidekick, antagonist) declared in \`supportingCast\`. They are NOT visually consistent across scenes — describe them inline in each scene's prompt where they appear. Veo renders them per-frame; small look drift between scenes is acceptable.
  3. Dialogue is a back-and-forth exchange. Whenever supporting cast share a frame with the main character, the scene MUST contain at least one line from each speaker (don't waste the second character — make them say something). Aim for 2-4 dialogues per scene with at least 2 distinct speakers when available.
  4. Make the relationship the engine of the story — husband-wife teasing, dadi-pota generation gap, two-friend bickering, mom and naughty kid, hero-vs-society push-back. The interaction drives the comedy / tension / emotion, not the protagonist alone.
  5. Story sense: scenes must follow cause→effect. Each scene's events flow logically from the previous one. The viewer should be able to retell the arc in 2-3 sentences with a clear setup, twist, and resolution.

Hard rules
----------
1. Exactly N image prompts (N is provided by the caller).
2. Each prompt is one visual moment. No on-screen text, captions, or UI overlays.
3. The MAIN character (one protagonist) MUST stay visually consistent across all N prompts AND the character reference image — same age range, same wardrobe family, same key prop. Supporting cast may vary in look between scenes (no consistency requirement).
4. Visual continuity for the MAIN character: location/lighting can shift, but their identity must stay recognizable so chained clips feel like the same person.
5. Cinematic specificity in every prompt: camera angle, lens hint, lighting,
   time of day, mood, one strong physical action. Avoid abstract adjectives.
6. Aspect ratio: ${ratioLine}. Do NOT reference any other ratio.
7. Character style: ${styleLine} Every visual prompt must reaffirm this style — for the main character AND for supporting cast (so they all live in the same world).

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
${tpl.craftBoosters ? `\nCraft boosters\n--------------\n${tpl.craftBoosters}\n` : ""}
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
Use these EXACT camelCase keys at the top level:
"title", "logline", "protagonist", "characterPrompt", "imagePrompts".
Each item inside "imagePrompts" must use these EXACT keys: "title", "prompt"${opts.dialogue ? `, "dialogueHi", "dialogueRoman"` : ""}${opts.bgm ? `, "bgmCue"` : ""}${opts.sfx ? `, "sfxCue"` : ""}.
Do NOT use snake_case (no "character_summary", no "scene_title", no
"image_prompt", no "story_title"). Do NOT rename fields. Do NOT add
unrequested fields.

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
