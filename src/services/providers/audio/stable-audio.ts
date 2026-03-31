/**
 * Audio generation via Stable Audio Open Gradio Space (ZeroGPU).
 * Used as fallback when HF Inference API credits are depleted.
 * Generates both BGM and SFX from text prompts — no API key required.
 */

import fs from "fs/promises";
import { createLogger } from "@/lib/logger";

const log = createLogger("StableAudio");

const SPACE_BASE = "https://artificialguybr-stable-audio-open-zero.hf.space";
const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 180_000; // 3 min — ZeroGPU queue + generation

interface StableAudioOptions {
  prompt: string;
  /** Duration in seconds (the model may produce longer audio; we trim via ffmpeg). */
  durationSec?: number;
  /** Diffusion steps (fewer = faster, more = better quality). Default 50. */
  steps?: number;
  /** CFG guidance scale. Default 5. */
  cfgScale?: number;
  outputPath: string;
}

/**
 * Generate audio via Stable Audio Open Gradio Space.
 * Returns outputPath on success, null on transient/queue failures.
 */
export async function generateViaStableAudio(opts: StableAudioOptions): Promise<string | null> {
  const { prompt, durationSec = 5, steps = 50, cfgScale = 5, outputPath } = opts;

  log.debug(`Submitting: "${prompt.slice(0, 80)}…" (${durationSec}s, ${steps} steps)`);

  let eventId: string;
  try {
    const submitRes = await fetch(`${SPACE_BASE}/gradio_api/call/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [prompt, durationSec, steps, cfgScale] }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
    if (!submitRes.ok) {
      const body = await submitRes.text().catch(() => "");
      log.warn(`Submit failed ${submitRes.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const submitJson = (await submitRes.json()) as { event_id: string };
    eventId = submitJson.event_id;
  } catch (err) {
    log.warn(`Submit error: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  log.debug(`Job submitted: ${eventId}`);

  try {
    const sseRes = await fetch(`${SPACE_BASE}/gradio_api/call/predict/${eventId}`, {
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    if (!sseRes.ok) {
      log.warn(`Poll failed ${sseRes.status}`);
      return null;
    }
    const sseText = await sseRes.text();

    const completeMatch = sseText.match(/event:\s*complete\ndata:\s*(.+)/);
    if (!completeMatch) {
      const errorMatch = sseText.match(/event:\s*error\ndata:\s*(.+)/);
      if (errorMatch) log.warn(`Space error: ${errorMatch[1].slice(0, 200)}`);
      else log.warn(`No completion event: ${sseText.slice(0, 200)}`);
      return null;
    }

    const data = JSON.parse(completeMatch[1]) as unknown[];
    const fileInfo = data[0] as { url?: string; path?: string };
    let audioUrl = fileInfo?.url ?? "";
    if (!audioUrl && fileInfo?.path) {
      audioUrl = `${SPACE_BASE}/gradio_api/file=${fileInfo.path}`;
    }
    if (!audioUrl) {
      log.warn("No audio URL in response");
      return null;
    }

    const dlRes = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) });
    if (!dlRes.ok) {
      log.warn(`Download failed ${dlRes.status}`);
      return null;
    }

    const buffer = Buffer.from(await dlRes.arrayBuffer());
    if (buffer.length < 1000) {
      log.warn(`Audio too small (${buffer.length} bytes)`);
      return null;
    }

    await fs.writeFile(outputPath, buffer);
    log.log(`Generated ${(buffer.length / 1024).toFixed(0)}KB audio → ${outputPath}`);
    return outputPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|abort/i.test(msg)) {
      log.warn("Generation timed out (ZeroGPU queue full)");
    } else {
      log.warn(`Poll error: ${msg.slice(0, 200)}`);
    }
    return null;
  }
}
