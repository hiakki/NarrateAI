import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import type { TtsProviderInterface, TTSResult } from "./types";
import { estimateSceneTimings, getAudioDuration } from "./audio-utils";

const log = createLogger("TTS:CosyVoice");

export class CosyVoiceTtsProvider implements TtsProviderInterface {
  async generateSpeech(
    scriptText: string,
    voiceId: string,
    scenes: { text: string }[]
  ): Promise<TTSResult> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not configured");

    const createResponse = await fetch(
      "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2audio/generation",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify({
          model: "cosyvoice-v2-0.5b",
          input: { text: scriptText },
          parameters: {
            voice: voiceId,
            format: "mp3",
            sample_rate: 22050,
          },
        }),
      }
    );

    if (!createResponse.ok) {
      const errBody = await createResponse.text();
      throw new Error(`CosyVoice task creation failed (${createResponse.status}): ${errBody.slice(0, 200)}`);
    }

    const createData = await createResponse.json();
    const taskId = createData.output?.task_id;
    if (!taskId) {
      throw new Error(`CosyVoice: no task_id returned: ${JSON.stringify(createData).slice(0, 200)}`);
    }

    log.log(`Task created: ${taskId}`);

    let audioUrl: string | null = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      const statusResponse = await fetch(
        `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );

      if (!statusResponse.ok) continue;

      const statusData = await statusResponse.json();
      const taskStatus = statusData.output?.task_status;

      if (taskStatus === "SUCCEEDED") {
        audioUrl = statusData.output?.results?.[0]?.url
          ?? statusData.output?.audio_url
          ?? statusData.output?.url;
        break;
      } else if (taskStatus === "FAILED") {
        throw new Error(`CosyVoice task failed: ${statusData.output?.message ?? "unknown"}`);
      }
    }

    if (!audioUrl) {
      throw new Error("CosyVoice: task timed out after 120 seconds");
    }

    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`CosyVoice: failed to download audio (${audioResponse.status})`);
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-tts-"));
    const audioPath = path.join(tmpDir, "voiceover.mp3");
    await fs.writeFile(audioPath, audioBuffer);

    const durationMs = await getAudioDuration(audioPath, "mp3");
    const sceneTimings = estimateSceneTimings(scenes, durationMs);

    log.log(`Audio saved: ${audioPath} (${durationMs}ms, ${(audioBuffer.length / 1024).toFixed(0)}KB)`);

    return { audioPath, durationMs, sceneTimings };
  }
}
