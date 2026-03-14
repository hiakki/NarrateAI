/**
 * Shared niche "potential" score (0–100%) for an automation config.
 * Matches the logic used in dashboard/automations/new (Niche Score Card).
 */

import { NICHES } from "@/config/niches";
import { getScheduleForNiche, convertTime } from "@/config/posting-schedule";

const SCORE_WEIGHTS = { topic: 30, art: 15, voice: 10, language: 15, tone: 10, time: 20 } as const;
const PLATFORMS = ["FACEBOOK", "YOUTUBE", "INSTAGRAM", "SHARECHAT", "MOJ"] as const;
type PlatformKey = (typeof PLATFORMS)[number];

const NICHE_PLATFORM_BASE: Record<string, Record<PlatformKey, number>> = {
  "scary-stories": { FACEBOOK: 76, YOUTUBE: 70, INSTAGRAM: 84, SHARECHAT: 82, MOJ: 82 },
  mythology: { FACEBOOK: 78, YOUTUBE: 74, INSTAGRAM: 72, SHARECHAT: 74, MOJ: 74 },
  history: { FACEBOOK: 74, YOUTUBE: 76, INSTAGRAM: 68, SHARECHAT: 70, MOJ: 70 },
  "true-crime": { FACEBOOK: 80, YOUTUBE: 75, INSTAGRAM: 82, SHARECHAT: 80, MOJ: 80 },
  "anime-recaps": { FACEBOOK: 62, YOUTUBE: 78, INSTAGRAM: 86, SHARECHAT: 84, MOJ: 84 },
  "life-hacks": { FACEBOOK: 72, YOUTUBE: 70, INSTAGRAM: 82, SHARECHAT: 80, MOJ: 80 },
  motivation: { FACEBOOK: 74, YOUTUBE: 72, INSTAGRAM: 80, SHARECHAT: 78, MOJ: 78 },
  "science-facts": { FACEBOOK: 70, YOUTUBE: 76, INSTAGRAM: 74, SHARECHAT: 74, MOJ: 74 },
  "conspiracy-theories": { FACEBOOK: 77, YOUTUBE: 68, INSTAGRAM: 79, SHARECHAT: 78, MOJ: 78 },
  "religious-epics": { FACEBOOK: 80, YOUTUBE: 68, INSTAGRAM: 66, SHARECHAT: 72, MOJ: 72 },
  "what-if": { FACEBOOK: 72, YOUTUBE: 82, INSTAGRAM: 78, SHARECHAT: 78, MOJ: 78 },
  "dark-psychology": { FACEBOOK: 80, YOUTUBE: 72, INSTAGRAM: 86, SHARECHAT: 84, MOJ: 84 },
  "space-cosmos": { FACEBOOK: 68, YOUTUBE: 84, INSTAGRAM: 76, SHARECHAT: 78, MOJ: 78 },
  "animal-kingdom": { FACEBOOK: 80, YOUTUBE: 78, INSTAGRAM: 84, SHARECHAT: 84, MOJ: 84 },
  survival: { FACEBOOK: 76, YOUTUBE: 80, INSTAGRAM: 78, SHARECHAT: 78, MOJ: 78 },
  "money-wealth": { FACEBOOK: 74, YOUTUBE: 76, INSTAGRAM: 86, SHARECHAT: 84, MOJ: 84 },
  "funny-stories": { FACEBOOK: 82, YOUTUBE: 80, INSTAGRAM: 88, SHARECHAT: 86, MOJ: 86 },
  "zero-to-hero": { FACEBOOK: 78, YOUTUBE: 76, INSTAGRAM: 84, SHARECHAT: 82, MOJ: 82 },
  "character-storytelling": { FACEBOOK: 78, YOUTUBE: 82, INSTAGRAM: 84, SHARECHAT: 82, MOJ: 82 },
  satisfying: { FACEBOOK: 70, YOUTUBE: 82, INSTAGRAM: 90, SHARECHAT: 88, MOJ: 88 },
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

function circularMinuteDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 1440 - d);
}

function scoreFromMinuteDiff(diff: number): number {
  if (diff <= 30) return 95;
  if (diff <= 60) return 86;
  if (diff <= 120) return 75;
  if (diff <= 240) return 62;
  return 48;
}

export interface NicheScoreConfig {
  nicheId: string;
  artStyleId: string;
  languageId: string;
  toneId: string;
  /** Post times "HH:MM" (e.g. from automation.postTime split by comma) */
  times: string[];
  /** Optional: voice name + description for voice component; if omitted uses default 70 */
  voiceText?: string;
}

export interface NicheScoreResult {
  overall: number;
  perPlatform: Record<string, number>;
}

/**
 * Compute niche potential score (0–100) for the given config.
 * Used by Report page to show current vs projected score in suggestions.
 */
