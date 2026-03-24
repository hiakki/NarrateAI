import "dotenv/config";
import cron from "node-cron";
import { Prisma, PrismaClient } from "@prisma/client";
import { enqueueVideoGeneration, enqueueClipRepurpose } from "../src/services/queue";
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
import { getAutomationFileLogger, cleanupOldLogs } from "../src/lib/file-logger";

const db = new PrismaClient();
const logger = createLogger("Scheduler");
const { log, warn, error: err, debug } = logger;
const SCHEDULER_CONCURRENCY = parseInt(process.env.SCHEDULER_CONCURRENCY ?? "3", 10);

const STUCK_GENERATING_MS = 15 * 60 * 1000; // 15 min
const STUCK_QUEUED_MS = 30 * 60 * 1000;     // 30 min
const FAILED_RETRY_AFTER_MS = 10 * 60 * 1000; // retry FAILED after 10 min
const MAX_AUTO_RETRIES = 3;

const BUILD_ALL_TIME = process.env.BUILD_ALL_TIME ?? "04:00";
const BUILD_ALL_TIMEZONE = process.env.BUILD_ALL_TIMEZONE ?? "Asia/Kolkata";
const BUILD_WINDOW_MINUTES = 60;

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

/**
 * Calendar-day distance between now and lastRunAt in the given timezone.
 * Returns Infinity if lastRunAt is null (i.e. never ran, always due).
 */
function calendarDaysSinceRun(lastRunAt: Date | null, timezone: string): number {
  if (!lastRunAt) return Infinity;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const todayStr = fmt.format(new Date());
  const lastStr = fmt.format(lastRunAt);
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  const lastMs = new Date(lastStr + "T00:00:00Z").getTime();
  return Math.round((todayMs - lastMs) / (24 * 60 * 60 * 1000));
}

