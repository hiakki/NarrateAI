export interface Language {
  id: string;
  name: string;
  nativeName: string;
  flag: string;
  ttsSupport: {
    GEMINI_TTS: boolean;
    ELEVENLABS: boolean;
    COSYVOICE: boolean;
    FISH_AUDIO: boolean;
    EDGE_TTS: boolean;
  };
}

export const LANGUAGES: Language[] = [
  {
    id: "en",
    name: "English",
    nativeName: "English",
    flag: "🇺🇸",
    ttsSupport: { GEMINI_TTS: true, ELEVENLABS: true, COSYVOICE: true, FISH_AUDIO: true, EDGE_TTS: true },
  },
  {
    id: "hi",
    name: "Hindi",
    nativeName: "हिन्दी",
    flag: "🇮🇳",
    ttsSupport: { GEMINI_TTS: true, ELEVENLABS: true, COSYVOICE: false, FISH_AUDIO: true, EDGE_TTS: true },
  },
];

export function getLanguageById(id: string): Language | undefined {
  return LANGUAGES.find((l) => l.id === id);
}

export function getLanguageName(id: string): string {
  return getLanguageById(id)?.name ?? "English";
}

export function isLanguageSupportedByTts(languageId: string, ttsProvider: string): boolean {
  const lang = getLanguageById(languageId);
  if (!lang) return true;
  return lang.ttsSupport[ttsProvider as keyof typeof lang.ttsSupport] ?? false;
}
