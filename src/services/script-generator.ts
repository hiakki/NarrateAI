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

  const prompt = `You are a viral short-form video scriptwriter. Create a script for a ${input.duration}-second faceless narration video.

NICHE: ${input.niche}
TONE: ${input.tone}
${input.topic ? `TOPIC: ${input.topic}` : "Choose a trending, engaging topic for this niche."}

RULES:
- Start with a powerful hook in the first 3 seconds that stops the scroll
- Use short, punchy sentences for narration
- Build tension and curiosity throughout
- End with a strong call-to-action or cliffhanger
- The "text" field is narration that will be spoken by AI voiceover
- The "visualDescription" field describes what image to show during this scene
- Visual descriptions should be detailed, cinematic prompts for "${input.artStyle}" style images
- Each scene should be 5-8 seconds of narration

Return ONLY valid JSON:
{
  "title": "catchy title under 60 chars",
  "description": "1-2 sentence hook for social media",
  "hashtags": ["relevant", "trending", "hashtags"],
  "scenes": [
    {
      "text": "narration text spoken by voiceover for this scene",
      "visualDescription": "detailed visual description for AI image generation"
    }
  ]
}

Generate exactly ${sceneCount} scenes. Make it engaging and viral-worthy.`;

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