function localTimeToUTC(timeStr: string, tz: string): Date {
  const [targetH, targetM] = timeStr.split(":").map(Number);
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const year = parseInt(dateParts.find((p) => p.type === "year")!.value);
  const month = parseInt(dateParts.find((p) => p.type === "month")!.value) - 1;
  const day = parseInt(dateParts.find((p) => p.type === "day")!.value);

  // Estimate UTC offset using noon as a safe reference (avoids midnight hour ambiguity)
  const noonUtc = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const noonParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(noonUtc);
  const noonH = parseInt(noonParts.find((p) => p.type === "hour")!.value);
  const noonM = parseInt(noonParts.find((p) => p.type === "minute")!.value);
  const offsetMin = (noonH * 60 + noonM) - 720;

  const targetUtcMin = targetH * 60 + targetM - offsetMin;
  let guess = new Date(Date.UTC(year, month, day, 0, targetUtcMin, 0));

  // One verification pass to handle DST edge cases
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
  const tz = auto.timezone || BUILD_ALL_TIMEZONE;
  const daysSince = calendarDaysSinceRun(auto.lastRunAt, tz);

  if (daysSince < gapDays) {
    return { build: false, reason: `ran ${daysSince}d ago (calendar), need ${gapDays}d gap` };
  }

  return { build: true, reason: `build window active, due for build (last ran ${daysSince}d ago)` };
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

async function processAutomation(auto: AutoRow) {
  return runWithAutomationIdAsync(auto.id, async () => {
  const runStart = Date.now();
  const fl = getAutomationFileLogger(
    auto.user.id,
    auto.user.name ?? auto.user.email?.split("@")[0] ?? "user",
    auto.id,
    auto.name,
  );
  const { build, reason } = shouldBuildNow(auto);

  if (!build) {
    debug(`[SKIP]`, `"${auto.name}" — ${reason}`);
    fl.scheduler(`SKIP: ${reason}`);
    // Only persist non-trivial skips to the DB log (avoid flooding with "outside build window")
    if (!reason.includes("outside build window")) {
      await writeSchedulerLog(auto.id, "skipped", reason, { durationMs: Date.now() - runStart });
    }
    return;
  }

  // Atomic lock: claim this automation by CAS-updating lastRunAt.
  // If another scheduler instance already claimed it, updateMany returns count=0.
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
    await writeSchedulerLog(auto.id, "skipped", msg, { durationMs: Date.now() - runStart });
    return;
  }

  log(`[BUILD]`, `"${auto.name}" — ${reason}`);
  fl.scheduler(`BUILD: "${auto.name}" — ${reason}`);

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
    const msg = `Video ${pendingVideo.id} is ${pendingVideo.status}`;
    log(`[SKIP]`, msg);
    fl.scheduler(`SKIP: pending video ${pendingVideo.id} (${pendingVideo.status})`);
    await writeSchedulerLog(auto.id, "skipped", msg, { durationMs: Date.now() - runStart, videoId: pendingVideo.id });
    return;
  }

  // If the most recent video is READY but not posted/scheduled to all target platforms, skip new generation.
  // "scheduled" counts as done — the post is queued on the platform and will go live automatically.
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
        const msg = `Video ${readyVideo.id} READY but not posted to all platforms yet`;
        log(`[SKIP]`, msg);
        fl.scheduler(`SKIP: ${msg}`);
        await writeSchedulerLog(auto.id, "skipped", msg, { durationMs: Date.now() - runStart, videoId: readyVideo.id });
        return;
      }
    }
  }

  // ── Route by automationType BEFORE retry logic to avoid cross-pipeline retries ──
  const autoType = auto.automationType ?? "original";

  if (autoType === "clip-repurpose") {
    const clipConfig = (auto.clipConfig as Record<string, unknown>) ?? {};
    const postSlot = auto.postTime.split(",")[0].trim();
    let scheduledPostTime = localTimeToUTC(postSlot, auto.timezone);
    if (scheduledPostTime.getTime() < Date.now() + 15 * 60 * 1000) {
      scheduledPostTime = new Date(scheduledPostTime.getTime() + 24 * 60 * 60 * 1000);
    }
    try {
      const video = await db.video.create({
        data: {
          seriesId: auto.seriesId!,
          targetDuration: auto.duration,
          status: "QUEUED",
          scheduledPostTime,
          scheduledPlatforms: (auto.targetPlatforms ?? []) as string[],
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
      });

      const msg = `Queued clip-repurpose, post at ${scheduledPostTime.toISOString()}`;
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

    const retryMsg = `Re-enqueued failed video (resumes from [${completedStages.join(",")}])`;
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

  const origPostSlot = auto.postTime.split(",")[0].trim();
  const origScheduledPostTime = localTimeToUTC(origPostSlot, auto.timezone);
  try {
    const video = await db.video.create({
      data: {
        seriesId: auto.seriesId!,
        targetDuration: auto.duration,
        status: "QUEUED",
        scheduledPostTime: origScheduledPostTime,
        scheduledPlatforms: (auto.targetPlatforms ?? []) as string[],
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
    });

    log(`[ENQUEUE]`, `Queued video ${video.id} (script gen in worker)`);
    fl.scheduler(`ENQUEUE: AI video=${video.id}, postAt=${origScheduledPostTime.toISOString()}`);
    await writeSchedulerLog(auto.id, "enqueued", `Queued AI video, post at ${origScheduledPostTime.toISOString()}`, { durationMs: Date.now() - runStart, videoId: video.id });
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

    await runInBatches(automations as unknown as AutoRow[], SCHEDULER_CONCURRENCY, processAutomation);
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
        NOT: { scheduledPlatforms: { equals: Prisma.JsonNull } },
      },
      include: {
        series: {
          select: {
            automation: { select: { id: true, name: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        },
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
          const vidRow = readyVideos.find((rv) => rv.id === videoId) as
            (typeof readyVideos[number] & { series?: { automation?: { id: string; name: string } | null; user?: { id: string; name: string | null; email: string } | null } }) | undefined;
          const autoInfo = vidRow?.series?.automation;
          const userInfo = vidRow?.series?.user;
          const fl = autoInfo && userInfo
            ? getAutomationFileLogger(userInfo.id, userInfo.name ?? userInfo.email?.split("@")[0] ?? "user", autoInfo.id, autoInfo.name)
            : null;

          const v = await db.video.findUnique({ where: { id: videoId }, select: { scheduledPostTime: true, updatedAt: true } });
          const age = Date.now() - new Date(v?.updatedAt ?? 0).getTime();
          if (age < 30_000) {
            debug(`Skipping ${videoId} — became READY ${Math.round(age / 1000)}s ago, clip worker may still be posting`);
            fl?.scheduler(`POST-SKIP: video=${videoId} became READY ${Math.round(age / 1000)}s ago, waiting for worker`);
            return;
          }
          const scheduledAt = v?.scheduledPostTime
            ? new Date(v.scheduledPostTime)
            : new Date(Date.now() + 60 * 60 * 1000);
          log(`Scheduling video ${videoId} to ${remaining.join(", ")} for ${scheduledAt.toISOString()}`);
          fl?.poster(`POST: video=${videoId} to [${remaining.join(", ")}] at ${scheduledAt.toISOString()}`);
          const results = await postVideoToSocials(videoId, remaining, scheduledAt, fl ?? undefined);
          const ok = results.filter((r) => r.success);
          if (ok.length >= remaining.length) {
            await db.video.update({ where: { id: videoId }, data: { status: "SCHEDULED" } });
            log(`Video ${videoId} → SCHEDULED (all platforms done)`);
            fl?.poster(`DONE: video=${videoId} → SCHEDULED (${ok.length}/${remaining.length} platforms OK)`);
          } else {
            fl?.poster(`PARTIAL: video=${videoId} — ${ok.length}/${remaining.length} platforms OK, will retry`);
          }
          return results;
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

    // Only check SCHEDULED videos (deferred IG posts always move to SCHEDULED)
    // and filter to recent updatedAt to avoid scanning entire history
    const candidates = await db.video.findMany({
      where: {
        status: "SCHEDULED",
      },
      select: { id: true, postedPlatforms: true },
      orderBy: { updatedAt: "desc" },
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
        try {
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

          return await postVideoToSocials(videoId, ["INSTAGRAM"]);
        } catch (e) {
          err(`Deferred IG publish failed for ${videoId}:`, e);
          // Ensure the entry doesn't stay stuck at "uploading"
          try {
            const v = await db.video.findUnique({ where: { id: videoId }, select: { postedPlatforms: true } });
            if (v) {
              const entries = (v.postedPlatforms ?? []) as { platform: string; success?: unknown; error?: string }[];
              const fixed = entries.map((ent) =>
                ent.platform === "INSTAGRAM" && ent.success === "uploading"
                  ? { ...ent, success: false, error: `Posting failed: ${e instanceof Error ? e.message : "unknown error"}` }
                  : ent,
              );
              await db.video.update({ where: { id: videoId }, data: { postedPlatforms: fixed as never } });
            }
          } catch { /* best effort */ }
        }
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

    for (const video of recoverable) {
      const age = now - new Date(video.updatedAt).getTime();
      const retryCount = video.retryCount ?? 0;
      const auto = video.series.automation as Record<string, unknown> | null;
      const autoType = (auto?.automationType as string) ?? "";
      const autoName = (auto?.name as string) ?? "manual";

      if (video.status === "FAILED") {
        if (!auto?.enabled) continue;
        if (retryCount >= MAX_AUTO_RETRIES) {
          if (retryCount === MAX_AUTO_RETRIES) {
            log(`Video ${video.id} exhausted ${MAX_AUTO_RETRIES} auto-retries, leaving as FAILED`);
          }
          continue;
        }
        if (age < FAILED_RETRY_AFTER_MS) continue;
        log(`Auto-retrying FAILED video ${video.id} (attempt ${retryCount + 1}/${MAX_AUTO_RETRIES}, auto="${autoName}", type=${autoType}, failed ${Math.round(age / 60000)}m ago)`);
      } else {
        const threshold = video.status === "GENERATING" ? STUCK_GENERATING_MS : STUCK_QUEUED_MS;
        if (age < threshold) {
          debug(`SKIP ${video.id} (${video.status}) — ${Math.round(age / 1000)}s old, threshold=${Math.round(threshold / 1000)}s`);
          continue;
        }
        log(`Recovering stuck video ${video.id} (${video.status} for ${Math.round(age / 60000)}m, auto="${autoName}", type=${autoType})`);
      }

      // ── Clip-repurpose videos: re-enqueue to the clip queue ──
      if (autoType === "clip-repurpose") {
        try {
          const clipCfg = (auto?.clipConfig as Record<string, unknown>) ?? {};
          const usr = video.series.user;

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

        const usr = video.series.user;
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
 *      - Instagram: handled by checkDeferredInstagramPosts (posts on our behalf)
 *   2. After resolving scheduled entries, if all targeted platforms show
 *      success:true (or deleted), promote the video status to POSTED.
 */
async function reconcileScheduledPosts() {
  try {
    // Check ALL video statuses — not just READY/SCHEDULED — because a video marked
    // POSTED by one platform might still have "scheduled" entries for other platforms
    const videos = await db.video.findMany({
      where: { status: { in: ["READY", "SCHEDULED", "POSTED"] } },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        postedPlatforms: true,
        scheduledPostTime: true,
        scheduledPlatforms: true,
        series: {
          select: {
            user: {
              select: {
                id: true,
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

    // Gather videos that need reconciliation
    type PlatEntry = { platform: string; success?: boolean | string; postId?: string | null; url?: string | null; scheduledFor?: string; error?: string };
    const toCheck: { video: typeof videos[number]; entries: PlatEntry[]; scheduledEntries: PlatEntry[] }[] = [];

    const now = Date.now();
    const UPLOADING_STALE_MS = 10 * 60 * 1000; // 10 minutes

    for (const video of videos) {
      const entries = (video.postedPlatforms ?? []) as PlatEntry[];
      if (entries.length === 0) continue;
      const scheduledEntries = entries.filter((e) => e.success === "scheduled");
      const hasUnpromotedSuccess = video.status !== "POSTED" && entries.some((e) => e.success === true);
      const hasStuckUploading = entries.some((e) => e.success === "uploading") &&
        (now - new Date(video.updatedAt).getTime()) > UPLOADING_STALE_MS;
      if (scheduledEntries.length > 0 || hasUnpromotedSuccess || hasStuckUploading) {
        toCheck.push({ video, entries, scheduledEntries });
      }
    }

    log(`Reconcile: ${videos.length} total, ${toCheck.length} need attention`);
    if (toCheck.length === 0) return;

    for (const { video, entries, scheduledEntries } of toCheck) {
      const user = (video as { series?: { user?: typeof videos[number]["series"]["user"] } }).series?.user;
      let changed = false;

      // Step 0: mark "uploading" entries as failed if stuck for >10 min
      const videoAge = now - new Date(video.updatedAt).getTime();
      for (const entry of entries) {
        if (entry.success === "uploading" && videoAge > UPLOADING_STALE_MS) {
          entry.success = false;
          entry.error = "Upload timed out (stuck for >10 min)";
          changed = true;
          log(`  Reconciled ${entry.platform} for ${video.id}: uploading → failed (stale ${Math.round(videoAge / 60000)}m)`);
        }
      }

      // Step 1: for "scheduled" entries, check platform API.
      // We check ALL entries (even future ones) because the platform may have
      // published early or the stored scheduledTime might be wrong.
      const FORCE_PROMOTE_MS = 90 * 60 * 1000; // 90 min past scheduled time → force-promote
      if (scheduledEntries.length > 0) {
        const videoSchedTime = video.scheduledPostTime ? new Date(video.scheduledPostTime).getTime() : 0;
        for (const entry of scheduledEntries) {
          const entrySchedTime = entry.scheduledFor ? new Date(entry.scheduledFor).getTime() : 0;
          const effectiveSchedTime = entrySchedTime || videoSchedTime;
          const isPastSchedule = effectiveSchedTime <= now || effectiveSchedTime === 0;
          const overdueMins = effectiveSchedTime > 0 ? Math.round((now - effectiveSchedTime) / 60000) : 0;
          let isLive = false;
          let apiChecked = false;

          if (entry.postId && user) {
            if (entry.platform === "YOUTUBE") {
              const account = user.socialAccounts.find((a) => a.platform === "YOUTUBE");
              if (account) {
                apiChecked = true;
                const accessToken = decrypt(account.accessTokenEnc);
                const refreshToken = account.refreshTokenEnc ? decrypt(account.refreshTokenEnc) : null;
                const privacy = await getYouTubeVideoPrivacy(
                  accessToken, refreshToken, entry.postId, account.platformUserId, user.id,
                );
                log(`  YT privacy check for ${video.id}: postId=${entry.postId} → ${privacy ?? "error"} (scheduled ${isPastSchedule ? `${overdueMins}m overdue` : `in ${-overdueMins}m`})`);
                isLive = privacy === "public";
              } else {
                log(`  YT: no account found for video ${video.id}`);
              }
            } else if (entry.platform === "FACEBOOK") {
              // FB Graph API can't read scheduled/unpublished videos — only check after scheduled time
              if (!isPastSchedule) {
                debug(`  FB: skipping API check for ${video.id} (scheduled in ${-overdueMins}m, FB can't read unpublished videos)`);
              } else {
                const account = user.socialAccounts.find((a) => a.platform === "FACEBOOK");
                if (account) {
                  apiChecked = true;
                  let accessToken = decrypt(account.accessTokenEnc);
                  if (account.refreshTokenEnc && account.pageId) {
                    try {
                      accessToken = await getFreshFacebookToken(
                        account.id, accessToken, account.refreshTokenEnc, account.pageId, account.tokenExpiresAt,
                      );
                    } catch { /* use existing token */ }
                  }
                  const published = await getFacebookVideoPublished(entry.postId, accessToken);
                  log(`  FB published check for ${video.id}: postId=${entry.postId} → ${published} (${overdueMins}m overdue)`);
                  isLive = published === true;
                } else {
                  log(`  FB: no account found for video ${video.id}`);
                }
              }
            } else if (entry.platform === "INSTAGRAM") {
              log(`  IG: deferred entry for ${video.id} (handled by checkDeferredInstagramPosts)`);
              continue;
            }
          }

          // Force-promote only for OVERDUE entries (past scheduled time + buffer)
          if (!isLive && isPastSchedule && !apiChecked && effectiveSchedTime > 0 && (now - effectiveSchedTime) > FORCE_PROMOTE_MS) {
            log(`  Force-promoting ${entry.platform} for ${video.id}: ${overdueMins}m overdue, no API check possible (no postId or account)`);
            isLive = true;
          } else if (!isLive && isPastSchedule && apiChecked && effectiveSchedTime > 0 && (now - effectiveSchedTime) > FORCE_PROMOTE_MS) {
            log(`  Force-promoting ${entry.platform} for ${video.id}: ${overdueMins}m overdue, API returned not-live but trusting schedule`);
            isLive = true;
          }

          if (isLive) {
            entry.success = true;
            delete entry.scheduledFor;
            changed = true;
            log(`  Reconciled ${entry.platform} for ${video.id}: scheduled → posted`);
          }
        }
      }

      // Step 2: promote video to POSTED if all targeted platforms are done
      const targeted = (video.scheduledPlatforms ?? []) as string[];
      const hasAnySuccess = entries.some((e) => e.success === true);
      if (!hasAnySuccess && !changed) continue;

      const allTargetedDone = targeted.length > 0 && targeted.every((plat) => {
        const e = entries.find((x) => x.platform === plat);
        return e && (e.success === true || e.success === "deleted");
      });

      const allEntriesDone = entries.length > 0 && entries.every(
        (e) => e.success === true || e.success === "deleted",
      );

      const shouldPromote = video.status !== "POSTED" && (allTargetedDone || allEntriesDone);

      if (shouldPromote) {
        await db.video.update({
          where: { id: video.id },
          data: {
            status: "POSTED",
            ...(changed ? { postedPlatforms: entries as never } : {}),
          },
        });
        log(`  ${video.id} → POSTED (${entries.filter(e => e.success === true).map(e => e.platform).join(", ")})`);
      } else if (changed) {
        await db.video.update({
          where: { id: video.id },
          data: { postedPlatforms: entries as never },
        });
        log(`  ${video.id}: updated platform entries (status stays ${video.status})`);
      }
    }
  } catch (e) {
    err("reconcileScheduledPosts error:", e);
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
    await reconcileScheduledPosts();
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

log(`Started. Build window: ${BUILD_ALL_TIME} ${BUILD_ALL_TIMEZONE} (${BUILD_WINDOW_MINUTES}min). Posts scheduled per-video. Tick every 5 min.`);
cleanupOldLogs().then(() => log("Old log cleanup done")).catch(() => {});
backfillLastRunAt().then(() => tick());
