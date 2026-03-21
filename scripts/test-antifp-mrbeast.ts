import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { downloadVideo, parseVideoInfo } from "../src/services/clip-repurpose/downloader";
import { findPeakSegment, findPeakViaTranscript } from "../src/services/clip-repurpose/heatmap";
import {
  extractAndCrop, parseVttForSegment, buildAssFile,
  enhanceClip, detectSpeechSegments, alignCuesToAudio, SPEED_FACTOR,
} from "../src/services/clip-repurpose/clip-processor";
import { postVideoToSocials } from "../src/services/social-poster";
import { buildVideoRelDir, videoRelUrl, videoAbsDir, videoAbsPath } from "../src/lib/video-paths";
import fs from "fs/promises";
import path from "path";

const db = new PrismaClient();

const MRBEAST_VIDEO_URL = "https://www.youtube.com/watch?v=2isYuQZMbdU";
const SERIES_ID = "cmn01smit000hvhx9ywpyc15w"; // Entertainment Stunts series
const USER_ID = "cmlq3v4wc0000vhnbd7g3frc6";
const USER_NAME = "Akki";
const AUTOMATION_NAME = "Entertainment Stunts — Evening";
const MAX_CLIP_DUR = 35;
const CROP_MODE = "blur-bg" as const;

async function main() {
  console.log("=== Anti-Fingerprint MrBeast Test ===\n");

  // Create video DB record
  const video = await db.video.create({
    data: {
      seriesId: SERIES_ID,
      targetDuration: MAX_CLIP_DUR,
      status: "GENERATING",
      generationStage: "ASSEMBLY" as never,
    },
  });
  console.log(`Video ID: ${video.id}`);

  try {
    // 1. Download
    console.log("\n[1/6] Downloading MrBeast video...");
    const { videoPath: sourcePath, infoJsonPath, subsPath, tmpDir } =
      await downloadVideo(MRBEAST_VIDEO_URL, { subsLang: "en" });
    const info = await parseVideoInfo(infoJsonPath);
    console.log(`  Downloaded: "${info.title}" (${info.duration}s, ${info.view_count.toLocaleString()} views)`);
    console.log(`  Channel: ${info.channel}`);
    console.log(`  Heatmap: ${info.heatmap ? `${info.heatmap.length} pts` : "none"}`);

    await db.video.update({
      where: { id: video.id },
      data: {
        sourceUrl: MRBEAST_VIDEO_URL,
        sourceMetadata: {
          niche: "entertainment",
          platform: "youtube",
          channelName: info.channel,
          channelId: info.channel_id,
          originalTitle: info.title,
          viewCount: info.view_count,
        } as never,
        generationStage: "ASSEMBLY" as never,
      },
    });

    // 2. Find peak segment
    console.log("\n[2/6] Finding peak segment...");
    const coreDur = Math.floor(MAX_CLIP_DUR * 0.6);
    let peak;
    if (info.heatmap && info.heatmap.length > 0) {
      peak = findPeakSegment(info.heatmap, info.duration, coreDur);
    } else if (subsPath) {
      const vtt = await fs.readFile(subsPath, "utf-8");
      peak = await findPeakViaTranscript(vtt, info.duration, coreDur);
    } else {
      const mid = Math.max(0, (info.duration - coreDur) / 2);
      peak = { startSec: Math.floor(mid), endSec: Math.floor(mid + coreDur), avgHeat: 0.5, peakHeat: 0.5 };
    }

    // Expand with context
    const coreLen = peak.endSec - peak.startSec;
    const extra = MAX_CLIP_DUR - coreLen;
    if (extra > 0) {
      const pre = Math.min(Math.floor(extra * 0.4), peak.startSec);
      const post = Math.min(extra - pre, info.duration - peak.endSec);
      peak = { ...peak, startSec: Math.floor(peak.startSec - pre), endSec: Math.floor(Math.min(peak.endSec + post, info.duration)) };
    }
    console.log(`  Peak: ${peak.startSec}-${peak.endSec}s (${peak.endSec - peak.startSec}s, heat: ${peak.avgHeat.toFixed(2)})`);

    // 3. Extract + Crop (with anti-fingerprint transforms)
    console.log("\n[3/6] Extracting clip with ANTI-FINGERPRINT transforms (hflip, hue, speed 1.05x)...");
    await db.video.update({ where: { id: video.id }, data: { generationStage: "ASSEMBLY" as never } });
    const croppedPath = path.join(tmpDir, "cropped.mp4");
    await extractAndCrop(sourcePath, croppedPath, peak, CROP_MODE);
    const croppedStat = await fs.stat(croppedPath);
    console.log(`  Cropped clip: ${(croppedStat.size / 1024 / 1024).toFixed(1)}MB`);

    // 4. Enhance (captions + pitch shift)
    console.log("\n[4/6] Enhancing with captions + audio PITCH SHIFT (-1 semitone)...");
    await db.video.update({ where: { id: video.id }, data: { generationStage: "ASSEMBLY" as never } });

    const speechSegments = await detectSpeechSegments(croppedPath);
    let assContent: string;
    if (subsPath) {
      const vtt = await fs.readFile(subsPath, "utf-8");
      let cues = parseVttForSegment(vtt, peak.startSec, peak.endSec, SPEED_FACTOR);
      if (speechSegments.length > 0 && cues.length > 0) {
        cues = alignCuesToAudio(cues, speechSegments);
      }
      assContent = buildAssFile(cues);
    } else {
      assContent = buildAssFile([]);
    }

    const enhancedPath = path.join(tmpDir, "enhanced.mp4");
    await enhanceClip(croppedPath, enhancedPath, assContent, tmpDir);
    const enhStat = await fs.stat(enhancedPath);
    console.log(`  Enhanced clip: ${(enhStat.size / 1024 / 1024).toFixed(1)}MB`);

    // 5. Finalize — save to public dir
    console.log("\n[5/6] Finalizing...");
    await db.video.update({ where: { id: video.id }, data: { generationStage: "ASSEMBLY" as never } });

    const clipTitle = `MrBeast Anti-FP Test ${new Date().toISOString().slice(0, 16)}`;
    const relDir = buildVideoRelDir(USER_ID, USER_NAME, clipTitle, video.id, AUTOMATION_NAME);
    const absDir = videoAbsDir(relDir);
    await fs.mkdir(absDir, { recursive: true });
    const finalPath = videoAbsPath(relDir);
    await fs.copyFile(enhancedPath, finalPath);
    const relUrl = videoRelUrl(relDir);

    const creditLine = `\nOriginal: "${info.title}" by ${info.channel}\n${MRBEAST_VIDEO_URL}`;
    await db.video.update({
      where: { id: video.id },
      data: {
        status: "READY",
        generationStage: null,
        title: clipTitle,
        description: `Anti-fingerprint test clip.${creditLine}`,
        videoUrl: relUrl,
        duration: peak.endSec - peak.startSec,
      },
    });
    console.log(`  Saved: ${relUrl}`);

    // Clean up tmp
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    // 6. Post to YouTube ONLY (platformOverride bypasses cross-platform routing)
    console.log("\n[6/6] Posting to YouTube (platformOverride=['YOUTUBE'])...");
    const results = await postVideoToSocials(video.id, ["YOUTUBE"]);
    for (const r of results) {
      if (r.success) {
        console.log(`  ✅ ${r.platform}: ${r.url ?? r.postId}`);
      } else {
        console.log(`  ❌ ${r.platform}: ${r.error}`);
      }
    }

    console.log(`\n=== DONE ===`);
    console.log(`Video page: http://localhost:3000/dashboard/videos/${video.id}`);
  } catch (err) {
    console.error("\n❌ FAILED:", err);
    await db.video.update({
      where: { id: video.id },
      data: { status: "FAILED", errorMessage: String(err).slice(0, 500), generationStage: null },
    }).catch(() => {});
  } finally {
    await db.$disconnect();
  }
}

main();
