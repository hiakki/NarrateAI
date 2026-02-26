// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function extractHook(scriptText?: string): string {
  if (!scriptText) return "";
  const first = scriptText.split(/[.!?]/)[0]?.trim() ?? "";
  return first.slice(0, 150);
}

// ---------------------------------------------------------------------------
// Per-niche configuration
// ---------------------------------------------------------------------------

interface NicheConfig {
  tags: string[];
  hashtags: string[];
  categoryId: string;
  ctas: string[];
  ytHooks: string[];
  igHooks: string[];
  fbHooks: string[];
  engagements: string[];
}

const NICHE_SEO: Record<string, NicheConfig> = {
  "scary-stories": {
    tags: ["scary stories", "horror stories", "creepy", "scary story animated", "horror", "creepypasta", "true scary stories", "scary story time", "ghost stories"],
    hashtags: ["#ScaryStories", "#Horror", "#Creepy", "#Creepypasta", "#HorrorStory", "#GhostStories"],
    categoryId: "24",
    ctas: [
      "More stories like this every week",
      "Follow for stories that'll keep you up at night",
      "Stick around if you love the creepy stuff",
      "New horror stories dropping regularly",
    ],
    ytHooks: ["Wait for the ending...", "This one gave me chills", "True story btw", "I still can't believe this happened"],
    igHooks: ["this one's different.", "you've been warned.", "true story.", "don't watch this alone."],
    fbHooks: ["Okay this one actually scared me", "Someone tell me this isn't real", "Goosebumps the entire time", "How is no one talking about this"],
    engagements: ["Has anything like this happened to you?", "What would you do?", "Scariest thing you've ever experienced?", "Rate this story 1-10"],
  },
  mythology: {
    tags: ["mythology", "greek mythology", "myths", "mythology explained", "ancient myths", "gods and legends", "norse mythology", "mythology stories"],
    hashtags: ["#Mythology", "#GreekMythology", "#Myths", "#AncientHistory", "#GodsAndLegends", "#NorseMythology"],
    categoryId: "27",
    ctas: [
      "More mythology every week",
      "Follow for stories of gods and legends",
      "The ancient world is fascinating",
      "Which myth should I cover next?",
    ],
    ytHooks: ["Most people get this myth wrong", "This changes everything we thought we knew", "The original story is way darker", "They don't teach this in school"],
    igHooks: ["the real story is wild.", "this myth hits different.", "bet you didn't know this.", "ancient stories > modern fiction."],
    fbHooks: ["The original myth is so much better than the movie version", "Why don't they teach this in school?", "This is the story that started it all"],
    engagements: ["Which mythology is your favorite?", "Did you know this?", "What myth should I do next?", "Greek or Norse?"],
  },
  history: {
    tags: ["history", "history facts", "historical events", "history explained", "world history", "fascinating history", "did you know history"],
    hashtags: ["#History", "#HistoryFacts", "#WorldHistory", "#DidYouKnow", "#HistoricalEvents"],
    categoryId: "27",
    ctas: [
      "Follow for more history you won't find in textbooks",
      "History is crazier than fiction",
      "More stories from history coming soon",
      "The past is wild, follow along",
    ],
    ytHooks: ["Your history teacher never told you this", "This actually happened", "Nobody talks about this event", "History is stranger than fiction"],
    igHooks: ["they left this out of the textbooks.", "this actually happened.", "history is insane.", "the real story is even crazier."],
    fbHooks: ["Why did nobody ever tell me about this?", "History class would've been way better with stories like this", "This is the kind of stuff they skip over"],
    engagements: ["Did your school teach you this?", "What's the craziest historical fact you know?", "Which era fascinates you the most?"],
  },
  "true-crime": {
    tags: ["true crime", "true crime stories", "unsolved mysteries", "crime documentary", "cold case", "criminal investigation", "mystery"],
    hashtags: ["#TrueCrime", "#UnsolvedMysteries", "#ColdCase", "#CrimeStory", "#Mystery"],
    categoryId: "25",
    ctas: [
      "Follow for more cases like this",
      "New cases every week",
      "Some of these are still unsolved",
      "The truth is always stranger",
    ],
    ytHooks: ["This case was never solved", "The details of this case are unbelievable", "Everything about this seems off", "They almost got away with it"],
    igHooks: ["this case still haunts me.", "still unsolved.", "the details are unreal.", "justice was never served."],
    fbHooks: ["How is this case still unsolved?", "The more you look into this, the worse it gets", "Someone knows something"],
    engagements: ["What do you think happened?", "Could this ever be solved?", "Drop your theory below", "Have you heard of this case before?"],
  },
  "anime-recaps": {
    tags: ["anime", "anime recap", "anime explained", "anime story", "manga", "anime moments", "best anime"],
    hashtags: ["#Anime", "#AnimeRecap", "#AnimeMoments", "#Manga", "#AnimeEdit"],
    categoryId: "24",
    ctas: [
      "Follow for more anime content",
      "More recaps coming soon",
      "Which anime should I cover next?",
      "Anime hits different",
    ],
    ytHooks: ["This scene changed everything", "If you haven't watched this yet, you're missing out", "Top tier anime right here", "This arc was peak fiction"],
    igHooks: ["peak fiction.", "this scene broke me.", "anime fans know.", "goated anime fr."],
    fbHooks: ["This anime doesn't get enough credit", "If you know, you know", "This arc was something else"],
    engagements: ["What's your top anime?", "Rate this anime 1-10", "Sub or dub?", "Most underrated anime?"],
  },
  "life-hacks": {
    tags: ["life hacks", "tips and tricks", "hacks", "useful hacks", "smart hacks", "diy", "how to", "life tips"],
    hashtags: ["#LifeHacks", "#TipsAndTricks", "#Hacks", "#DIY", "#HowTo"],
    categoryId: "26",
    ctas: [
      "Follow for more tips like this",
      "Save this for later",
      "You'll thank me later",
      "More hacks coming soon",
    ],
    ytHooks: ["I wish I knew this sooner", "This saves so much time", "Try this today", "Game changer"],
    igHooks: ["save this.", "you're welcome.", "why didn't I know this sooner.", "game changer."],
    fbHooks: ["Why did nobody tell me this before?", "Tried this and it actually works", "This is genuinely useful"],
    engagements: ["Did this work for you?", "What hack changed your life?", "Tag someone who needs this", "Save this for later!"],
  },
  motivation: {
    tags: ["motivation", "motivational", "success stories", "inspiring", "never give up", "inspiration", "mindset"],
    hashtags: ["#Motivation", "#Inspiring", "#NeverGiveUp", "#SuccessStory", "#Mindset"],
    categoryId: "22",
    ctas: [
      "Follow if you need this today",
      "Keep going, you got this",
      "More motivation dropping soon",
      "Share this with someone who needs it",
    ],
    ytHooks: ["Remember this when you want to quit", "This is your sign", "Most people give up right before the breakthrough", "Read that again"],
    igHooks: ["you needed to hear this.", "keep going.", "this is your sign.", "read that again."],
    fbHooks: ["Share this with someone who needs to hear it today", "Sometimes you just need a reminder", "This hit different today"],
    engagements: ["What keeps you going?", "Tag someone who needs this", "What's your biggest goal right now?"],
  },
  "science-facts": {
    tags: ["science", "science facts", "science explained", "mind blowing facts", "space", "universe", "physics", "did you know"],
    hashtags: ["#Science", "#ScienceFacts", "#Space", "#MindBlowing", "#DidYouKnow"],
    categoryId: "28",
    ctas: [
      "Follow for more mind-blowing facts",
      "Science is wild",
      "More facts coming soon",
      "Your brain just grew a little",
    ],
    ytHooks: ["This will blow your mind", "Science is stranger than fiction", "I can't stop thinking about this", "Wait till you hear the explanation"],
    igHooks: ["your mind is about to be blown.", "science is wild.", "bet you didn't know this.", "this is actually insane."],
    fbHooks: ["How is this even real?", "I had to look this up to believe it", "The universe is insane"],
    engagements: ["Did you know this?", "What's the wildest fact you know?", "Mind blown or already knew?"],
  },
  "conspiracy-theories": {
    tags: ["conspiracy theories", "conspiracy", "hidden truth", "mystery", "unexplained", "secrets", "cover up"],
    hashtags: ["#Conspiracy", "#HiddenTruth", "#Mystery", "#Unexplained", "#Secrets"],
    categoryId: "24",
    ctas: [
      "Follow to stay woke",
      "More rabbit holes coming soon",
      "What do you think is really going on?",
      "The truth is out there",
    ],
    ytHooks: ["They don't want you to know this", "Look into this yourself", "This never made the news", "Connect the dots"],
    igHooks: ["do your own research.", "this doesn't add up.", "they don't want you to see this.", "think about it."],
    fbHooks: ["Something doesn't add up here", "Why is nobody talking about this?", "Look into this and tell me I'm wrong"],
    engagements: ["Do you believe this?", "What's the craziest conspiracy you believe?", "Thoughts?", "Real or fake?"],
  },
  "biblical-stories": {
    tags: ["bible stories", "biblical", "bible", "faith", "bible stories animated", "christian stories", "bible explained"],
    hashtags: ["#Bible", "#BibleStories", "#Faith", "#Christian", "#Biblical", "#Scripture"],
    categoryId: "27",
    ctas: [
      "Follow for more scripture stories",
      "More Bible stories every week",
      "Amen if this blessed you",
      "Share the word",
    ],
    ytHooks: ["This story always hits different", "The message here is powerful", "Most people miss the deeper meaning", "This changed my perspective"],
    igHooks: ["amen.", "this story hits different.", "share this.", "the message is powerful."],
    fbHooks: ["This story never gets old", "Share this with someone who needs encouragement today", "The Bible is full of incredible stories like this"],
    engagements: ["What's your favorite Bible story?", "Type Amen if this spoke to you", "Which story should I cover next?"],
  },
  "urban-legends": {
    tags: ["urban legends", "creepy stories", "folklore", "scary", "urban myths", "modern legends", "chilling tales"],
    hashtags: ["#UrbanLegends", "#Creepy", "#Folklore", "#ScaryStories", "#UrbanMyths"],
    categoryId: "24",
    ctas: [
      "Follow for more legends like this",
      "More urban legends coming soon",
      "Every legend has some truth in it",
      "Sweet dreams tonight",
    ],
    ytHooks: ["Every town has a story like this", "This legend might actually be true", "People still report sightings", "The origin of this legend is terrifying"],
    igHooks: ["this legend is real.", "every town has one.", "sweet dreams.", "the origin story is terrifying."],
    fbHooks: ["Does your town have a legend like this?", "Some of these legends are based on true events", "This one always creeped me out"],
    engagements: ["What urban legend is from your area?", "Do you think there's truth to this?", "Ever experienced anything like this?"],
  },
  heists: {
    tags: ["heist", "heist stories", "robbery", "biggest heists", "bank robbery", "crime stories", "thief", "daring heist"],
    hashtags: ["#Heist", "#Robbery", "#CrimeStory", "#BiggestHeists", "#BankRobbery"],
    categoryId: "24",
    ctas: [
      "Follow for more insane heist stories",
      "More heists coming soon",
      "Some people are too smart for their own good",
      "You can't make this stuff up",
    ],
    ytHooks: ["They almost got away with it", "The plan was actually genius", "This is the biggest heist in history", "Nobody saw it coming"],
    igHooks: ["genius plan.", "they almost got away.", "this is insane.", "biggest heist ever."],
    fbHooks: ["How did they almost pull this off?", "The plan was actually brilliant", "This reads like a movie script but it's real"],
    engagements: ["Could you pull this off?", "Movie-worthy or what?", "What's the craziest heist you've heard of?"],
  },
};

