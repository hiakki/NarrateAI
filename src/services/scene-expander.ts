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

  let slots: ImageSlot[];

  if (sentences.length >= targetCount) {
    slots = sentences.slice(0, targetCount).map((s, i) => ({
      text: s.text,
      visualDescription: buildVariation(scenes[s.parentIdx].visualDescription, i),
      parentSceneIndex: s.parentIdx,
    }));
  } else {
    slots = sentences.map((s, i) => ({
      text: s.text,
      visualDescription: buildVariation(scenes[s.parentIdx].visualDescription, i),
      parentSceneIndex: s.parentIdx,
    }));

    let idx = 0;
    while (slots.length < targetCount) {
      const source = sentences[idx % sentences.length];
      slots.push({
        text: source.text,
        visualDescription: buildVariation(scenes[source.parentIdx].visualDescription, slots.length),
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

function buildVariation(baseDescription: string, index: number): string {
  const camera = CAMERA_VARIATIONS[index % CAMERA_VARIATIONS.length];
  return `${camera}, ${baseDescription}`;
}
