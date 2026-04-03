import "dotenv/config";
import cron from "node-cron";
import { Worker as BullWorker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import {
  enqueueVideoGeneration,
  enqueueClipRepurpose,
  enqueueScheduledPost,
  enqueueReconcileCheck,
  RECONCILE_INTERVAL_MS,
  type PostVideoJobData,
  type ReconcileJobData,
} from "../src/services/queue";
import { postVideoToSocials } from "../src/services/social-poster";
import { refreshInsightsForUser } from "../src/services/insights";
import { getYouTubeVideoPrivacy } from "../src/lib/social/youtube";
import { getFacebookVideoPublished, getFreshFacebookToken } from "../src/lib/social/facebook";
import { decrypt } from "../src/lib/social/encrypt";

import { getArtStyleById } from "../src/config/art-styles";
import { getNicheById } from "../src/config/niches";
import { resolveProviders } from "../src/services/providers/resolve";
import { getDefaultVoiceId } from "../src/config/voices";
import { createLogger, runWithAutomationIdAsync } from "../src/lib/logger";
import { getAutomationFileLogger, getSchedulerFileLogger, cleanupOldLogs } from "../src/lib/file-logger";
import {
  BUILD_ALL_TIME,
  BUILD_ALL_TIMEZONE,
  BUILD_WINDOW_MINUTES,
  shouldBuildNow,
  computeAndGuardPostTime,
} from "../src/lib/scheduler-utils";
import { deriveVideoStatusFromPlatforms, shouldPromoteVideoToPosted } from "../src/lib/video-state";
import { getPlatformEntriesArray } from "../src/lib/platform-utils";
import { recordMetric } from "../src/lib/ops-metrics";
import { probeAllNicheTrends } from "../src/services/clip-repurpose/trending-probe";
import { CLIP_NICHE_META } from "../src/config/clip-niches";
import {
  rankNichesFromTrending,
  pickTopNichesForTarget,
  computeStaggeredSchedule,
  type NicheTrendingStats,
} from "../src/lib/niche-optimizer";

const db = new PrismaClient();
const DAILY_CLIP_POSTS_PER_PLATFORM = parseInt(process.env.DAILY_CLIP_POSTS_PER_PLATFORM ?? "6", 10);
const logger = createLogger("Scheduler");
const { log, warn, error: err, debug } = logger;
const sfl = getSchedulerFileLogger();
const SCHEDULER_CONCURRENCY = parseInt(process.env.SCHEDULER_CONCURRENCY ?? "3", 10);

const STUCK_GENERATING_MS = 15 * 60 * 1000; // 15 min
const STUCK_QUEUED_MS = 30 * 60 * 1000;     // 30 min
const FAILED_RETRY_AFTER_MS = 10 * 60 * 1000; // retry FAILED after 10 min
const MAX_AUTO_RETRIES = 3;

interface AutoUser {
  id: string;
  name: string | null;
  email: string;
  defaultLlmProvider: string | null;
  defaultTtsProvider: string | null;
  defaultImageProvider: string | null;
  defaultImageToVideoProvider: string | null;
}

interface AutoRow {
  id: string;
  name: string;
  niche: string;
  artStyle: string;
  voiceId: string | null;
  language: string;
  tone: string;
  duration: number;
  llmProvider: string | null;
  ttsProvider: string | null;
  imageProvider: string | null;
  imageToVideoProvider?: string | null;
  targetPlatforms: string[] | unknown;
  frequency: string;
  postTime: string;
  timezone: string;
  lastRunAt: Date | null;
  seriesId: string | null;
  characterId?: string | null;
  automationType?: string;
  clipConfig?: unknown;
  enableBgm?: boolean;
  enableHflip?: boolean;
  user: AutoUser;
}

interface FailedVideoRow {
  id: string;
  seriesId: string;
  title: string | null;
  scriptText: string | null;
  scenesJson: unknown;
  checkpointData: unknown;
  targetDuration: number | null;
  duration: number | null;
  series: {
    artStyle: string;
    niche: string;
    tone: string;
    voiceId: string | null;
    language: string;
    llmProvider: string | null;
    ttsProvider: string | null;
    imageProvider: string | null;
    character?: { fullPrompt: string } | null;
    user: AutoUser;
  };
}

const SCHEDULER_REASON_CODES = {
  WAIT_BUILD_WINDOW: "WAIT_BUILD_WINDOW",
  POST_TIME_PASSED: "POST_TIME_PASSED",
  NOT_DUE: "NOT_DUE",
  BUILD_WINDOW_DUE: "BUILD_WINDOW_DUE",
  CATCHUP_OVERDUE: "CATCHUP_OVERDUE",
  CATCHUP_MISSED_WINDOW: "CATCHUP_MISSED_WINDOW",
  NEW_AUTOMATION_DUE: "NEW_AUTOMATION_DUE",
  PENDING_VIDEO_BLOCK: "PENDING_VIDEO_BLOCK",
  READY_VIDEO_BLOCK: "READY_VIDEO_BLOCK",
  CLAIMED_BY_OTHER: "CLAIMED_BY_OTHER",
  ENQUEUED: "ENQUEUED",
} as const;

function getReasonCode(reason: string): string {
  if (reason.includes("new automation")) return SCHEDULER_REASON_CODES.NEW_AUTOMATION_DUE;
  if (reason.includes("waiting for build window")) return SCHEDULER_REASON_CODES.WAIT_BUILD_WINDOW;
  if (reason.includes("post time passed")) return SCHEDULER_REASON_CODES.POST_TIME_PASSED;
  if (reason.includes("need")) return SCHEDULER_REASON_CODES.NOT_DUE;
  if (reason.includes("build window active")) return SCHEDULER_REASON_CODES.BUILD_WINDOW_DUE;
  if (reason.includes("catch-up: overdue")) return SCHEDULER_REASON_CODES.CATCHUP_OVERDUE;
  if (reason.includes("missed today's")) return SCHEDULER_REASON_CODES.CATCHUP_MISSED_WINDOW;
  return "UNKNOWN";
}

async function writeSchedulerLog(
  automationId: string,
  outcome: string,
  message: string,
  opts?: { errorDetail?: string; durationMs?: number; videoId?: string },
) {
  try {
    await db.schedulerLog.create({
      data: {
        automationId,
        outcome,
        message,
        errorDetail: opts?.errorDetail,
        durationMs: opts?.durationMs ?? 0,
        videoId: opts?.videoId,
      },
    });
    // Keep only last 30 entries per automation
    const oldest = await db.schedulerLog.findMany({
      where: { automationId },
      orderBy: { createdAt: "desc" },
      skip: 30,
      select: { id: true },
    });
    if (oldest.length > 0) {
      await db.schedulerLog.deleteMany({
        where: { id: { in: oldest.map((o) => o.id) } },
      });
    }
  } catch (e) {
    warn(`Failed to write scheduler log:`, e);
  }
}

function triggerLabel(trigger: string): string {
  switch (trigger) {
    case "build-window-cron": return `BUILD_ALL_TIME ${BUILD_ALL_TIME} ${BUILD_ALL_TIMEZONE}`;
    case "catch-up-cron": return "catch-up window";
    case "startup": return "scheduler startup";
    case "post-optimize": return "post-optimize sweep";
    default: return trigger;
  }
}

async function processAutomation(
  auto: AutoRow & { series?: { videos?: { createdAt: Date }[] } | null },
  trigger: string,
) {
  return runWithAutomationIdAsync(auto.id, async () => {
  const runStart = Date.now();
  const fl = getAutomationFileLogger(
    auto.user.id,
    auto.user.name ?? auto.user.email?.split("@")[0] ?? "user",
    auto.id,
    auto.name,
  );

  // Use actual last video build time instead of scheduler's lastRunAt,
  // except when lastRunAt is intentionally reset (e.g. newly enabled niche).
  const lastVideoBuildAt = auto.series?.videos?.[0]?.createdAt ?? null;
  const effectiveLastRun = auto.lastRunAt === null ? null : (lastVideoBuildAt ?? auto.lastRunAt);
  const { build, reason } = shouldBuildNow({ ...auto, lastRunAt: effectiveLastRun, postTime: auto.postTime });
  const triggerText = triggerLabel(trigger);

  if (!build) {
    debug(`[SKIP]`, `"${auto.name}" — ${reason}`);
    fl.scheduler(`SKIP: ${reason}`);
    const reasonCode = getReasonCode(reason);
    await writeSchedulerLog(
      auto.id,
      "skipped",
      `[${reasonCode}] [trigger=${trigger}] Did not run (${triggerText}): ${reason}`,
      { durationMs: Date.now() - runStart },
    );
    return;
  }

  // ── Pre-lock checks: skip conditions that must NOT burn lastRunAt ──

  if (!auto.seriesId) {
    log(`[AUTO]`, `No linked series, creating one...`);
    const newSeries = await db.series.create({
      data: {
        userId: auto.user.id,
        name: `[Auto] ${auto.name}`,
        niche: auto.niche,
        artStyle: auto.artStyle,
        voiceId: auto.voiceId,
        language: auto.language,
        tone: auto.tone,
        llmProvider: auto.llmProvider as never,
        ttsProvider: auto.ttsProvider as never,
        imageProvider: auto.imageProvider as never,
      },
    });
    await db.automation.update({
      where: { id: auto.id },
      data: { seriesId: newSeries.id },
    });
    (auto as { seriesId: string | null }).seriesId = newSeries.id;
    log(`[AUTO]`, `Created series "${newSeries.name}" (${newSeries.id})`);
  }

  const pendingVideo = auto.seriesId ? await db.video.findFirst({
    where: {
      seriesId: auto.seriesId,
      status: { in: ["QUEUED", "GENERATING", "SCHEDULED"] },
    },
  }) : null;
  if (pendingVideo) {
    const msg = `Did not run (${triggerText}): unposted video ${pendingVideo.id} is ${pendingVideo.status}`;
    log(`[SKIP]`, msg);
    fl.scheduler(`SKIP: pending video ${pendingVideo.id} (${pendingVideo.status})`);
    await writeSchedulerLog(auto.id, "skipped", `[${SCHEDULER_REASON_CODES.PENDING_VIDEO_BLOCK}] [trigger=${trigger}] ${msg}`, { durationMs: Date.now() - runStart, videoId: pendingVideo.id });
    return;
  }

  const targets = (auto.targetPlatforms ?? []) as string[];
  if (targets.length > 0) {
    const readyVideo = auto.seriesId ? await db.video.findFirst({
      where: { seriesId: auto.seriesId, status: "READY" },
      orderBy: { createdAt: "desc" },
    }) : null;
    if (readyVideo) {
      const rawPosted = (readyVideo.postedPlatforms ?? []) as (
        | string
        | { platform: string; success?: boolean | string }
      )[];
      const allHandled = targets.every((t) => {
        const entry = rawPosted.find((p) =>
          typeof p === "string" ? p === t : p.platform === t,
        );
        if (!entry) return false;
        if (typeof entry === "string") return true;
        return entry.success === true || entry.success === "scheduled";
      });
      if (!allHandled) {
        const remaining = targets.filter((t) => {
          const entry = rawPosted.find((p) =>
            typeof p === "string" ? p === t : p.platform === t,
          );
          if (!entry) return true;
          if (typeof entry === "string") return false;
          return entry.success !== true && entry.success !== "scheduled";
        });
        log(`[POST-READY]`, `Video ${readyVideo.id} READY — enqueuing post for remaining: ${remaining.join(", ")}`);
        fl.scheduler(`POST-READY: video ${readyVideo.id} has ${remaining.length} unposted platform(s)`);
        try {
          const scheduledAt = (() => {
            if (readyVideo.scheduledPostTime) {
              const existing = new Date(readyVideo.scheduledPostTime as unknown as string);
              if (existing.getTime() > Date.now() + 10 * 60 * 1000) return existing;
            }
            return computeAndGuardPostTime(auto.postTime, auto.timezone);
          })();
          if (scheduledAt.getTime() !== readyVideo.scheduledPostTime?.getTime()) {
            await db.video.update({ where: { id: readyVideo.id }, data: { scheduledPostTime: scheduledAt } });
          }
          await enqueueScheduledPost(readyVideo.id, scheduledAt, remaining);
          log(`[POST-READY]`, `Video ${readyVideo.id} → enqueued for ${scheduledAt.toISOString()}`);
          fl.scheduler(`POST-READY: enqueued for ${scheduledAt.toISOString()} → ${remaining.join(", ")}`);
        } catch (postErr) {
          const errMsg = postErr instanceof Error ? postErr.message : String(postErr);
          warn(`[POST-READY]`, `Failed to enqueue post for ${readyVideo.id}: ${errMsg}`);
          fl.scheduler(`POST-READY ERROR: ${errMsg.slice(0, 500)}`);
        }
        await writeSchedulerLog(
          auto.id,
          "skipped",
          `[${SCHEDULER_REASON_CODES.READY_VIDEO_BLOCK}] [trigger=${trigger}] Did not run (${triggerText}): unposted video ${readyVideo.id} exists; scheduled missing platforms [${remaining.join(", ")}]`,
          { durationMs: Date.now() - runStart, videoId: readyVideo.id },
        );
        return;
      }
    }
  }

  // ── Atomic lock: claim this automation ONLY after all skip checks pass ──
  const lockResult = await db.automation.updateMany({
    where: {
      id: auto.id,
      ...(auto.lastRunAt
        ? { lastRunAt: auto.lastRunAt }
        : { lastRunAt: null }),
    },
    data: { lastRunAt: new Date() },
  });
  if (lockResult.count === 0) {
    const msg = "Another scheduler instance already claimed this run";
    debug(`[SKIP]`, `"${auto.name}" — ${msg}`);
    fl.scheduler(`SKIP: ${msg}`);
    await writeSchedulerLog(auto.id, "skipped", `[${SCHEDULER_REASON_CODES.CLAIMED_BY_OTHER}] [trigger=${trigger}] ${msg}`, { durationMs: Date.now() - runStart });
    return;
  }

  const runReason = auto.lastRunAt === null && lastVideoBuildAt
    ? `newly enabled niche/automation; forced fresh build`
    : reason;
  log(`[BUILD]`, `"${auto.name}" — ${runReason}`);
  fl.scheduler(`BUILD: "${auto.name}" — ${runReason}`);

  // ── Route by automationType BEFORE retry logic to avoid cross-pipeline retries ──
  const autoType = auto.automationType ?? "original";

  if (autoType === "clip-repurpose") {
    const clipConfig = (auto.clipConfig as Record<string, unknown>) ?? {};
    const scheduledPostTime = computeAndGuardPostTime(auto.postTime, auto.timezone);
    try {
      const video = await db.video.create({
        data: {
          seriesId: auto.seriesId!,
          targetDuration: auto.duration,
          status: "QUEUED",
          scheduledPostTime,
          scheduledPlatforms: (auto.targetPlatforms ?? []) as string[],
          sourceMetadata: {
            generationContext: {
              triggerSource: trigger,
              triggerType: "scheduler",
              triggerLabel: triggerText,
              reason: runReason,
              triggeredAt: new Date().toISOString(),
            },
          } as never,
        },
      });

      await enqueueClipRepurpose({
        videoId: video.id,
        seriesId: auto.seriesId!,
        userId: auto.user.id,
        userName: auto.user.name ?? auto.user.email?.split("@")[0] ?? "user",
        automationId: auto.id,
        automationName: auto.name,
        niche: auto.niche,
        language: auto.language,
        tone: auto.tone,
        clipConfig: {
          clipNiche: (clipConfig.clipNiche as string) ?? "auto",
          clipDurationSec: (clipConfig.clipDurationSec as number) ?? 45,
          cropMode: (clipConfig.cropMode as "blur-bg" | "center-crop") ?? "blur-bg",
          creditOriginal: (clipConfig.creditOriginal as boolean) ?? true,
          enableBgm: auto.enableBgm ?? true,
          enableHflip: auto.enableHflip ?? false,
        },
        targetPlatforms: (auto.targetPlatforms ?? []) as string[],
        triggerSource: trigger,
        triggerType: "scheduler",
        triggerLabel: triggerText,
        triggerReason: runReason,
        triggeredAt: new Date().toISOString(),
      });

      const msg = `[${SCHEDULER_REASON_CODES.ENQUEUED}] [trigger=${trigger}] Ran (${triggerText}): ${runReason}. Queued clip-repurpose, post at ${scheduledPostTime.toISOString()}`;
      log(`[ENQUEUE]`, `Queued clip-repurpose ${video.id}`);
      fl.scheduler(`ENQUEUE: clip-repurpose video=${video.id}, postAt=${scheduledPostTime.toISOString()}`);
      await writeSchedulerLog(auto.id, "enqueued", msg, { durationMs: Date.now() - runStart, videoId: video.id });
    } catch (qErr: unknown) {
      const errMsg = qErr instanceof Error ? qErr.message : String(qErr);
      err(`[ERR]`, `Failed to enqueue clip-repurpose for "${auto.name}":`, qErr);
      fl.scheduler(`ERROR: Failed to enqueue clip-repurpose — ${errMsg.slice(0, 500)}`);
      await writeSchedulerLog(auto.id, "error", `Failed to enqueue clip-repurpose: ${errMsg.slice(0, 200)}`, {
        errorDetail: qErr instanceof Error ? qErr.stack : errMsg,
        durationMs: Date.now() - runStart,
      });
    }
    return;
  }

  // ── ORIGINAL pipeline: AI-generated video ──

  // Retry FAILED videos for original pipeline only
  const failedVideoRaw = auto.seriesId ? await db.video.findFirst({
    where: { seriesId: auto.seriesId, status: "FAILED" },
    orderBy: { updatedAt: "desc" },
    include: {
      series: {
        include: {
          character: { select: { fullPrompt: true } },
          user: {
            select: {
              id: true, name: true, email: true,
              defaultLlmProvider: true, defaultTtsProvider: true,
              defaultImageProvider: true, defaultImageToVideoProvider: true,
            },
          },
        },
      },
    },
  }) : null;
  const failedVideo = failedVideoRaw as FailedVideoRow | null;
  if (failedVideo) {
    const completedStages = (failedVideo.checkpointData as { completedStages?: string[] })?.completedStages ?? [];
    const scenes = (failedVideo.scenesJson as { text: string; visualDescription: string }[]) ?? [];
    const resolved = resolveProviders(failedVideo.series, failedVideo.series.user);
    const fArtStyle = getArtStyleById(failedVideo.series.artStyle);
    const fNiche = getNicheById(failedVideo.series.niche);
    const usr = failedVideo.series.user;

    await db.video.update({
      where: { id: failedVideo.id },
      data: { status: "QUEUED", errorMessage: null, retryCount: { increment: 1 } },
    });

    await enqueueVideoGeneration({
      videoId: failedVideo.id,
      seriesId: failedVideo.seriesId,
      userId: usr.id,
      userName: usr.name ?? usr.email?.split("@")[0] ?? "user",
      automationId: auto.id,
      automationName: auto.name,
      title: failedVideo.title || undefined,
      scriptText: failedVideo.scriptText || undefined,
      scenes: scenes.length > 0 ? scenes : undefined,
      artStyle: failedVideo.series.artStyle,
      artStylePrompt: fArtStyle?.promptModifier ?? "cinematic, high quality",
      negativePrompt: fArtStyle?.negativePrompt ?? "low quality, blurry, watermark, text",
      tone: failedVideo.series.tone ?? "dramatic",
      niche: failedVideo.series.niche,
      voiceId: failedVideo.series.voiceId ?? getDefaultVoiceId(resolved.tts),
      language: failedVideo.series.language ?? "en",
      musicPath: fNiche?.defaultMusic,
      duration: failedVideo.targetDuration ?? failedVideo.duration ?? 45,
      llmProvider: resolved.llm,
      ttsProvider: resolved.tts,
      imageProvider: resolved.image,
      imageToVideoProvider: usr.defaultImageToVideoProvider ?? process.env.USE_IMAGE_TO_VIDEO ?? undefined,
      characterPrompt: failedVideo.series.character?.fullPrompt ?? undefined,
      aspectRatio: fNiche?.aspectRatio ?? "9:16",
    });

    const retryMsg = `[${SCHEDULER_REASON_CODES.ENQUEUED}] [trigger=${trigger}] Ran (${triggerText}): ${runReason}. Re-enqueued failed video (resumes from [${completedStages.join(",")}])`;
    log(`[RETRY]`, `Re-enqueued failed video ${failedVideo.id} instead of creating new (resumes from [${completedStages.join(",")}])`);
    fl.scheduler(`RETRY: re-enqueued failed video=${failedVideo.id}, stages=[${completedStages.join(",")}]`);
    await writeSchedulerLog(auto.id, "enqueued", retryMsg, { durationMs: Date.now() - runStart, videoId: failedVideo.id });
    return;
  }

  let characterPrompt: string | undefined;
  if (auto.characterId) {
    const char = await db.character.findUnique({
      where: { id: auto.characterId },
      select: { fullPrompt: true },
    });
    if (char) characterPrompt = char.fullPrompt;
  }

  const artStyle = getArtStyleById(auto.artStyle);
  const niche = getNicheById(auto.niche);

  const providers = resolveProviders(
    {
      llmProvider: auto.llmProvider,
      ttsProvider: auto.ttsProvider,
      imageProvider: auto.imageProvider,
    },
    auto.user,
  );

  const origScheduledPostTime = computeAndGuardPostTime(auto.postTime, auto.timezone);
  try {
    const video = await db.video.create({
      data: {
        seriesId: auto.seriesId!,
        targetDuration: auto.duration,
        status: "QUEUED",
        scheduledPostTime: origScheduledPostTime,
        scheduledPlatforms: (auto.targetPlatforms ?? []) as string[],
        sourceMetadata: {
          generationContext: {
            triggerSource: trigger,
            triggerType: "scheduler",
            triggerLabel: triggerText,
            reason: runReason,
            triggeredAt: new Date().toISOString(),
          },
        } as never,
      },
    });

    await enqueueVideoGeneration({
      videoId: video.id,
      seriesId: auto.seriesId!,
      userId: auto.user.id,
      userName: auto.user.name ?? auto.user.email?.split("@")[0] ?? "user",
      automationId: auto.id,
      automationName: auto.name,
      artStyle: auto.artStyle,
      artStylePrompt: artStyle?.promptModifier ?? "cinematic, high quality",
      negativePrompt: artStyle?.negativePrompt ?? "low quality, blurry, watermark, text",
      tone: auto.tone,
      niche: auto.niche,
      voiceId: auto.voiceId ?? "default",
      language: auto.language,
      musicPath: niche?.defaultMusic,
      duration: auto.duration,
      llmProvider: providers.llm,
      ttsProvider: providers.tts,
      imageProvider: providers.image,
      imageToVideoProvider: (auto.imageToVideoProvider ?? auto.user.defaultImageToVideoProvider ?? process.env.USE_IMAGE_TO_VIDEO) || undefined,
      characterPrompt,
      triggerSource: trigger,
      triggerType: "scheduler",
      triggerLabel: triggerText,
      triggerReason: runReason,
      triggeredAt: new Date().toISOString(),
    });

    log(`[ENQUEUE]`, `Queued video ${video.id} (script gen in worker)`);
    fl.scheduler(`ENQUEUE: AI video=${video.id}, postAt=${origScheduledPostTime.toISOString()}`);
    await writeSchedulerLog(
      auto.id,
      "enqueued",
      `[${SCHEDULER_REASON_CODES.ENQUEUED}] [trigger=${trigger}] Ran (${triggerText}): ${runReason}. Queued AI video, post at ${origScheduledPostTime.toISOString()}`,
      { durationMs: Date.now() - runStart, videoId: video.id },
    );
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    err(`[ERR]`, `Failed to auto-generate: ${msg}`);
    fl.scheduler(`ERROR: Failed to auto-generate — ${msg}`);
    await writeSchedulerLog(auto.id, "error", `Failed to auto-generate: ${msg}`, {
      errorDetail: e instanceof Error ? e.stack : String(e),
      durationMs: Date.now() - runStart,
    });
  }
  });
}

async function runInBatches<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(fn));
  }
}

