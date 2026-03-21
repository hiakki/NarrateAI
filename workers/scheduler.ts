import "dotenv/config";
import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { enqueueVideoGeneration, enqueueClipRepurpose } from "../src/services/queue";
import { postVideoToSocials } from "../src/services/social-poster";
import { refreshInsightsForUser } from "../src/services/insights";

import { getArtStyleById } from "../src/config/art-styles";
import { getNicheById } from "../src/config/niches";
import { resolveProviders } from "../src/services/providers/resolve";
import { getDefaultVoiceId } from "../src/config/voices";
import { createLogger, runWithAutomationIdAsync } from "../src/lib/logger";

const db = new PrismaClient();
const logger = createLogger("Scheduler");
const { log, warn, error: err, debug } = logger;
const SCHEDULER_CONCURRENCY = parseInt(process.env.SCHEDULER_CONCURRENCY ?? "3", 10);

const STUCK_GENERATING_MS = 15 * 60 * 1000; // 15 min
const STUCK_QUEUED_MS = 30 * 60 * 1000;     // 30 min
const FAILED_RETRY_AFTER_MS = 10 * 60 * 1000; // retry FAILED after 10 min
const MAX_AUTO_RETRIES = 2;

const BUILD_ALL_TIME = process.env.BUILD_ALL_TIME ?? "04:00";
const BUILD_ALL_TIMEZONE = process.env.BUILD_ALL_TIMEZONE ?? "Asia/Kolkata";
const BUILD_WINDOW_MINUTES = 60;

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
  targetPlatforms: string[];
  frequency: string;
  postTime: string;
  timezone: string;
  lastRunAt: Date | null;
  seriesId: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    defaultLlmProvider: string | null;
    defaultTtsProvider: string | null;
    defaultImageProvider: string | null;
    defaultImageToVideoProvider: string | null;
  };
}

function isInBuildWindow(): boolean {
  const [buildH, buildM] = BUILD_ALL_TIME.split(":").map(Number);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUILD_ALL_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const nowMin = h * 60 + m;
  const buildMin = buildH * 60 + buildM;
  return nowMin >= buildMin && nowMin < buildMin + BUILD_WINDOW_MINUTES;
}

function hasRunToday(lastRunAt: Date | null, timezone: string): boolean {
  if (!lastRunAt) return false;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()) === fmt.format(lastRunAt);
}

function localTimeToUTC(timeStr: string, tz: string): Date {
  const [targetH, targetM] = timeStr.split(":").map(Number);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year")!.value);
  const month = parseInt(parts.find((p) => p.type === "month")!.value) - 1;
  const day = parseInt(parts.find((p) => p.type === "day")!.value);

  let guess = new Date(Date.UTC(year, month, day, targetH, targetM, 0));
  for (let i = 0; i < 3; i++) {
    const lp = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(guess);
    const lh = parseInt(lp.find((p) => p.type === "hour")!.value);
    const lm = parseInt(lp.find((p) => p.type === "minute")!.value);
    const diff = (targetH * 60 + targetM) - (lh * 60 + lm);
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff * 60000);
  }
  return guess;
}

function shouldBuildNow(auto: AutoRow): { build: boolean; reason: string } {
  if (!isInBuildWindow()) {
    return { build: false, reason: "outside build window" };
  }

  const freqDays: Record<string, number> = { daily: 1, every_other_day: 2, weekly: 7 };
  const gapDays = freqDays[auto.frequency] ?? 1;

  if (auto.lastRunAt) {
    const msSinceLast = Date.now() - auto.lastRunAt.getTime();
    const minGapMs = (gapDays - 0.25) * 24 * 60 * 60 * 1000;
    if (msSinceLast < minGapMs) {
      return { build: false, reason: `ran ${(msSinceLast / 3600000).toFixed(1)}h ago, need ~${gapDays}d gap` };
    }
  }

  return { build: true, reason: `build window active, due for build` };
}

