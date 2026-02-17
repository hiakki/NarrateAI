export interface Voice {
  id: string;
  name: string;
  description: string;
  gender: "male" | "female" | "neutral";
}

export const VOICES: Voice[] = [
  {
    id: "Kore",
    name: "Kore",
    description: "Warm and clear female voice",
    gender: "female",
  },
  {
    id: "Charon",
    name: "Charon",
    description: "Deep and authoritative male voice",
    gender: "male",
  },
  {
    id: "Fenrir",
    name: "Fenrir",
    description: "Bold and dramatic male voice",
    gender: "male",
  },
  {
    id: "Aoede",
    name: "Aoede",
    description: "Soft and expressive female voice",
    gender: "female",
  },
  {
    id: "Puck",
    name: "Puck",
    description: "Energetic and youthful neutral voice",
    gender: "neutral",
  },
  {
    id: "Leda",
    name: "Leda",
    description: "Calm and soothing female voice",
    gender: "female",
  },
];

export function getVoiceById(id: string): Voice | undefined {
  return VOICES.find((v) => v.id === id);
}
