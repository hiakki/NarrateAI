import { GoogleGenAI } from "@google/genai";

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
}

export interface Scene {
  text: string;
  visualDescription: string;
}

export interface GeneratedScript {
  title: string;
  description: string;
  hashtags: string[];
  scenes: Scene[];
  fullScript: string;
}

export interface ScriptInput {
  niche: string;
  tone: string;
  artStyle: string;
  duration: number;
  topic?: string;
}

export async function generateScript(input: ScriptInput): Promise<GeneratedScript> {
  const sceneCount = Math.max(4, Math.round(input.duration / 7));

  const prompt = `You are a viral short-form video scriptwriter. Create a script for a ${input.duration}-second faceless video.

NICHE: ${input.niche}
TONE: ${input.tone}
${input.topic ? `TOPIC: ${input.topic}` : "Choose a trending, engaging topic for this niche."}

RULES:
- Start with a strong hook in the first 3 seconds that stops the scroll
- Use short, punchy sentences
- Build tension/curiosity throughout
- End with a strong call-to-action or cliffhanger
- The script must be narration-only (no on-screen text directions)
- Target exactly ${sceneCount} scenes of 5-8 seconds each
- Each scene's visual description should be a detailed image prompt for the "${input.artStyle}" art style

Return ONLY valid JSON with this exact structure:
{
  "title": "catchy video title under 60 chars",
  "description": "video description for social media, 1-2 sentences",
  "hashtags": ["relevant", "trending", "hashtags"],
  "scenes": [
    {
      "text": "narration text for this scene",
      "visualDescription": "detailed visual description for image generation"
    }
  ]
}

Return ${sceneCount} scenes. The combined narration should take roughly ${input.duration} seconds when spoken.`;

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
  });

  const text = response.text ?? "";
  const parsed = JSON.parse(text);

  const fullScript = parsed.scenes.map((s: Scene) => s.text).join(" ");

  return {
    title: parsed.title,
    description: parsed.description,
    hashtags: parsed.hashtags || [],
    scenes: parsed.scenes,
    fullScript,
  };
}