async function processAutomation(auto: Awaited<ReturnType<typeof db.automation.findMany>>[number]) {
  return runWithAutomationIdAsync(auto.id, async () => {
  const { build, reason } = shouldBuildNow(auto as unknown as AutoRow);

  if (!build) {
    debug(`[SKIP]`, `"${auto.name}" — ${reason}`);
    return;
  }

  log(`[BUILD]`, `"${auto.name}" — ${reason}`);

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

  const pendingVideo = await db.video.findFirst({
    where: {
      seriesId: auto.seriesId,
      status: { in: ["QUEUED", "GENERATING"] },
    },
  });
  if (pendingVideo) {
    log(`[SKIP]`, `Video in progress (${pendingVideo.id}), skipping`);
    return;
  }

  // If the most recent video is READY but not posted to all target platforms, skip new generation
  const targets = (auto.targetPlatforms ?? []) as string[];
  if (targets.length > 0) {
    const readyVideo = await db.video.findFirst({
      where: { seriesId: auto.seriesId, status: "READY" },
      orderBy: { createdAt: "desc" },
    });
    if (readyVideo) {
      const rawPosted = (readyVideo.postedPlatforms ?? []) as (
        | string
        | { platform: string; success?: boolean | "uploading" }
      )[];
      const allPosted = targets.every((t) => {
        const entry = rawPosted.find((p) =>
          typeof p === "string" ? p === t : p.platform === t,
        );
        if (!entry) return false;
        if (typeof entry === "string") return true;
        return entry.success === true;
      });
      if (!allPosted) {
        log(`[SKIP]`, `Video ${readyVideo.id} is READY but not posted to all platforms yet, skipping new generation`);
        return;
      }
    }
  }

  // If the most recent video FAILED, retry it instead of creating a new one
  const failedVideo = await db.video.findFirst({
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
  });
  if (failedVideo) {
    const completedStages = (failedVideo.checkpointData as { completedStages?: string[] })?.completedStages ?? [];
    const scenes = (failedVideo.scenesJson as { text: string; visualDescription: string }[]) ?? [];
    const resolved = resolveProviders(failedVideo.series, failedVideo.series.user);
    const artStyle = getArtStyleById(failedVideo.series.artStyle);
    const niche = getNicheById(failedVideo.series.niche);
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
      automationName: auto.name,
      title: failedVideo.title || undefined,
      scriptText: failedVideo.scriptText || undefined,
      scenes: scenes.length > 0 ? scenes : undefined,
      artStyle: failedVideo.series.artStyle,
      artStylePrompt: artStyle?.promptModifier ?? "cinematic, high quality",
      negativePrompt: artStyle?.negativePrompt ?? "low quality, blurry, watermark, text",
      tone: failedVideo.series.tone ?? "dramatic",
      niche: failedVideo.series.niche,
      voiceId: failedVideo.series.voiceId ?? getDefaultVoiceId(resolved.tts),
      language: failedVideo.series.language ?? "en",
      musicPath: niche?.defaultMusic,
      duration: failedVideo.targetDuration ?? failedVideo.duration ?? 45,
      llmProvider: resolved.llm,
      ttsProvider: resolved.tts,
      imageProvider: resolved.image,
      imageToVideoProvider: usr.defaultImageToVideoProvider ?? process.env.USE_IMAGE_TO_VIDEO ?? undefined,
      characterPrompt: failedVideo.series.character?.fullPrompt ?? undefined,
      aspectRatio: niche?.aspectRatio ?? "9:16",
    });

    await db.automation.update({
      where: { id: auto.id },
      data: { lastRunAt: new Date() },
    });

    log(`[RETRY]`, `Re-enqueued failed video ${failedVideo.id} instead of creating new (resumes from [${completedStages.join(",")}])`);
    return;
  }

  // ── CLIP-REPURPOSE branch: different pipeline entirely ──
  const autoType = ((auto as Record<string, unknown>).automationType as string) ?? "original";

  if (autoType === "clip-repurpose") {
    const clipConfig = ((auto as Record<string, unknown>).clipConfig as Record<string, unknown>) ?? {};
    const postSlot = auto.postTime.split(",")[0].trim();
    let scheduledPostTime = localTimeToUTC(postSlot, auto.timezone);
    if (scheduledPostTime.getTime() < Date.now() + 15 * 60 * 1000) {
      scheduledPostTime = new Date(scheduledPostTime.getTime() + 24 * 60 * 60 * 1000);
    }
    try {
      const video = await db.video.create({
        data: {
          seriesId: auto.seriesId,
          targetDuration: auto.duration,
          status: "QUEUED",
          scheduledPostTime,
          scheduledPlatforms: (auto.targetPlatforms ?? []) as string[],
        },
      });

      await enqueueClipRepurpose({
        videoId: video.id,
        seriesId: auto.seriesId,
        userId: auto.user.id,
        userName: auto.user.name ?? auto.user.email?.split("@")[0] ?? "user",
        automationName: auto.name,
        niche: auto.niche,
        language: auto.language,
        tone: auto.tone,
        clipConfig: {
          clipNiche: (clipConfig.clipNiche as string) ?? "auto",
          clipDurationSec: (clipConfig.clipDurationSec as number) ?? 45,
          cropMode: (clipConfig.cropMode as "blur-bg" | "center-crop") ?? "blur-bg",
          creditOriginal: (clipConfig.creditOriginal as boolean) ?? true,
        },
        targetPlatforms: (auto.targetPlatforms ?? []) as string[],
      });

      await db.automation.update({
        where: { id: auto.id },
        data: { lastRunAt: new Date() },
      });

      log(`[ENQUEUE]`, `Queued clip-repurpose ${video.id}`);
    } catch (qErr: unknown) {
      err(`[ERR]`, `Failed to enqueue clip-repurpose for "${auto.name}":`, qErr);
    }
    return;
  }

  // ── ORIGINAL pipeline: AI-generated video ──
  let characterPrompt: string | undefined;
  if ((auto as Record<string, unknown>).characterId) {
    const char = await db.character.findUnique({
      where: { id: (auto as Record<string, unknown>).characterId as string },
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

  const origPostSlot = auto.postTime.split(",")[0].trim();
  const origScheduledPostTime = localTimeToUTC(origPostSlot, auto.timezone);
  try {
    const video = await db.video.create({
      data: {
        seriesId: auto.seriesId,
        targetDuration: auto.duration,
        status: "QUEUED",
        scheduledPostTime: origScheduledPostTime,
        scheduledPlatforms: (auto.targetPlatforms ?? []) as string[],
      },
    });

    await enqueueVideoGeneration({
      videoId: video.id,
      seriesId: auto.seriesId,
      userId: auto.user.id,
      userName: auto.user.name ?? auto.user.email?.split("@")[0] ?? "user",
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
    });

    await db.automation.update({
      where: { id: auto.id },
      data: { lastRunAt: new Date() },
    });

    log(`[ENQUEUE]`, `Queued video ${video.id} (script gen in worker)`);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    err(`[ERR]`, `Failed to auto-generate: ${msg}`);
  }
  });
}

async function runInBatches<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(fn));
  }
}

