import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { getTtsProvider, getImageProvider } from "../src/services/providers/factory";
import { resolveVoiceForProvider } from "../src/config/voices";
import { assembleVideo } from "../src/services/video-assembler";
import { buildImagePrompt } from "../src/services/providers/image/prompt-builder";
import { getArtStyleById } from "../src/config/art-styles";
import { expandScenesToImageSlots } from "../src/services/scene-expander";
import { postVideoToSocials } from "../src/services/social-poster";
import { createLogger } from "../src/lib/logger";
import {
  buildVideoRelDir, videoRelUrl, videoAbsDir, videoAbsPath,
  scenesAbsDir, voiceoverAbsPath, contextAbsPath, scriptAbsPath,
} from "../src/lib/video-paths";
import { buildPrompt, getSceneCount } from "../src/services/providers/llm/prompt";
import { generateScript } from "../src/services/script-generator";
import path from "path";
import fs from "fs/promises";
import type { VideoJobData } from "../src/services/queue";

const WORKER_ID = process.env.INSTANCE_ID ?? `worker-${process.pid}`;
const log = createLogger("Worker");
const db = new PrismaClient();
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

interface Checkpoint {
  audioPath?: string;
  durationMs?: number;
  sceneTimings?: { startMs: number; endMs: number }[];
  imagePaths?: string[];
  imageTmpDir?: string;
  completedStages?: string[];
  totalImageCount?: number;
  imagePrompts?: string[];
  expandedTimings?: { startMs: number; endMs: number }[];
  reviewMode?: boolean;
  musicPath?: string;
  relDir?: string;
}

async function updateStage(videoId: string, stage: string) {
  await db.video.update({
    where: { id: videoId },
    data: { generationStage: stage as never, status: "GENERATING" },
  });
}

async function saveCheckpoint(videoId: string, checkpoint: Checkpoint) {
  await db.video.update({
    where: { id: videoId },
    data: { checkpointData: checkpoint as never },
  });
}

