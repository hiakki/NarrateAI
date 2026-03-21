import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { discoverVideo, type ClipNiche } from "../src/services/clip-repurpose/discovery";
import { downloadVideoAuto, parseVideoInfo } from "../src/services/clip-repurpose/downloader";
import { findPeakSegment, findPeakViaTranscript } from "../src/services/clip-repurpose/heatmap";
import { extractAndCrop, parseVttForSegment, buildAssFile, enhanceClip, detectSpeechSegments, alignCuesToAudio } from "../src/services/clip-repurpose/clip-processor";
import { postVideoToSocials } from "../src/services/social-poster";
import { buildVideoRelDir, videoRelUrl, videoAbsDir, videoAbsPath } from "../src/lib/video-paths";
import { createLogger, runWithVideoIdAsync } from "../src/lib/logger";
import type { ClipRepurposeJobData } from "../src/services/queue";
import fs from "fs/promises";
import path from "path";

const log = createLogger("ClipWorker");
const db = new PrismaClient();
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

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

/**
 * Generate a short, engaging title for the clip via LLM.
 */
const COPYRIGHT_NOTICE = [
  "",
  "---",
  "Fair Use / Copyright Notice:",
  "This clip is shared for commentary, education, and entertainment",
  "under fair use (17 U.S.C. § 107) and fair dealing under the",
  "Indian Copyright Act, 1957 (Section 52). No copyright infringement",
  "intended. All rights belong to the original creator(s) and their licensors.",
  "",
  "If you are the rights holder and want this removed,",
  "please DM us and we will take it down immediately.",
].join("\n");

