interface Scene {
  text: string;
  visualDescription: string;
}

interface ImageSlot {
  text: string;
  visualDescription: string;
  parentSceneIndex: number;
}

const CAMERA_VARIATIONS = [
  "close-up shot focusing on key details",
  "wide establishing shot showing full environment",
  "medium shot with subject in context",
  "low angle dramatic perspective looking up",
  "intimate portrait-style framing",
  "over-the-shoulder voyeuristic angle",
  "bird's eye view looking down",
  "dutch angle for tension and unease",
  "extreme close-up on emotional detail",
  "panoramic wide shot with depth layers",
];

const NARRATIVE_FOCUS = [
  "focusing on the primary subject and their emotional expression at this exact moment",
  "emphasizing the environment reacting to the action — objects shifting, light changing, atmosphere responding",
  "capturing the peak gesture or movement that defines this instant — hands reaching, body turning, eyes widening",
  "highlighting the most significant object or detail central to what is happening right now",
  "showing the emotional impact and reaction — facial tension, body language, involuntary response",
  "revealing the full dramatic scope of the moment with every element contributing to the story",
  "intimate texture and micro-detail — skin, fabric, surface, revealing inner state through physical detail",
  "dynamic energy and momentum — motion blur on extremities, flying particles, displaced air, kinetic force",
  "the transitional instant between two states — calm breaking into chaos, light turning to dark, hope to despair",
  "the decisive split-second where everything changes — frozen at maximum tension and narrative weight",
];

const MOOD_VARIATIONS = [
  "raw and visceral energy, every element charged with tension",
  "haunting stillness with an undercurrent of unease beneath the surface",
  "explosive intensity, as if the frame itself struggles to contain the moment",
  "melancholic weight, time slowing to absorb the gravity of what is happening",
  "electrifying anticipation, the instant before the irreversible occurs",
  "dreamlike surrealism, reality slightly distorted by heightened emotion",
  "gritty authenticity, every imperfection adding to the rawness of the scene",
  "ethereal beauty emerging from darkness, contrast between hope and despair",
  "suffocating claustrophobia, the world closing in around the subject",
  "vast lonely grandeur, the subject dwarfed by forces beyond their control",
];

function splitIntoSentences(text: string): string[] {
  const raw = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function expandScenesToImageSlots(
  scenes: Scene[],
  audioDurationMs: number,
): { slots: ImageSlot[]; timings: { startMs: number; endMs: number }[] } {
  const SECS_PER_IMAGE = 5;
  const targetCount = Math.max(scenes.length, Math.round(audioDurationMs / 1000 / SECS_PER_IMAGE));

  const sentences: { text: string; parentIdx: number }[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const parts = splitIntoSentences(scenes[i].text);
    for (const part of parts) {
      sentences.push({ text: part, parentIdx: i });
    }
  }

  if (sentences.length === 0) {
    sentences.push({ text: scenes[0]?.text ?? "", parentIdx: 0 });
  }

  const slotsPerScene = new Map<number, number>();
  let slots: ImageSlot[];

  if (sentences.length >= targetCount) {
    slots = sentences.slice(0, targetCount).map((s, i) => {
      const slotIdx = slotsPerScene.get(s.parentIdx) ?? 0;
      slotsPerScene.set(s.parentIdx, slotIdx + 1);
      return {
        text: s.text,
        visualDescription: buildVariation(scenes[s.parentIdx].visualDescription, i, slotIdx),
        parentSceneIndex: s.parentIdx,
      };
    });
  } else {
    slots = sentences.map((s, i) => {
      const slotIdx = slotsPerScene.get(s.parentIdx) ?? 0;
      slotsPerScene.set(s.parentIdx, slotIdx + 1);
      return {
        text: s.text,
        visualDescription: buildVariation(scenes[s.parentIdx].visualDescription, i, slotIdx),
        parentSceneIndex: s.parentIdx,
      };
    });

    let idx = 0;
    while (slots.length < targetCount) {
      const source = sentences[idx % sentences.length];
      const slotIdx = slotsPerScene.get(source.parentIdx) ?? 0;
      slotsPerScene.set(source.parentIdx, slotIdx + 1);
      slots.push({
        text: source.text,
        visualDescription: buildVariation(scenes[source.parentIdx].visualDescription, slots.length, slotIdx),
        parentSceneIndex: source.parentIdx,
      });
      idx++;
    }
  }

  const totalChars = slots.reduce((sum, s) => sum + s.text.length, 0) || 1;
  const timings: { startMs: number; endMs: number }[] = [];
  let currentMs = 0;

  for (const slot of slots) {
    const proportion = slot.text.length / totalChars;
    const dur = Math.round(proportion * audioDurationMs);
    timings.push({ startMs: currentMs, endMs: currentMs + dur });
    currentMs += dur;
  }
  if (timings.length > 0) {
    timings[timings.length - 1].endMs = audioDurationMs;
  }

  console.log(
    `[SceneExpander] ${scenes.length} scenes → ${slots.length} image slots for ${Math.round(audioDurationMs / 1000)}s audio (~${Math.round(audioDurationMs / 1000 / slots.length)}s per image)`,
  );

  return { slots, timings };
}

function buildVariation(baseDescription: string, globalIndex: number, withinSceneIndex: number): string {
  const camera = CAMERA_VARIATIONS[globalIndex % CAMERA_VARIATIONS.length];
  const focus = NARRATIVE_FOCUS[(globalIndex + withinSceneIndex * 3) % NARRATIVE_FOCUS.length];
  const mood = MOOD_VARIATIONS[(globalIndex + withinSceneIndex * 7) % MOOD_VARIATIONS.length];

  if (withinSceneIndex === 0) {
    return `${camera}, ${focus}, ${baseDescription}`;
  }
  return `${camera}, ${focus}, ${mood}, ${baseDescription}`;
}
