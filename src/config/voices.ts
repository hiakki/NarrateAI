export interface Voice {
  id: string;
  name: string;
  description: string;
  gender: "male" | "female" | "neutral";
  /** ISO language codes this voice supports. Empty = all languages the provider supports. */
  languages?: string[];
}

export const VOICES_BY_PROVIDER: Record<string, Voice[]> = {
  GEMINI_TTS: [
    // All Gemini voices are multilingual and support Hindi natively
    { id: "Kore", name: "Kore", description: "Strong and firm female voice", gender: "female" },
    { id: "Charon", name: "Charon", description: "Calm and professional male narrator", gender: "male" },
    { id: "Fenrir", name: "Fenrir", description: "Passionate and energetic male voice", gender: "male" },
    { id: "Aoede", name: "Aoede", description: "Relaxed and natural female voice", gender: "female" },
    { id: "Puck", name: "Puck", description: "Upbeat and lively male voice", gender: "neutral" },
    { id: "Leda", name: "Leda", description: "Youthful and energetic female voice", gender: "female" },
    { id: "Rasalgethi", name: "Rasalgethi", description: "Professional narrator male voice", gender: "male" },
    { id: "Achird", name: "Achird", description: "Friendly and kind male narrator", gender: "male" },
    { id: "Orus", name: "Orus", description: "Calm and firm male voice", gender: "male" },
    { id: "Sulafat", name: "Sulafat", description: "Warm and approachable female voice", gender: "female" },
    { id: "Achernar", name: "Achernar", description: "Soft and warm female voice", gender: "female" },
    { id: "Sadaltager", name: "Sadaltager", description: "Knowledgeable and learned male voice", gender: "male" },
    { id: "Schedar", name: "Schedar", description: "Even and steady male narrator", gender: "male" },
    { id: "Gacrux", name: "Gacrux", description: "Mature and steady female voice", gender: "female" },
    { id: "Algieba", name: "Algieba", description: "Smooth and flowing male voice", gender: "male" },
    { id: "Vindemiatrix", name: "Vindemiatrix", description: "Gentle and delicate female voice", gender: "female" },
  ],
  ELEVENLABS: [
    // --- English voices (multilingual v2 — can speak Hindi but not native) ---
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", description: "Calm and clear female (multilingual)", gender: "female", languages: ["en"] },
    { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", description: "Strong and confident female", gender: "female", languages: ["en"] },
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", description: "Soft and warm female", gender: "female", languages: ["en"] },
    { id: "ErXwobaYiN019PkySvjV", name: "Antoni", description: "Well-rounded and warm male", gender: "male", languages: ["en"] },
    { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", description: "Emotional and expressive female", gender: "female", languages: ["en"] },
    { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", description: "Deep and narrative male", gender: "male", languages: ["en"] },
    { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", description: "Bold and commanding male", gender: "male", languages: ["en"] },
    { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", description: "Deep and authoritative male", gender: "male", languages: ["en"] },
    // --- Hindi voices (native Indian Hindi speakers) ---
    { id: "q6lbiuyq6L1H58xIpLAN", name: "Vikram", description: "Deep & suspenseful Hindi narrator", gender: "male", languages: ["hi"] },
    { id: "2vKLAkaFznHNXlzkyAZP", name: "Devrath", description: "Dramatic & intense Hindi storyteller", gender: "male", languages: ["hi"] },
    { id: "Y6nOpHQlW4lnf9GRRc8f", name: "Adarsh", description: "Emotive & expressive Hindi voice", gender: "male", languages: ["hi"] },
    { id: "s6cZdgI3j07hf4frz4Q8", name: "Arvi", description: "Lively authentic desi Hindi voice", gender: "male", languages: ["hi"] },
    { id: "IvLWq57RKibBrqZGpQrC", name: "Leo", description: "Energetic Hindi voice for viral content", gender: "male", languages: ["hi"] },
    { id: "MaBqnF6LpI8cAT5sGihk", name: "Sinnbad", description: "Calm authoritative Hindi narrator", gender: "male", languages: ["hi"] },
    { id: "amiAXapsDOAiHJqbsAZj", name: "Priya", description: "Young Indian girl, great for shorts", gender: "female", languages: ["hi"] },
    { id: "mg9npuuaf8WJphS6E0Rt", name: "Aisha", description: "Friendly & empathetic Hindi voice", gender: "female", languages: ["hi"] },
    { id: "ryIIztHPLYSJ74ueXxnO", name: "Sia", description: "Warm & approachable Hindi narrator", gender: "female", languages: ["hi"] },
    { id: "c6bExSiHfx47LERqW2VK", name: "Rhea", description: "Late-night Hindi storytelling voice", gender: "female", languages: ["hi"] },
    { id: "ZutjnxqGfsMAzwUTcJBM", name: "Anu", description: "Friendly & romantic Hindi female", gender: "female", languages: ["hi"] },
    { id: "0FZiOcKjnEowx6MA1W5v", name: "Laila", description: "Warm youthful Hindi female voice", gender: "female", languages: ["hi"] },
  ],
  COSYVOICE: [
    { id: "longxiaochun", name: "Xiaochun", description: "Clear English female voice", gender: "female", languages: ["en", "zh"] },
    { id: "longhua", name: "Longhua", description: "Authoritative Chinese male", gender: "male", languages: ["zh", "en"] },
    { id: "longshuo", name: "Longshuo", description: "News-style Chinese male", gender: "male", languages: ["zh", "en"] },
    { id: "longyue", name: "Longyue", description: "Warm Chinese female voice", gender: "female", languages: ["zh", "en"] },
    { id: "longjing", name: "Longjing", description: "Gentle and soothing female", gender: "female", languages: ["zh", "en"] },
    { id: "longfei", name: "Longfei", description: "Energetic Chinese male", gender: "male", languages: ["zh", "en"] },
  ],
  FISH_AUDIO: [
    // --- English voices ---
    { id: "d8639b5c94624f4f8c38faae77c8e8c5", name: "Alex", description: "Clear American English male", gender: "male", languages: ["en"] },
    { id: "bf04ee901e8b4a5eab6b24536a8b3d1e", name: "Aria", description: "Warm American English female", gender: "female", languages: ["en"] },
    { id: "7f92f8afb8ec43bf81429cc1c9199cb1", name: "David", description: "Deep narrative male voice", gender: "male", languages: ["en"] },
    { id: "a9e80e281b9b4e5bbe27f8fb694f8597", name: "Lily", description: "Soft and expressive female", gender: "female", languages: ["en"] },
    { id: "e58b0d7efca34b25a7e54b1bb30fad3e", name: "Sam", description: "Casual and friendly male", gender: "male", languages: ["en"] },
    { id: "c8d2e4d0f5c34b4e9b7a6f8d1e2c3a4b", name: "Mia", description: "Bright and energetic female", gender: "female", languages: ["en"] },
    // --- Hindi voices (community models from Fish Audio library) ---
    { id: "6530d15007a647ce8789e30a208114f4", name: "Krishna", description: "Clear Hindi male narrator", gender: "male", languages: ["hi"] },
    { id: "62b231e6e8634ce79230250ae105ba9c", name: "Dadi", description: "Warm Indian female storyteller", gender: "female", languages: ["hi"] },
    { id: "ce9c96291460478ea6851049cb847d73", name: "Rajan", description: "Indian-accented conversational male", gender: "male", languages: ["hi", "en"] },
    { id: "3Th96YoTP1kEKxJroYo1", name: "Jeet", description: "Bihari Hindi theatre-style male", gender: "male", languages: ["hi"] },
    { id: "v984ziaDjt5EKuv3UFRU", name: "Akshay", description: "Young Indian male for stories & facts", gender: "male", languages: ["hi"] },
  ],
  EDGE_TTS: [
    // --- English voices ---
    { id: "en-US-AndrewNeural", name: "Andrew", description: "Natural conversational American male", gender: "male", languages: ["en"] },
    { id: "en-US-BrianNeural", name: "Brian", description: "Deep storytelling American male", gender: "male", languages: ["en"] },
    { id: "en-US-ChristopherNeural", name: "Christopher", description: "Authoritative and reliable male", gender: "male", languages: ["en"] },
    { id: "en-US-EricNeural", name: "Eric", description: "Calm and steady narrator male", gender: "male", languages: ["en"] },
    { id: "en-US-GuyNeural", name: "Guy", description: "Energetic and friendly male", gender: "male", languages: ["en"] },
    { id: "en-US-AriaNeural", name: "Aria", description: "Expressive and versatile female", gender: "female", languages: ["en"] },
    { id: "en-US-JennyNeural", name: "Jenny", description: "Warm and professional female", gender: "female", languages: ["en"] },
    { id: "en-US-MichelleNeural", name: "Michelle", description: "Clear and friendly female", gender: "female", languages: ["en"] },
    { id: "en-GB-RyanNeural", name: "Ryan", description: "British male narrator", gender: "male", languages: ["en"] },
    { id: "en-GB-SoniaNeural", name: "Sonia", description: "British female narrator", gender: "female", languages: ["en"] },
    // --- Hindi voices ---
    { id: "hi-IN-MadhurNeural", name: "Madhur", description: "Natural Hindi male narrator", gender: "male", languages: ["hi"] },
    { id: "hi-IN-SwaraNeural", name: "Swara", description: "Expressive Hindi female narrator", gender: "female", languages: ["hi"] },
  ],
};

/** Backward-compatible flat list (all Gemini voices, used as default) */
export const VOICES: Voice[] = VOICES_BY_PROVIDER.GEMINI_TTS;

export function getVoiceById(id: string): Voice | undefined {
  for (const voices of Object.values(VOICES_BY_PROVIDER)) {
    const found = voices.find((v) => v.id === id);
    if (found) return found;
  }
  return undefined;
}

export function getVoicesForProvider(ttsProvider: string, language?: string): Voice[] {
  const voices = VOICES_BY_PROVIDER[ttsProvider];
  if (!voices) {
    console.warn(`[Voices] No voices configured for "${ttsProvider}", falling back to GEMINI_TTS`);
    return VOICES_BY_PROVIDER.GEMINI_TTS;
  }
  if (!language) return voices;
  const filtered = voices.filter((v) => !v.languages || v.languages.includes(language));
  return filtered.length > 0 ? filtered : voices;
}

export function getDefaultVoiceId(ttsProvider: string, language?: string): string {
  const voices = getVoicesForProvider(ttsProvider, language);
  if (voices.length === 0) {
    throw new Error(`No voices configured for TTS provider: ${ttsProvider}`);
  }
  return voices[0].id;
}

/**
 * Returns the voiceId if it's valid for the given TTS provider,
 * otherwise falls back to a matching-gender voice or the provider's default.
 */
export function resolveVoiceForProvider(ttsProvider: string, voiceId: string, language?: string): string {
  const providerVoices = getVoicesForProvider(ttsProvider, language);
  if (providerVoices.some((v) => v.id === voiceId)) return voiceId;

  const originalVoice = getVoiceById(voiceId);
  if (originalVoice) {
    const genderMatch = providerVoices.find((v) => v.gender === originalVoice.gender);
    if (genderMatch) {
      console.log(`[Voices] Mapped "${voiceId}" -> "${genderMatch.id}" (${genderMatch.name}) for ${ttsProvider} (gender match)`);
      return genderMatch.id;
    }
  }

  if (providerVoices.length === 0) {
    throw new Error(`No voices configured for TTS provider: ${ttsProvider}`);
  }

  const fallback = providerVoices[0].id;
  console.log(`[Voices] Mapped "${voiceId}" -> "${fallback}" for ${ttsProvider} (default fallback)`);
  return fallback;
}