const FALLBACK: NicheConfig = {
  tags: ["shorts", "viral", "trending", "story time"],
  hashtags: ["#Shorts", "#Viral", "#Trending", "#StoryTime"],
  categoryId: "22",
  ctas: ["Follow for more content like this", "More coming soon", "Stick around", "New videos every week"],
  ytHooks: ["You need to see this", "Wait for it", "This is wild", "Didn't expect that"],
  igHooks: ["wait for it.", "this is wild.", "had to share this.", "thoughts?"],
  fbHooks: ["Had to share this one", "This is actually wild", "Didn't expect that ending"],
  engagements: ["What do you think?", "Thoughts?", "Let me know below", "Did you see that coming?"],
};

// ---------------------------------------------------------------------------
// YouTube SEO
// ---------------------------------------------------------------------------

export interface VideoSEO {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
}

export function generateVideoSEO(
  originalTitle: string,
  niche: string,
  scriptText?: string,
  includeAiTags = true,
  previousVideoUrl?: string,
): VideoSEO {
  const cfg = NICHE_SEO[niche] ?? FALLBACK;

  // YouTube auto-detects Shorts from aspect ratio — only add #Shorts ~40% of the time
  // Real creators don't always tag it
  const title = originalTitle.includes("#Shorts")
    ? originalTitle
    : Math.random() < 0.4
      ? `${originalTitle} #Shorts`
      : originalTitle;

  const hook = extractHook(scriptText);
  const ytHook = pick(cfg.ytHooks);
  const cta = pick(cfg.ctas);
  const engagement = pick(cfg.engagements);

  // Natural hashtags: 3-5 niche tags + 1-2 generic, not a wall of them
  const nicheHashtags = pickN(cfg.hashtags, Math.floor(Math.random() * 2) + 2);
  const genericHashtags = pickN(["#Shorts", "#Viral", "#FYP"], 1);
  const hashtagLine = [...nicheHashtags, ...genericHashtags].join(" ");

  // Build description like a real creator would
  const desc: string[] = [];

  // Opening — vary between hook from script, YT hook, or just the title
  const openers = [
    hook ? `${ytHook}\n\n${hook}...` : ytHook,
    hook ? hook + "..." : originalTitle,
    ytHook,
  ];
  desc.push(pick(openers));

  desc.push("");

  // Engagement question (real creators always ask something)
  desc.push(engagement);

  // CTA — casual, not "SUBSCRIBE NOW!!!"
  desc.push("");
  desc.push(cta);

  // Previous video link
  if (previousVideoUrl) {
    desc.push("");
    desc.push(pick([
      `Previous part: ${previousVideoUrl}`,
      `Watch part 1: ${previousVideoUrl}`,
      `Missed the last one? ${previousVideoUrl}`,
      `Catch up here: ${previousVideoUrl}`,
    ]));
  }

  // Hashtags at the end, kept minimal
  desc.push("");
  desc.push(hashtagLine);

  if (includeAiTags) {
    desc.push("", "Made with AI");
  }

  // Tags: pick a random subset instead of dumping everything
  const nicheTags = pickN(cfg.tags, Math.floor(Math.random() * 3) + 4);
  const titleWords = originalTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const allTags = [...nicheTags, ...pickN(titleWords, 3), "shorts", "story time"];
  if (includeAiTags) allTags.push("ai generated");
  const uniqueTags = [...new Set(allTags)].slice(0, 15);

  return {
    title: title.slice(0, 100),
    description: desc.join("\n").slice(0, 5000),
    tags: uniqueTags,
    categoryId: cfg.categoryId,
  };
}

