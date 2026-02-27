import "dotenv/config";
import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { enqueueVideoGeneration } from "../src/services/queue";
import { postVideoToSocials } from "../src/services/social-poster";
import { generateScript } from "../src/services/script-generator";
import { getArtStyleById } from "../src/config/art-styles";
import { getNicheById } from "../src/config/niches";
import { resolveProviders } from "../src/services/providers/resolve";
import { getDefaultVoiceId } from "../src/config/voices";
import { createLogger } from "../src/lib/logger";

const db = new PrismaClient();
const { log, warn, error: err } = createLogger("Scheduler");
const SCHEDULER_CONCURRENCY = parseInt(process.env.SCHEDULER_CONCURRENCY ?? "3", 10);

const STUCK_GENERATING_MS = 15 * 60 * 1000; // 15 min
const STUCK_QUEUED_MS = 30 * 60 * 1000;     // 30 min

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
    defaultLlmProvider: string | null;
    defaultTtsProvider: string | null;
    defaultImageProvider: string | null;
  };
}

function isDue(auto: AutoRow): { due: boolean; reason: string } {
  const now = new Date();
  const postTimes = auto.postTime.split(",").map((t) => t.trim());
  const timesPerDay = postTimes.length;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: auto.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const currentHour = parseInt(
    parts.find((p) => p.type === "hour")?.value ?? "0",
  );
  const currentMin = parseInt(
    parts.find((p) => p.type === "minute")?.value ?? "0",
  );

  const matchedSlot = postTimes.find((t) => {
    const [h, m] = t.split(":").map(Number);
    return currentHour === h && Math.abs(currentMin - m) < 10;
  });

  if (!matchedSlot) {
    return {
      due: false,
      reason: `not in any window (now=${currentHour}:${String(currentMin).padStart(2, "0")} ${auto.timezone}, targets=${auto.postTime})`,
    };
  }

  if (!auto.lastRunAt) {
    return { due: true, reason: `never run before, matched slot ${matchedSlot}` };
  }

  const hoursSinceLastRun =
    (now.getTime() - auto.lastRunAt.getTime()) / (1000 * 60 * 60);

  // For multiple daily slots, minimum gap = half the interval between slots (at least 1h)
  // For single slot, use the original frequency-based thresholds
  const freqThresholds: Record<string, number> = {
    daily: 20,
    every_other_day: 44,
    weekly: 164,
  };

  let threshold: number;
  if (timesPerDay > 1) {
    // Minimum gap: slightly less than smallest interval between consecutive slots
    const minuteValues = postTimes
      .map((t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; })
      .sort((a, b) => a - b);
    let minGap = 1440; // full day
    for (let i = 1; i < minuteValues.length; i++) {
      minGap = Math.min(minGap, minuteValues[i] - minuteValues[i - 1]);
    }
    // Also check wrap-around gap (last to first next day)
    minGap = Math.min(minGap, 1440 - minuteValues[minuteValues.length - 1] + minuteValues[0]);

    // Threshold = 80% of smallest gap (in hours), minimum 1 hour
    threshold = Math.max(1, (minGap * 0.8) / 60);

    // For non-daily frequencies, multiply by the frequency factor
    if (auto.frequency === "every_other_day") threshold = Math.max(threshold, 44);
    if (auto.frequency === "weekly") threshold = Math.max(threshold, 164);
  } else {
    threshold = freqThresholds[auto.frequency] ?? 20;
  }

  if (hoursSinceLastRun < threshold) {
    return {
      due: false,
      reason: `ran ${hoursSinceLastRun.toFixed(1)}h ago, need ${threshold.toFixed(1)}h gap (slot=${matchedSlot})`,
    };
  }

  return { due: true, reason: `${hoursSinceLastRun.toFixed(1)}h since last run, threshold ${threshold.toFixed(1)}h, slot=${matchedSlot}` };
}