async function loadCheckpoint(videoId: string): Promise<Checkpoint> {
  const video = await db.video.findUnique({ where: { id: videoId }, select: { checkpointData: true } });
  return (video?.checkpointData as Checkpoint) ?? {};
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

const worker = new Worker<VideoJobData>(
  "video-generation",
  async (job) => {
    const {
      videoId, userId, userName, automationName, artStylePrompt, negativePrompt,
      voiceId, language, musicPath, ttsProvider, imageProvider, llmProvider,
      tone, niche, artStyle, reviewMode,
    } = job.data;

    let title = job.data.title;
    let scriptText = job.data.scriptText;
    let scenes = job.data.scenes;

    if (!ttsProvider || !imageProvider) {
      throw new Error(`Invalid job data: missing tts=${ttsProvider}, image=${imageProvider}`);
    }

    const checkpoint = await loadCheckpoint(videoId);
    const completed = new Set(checkpoint.completedStages ?? []);

    // ── Generate script if not provided (trigger route delegates this to the worker) ──
    if (!scenes?.length && !completed.has("SCRIPT")) {
      await updateStage(videoId, "SCRIPT");
      log.log(`SCRIPT generating for ${videoId} (LLM=${llmProvider})…`);
      const script = await generateScript(
        { niche: niche ?? "", tone: tone ?? "dramatic", artStyle: artStyle ?? "", duration: job.data.duration, language: language ?? "en" },
        llmProvider,
      );
      title = script.title;
      scriptText = script.fullScript;
      scenes = script.scenes;
      await db.video.update({
        where: { id: videoId },
        data: { title, scriptText, scenesJson: scenes as never },
      });
    }

    if (!scenes?.length) {
      throw new Error(`No scenes available for ${videoId} after script generation`);
    }
    if (!scriptText) scriptText = scenes.map((s) => s.text).join(" ");
    if (!title) title = "Untitled";

    const isResume = !!checkpoint.relDir;
    const relDir = checkpoint.relDir ?? buildVideoRelDir(userId, userName, title, videoId, automationName);
    const absDir = videoAbsDir(relDir);
    const scDir = scenesAbsDir(relDir);
    await fs.mkdir(scDir, { recursive: true });

    await fs.unlink(scriptAbsPath(relDir)).catch(() => {});

    log.log(`START ${videoId} | LLM=${llmProvider} TTS=${ttsProvider} IMG=${imageProvider} | scenes=${scenes.length} resumed=[${[...completed].join(",")}]`);
    log.log(`${isResume ? "RESUME" : "CREATED"} dir: public/${relDir}/`);

    let audioPath = checkpoint.audioPath;
    let durationMs = checkpoint.durationMs;
    let sceneTimings = checkpoint.sceneTimings;
    let imagePaths = checkpoint.imagePaths;

    const ctx: string[] = [];
    const sep = "═".repeat(70);

    function ctxSection(heading: string, ...blocks: string[]) {
      ctx.push(`\n${sep}\n  ${heading}\n${sep}\n`);
      for (const b of blocks) ctx.push(b.trim() + "\n");
    }

    ctx.push(`CONTEXT LOG — ${title}\nVideo ID : ${videoId}\nUser     : ${userName} (${userId})\nCreated  : ${new Date().toISOString()}\n`);
    ctx.push(`Providers: LLM=${llmProvider}  TTS=${ttsProvider}  Image=${imageProvider}`);
    ctx.push(`Niche=${niche}  Tone=${tone}  Art=${artStyle}  Duration=${job.data.duration}s  Language=${language ?? "en"}\n`);

    try {
      // ── Script (log to context.txt) ──
      if (!completed.has("SCRIPT")) {
        await updateStage(videoId, "SCRIPT");
        await db.video.update({ where: { id: videoId }, data: { scriptText, title } });

        const sceneCount = getSceneCount(job.data.duration);
        const llmPrompt = buildPrompt({
          niche: niche ?? "", tone: tone ?? "dramatic",
          artStyle: artStyle ?? "", duration: job.data.duration,
          topic: undefined, language: language ?? "en",
        }, sceneCount);

        ctxSection("1 · SCRIPT GENERATION (LLM)",
          "── SCRIPT (full narration text) ──\n" + scriptText,
          "\n── PROMPT SENT TO AI ──\n" + llmPrompt,
          "\n── AI RESPONSE ──\nTitle: " + title,
          "Scenes: " + scenes.length,
          ...scenes.map((s, i) =>
            `\n  Scene ${i + 1} narration:\n    "${s.text}"\n  Scene ${i + 1} visual:\n    "${s.visualDescription}"`
          ),
        );

        completed.add("SCRIPT");
        await saveCheckpoint(videoId, { ...checkpoint, completedStages: [...completed], relDir });
        log.log(`SCRIPT done "${title}" (${scriptText.length} chars)`);
      }

      // ── TTS ──
      if (!completed.has("TTS") || !audioPath || !(await fileExists(audioPath))) {
        await updateStage(videoId, "TTS");
        const resolvedVoice = resolveVoiceForProvider(ttsProvider, voiceId, language);
        const tts = getTtsProvider(ttsProvider);
        const ttsResult = await tts.generateSpeech(scriptText, resolvedVoice, scenes);
        audioPath = ttsResult.audioPath;
        durationMs = ttsResult.durationMs;
        sceneTimings = ttsResult.sceneTimings;

        const ext = audioPath.endsWith(".wav") ? "wav" : "mp3";
        const localVoiceover = voiceoverAbsPath(relDir, ext);
        await fs.copyFile(audioPath, localVoiceover);

        ctxSection("2 · AUDIO GENERATION (TTS)",
          `── REQUEST ──\nProvider : ${ttsProvider}\nVoice    : ${resolvedVoice}\nLanguage : ${language ?? "en"}\nText length: ${scriptText.length} chars`,
          `\n── RESULT ──\nDuration : ${(durationMs / 1000).toFixed(1)}s\nFormat   : ${ext}\nTimings  : ${sceneTimings?.length ?? 0} segments\nFile     : voiceover.${ext}`,
        );

        await db.video.update({ where: { id: videoId }, data: { voiceoverUrl: localVoiceover } });
        completed.add("TTS");
        await saveCheckpoint(videoId, {
          completedStages: [...completed], relDir,
          audioPath: localVoiceover, durationMs, sceneTimings,
          imagePaths,
        });
        audioPath = localVoiceover;
        log.log(`TTS done ${durationMs}ms (${ttsProvider}, voice=${resolvedVoice})`);
      } else {
        log.debug(`TTS skipped (checkpoint ${durationMs}ms)`);
      }

      // ── Expand scenes ──
      const { slots: imageSlots, timings: expandedTimings } = expandScenesToImageSlots(scenes, durationMs!);

      // ── Images ──
      const targetImageCount = imageSlots.length;
      const allImagesExist = imagePaths && imagePaths.length === targetImageCount &&
        await Promise.all(imagePaths.map(fileExists)).then(r => r.every(Boolean));

      if (!completed.has("IMAGES") || !allImagesExist) {
        await updateStage(videoId, "IMAGES");
        const resolvedArtStyle = getArtStyleById(artStyle);
        const resolvedNeg = negativePrompt ?? resolvedArtStyle?.negativePrompt ?? "low quality, blurry, watermark, text";

        let enhancedSlots = imageSlots.map((s) => ({ ...s }));
        if (resolvedArtStyle) {
          enhancedSlots = imageSlots.map((s, i) => {
            const built = buildImagePrompt(s.visualDescription, resolvedArtStyle, i, imageSlots.length);
            return { ...s, visualDescription: built.prompt };
          });
        }

        const imagePrompts = enhancedSlots.map(s => s.visualDescription);

        ctxSection("3 · IMAGE GENERATION",
          `── REQUEST ──\nProvider : ${imageProvider}\nArt style: ${artStyle}\nNeg prompt: ${resolvedNeg.slice(0, 120)}...\nImages   : ${targetImageCount}`,
          "\n── PROMPTS SENT TO AI ──",
          ...imagePrompts.map((p, i) => `\n  Image ${i + 1}/${imagePrompts.length}:\n    ${p}`),
          `\n── RESULT ──\n${targetImageCount} images generated → scenes/ directory`,
        );

        log.log(`IMAGES generating ${targetImageCount} (${imageProvider})`);

        const img = getImageProvider(imageProvider);
        const imgResult = await img.generateImages(enhancedSlots, artStylePrompt, resolvedNeg, async (index, srcPath) => {
          const ext = path.extname(srcPath) || ".png";
          const dest = path.join(scDir, `scene-${index.toString().padStart(3, "0")}${ext}`);
          await fs.copyFile(srcPath, dest);
        });
        imagePaths = imgResult.imagePaths;

        completed.add("IMAGES");
        await saveCheckpoint(videoId, {
          completedStages: [...completed], relDir,
          audioPath, durationMs, sceneTimings: expandedTimings,
          imagePaths,
          expandedTimings,
          reviewMode,
          musicPath,
        });
        log.log(`IMAGES done ${imagePaths.length} images`);

        if (reviewMode) {
          await fs.writeFile(contextAbsPath(relDir), ctx.join("\n"), "utf-8");
          await db.video.update({
            where: { id: videoId },
            data: { status: "REVIEW", generationStage: null, voiceoverUrl: audioPath },
          });
          log.log(`REVIEW paused ${videoId}`);
          return;
        }
      } else {
        for (let i = 0; i < imagePaths!.length; i++) {
          const ext = path.extname(imagePaths![i]) || ".png";
          const dest = path.join(scDir, `scene-${i.toString().padStart(3, "0")}${ext}`);
          if (!(await fileExists(dest))) await fs.copyFile(imagePaths![i], dest);
        }
        log.debug(`IMAGES skipped (checkpoint ${imagePaths!.length})`);
      }

      // ── Assembly ──
      await updateStage(videoId, "ASSEMBLY");
      const outputPath = videoAbsPath(relDir);

      let resolvedMusicPath: string | undefined;
      if (musicPath) {
        const fullMusicPath = path.join(process.cwd(), "public", "music", `${musicPath}.mp3`);
        if (await fileExists(fullMusicPath)) resolvedMusicPath = fullMusicPath;
      }

      ctxSection("4 · VIDEO ASSEMBLY",
        `Images: ${imagePaths!.length}  Audio: ${(durationMs! / 1000).toFixed(1)}s  Music: ${resolvedMusicPath ? musicPath : "none"}`,
        `Output: video.mp4`,
      );

      await assembleVideo({
        imagePaths: imagePaths!,
        audioPath: audioPath!,
        sceneTimings: expandedTimings,
        scenes: imageSlots,
        captionScenes: scenes,
        captionTimings: sceneTimings!,
        musicPath: resolvedMusicPath,
        outputPath,
        tone: tone ?? "dramatic",
        niche: niche ?? "",
        language: language ?? "en",
      });
      log.log(`ASSEMBLY done`);

      await fs.writeFile(contextAbsPath(relDir), ctx.join("\n"), "utf-8");

      // ── Finalize ──
      await updateStage(videoId, "UPLOADING");
      const relVideoUrl = videoRelUrl(relDir);
      await db.video.update({
        where: { id: videoId },
        data: {
          status: "READY",
          generationStage: null,
          videoUrl: relVideoUrl,
          duration: durationMs ? Math.round(durationMs / 1000) : null,
          checkpointData: null,
        },
      });

      log.log(`READY ${videoId} → ${relVideoUrl}`);

      try {
        const results = await postVideoToSocials(videoId);
        if (results.length > 0) {
          const posted = results.filter((r) => r.success).map((r) => r.platform);
          const failed = results.filter((r) => !r.success).map((r) => `${r.platform}: ${r.error}`);
          if (posted.length > 0) log.log(`POSTED ${videoId} → ${posted.join(", ")}`);
          if (failed.length > 0) log.warn(`POST_FAIL ${videoId}: ${failed.join("; ")}`);
        }
      } catch (postErr) {
        log.warn(`POST_ERR ${videoId}:`, postErr);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      log.error(`FAILED ${videoId}: ${msg}`);

      try {
        await db.video.update({
          where: { id: videoId },
          data: { status: "FAILED", generationStage: null, errorMessage: msg.slice(0, 500) },
        });
      } catch (dbErr) {
        log.error(`CRITICAL db update failed for ${videoId}:`, dbErr);
      }

      throw error;
    }
  },
  { connection: redis as never, concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "2", 10) }
);

worker.on("completed", (job) => log.log(`JOB_DONE ${job.id}`));
worker.on("failed", (job, err) => log.error(`JOB_FAIL ${job?.id}: ${err.message}`));

log.log(`${WORKER_ID} started (concurrency=${worker.opts.concurrency})`);
