import { getLlmProvider } from "./providers/factory";
import { PLATFORM_DEFAULTS } from "@/config/providers";
import { getNicheById } from "@/config/niches";
import { getSceneCount } from "./providers/llm/prompt";
import { createLogger } from "@/lib/logger";
import { getAvailableProviders } from "@/config/providers";

export type { ScriptInput, Scene, GeneratedScript } from "./providers/llm/types";
import type { ScriptInput, GeneratedScript } from "./providers/llm/types";

const log = createLogger("ScriptGen");
const TWO_PASS_ENABLED = (process.env.SCRIPT_TWO_PASS_ENABLED ?? "true").toLowerCase() !== "false";
const TWO_PASS_CANDIDATES = Math.max(2, parseInt(process.env.SCRIPT_TWO_PASS_CANDIDATES ?? "3", 10));
const TWO_PASS_MAX_ATTEMPTS = Math.max(2, parseInt(process.env.SCRIPT_TWO_PASS_MAX_ATTEMPTS ?? "6", 10));
const MULTI_LLM_ENSEMBLE = (process.env.SCRIPT_MULTI_LLM_ENSEMBLE ?? "true").toLowerCase() !== "false";

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
  provider?: string
): Promise<GeneratedScript> {
  const preferredProvider = provider ?? PLATFORM_DEFAULTS.llm;
  const llm = getLlmProvider(preferredProvider);
  if (!TWO_PASS_ENABLED) {
    return llm.generateScript(input);
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
        const script = await candidateLlm.generateScript({ ...input, topic });
        const score = scoreScript(script, targetScenes);
        candidates.push({ script, topic, provider: llmId, score });
        log.log(`Two-pass candidate scored: provider=${llmId} topic="${topic}" score=${score}`);
      } catch (err) {
        log.warn(`Two-pass candidate failed: provider=${llmId} topic="${topic}" err=${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    log.log(`Two-pass selected provider=${best.provider} topic="${best.topic}" score=${best.score} (from ${candidates.length} candidates, attempts=${attempts})`);
    return best.script;
  }

  log.warn("Two-pass failed for all candidates, falling back to single-pass");
  return llm.generateScript(input);
}