async function checkSchedules() {
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
      },
    });

    debug(`${automations.length} enabled automation(s), batch=${SCHEDULER_CONCURRENCY}`);

    await runInBatches(automations, SCHEDULER_CONCURRENCY, processAutomation);
  } catch (e) {
    err("Error in schedule check:", e);
  }
}

async function checkReadyVideosForPosting() {
  try {
    const now = new Date();

    const readyVideos = await db.video.findMany({
      where: {
        status: "READY",
        scheduledPostTime: { lte: now },
        NOT: { scheduledPlatforms: { equals: null } },
      },
      take: 15,
    });

    if (readyVideos.length === 0) return;

    const STALE_UPLOAD_MS = 10 * 60 * 1000;
    const postTasks: { videoId: string; remaining: string[] }[] = [];

    for (const video of readyVideos) {
      const scheduled = (video.scheduledPlatforms ?? []) as string[];
      if (scheduled.length === 0) continue;

      const rawPosted = (video.postedPlatforms ?? []) as (
        | string
        | { platform: string; success?: boolean | "uploading"; postId?: string; url?: string; startedAt?: number }
      )[];

      const remaining = scheduled.filter((t) => {
        const entry = rawPosted.find((p) =>
          typeof p === "string" ? p === t : p.platform === t,
        );
        if (!entry) return true;
        if (typeof entry === "string") return false;
        if (entry.success === true) return false;
        if ((entry as { success?: string }).success === "scheduled") return false;
        if (entry.success === undefined && (entry.postId || entry.url)) return false;
        if (entry.success === "uploading") {
          const age = Date.now() - (entry.startedAt ?? 0);
          return age >= STALE_UPLOAD_MS;
        }
        return true;
      });

      if (remaining.length > 0) {
        postTasks.push({ videoId: video.id, remaining });
      }
    }

    if (postTasks.length > 0) {
      log(`Scheduling ${postTasks.length} ready video(s) on native platforms`);
      await Promise.allSettled(
        postTasks.map(async ({ videoId, remaining }) => {
          const v = await db.video.findUnique({ where: { id: videoId }, select: { scheduledPostTime: true } });
          const scheduledAt = v?.scheduledPostTime
            ? new Date(v.scheduledPostTime)
            : new Date(Date.now() + 60 * 60 * 1000);
          log(`Scheduling video ${videoId} to ${remaining.join(", ")} for ${scheduledAt.toISOString()}`);
          return postVideoToSocials(videoId, remaining, scheduledAt);
        }),
      );
    }
  } catch (e) {
    err("Error checking ready videos:", e);
  }
}

/**
 * Instagram Reels don't support native scheduling via API (requires whitelisted app).
 * The social-poster defers IG by storing success="scheduled" + scheduledFor timestamp.
 * This function checks for those deferred entries and publishes them when the time arrives.
 */