async function generateClipMetadata(
  originalTitle: string,
  channelName: string,
  segmentDesc: string,
  sourceUrl: string,
  _peakStartSec: number,
  _peakEndSec: number,
  partNumber: number,
): Promise<{ title: string; description: string }> {
  const apiKey = process.env.GEMINI_API_KEY;

  const creditLine = `\n\nOriginal: "${originalTitle}" by ${channelName}\n${sourceUrl}`;

  if (!apiKey) {
    const base = originalTitle.length > 60 ? originalTitle.slice(0, 57) + "..." : originalTitle;
    return { title: base, description: `From ${channelName}${creditLine}${COPYRIGHT_NOTICE}` };
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are a viral short-form video editor. Create a title and description for a clip from this video.

Original video: "${originalTitle}" by ${channelName}
Segment: ${segmentDesc}
This is clip part #${partNumber} from this source.

Rules:
- Title: Under 60 chars, hook-style, creates curiosity. NO clickbait lies. Do NOT include clip numbers, timestamps, or brackets.
- Description: 1-2 sentences teasing what happens. End with "..."
- Credit the original creator with their name and link.
- Add 3-5 relevant hashtags.

Reply with ONLY a JSON object (no markdown):
{"title": "...", "description": "..."}`,
    });

    const text = response.text?.trim() ?? "";
    const jsonStr = text.replace(/^```json?\n?|\n?```$/g, "").trim();
    const parsed = JSON.parse(jsonStr) as { title: string; description: string };
    const finalTitle = parsed.title
      .replace(/^#\d+\s+/, "")
      .replace(/\s*\[\d+s?-\d+s?\]\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 70);
    return {
      title: finalTitle,
      description: `${parsed.description}${creditLine}${COPYRIGHT_NOTICE}`,
    };
  } catch (err) {
    log.warn(`LLM metadata failed: ${err instanceof Error ? err.message : err}`);
    const base = originalTitle.length > 60 ? originalTitle.slice(0, 57) + "..." : originalTitle;
    return {
      title: base,
      description: `Credit: ${channelName}${creditLine}${COPYRIGHT_NOTICE}`,
    };
  }
}

const worker = new Worker<ClipRepurposeJobData>(
  "clip-repurpose",
  async (job) => {
    const {
      videoId,
      seriesId,
      userId,
      userName,
      automationName,
      clipConfig,
      tone,
      language,
      targetPlatforms,
    } = job.data;

    await runWithVideoIdAsync(videoId, async () => {
    const jobStart = Date.now();
    log.log(`[START]`, `Clip-repurpose job ${videoId}`);

    try {
      // ── Stage 1: DISCOVER ──
      await updateStage(videoId, "DISCOVER");
      log.log(`[DISCOVER]`, `Finding trending video...`);

      const recentVideos = await db.video.findMany({
        where: { seriesId, sourceUrl: { not: null } },
        select: { sourceUrl: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const excludeIds = new Set<string>();
      for (const v of recentVideos) {
        if (!v.sourceUrl) continue;
        excludeIds.add(v.sourceUrl);
        const ytMatch = v.sourceUrl.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]+)/);
        if (ytMatch?.[1]) excludeIds.add(ytMatch[1]);
        const fbMatch = v.sourceUrl.match(/facebook\.com\/reel\/(\d+)/);
        if (fbMatch?.[1]) excludeIds.add(fbMatch[1]);
        const igMatch = v.sourceUrl.match(/instagram\.com\/(?:reel|p)\/([\w-]+)/);
        if (igMatch?.[1]) excludeIds.add(igMatch[1]);
      }

      const nicheKey = (clipConfig.clipNiche || "auto") as ClipNiche;
      const discoveryResult = await discoverVideo({
        niche: nicheKey,
        excludeVideoIds: excludeIds,
        preferPlatform: clipConfig.preferPlatform,
      });

      if (!discoveryResult) {
        throw new Error("No suitable video found from any configured source");
      }

      const { selected: discovered, candidates, totalConsidered } = discoveryResult;
      log.log(`[DISCOVER]`, `Selected: "${discovered.title}" (${discovered.viewCount.toLocaleString()} views) [${discovered.platform}] from ${totalConsidered} candidates`);

      await db.video.update({
        where: { id: videoId },
        data: {
          sourceUrl: discovered.url,
          sourceMetadata: {
            niche: nicheKey,
            platform: discovered.platform,
            channelName: discovered.channelName,
            channelId: discovered.channelId,
            originalTitle: discovered.title,
            viewCount: discovered.viewCount,
            source: discovered.source,
            discovery: { candidates, totalConsidered },
          } as never,
        },
      });

      // ── Stage 2: DOWNLOAD (part of discovery) ──
      log.log(`[DOWNLOAD]`, `Downloading ${discovered.url}...`);

      const { videoPath: sourcePath, infoJsonPath, subsPath, tmpDir } = await downloadVideoAuto(
        discovered.url,
        { subsLang: language ?? "en" },
      );

      const videoInfo = await parseVideoInfo(infoJsonPath);
      log.log(`[DOWNLOAD]`, `Got: ${videoInfo.duration}s, heatmap: ${videoInfo.heatmap ? `${videoInfo.heatmap.length} points` : "none"}`);

      // ── Stage 3: HEATMAP analysis ──
      await updateStage(videoId, "HEATMAP");
      log.log(`[HEATMAP]`, `Finding peak segment...`);

      const maxClipDur = clipConfig.clipDurationSec || 45;
      // Find the core peak using ~60% of target duration, then expand with context
      const coreDur = Math.min(Math.floor(maxClipDur * 0.6), maxClipDur);
      let peak;

      if (videoInfo.heatmap && videoInfo.heatmap.length > 0) {
        peak = findPeakSegment(videoInfo.heatmap, videoInfo.duration, coreDur);
      } else if (subsPath) {
        log.log(`[HEATMAP]`, `No heatmap — falling back to LLM transcript analysis`);
        const vttContent = await fs.readFile(subsPath, "utf-8");
        peak = await findPeakViaTranscript(vttContent, videoInfo.duration, coreDur);
      } else {
        log.warn(`[HEATMAP]`, `No heatmap or subs — using video midpoint`);
        const mid = Math.max(0, (videoInfo.duration - coreDur) / 2);
        peak = { startSec: Math.floor(mid), endSec: Math.floor(mid + coreDur), avgHeat: 0.5, peakHeat: 0.5 };
      }

      // Store core segment before expanding
      const coreStart = peak.startSec;
      const coreEnd = peak.endSec;
      const coreLen = coreEnd - coreStart;

      // Expand with pre/post context for viewer understanding (up to maxClipDur)
      const extraNeeded = maxClipDur - coreLen;
      let preContextSec = 0;
      let postContextSec = 0;
      if (extraNeeded > 0 && videoInfo.duration > coreLen) {
        const prePad = Math.min(Math.floor(extraNeeded * 0.4), peak.startSec);
        const postPad = Math.min(extraNeeded - prePad, videoInfo.duration - peak.endSec);
        const finalPrePad = Math.min(prePad + Math.max(0, extraNeeded - prePad - postPad), peak.startSec);
        preContextSec = finalPrePad;
        postContextSec = postPad;
        peak = {
          ...peak,
          startSec: Math.floor(peak.startSec - finalPrePad),
          endSec: Math.floor(Math.min(peak.endSec + postPad, videoInfo.duration)),
        };
      }

      const timingBreakdown = {
        preContext: { startSec: peak.startSec, endSec: coreStart, durationSec: Math.round(preContextSec) },
        mainHeatmap: { startSec: coreStart, endSec: coreEnd, durationSec: coreLen },
        postContext: { startSec: coreEnd, endSec: peak.endSec, durationSec: Math.round(postContextSec) },
        totalDurationSec: peak.endSec - peak.startSec,
      };

      log.log(`[HEATMAP]`, `Peak: ${peak.startSec}-${peak.endSec}s (${peak.endSec - peak.startSec}s total: pre=${timingBreakdown.preContext.durationSec}s, main=${coreLen}s, post=${timingBreakdown.postContext.durationSec}s, heat: ${peak.avgHeat.toFixed(2)})`);

      // ── Stage 4: CLIPPING (extract + crop to 9:16) ──
      await updateStage(videoId, "CLIPPING");
      log.log(`[CLIPPING]`, `Cutting clip with context and converting to 9:16...`);

      const croppedPath = path.join(tmpDir, "cropped.mp4");
      await extractAndCrop(
        sourcePath,
        croppedPath,
        peak,
        clipConfig.cropMode || "blur-bg",
      );

      // ── Stage 5: ENHANCE (captions + blur + hook text) ──
      await updateStage(videoId, "ENHANCE");
      log.log(`[ENHANCE]`, `Adding captions and hook text...`);

      // Detect speech regions in the cropped clip for subtitle alignment
      const speechSegments = await detectSpeechSegments(croppedPath);
      log.log(`[ENHANCE]`, `Speech detection: ${speechSegments.length} segments found`);

      let assContent: string;
      if (subsPath) {
        const vttContent = await fs.readFile(subsPath, "utf-8");
        let cues = parseVttForSegment(vttContent, peak.startSec, peak.endSec);
        log.log(`[ENHANCE]`, `${cues.length} subtitle cues parsed from VTT`);
        if (speechSegments.length > 0 && cues.length > 0) {
          cues = alignCuesToAudio(cues, speechSegments);
          log.log(`[ENHANCE]`, `Cues aligned to audio speech segments`);
        }
        assContent = buildAssFile(cues, discovered.title.slice(0, 50));
      } else {
        assContent = buildAssFile([], discovered.title.slice(0, 50));
        log.log(`[ENHANCE]`, `No subtitles available — hook text only`);
      }

      const enhancedPath = path.join(tmpDir, "enhanced.mp4");
      await enhanceClip(croppedPath, enhancedPath, assContent, tmpDir);

      // ── Metadata generation (part of enhance stage) ──
      log.log(`[METADATA]`, `Generating title and description...`);

      const existingClips = await db.video.count({
        where: { sourceUrl: discovered.url, status: { in: ["READY", "POSTED", "GENERATING"] } },
      });
      const partNumber = existingClips + 1;

      const segmentDesc = `${peak.startSec}-${peak.endSec}s of a ${videoInfo.duration}s video with ${discovered.viewCount.toLocaleString()} views`;
      const { title, description } = await generateClipMetadata(
        discovered.title,
        discovered.channelName,
        segmentDesc,
        discovered.url,
        coreStart,
        coreEnd,
        partNumber,
      );
      log.log(`[METADATA]`, `Title: "${title}" (Part ${partNumber})`);

      // ── Stage 6: FINALIZE ──
      await updateStage(videoId, "FINALIZE");
      const relDir = buildVideoRelDir(userId, userName, title, videoId, automationName);
      const absDir = videoAbsDir(relDir);
      await fs.mkdir(absDir, { recursive: true });

      const finalPath = videoAbsPath(relDir);
      await fs.copyFile(enhancedPath, finalPath);

      const relVideoUrl = videoRelUrl(relDir);
      const stat = await fs.stat(finalPath);
      const clipDuration = peak.endSec - peak.startSec;

      await db.video.update({
        where: { id: videoId },
        data: {
          status: "READY",
          generationStage: null,
          title,
          description,
          videoUrl: relVideoUrl,
          duration: clipDuration,
          sourceMetadata: {
            niche: nicheKey,
            platform: discovered.platform,
            channelName: discovered.channelName,
            channelId: discovered.channelId,
            originalTitle: discovered.title,
            viewCount: discovered.viewCount,
            source: discovered.source,
            peakSegment: peak,
            timingBreakdown,
            discovery: { candidates, totalConsidered },
          } as never,
        },
      });

      const elapsed = ((Date.now() - jobStart) / 1000).toFixed(1);
      log.log(`[READY]`, `${videoId} → ${relVideoUrl} (${(stat.size / 1024 / 1024).toFixed(1)}MB, ${clipDuration}s) in ${elapsed}s`);

      // Clean up tmp
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

      // ── SCHEDULE via native platform APIs (never post immediately) ──
      const jobTargets = (targetPlatforms ?? []) as string[];
      if (jobTargets.length === 0) {
        log.log(`[POST]`, `Skipped — no target platforms in job`);
      } else {
        try {
          const freshVideo = await db.video.findUnique({ where: { id: videoId }, select: { scheduledPostTime: true } });
          const scheduledAt = freshVideo?.scheduledPostTime
            ? new Date(freshVideo.scheduledPostTime)
            : new Date(Date.now() + 60 * 60 * 1000); // fallback: 1 hour from now
          log.log(`[SCHEDULE]`, `Scheduling for ${scheduledAt.toISOString()} on ${jobTargets.join(", ")}`);
          const results = await postVideoToSocials(videoId, undefined, scheduledAt);
          if (results.length > 0) {
            const ok = results.filter((r) => r.success).map((r) => r.platform);
            const failed = results.filter((r) => !r.success).map((r) => `${r.platform}: ${r.error}`);
            if (ok.length > 0) log.log(`[SCHEDULE]`, `SCHEDULED → ${ok.join(", ")}`);
            if (failed.length > 0) log.warn(`[SCHEDULE]`, `SCHEDULE_FAIL: ${failed.join("; ")}`);
          }
        } catch (postErr) {
          log.warn(`[SCHEDULE]`, `SCHEDULE_ERR:`, postErr);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      log.error(`[ERR]`, `FAILED: ${msg}`);
      if (error instanceof Error && error.stack) log.error(`[ERR]`, error.stack);

      try {
        await db.video.update({
          where: { id: videoId },
          data: {
            status: "FAILED",
            generationStage: null,
            errorMessage: msg.slice(0, 500),
          },
        });
      } catch (dbErr) {
        log.error(`[ERR]`, `CRITICAL db update failed:`, dbErr);
      }

      throw error;
    }
    });
  },
  {
    connection: redis as never,
    concurrency: 1,
    lockDuration: 600_000,
    lockRenewTime: 300_000,
    stalledInterval: 120_000,
  },
);

worker.on("completed", (job) => log.log(`[JOB]`, `CLIP_DONE ${job.id}`));
worker.on("failed", (job, err) => {
  const msg = err?.message ?? String(err);
  log.error(`[ERR]`, `CLIP_FAIL ${job?.id}: ${msg}`);
});

log.log(`Clip-repurpose worker started (pid=${process.pid})`);
