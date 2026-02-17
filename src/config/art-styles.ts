export interface ArtStyle {
  id: string;
  name: string;
  description: string;
  promptModifier: string;
}

export const ART_STYLES: ArtStyle[] = [
  {
    id: "realistic",
    name: "Realistic",
    description: "Photorealistic, cinematic look",
    promptModifier: "photorealistic, cinematic lighting, highly detailed, 8k",
  },
  {
    id: "anime",
    name: "Anime",
    description: "Japanese animation style",
    promptModifier: "anime style, vibrant colors, detailed anime art, studio ghibli inspired",
  },
  {
    id: "pixar-3d",
    name: "Pixar 3D",
    description: "Pixar-like 3D rendered characters",
    promptModifier: "pixar 3D animation style, cute characters, smooth rendering, vibrant",
  },
  {
    id: "watercolor",
    name: "Watercolor",
    description: "Soft watercolor painting look",
    promptModifier: "watercolor painting style, soft edges, flowing colors, artistic",
  },
  {
    id: "comic-book",
    name: "Comic Book",
    description: "Bold comic book illustration",
    promptModifier: "comic book style, bold outlines, dynamic composition, vivid colors",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "Neon-lit futuristic aesthetic",
    promptModifier: "cyberpunk style, neon lights, futuristic, dark atmosphere, glowing",
  },
  {
    id: "dark-cinematic",
    name: "Dark Cinematic",
    description: "Moody, dark atmospheric scenes",
    promptModifier: "dark cinematic, moody lighting, dramatic shadows, atmospheric, film noir",
  },
  {
    id: "oil-painting",
    name: "Oil Painting",
    description: "Classical oil painting look",
    promptModifier: "oil painting style, classical art, rich textures, dramatic lighting, renaissance",
  },
];

export function getArtStyleById(id: string): ArtStyle | undefined {
  return ART_STYLES.find((s) => s.id === id);
}
