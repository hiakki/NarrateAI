import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { getTtsProvider, getImageProvider } from "../src/services/providers/factory";
import { TTS_PROVIDERS, IMAGE_PROVIDERS } from "../src/config/providers";
import { resolveVoiceForProvider } from "../src/config/voices";
import { assembleVideo, isValidAudioFile } from "../src/services/video-assembler";
import { generateClipsFromImages, buildImageToVideoPrompt, isValidMp4File } from "../src/services/image-to-video";
import { buildImagePrompt } from "../src/services/providers/image/prompt-builder";
import { getArtStyleById } from "../src/config/art-styles";
import { expandScenesToImageSlots } from "../src/services/scene-expander";
import { postVideoToSocials } from "../src/services/social-poster";
import { createLogger, runWithVideoIdAsync } from "../src/lib/logger";
import {
  buildVideoRelDir, videoRelUrl, videoAbsDir, videoAbsPath,
  scenesAbsDir, voiceoverAbsPath, contextAbsPath, scriptAbsPath,
} from "../src/lib/video-paths";
import { buildPrompt, getSceneCount } from "../src/services/providers/llm/prompt";
import { generateScript } from "../src/services/script-generator";
import { generateBGM } from "../src/services/providers/audio/musicgen";
import { generateAllSFX } from "../src/services/providers/audio/audiogen";
import { createSfxTrack } from "../src/services/providers/audio/sfx-mixer";
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
  stageTimings?: Record<string, { startedAt: number; completedAt: number; durationMs: number }>;
  imageToVideoProvider?: string;
  generatedBgmPath?: string;
  sfxTrackPath?: string;
  /** Tracks the providers that actually generated each component (may differ from selected due to fallback). */
  usedProviders?: { tts?: string; image?: string; i2v?: string; bgm?: string; sfx?: string };
}

async function updateStage(videoId: string, stage: string) {
  try {
    await db.video.update({
      where: { id: videoId },
      data: { generationStage: stage as never, status: "GENERATING" },
    });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
      throw new Error(`Video ${videoId} no longer exists (deleted during job)`);
    }
    throw e;
  }
}

function recordStageStart(checkpoint: Checkpoint, stage: string) {
  checkpoint.stageTimings = checkpoint.stageTimings ?? {};
  checkpoint.stageTimings[stage] = {
    startedAt: Date.now(),
    completedAt: 0,
    durationMs: 0,
  };
}

function recordStageEnd(checkpoint: Checkpoint, stage: string) {
  const entry = checkpoint.stageTimings?.[stage];
  if (entry && entry.startedAt) {
    entry.completedAt = Date.now();
    entry.durationMs = entry.completedAt - entry.startedAt;
  }
}

