import { getLlmProvider } from "./providers/factory";
import { PLATFORM_DEFAULTS } from "@/config/providers";
import { getNicheById } from "@/config/niches";
import { getSceneCount } from "./providers/llm/prompt";
import { createLogger } from "@/lib/logger";
import { getAvailableProviders } from "@/config/providers";

export type { ScriptInput, Scene, GeneratedScript } from "./providers/llm/types";
import type { ScriptInput, GeneratedScript } from "./providers/llm/types";

const log = createLogger("ScriptGen");
const TWO_PASS_ENABLED = (process.env.SCRIPT_TWO_PASS_ENABLED ?? "false").toLowerCase() === "true";
const TWO_PASS_CANDIDATES = Math.max(2, parseInt(process.env.SCRIPT_TWO_PASS_CANDIDATES ?? "3", 10));
const TWO_PASS_MAX_ATTEMPTS = Math.max(2, parseInt(process.env.SCRIPT_TWO_PASS_MAX_ATTEMPTS ?? "6", 10));
const MULTI_LLM_ENSEMBLE = (process.env.SCRIPT_MULTI_LLM_ENSEMBLE ?? "true").toLowerCase() !== "false";

const TTS_WORDS_PER_SEC = 2.0;
const PLATFORM_MAX_SECS = 88; // Reels/Shorts = 90s, keep 2s safety margin

function getMinWords(duration: number): number {
  return Math.max(1, Math.floor(duration * 0.9 * TTS_WORDS_PER_SEC));
}

function getMaxWords(): number {
  return Math.floor(PLATFORM_MAX_SECS * TTS_WORDS_PER_SEC);
}

