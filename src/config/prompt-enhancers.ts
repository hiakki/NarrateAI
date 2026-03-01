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
  "religious-epics": {
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
  "what-if": {
    educational: {
      storytellingRules: [
        "Open with the scenario stated as simply as possible: 'What if gravity just... stopped?'",
        "Immediately show the first consequence — the thing that happens in the first 5 seconds",
        "Escalate through a chain reaction: each scene reveals a bigger, more terrifying consequence",
        "Include the science — real physics, biology, or logic that makes it feel plausible",
        "End with the final, mind-blowing consequence that nobody would have predicted",
        "Make the viewer feel like they're watching it happen in real time",
      ],
      visualStyleGuide: [
        "HOOK: The impossible moment frozen mid-frame — people floating off the ground with shocked expressions, water rising from a glass in a perfect sphere, cars drifting off roads into the sky — bright daylight making the impossibility feel MORE unsettling, hyper-real detail, sharp focus",
        "CHAIN: The escalating consequence — oceans lifting off the seabed revealing the dark ocean floor, buildings cracking as their foundations shift, the atmosphere visibly thinning as gas escapes upward — wide establishing shots showing planetary scale, warm-to-cold color transition as things get worse",
        "SCIENCE: A dramatic visualization of the underlying physics — gravitational field lines bending, molecular bonds stretching, tidal forces visualized as flowing energy — deep cosmic blue with bright orange scientific visualization overlays, clean infographic aesthetic merged with cinematic drama",
        "PEAK: Maximum catastrophe — the Earth's crust fracturing, the sun's appearance changing, a skyline collapsing or floating apart — extreme wide angle showing the full scale of destruction, split lighting between the normal world and the transformed one",
        "AFTERMATH: The haunting new reality — a transformed Earth landscape that's both beautiful and terrifying, alien but recognizable, silent and vast — cold ethereal lighting, muted post-apocalyptic palette with one striking color accent",
      ],
      moodKeywords: "mind-bending curiosity, scientific wonder, escalating dread, the impossible made real, cosmic scale consequences, thought experiment brought to life",
    },
    dramatic: {
      storytellingRules: [
        "Present the scenario like a thriller: 'It's 3:42 PM when the impossible happens'",
        "Use a human perspective — follow one person experiencing the event",
        "Each scene is a new stage of escalation",
        "End with a haunting final image that stays with the viewer",
      ],
      visualStyleGuide: [
        "HOOK: A single frozen moment of the impossible — a wave hanging motionless in the air, a person's shadow moving independently, the sky turning an unnatural color — hyper-real photographic quality, unsettling stillness, warm light with creeping cold edges",
        "ESCALATE: Chaos building through human experience — crowds running, emergency sirens, a child pointing at something impossible in the sky — handheld documentary feel, desaturating colors as reality breaks down",
        "CLIMAX: Full-scale reality break — the most dramatic visualization of the scenario at its peak, maximum visual impact, split between beauty and terror — extreme contrast, volumetric light, cinematic scale",
      ],
      moodKeywords: "existential dread meets wonder, reality glitching, thriller pacing, what-if anxiety, the impossible happening NOW",
    },
  },
  "dark-psychology": {
    dramatic: {
      storytellingRules: [
        "Open with a disturbing truth: 'You're being manipulated right now — and you don't even know it'",
        "Present each trick or tactic as a numbered reveal — viewers love countdowns of dark knowledge",
        "Use real-world examples: 'Advertisers use this', 'Narcissists always do this'",
        "Make the viewer feel like they're getting forbidden knowledge — insider secrets",
        "End with how to PROTECT yourself — turn the dark knowledge into a shield",
        "Use second person: 'you' — put the viewer IN the scenario",
      ],
      visualStyleGuide: [
        "HOOK: A close-up of an eye with a reflection showing puppet strings controlling a silhouette, or a face half in shadow with one eye glowing — dark moody lighting with a single harsh spotlight, deep indigo and crimson palette, noir aesthetic, shallow depth of field",
        "REVEAL: A visual metaphor for manipulation — chess pieces where one is controlling others, a maze seen from above with one figure watching from outside, strings attached to a person's limbs leading to a shadowy hand above — cold blue steel lighting with warm amber accents on the controller, high contrast",
        "EVIDENCE: Social scenarios rendered cinematically — a boardroom where one person subtly dominates, a conversation where body language tells a different story than words, a crowd unknowingly following a pattern — warm everyday lighting with subtle dark undertones, documentary-meets-thriller feel",
        "SHIELD: Empowerment — a figure standing in light breaking free of chains or puppet strings, shattered mirror reflecting a stronger self, armor of awareness glowing around a person — transitioning from dark cold tones to warm empowering gold, dramatic rim lighting",
      ],
      moodKeywords: "forbidden knowledge, dark insight, manipulation exposed, noir psychological thriller, mind games revealed, empowerment through awareness",
    },
  },
  "space-cosmos": {
    dramatic: {
      storytellingRules: [
        "Open with scale — make the viewer feel infinitely small: 'There's a star out there so big, our entire solar system could fit inside it'",
        "Use comparison to familiar things: 'If the Sun were a basketball, Earth would be a peppercorn 26 meters away'",
        "Build wonder through increasingly mind-blowing facts",
        "Include the existential question: why does this matter to us, here, now?",
        "End with the biggest unanswered mystery — leave them staring at the ceiling at 2 AM",
      ],
      visualStyleGuide: [
        "HOOK: A jaw-dropping cosmic vista — a nebula in full color spanning the entire frame, or Earth seen as a tiny pale dot from the edge of the solar system, or a supermassive black hole warping light around it — deep space black with vivid nebula colors (electric blue, magenta, gold), volumetric god rays, ultra-detailed particle effects",
        "SCALE: Dramatic size comparison — planets lined up showing Earth as a speck, or zooming from a human to a galaxy in stages — clean dark background with objects at true color, measurement lines and subtle UI overlays, awe-inspiring logarithmic scale",
        "WONDER: The most beautiful cosmic phenomenon — a pulsar spinning with visible energy jets, binary stars dancing around each other, aurora on an alien planet — rich saturated cosmic palette, stellar lens flares, crystalline detail on celestial objects",
        "MYSTERY: The unknown visualized — dark matter web connecting galaxies, the edge of the observable universe as a shimmering boundary, or a visualization of what lies beyond — deep ultraviolet and cosmic indigo, ethereal ghostly structures, the vastness of the unknown",
        "AWE: The final mind-expanding image — Earth from space with all city lights visible, or the Milky Way from its edge showing all its spiral arms — warm golden human-scale elements against cold infinite cosmic backdrop, the smallness of humanity against the grandeur of space",
      ],
      moodKeywords: "cosmic awe, infinite scale, existential wonder, the beauty of the void, stargazer's dream, universe at the edge of understanding",
    },
    educational: {
      storytellingRules: [
        "Present space facts as discoveries the viewer is making alongside you",
        "Use vivid analogies: explain light-years using road trips, temperatures using everyday objects",
        "Each scene reveals something more incredible than the last",
        "End with the question science still can't answer",
      ],
      visualStyleGuide: [
        "HOOK: A stunning space photograph brought to life — Hubble-quality deep field with thousands of galaxies, or a close-up of a planetary surface with visible geology — scientifically accurate colors, clean informational aesthetic",
        "EXPLAIN: Clear scientific visualization — orbital mechanics, stellar lifecycle, or cosmic distance scales with clean labels and warm lighting — educational blue-white palette with vivid accents on key elements",
        "CLIMAX: The most spectacular cosmic event — a supernova explosion, galaxy collision, or neutron star merger — maximum visual spectacle with scientifically grounded detail",
      ],
      moodKeywords: "cosmic classroom, stellar wonder, documentary beauty, the universe explained, scientific awe",
    },
  },
  "animal-kingdom": {
    educational: {
      storytellingRules: [
        "Open with the most shocking animal fact: 'This creature can survive being frozen solid — and come back to life'",
        "Present each animal ability like a superpower — make it feel extraordinary",
        "Use comparison to humans: 'If you could do what this ant does, you could carry a car'",
        "Include the evolutionary WHY — what drove this insane adaptation",
        "End with the animal that's the most mind-blowing of all — save the best for last",
      ],
      visualStyleGuide: [
        "HOOK: An extreme close-up of the animal in its most dramatic moment — a chameleon's tongue mid-strike, an eagle diving at full speed with wings tucked, a deep-sea creature glowing bioluminescent in pitch darkness — macro lens detail, vivid natural colors, frozen action with motion blur on the background",
        "ABILITY: The animal demonstrating its superpower — a mantis shrimp punching with visible shockwave, an octopus changing color and texture, a gecko walking upside down with visible toe pads — scientific visualization merged with National Geographic photography, bright natural lighting",
        "SCALE: Size or ability comparison — the animal next to a human hand or a familiar object for scale, or a split-screen showing the human equivalent of the animal's ability — clean white background with the animal in vivid color, infographic-style comparison lines",
        "HABITAT: The animal in its natural world — a coral reef teeming with life, a savanna at golden hour, a deep ocean trench with bioluminescence — rich environmental colors, cinematic wide shots, the animal as protagonist in its world",
        "REVEAL: The most mind-blowing fact visualized — the animal's internal structure, its vision of the world (UV, infrared), or its impossible survival mechanism — scientific visualization with artistic beauty, cross-section or x-ray aesthetic with warm biological tones",
      ],
      moodKeywords: "nature's greatest hits, animal superpowers, macro wonder, National Geographic meets superhero, evolutionary marvel, the wild kingdom's secrets",
    },
  },
  survival: {
    dramatic: {
      storytellingRules: [
        "Open with the life-or-death scenario: 'You're 30,000 feet up. The engine just died. You have 4 minutes.'",
        "Use second person — put the viewer IN the survival situation",
        "Present survival steps as a countdown or sequence: 'First... then... whatever you do, DON'T...'",
        "Include the real story of someone who survived (or didn't) to make it visceral",
        "End with the ONE thing that separates survivors from victims — the mindset shift",
        "Each scene should escalate the danger before revealing the solution",
      ],
      visualStyleGuide: [
        "HOOK: The disaster moment frozen in time — a crashing wave about to engulf a boat, a crack spreading across ice under someone's feet, smoke filling an airplane cabin — hyper-real detail, warm human skin tones against cold hostile environment, single sharp focus point on the danger, adrenaline-freeze aesthetic",
        "DANGER: The full scale of the threat — aerial view of a person alone in a vast ocean, a forest fire approaching a ridge, a mountain crevasse opening — extreme wide angle showing human smallness against nature's power, desaturated cold tones with hot danger accents (fire orange, deep water blue)",
        "SURVIVAL: The critical action being taken — hands building a shelter from debris, a figure signaling with a mirror, someone applying a tourniquet — close-up on hands and tools, warm determined lighting on the person against dark threatening surroundings, shallow DOF creating intimacy",
        "TENSION: The moment it almost fails — a rope fraying, water rising to chin level, the last match being struck — extreme macro close-up on the failing element, harsh split lighting, time-frozen at the peak moment, maximum contrast between hope and failure",
        "RESCUE: Survival earned — a helicopter searchlight finding a person in darkness, first responders reaching the survivor, or the survivor walking out of the wilderness into civilization — warm golden rescue-light flooding cold blue scene, emotional rim lighting, the transition from death-tones to life-tones",
      ],
      moodKeywords: "life or death stakes, survival instinct, against nature, adrenaline and determination, human resilience, the thin line between living and dying",
    },
  },
  "money-wealth": {
    dramatic: {
      storytellingRules: [
        "Open with a mind-shifting money fact: 'The richest man who ever lived had so much gold, he crashed an entire economy just by walking through a country'",
        "Present wealth secrets as forbidden knowledge: 'Here's what they'll never teach you in school about money'",
        "Use specific numbers — '$47 billion', '3:45 AM wake-up' — precision creates credibility",
        "Contrast the rich and the average: show what's different about their THINKING, not their stuff",
        "End with an actionable mindset shift the viewer can apply TODAY",
        "Make it aspirational but grounded — not 'get rich quick' but 'think differently about money'",
      ],
      visualStyleGuide: [
        "HOOK: Opulent wealth made visual — a penthouse overlooking a glittering city skyline at night, a hand placing a chess piece on a board made of gold and crystal, stacks of cash in a vault with dramatic lighting — rich warm gold and deep black, shallow depth of field on the luxury object, cinematic noir-meets-luxury aesthetic",
        "CONTRAST: Side-by-side comparison — split frame showing two morning routines, two desks, two approaches to the same problem — one side in cold fluorescent everyday tones, the other in warm rich golden tones, visual metaphor for the mindset difference",
        "INSIGHT: The wealth principle visualized — compound interest as a growing tree, passive income as water flowing from multiple streams into one river, leverage as a small figure moving a massive boulder — clean conceptual illustration style with warm amber and deep navy, elegant minimal composition",
        "PROOF: Real-world evidence — a timeline of wealth accumulation, a before-and-after of an investment, a graph rendered as a mountain landscape — data visualization merged with cinematic beauty, gold accents on dark sophisticated background",
        "SHIFT: The empowering close — a figure at a crossroads choosing the road less taken, or standing at the base of a golden staircase looking up with determination — warm rising-sun gold flooding the frame, aspirational upward angle, the feeling of possibility",
      ],
      moodKeywords: "aspirational wealth, forbidden financial knowledge, golden luxury meets strategic thinking, the millionaire mindset, elegant ambition, money mastery",
    },
  },
  "funny-stories": {
    funny: {
      storytellingRules: [
        "Open with a relatable situation everyone has experienced — then twist it into absurdity",
        "Use the comedy rule of three: set up expectation twice, subvert it the third time",
        "Keep the punchline for the end of each scene — never telegraph the joke early",
        "Use specific, visual humor — describe exactly what went wrong, not just 'it was funny'",
        "End with the biggest laugh saved for last — the callback or the escalation that tops everything",
        "Write like telling the story to a friend at a bar: natural, punchy, with comedic pauses built in",
      ],
      visualStyleGuide: [
        "HOOK: A hilariously exaggerated facial expression — eyes comically wide, jaw dropped to the floor, a coffee mug frozen mid-spill in a brightly lit cartoon-like kitchen, vibrant warm colors, soft shadows, Pixar-quality 3D rendering with playful bounce lighting — bright saturated palette, comedic timing frozen in a single frame",
        "BUILD: A relatable everyday scene going subtly wrong — a leaning tower of dishes about to topple, a cat sitting on a laptop during a video call, a person confidently walking toward a glass door — bright cheerful natural lighting, warm household colors, exaggerated perspective for comedic effect",
        "ESCALATE: Full comedic chaos — a birthday cake sliding off a table in slow motion, a chain reaction of dominoes knocking over increasingly absurd objects, someone's face covered in whipped cream while still smiling — dynamic low angle, bright saturated colors, confetti or debris mid-air, frozen peak-comedy moment",
        "PUNCHLINE: The aftermath — a person standing in total wreckage with a thumbs up, a dog proudly sitting next to a destroyed couch, someone reading a rejection letter and laughing — warm golden lighting with a sense of 'everything is fine', bright and inviting, comedic contrast between destruction and calm acceptance",
      ],
      moodKeywords: "laugh-out-loud, relatable chaos, comedic timing, bright and cheerful, exaggerated expressions, Pixar warmth, feel-good comedy",
    },
    casual: {
      storytellingRules: [
        "Tell it like a friend sharing a hilarious thing that just happened",
        "Use conversational language — 'so this guy' not 'a gentleman proceeded to'",
        "Build the joke with increasingly absurd details",
        "End with a mic-drop punchline or ironic twist",
      ],
      visualStyleGuide: [
        "HOOK: A bright, cheerful scene with one comically wrong detail — a giant rubber duck in a swimming pool filled with spaghetti, a cat wearing a tiny business suit — saturated warm colors, playful soft lighting, slight fish-eye lens distortion for comedic exaggeration",
        "BUILD: The setup scene with a calm-before-the-storm vibe — everything looks normal but one element is slightly off — bright daylight, clean modern environment, subtle visual foreshadowing of the coming chaos",
        "PUNCHLINE: Maximum comedic impact — the moment everything goes wrong captured in freeze-frame, exaggerated expressions, objects mid-flight, a perfectly timed visual gag — bright flash lighting, vibrant saturated palette, dynamic perspective",
      ],
      moodKeywords: "bright, warm, playful, relatable humor, slice of life comedy, feel-good vibes",
    },
  },
  "zero-to-hero": {
    dramatic: {
      storytellingRules: [
        "Open at the ABSOLUTE lowest point — not just 'things were hard' but a vivid, gut-wrenching moment of despair that the viewer feels physically",
        "Show the specific turning point: the one decision, conversation, or realization that changed everything",
        "Include the montage of grind — sleepless nights, closed doors, empty bank accounts, eating cheap noodles alone",
        "Build to the breakthrough where effort finally meets opportunity — make it feel EARNED, not lucky",
        "End with the triumphant present: the person standing where they once only dreamed — make the viewer feel 'if they did it, I can too'",
        "Always tie the ending back to the opening scene — show the contrast between rock bottom and the peak",
      ],
      visualStyleGuide: [
        "HOOK: Rock bottom — a figure huddled on a park bench in the rain at night, wet cardboard serving as a pillow, a single flickering streetlight barely illuminating their silhouette, water running through gutters, shoes with holes — desaturated cold blue tones, harsh single streetlight creating deep shadows, rain streaks visible in the light cone, oppressive darkness surrounding",
        "STRUGGLE: The grind made visible — calloused hands stitching fabric by candlelight in a cramped room, a stack of rejection letters on a worn wooden table, an alarm clock showing 3:47 AM with someone already dressed for work — warm but dim single-source lighting, gritty textures, confined claustrophobic framing, muted earth tones",
        "TURNING POINT: The spark of change — a determined pair of eyes reflecting a laptop screen in a dark room, a hand drawing a business plan on a napkin in a diner, or picking up a book from a trash can — warm amber glow from a single light source against surrounding darkness, the first hint of gold entering the color palette",
        "RISE: Momentum building — a figure jogging at dawn past a city skyline with the sun just breaking the horizon, or presenting to a small room of people leaning forward with interest, or opening the doors of a new small shop — golden hour warmth flooding in, desaturation giving way to rich color, low angle emphasizing growing stature",
        "TRIUMPH: Full glory — the same person from scene 1 now standing on a rooftop or stage, city lights or crowd below, perfectly dressed, sunrise or golden light creating a blazing halo, arms open wide or fist raised — maximum warm gold and amber, epic wide angle, lens flare bursting from behind them, the ultimate before-and-after contrast",
      ],
      moodKeywords: "rags to riches, underdog triumph, raw grit becoming gold, against impossible odds, emotional transformation, cinematic inspiration, the viewer should feel tears forming",
    },
  },
  "satisfying": {
    casual: {
      storytellingRules: [
        "Open with the most instantly satisfying visual — no buildup needed, hook them in 1 second",
        "Narrate what's happening with calm, almost ASMR-like pacing — describe textures, sounds, sensations",
        "Each scene should be a new type of satisfaction: visual symmetry, perfect cuts, smooth flows, impossible precision",
        "Build variety — alternate between cutting, pouring, rolling, pressing, peeling, aligning",
        "End with the most satisfying moment of all — the grand finale that makes viewers replay the video",
        "Keep narration minimal and smooth — let the visuals do 90% of the work",
      ],
      visualStyleGuide: [
        "HOOK: Extreme close-up of a razor-sharp blade slicing through a perfectly smooth block of colored kinetic sand, each layer revealed in a different pastel color, fine particles falling in slow motion — bright diffused studio lighting from above, macro lens detail showing every grain, clean white background, soft pastel color palette",
        "BUILD: Thick golden honey pouring in a perfect spiral from a dipper into a glass jar, the rope of honey folding over itself in flawless coils, light refracting through the amber liquid — warm golden backlight creating translucent glow through the honey, clean surface reflection, tight framing on the pour, everything in pristine slow-motion detail",
        "VARIETY: A row of identical glass marbles rolling down a perfectly crafted wooden track, splitting into channels, clicking together in sequence, each marble a different jewel color catching the light — bright clean studio lighting with soft shadows, polished surfaces reflecting everything, bird's eye view showing the perfect geometric path, satisfying symmetry",
        "PEAK: The ultimate oddly satisfying moment — a hydraulic press slowly flattening a perfectly round sphere into a flawless disc, or a cake being frosted in one impossibly smooth motion, or dominoes falling in a perfect spiral pattern — bright even lighting, extreme macro detail, slow motion capturing every millisecond of the transformation, clean minimal background",
        "FINALE: The completed result in perfect stillness — a row of perfectly aligned objects, a flawlessly organized color gradient, or a sculpture of sliced objects arranged in impossible precision — clean bright studio lighting, white or soft gradient background, maximum visual symmetry, the frame itself feels balanced and complete",
      ],
      moodKeywords: "oddly satisfying, ASMR visual, clean precision, smooth perfection, calm zen, slow motion beauty, tactile pleasure, the feeling of everything being exactly right",
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