async function checkDeferredInstagramPosts() {
  try {
    const now = new Date();

    // Find videos that may have deferred IG entries (stored in postedPlatforms JSON)
    const candidates = await db.video.findMany({
      where: {
        status: { in: ["READY", "SCHEDULED", "POSTED"] },
      },
      select: { id: true, postedPlatforms: true },
      take: 100,
    });

    const igPostTasks: string[] = [];

    for (const video of candidates) {
      const rawPosted = (video.postedPlatforms ?? []) as (
        | string
        | { platform: string; success?: boolean | string; scheduledFor?: string }
      )[];

      const igEntry = rawPosted.find((p) =>
        typeof p === "string" ? p === "INSTAGRAM" : p.platform === "INSTAGRAM",
      );
      if (!igEntry || typeof igEntry === "string") continue;

      if (igEntry.success !== "scheduled") continue;
      if (!igEntry.scheduledFor) continue;

      const scheduledFor = new Date(igEntry.scheduledFor);
      if (scheduledFor > now) continue;

      igPostTasks.push(video.id);
    }

    if (igPostTasks.length === 0) return;

    log(`Publishing ${igPostTasks.length} deferred Instagram Reel(s) (scheduled time has arrived)`);

    await Promise.allSettled(
      igPostTasks.map(async (videoId) => {
        log(`Deferred IG publish: video ${videoId} — resetting entry and posting immediately`);

        // Reset IG entry from "scheduled" to allow postVideoToSocials to proceed
        const video = await db.video.findUnique({
          where: { id: videoId },
          select: { postedPlatforms: true },
        });
        if (video) {
          const entries = (video.postedPlatforms ?? []) as { platform: string; success?: unknown; scheduledFor?: string }[];
          const updated = entries.map((e) => {
            if (e.platform === "INSTAGRAM" && e.success === "scheduled") {
              return { ...e, success: false, scheduledFor: undefined };
            }
            return e;
          });
          await db.video.update({
            where: { id: videoId },
            data: { postedPlatforms: updated as never },
          });
        }

        return postVideoToSocials(videoId, ["INSTAGRAM"]);
      }),
    );
  } catch (e) {
    err("Error checking deferred Instagram posts:", e);
  }
}

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
            automation: { select: { id: true, name: true, enabled: true, characterId: true } },
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

    for (const video of recoverable) {
      const age = now - new Date(video.updatedAt).getTime();
      const retryCount = video.retryCount ?? 0;

      if (video.status === "FAILED") {
        // Only auto-retry FAILED videos that belong to an enabled automation
        const auto = video.series.automation;
        if (!auto?.enabled) continue;
        if (retryCount >= MAX_AUTO_RETRIES) {
          if (retryCount === MAX_AUTO_RETRIES) {
            log(`Video ${video.id} exhausted ${MAX_AUTO_RETRIES} auto-retries, leaving as FAILED`);
          }
          continue;
        }
        if (age < FAILED_RETRY_AFTER_MS) continue;
        log(`Auto-retrying FAILED video ${video.id} (attempt ${retryCount + 1}/${MAX_AUTO_RETRIES}, auto="${auto.name}", failed ${Math.round(age / 60000)}m ago)`);
      } else {
        const threshold = video.status === "GENERATING" ? STUCK_GENERATING_MS : STUCK_QUEUED_MS;
        if (age < threshold) {
          debug(`SKIP ${video.id} (${video.status}) — ${Math.round(age / 1000)}s old, threshold=${Math.round(threshold / 1000)}s`);
          continue;
        }
        const autoName = video.series.automation?.name ?? "manual";
        log(`Recovering stuck video ${video.id} (${video.status} for ${Math.round(age / 60000)}m, auto="${autoName}")`);
      }

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

        const usr = video.series.user;
        await enqueueVideoGeneration({
          videoId: video.id,
          seriesId: video.seriesId,
          userId: usr.id,
          userName: usr.name ?? usr.email?.split("@")[0] ?? "user",
          automationName: video.series.automation?.name,
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

let running = false;

async function tick() {
  if (running) {
    log("Previous check still running, skipping this tick");
    return;
  }
  running = true;
  try {
    await recoverStuckVideos();
    await checkSchedules();
    await checkReadyVideosForPosting();
    await checkDeferredInstagramPosts();
  } finally {
    running = false;
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

cron.schedule("*/5 * * * *", () => {
  log("Running schedule check...");
  tick();
});

// Run insights refresh once per day at 02:00 (server TZ)
cron.schedule("0 2 * * *", () => {
  log("Running daily insights refresh...");
  refreshInsightsDaily();
});

log(`Started. Build window: ${BUILD_ALL_TIME} ${BUILD_ALL_TIMEZONE} (${BUILD_WINDOW_MINUTES}min). Posts scheduled per-video. Tick every 5 min.`);
tick();