async function processAutomation(auto: Awaited<ReturnType<typeof db.automation.findMany>>[number]) {
  const { due, reason } = isDue(auto as unknown as AutoRow);
  log(
    `"${auto.name}" | time=${auto.postTime} tz=${auto.timezone} freq=${auto.frequency} lastRun=${auto.lastRunAt?.toISOString() ?? "never"} | due=${due} (${reason})`,
  );

  if (!due) return;

  log(`Triggering automation "${auto.name}" (${auto.id})`);

  if (!auto.seriesId) {
    log(`Automation "${auto.name}" has no linked series, creating one...`);
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
    log(`Created series "${newSeries.name}" (${newSeries.id}) for automation "${auto.name}"`);
  }

  const pendingVideo = await db.video.findFirst({
    where: {
      seriesId: auto.seriesId,
      status: { in: ["QUEUED", "GENERATING"] },
    },
  });
  if (pendingVideo) {
    log(`Automation "${auto.name}" already has a video in progress (${pendingVideo.id}), skipping`);
    return;
  }

  await db.automation.update({
    where: { id: auto.id },
    data: { lastRunAt: new Date() },
  });

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

  try {
    log(
      `Generating script for "${auto.name}" (LLM: ${providers.llm})`,
    );

    const script = await generateScript(
      {
        niche: auto.niche,
        tone: auto.tone,
        artStyle: auto.artStyle,
        duration: auto.duration,
        language: auto.language,
      },
      providers.llm,
    );

    const recheck = await db.video.findFirst({
      where: {
        seriesId: auto.seriesId,
        status: { in: ["QUEUED", "GENERATING"] },
      },
    });
    if (recheck) {
      log(`Automation "${auto.name}" — another video appeared while script was generating (${recheck.id}), discarding script`);
      return;
    }

    const video = await db.video.create({
      data: {
        seriesId: auto.seriesId,
        title: script.title,
        scriptText: script.fullScript,
        scenesJson: script.scenes as never,
        targetDuration: auto.duration,
        status: "QUEUED",
      },
    });

    await enqueueVideoGeneration({
      videoId: video.id,
      seriesId: auto.seriesId,
      title: script.title,
      scriptText: video.scriptText!,
      scenes: script.scenes,
      artStyle: auto.artStyle,
      artStylePrompt:
        artStyle?.promptModifier ?? "cinematic, high quality",
      negativePrompt:
        artStyle?.negativePrompt ??
        "low quality, blurry, watermark, text",
      tone: auto.tone,
      niche: auto.niche,
      voiceId: auto.voiceId ?? "default",
      language: auto.language,
      musicPath: niche?.defaultMusic,
      duration: auto.duration,
      llmProvider: providers.llm,
      ttsProvider: providers.tts,
      imageProvider: providers.image,
    });

    log(`Enqueued video ${video.id} for automation "${auto.name}"`);
  } catch (e) {
    err(`Failed to auto-generate for "${auto.name}":`, e);
  }
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
            defaultLlmProvider: true,
            defaultTtsProvider: true,
            defaultImageProvider: true,
          },
        },
      },
    });

    log(`Found ${automations.length} enabled automation(s), processing in batches of ${SCHEDULER_CONCURRENCY}`);

    await runInBatches(automations, SCHEDULER_CONCURRENCY, processAutomation);
    await checkReadyVideosForPosting();
  } catch (e) {
    err("Error in schedule check:", e);
  }
}