async function saveCheckpoint(videoId: string, checkpoint: Checkpoint) {
  try {
    await db.video.update({
      where: { id: videoId },
      data: { checkpointData: checkpoint as never },
    });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
      throw new Error(`Video ${videoId} no longer exists (deleted during job)`);
    }
    throw e;
  }
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
      tone, niche, artStyle, reviewMode, characterPrompt, imageToVideoProvider,
      aspectRatio: jobAspectRatio,
    } = job.data;
    const aspectRatio = jobAspectRatio ?? "9:16";

    return runWithVideoIdAsync(videoId, async () => {
    const videoExists = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
    if (!videoExists) {
      throw new Error(`Video ${videoId} no longer exists (deleted before job ran). Job abandoned.`);
    }

    let title = job.data.title;
    let scriptText = job.data.scriptText;
    let scenes = job.data.scenes;

    if (!ttsProvider || !imageProvider) {
      throw new Error(`Invalid job data: missing tts=${ttsProvider}, image=${imageProvider}`);
    }

    const checkpoint = await loadCheckpoint(videoId);
    const completed = new Set(checkpoint.completedStages ?? []);

    if (imageToVideoProvider && checkpoint.imageToVideoProvider !== imageToVideoProvider) {
      checkpoint.imageToVideoProvider = imageToVideoProvider;
      await saveCheckpoint(videoId, checkpoint);
    }

    // ── Generate script if not provided (trigger route delegates this to the worker) ──
    if (!scenes?.length && !completed.has("SCRIPT")) {
      recordStageStart(checkpoint, "SCRIPT");
      await saveCheckpoint(videoId, { ...checkpoint });
      await updateStage(videoId, "SCRIPT");
      log.log(`[SCRIPT]`, `SCRIPT generating (LLM=${llmProvider})…`);

      const seriesId = job.data.seriesId;
      const recentVideos = seriesId
        ? await db.video.findMany({
            where: { seriesId, id: { not: videoId }, title: { not: null } },
            orderBy: { createdAt: "desc" },
            take: 8,
            select: { title: true, scriptText: true },
          })
        : [];
      const avoidThemes: string[] = [];
      for (const v of recentVideos) {
        if (v.title) avoidThemes.push(v.title);
        if (v.scriptText) {
          const firstLine = v.scriptText.split(/[.\n]/).filter(Boolean)[0]?.trim();
          if (firstLine && firstLine.length > 10) avoidThemes.push(`Opening line: "${firstLine.slice(0, 80)}"`);
        }
      }
      const varietySeed = `${Date.now()}-${videoId.slice(-6)}`;

      const scriptInput = {
        niche: niche ?? "",
        tone: tone ?? "dramatic",
        artStyle: artStyle ?? "",
        duration: job.data.duration,
        language: language ?? "en",
        avoidThemes: avoidThemes.length > 0 ? avoidThemes : undefined,
        varietySeed,
        videoId,
      };
      const script = await generateScript(
        scriptInput,
        llmProvider,
        characterPrompt,
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

    log.log(`[START]`, `LLM=${llmProvider} TTS=${ttsProvider} IMG=${imageProvider} | scenes=${scenes.length} resumed=[${[...completed].join(",")}]`);
    log.log(`[START]`, `${isResume ? "RESUME" : "CREATED"} dir: public/${relDir}/`);

    checkpoint.usedProviders = {
      tts: TTS_PROVIDERS[ttsProvider]?.name ?? ttsProvider,
      image: IMAGE_PROVIDERS[imageProvider]?.name ?? imageProvider,
    };

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
    ctx.push(`Niche=${niche}  Tone=${tone}  Art=${artStyle}  Duration=${job.data.duration}s  Language=${language ?? "en"}`);
    ctx.push(`Video Style: ${characterPrompt ? "Star Mode" : "Faceless"}`);
    if (characterPrompt) ctx.push(`Character Prompt: ${characterPrompt}`);
    ctx.push("");

    try {
      // ── Script (log to context.txt) ──
      if (!completed.has("SCRIPT")) {
        if (!checkpoint.stageTimings?.SCRIPT?.startedAt) {
          recordStageStart(checkpoint, "SCRIPT");
        }
        await updateStage(videoId, "SCRIPT");
        await db.video.update({ where: { id: videoId }, data: { scriptText, title } });

        const sceneCount = getSceneCount(job.data.duration);
        const llmPrompt = buildPrompt({
          niche: niche ?? "", tone: tone ?? "dramatic",
          artStyle: artStyle ?? "", duration: job.data.duration,
          topic: undefined, language: language ?? "en",
        }, sceneCount, characterPrompt);

        ctxSection("1 · SCRIPT GENERATION (LLM)",
          "── SCRIPT (full narration text) ──\n" + scriptText,
          "\n── PROMPT SENT TO AI ──\n" + llmPrompt,
          "\n── AI RESPONSE ──\nTitle: " + title,
          "Scenes: " + scenes.length,
          ...scenes.map((s, i) =>
            `\n  Scene ${i + 1} narration:\n    "${s.text}"\n  Scene ${i + 1} visual:\n    "${s.visualDescription}"`
          ),
        );

        recordStageEnd(checkpoint, "SCRIPT");
        completed.add("SCRIPT");
        await saveCheckpoint(videoId, { ...checkpoint, completedStages: [...completed], relDir });
        log.log(`[SCRIPT]`, `SCRIPT done "${title}" (${scriptText.length} chars). Full input prompt and LLM output logged in public/${relDir}/context.txt`);
      }

      // ── TTS ──
      const audioValid = audioPath && (await fileExists(audioPath)) && (await isValidAudioFile(audioPath));
      if (!completed.has("TTS") || !audioPath || !(await fileExists(audioPath)) || !audioValid) {
        if (audioPath && !audioValid && completed.has("TTS")) {
          log.warn(`[TS]`, `Voiceover file invalid or corrupted, re-running TTS: ${audioPath}`);
        }
        recordStageStart(checkpoint, "TTS");
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
        recordStageEnd(checkpoint, "TTS");
        completed.add("TTS");
        await saveCheckpoint(videoId, {
          completedStages: [...completed], relDir,
          audioPath: localVoiceover, durationMs, sceneTimings,
          imagePaths,
        });
        audioPath = localVoiceover;
        log.log(`[TS]`, `TTS done ${durationMs}ms (${ttsProvider}, voice=${resolvedVoice})`);
      } else {
        log.debug(`[TS]`, `TTS skipped (checkpoint ${durationMs}ms)`);
      }

      // ── Expand scenes ──
      const { slots: imageSlots, timings: expandedTimings } = expandScenesToImageSlots(scenes, durationMs!);

      // ── Images ──
      const targetImageCount = imageSlots.length;
      const allImagesExist = imagePaths && imagePaths.length === targetImageCount &&
        await Promise.all(imagePaths.map(fileExists)).then(r => r.every(Boolean));

      if (!completed.has("IMAGES") || !allImagesExist) {
        recordStageStart(checkpoint, "IMAGES");
        await updateStage(videoId, "IMAGES");
        const resolvedArtStyle = getArtStyleById(artStyle);
        const resolvedNeg = negativePrompt ?? resolvedArtStyle?.negativePrompt ?? "low quality, blurry, watermark, text";

        let enhancedSlots = imageSlots.map((s) => ({ ...s }));
        if (resolvedArtStyle) {
          enhancedSlots = imageSlots.map((s, i) => {
            const built = buildImagePrompt(s.visualDescription, resolvedArtStyle, i, imageSlots.length, characterPrompt, aspectRatio);
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

        log.log(`[IMG]`, `IMAGES generating ${targetImageCount} (${imageProvider})`);

        const img = getImageProvider(imageProvider);
        const imgResult = await img.generateImages(enhancedSlots, artStylePrompt, resolvedNeg, async (index, srcPath) => {
          const ext = path.extname(srcPath) || ".png";
          const dest = path.join(scDir, `scene-${index.toString().padStart(3, "0")}${ext}`);
          await fs.copyFile(srcPath, dest);
        }, { aspectRatio });
        imagePaths = imgResult.imagePaths;

        recordStageEnd(checkpoint, "IMAGES");
        completed.add("IMAGES");
        await saveCheckpoint(videoId, {
          completedStages: [...completed], relDir,
          audioPath, durationMs, sceneTimings: expandedTimings,
          imagePaths,
          expandedTimings,
          reviewMode,
          musicPath,
        });
        log.log(`[IMG]`, `IMAGES done ${imagePaths.length} images`);

        if (reviewMode) {
          await fs.writeFile(contextAbsPath(relDir), ctx.join("\n"), "utf-8");
          await db.video.update({
            where: { id: videoId },
            data: { status: "REVIEW", generationStage: null, voiceoverUrl: audioPath },
          });
          log.log(`[IMG]`, `REVIEW paused ${videoId}`);
          return;
        }
      } else {
        for (let i = 0; i < imagePaths!.length; i++) {
          const ext = path.extname(imagePaths![i]) || ".png";
          const dest = path.join(scDir, `scene-${i.toString().padStart(3, "0")}${ext}`);
          if (!(await fileExists(dest))) await fs.copyFile(imagePaths![i], dest);
        }
        log.debug(`[IMG]`, `IMAGES skipped (checkpoint ${imagePaths!.length})`);
      }

      // ── Optional: image-to-video (per-scene clips) ──
      let sceneInputs: Array<{ type: "image"; path: string } | { type: "video"; path: string }> | undefined;
      if (imageToVideoProvider && !reviewMode && imagePaths!.length > 0) {
        recordStageStart(checkpoint, "I2V");
        await updateStage(videoId, "I2V");

        // Scan for existing valid clips — skip on retry, delete corrupt ones
        const existingClips = new Map<number, string>();
        for (let i = 0; i < imagePaths!.length; i++) {
          const dest = path.join(scDir, `scene-${i.toString().padStart(3, "0")}-clip.mp4`);
          if (await fileExists(dest)) {
            if (await isValidMp4File(dest)) {
              existingClips.set(i, dest);
            } else {
              log.warn(`[I2V]`, `scene-${i.toString().padStart(3, "0")} clip corrupt, removing`);
              await fs.unlink(dest).catch(() => {});
            }
          }
        }

        const toGenerate = imagePaths!.length - existingClips.size;
        log.log(`[I2V]`, `${toGenerate} to generate, ${existingClips.size} cached — ${imageToVideoProvider}`);

        const prompts = imageSlots.map((s, i) =>
          buildImageToVideoPrompt(s.visualDescription, i, imageSlots.length),
        );
        const { results: clipResults, ctxLines: i2vCtx, actualI2VProvider } = await generateClipsFromImages(imagePaths!, {
          providerId: imageToVideoProvider,
          prompts,
          durationSec: 5,
          noFallback: process.env.I2V_FALLBACK_ENABLED === "false",
          existingClips,
          aspectRatio,
        });
        ctxSection("3.5 · IMAGE-TO-VIDEO", ...i2vCtx);
        if (actualI2VProvider) {
          checkpoint.usedProviders = { ...checkpoint.usedProviders, i2v: actualI2VProvider };
        }

        let i2vSuccess = 0;
        let i2vFallback = 0;
        sceneInputs = [];
        for (let i = 0; i < imagePaths!.length; i++) {
          const clipPath = clipResults[i];
          if (clipPath) {
            if (!existingClips.has(i)) {
              const dest = path.join(scDir, `scene-${i.toString().padStart(3, "0")}-clip.mp4`);
              await fs.copyFile(clipPath, dest);
              sceneInputs.push({ type: "video", path: dest });
            } else {
              sceneInputs.push({ type: "video", path: clipPath });
            }
            i2vSuccess++;
          } else {
            sceneInputs.push({ type: "image", path: imagePaths![i] });
            i2vFallback++;
          }
        }
        if (i2vFallback > 0) {
          log.warn(`[I2V]`, `${i2vFallback}/${imagePaths!.length} scenes fell back to static images (providers exhausted)`);
        }
        log.log(`[I2V]`, `IMAGE-TO-VIDEO done: ${i2vSuccess} clips + ${i2vFallback} static = ${sceneInputs.length} total`);
        recordStageEnd(checkpoint, "I2V");
      }

      // ── Audio FX (AI BGM + per-scene SFX) ──
      let generatedBgmPath = checkpoint.generatedBgmPath;
      let sfxTrackPath = checkpoint.sfxTrackPath;

      const bgmAlreadyDone = generatedBgmPath && await fileExists(generatedBgmPath);
      const sfxAlreadyDone = sfxTrackPath && await fileExists(sfxTrackPath);

      if (!bgmAlreadyDone || !sfxAlreadyDone) {
        log.log(`[AUDIO_FX]`, `Generating AI audio (BGM=${bgmAlreadyDone ? "cached" : "new"}, SFX=${sfxAlreadyDone ? "cached" : "new"})`);

        const [bgmResult, sfxResult] = await Promise.all([
          bgmAlreadyDone
            ? Promise.resolve(null)
            : generateBGM({
                tone: tone ?? "dramatic",
                niche: niche ?? "",
                durationSec: Math.min(20, Math.max(10, Math.round((durationMs ?? 30000) / 2000))),
                outputPath: path.join(scDir, "bgm-generated.flac"),
              }).catch((err) => {
                log.warn(`[AUDIO_FX]`, `BGM generation failed (non-fatal): ${err instanceof Error ? err.message : err}`);
                return null;
              }),
          sfxAlreadyDone
            ? Promise.resolve(null)
            : (async () => {
                const { paths: sfxPaths, sfxProvider } = await generateAllSFX(
                  imageSlots,
                  expandedTimings,
                  scDir,
                  tone,
                  2,
                );
                if (sfxProvider) {
                  checkpoint.usedProviders = { ...checkpoint.usedProviders, sfx: sfxProvider };
                }
                const mixedTrack = await createSfxTrack({
                  sfxPaths,
                  sceneTimings: expandedTimings,
                  totalDurationMs: durationMs!,
                  outputPath: path.join(scDir, "sfx-track.m4a"),
                });
                return mixedTrack;
              })().catch((err) => {
                log.warn(`[AUDIO_FX]`, `SFX generation failed (non-fatal): ${err instanceof Error ? err.message : err}`);
                return null;
              }),
        ]);

        if (bgmResult && !bgmAlreadyDone) {
          generatedBgmPath = bgmResult.path;
          checkpoint.usedProviders = { ...checkpoint.usedProviders, bgm: bgmResult.provider };
        }
        if (sfxResult && !sfxAlreadyDone) sfxTrackPath = sfxResult;

        checkpoint.generatedBgmPath = generatedBgmPath;
        checkpoint.sfxTrackPath = sfxTrackPath;
        await saveCheckpoint(videoId, { ...checkpoint });

        const bgmStatus = generatedBgmPath ? "AI-generated" : "static fallback";
        const sfxStatus = sfxTrackPath ? `${imageSlots.length} scenes` : "skipped";
        log.log(`[AUDIO_FX]`, `Done — BGM: ${bgmStatus}, SFX: ${sfxStatus}`);
      }

      // ── Assembly ──
      recordStageStart(checkpoint, "ASSEMBLY");
      await updateStage(videoId, "ASSEMBLY");
      const outputPath = videoAbsPath(relDir);

      // BGM: prefer AI-generated, fall back to static niche track
      let resolvedMusicPath: string | undefined;
      if (generatedBgmPath && await fileExists(generatedBgmPath)) {
        resolvedMusicPath = generatedBgmPath;
      } else if (musicPath) {
        const fullMusicPath = path.join(process.cwd(), "public", "music", `${musicPath}.mp3`);
        if (await fileExists(fullMusicPath)) resolvedMusicPath = fullMusicPath;
      }

      // SFX track
      let resolvedSfxPath: string | undefined;
      if (sfxTrackPath && await fileExists(sfxTrackPath)) {
        resolvedSfxPath = sfxTrackPath;
      }

      ctxSection("4 · VIDEO ASSEMBLY",
        `Images: ${imagePaths!.length}  Audio: ${(durationMs! / 1000).toFixed(1)}s  Music: ${resolvedMusicPath ? (generatedBgmPath ? "AI-generated" : musicPath!) : "none"}  SFX: ${resolvedSfxPath ? "yes" : "none"}${sceneInputs ? "  Clips: " + sceneInputs.filter((s) => s.type === "video").length : ""}`,
        `Output: video.mp4`,
      );

      await assembleVideo({
        sceneInputs,
        imagePaths: imagePaths!,
        audioPath: audioPath!,
        sceneTimings: expandedTimings,
        scenes: imageSlots,
        captionScenes: scenes,
        captionTimings: sceneTimings!,
        musicPath: resolvedMusicPath,
        sfxTrackPath: resolvedSfxPath,
        outputPath,
        tone: tone ?? "dramatic",
        niche: niche ?? "",
        language: language ?? "en",
        aspectRatio,
      });
      log.log(`[ASSEMBLE]`, `ASSEMBLY done`);

      recordStageEnd(checkpoint, "ASSEMBLY");
      await saveCheckpoint(videoId, { ...checkpoint });

      await fs.writeFile(contextAbsPath(relDir), ctx.join("\n"), "utf-8");

      // ── Finalize ──
      recordStageStart(checkpoint, "UPLOADING");
      await updateStage(videoId, "UPLOADING");
      const relVideoUrl = videoRelUrl(relDir);
      recordStageEnd(checkpoint, "UPLOADING");
      await db.video.update({
        where: { id: videoId },
        data: {
          status: "READY",
          generationStage: null,
          videoUrl: relVideoUrl,
          duration: durationMs ? Math.round(durationMs / 1000) : null,
          checkpointData: checkpoint as never,
          stageTimings: checkpoint.stageTimings ?? null,
        },
      });

      log.log(`[READY]`, `${videoId} → ${relVideoUrl}`);

      try {
        const results = await postVideoToSocials(videoId);
        if (results.length > 0) {
          const posted = results.filter((r) => r.success).map((r) => r.platform);
          const failed = results.filter((r) => !r.success).map((r) => `${r.platform}: ${r.error}`);
          if (posted.length > 0) log.log(`[POST]`, `POSTED → ${posted.join(", ")}`);
          if (failed.length > 0) log.warn(`[POST]`, `POST_FAIL: ${failed.join("; ")}`);
        }
      } catch (postErr) {
        log.warn(`[POST]`, `POST_ERR:`, postErr);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[worker-${videoId}] [ERR] FAILED:`, msg);
      if (error instanceof Error && error.stack) console.error(error.stack);
      if (error instanceof Error && "cause" in error && (error as Error & { cause?: unknown }).cause !== undefined) {
        console.error(`[worker-${videoId}] [ERR] Cause:`, (error as Error & { cause?: unknown }).cause);
      }
      log.error(`[ERR]`, `FAILED: ${msg}`);
      if (error instanceof Error && error.stack) log.error(`[ERR]`, `Stack: ${error.stack}`);

      try {
        const cp = await loadCheckpoint(videoId);
        await db.video.update({
          where: { id: videoId },
          data: {
            status: "FAILED",
            generationStage: null,
            errorMessage: msg.slice(0, 500),
            stageTimings: cp.stageTimings ?? null,
          },
        });
      } catch (dbErr) {
        log.error(`[ERR]`, `CRITICAL db update failed:`, dbErr);
        console.error(`[worker-${videoId}] [ERR] CRITICAL db update failed:`, dbErr);
      }

      throw error;
    }
    });
  },
  {
    connection: redis as never,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "2", 10),
    lockDuration: 600_000,
    lockRenewTime: 300_000,
    stalledInterval: 120_000,
  }
);

worker.on("completed", (job) => log.log(`[JOB]`, `JOB_DONE ${job.id}`));
worker.on("failed", (job, err) => {
  const msg = err?.message ?? String(err);
  const videoId = job?.data?.videoId ?? job?.id;
  console.error(`[worker-${videoId}] [ERR] JOB_FAIL:`, msg);
  if (err instanceof Error && err.stack) console.error(err.stack);
  if (err instanceof Error && "cause" in err && (err as Error & { cause?: unknown }).cause !== undefined) {
    console.error(`[worker-${videoId}] [ERR] Cause:`, (err as Error & { cause?: unknown }).cause);
  }
  log.error(`[ERR]`, `JOB_FAIL ${job?.id}: ${msg}`);
  if (err instanceof Error && err.stack) log.error(err.stack);
});

log.log(`${WORKER_ID} started (concurrency=${worker.opts.concurrency})`);