async function planDailyBuilds(trigger: string = "manual") {
  const tickStart = Date.now();
  let enqueuedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  try {
    const automations = await db.automation.findMany({
      where: { enabled: true },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            defaultLlmProvider: true,
            defaultTtsProvider: true,
            defaultImageProvider: true,
            defaultImageToVideoProvider: true,
          },
        },
        series: {
          select: {
            videos: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
    });

    log(`planDailyBuilds: ${automations.length} enabled automation(s), batch=${SCHEDULER_CONCURRENCY}`);
    sfl.action(`planDailyBuilds: ${automations.length} enabled automation(s), batch=${SCHEDULER_CONCURRENCY}`);

    await runInBatches(
      automations as unknown as AutoRow[],
      SCHEDULER_CONCURRENCY,
      async (auto) => {
        const before = Date.now();
        try {
          await processAutomation(auto, trigger);
          const latest = await db.schedulerLog.findFirst({
            where: { automationId: auto.id },
            orderBy: { createdAt: "desc" },
            select: { outcome: true, createdAt: true },
          });
          if (latest?.outcome === "enqueued") enqueuedCount++;
          else if (latest?.outcome === "skipped") skippedCount++;
          else if (latest?.outcome === "error") errorCount++;
        } catch {
          errorCount++;
        } finally {
          recordMetric("scheduler.automation.duration_ms", {
            automationId: auto.id,
            trigger,
            durationMs: Date.now() - before,
          });
        }
      },
    );
    sfl.action(`planDailyBuilds: completed`);
  } catch (e) {
    err("planDailyBuilds error:", e);
    sfl.error(`planDailyBuilds: ${e instanceof Error ? e.message : String(e)}`);
    errorCount++;
  } finally {
    recordMetric("scheduler.tick", {
      trigger,
      durationMs: Date.now() - tickStart,
      enqueued: enqueuedCount,
      skipped: skippedCount,
      errors: errorCount,
    });
  }
}

