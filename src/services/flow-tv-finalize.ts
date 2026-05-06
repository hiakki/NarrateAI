// Flow TV — finalize a completed run by promoting it to a NarrateAI Video.
//
// Responsibilities:
//   1. Ensure a Series + Automation exist for the user's "zero-to-hero" Flow
//      TV pipeline (one per user; both reused across runs).
//   2. Create a Video row in status=READY with the run's storyline metadata.
//   3. Copy the final MP4 + scene images into the canonical
//      `public/videos/<userDir>/<autoDir>/<videoDir>/` layout so the existing
//      videos page renders them without any special-case branches.
//   4. Compute the scheduled post time from the automation's postTime + the
//      niche's preferred slot (mirrors how the niche scheduler does it).
//   5. Enqueue a scheduled-post job to the standard post queue.
//
// Inputs:
//   - FlowRun (already-completed run-state record). The run must have:
//       storyline, storySlug, finalVideoPath (existing on disk), userId.
//
// Outputs:
//   - { videoId } — the NarrateAI Video.id for the new row.
//
// Idempotent: re-finalising the same run id returns the existing videoId.

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import {
  buildVideoRelDir,
  videoRelUrl,
  videoAbsPath,
  scenesAbsDir,
  videoAbsDir,
} from "@/lib/video-paths";
import { computeAndGuardPostTime } from "@/lib/scheduler-utils";
import { enqueueScheduledPost } from "@/services/queue";
import type { FlowRun } from "@/services/flow-tv-run";

const log = createLogger("FlowTV:Finalize");

// Display name for the auto-generated Series + Automation. We keep these
// constants so re-finalising different runs collapses into the same Series
// (one per user) — exactly mirroring how niche-scheduler-spawned automations
// reuse a single Series.
const FLOW_TV_AUTOMATION_NAME = "Flow TV — Zero to Hero";
const FLOW_TV_SERIES_NAME = "[Auto] Flow TV — Zero to Hero";
const FLOW_TV_NICHE = "zero-to-hero";

export interface FinalizeResult {
  videoId: string;
  seriesId: string;
  automationId: string;
  videoUrl: string;
  scheduledPostTime: Date;
}

