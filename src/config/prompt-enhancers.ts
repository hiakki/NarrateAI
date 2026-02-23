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
        "HOOK: Extreme close-up of a disturbing detail — cracked porcelain doll face with one missing eye, cobwebs between fingers of a skeletal hand, a child's handprint in dust on a foggy window — harsh single-source side lighting, deep shadows consuming half the frame, desaturated blue-grey palette with sickly yellow accent",
        "BUILD: Wide shot of total isolation — endless dark corridor with peeling wallpaper and flickering fluorescent light at the far end, or a dense fog-choked forest with bare twisted trees, a single broken swing swaying in a dead playground — cold moonlight from above, steel-blue tones, visible breath condensation, dust motes floating",
        "ESCALATE: Dutch angle of wrongness — a bathroom mirror showing a reflection that doesn't match, a staircase where the bottom step leads into water, a hallway where all the doors are open except one — split lighting with one half in warm amber and one in cold blue, distorted shadows on walls",
        "TENSION: Intimate close-up of pure terror — wide dilated pupils reflecting something unseen, white-knuckled hands gripping a flashlight, sweat beading on a pale forehead — harsh underlighting from below casting monstrous shadows upward, warm skin tones against pitch-black background",
        "REVEAL: Partial horror reveal — a tall dark silhouette standing at the end of a bed with impossibly long arms, a face pressed against frosted glass from the other side, dozens of handprints appearing on a steamy mirror — backlit with rim light outlining the shape, volumetric fog, deep red accent against black",
        "CLIMAX: Final haunting image — an empty rocking chair still moving in a dark room, a child's drawing on a wall that shows something watching from behind the viewer, a long dark hallway with a single light that just turned off — near-total darkness with one fading light source, dust settling in still air",
      ],
      moodKeywords: "dread, creeping unease, isolation, something watching from the dark, liminal spaces, uncanny valley, suffocating silence, wrongness, the moment before something terrible",
    },
    casual: {
      storytellingRules: [
        "Tell the scary story like sharing it around a campfire — conversational but building tension",
        "Use 'you' to put the viewer IN the story",
        "Include specific details that make it feel real",
        "End with a twist that recontextualizes everything",
      ],
      visualStyleGuide: [
        "HOOK: A mundane suburban scene with one deeply wrong detail — a family photo where one person has no face, a normal kitchen where the clock hands are spinning backward — warm tungsten lighting with a subtle cold blue creeping in from one edge",
        "BUILD: The environment shifting — wallpaper slowly peeling to reveal dark stains, normal trees with branches that look like reaching fingers, a street where all the houses are dark except one — fading golden hour dissolving into cold twilight blue",
        "CLIMAX: The reveal kept just out of full view — a shadow under a bed that has fingers, a closet door cracked open with one eye visible, footprints on a ceiling — harsh flashlight beam cutting through darkness, green-tinged shadows, visible dust and cobwebs",
      ],
      moodKeywords: "creepy, unsettling, eerie, campfire horror, that feeling when you're alone at night, suburban dread",
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
        "HOOK: A towering godlike figure with glowing eyes standing on a mountain peak, cosmic nebula swirling in the sky behind them, golden armor reflecting starlight, volumetric aurora borealis cascading down, dramatic low angle — deep indigo sky with molten gold accents",
        "BUILD: Epic aerial view of a mythological realm — a city of marble and gold perched on floating islands above a sea of clouds, waterfalls cascading into the void, massive stone statues flanking a bridge, warm golden hour light — rich turquoise and ivory palette",
        "CONFLICT: Two divine beings clashing mid-air, lightning arcing between their weapons, shattered pieces of earth floating around them, shockwave ripples distorting the air — extreme dynamic angle, split-toned lighting with hot orange on one side and cold blue on the other",
        "SACRIFICE: Extreme close-up of a hero's face — tears streaming down battle-scarred skin, eyes reflecting golden flames, jaw clenched in determination, background blurred into warm amber bokeh — intimate 85mm portrait lens feel, warm side lighting",
        "CONSEQUENCE: A new constellation forming in a dark sky above a barren transformed landscape, a single broken weapon planted in scorched earth, glowing cracks in the ground, ethereal light rising — deep midnight blue with stellar white and fading gold accents",
      ],
      moodKeywords: "epic grandeur, divine wrath, ancient power, cosmic scale, fate and destiny, immortal tragedy, celestial wonder",
    },
    educational: {
      storytellingRules: [
        "Present the myth as a fascinating story first, lesson second",
        "Compare the myth to modern parallels the viewer would recognize",
        "Explain what ancient people were trying to understand with this myth",
      ],
      visualStyleGuide: [
        "HOOK: The most iconic moment of the myth rendered in rich painterly detail — a god's transformation, a hero's impossible task, a divine punishment — warm Renaissance oil painting tones with dramatic Rembrandt lighting",
        "BUILD: Detailed mythological environments showing daily life and culture — ancient temples with intricate carvings, marketplace scenes, ritual ceremonies — warm diffused sunlight, rich earth tones and terracotta",
        "CLIMAX: The pivotal mythological moment in dramatic composition — a sacrifice at an altar, a monster defeated, a forbidden fruit taken — dynamic diagonal composition, dramatic chiaroscuro, deep saturated colors",
      ],
      moodKeywords: "ancient wisdom, mythological grandeur, timeless stories, epic landscapes, cultural richness",
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
        "HOOK: Yellow police tape stretched across a rain-soaked dark alley, red and blue police lights reflecting in puddles, numbered evidence markers on wet asphalt, a single shoe left behind — harsh overhead streetlight cutting through drizzle, desaturated teal with crimson accents",
        "INVESTIGATION: A detective's cluttered desk — scattered case files with coffee ring stains, a cork board covered in photos connected by red string, overflowing ashtray, desk lamp casting warm circle of light in an otherwise dark precinct office — warm tungsten vs cold fluorescent contrast, noir film grain",
        "EVIDENCE: Extreme close-up of a fingerprint on glass under UV light glowing electric blue, scattered polaroid photographs on a metal table, a cracked phone screen showing the last text message — clinical white light from above, sterile cold blue palette, forensic precision",
        "REVELATION: A suspect's silhouette behind one-way interrogation glass, harsh overhead fluorescent light casting downward shadows on their face, empty chair across the table, recording device with red light blinking — cold institutional green-grey tones, oppressive contrast",
        "AFTERMATH: An empty abandoned house at dusk with one light still on inside, missing person flyers peeling off a telephone pole in the rain, a memorial of flowers and candles at a roadside — fading twilight blue with warm candlelight glow, melancholic quiet",
      ],
      moodKeywords: "noir tension, forensic detail, shadowy investigation, cold case atmosphere, unsettling evidence, documentary grit, rain-soaked streets",
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
        "HOOK: A dramatic historical moment frozen mid-action — a general raising a sword above a battlefield with smoke rising, an explorer stepping onto uncharted shore with ships behind, a mushroom cloud reflected in terrified eyes — warm sepia base with vivid action color accents, painterly documentary style",
        "CONTEXT: Grand aerial establishing shot of the historical setting — a medieval walled city teeming with market activity, a Roman forum with marble columns and toga-clad crowds, a 1940s war-torn European street — diffused period-appropriate lighting, muted but rich color palette, deep architectural detail",
        "DETAIL: Extreme close-up of period artifacts — a quill pen dripping ink onto parchment with visible handwriting, a sword with ornate engravings catching candlelight, an ancient map with compass and wax seal — warm focused spotlight on object, dark vignette, textured aged surfaces",
        "TURNING POINT: The pivotal moment rendered with maximum drama — a signing hand over a historic document, a flag being raised, a wall coming down — dramatic diagonal composition, spotlight on the central action, deep contrast between light and shadow",
        "LEGACY: Modern cityscape or landscape transitioning from historical illustration — half the frame is sepia-toned period scene, half is vivid modern photograph of the same location — split-tone warm past vs cool present, architectural echoes connecting both eras",
      ],
      moodKeywords: "historical gravitas, documentary realism, cinematic period atmosphere, immersive time travel, living history",
    },
    dramatic: {
      storytellingRules: [
        "Tell history like a thriller — open in medias res at the most intense moment",
        "Use countdown tension: 'They had 24 hours before...'",
        "Humanize the key players — what were they thinking, feeling, risking?",
        "End with the dramatic irony of what came next",
      ],
      visualStyleGuide: [
        "HOOK: The single most explosive historical image — a city in flames reflected in a river, a lone figure standing against an advancing army, a ship sinking into dark waves — hyper-dramatic lighting with fire-orange against smoke-black, maximum contrast",
        "BUILD: The calm before the storm — a pristine city before bombardment, soldiers writing letters home by candlelight, families at dinner unaware of what comes — warm golden domestic lighting with cold shadows creeping in from the edges",
        "ESCALATE: Chaos increasing — crowds running through rubble-strewn streets, smoke filling the sky, papers and debris flying — dynamic tilted angle, motion blur, desaturated except for fire and blood tones",
        "CLIMAX: The no-return moment rendered at peak intensity — a hand pressing a button, a declaration being read, troops crossing a bridge — extreme close-up intercut with wide-shot scale, harsh split lighting, time-frozen composition",
      ],
      moodKeywords: "historical drama, epic turning points, human cost of history, cinematic grandeur, war and consequence",
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
        "HOOK: A familiar government building or monument with digital glitch artifacts corrupting the image, scan lines and RGB color separation, pixelated blocks revealing hidden text underneath — CRT monitor aesthetic, green-on-black Matrix-style color bleed, surveillance camera timestamp in corner",
        "EVIDENCE: An evidence board filling an entire wall — photos connected by red string forming a web, redacted documents with heavy black bars, newspaper clippings yellowed with age, a single bright spotlight illuminating the board in an otherwise dark room — warm incandescent vs cold screen glow",
        "REVELATION: Split-screen comparison showing two versions of the same event — satellite imagery of a restricted area with structures that shouldn't exist, zoomed and enhanced sections highlighted with red circles, thermal imaging overlay — clinical analytical blue-white palette with alert-red highlights",
        "SMOKING GUN: Extreme close-up of a damning document — highlighted text glowing under UV light, a classified stamp partially visible, a date that contradicts the official timeline — harsh focused desk lamp, dramatic shadows on paper creases, warm yellow document against cold blue surroundings",
        "QUESTION: A dark room with a single screen displaying static, an empty office chair still spinning, surveillance monitors showing feeds that just went dark, a phone left off the hook — cold electronic blue glow in total darkness, lens flare from screen, dust in the air",
      ],
      moodKeywords: "paranoid tension, hidden truths, surveillance aesthetic, glitch reality, something they don't want you to see, deep state atmosphere",
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
        "HOOK: An empty two-lane highway at 3am stretching into fog, a single broken streetlight flickering orange, faded road signs barely visible, tire marks swerving off the asphalt into darkness — cold steel-blue moonlight with sickly sodium-orange streetlight, mist hugging the road surface",
        "BUILD: A suburban neighborhood where the fog has rolled in thick — every house dark except one with a pale light in the attic window, an empty children's playground with one swing still moving, leaves blowing across an empty sidewalk — creeping blue fog against warm house-light amber, deep shadows between houses",
        "ESCALATE: A normal bathroom mirror where the reflection is slightly wrong — the reflection's eyes are looking in a different direction, a figure barely visible in the dark hallway behind, water droplets on the glass distorting part of the image — harsh fluorescent overhead light against pitch-dark reflected hallway, sickly green tint",
        "REVEAL: A tall impossibly thin figure standing at the tree line just beyond the reach of a porch light, unnaturally long limbs, face obscured by shadow except for two reflective pinpoints where eyes should be — backlit by distant lightning, volumetric fog, near-total silhouette with just enough detail to disturb",
        "AFTERMATH: The same location from the hook, now in pale dawn light — everything looks normal except for one detail that proves something was there: fresh scratches on a door, muddy footprints that lead from the road and stop at a wall, a window left open that was closed — cold blue pre-dawn with warming pink on the horizon",
      ],
      moodKeywords: "suburban dread, familiar places turned threatening, midnight atmosphere, foggy roads, that feeling of being followed, liminal nocturnal spaces",
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
        "HOOK: A massive wall of ocean water parting with golden light pouring through the gap, tiny human figures silhouetted at the base, spray and mist catching divine rays, a burning bush with unnatural orange-white flames on a dark rocky mountain — intense volumetric god rays from above, deep indigo sky behind blazing gold and amber foreground",
        "BUILD: A lone figure kneeling in prayer on a stone floor of an ancient temple, shafts of dusty sunlight from high windows, ornate columns and carved walls, worn robes and bare feet, a scroll open nearby — warm Rembrandt-style golden side-lighting, Renaissance oil painting composition with rich earth and ivory tones",
        "DIVINE: An angelic presence descending through parting clouds, massive feathered wings catching golden light, a divine hand reaching down from swirling heavens toward an upraised human hand below, supernatural glow illuminating a dark landscape — brilliant warm gold center radiating outward to deep purple sky, ethereal lens bloom",
        "TRIAL: A lone figure walking through an endless barren desert under a merciless sun, cracked earth stretching to every horizon, dramatic long shadow cast behind them, a distant mountain barely visible through heat haze — scorching warm amber and burnt sienna tones, harsh overhead lighting with no shade, oppressive emptiness",
        "GLORY: Brilliant sunrise breaking over a mountaintop with a figure standing arms raised, dark storm clouds parting to reveal pure golden light flooding a valley below, a rainbow arcing across the cleared sky — transcendent warm gold and white center against receding deep purple-grey storm, maximum light contrast",
      ],
      moodKeywords: "divine awe, sacred grandeur, Renaissance masterpiece, heavenly light against earthly darkness, faith tested and proven, biblical scale",
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
        "HOOK: A mountain of gold bars stacked inside a massive steel vault, each bar catching a different angle of sharp spotlight, reflections dancing on polished metal walls, a single red laser security beam cutting diagonally across — deep metallic gold against cold steel-grey, cinematic shallow depth of field on nearest bar",
        "PLAN: An overhead shot of blueprints spread on a table in a dimly lit warehouse, miniature building model alongside, black leather gloves and lockpicking tools arranged precisely, a laptop showing security camera feeds — warm desk lamp circle of light against dark industrial space, technical precision aesthetic",
        "EXECUTION: Extreme close-up of black-gloved fingers entering a code on a vault keypad, LED numbers glowing green, sweat droplets on the glove surface, the vault mechanism beginning to turn with visible gears — shallow DOF on fingers with blurred vault behind, cold blue-green tech glow against dark steel",
        "TENSION: A security guard's flashlight beam sweeping around a corner just as a dark figure presses flat against a wall in shadow, alarm panel on the wall with one light turning from green to amber — harsh white flashlight beam cutting through darkness, red alarm accent, silhouette-heavy composition",
        "AFTERMATH: An empty vault with its massive door hanging open, shelves bare, a single calling card left on the floor, dust settling in the spotlights — cold industrial lighting on empty metal, the absence of treasure more dramatic than its presence, wide-angle showing the scale of emptiness",
      ],
      moodKeywords: "heist thriller, Ocean's Eleven tension, blueprint precision, adrenaline, the perfect crime, cold professionalism",
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
        "HOOK: A character mid-transformation, glowing aura of energy radiating outward shattering the ground beneath, hair flowing upward defying gravity, eyes blazing with supernatural light, speed lines and particle effects exploding from center — vivid neon blue and gold energy against deep black, dynamic low angle",
        "BUILD: A character making a dramatic entrance through smoke or dust, cape or coat billowing in wind, one hand raised with gathering energy, allies standing behind in formation, detailed urban or fantasy environment — saturated warm tones for hero, cool tones for environment, anime cel-shading with detailed shadows",
        "ESCALATE: Two powerful beings clashing in mid-air, shockwave visible as expanding ring distorting the sky, detailed anime-style energy effects crackling between them, environment below crumbling — split color scheme hot red vs electric blue, extreme diagonal composition, motion blur on impact",
        "EMOTION: Extreme close-up of a character's face with tears streaming, one eye reflecting a falling comrade or destroyed homeland, rain mixing with tears, lips trembling — soft warm backlighting creating rim light on hair, muted desaturated palette except for glistening tears, intimate 85mm feel",
        "PEAK: The ultimate attack unleashed — a beam of pure energy cutting across the frame from character to horizon, the ground vaporizing in its path, character in powerful stance with both arms extended, detailed energy vortex — blinding white-hot center with chromatic aberration, vivid color explosion outward",
      ],
      moodKeywords: "anime hype, shonen energy, peak fiction vibes, jaw-dropping action, emotional devastation, sakuga-tier visual spectacle",
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
        "HOOK: A person sitting alone on a curb in the rain, head bowed, soaked clothes, a crumpled rejection letter in their hand, puddle reflecting neon signs from a closed business behind them — cold blue rain with warm distant city lights bokeh, desaturated except for the neon reflection, low angle emphasizing smallness",
        "STRUGGLE: Close-up of rough calloused hands counting small coins on a worn wooden table, an eviction notice partially visible, a dim bare-bulb kitchen, peeling paint on walls — harsh single overhead bulb casting deep shadows, warm but sparse light, gritty textured surfaces, intimate tight framing",
        "GRIND: A silhouette running up concrete steps at 4am, city skyline barely visible through pre-dawn mist, sweat visible on bare arms, breath condensation in cold air, street lamps creating long dramatic shadows — deep blue pre-dawn transitioning to warm amber on the horizon, dynamic low angle looking up the stairs",
        "BREAKTHROUGH: A hand firmly shaking another across a desk, an acceptance letter with a visible signature, golden sunlight streaming through office windows, a genuine smile with tears of joy — warm rich golden hour flooding the frame, soft lens flare, everything bathed in earned warmth",
        "TRIUMPH: A figure standing on a rooftop at golden hour arms spread wide, entire city spread below them glittering, suit jacket blowing in the wind, sun creating a blazing halo behind their head — maximum warm golden light, lens flare bursting from behind the figure, epic wide-angle showing the distance traveled",
      ],
      moodKeywords: "underdog triumph, against all odds, raw determination, from nothing to everything, cinematic inspiration, earned glory",
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
        "HOOK: A supermassive black hole warping spacetime, accretion disk of superheated plasma spiraling inward glowing brilliant orange and white, stars being stretched into spaghettified streaks, gravitational lensing bending background galaxies — deep cosmic black with blazing hot plasma orange-white, ultra-detailed particle effects",
        "EXPLAIN: A human cell dividing in extreme microscopic detail, chromosomes pulling apart with visible protein filaments, translucent cell membrane glowing blue, organelles floating in cytoplasm — bioluminescent blue-green palette, soft diffused internal glow, scientific visualization aesthetic with artistic beauty",
        "SCALE: A dramatic zoom composition showing Earth as a tiny dot beside Jupiter, which is dwarfed by the Sun, which is a pixel next to VY Canis Majoris — logarithmic scale visualization, deep space black background with each star/planet at its true color, awe-inspiring size comparison with measurement lines",
        "IMPACT: A futuristic medical visualization — nanobots navigating through blood vessels attacking a tumor cell, red blood cells flowing past, the nanobot glowing with targeted laser precision — warm red blood tones with cool blue-white tech glow, intimate microscopic perspective, cinematic internal body journey",
        "MYSTERY: An artistic visualization of dark matter — invisible filaments connecting galaxies like a cosmic web made visible, normal matter as bright points along dark flowing rivers of unknown substance — deep ultraviolet and cosmic indigo with ghostly white filament structures, ethereal and mysterious",
      ],
      moodKeywords: "cosmic wonder, scientific awe, microscopic detail, the beauty of the universe, mind-expanding, frontier of knowledge",
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
        "HOOK: A chaotic cluttered desk covered in tangled cables, sticky notes, coffee cups, and scattered papers, a frustrated person's hands gripping their head visible at top of frame — bright overhead lighting making the mess painfully visible, warm messy tones, relatable everyday frustration captured in vivid detail",
        "SOLUTION: A clean split-composition before/after — left side messy and chaotic in warm cluttered tones, right side organized and pristine in cool minimal tones, a hand dramatically revealing the clean side by pulling away a divider — crisp bright studio lighting, satisfying visual contrast, clean product-photography style",
        "DETAIL: Extreme close-up of hands performing the hack — fingers folding fabric perfectly, pouring a precise amount, clicking something into place, with a soft pastel background and subtle shadow — soft diffused studio lighting, shallow DOF on the action, bright clean whites and pastels, ASMR-visual satisfaction",
        "RESULT: The final transformed space or object — everything organized perfectly in matching containers, cables routed neatly, a zen-like organized desk or closet, small plant accent — bright airy natural window light, fresh mint and white palette, everything gleaming and satisfying, wide-angle to show full transformation",
      ],
      moodKeywords: "bright, clean, satisfying, before-and-after transformation, clever simplicity, visual ASMR, organizational joy",
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
    "HOOK: The most visually striking image that captures the theme — a dramatic subject in a vivid environment with strong directional lighting, a specific color palette that sets the tone, atmospheric effects like fog, particles, or lens flare — extreme close-up or dramatic low angle for maximum impact",
    "BUILD: Establishing the world with rich layered detail — specific environment with foreground interest, middle-ground subject, and deep background, textured surfaces and materials, natural or practical light sources casting realistic shadows — wide shot showing scale and context, warm or cool palette matching the mood",
    "ESCALATE: Intensifying the visual energy — closer framing, stronger contrast, more dramatic lighting angle shifting from the previous scene, more saturated or desaturated colors depending on tone, dynamic composition with diagonal lines or dutch angle — atmospheric effects intensifying",
    "CLIMAX: The peak image with maximum cinematic impact — the most emotionally charged subject in the most dramatic lighting possible, strongest color contrast of the sequence, tightest or widest framing for emotional effect, every detail serving the narrative — this must be the most memorable frame in the video",
  ],
  moodKeywords: "engaging, cinematic, visually rich, emotionally resonant, professionally composed, dramatic lighting",
};

export function getPromptEnhancer(niche: string, tone: string): PromptEnhancer {
  return ENHANCERS[niche]?.[tone] ?? ENHANCERS[niche]?.dramatic ?? ENHANCERS[niche]?.casual ?? DEFAULT_ENHANCER;
}