// ---------------------------------------------------------------------------
// Instagram Reels
// ---------------------------------------------------------------------------

export function generateInstagramCaption(
  originalTitle: string,
  niche: string,
  scriptText?: string,
  _includeAiTags = true,
): string {
  const cfg = NICHE_SEO[niche] ?? FALLBACK;

  const hook = extractHook(scriptText);
  const igHook = pick(cfg.igHooks);
  const engagement = pick(cfg.engagements);
  const cta = pick(cfg.ctas);

  // IG captions are short and punchy — real creators keep it casual
  const parts: string[] = [];

  // Opening line — lowercase, no caps-lock energy
  const openers = [
    hook ? `${igHook}\n\n${hook}...` : igHook,
    hook ? hook + "..." : originalTitle.toLowerCase(),
    igHook,
  ];
  parts.push(pick(openers));

  parts.push("");

  // Engagement — pick one style randomly
  const engagementStyles = [
    engagement,
    `${engagement} 👇`,
    `💬 ${engagement}`,
  ];
  parts.push(pick(engagementStyles));

  // CTA — subtle
  parts.push("");
  parts.push(cta);

  // Hashtags: IG allows more but overdoing it looks spammy
  // 5-8 hashtags is the sweet spot for reach
  const nicheHashtags = pickN(cfg.hashtags, Math.floor(Math.random() * 2) + 3);
  const genericIg = pickN(["#Reels", "#Viral", "#FYP", "#Explore", "#ReelsViral"], 2);
  const allHashtags = [...nicheHashtags, ...genericIg];

  // Dot separator like real IG creators use
  parts.push("");
  parts.push(".");
  parts.push(".");
  parts.push(allHashtags.join(" "));

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Facebook Reels
// ---------------------------------------------------------------------------

export function generateFacebookCaption(
  originalTitle: string,
  niche: string,
  scriptText?: string,
  _includeAiTags = true,
): string {
  const cfg = NICHE_SEO[niche] ?? FALLBACK;

  const hook = extractHook(scriptText);
  const fbHook = pick(cfg.fbHooks);
  const engagement = pick(cfg.engagements);

  // FB captions are conversational — like posting to friends
  const parts: string[] = [];

  // Opening — conversational, like you're talking to someone
  const openers = [
    fbHook,
    hook ? `${hook}...` : originalTitle,
    hook ? `${fbHook}\n\n${hook}...` : fbHook,
  ];
  parts.push(pick(openers));

  parts.push("");
  parts.push(engagement);

  // FB hashtags: 3-5 max, FB penalizes hashtag spam
  const fbHashtags = pickN(cfg.hashtags, Math.floor(Math.random() * 2) + 2);
  parts.push("");
  parts.push(fbHashtags.join(" "));

  return parts.join("\n");
}