// checkReadyVideosForPosting — REMOVED: replaced by post-video BullMQ delayed queue

// checkDeferredInstagramPosts — REMOVED: replaced by native IG scheduling + post-video BullMQ queue

async function recoverStuckVideos() {
  try {
    const now = Date.now();

    const recoverable = await db.video.findMany({
      where: {
        status: { in: ["GENERATING", "QUEUED", "FAILED"] },
      },
      include: {
        series: {
          include: {
            automation: {
              select: {
                id: true, name: true, enabled: true, characterId: true,
                automationType: true, niche: true, language: true, tone: true,
                clipConfig: true, targetPlatforms: true, enableBgm: true,
                enableHflip: true, seriesId: true,
              },
            },
            character: { select: { fullPrompt: true } },
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                defaultLlmProvider: true,
                defaultTtsProvider: true,
                defaultImageProvider: true,
                defaultImageToVideoProvider: true,
              },
            },
          },
        },
      },
    });

    if (recoverable.length === 0) return;
    log(`Found ${recoverable.length} video(s) in GENERATING/QUEUED/FAILED state, checking for recoverable ones...`);
    sfl.action(`recoverStuckVideos: ${recoverable.length} video(s) to check`);

    for (const video of recoverable) {
      const age = now - new Date(video.updatedAt).getTime();
      const retryCount = video.retryCount ?? 0;
      const auto = video.series.automation as Record<string, unknown> | null;
      const autoType = (auto?.automationType as string) ?? "";
      const autoName = (auto?.name as string) ?? "manual";

      const usr = video.series.user;
      const rfl = auto?.id
        ? getAutomationFileLogger(usr.id, usr.name ?? usr.email?.split("@")[0] ?? "user", auto.id as string, autoName)
        : null;

      if (video.status === "FAILED") {
        if (!auto?.enabled) continue;
        if (retryCount >= MAX_AUTO_RETRIES) {
          if (retryCount === MAX_AUTO_RETRIES) {
            log(`Video ${video.id} exhausted ${MAX_AUTO_RETRIES} auto-retries, leaving as FAILED`);
            rfl?.scheduler(`RECOVERY: video=${video.id} exhausted ${MAX_AUTO_RETRIES} retries, giving up`);
          }
          continue;
        }
        if (age < FAILED_RETRY_AFTER_MS) continue;
        log(`Auto-retrying FAILED video ${video.id} (attempt ${retryCount + 1}/${MAX_AUTO_RETRIES}, auto="${autoName}", type=${autoType}, failed ${Math.round(age / 60000)}m ago)`);
        rfl?.scheduler(`RETRY: video=${video.id} (attempt ${retryCount + 1}/${MAX_AUTO_RETRIES}, failed ${Math.round(age / 60000)}m ago)`);
      } else {
        const threshold = video.status === "GENERATING" ? STUCK_GENERATING_MS : STUCK_QUEUED_MS;
        if (age < threshold) {
          debug(`SKIP ${video.id} (${video.status}) — ${Math.round(age / 1000)}s old, threshold=${Math.round(threshold / 1000)}s`);
          continue;
        }
        log(`Recovering stuck video ${video.id} (${video.status} for ${Math.round(age / 60000)}m, auto="${autoName}", type=${autoType})`);
        rfl?.scheduler(`RECOVERY: video=${video.id} stuck in ${video.status} for ${Math.round(age / 60000)}m, re-enqueuing`);
      }

      // ── Clip-repurpose videos: re-enqueue to the clip queue ──
      if (autoType === "clip-repurpose") {
        try {
          const clipCfg = (auto?.clipConfig as Record<string, unknown>) ?? {};

          await db.video.update({
            where: { id: video.id },
            data: { status: "QUEUED", errorMessage: null, generationStage: null, retryCount: { increment: 1 } },
          });

          await enqueueClipRepurpose({
            videoId: video.id,
            seriesId: video.seriesId,
            userId: usr.id,
            userName: usr.name ?? usr.email?.split("@")[0] ?? "user",
            automationId: auto?.id as string | undefined,
            automationName: autoName,
            niche: (auto?.niche as string) ?? "auto",
            language: (auto?.language as string) ?? "en",
            tone: (auto?.tone as string) ?? "dramatic",
            clipConfig: {
              clipNiche: (clipCfg.clipNiche as string) ?? "auto",
              clipDurationSec: (clipCfg.clipDurationSec as number) ?? 45,
              cropMode: (clipCfg.cropMode as "blur-bg" | "center-crop") ?? "blur-bg",
              creditOriginal: (clipCfg.creditOriginal as boolean) ?? true,
              enableBgm: (auto?.enableBgm as boolean) ?? true,
              enableHflip: (auto?.enableHflip as boolean) ?? false,
            },
            targetPlatforms: ((auto?.targetPlatforms ?? []) as string[]),
            triggerSource: "safety-net-recovery",
            triggerType: "recovery",
            triggerLabel: "Safety Net Recovery",
            triggerReason: `Recovered stuck ${video.status} job`,
            triggeredAt: new Date().toISOString(),
          });

          log(`[RETRY-CLIP] Re-enqueued clip video ${video.id} (attempt ${retryCount + 1}/${MAX_AUTO_RETRIES})`);
        } catch (e) {
          err(`Failed to recover clip video ${video.id}:`, e);
          await db.video.update({
            where: { id: video.id },
            data: { status: "FAILED", generationStage: null, errorMessage: `Retry failed: ${e instanceof Error ? e.message : "Unknown"}` },
          }).catch(() => {});
        }
        continue;
      }

      // ── Original pipeline: re-enqueue to the generation queue ──
      const hasCheckpoint = video.checkpointData && typeof video.checkpointData === "object";
      const completedStages = (video.checkpointData as { completedStages?: string[] })?.completedStages ?? [];

      try {
        const resolved = resolveProviders(video.series, video.series.user);
        const artStyle = getArtStyleById(video.series.artStyle);
        const niche = getNicheById(video.series.niche);
        const scenes = (video.scenesJson as { text: string; visualDescription: string }[]) ?? [];

        const scriptCompleted = completedStages.includes("SCRIPT");
        if (scenes.length === 0 && scriptCompleted) {
          warn(`Video ${video.id} has SCRIPT completed but no scene data, marking as FAILED`);
          await db.video.update({
            where: { id: video.id },
            data: { status: "FAILED", generationStage: null, errorMessage: "Recovery failed: no scene data" },
          });
          continue;
        }

        await db.video.update({
          where: { id: video.id },
          data: {
            status: "QUEUED",
            errorMessage: null,
            retryCount: { increment: 1 },
          },
        });

        await enqueueVideoGeneration({
          videoId: video.id,
          seriesId: video.seriesId,
          userId: usr.id,
          userName: usr.name ?? usr.email?.split("@")[0] ?? "user",
          automationId: video.series.automation?.id as string | undefined,
          automationName: video.series.automation?.name as string | undefined,
          title: video.title || undefined,
          scriptText: video.scriptText || undefined,
          scenes: scenes.length > 0 ? scenes : undefined,
          artStyle: video.series.artStyle,
          artStylePrompt: artStyle?.promptModifier ?? "cinematic, high quality",
          negativePrompt: artStyle?.negativePrompt ?? "low quality, blurry, watermark, text",
          tone: video.series.tone ?? "dramatic",
          niche: video.series.niche,
          voiceId: video.series.voiceId ?? getDefaultVoiceId(resolved.tts),
          language: video.series.language ?? "en",
          musicPath: niche?.defaultMusic,
          duration: video.targetDuration ?? video.duration ?? 45,
          llmProvider: resolved.llm,
          ttsProvider: resolved.tts,
          imageProvider: resolved.image,
          imageToVideoProvider: usr.defaultImageToVideoProvider ?? process.env.USE_IMAGE_TO_VIDEO ?? undefined,
          characterPrompt: video.series.character?.fullPrompt ?? undefined,
          aspectRatio: niche?.aspectRatio ?? "9:16",
          triggerSource: "safety-net-recovery",
          triggerType: "recovery",
          triggerLabel: "Safety Net Recovery",
          triggerReason: `Recovered stuck ${video.status} job`,
          triggeredAt: new Date().toISOString(),
        });

        log(`Re-enqueued video ${video.id} for recovery (will resume from ${hasCheckpoint ? `stage after [${completedStages.join(",")}]` : "beginning"})`);
      } catch (e) {
        err(`Failed to recover video ${video.id}:`, e);
        await db.video.update({
          where: { id: video.id },
          data: { status: "FAILED", generationStage: null, errorMessage: `Recovery failed: ${e instanceof Error ? e.message : "Unknown"}` },
        }).catch(() => {});
      }
    }
  } catch (e) {
    err("Error in recoverStuckVideos:", e);
  }
}