export async function finalizeFlowRun(run: FlowRun): Promise<FinalizeResult> {
  if (!run.storyline || !run.finalVideoPath || !run.storySlug) {
    throw new Error("finalizeFlowRun: run is missing storyline/finalVideoPath/storySlug");
  }
  if (!fsSync.existsSync(run.finalVideoPath)) {
    throw new Error(`finalizeFlowRun: final video not on disk at ${run.finalVideoPath}`);
  }

  // Idempotency: if this run already produced a Video, return it.
  if (run.videoId) {
    const existing = await db.video.findUnique({
      where: { id: run.videoId },
      select: {
        id: true,
        seriesId: true,
        videoUrl: true,
        scheduledPostTime: true,
        series: { select: { automation: { select: { id: true } } } },
      },
    });
    if (existing && existing.videoUrl) {
      log.log(`[finalize] run ${run.id} already finalized as video=${existing.id} — reusing`);
      return {
        videoId: existing.id,
        seriesId: existing.seriesId,
        automationId: existing.series.automation?.id ?? "",
        videoUrl: existing.videoUrl,
        scheduledPostTime: existing.scheduledPostTime ?? new Date(),
      };
    }
  }

  const user = await db.user.findUnique({
    where: { id: run.userId },
    select: {
      id: true,
      name: true,
      email: true,
      defaultLlmProvider: true,
      defaultTtsProvider: true,
      defaultImageProvider: true,
    },
  });
  if (!user) throw new Error(`finalizeFlowRun: user ${run.userId} not found`);

  const userName =
    user.name?.trim() || user.email?.split("@")[0]?.trim() || "user";
  // The User model doesn't carry a timezone field; default to the
  // codebase-wide default. Real automations override this via UI input.
  const userTimezone = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata";

  // 1 + 2 — ensure Series + Automation exist (one per user). We use the
  // automation's name as the dedup key so future runs land in the same row.
  const { series, automation } = await ensureFlowTvSeriesAndAutomation({
    userId: user.id,
    timezone: userTimezone,
    defaultLlm: user.defaultLlmProvider as never,
    defaultTts: user.defaultTtsProvider as never,
    defaultImage: user.defaultImageProvider as never,
  });

  // 3 — pre-allocate the Video row so we have an id for the path layout.
  const targetPlatforms = (automation.targetPlatforms as string[] | null) ?? [];
  const scheduledPostTime = computeAndGuardPostTime(
    automation.postTime,
    automation.timezone,
  );

  const video = await db.video.create({
    data: {
      seriesId: series.id,
      title: run.storyline.title,
      description: run.storyline.logline ?? null,
      scriptText: buildScriptText(run),
      scenesJson: buildScenesJson(run) as never,
      duration: run.clipPaths?.length ? run.clipPaths.length * 8 : null,
      targetDuration: run.clipPaths?.length ? run.clipPaths.length * 8 : null,
      status: "READY",
      scheduledPostTime,
      scheduledPlatforms: targetPlatforms as never,
      sourceMetadata: {
        triggerSource: run.triggerSource,
        triggerType: run.triggerSource === "scheduler" ? "scheduler" : "manual",
        triggerLabel: "Flow TV run-machine",
        triggerReason: `flow-tv run ${run.id} (mode=${run.approvalMode})`,
        triggeredAt: new Date(run.createdAt).toISOString(),
        flowTv: {
          runId: run.id,
          storySlug: run.storySlug,
          projectName: run.projectName,
          imageCount: run.imageCount,
          clipCount: run.clipCount,
          veoVariant: run.veoVariant,
          phase1RunDir: run.phase1RunDir,
          phase2RunDir: run.phase2RunDir,
        },
      } as never,
    },
  });

  // 4 — copy assets into public/videos/.../<videoDir>/.
  const relDir = buildVideoRelDir(
    user.id,
    userName,
    run.storyline.title,
    video.id,
    automation.name,
  );
  const absDir = videoAbsDir(relDir);
  const absVideoPath = videoAbsPath(relDir);
  const absScenesDir = scenesAbsDir(relDir);
  await fs.mkdir(absDir, { recursive: true });
  await fs.mkdir(absScenesDir, { recursive: true });

  // Final MP4 → video.mp4
  await fs.copyFile(run.finalVideoPath, absVideoPath);
  log.log(`[finalize] copied final → ${absVideoPath}`);

  // Scene images → scenes/scene-NN.png (drop the character; only scenes are
  // rendered by the videos page).
  if (Array.isArray(run.imagePaths)) {
    for (let i = 0; i < run.imagePaths.length; i++) {
      const src = run.imagePaths[i];
      if (!fsSync.existsSync(src)) {
        log.warn(`[finalize] missing scene image ${src} — skipping`);
        continue;
      }
      const dst = path.join(
        absScenesDir,
        `scene-${String(i + 1).padStart(2, "0")}.png`,
      );
      await fs.copyFile(src, dst);
    }
  }

  // Clips → scenes/scene-NN-clip.mp4 (one clip is between scene N and scene
  // N+1; we register it under the start scene's index, which matches how the
  // existing scenes UI reads the chain).
  if (Array.isArray(run.clipPaths)) {
    for (let i = 0; i < run.clipPaths.length; i++) {
      const src = run.clipPaths[i];
      if (!fsSync.existsSync(src)) continue;
      const dst = path.join(
        absScenesDir,
        `scene-${String(i + 1).padStart(2, "0")}-clip.mp4`,
      );
      await fs.copyFile(src, dst);
    }
  }

  // Character image → scenes/character.png (informational; not rendered by
  // the standard videos UI but available via /api/videos/[id]/route's scenes
  // listing if we ever want to surface it).
  if (run.characterPath && fsSync.existsSync(run.characterPath)) {
    await fs
      .copyFile(run.characterPath, path.join(absScenesDir, "character.png"))
      .catch(() => {});
  }

  // 5 — set videoUrl, mark scheduling, then enqueue post.
  const relUrl = videoRelUrl(relDir);
  await db.video.update({
    where: { id: video.id },
    data: { videoUrl: relUrl },
  });
  log.log(
    `[finalize] video ${video.id} READY at ${relUrl}; scheduledFor=${scheduledPostTime.toISOString()} platforms=${targetPlatforms.join(",") || "(none)"}`,
  );

  if (process.env.DRY_RUN === "1") {
    log.log(`[finalize] DRY_RUN — skipping post enqueue`);
  } else if (targetPlatforms.length > 0) {
    await enqueueScheduledPost(video.id, scheduledPostTime, targetPlatforms);
  } else {
    log.warn(
      `[finalize] no target platforms on automation ${automation.id}; video left READY without scheduling`,
    );
  }

  return {
    videoId: video.id,
    seriesId: series.id,
    automationId: automation.id,
    videoUrl: relUrl,
    scheduledPostTime,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────────

interface EnsureOpts {
  userId: string;
  timezone: string;
  defaultLlm: string | null;
  defaultTts: string | null;
  defaultImage: string | null;
}

async function ensureFlowTvSeriesAndAutomation(opts: EnsureOpts) {
  // Try to find an existing Flow TV automation for this user.
  let automation = await db.automation.findFirst({
    where: { userId: opts.userId, niche: FLOW_TV_NICHE, name: FLOW_TV_AUTOMATION_NAME },
    include: { series: true },
  });

  if (automation && automation.series) {
    return { series: automation.series, automation };
  }

  // None: create both. The Series uses the user's default providers (LLM/TTS
  // are unused by Flow TV but must be set on the Series; we don't override
  // imageProvider since Flow TV doesn't use the standard image-pipeline).
  const result = await db.$transaction(async (tx) => {
    const series = await tx.series.create({
      data: {
        userId: opts.userId,
        name: FLOW_TV_SERIES_NAME,
        niche: FLOW_TV_NICHE,
        artStyle: "realistic",
        language: "en",
        tone: "dramatic",
        llmProvider: (opts.defaultLlm as never) ?? null,
        ttsProvider: (opts.defaultTts as never) ?? null,
        imageProvider: (opts.defaultImage as never) ?? null,
      },
    });
    const automation = await tx.automation.create({
      data: {
        userId: opts.userId,
        name: FLOW_TV_AUTOMATION_NAME,
        niche: FLOW_TV_NICHE,
        artStyle: "realistic",
        language: "en",
        tone: "dramatic",
        duration: 16, // 2 clips × 8s each — overridden per video by run config
        llmProvider: (opts.defaultLlm as never) ?? null,
        ttsProvider: (opts.defaultTts as never) ?? null,
        imageProvider: (opts.defaultImage as never) ?? null,
        imageToVideoProvider: "FLOW_TV",
        automationType: "flow-tv",
        targetPlatforms: ["YOUTUBE", "FACEBOOK", "INSTAGRAM"] as never,
        enabled: false, // user opts in to scheduling via the Flow TV UI
        frequency: "daily",
        postTime: "07:00",
        timezone: opts.timezone,
        seriesId: series.id,
      },
    });
    return { series, automation };
  });
  log.log(
    `[finalize] created Flow TV series=${result.series.id} automation=${result.automation.id} for user=${opts.userId}`,
  );
  return result;
}

function buildScriptText(run: FlowRun): string {
  if (!run.storyline) return "";
  const lines: string[] = [];
  lines.push(`Title: ${run.storyline.title}`);
  if (run.storyline.logline) lines.push(`Logline: ${run.storyline.logline}`);
  if (run.storyline.protagonist) lines.push(`Protagonist: ${run.storyline.protagonist}`);
  lines.push("");
  lines.push(`Character: ${run.storyline.characterPrompt}`);
  lines.push("");
  for (let i = 0; i < run.storyline.imagePrompts.length; i++) {
    const ip = run.storyline.imagePrompts[i];
    lines.push(`Scene ${i + 1} — ${ip.title}`);
    lines.push(ip.prompt);
    lines.push("");
  }
  return lines.join("\n");
}

function buildScenesJson(run: FlowRun): Array<{ text: string; visualDescription: string }> {
  if (!run.storyline) return [];
  return run.storyline.imagePrompts.map((ip) => ({
    text: ip.title,
    visualDescription: ip.prompt,
  }));
}
