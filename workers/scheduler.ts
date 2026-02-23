import "dotenv/config";
import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { enqueueVideoGeneration } from "../src/services/queue";
import { postVideoToSocials } from "../src/services/social-poster";
import { generateScript } from "../src/services/script-generator";
import { getArtStyleById } from "../src/config/art-styles";
import { getNicheById } from "../src/config/niches";
import { resolveProviders } from "../src/services/providers/resolve";

const db = new PrismaClient();

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function log(...args: unknown[]) {
  console.log(`[${ts()}] [Scheduler]`, ...args);
}

function warn(...args: unknown[]) {
  console.warn(`[${ts()}] [Scheduler]`, ...args);
}

function err(...args: unknown[]) {
  console.error(`[${ts()}] [Scheduler]`, ...args);
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
  const [hours, minutes] = auto.postTime.split(":").map(Number);

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

  const withinWindow =
    currentHour === hours && Math.abs(currentMin - minutes) < 10;
  if (!withinWindow) {
    return {
      due: false,
      reason: `not in window (now=${currentHour}:${String(currentMin).padStart(2, "0")} ${auto.timezone}, target=${auto.postTime})`,
    };
  }

  if (!auto.lastRunAt) {
    return { due: true, reason: "never run before" };
  }

  const hoursSinceLastRun =
    (now.getTime() - auto.lastRunAt.getTime()) / (1000 * 60 * 60);

  const thresholds: Record<string, number> = {
    daily: 20,
    every_other_day: 44,
    weekly: 164,
  };
  const threshold = thresholds[auto.frequency];
  if (threshold === undefined) {
    return { due: false, reason: `unknown frequency "${auto.frequency}"` };
  }

  if (hoursSinceLastRun < threshold) {
    return {
      due: false,
      reason: `ran ${hoursSinceLastRun.toFixed(1)}h ago, need ${threshold}h (${auto.frequency})`,
    };
  }

  return { due: true, reason: `${hoursSinceLastRun.toFixed(1)}h since last run, threshold ${threshold}h` };
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

    log(`Found ${automations.length} enabled automation(s)`);

    for (const auto of automations) {
      const { due, reason } = isDue(auto as unknown as AutoRow);
      log(
        `"${auto.name}" | time=${auto.postTime} tz=${auto.timezone} freq=${auto.frequency} lastRun=${auto.lastRunAt?.toISOString() ?? "never"} | due=${due} (${reason})`,
      );

      if (!due) continue;

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
        continue;
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

    for (const video of readyVideos) {
      const auto = automationsWithTargets.find(
        (a) => a.seriesId === video.seriesId,
      );
      if (!auto) continue;

      const targets = auto.targetPlatforms as string[];
      const rawPosted = (video.postedPlatforms ?? []) as (string | { platform: string })[];
      const postedSet = new Set(
        rawPosted.map((p) => (typeof p === "string" ? p : p.platform)),
      );
      const remaining = targets.filter((t) => !postedSet.has(t));

      if (remaining.length === 0) continue;

      log(`Auto-posting video ${video.id} to ${remaining.join(", ")}`);
      await postVideoToSocials(video.id);
    }
  } catch (e) {
    err("Error checking ready videos:", e);
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