/**
 * Reconcile platform post status with the app's video status.
 *
 * Runs every tick for all READY/SCHEDULED videos:
 *   1. For each platform entry with success:"scheduled" + postId, query the
 *      platform API to check if the post is now live. If so, flip to success:true.
 *      - YouTube: check privacyStatus === "public"
 *      - Facebook: check published === true
 *      - Instagram: check via IG natively-scheduled container or deferred handler
 *   2. After resolving scheduled entries, if all targeted platforms show
 *      success:true (or deleted), promote the video status to POSTED.
 *
 * Optimised: only fetches videos whose scheduledPostTime is within a
 * targeted window (2h ago → 10m from now) plus any stuck/null entries,
 * and only logs when something actually changes.
 */
async function reconcileScheduledPosts() {
  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const tenMinFromNow = new Date(now.getTime() + 10 * 60 * 1000);

    const videos = await db.video.findMany({
      where: {
        status: { in: ["READY", "SCHEDULED"] },
        OR: [
          { scheduledPostTime: { gte: twoHoursAgo, lte: tenMinFromNow } },
          { scheduledPostTime: null, status: "SCHEDULED" },
        ],
      },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        postedPlatforms: true,
        scheduledPostTime: true,
        scheduledPlatforms: true,
        series: {
          select: {
            automation: { select: { id: true, name: true } },
            user: {
              select: {
                id: true, name: true, email: true,
                socialAccounts: {
                  select: {
                    id: true, platform: true, accessTokenEnc: true, refreshTokenEnc: true,
                    platformUserId: true, pageId: true, tokenExpiresAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    type PlatEntry = { platform: string; success?: boolean | string; postId?: string | null; url?: string | null; scheduledFor?: string; error?: string };
    const toCheck: { video: typeof videos[number]; entries: PlatEntry[]; scheduledEntries: PlatEntry[] }[] = [];

    const nowMs = now.getTime();
    const UPLOADING_STALE_MS = 10 * 60 * 1000;

    for (const video of videos) {
      const entries = getPlatformEntriesArray(video.postedPlatforms) as PlatEntry[];
      if (entries.length === 0) continue;
      const scheduledEntries = entries.filter((e) => e.success === "scheduled");
      const hasUnpromotedSuccess = video.status !== "POSTED" && entries.some((e) => e.success === true);
      const hasStuckUploading = entries.some((e) => e.success === "uploading") &&
        (nowMs - new Date(video.updatedAt).getTime()) > UPLOADING_STALE_MS;
      if (scheduledEntries.length > 0 || hasUnpromotedSuccess || hasStuckUploading) {
        toCheck.push({ video, entries, scheduledEntries });
      }
    }

    if (toCheck.length === 0) return;

    debug(`Reconcile: ${videos.length} in window, ${toCheck.length} need attention`);
    sfl.reconcile(`${videos.length} in window, ${toCheck.length} need attention`);

    for (const { video, entries, scheduledEntries } of toCheck) {
      const user = (video as { series?: { user?: typeof videos[number]["series"]["user"] } }).series?.user;
      const autoInfo = (video as { series?: { automation?: { id: string; name: string } | null } }).series?.automation;
      const rfl = autoInfo && user
        ? getAutomationFileLogger(user.id, (user as { name?: string | null; email?: string | null }).name ?? (user as { email?: string | null }).email?.split("@")[0] ?? "user", autoInfo.id, autoInfo.name)
        : null;
      let changed = false;

      const videoAge = nowMs - new Date(video.updatedAt).getTime();
      for (const entry of entries) {
        if (entry.success === "uploading" && videoAge > UPLOADING_STALE_MS) {
          entry.success = false;
          entry.error = "Upload timed out (stuck for >10 min)";
          changed = true;
          log(`Reconciled ${entry.platform} for ${video.id}: uploading → failed (stale ${Math.round(videoAge / 60000)}m)`);
        }
      }

      const FORCE_PROMOTE_MS = 90 * 60 * 1000;
      if (scheduledEntries.length > 0) {
        const videoSchedTime = video.scheduledPostTime ? new Date(video.scheduledPostTime).getTime() : 0;
        for (const entry of scheduledEntries) {
          const entrySchedTime = entry.scheduledFor ? new Date(entry.scheduledFor).getTime() : 0;
          const effectiveSchedTime = entrySchedTime || videoSchedTime;
          const isPastSchedule = effectiveSchedTime <= nowMs || effectiveSchedTime === 0;
          const overdueMins = effectiveSchedTime > 0 ? Math.round((nowMs - effectiveSchedTime) / 60000) : 0;

          if (!isPastSchedule) continue;

          let isLive = false;
          // Intentionally only used for YT/FB checks here; IG handled via app-level delayed jobs.

          if (entry.postId && user) {
            if (entry.platform === "YOUTUBE") {
              const account = user.socialAccounts.find((a) => a.platform === "YOUTUBE");
              if (account) {
                const accessToken = decrypt(account.accessTokenEnc);
                const refreshToken = account.refreshTokenEnc ? decrypt(account.refreshTokenEnc) : null;
                const privacy = await getYouTubeVideoPrivacy(
                  accessToken, refreshToken, entry.postId, account.platformUserId, user.id,
                );
                isLive = privacy === "public";
                if (isLive) log(`YT ${video.id}: postId=${entry.postId} → public (${overdueMins}m overdue)`);
              }
            } else if (entry.platform === "FACEBOOK") {
              const account = user.socialAccounts.find((a) => a.platform === "FACEBOOK");
              if (account) {
                let accessToken = decrypt(account.accessTokenEnc);
                if (account.refreshTokenEnc && account.pageId) {
                  try {
                    accessToken = await getFreshFacebookToken(
                      account.id, accessToken, account.refreshTokenEnc, account.pageId, account.tokenExpiresAt,
                    );
                  } catch { /* use existing token */ }
                }
                const published = await getFacebookVideoPublished(entry.postId, accessToken);
                isLive = published === true;
                if (isLive) log(`FB ${video.id}: postId=${entry.postId} → published (${overdueMins}m overdue)`);
              }
            } else if (entry.platform === "INSTAGRAM") {
              debug(`IG ${video.id}: deferred/native entry (handled by checkDeferredInstagramPosts or platform auto-publish)`);
              continue;
            }
          }

          if (!isLive && effectiveSchedTime > 0 && (nowMs - effectiveSchedTime) > FORCE_PROMOTE_MS) {
            log(`Force-promoting ${entry.platform} for ${video.id}: ${overdueMins}m overdue`);
            isLive = true;
          }

          if (isLive) {
            entry.success = true;
            delete entry.scheduledFor;
            changed = true;
            log(`Reconciled ${entry.platform} for ${video.id}: scheduled → posted`);
            rfl?.poster(`RECONCILE: ${entry.platform} for video=${video.id} → posted`);
            sfl.reconcile(`${video.id}: ${entry.platform} scheduled → posted`);
          }
        }
      }

      const targeted = ((video.scheduledPlatforms ?? []) as string[]) ?? [];
      const hasAnySuccess = entries.some((e) => e.success === true);
      if (!hasAnySuccess && !changed) continue;
      const shouldPromote = video.status !== "POSTED" && shouldPromoteVideoToPosted(entries, targeted);

      if (shouldPromote) {
        await db.video.update({
          where: { id: video.id },
          data: {
            status: "POSTED",
            ...(changed ? { postedPlatforms: entries as never } : {}),
          },
        });
        const postedPlats = entries.filter(e => e.success === true).map(e => e.platform).join(", ");
        log(`${video.id} → POSTED (${postedPlats})`);
        rfl?.poster(`PROMOTED: video=${video.id} → POSTED (${postedPlats})`);
        sfl.reconcile(`${video.id} → POSTED (${postedPlats})`);
      } else if (changed) {
        await db.video.update({
          where: { id: video.id },
          data: { postedPlatforms: entries as never },
        });
        debug(`${video.id}: updated platform entries (status stays ${video.status})`);
      }
    }
  } catch (e) {
    err("reconcileScheduledPosts error:", e);
  }
}

// checkCooldownRetries + tick — REMOVED: cooldown handled by post-video worker self-re-enqueue

async function safetyNet() {
  try {
    await recoverStuckVideos();
    await reconcileScheduledPosts();
  } catch (e) {
    err("safetyNet error:", e);
  }
}

/** Refresh video insights (views, likes, etc.) once per 24h per user. */
async function refreshInsightsDaily() {
  try {
    const usersWithPosted = await db.video.findMany({
      where: { status: "POSTED" },
      select: { series: { select: { userId: true } } },
      distinct: ["seriesId"],
    });
    const userIds = [...new Set(usersWithPosted.map((v) => v.series?.userId).filter(Boolean))] as string[];
    for (const userId of userIds) {
      try {
        const result = await refreshInsightsForUser(userId);
        log(`Insights refreshed for user ${userId}: ${result.videoCount} videos${result.errors.length ? `; ${result.errors.length} error(s)` : ""}`);
      } catch (e) {
        err(`Insights refresh failed for user ${userId}:`, e);
      }
    }
  } catch (e) {
    err("refreshInsightsDaily error:", e);
  }
}

// ── BullMQ post-video worker (inline — fires at exact scheduled time) ──

const postRedis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const postWorker = new BullWorker<PostVideoJobData>(
  "post-video",
  async (job) => {
    const startedAt = Date.now();
    const { videoId, platforms, scheduledAt } = job.data;
    const schedDate = scheduledAt ? new Date(scheduledAt) : undefined;
    const isIgOnly = platforms.length === 1 && platforms[0] === "INSTAGRAM";

    log(`[POST-WORKER] Posting video ${videoId} (scheduled=${scheduledAt ?? "immediate"})`);
    sfl.action(`POST-WORKER: posting ${videoId} (scheduled=${scheduledAt ?? "immediate"})`);

    const video = await db.video.findUnique({
      where: { id: videoId },
      select: {
        status: true,
        videoUrl: true,
        series: {
          select: {
            automation: { select: { id: true, name: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!video || !video.videoUrl) {
      log(`[POST-WORKER] Video ${videoId} not found or no URL, skipping`);
      return;
    }
    if (!["READY", "SCHEDULED"].includes(video.status)) {
      log(`[POST-WORKER] Video ${videoId} status=${video.status}, skipping`);
      return;
    }

    const autoInfo = video.series?.automation;
    const userInfo = video.series?.user;
    const fl = autoInfo && userInfo
      ? getAutomationFileLogger(userInfo.id, userInfo.name ?? userInfo.email?.split("@")[0] ?? "user", autoInfo.id, autoInfo.name)
      : null;

    fl?.poster(`POST-WORKER: posting video=${videoId}`);
    for (const platform of platforms) {
      fl?.poster(`POST-WORKER: platform=${platform} scheduled=${scheduledAt ?? "immediate"}`);
    }

    try {
      const results = await postVideoToSocials(
        videoId,
        platforms,
        isIgOnly ? undefined : schedDate,
        fl ?? undefined,
      );

      const ok = results.filter((r) => r.success).map((r) => r.platform);
      const cooldowns: { platform: string; retryAfter: number }[] = [];
      const failed = results.filter((r) => !r.success).map((r) => {
        return `${r.platform}: ${r.error}`;
      });

      if (ok.length > 0) {
        log(`[POST-WORKER] ${videoId} OK → ${ok.join(", ")}`);
      }
      if (failed.length > 0) {
        log(`[POST-WORKER] ${videoId} FAIL → ${failed.join("; ")}`);
      }
      for (const r of results) {
        const postUrl = r.postUrl ?? (r.postId ? (r.platform === "YOUTUBE"
          ? `https://youtube.com/shorts/${r.postId}`
          : r.platform === "FACEBOOK"
            ? `https://www.facebook.com/reel/${r.postId}`
            : undefined) : undefined);
        if (r.success) {
          fl?.poster(`POST RESULT: platform=${r.platform} status=ok postId=${r.postId ?? "?"}${postUrl ? ` url=${postUrl}` : ""}`);
        } else {
          fl?.poster(`POST RESULT: platform=${r.platform} status=failed error=${r.error ?? "unknown"}`);
        }
      }

      // Check for cooldown entries that need re-enqueue
      const freshRow = await db.video.findUnique({
        where: { id: videoId },
        select: { postedPlatforms: true },
      });
      const entries = (freshRow?.postedPlatforms ?? []) as Array<{
        platform: string;
        success?: boolean | string;
        retryAfter?: number;
        scheduledFor?: string;
      }>;

      for (const e of entries) {
        if (e.success === "cooldown" && e.retryAfter) {
          cooldowns.push({ platform: e.platform, retryAfter: e.retryAfter });
        }
      }

      if (cooldowns.length > 0) {
        const earliest = Math.min(...cooldowns.map((c) => c.retryAfter));
        const retryDate = new Date(earliest);
        const retryPlatforms = cooldowns.map((c) => c.platform);
        log(`[POST-WORKER] ${videoId} cooldown → re-enqueue for ${retryDate.toISOString()} (${retryPlatforms.join(", ")})`);
        fl?.poster(`COOLDOWN RETRY: enqueued for ${retryDate.toISOString()} → ${retryPlatforms.join(", ")}`);
        await enqueueScheduledPost(videoId, retryDate, retryPlatforms);
      }

      // Enqueue exact-time reconcile for natively-scheduled platforms (YT/FB)
      const scheduledEntries = entries.filter((e) => e.success === "scheduled" && e.scheduledFor);
      if (scheduledEntries.length > 0) {
        const latestSchedMs = Math.max(...scheduledEntries.map((e) => new Date(e.scheduledFor!).getTime()));
        const reconcileAt = new Date(latestSchedMs + RECONCILE_INTERVAL_MS);
        await enqueueReconcileCheck(videoId, reconcileAt, 0);
        log(`[POST-WORKER] ${videoId} → reconcile check at ${reconcileAt.toISOString()}`);
        fl?.poster(`RECONCILE: scheduled check at ${reconcileAt.toISOString()}`);
      }

    } catch (e) {
      err(`[POST-WORKER] Error posting ${videoId}:`, e);
      fl?.poster(`POST ERROR: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    } finally {
      recordMetric("queue.post_video.duration_ms", {
        videoId,
        durationMs: Date.now() - startedAt,
        platformCount: platforms.length,
      });
    }
  },
  {
    connection: postRedis as never,
    concurrency: 3,
    limiter: { max: 5, duration: 60000 },
  },
);

postWorker.on("failed", (job, e) => {
  err(`[POST-WORKER] Job ${job?.id} failed:`, e.message);
});
postWorker.on("completed", (job) => {
  debug(`[POST-WORKER] Job ${job.id} completed`);
});

// ── BullMQ reconcile worker (exact-time check: scheduled → posted) ──

const reconcileRedis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const reconcileWorker = new BullWorker<ReconcileJobData>(
  "reconcile-video",
  async (job) => {
    const startedAt = Date.now();
    const { videoId, attempt } = job.data;
    try {
      log(`[RECONCILE] Checking video ${videoId} (attempt ${attempt + 1})`);
      sfl.reconcile(`Checking video ${videoId} (attempt ${attempt + 1})`);

      const video = await db.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        status: true,
        postedPlatforms: true,
        scheduledPostTime: true,
        scheduledPlatforms: true,
        series: {
          select: {
            automation: { select: { id: true, name: true } },
            user: {
              select: {
                id: true, name: true, email: true,
                socialAccounts: {
                  select: {
                    id: true, platform: true, accessTokenEnc: true, refreshTokenEnc: true,
                    platformUserId: true, pageId: true, tokenExpiresAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

      if (!video) {
        log(`[RECONCILE] Video ${videoId} not found, skipping`);
        return;
      }
      if (!["READY", "SCHEDULED"].includes(video.status)) {
        log(`[RECONCILE] Video ${videoId} status=${video.status}, nothing to reconcile`);
        return;
      }

    type PlatEntry = { platform: string; success?: boolean | string; postId?: string | null; url?: string | null; scheduledFor?: string; error?: string };
      const entries = getPlatformEntriesArray(video.postedPlatforms) as PlatEntry[];
      const scheduledEntries = entries.filter((e) => e.success === "scheduled" && e.postId);
      if (scheduledEntries.length === 0) {
        log(`[RECONCILE] Video ${videoId}: no scheduled entries to check`);
        return;
      }

      const user = video.series?.user;
      const autoInfo = video.series?.automation;
      const rfl = autoInfo && user
        ? getAutomationFileLogger(user.id, user.name ?? user.email?.split("@")[0] ?? "user", autoInfo.id, autoInfo.name)
        : null;

      let changed = false;
      const nowMs = Date.now();
      const FORCE_PROMOTE_MS = 90 * 60 * 1000;

      for (const entry of scheduledEntries) {
      const entrySchedTime = entry.scheduledFor ? new Date(entry.scheduledFor).getTime() : 0;
      const videoSchedTime = video.scheduledPostTime ? new Date(video.scheduledPostTime).getTime() : 0;
      const effectiveSchedTime = entrySchedTime || videoSchedTime;
      const overdueMins = effectiveSchedTime > 0 ? Math.round((nowMs - effectiveSchedTime) / 60000) : 0;

      let isLive = false;

      if (entry.platform === "YOUTUBE" && user) {
        const account = user.socialAccounts.find((a) => a.platform === "YOUTUBE");
        if (account) {
          const accessToken = decrypt(account.accessTokenEnc);
          const refreshToken = account.refreshTokenEnc ? decrypt(account.refreshTokenEnc) : null;
          const privacy = await getYouTubeVideoPrivacy(
            accessToken, refreshToken, entry.postId!, account.platformUserId, user.id,
          );
          isLive = privacy === "public";
          if (isLive) log(`[RECONCILE] YT ${videoId}: postId=${entry.postId} → public (${overdueMins}m overdue)`);
        }
      } else if (entry.platform === "FACEBOOK" && user) {
        const account = user.socialAccounts.find((a) => a.platform === "FACEBOOK");
        if (account) {
          let accessToken = decrypt(account.accessTokenEnc);
          if (account.refreshTokenEnc && account.pageId) {
            try {
              accessToken = await getFreshFacebookToken(
                account.id, accessToken, account.refreshTokenEnc, account.pageId, account.tokenExpiresAt,
              );
            } catch { /* use existing */ }
          }
          const published = await getFacebookVideoPublished(entry.postId!, accessToken);
          isLive = published === true;
          if (isLive) log(`[RECONCILE] FB ${videoId}: postId=${entry.postId} → published (${overdueMins}m overdue)`);
        }
      }

      if (!isLive && effectiveSchedTime > 0 && (nowMs - effectiveSchedTime) > FORCE_PROMOTE_MS) {
        log(`[RECONCILE] Force-promoting ${entry.platform} for ${videoId}: ${overdueMins}m overdue`);
        isLive = true;
      }

      if (isLive) {
        entry.success = true;
        delete entry.scheduledFor;
        changed = true;
        log(`[RECONCILE] ${entry.platform} ${videoId}: scheduled → posted`);
        rfl?.poster(`RECONCILE: ${entry.platform} → posted`);
        sfl.reconcile(`${videoId}: ${entry.platform} scheduled → posted`);
      }
      }

      const targeted = ((video.scheduledPlatforms ?? []) as string[]) ?? [];
      const shouldPromote = video.status !== "POSTED" && shouldPromoteVideoToPosted(entries, targeted);

      if (shouldPromote) {
        const nextStatus = deriveVideoStatusFromPlatforms(video.status, entries, targeted);
        await db.video.update({
          where: { id: videoId },
          data: { status: nextStatus, postedPlatforms: entries as never },
        });
        const postedPlats = entries.filter(e => e.success === true).map(e => e.platform).join(", ");
        log(`[RECONCILE] ${videoId} → POSTED (${postedPlats})`);
        rfl?.poster(`PROMOTED: video=${videoId} → POSTED (${postedPlats})`);
        sfl.reconcile(`${videoId} → POSTED (${postedPlats})`);
        if (autoInfo?.id) {
          const platformOutcome = entries
            .map((e) => `${e.platform}=${String(e.success ?? "unknown")}`)
            .join(", ");
          await writeSchedulerLog(
            autoInfo.id,
            "posted",
            `Status promotion: video ${videoId} SCHEDULED/READY → POSTED | outcomes: ${platformOutcome}`,
            { videoId },
          );
        }
      } else if (changed) {
        await db.video.update({
          where: { id: videoId },
          data: { postedPlatforms: entries as never },
        });

      const stillScheduled = entries.filter((e) => e.success === "scheduled").length;
      if (stillScheduled > 0) {
        const nextAt = new Date(Date.now() + RECONCILE_INTERVAL_MS);
        await enqueueReconcileCheck(videoId, nextAt, attempt + 1);
        log(`[RECONCILE] ${videoId}: ${stillScheduled} platform(s) still scheduled, re-check at ${nextAt.toISOString()}`);
        if (autoInfo?.id) {
          const platformOutcome = entries
            .map((e) => `${e.platform}=${String(e.success ?? "unknown")}`)
            .join(", ");
          await writeSchedulerLog(
            autoInfo.id,
            "skipped",
            `Reconcile pending: video ${videoId} still waiting on ${stillScheduled} platform(s) | outcomes: ${platformOutcome}`,
            { videoId },
          );
        }
      }
      } else {
        const nextAt = new Date(Date.now() + RECONCILE_INTERVAL_MS);
        await enqueueReconcileCheck(videoId, nextAt, attempt + 1);
        log(`[RECONCILE] ${videoId}: no change, re-check at ${nextAt.toISOString()}`);
      }
    } finally {
      recordMetric("queue.reconcile_video.duration_ms", {
        videoId,
        attempt,
        durationMs: Date.now() - startedAt,
      });
    }
  },
  {
    connection: reconcileRedis as never,
    concurrency: 5,
  },
);

reconcileWorker.on("failed", (job, e) => {
  err(`[RECONCILE] Job ${job?.id} failed:`, e.message);
});
reconcileWorker.on("completed", (job) => {
  debug(`[RECONCILE] Job ${job.id} completed`);
});

// ── Cron: Build planning at BUILD_ALL_TIME ──

const [buildH, buildM] = BUILD_ALL_TIME.split(":").map(Number);
cron.schedule(`${buildM} ${buildH} * * *`, () => {
  log(`planDailyBuilds: BUILD_ALL_TIME (${BUILD_ALL_TIME} ${BUILD_ALL_TIMEZONE}) triggered`);
  sfl.action(`CRON: planDailyBuilds triggered (BUILD_ALL_TIME ${BUILD_ALL_TIME})`);
  planDailyBuilds("build-window-cron");
});

// Catch-up cron: 2 hours after build window, pick up anything missed
const catchUpMin = (buildM + BUILD_WINDOW_MINUTES + 60) % 60;
const catchUpH = (buildH + Math.floor((buildM + BUILD_WINDOW_MINUTES + 60) / 60)) % 24;
cron.schedule(`${catchUpMin} ${catchUpH} * * *`, () => {
  log("planDailyBuilds: catch-up run (BUILD_ALL_TIME + 2h)");
  sfl.action(`CRON: catch-up planDailyBuilds triggered`);
  planDailyBuilds("catch-up-cron");
});

// Safety net: recover stuck videos + reconcile overdue posts (every 4h)
cron.schedule("0 */4 * * *", () => {
  debug("safetyNet: running recovery + reconciliation");
  sfl.action(`CRON: safetyNet triggered (every 4h)`);
  safetyNet();
});

// Run insights refresh once per day at 02:00 (server TZ)
cron.schedule("0 2 * * *", () => {
  log("Running daily insights refresh...");
  sfl.action(`CRON: daily insights refresh triggered`);
  refreshInsightsDaily();
});

// Probe niche trending data at 03:00, then optimize clip automations from scorecard
cron.schedule("0 3 * * *", async () => {
  log("Running daily niche trending probe...");
  sfl.action(`CRON: daily niche probe + optimize triggered`);
  try {
    await probeAllNicheTrends(db);
    sfl.action(`Niche trending probe completed`);
  } catch (e) {
    err("probeAllNicheTrends error:", e);
    sfl.error(`probeAllNicheTrends: ${e instanceof Error ? e.message : String(e)}`);
  }
  log("Optimizing clip automations from today's scorecard...");
  await optimizeClipAutomations();
});

// Purge NicheTrending records older than 30 days (runs daily at 03:30)
cron.schedule("30 3 * * *", async () => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const { count } = await db.nicheTrending.deleteMany({
      where: { date: { lt: cutoff } },
    });
    if (count > 0) log(`Purged ${count} NicheTrending row(s) older than 30 days`);
  } catch (e) {
    err("NicheTrending retention cleanup error:", e);
  }
});

async function backfillLastRunAt() {
  try {
    const stale = await db.automation.findMany({
      where: { lastRunAt: null, seriesId: { not: null } },
      select: { id: true, name: true, seriesId: true },
    });
    if (stale.length === 0) return;
    log(`Backfilling lastRunAt for ${stale.length} automation(s) with null lastRunAt...`);
    for (const a of stale) {
      const latest = await db.video.findFirst({
        where: { seriesId: a.seriesId! },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (latest) {
        await db.automation.update({
          where: { id: a.id },
          data: { lastRunAt: latest.createdAt },
        });
        log(`  Backfilled "${a.name}" → ${latest.createdAt.toISOString()}`);
      }
    }
  } catch (e) {
    warn("backfillLastRunAt error:", e);
  }
}

// ── Bootstrap: create clip-repurpose automations for every niche per user ──

async function bootstrapClipAutomations() {
  try {
    const users = await db.user.findMany({ select: { id: true } });
    if (users.length === 0) return;

    const nicheKeys = Object.keys(CLIP_NICHE_META).filter((k) => k !== "auto");

    for (const user of users) {
      const existing = await db.automation.findMany({
        where: { userId: user.id, automationType: "clip-repurpose" },
        select: { clipConfig: true },
      });
      const existingNiches = new Set(
        existing.map((a) => (a.clipConfig as Record<string, unknown>)?.clipNiche as string).filter(Boolean),
      );

      const missing = nicheKeys.filter((k) => !existingNiches.has(k));
      if (missing.length === 0) continue;

      log(`[BOOTSTRAP] Creating ${missing.length} clip automation(s) for user ${user.id}`);
      sfl.action(`BOOTSTRAP: creating ${missing.length} clip automation(s) for user ${user.id}`);

      let created = 0;
      for (const niche of missing) {
        const meta = CLIP_NICHE_META[niche]!;
        try {
          await db.$transaction(async (tx) => {
            const series = await tx.series.create({
              data: {
                userId: user.id,
                name: `[Clip] ${meta.label}`,
                niche: "clip-repurpose",
                artStyle: "realistic",
                tone: "dramatic",
              },
            });
            await tx.automation.create({
              data: {
                userId: user.id,
                name: meta.label,
                niche: "clip-repurpose",
                artStyle: "realistic",
                automationType: "clip-repurpose",
                clipConfig: {
                  clipNiche: niche,
                  clipDurationSec: 45,
                  cropMode: "blur-bg",
                  creditOriginal: true,
                },
                targetPlatforms: meta.bestPlatforms,
                enabled: false,
                frequency: "daily",
                postTime: meta.bestTimesUTC[0],
                timezone: BUILD_ALL_TIMEZONE,
                seriesId: series.id,
              },
            });
          });
          created++;
        } catch (nicheErr) {
          warn(`[BOOTSTRAP] Failed to create clip auto for "${niche}" (user ${user.id}):`, nicheErr);
        }
      }
      log(`[BOOTSTRAP] Created ${created}/${missing.length} clip automation(s) for user ${user.id}`);
      sfl.action(`BOOTSTRAP: created ${created}/${missing.length} clip automation(s) for user ${user.id}`);
    }
  } catch (e) {
    err("bootstrapClipAutomations error:", e);
    sfl.error(`bootstrapClipAutomations: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Optimize: daily scorecard-driven enable/disable of clip automations ──

const PLATFORM_POST_GAP_MINUTES = parseInt(process.env.PLATFORM_POST_GAP_MINUTES ?? "60", 10);

async function optimizeClipAutomations() {
  try {
    // Step 1: Disable ALL clip-repurpose automations
    const { count: disabledCount } = await db.automation.updateMany({
      where: { automationType: "clip-repurpose" },
      data: { enabled: false },
    });
    log(`[OPTIMIZE] Reset ${disabledCount} clip automation(s) to disabled`);
    sfl.action(`OPTIMIZE: reset ${disabledCount} clip automation(s) to disabled`);

    // Step 2: Read today's NicheTrending data
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const rows = await db.nicheTrending.findMany({
      where: { date: { gte: todayStart } },
      orderBy: { date: "desc" },
    });

    // Dedupe: keep latest entry per niche
    const latestByNiche = new Map<string, { niche: string; stats: NicheTrendingStats }>();
    for (const row of rows) {
      if (!latestByNiche.has(row.niche)) {
        latestByNiche.set(row.niche, {
          niche: row.niche,
          stats: row.stats as unknown as NicheTrendingStats,
        });
      }
    }

    if (latestByNiche.size === 0) {
      log(`[OPTIMIZE] No NicheTrending data for today, skipping optimization`);
      return;
    }

    // Step 3: Rank niches
    const ranked = rankNichesFromTrending([...latestByNiche.values()]);
    if (ranked.length === 0) {
      log(`[OPTIMIZE] No rankable niches, skipping`);
      return;
    }

    // Step 4: Pick top N to fill DAILY_CLIP_POSTS_PER_PLATFORM per platform
    const selected = pickTopNichesForTarget(ranked, DAILY_CLIP_POSTS_PER_PLATFORM);
    log(`[OPTIMIZE] Selected ${selected.length} niche(s) for ${DAILY_CLIP_POSTS_PER_PLATFORM} posts/platform`);
    sfl.action(`OPTIMIZE: selected ${selected.length} niche(s) for ${DAILY_CLIP_POSTS_PER_PLATFORM} posts/platform`);

    // Step 5: Compute staggered schedule
    const schedule = computeStaggeredSchedule(selected, PLATFORM_POST_GAP_MINUTES);

    // Step 6: Enable selected automations, update postTime + targetPlatforms
    for (const entry of selected) {
      const postTime = schedule.get(entry.niche) ?? entry.bestTimesUTC[0];
      const platforms = entry.assignedPlatforms;
      const autos = await db.automation.findMany({
        where: {
          automationType: "clip-repurpose",
          clipConfig: { path: ["clipNiche"], equals: entry.niche },
        },
        select: { id: true, enabled: true, name: true },
      });

      for (const auto of autos) {
        // If an automation is newly re-enabled by optimizer, reset lastRunAt so
        // the next build window treats it as due and schedules a fresh video.
        await db.automation.update({
          where: { id: auto.id },
          data: {
            enabled: true,
            postTime,
            targetPlatforms: platforms,
            ...(!auto.enabled ? { lastRunAt: null } : {}),
          },
        });
      }

      if (autos.length > 0) {
        const reEnabled = autos.filter((a) => !a.enabled).length;
        log(`[OPTIMIZE] Enabled "${entry.niche}" → postTime=${postTime}, platforms=${platforms.join(",")}, rank=${entry.rankScore.toFixed(1)}, autos=${autos.length}, reEnabled=${reEnabled}`);
        sfl.action(`OPTIMIZE: enabled "${entry.niche}" → postTime=${postTime}, platforms=${platforms.join(",")}, rank=${entry.rankScore.toFixed(1)}, autos=${autos.length}, reEnabled=${reEnabled}`);
      }
    }

    log(`[OPTIMIZE] Done. ${selected.length} clip automation(s) enabled for today.`);
    sfl.action(`OPTIMIZE: done. ${selected.length} clip automation(s) enabled for today.`);
  } catch (e) {
    err("optimizeClipAutomations error:", e);
    sfl.error(`optimizeClipAutomations: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Startup ──

log(`Started. Event-driven scheduler.`);
log(`  Build: ${BUILD_ALL_TIME} ${BUILD_ALL_TIMEZONE} (${BUILD_WINDOW_MINUTES}min window)`);
log(`  Post-video: BullMQ delayed queue (exact-time posting)`);
log(`  Clip optimizer: ${DAILY_CLIP_POSTS_PER_PLATFORM} posts/platform, ${PLATFORM_POST_GAP_MINUTES}min gap`);
log(`  Safety net: every 4h (recovery + reconciliation)`);
log(`  Catch-up: ${catchUpH}:${String(catchUpMin).padStart(2, "0")} (BUILD_ALL_TIME + 2h)`);

sfl.action(`Scheduler started — Build: ${BUILD_ALL_TIME} ${BUILD_ALL_TIMEZONE}, Clip optimizer: ${DAILY_CLIP_POSTS_PER_PLATFORM} posts/platform, Safety net: every 4h`);

cleanupOldLogs().then(() => log("Old log cleanup done")).catch(() => {});
backfillLastRunAt()
  .then(() => bootstrapClipAutomations())
  .then(() => {
    planDailyBuilds("startup");
    safetyNet();
  });