async function checkReadyVideosForPosting() {
  try {
    const automationsWithTargets = await db.automation.findMany({
      where: {
        enabled: true,
        NOT: { targetPlatforms: { equals: [] } },
        seriesId: { not: null },
      },
      select: {
        targetPlatforms: true,
        seriesId: true,
      },
    });

    const seriesIds = automationsWithTargets
      .map((a) => a.seriesId)
      .filter((id): id is string => id !== null);

    if (seriesIds.length === 0) return;

    const readyVideos = await db.video.findMany({
      where: {
        status: "READY",
        seriesId: { in: seriesIds },
      },
      take: 10,
    });

    const STALE_UPLOAD_MS = 10 * 60 * 1000;

    const postTasks = readyVideos.map((video) => {
      const auto = automationsWithTargets.find(
        (a) => a.seriesId === video.seriesId,
      );
      if (!auto) return null;

      const targets = auto.targetPlatforms as string[];
      const rawPosted = (video.postedPlatforms ?? []) as (
        | string
        | { platform: string; success?: boolean | "uploading"; postId?: string; url?: string; startedAt?: number }
      )[];

      const remaining = targets.filter((t) => {
        const entry = rawPosted.find((p) =>
          typeof p === "string" ? p === t : p.platform === t,
        );
        if (!entry) return true;
        if (typeof entry === "string") return false;
        if (entry.success === true) return false;
        if (entry.success === undefined && (entry.postId || entry.url)) return false;
        if (entry.success === "uploading") {
          const age = Date.now() - (entry.startedAt ?? 0);
          return age >= STALE_UPLOAD_MS;
        }
        return true;
      });

      if (remaining.length === 0) return null;
      return { videoId: video.id, remaining };
    }).filter((t): t is { videoId: string; remaining: string[] } => t !== null);

    if (postTasks.length > 0) {
      log(`Auto-posting ${postTasks.length} ready video(s) in parallel`);
      await Promise.allSettled(
        postTasks.map(({ videoId, remaining }) => {
          log(`Posting video ${videoId} to ${remaining.join(", ")}`);
          return postVideoToSocials(videoId, remaining);
        }),
      );
    }
  } catch (e) {
    err("Error checking ready videos:", e);
  }
}

async function recoverStuckVideos() {
  try {
    const now = Date.now();

    // Find videos stuck in GENERATING or QUEUED for too long
    const stuckVideos = await db.video.findMany({
      where: {
        status: { in: ["GENERATING", "QUEUED"] },
      },
      include: {
        series: {
          include: {
            automation: { select: { id: true, name: true } },
            user: {
              select: {
                id: true,
                defaultLlmProvider: true,
                defaultTtsProvider: true,
                defaultImageProvider: true,
              },
            },
          },
        },
      },
    });

    if (stuckVideos.length === 0) return;
    log(`Found ${stuckVideos.length} video(s) in GENERATING/QUEUED state, checking for stuck ones...`);

    for (const video of stuckVideos) {
      const age = now - new Date(video.updatedAt).getTime();
      const threshold = video.status === "GENERATING" ? STUCK_GENERATING_MS : STUCK_QUEUED_MS;

      if (age < threshold) {
        log(`Video ${video.id} (${video.status}) updated ${Math.round(age / 1000)}s ago — still within threshold, skipping`);
        continue;
      }

      const autoName = video.series.automation?.name ?? "manual";
      const hasCheckpoint = video.checkpointData && typeof video.checkpointData === "object";
      const completedStages = (video.checkpointData as { completedStages?: string[] })?.completedStages ?? [];

      log(`Recovering stuck video ${video.id} (${video.status} for ${Math.round(age / 60000)}m, auto="${autoName}", checkpoint=[${completedStages.join(",")}])`);

      try {
        const resolved = resolveProviders(video.series, video.series.user);
        const artStyle = getArtStyleById(video.series.artStyle);
        const niche = getNicheById(video.series.niche);
        const scenes = (video.scenesJson as { text: string; visualDescription: string }[]) ?? [];

        if (scenes.length === 0) {
          warn(`Video ${video.id} has no scenes, marking as FAILED`);
          await db.video.update({
            where: { id: video.id },
            data: { status: "FAILED", generationStage: null, errorMessage: "Recovery failed: no scene data" },
          });
          continue;
        }

        // Reset status to QUEUED so the worker picks it up fresh (checkpoint will handle resume)
        await db.video.update({
          where: { id: video.id },
          data: { status: "QUEUED", errorMessage: null },
        });

        await enqueueVideoGeneration({
          videoId: video.id,
          seriesId: video.seriesId,
          title: video.title ?? "Untitled",
          scriptText: video.scriptText ?? "",
          scenes,
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
  } finally {
    running = false;
  }
}

cron.schedule("*/5 * * * *", () => {
  log("Running schedule check...");
  tick();
});

log("Started. Checking schedules every 5 minutes.");
tick();
