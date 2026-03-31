export interface ArtStyle {
  id: string;
  name: string;
  description: string;
  promptModifier: string;
  negativePrompt: string;
}

export const ART_STYLES: ArtStyle[] = [
  {
    id: "realistic",
    name: "Realistic",
    description: "Photorealistic, cinematic look",
    promptModifier: "photorealistic, cinematic lighting, ultra-detailed textures, shallow depth of field, 35mm film look, RAW photo quality, natural skin textures, volumetric lighting, ray tracing, 8k resolution",
    negativePrompt: "cartoon, anime, painting, illustration, drawing, low quality, blurry, deformed, disfigured, bad anatomy, watermark, text, logo, oversaturated",
  },
  {
    id: "anime",
    name: "Anime",
    description: "Japanese animation style",
    promptModifier: "anime style, vibrant saturated colors, detailed anime art, clean line art, dynamic poses, expressive eyes, cel shading, professional anime production quality, detailed backgrounds, studio quality animation",
    negativePrompt: "photorealistic, 3D render, western cartoon, ugly, low quality, blurry, watermark, text, deformed, bad proportions",
  },
  {
    id: "pixar-3d",
    name: "Pixar 3D",
    description: "Pixar-like 3D rendered characters",
    promptModifier: "pixar 3D animation style, subsurface scattering, smooth rendering, vibrant color palette, expressive character design, ambient occlusion, global illumination, Octane render quality, soft shadows, detailed environments",
    negativePrompt: "photorealistic, anime, 2D, flat, low poly, ugly, creepy, horror, dark, watermark, text",
  },
  {
    id: "watercolor",
    name: "Watercolor",
    description: "Soft watercolor painting look",
    promptModifier: "watercolor painting, soft wet-on-wet washes, flowing translucent colors, visible brush texture, artistic paper grain, subtle color bleeding, delicate details, impressionistic atmosphere, fine art quality",
    negativePrompt: "digital art, photorealistic, 3D, sharp edges, neon colors, dark, horror, watermark, text, low quality",
  },
  {
    id: "comic-book",
    name: "Comic Book",
    description: "Bold comic book illustration",
    promptModifier: "comic book illustration, bold ink outlines, dynamic action composition, halftone dot shading, vivid primary colors, dramatic foreshortening, speed lines, professional comic art, graphic novel quality, splash page energy",
    negativePrompt: "photorealistic, 3D, anime, soft, pastel, watercolor, blurry, low quality, watermark, text",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "Neon-lit futuristic aesthetic",
    promptModifier: "cyberpunk aesthetic, neon glow reflections on wet streets, holographic displays, volumetric fog with colored light rays, chrome and glass architecture, rain-soaked atmosphere, Blade Runner lighting, deep teal and hot pink color palette, futuristic dystopian detail",
    negativePrompt: "bright daylight, natural, pastoral, cartoon, cute, happy, watermark, text, low quality, blurry, medieval",
  },
  {
    id: "dark-cinematic",
    name: "Dark Cinematic",
    description: "Moody, dark atmospheric scenes",
    promptModifier: "dark cinematic, volumetric god rays piercing through fog, deep chiaroscuro shadows with harsh rim lighting, desaturated cold color palette with a single warm accent color, shallow depth of field, anamorphic lens flare, 35mm film grain, ultra-high contrast, oppressive atmosphere, professional cinematography",
    negativePrompt: "bright, colorful, cheerful, cartoon, anime, flat lighting, overexposed, daylight, saturated, clean, sterile, happy, watermark, text",
  },
  {
    id: "oil-painting",
    name: "Oil Painting",
    description: "Classical oil painting look",
    promptModifier: "classical oil painting, rich impasto brushwork, dramatic Rembrandt lighting, deep warm undertones, Renaissance composition with golden ratio, layered glazing technique, museum quality, Caravaggio chiaroscuro, ornate fine detail, canvas texture visible",
    negativePrompt: "digital art, photorealistic, 3D, anime, modern, minimalist, flat, low quality, watermark, text, neon colors",
  },
];

export function getArtStyleById(id: string): ArtStyle | undefined {
  return ART_STYLES.find((s) => s.id === id);
}
