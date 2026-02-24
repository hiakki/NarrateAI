import { createLogger } from "@/lib/logger";

const log = createLogger("SceneExpander");

interface Scene {
  text: string;
  visualDescription: string;
}

interface ImageSlot {
  text: string;
  visualDescription: string;
  parentSceneIndex: number;
}

const CAMERA_TWEAKS = [
  "slight camera push-in",
  "subtle pan right",
  "slow dolly back",
  "gentle tilt up",
  "micro zoom on detail",
  "soft rack focus shift",
  "slight pull-out revealing more",
  "slow track left",
];

export function expandScenesToImageSlots(
  scenes: Scene[],
  audioDurationMs: number,
): { slots: ImageSlot[]; timings: { startMs: number; endMs: number }[] } {
  const SECS_PER_IMAGE = 5;
  const totalImages = Math.max(scenes.length, Math.round(audioDurationMs / 1000 / SECS_PER_IMAGE));
  const numScenes = scenes.length;

  const base = Math.floor(totalImages / numScenes);
  const remainder = totalImages % numScenes;

  const totalChars = scenes.reduce((sum, s) => sum + s.text.length, 0) || 1;

  const slots: ImageSlot[] = [];
  const timings: { startMs: number; endMs: number }[] = [];
  let currentMs = 0;

  for (let sceneIdx = 0; sceneIdx < numScenes; sceneIdx++) {
    const imageCount = base + (sceneIdx < remainder ? 1 : 0);
    const sceneDurationMs = Math.round((scenes[sceneIdx].text.length / totalChars) * audioDurationMs);
    const perImageMs = Math.max(1, Math.round(sceneDurationMs / imageCount));

    for (let imgIdx = 0; imgIdx < imageCount; imgIdx++) {
      slots.push({
        text: scenes[sceneIdx].text,
        visualDescription: buildSlotPrompt(scenes[sceneIdx].visualDescription, imgIdx),
        parentSceneIndex: sceneIdx,
      });
      timings.push({ startMs: currentMs, endMs: currentMs + perImageMs });
      currentMs += perImageMs;
    }
  }

  if (timings.length > 0) {
    timings[timings.length - 1].endMs = audioDurationMs;
  }

  const distribution = [];
  for (let i = 0; i < numScenes; i++) {
    distribution.push(`S${i + 1}×${base + (i < remainder ? 1 : 0)}`);
  }
  log.log(
    `${numScenes} scenes → ${slots.length} images [${distribution.join(", ")}] for ${Math.round(audioDurationMs / 1000)}s audio (~${Math.round(audioDurationMs / 1000 / slots.length)}s per image)`,
  );

  return { slots, timings };
}

function buildSlotPrompt(sceneVisualDescription: string, withinSceneIndex: number): string {
  if (withinSceneIndex === 0) {
    return sceneVisualDescription;
  }
  const tweak = CAMERA_TWEAKS[withinSceneIndex % CAMERA_TWEAKS.length];
  return `${sceneVisualDescription}, ${tweak}`;
}