function countWords(text: string): number {
  return text
    .replace(/[—–]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

type WordCheck =
  | { ok: true }
  | { ok: false; reason: "short"; count: number; min: number }
  | { ok: false; reason: "long"; count: number; max: number };

function checkWordCount(script: GeneratedScript, duration: number): WordCheck {
  const count = countWords(script.fullScript);
  const min = getMinWords(duration);
  const max = getMaxWords();
  if (count < min) return { ok: false, reason: "short", count, min };
  if (count > max) return { ok: false, reason: "long", count, max };
  return { ok: true };
}

function buildTopicCandidates(input: ScriptInput): string[] {
  const niche = getNicheById(input.niche);
  const hooks = [
    "the untold truth behind",
    "what nobody tells you about",
    "the dark side of",
    "the twist nobody saw coming in",
    "the most shocking case of",
  ];
  const base = input.topic?.trim();

  if (base) {
    return [
      base,
      `${base} - ${hooks[0]}`,
      `${base} - ${hooks[3]}`,
    ];
  }

  const samples = niche?.sampleTopics?.slice(0, 5) ?? [];
  if (samples.length === 0) {
    return [
      `${hooks[0]} ${input.niche.replace(/-/g, " ")}`,
      `${hooks[1]} ${input.niche.replace(/-/g, " ")}`,
      `${hooks[3]} ${input.niche.replace(/-/g, " ")}`,
    ];
  }

  const out: string[] = [];
  for (let i = 0; i < samples.length && out.length < TWO_PASS_CANDIDATES; i++) {
    const h = hooks[i % hooks.length];
    out.push(`${h} ${samples[i]}`);
  }
  while (out.length < TWO_PASS_CANDIDATES) {
    const i = out.length % samples.length;
    const h = hooks[out.length % hooks.length];
    out.push(`${h} ${samples[i]}`);
  }
  return out.slice(0, TWO_PASS_CANDIDATES);
}

function buildLlmCandidates(preferred: string): string[] {
  const available = new Set(getAvailableProviders("llm").map((p) => p.id));
  const freeFirst = [
    preferred,
    "DEEPSEEK_V3",
    "QWEN",
    "GEMINI_FLASH",
    "OPENAI_GPT4O_MINI",
  ];
  const deduped = [...new Set(freeFirst)];
  return deduped.filter((id) => available.has(id));
}

function scoreScript(script: GeneratedScript, targetScenes: number): number {
  const scenes = script.scenes ?? [];
  if (scenes.length === 0) return 0;

  const s1 = scenes[0]?.text?.toLowerCase() ?? "";
  const hookSignals = [
    "wait",
    "imagine",
    "what if",
    "you won’t believe",
    "nobody knows",
    "shocking",
    "suddenly",
    "then",
    "?",
    "!",
  ];
  const hookScore = hookSignals.some((h) => s1.includes(h)) ? 20 : 8;

  const sceneCountScore = Math.max(0, 20 - Math.abs(targetScenes - scenes.length) * 4);

  const narrationPaceScore = scenes.reduce((acc, s) => {
    const wc = s.text.trim().split(/\s+/).filter(Boolean).length;
    // sweet spot per scene for short-form pacing
    if (wc >= 10 && wc <= 28) return acc + 6;
    if (wc >= 7 && wc <= 35) return acc + 4;
    return acc + 1;
  }, 0);

  const visualRichness = scenes.reduce((acc, s) => {
    const wc = s.visualDescription.trim().split(/\s+/).filter(Boolean).length;
    const cameraCue = /(close-up|wide|low angle|over-shoulder|bird's eye|dutch angle|medium shot)/i.test(s.visualDescription);
    let score = 0;
    if (wc >= 70 && wc <= 140) score += 4;
    else if (wc >= 50) score += 2;
    if (cameraCue) score += 2;
    return acc + score;
  }, 0);

  const titleScore = script.title && script.title.length >= 20 && script.title.length <= 70 ? 8 : 4;

  return hookScore + sceneCountScore + narrationPaceScore + visualRichness + titleScore;
}

export async function generateScript(
  input: ScriptInput,
  provider?: string,
  characterPrompt?: string,
): Promise<GeneratedScript> {
  const preferredProvider = provider ?? PLATFORM_DEFAULTS.llm;
  const llm = getLlmProvider(preferredProvider);
  const inputWithChar = characterPrompt ? { ...input, characterPrompt } : input;

  if (!TWO_PASS_ENABLED) {
    const script = await llm.generateScript(inputWithChar);
    return ensureWordCount(script, inputWithChar, llm);
  }

  const targetScenes = getSceneCount(input.duration);
  const topicCandidates = buildTopicCandidates(input);
  const llmCandidates = MULTI_LLM_ENSEMBLE
    ? buildLlmCandidates(preferredProvider)
    : [preferredProvider];
  const candidates: { script: GeneratedScript; topic: string; provider: string; score: number }[] = [];
  let attempts = 0;

  outer:
  for (const topic of topicCandidates) {
    for (const llmId of llmCandidates) {
      if (attempts >= TWO_PASS_MAX_ATTEMPTS) break outer;
      attempts += 1;
      try {
        const candidateLlm = llmId === preferredProvider ? llm : getLlmProvider(llmId);
        const script = await candidateLlm.generateScript({ ...inputWithChar, topic });
        const score = scoreScript(script, targetScenes);
        candidates.push({ script, topic, provider: llmId, score });
        log.log(`Two-pass candidate scored: provider=${llmId} topic="${topic}" score=${score}`);
      } catch (err) {
        const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 200);
        log.warn(`Two-pass candidate failed: provider=${llmId} err=${errMsg}`);
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    log.log(`Two-pass selected provider=${best.provider} topic="${best.topic}" score=${best.score} (from ${candidates.length} candidates, attempts=${attempts})`);
    const llmForBest = getLlmProvider(best.provider);
    return ensureWordCount(best.script, inputWithChar, llmForBest);
  }

  log.warn("Two-pass failed for all candidates, falling back to single-pass");
  return ensureWordCount(await llm.generateScript(inputWithChar), inputWithChar, llm);
}

async function expandScenes(
  script: GeneratedScript,
  totalTargetWords: number,
  expandText: (text: string, targetWords: number) => Promise<string>,
): Promise<GeneratedScript> {
  const sceneCount = script.scenes.length;
  const targetPerScene = Math.ceil(totalTargetWords / sceneCount);
  const expandedScenes = [...script.scenes];

  for (let i = 0; i < expandedScenes.length; i++) {
    const scene = expandedScenes[i];
    const wc = countWords(scene.text);
    if (wc >= targetPerScene * 0.85) continue;

    try {
      const expanded = await expandText(scene.text, targetPerScene);
      expandedScenes[i] = { ...scene, text: expanded };
      log.log(`Scene ${i + 1} expanded: ${wc} → ${countWords(expanded)} words`);
    } catch (err) {
      log.warn(`Scene ${i + 1} expansion failed: ${(err as Error).message?.slice(0, 120)}`);
    }
  }

  const fullScript = expandedScenes.map((s) => s.text).join(" ");
  return { ...script, scenes: expandedScenes, fullScript };
}

async function ensureWordCount(
  script: GeneratedScript,
  input: ScriptInput,
  llm: {
    generateScript: (i: ScriptInput) => Promise<GeneratedScript>;
    expandText?: (text: string, targetWords: number) => Promise<string>;
  },
): Promise<GeneratedScript> {
  const min = getMinWords(input.duration);
  const max = getMaxWords();
  const target = Math.round(input.duration * 2.5);

  const deviation = (wc: number) => {
    if (wc >= min && wc <= max) return 0;
    return wc < min ? min - wc : wc - max;
  };

  let best = script;
  let bestDev = deviation(countWords(script.fullScript));

  if (bestDev === 0) {
    log.log(`Script length OK: ${countWords(best.fullScript)} words (range ${min}–${max}, target ${target} for ${input.duration}s)`);
    return script;
  }

  const MAX_RETRIES = 2;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const wc = countWords(best.fullScript);
    const reason = wc < min ? "short" : "long";
    const correction = reason === "short"
      ? `REJECTED (attempt ${attempt}): only ${wc} words (minimum ${min}). Write AT LEAST ${target} words. Each scene needs 3-5 full sentences of vivid narration.`
      : `REJECTED (attempt ${attempt}): ${wc} words exceeds ${max}-word max (90s platform limit). Write EXACTLY ${target} words. Trim each scene to 3-4 sentences.`;

    log.warn(`Script too ${reason}: ${wc} words. Retry ${attempt}/${MAX_RETRIES}.`);

    try {
      const retryTopic = `${input.topic ?? ""}\n\n[LENGTH CORRECTION: ${correction}]`.trim();
      const retried = await llm.generateScript({ ...input, topic: retryTopic });
      const retryDev = deviation(countWords(retried.fullScript));
      if (retryDev < bestDev) { best = retried; bestDev = retryDev; }
      if (bestDev === 0) {
        log.log(`Retry ${attempt} succeeded: ${countWords(best.fullScript)} words`);
        return best;
      }
    } catch (err) {
      log.warn(`Retry ${attempt} failed: ${(err as Error).message?.slice(0, 120)}`);
    }
  }

  if (countWords(best.fullScript) < min && llm.expandText) {
    log.log(`Retries exhausted (${countWords(best.fullScript)}/${min} words). Trying scene-by-scene expansion…`);
    try {
      const expandFn = (t: string, w: number) => llm.expandText!(t, w);
      const expanded = await expandScenes(best, target, expandFn);
      const expandedDev = deviation(countWords(expanded.fullScript));
      if (expandedDev < bestDev) {
        best = expanded;
        bestDev = expandedDev;
      }
      if (bestDev === 0) {
        log.log(`Scene expansion succeeded: ${countWords(best.fullScript)} words`);
        return best;
      }
      log.warn(`Scene expansion improved script: ${countWords(best.fullScript)} words (target ${min}–${max})`);
    } catch (err) {
      log.warn(`Scene expansion failed: ${(err as Error).message?.slice(0, 120)}`);
    }
  }

  log.warn(`Best effort: ${countWords(best.fullScript)} words (target ${min}–${max})`);
  return best;
}
