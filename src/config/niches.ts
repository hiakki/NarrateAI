export type AspectRatio = "9:16" | "16:9";

export interface Niche {
  id: string;
  name: string;
  icon: string;
  description: string;
  sampleTopics: string[];
  defaultTone: string;
  defaultArtStyle: string;
  defaultMusic: string;
  /** When set, videos in this niche use this aspect ratio (e.g. 16:9 for cinematic storytelling). Default 9:16. */
  aspectRatio?: AspectRatio;
  /** Max duration in seconds for this niche (e.g. 600 = 10 min for long-form). Default 120. */
  maxDuration?: number;
  /** Min duration in seconds for this niche. Default 15. */
  minDuration?: number;
}

export const NICHES: Niche[] = [
  {
    id: "scary-stories",
    name: "Scary Stories",
    icon: "👻",
    description: "Terrifying tales that keep viewers on the edge",
    sampleTopics: [
      "The haunted lighthouse keeper",
      "Voices from the basement",
      "The doll that moved at night",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "dark-cinematic",
    defaultMusic: "dramatic",
  },
  {
    id: "mythology",
    name: "Mythology",
    icon: "⚡",
    description: "Epic myths and legends from around the world",
    sampleTopics: [
      "The fall of Icarus",
      "Ragnarok - the twilight of the gods",
      "Medusa's curse and Perseus",
      "Pandora's box and what was left inside",
      "Orpheus and the journey to the underworld",
      "The labors of Hercules - the one that broke him",
      "Sisyphus and the boulder",
      "Narcissus and the pool",
      "Prometheus and the stolen fire",
      "The Trojan horse - what really happened that night",
      "Odysseus and the cyclops",
      "Echo and the curse of repetition",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "oil-painting",
    defaultMusic: "dramatic",
  },
  {
    id: "history",
    name: "History",
    icon: "📜",
    description: "Fascinating moments from history that changed the world",
    sampleTopics: [
      "The last day of Pompeii",
      "The mystery of the Bermuda Triangle",
      "The real story behind the Titanic",
    ],
    defaultTone: "educational",
    defaultArtStyle: "realistic",
    defaultMusic: "ambient",
  },
  {
    id: "true-crime",
    name: "True Crime",
    icon: "🔍",
    description: "Real criminal cases and unsolved mysteries",
    sampleTopics: [
      "The world's greatest unsolved heist",
      "The disappearance that baffled police",
      "A cold case cracked after 30 years",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "dark-cinematic",
    defaultMusic: "dramatic",
  },
  {
    id: "anime-recaps",
    name: "Anime Recaps",
    icon: "🎌",
    description: "Exciting anime story recaps and breakdowns",
    sampleTopics: [
      "The most overpowered anime villain",
      "A hero's sacrifice that shocked everyone",
      "The greatest anime plot twist ever",
    ],
    defaultTone: "casual",
    defaultArtStyle: "anime",
    defaultMusic: "upbeat",
  },
  {
    id: "life-hacks",
    name: "Life Hacks",
    icon: "💡",
    description: "Clever tips and tricks to make life easier",
    sampleTopics: [
      "5 phone tricks you didn't know existed",
      "How to save $500 this month",
      "Kitchen hacks that actually work",
    ],
    defaultTone: "casual",
    defaultArtStyle: "pixar-3d",
    defaultMusic: "upbeat",
  },
  {
    id: "motivation",
    name: "Motivation",
    icon: "🔥",
    description: "Inspiring stories and motivational content",
    sampleTopics: [
      "From homeless to billionaire",
      "The athlete who never gave up",
      "Why your failures are your superpower",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "realistic",
    defaultMusic: "dramatic",
  },
  {
    id: "science-facts",
    name: "Science Facts",
    icon: "🔬",
    description: "Mind-blowing science facts and discoveries",
    sampleTopics: [
      "What happens at the edge of the universe",
      "The parasite that controls minds",
      "Why time moves differently in space",
      "The creature that can survive in lava",
      "Why your brain deletes half of what you see",
      "The island that appears and disappears",
      "What happens inside a dying star",
      "The fish that walks on land",
      "Why some people hear colors",
      "The fungus that turns ants into zombies",
      "What we still don't know about sleep",
      "The deepest place on Earth and what lives there",
    ],
    defaultTone: "educational",
    defaultArtStyle: "realistic",
    defaultMusic: "ambient",
  },
  {
    id: "conspiracy-theories",
    name: "Conspiracy Theories",
    icon: "🕵️",
    description: "The most intriguing conspiracy theories explored",
    sampleTopics: [
      "The hidden city under Antarctica",
      "What the government won't tell you",
      "The simulation theory evidence",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "dark-cinematic",
    defaultMusic: "dramatic",
  },
  {
    id: "religious-epics",
    name: "Religious Epics",
    icon: "🙏",
    description: "Powerful sacred stories from every faith — Bible, Mahabharata, Quran, Buddhist tales",
    sampleTopics: [
      "David vs Goliath - the ultimate underdog",
      "Krishna's lesson to Arjuna on the battlefield",
      "The night journey of Prophet Muhammad",
      "Buddha's path to enlightenment",
      "Noah's ark and the great flood",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "oil-painting",
    defaultMusic: "dramatic",
  },
  {
    id: "what-if",
    name: "What If",
    icon: "🤔",
    description: "Mind-bending hypothetical scenarios that make you question reality",
    sampleTopics: [
      "What if gravity stopped for 5 seconds",
      "What if the sun disappeared right now",
      "What if humans could fly",
      "What if we could breathe underwater",
      "What if the internet vanished forever",
      "What if you could only tell the truth for 24 hours",
      "What if time ran backward for one day",
      "What if every lie you ever told came true",
      "What if animals could talk to humans",
      "What if you woke up with no memory",
      "What if money had no value tomorrow",
      "What if we discovered we're not alone tonight",
      "What if you could only use one sense for a week",
      "What if the moon suddenly got 10x closer",
      "What if plants could feel pain",
    ],
    defaultTone: "educational",
    defaultArtStyle: "realistic",
    defaultMusic: "dramatic",
  },
  {
    id: "dark-psychology",
    name: "Dark Psychology",
    icon: "🧠",
    description: "Hidden manipulation tactics, mind tricks, and the dark side of human behavior",
    sampleTopics: [
      "5 manipulation tricks narcissists use on you",
      "Why you always pick the middle option",
      "The psychology trick that makes people obey",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "dark-cinematic",
    defaultMusic: "dramatic",
  },
  {
    id: "space-cosmos",
    name: "Space & Cosmos",
    icon: "🌌",
    description: "The mind-blowing wonders of space, galaxies, and the universe",
    sampleTopics: [
      "What's inside a black hole",
      "The scariest planet in the universe",
      "Why we might be alone in the galaxy",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "realistic",
    defaultMusic: "dramatic",
  },
  {
    id: "animal-kingdom",
    name: "Animal Kingdom",
    icon: "🦁",
    description: "Incredible animal facts, behaviors, and nature's wildest moments",
    sampleTopics: [
      "The animal that can survive in space",
      "Why octopuses are smarter than you think",
      "The deadliest creature isn't what you think",
    ],
    defaultTone: "educational",
    defaultArtStyle: "realistic",
    defaultMusic: "ambient",
  },
  {
    id: "survival",
    name: "Survival",
    icon: "⚠️",
    description: "How to survive impossible situations and real disaster stories",
    sampleTopics: [
      "How to survive a plane crash",
      "The man who survived 76 days lost at sea",
      "What to do if you fall into quicksand",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "realistic",
    defaultMusic: "dramatic",
  },
  {
    id: "money-wealth",
    name: "Money & Wealth",
    icon: "💎",
    description: "How the rich think, wealth secrets, and the psychology of money",
    sampleTopics: [
      "How billionaires actually spend their day",
      "The $1 rule that changed my finances",
      "Why rich people never work for money",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "realistic",
    defaultMusic: "dramatic",
  },
  {
    id: "funny-stories",
    name: "Funny Stories",
    icon: "😂",
    description: "Hilarious jokes, dad jokes, and comedy sketches that make viewers laugh",
    sampleTopics: [
      "The worst dad joke that actually landed",
      "When autocorrect ruined someone's life",
      "The job interview that went hilariously wrong",
    ],
    defaultTone: "funny",
    defaultArtStyle: "pixar-3d",
    defaultMusic: "upbeat",
  },
  {
    id: "zero-to-hero",
    name: "Zero to Hero",
    icon: "🚀",
    description: "Underdog stories of people who turned rock bottom into greatness",
    sampleTopics: [
      "Sleeping in his car to owning the company",
      "Rejected 300 times then became a legend",
      "From village nobody to global icon",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "realistic",
    defaultMusic: "dramatic",
  },
  {
    id: "character-storytelling",
    name: "Character Storytelling",
    icon: "🎬",
    description: "Character-centric narratives with emotional hooks, drama, and BGM. Cinematic 16:9 format; story length is flexible (30s to 10 min). Best with a recurring character (Star mode).",
    sampleTopics: [
      "A lone warrior's last stand at the gate",
      "The moment she chose to walk away",
      "The letter that changed everything",
      "Two strangers on a train",
      "The day the silence broke",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "realistic",
    defaultMusic: "dramatic",
    aspectRatio: "16:9",
    minDuration: 30,
    maxDuration: 600,
  },
  {
    id: "satisfying",
    name: "Satisfying",
    icon: "✨",
    description: "Oddly satisfying visuals — cutting, slicing, pouring, perfect fits",
    sampleTopics: [
      "Perfectly cut soap and wax melting",
      "Glass marbles rolling down impossible tracks",
      "Hydraulic press crushing random objects",
    ],
    defaultTone: "casual",
    defaultArtStyle: "realistic",
    defaultMusic: "ambient",
  },
];

export function getNicheById(id: string): Niche | undefined {
  return NICHES.find((n) => n.id === id);
}

export function getDurationRangeForNiche(nicheId: string): { min: number; max: number } {
  const niche = getNicheById(nicheId);
  return {
    min: niche?.minDuration ?? 15,
    max: niche?.maxDuration ?? 120,
  };
}
