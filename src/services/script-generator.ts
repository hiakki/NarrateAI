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

/** Numeric seed from varietySeed string so each run gets different topic order. */
function seedFromVarietySeed(varietySeed: string | undefined): number {
  if (!varietySeed) return Date.now();
  let h = 0;
  for (let i = 0; i < varietySeed.length; i++) h = (h * 31 + varietySeed.charCodeAt(i)) >>> 0;
  return h;
}

/** Shuffle array using a simple seeded shuffle so each run gets different topic order. */
function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor((seed + i * 31) % (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildTopicCandidates(input: ScriptInput): string[] {
  const niche = getNicheById(input.niche);
  const hooks = [
    "the untold truth behind",
    "what nobody tells you about",
    "the dark side of",
    "the twist nobody saw coming in",
    "the most shocking case of",
    "the one thing nobody mentions about",
    "why everyone gets this wrong about",
    "the hidden story behind",
  ];
  const angles = [
    " — focus on the aftermath",
    " — the lesser-known version",
    " — from a surprising angle",
    " — what really happened next",
    "",
    "",
    "",
  ];
  const base = input.topic?.trim();

  if (base) {
    const seed = seedFromVarietySeed(input.varietySeed);
    const shuffledHooks = shuffleWithSeed([hooks[0], hooks[1], hooks[3], hooks[4]], seed);
    return [
      base,
      `${base} - ${shuffledHooks[0]}`,
      `${base}${angles[seed % angles.length]}`,
    ].slice(0, TWO_PASS_CANDIDATES);
  }

  const rawSamples = niche?.sampleTopics ?? [];
  const samples = rawSamples.length > 0 ? rawSamples : [input.niche.replace(/-/g, " ")];
  const seed = seedFromVarietySeed(input.varietySeed);
  const shuffledSamples = shuffleWithSeed([...samples], seed);
  const shuffledHooks = shuffleWithSeed([...hooks], seed + 1);

  const out: string[] = [];
  for (let i = 0; i < shuffledSamples.length && out.length < TWO_PASS_CANDIDATES; i++) {
    const angle = angles[(seed + i) % angles.length];
    out.push(`${shuffledHooks[i % shuffledHooks.length]} ${shuffledSamples[i]}${angle}`);
  }
  while (out.length < TWO_PASS_CANDIDATES && shuffledSamples.length > 0) {
    const i = out.length % shuffledSamples.length;
    const h = shuffledHooks[out.length % shuffledHooks.length];
    const angle = angles[(seed + out.length) % angles.length];
    out.push(`${h} ${shuffledSamples[i]}${angle}`);
  }
  if (out.length === 0) {
    out.push(
      `${shuffledHooks[0]} ${input.niche.replace(/-/g, " ")}`,
      `${shuffledHooks[1]} ${input.niche.replace(/-/g, " ")}`,
    );
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
    // Always pass an explicit topic so each run gets a different story (shuffle is seed-based).
    const topicCandidates = buildTopicCandidates(input);
    const topicForRun = topicCandidates[0];
    const inputWithTopic = topicForRun ? { ...inputWithChar, topic: topicForRun } : inputWithChar;
    if (topicForRun) log.log(`Single-pass topic for this run: "${topicForRun}"`);
    try {
      const script = await llm.generateScript(inputWithTopic);
      return ensureWordCount(script, inputWithTopic, llm);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : "";
      console.error(`[ScriptGen] Single-pass LLM failed (provider=${preferredProvider}):`, msg);
      if (stack) console.error(stack);
      log.error(`Single-pass failed: ${msg}`);
      throw err;
    }
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
        console.error(`[ScriptGen] Two-pass candidate failed provider=${llmId}:`, errMsg);
        if (err instanceof Error && err.stack) console.error(err.stack);
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
