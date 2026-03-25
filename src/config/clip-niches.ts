export interface ClipNicheMeta {
  label: string;
  icon: string;
  description: string;
  bestTimesUTC: string[];
  bestPlatforms: string[];
  cluster: string;
}

export const CLIP_NICHE_META: Record<string, ClipNicheMeta> = {
  "viral-repost": { label: "Viral Repost (Non-Copyrighted)", icon: "🔥", description: "Creators who allow free reposting — MrBeast, Mark Rober, etc.", bestTimesUTC: ["17:00", "18:00", "19:00"], bestPlatforms: ["YOUTUBE", "INSTAGRAM", "FACEBOOK"], cluster: "general" },
  films:          { label: "Films & Movies", icon: "🎬", description: "Movie scenes, trailers, iconic moments", bestTimesUTC: ["19:00", "20:00"], bestPlatforms: ["YOUTUBE", "FACEBOOK", "INSTAGRAM"], cluster: "narrative" },
  anime:          { label: "Anime", icon: "⚔️", description: "Anime clips, fights, emotional scenes, AMVs", bestTimesUTC: ["21:00", "22:00"], bestPlatforms: ["YOUTUBE", "FACEBOOK", "INSTAGRAM"], cluster: "narrative" },
  serials:        { label: "TV Serials & Shows", icon: "📺", description: "TV show clips, drama scenes, sitcom moments", bestTimesUTC: ["19:00", "20:00"], bestPlatforms: ["YOUTUBE", "FACEBOOK", "INSTAGRAM"], cluster: "narrative" },
  entertainment:  { label: "Entertainment", icon: "🎭", description: "Stunts, challenges, pranks, viral moments", bestTimesUTC: ["17:00", "18:00", "19:00"], bestPlatforms: ["YOUTUBE", "INSTAGRAM", "FACEBOOK"], cluster: "general" },
  nature:         { label: "Nature & Animals", icon: "🌿", description: "Wildlife, ocean, nature documentaries", bestTimesUTC: ["11:00", "12:00", "17:00"], bestPlatforms: ["YOUTUBE", "FACEBOOK", "INSTAGRAM"], cluster: "visual" },
  science:        { label: "Science & Tech", icon: "🔬", description: "Space, physics, engineering, experiments", bestTimesUTC: ["11:00", "12:00", "18:00"], bestPlatforms: ["YOUTUBE", "FACEBOOK", "INSTAGRAM"], cluster: "narrative" },
  sports:         { label: "Sports & Fitness", icon: "⚽", description: "Highlights, extreme sports, athletics", bestTimesUTC: ["14:00", "15:00", "20:00"], bestPlatforms: ["YOUTUBE", "INSTAGRAM", "FACEBOOK"], cluster: "action" },
  gaming:         { label: "Gaming", icon: "🎮", description: "Game clips, esports, speedruns", bestTimesUTC: ["21:00", "22:00"], bestPlatforms: ["YOUTUBE", "FACEBOOK", "INSTAGRAM"], cluster: "narrative" },
  food:           { label: "Food & Cooking", icon: "🍳", description: "Recipes, food challenges, street food", bestTimesUTC: ["11:00", "12:00", "18:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "visual" },
  travel:         { label: "Travel & Adventure", icon: "✈️", description: "Destinations, culture, exploration", bestTimesUTC: ["11:00", "12:00", "17:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "visual" },
  news:           { label: "News & Current Events", icon: "📰", description: "Breaking news, analysis, documentaries", bestTimesUTC: ["08:00", "12:00", "18:00"], bestPlatforms: ["YOUTUBE", "FACEBOOK", "INSTAGRAM"], cluster: "news" },
  education:      { label: "Education", icon: "📚", description: "Explainers, how-to, history, tutorials", bestTimesUTC: ["06:00", "07:00", "12:00"], bestPlatforms: ["YOUTUBE", "FACEBOOK", "INSTAGRAM"], cluster: "morning" },
  motivation:     { label: "Motivation & Self-Help", icon: "💪", description: "Speeches, success stories, productivity", bestTimesUTC: ["06:00", "07:00", "08:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "morning" },
  comedy:         { label: "Comedy & Memes", icon: "😂", description: "Stand-up, sketches, internet humor", bestTimesUTC: ["17:00", "18:00", "19:00"], bestPlatforms: ["YOUTUBE", "INSTAGRAM", "FACEBOOK"], cluster: "general" },
  music:          { label: "Music & Dance", icon: "🎵", description: "Performances, covers, dance trends", bestTimesUTC: ["17:00", "18:00", "19:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "general" },
  satisfying:     { label: "Satisfying & ASMR", icon: "🫧", description: "Oddly satisfying clips — soap cutting, kinetic sand, slime, hydraulic press", bestTimesUTC: ["17:00", "18:00", "19:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "visual" },
  fails:          { label: "Fails & Unexpected", icon: "🤯", description: "Funny fails, unexpected moments, caught on camera", bestTimesUTC: ["17:00", "18:00", "19:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "general" },
  animals:        { label: "Animals & Pets", icon: "🐾", description: "Cute and funny animal moments, pet compilations", bestTimesUTC: ["17:00", "18:00", "19:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "visual" },
  "food-viral":   { label: "Food Viral", icon: "🍜", description: "Street food processes, satisfying cooking, food art", bestTimesUTC: ["11:00", "12:00", "18:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "visual" },
  luxury:         { label: "Luxury & Supercars", icon: "🏎️", description: "Exotic cars, mansions, luxury lifestyle, aspirational", bestTimesUTC: ["11:00", "12:00", "19:00"], bestPlatforms: ["YOUTUBE", "INSTAGRAM", "FACEBOOK"], cluster: "visual" },
  extreme:        { label: "Extreme Sports & Stunts", icon: "🪂", description: "Parkour, GoPro moments, adrenaline stunts, daredevils", bestTimesUTC: ["14:00", "15:00", "20:00"], bestPlatforms: ["YOUTUBE", "INSTAGRAM", "FACEBOOK"], cluster: "action" },
  diy:            { label: "DIY & Life Hacks", icon: "🔧", description: "Crafts, life hacks, restoration, build projects, 5-minute fixes", bestTimesUTC: ["06:00", "07:00", "12:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "morning" },
  wholesome:      { label: "Wholesome & Feel-Good", icon: "🥹", description: "Heartwarming reunions, acts of kindness, surprise reactions, emotional moments", bestTimesUTC: ["17:00", "18:00", "19:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "visual" },
  scary:          { label: "Scary & Paranormal", icon: "👻", description: "Creepy caught on camera, trail cam footage, ghost sightings, unsolved mysteries", bestTimesUTC: ["21:00", "22:00", "23:00"], bestPlatforms: ["YOUTUBE", "FACEBOOK", "INSTAGRAM"], cluster: "nightowl" },
  prank:          { label: "Pranks", icon: "🎃", description: "Prank compilations, hidden camera, social experiments, public reactions", bestTimesUTC: ["17:00", "18:00", "19:00"], bestPlatforms: ["INSTAGRAM", "YOUTUBE", "FACEBOOK"], cluster: "general" },
  auto:           { label: "Auto (All Niches)", icon: "🔄", description: "Mix from all trending content", bestTimesUTC: ["17:00", "18:00", "19:00"], bestPlatforms: ["YOUTUBE", "INSTAGRAM", "FACEBOOK"], cluster: "general" },
};

export function computeViewPrediction(
  avgViews: number,
  avgScore: number,
): { estimatedViews: { low: number; mid: number; high: number }; confidence: { low: number; mid: number; high: number } } {
  const viralityCoeff = Math.max(0.3, Math.min(2.0, avgScore / 60));
  return {
    estimatedViews: {
      low: Math.round(avgViews * 0.003 * viralityCoeff),
      mid: Math.round(avgViews * 0.01 * viralityCoeff),
      high: Math.round(avgViews * 0.03 * viralityCoeff),
    },
    confidence: { low: 80, mid: 50, high: 15 },
  };
}