export function computeNicheScore(
  config: NicheScoreConfig,
  timezone: string,
): NicheScoreResult {
  const { nicheId, artStyleId, languageId, toneId, times, voiceText } = config;
  const nicheDef = NICHES.find((n) => n.id === nicheId);
  const baseByPlatform = NICHE_PLATFORM_BASE[nicheId] ?? {
    FACEBOOK: 68,
    YOUTUBE: 68,
    INSTAGRAM: 68,
    SHARECHAT: 68,
    MOJ: 68,
  };
  const schedule = getScheduleForNiche(nicheId, languageId);
  const recommendedLocalSlots = schedule.slots.map((s) =>
    hmToMinutes(convertTime(s.time, schedule.viewerTimezone, timezone)),
  );
  const selectedMins = (
    times.length > 0
      ? times
      : [
          recommendedLocalSlots[0] != null
            ? `${String(Math.floor(recommendedLocalSlots[0] / 60)).padStart(2, "0")}:${String(recommendedLocalSlots[0] % 60).padStart(2, "0")}`
            : "12:00",
        ]
  ).map(hmToMinutes);
  const bestDiff =
    recommendedLocalSlots.length > 0
      ? Math.min(
          ...selectedMins.flatMap((sm) =>
            recommendedLocalSlots.map((rm) => circularMinuteDiff(sm, rm)),
          ),
        )
      : 180;
  const timeBase = scoreFromMinuteDiff(bestDiff);

  const artBase = artStyleId === nicheDef?.defaultArtStyle ? 92 : 72;
  const toneBase = toneId === nicheDef?.defaultTone ? 90 : 70;
  const languageBase = languageId === "en" ? 80 : languageId === "hi" ? 84 : 72;
  const text = (voiceText ?? "").toLowerCase();
  const voiceBase =
    toneId === "dramatic" && /deep|narrator|authoritative|intense/.test(text)
      ? 90
      : toneId === "educational" && /clear|professional|calm|steady/.test(text)
        ? 88
        : toneId === "casual" && /friendly|warm|natural|conversational/.test(text)
          ? 86
          : toneId === "funny" && /friendly|warm|energetic|upbeat|cheerful/.test(text)
            ? 88
            : voiceText
              ? 78
              : 70;

  const perPlatform: Record<string, number> = {};
  for (const platform of PLATFORMS) {
    const topic = baseByPlatform[platform] ?? 68;
    const art =
      platform === "INSTAGRAM" || platform === "SHARECHAT" || platform === "MOJ"
        ? artBase + 2
        : platform === "YOUTUBE"
          ? artBase - 1
          : artBase;
    const voice = platform === "YOUTUBE" ? voiceBase + 3 : voiceBase;
    const lang =
      (platform === "FACEBOOK" || platform === "SHARECHAT" || platform === "MOJ") &&
      languageId === "hi"
        ? languageBase + 4
        : languageBase;
    const time =
      platform === "INSTAGRAM" || platform === "SHARECHAT" || platform === "MOJ"
        ? timeBase + 2
        : timeBase;
    const raw = (topic * SCORE_WEIGHTS.topic +
      art * SCORE_WEIGHTS.art +
      voice * SCORE_WEIGHTS.voice +
      lang * SCORE_WEIGHTS.language +
      toneBase * SCORE_WEIGHTS.tone +
      time * SCORE_WEIGHTS.time) / 100;
    perPlatform[platform] = Number.isFinite(raw) ? clamp(raw) : 0;
  }

  const rawOverall = PLATFORMS.reduce((sum, p) => sum + perPlatform[p], 0) / PLATFORMS.length;
  const overall = Number.isFinite(rawOverall) ? clamp(rawOverall) : 0;
  return { overall, perPlatform };
}

export interface NicheScoreSuggestion {
  label: string;
  newScore: number;
}

/**
 * Returns suggestions that would increase niche score over the current config.
 * Used by Report page and Automation edit page.
 */
export function getSuggestionsToImproveScore(
  config: NicheScoreConfig,
  timezone: string,
): { currentScore: number; suggestions: NicheScoreSuggestion[] } {
  const tz = timezone || "UTC";
  const currentScore = computeNicheScore(config, tz).overall;
  const suggestions: NicheScoreSuggestion[] = [];
  const seen = new Set<string>();

  for (const n of NICHES) {
    if (n.id === config.nicheId) continue;
    const altConfig: NicheScoreConfig = {
      nicheId: n.id,
      artStyleId: n.defaultArtStyle,
      languageId: config.languageId,
      toneId: n.defaultTone,
      times: config.times,
    };
    const res = computeNicheScore(altConfig, tz);
    if (res.overall > currentScore) {
      const key = `niche-${n.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        suggestions.push({ label: `Switch to ${n.name}`, newScore: res.overall });
      }
    }
  }

  const nicheDef = NICHES.find((n) => n.id === config.nicheId);
  if (nicheDef) {
    if (config.artStyleId !== nicheDef.defaultArtStyle) {
      const altConfig: NicheScoreConfig = { ...config, artStyleId: nicheDef.defaultArtStyle };
      const res = computeNicheScore(altConfig, tz);
      if (res.overall > currentScore) {
        suggestions.push({
          label: `Use recommended art: ${nicheDef.defaultArtStyle.replace(/-/g, " ")}`,
          newScore: res.overall,
        });
      }
    }
    if (config.toneId !== nicheDef.defaultTone) {
      const altConfig: NicheScoreConfig = { ...config, toneId: nicheDef.defaultTone };
      const res = computeNicheScore(altConfig, tz);
      if (res.overall > currentScore) {
        suggestions.push({
          label: `Use recommended tone: ${nicheDef.defaultTone}`,
          newScore: res.overall,
        });
      }
    }
    const schedule = getScheduleForNiche(config.nicheId, config.languageId);
    const firstSlot = schedule.slots[0];
    if (firstSlot) {
      const recommendedTime = convertTime(firstSlot.time, schedule.viewerTimezone, tz);
      const altConfig: NicheScoreConfig = { ...config, times: [recommendedTime] };
      const res = computeNicheScore(altConfig, tz);
      if (res.overall > currentScore) {
        suggestions.push({
          label: `Post at recommended time: ${recommendedTime}`,
          newScore: res.overall,
        });
      }
    }
  }

  suggestions.sort((a, b) => b.newScore - a.newScore);
  return { currentScore, suggestions };
}
