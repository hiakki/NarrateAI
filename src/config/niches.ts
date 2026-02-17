export interface Niche {
  id: string;
  name: string;
  icon: string;
  description: string;
  sampleTopics: string[];
  defaultTone: string;
  defaultArtStyle: string;
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
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "oil-painting",
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
    ],
    defaultTone: "educational",
    defaultArtStyle: "realistic",
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
  },
  {
    id: "biblical-stories",
    name: "Biblical Stories",
    icon: "📖",
    description: "Powerful stories from the Bible brought to life",
    sampleTopics: [
      "David vs Goliath - the ultimate underdog",
      "Noah's ark and the great flood",
      "The plagues of Egypt",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "oil-painting",
  },
  {
    id: "urban-legends",
    name: "Urban Legends",
    icon: "🌃",
    description: "Chilling urban legends and modern folklore",
    sampleTopics: [
      "The hitchhiker who vanished",
      "Bloody Mary - truth behind the mirror",
      "The cursed room no one can enter",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "dark-cinematic",
  },
  {
    id: "heists",
    name: "Heists",
    icon: "💰",
    description: "The most daring heists and robberies in history",
    sampleTopics: [
      "The $100 million diamond heist",
      "How they broke into the world's safest vault",
      "The bank robber who became a legend",
    ],
    defaultTone: "dramatic",
    defaultArtStyle: "comic-book",
  },
];

export function getNicheById(id: string): Niche | undefined {
  return NICHES.find((n) => n.id === id);
}
