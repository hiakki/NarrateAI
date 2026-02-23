const NICHE_SEO: Record<string, {
  tags: string[];
  hashtags: string[];
  categoryId: string;
  cta: string;
}> = {
  "scary-stories": {
    tags: ["scary stories", "horror stories", "creepy", "scary story animated", "horror", "creepypasta", "true scary stories", "scary story time", "scary facts", "nightmare fuel", "ghost stories"],
    hashtags: ["#ScaryStories", "#Horror", "#Creepy", "#Creepypasta", "#ScaryFacts", "#HorrorStory", "#GhostStories", "#NightmareFuel"],
    categoryId: "24",
    cta: "Subscribe for more terrifying stories that will keep you up at night!",
  },
  mythology: {
    tags: ["mythology", "greek mythology", "myths", "mythology explained", "ancient myths", "gods and legends", "norse mythology", "mythology stories", "epic tales", "legends"],
    hashtags: ["#Mythology", "#GreekMythology", "#Myths", "#AncientHistory", "#GodsAndLegends", "#NorseMythology", "#EpicTales"],
    categoryId: "27",
    cta: "Subscribe for epic mythology stories from around the world!",
  },
  history: {
    tags: ["history", "history facts", "historical events", "history explained", "world history", "fascinating history", "history documentary", "did you know history", "history shorts"],
    hashtags: ["#History", "#HistoryFacts", "#WorldHistory", "#DidYouKnow", "#HistoricalEvents", "#LearnHistory"],
    categoryId: "27",
    cta: "Subscribe to discover the most fascinating moments in history!",
  },
  "true-crime": {
    tags: ["true crime", "true crime stories", "unsolved mysteries", "crime documentary", "cold case", "criminal investigation", "true crime shorts", "mystery"],
    hashtags: ["#TrueCrime", "#UnsolvedMysteries", "#ColdCase", "#CrimeStory", "#Mystery", "#CriminalCase"],
    categoryId: "25",
    cta: "Subscribe for gripping true crime stories and unsolved mysteries!",
  },
  "anime-recaps": {
    tags: ["anime", "anime recap", "anime explained", "anime shorts", "anime story", "manga", "anime moments", "best anime", "anime edit"],
    hashtags: ["#Anime", "#AnimeRecap", "#AnimeMoments", "#Manga", "#AnimeEdit", "#AnimeShorts", "#Otaku"],
    categoryId: "24",
    cta: "Subscribe for the best anime recaps and epic moments!",
  },
  "life-hacks": {
    tags: ["life hacks", "tips and tricks", "hacks", "useful hacks", "smart hacks", "diy", "how to", "life tips", "productivity"],
    hashtags: ["#LifeHacks", "#TipsAndTricks", "#Hacks", "#DIY", "#HowTo", "#SmartHacks", "#Productivity"],
    categoryId: "26",
    cta: "Subscribe for clever hacks that make life easier!",
  },
  motivation: {
    tags: ["motivation", "motivational", "success stories", "inspiring", "never give up", "motivational speech", "inspiration", "mindset", "grindset", "hustle"],
    hashtags: ["#Motivation", "#Inspiring", "#NeverGiveUp", "#SuccessStory", "#Mindset", "#Grindset", "#Hustle"],
    categoryId: "22",
    cta: "Subscribe for daily motivation and inspiring stories!",
  },
  "science-facts": {
    tags: ["science", "science facts", "science explained", "mind blowing facts", "space", "universe", "physics", "did you know", "education"],
    hashtags: ["#Science", "#ScienceFacts", "#Space", "#MindBlowing", "#DidYouKnow", "#Physics", "#Universe"],
    categoryId: "28",
    cta: "Subscribe for mind-blowing science facts and discoveries!",
  },
  "conspiracy-theories": {
    tags: ["conspiracy theories", "conspiracy", "hidden truth", "mystery", "unexplained", "secrets", "cover up", "what they hide"],
    hashtags: ["#Conspiracy", "#HiddenTruth", "#Mystery", "#Unexplained", "#Secrets", "#MindBlown"],
    categoryId: "24",
    cta: "Subscribe to uncover the truth they don't want you to know!",
  },
  "biblical-stories": {
    tags: ["bible stories", "biblical", "bible", "faith", "bible stories animated", "christian stories", "bible explained", "old testament", "new testament"],
    hashtags: ["#Bible", "#BibleStories", "#Faith", "#Christian", "#Biblical", "#OldTestament", "#Scripture"],
    categoryId: "27",
    cta: "Subscribe for powerful Bible stories brought to life!",
  },
  "urban-legends": {
    tags: ["urban legends", "creepy stories", "folklore", "scary", "urban myths", "modern legends", "horror stories", "chilling tales"],
    hashtags: ["#UrbanLegends", "#Creepy", "#Folklore", "#ScaryStories", "#UrbanMyths", "#ChillingTales"],
    categoryId: "24",
    cta: "Subscribe for the most chilling urban legends and folklore!",
  },
  heists: {
    tags: ["heist", "heist stories", "robbery", "biggest heists", "bank robbery", "diamond heist", "crime stories", "thief", "daring heist"],
    hashtags: ["#Heist", "#Robbery", "#CrimeStory", "#BiggestHeists", "#BankRobbery", "#DaringHeist"],
    categoryId: "24",
    cta: "Subscribe for the most daring heist stories ever told!",
  },
};

const FALLBACK_SEO = {
  tags: ["shorts", "viral", "trending", "story time", "ai generated", "faceless channel"],
  hashtags: ["#Shorts", "#Viral", "#Trending", "#StoryTime"],
  categoryId: "22",
  cta: "Subscribe for more amazing content!",
};

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
): VideoSEO {
  const seo = NICHE_SEO[niche] ?? FALLBACK_SEO;

  const title = originalTitle.includes("#Shorts")
    ? originalTitle
    : `${originalTitle} #Shorts`;

  const hashtagLine = [...seo.hashtags, "#Shorts", "#Viral", "#FYP"]
    .slice(0, 15)
    .join(" ");

  const hook = scriptText
    ? scriptText.split(/[.!?]/)[0]?.trim().slice(0, 150)
    : "";

  const descriptionParts = [
    hook ? `${hook}...` : originalTitle,
    "",
    seo.cta,
    "",
    hashtagLine,
    "",
    "---",
    "Made with AI | NarrateAI",
  ];

  const tags = [
    ...seo.tags,
    "shorts",
    "viral",
    "trending",
    "fyp",
    "ai generated",
    "story time",
    ...originalTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3),
  ];
  const uniqueTags = [...new Set(tags)].slice(0, 30);

  return {
    title,
    description: descriptionParts.join("\n"),
    tags: uniqueTags,
    categoryId: seo.categoryId,
  };
}

export function generateSocialCaption(
  originalTitle: string,
  niche: string,
  scriptText?: string,
): string {
  const seo = NICHE_SEO[niche] ?? FALLBACK_SEO;

  const hook = scriptText
    ? scriptText.split(/[.!?]/)[0]?.trim().slice(0, 120)
    : "";

  const hashtags = [...seo.hashtags, "#Shorts", "#Viral", "#FYP", "#Reels"]
    .slice(0, 12)
    .join(" ");

  const parts = [
    hook ? `${hook}...` : originalTitle,
    "",
    seo.cta,
    "",
    hashtags,
  ];

  return parts.join("\n");
}
