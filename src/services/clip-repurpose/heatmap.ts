import { createLogger } from "@/lib/logger";
import type { HeatmapPoint } from "./downloader";

const log = createLogger("ClipHeatmap");

export interface PeakSegment {
  startSec: number;
  endSec: number;
  avgHeat: number;
  peakHeat: number;
}

/**
 * Sliding-window algorithm to find the highest-engagement segment
 * from YouTube's "Most Replayed" heatmap data.
 *
 * Heatmap is typically ~100 evenly-spaced data points covering the
 * entire video. Each point has a normalized `value` (0-1) representing
 * relative viewer engagement.
 */
export function findPeakSegment(
  heatmap: HeatmapPoint[],
  videoDurationSec: number,
  clipDurationSec: number,
): PeakSegment {
  if (heatmap.length === 0) {
    return { startSec: 0, endSec: Math.min(clipDurationSec, videoDurationSec), avgHeat: 0, peakHeat: 0 };
  }

  let bestStart = 0;
  let bestAvg = 0;
  let bestPeak = 0;

  const lastValidStart = Math.max(0, videoDurationSec - clipDurationSec);
  const step = Math.max(1, Math.floor(clipDurationSec / 4));

  for (let windowStart = 0; windowStart <= lastValidStart; windowStart += step) {
    const windowEnd = windowStart + clipDurationSec;

    let sum = 0;
    let count = 0;
    let peak = 0;

    for (const point of heatmap) {
      const pointMid = (point.start_time + point.end_time) / 2;
      if (pointMid >= windowStart && pointMid < windowEnd) {
        sum += point.value;
        count++;
        if (point.value > peak) peak = point.value;
      }
    }

    const avg = count > 0 ? sum / count : 0;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestStart = windowStart;
      bestPeak = peak;
    }
  }

  const endSec = Math.min(bestStart + clipDurationSec, videoDurationSec);

  log.log(`Peak segment: ${bestStart.toFixed(0)}-${endSec.toFixed(0)}s (avg heat: ${bestAvg.toFixed(3)}, peak: ${bestPeak.toFixed(3)})`);

  return {
    startSec: Math.floor(bestStart),
    endSec: Math.floor(endSec),
    avgHeat: bestAvg,
    peakHeat: bestPeak,
  };
}

/**
 * Fallback: when no heatmap is available, use LLM to analyze the transcript
 * and identify the most engaging segment.
 */
export async function findPeakViaTranscript(
  transcript: string,
  videoDurationSec: number,
  clipDurationSec: number,
): Promise<PeakSegment> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !transcript.trim()) {
    log.warn("No API key or transcript for LLM fallback — using video midpoint");
    const mid = Math.max(0, (videoDurationSec - clipDurationSec) / 2);
    return { startSec: Math.floor(mid), endSec: Math.floor(mid + clipDurationSec), avgHeat: 0.5, peakHeat: 0.5 };
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are a viral video editor. Given this video transcript, identify the single most engaging, shocking, or funny ${clipDurationSec}-second segment that would perform best as a standalone short/reel.

Video duration: ${videoDurationSec} seconds.
Target clip: ${clipDurationSec} seconds.

Transcript:
${transcript.slice(0, 8000)}

Reply with ONLY a JSON object (no markdown):
{"startSec": <number>, "endSec": <number>, "reason": "<1 sentence>"}`,
    });

    const text = response.text?.trim() ?? "";
    const jsonStr = text.replace(/^```json?\n?|\n?```$/g, "").trim();
    const parsed = JSON.parse(jsonStr) as { startSec: number; endSec: number; reason?: string };

    const start = Math.max(0, Math.min(parsed.startSec, videoDurationSec - clipDurationSec));
    const end = Math.min(start + clipDurationSec, videoDurationSec);

    log.log(`LLM peak: ${start}-${end}s${parsed.reason ? ` — ${parsed.reason}` : ""}`);
    return { startSec: Math.floor(start), endSec: Math.floor(end), avgHeat: 0.7, peakHeat: 0.7 };
  } catch (err) {
    log.warn(`LLM peak detection failed: ${err instanceof Error ? err.message : err}`);
    const mid = Math.max(0, (videoDurationSec - clipDurationSec) / 2);
    return { startSec: Math.floor(mid), endSec: Math.floor(mid + clipDurationSec), avgHeat: 0.5, peakHeat: 0.5 };
  }
}
