import "dotenv/config";
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

// ─── Timezone-aware time conversion ────────────────────────────────

function tzTimeToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  const [h, m] = timeStr.split(":").map(Number);
  const candidateUtc = new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(candidateUtc);

  const tzH = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
  const tzM = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
  const tzDay = parseInt(parts.find((p) => p.type === "day")?.value ?? "0");
  const origDay = parseInt(dateStr.split("-")[2]);
  const dayDiff = tzDay - origDay;

  const candidateMinutes = h * 60 + m;
  const tzMinutes = tzH * 60 + tzM;
  const offsetMinutes = (tzMinutes + dayDiff * 1440) - candidateMinutes;

  return new Date(candidateUtc.getTime() - offsetMinutes * 60000);
}

function getNextFireTime(postTime: string, timezone: string, frequency: string, lastRunAt: Date | null): Date {
  const now = Date.now();

  const thresholds: Record<string, number> = { daily: 20, every_other_day: 44, weekly: 164 };
  const thresholdMs = (thresholds[frequency] ?? 20) * 3600000;
  const earliestAllowed = lastRunAt ? lastRunAt.getTime() + thresholdMs : 0;

  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const probe = new Date(now + dayOffset * 86400000);
    const dateStr = probe.toLocaleDateString("en-CA", { timeZone: timezone });
    const fireUtc = tzTimeToUtc(dateStr, postTime, timezone);

    if (fireUtc.getTime() <= now) continue;
    if (fireUtc.getTime() < earliestAllowed) continue;

    return fireUtc;
  }

  return new Date(now + 86400000);
}

function formatDelay(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatInTz(date: Date, timezone: string): string {
  return date.toLocaleString("en-GB", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ─── Event-based timer management ──────────────────────────────────

const scheduled = new Map<string, { timer: NodeJS.Timeout; fireTime: Date }>();

function scheduleAutomation(auto: AutoRow) {
  const existing = scheduled.get(auto.id);
  if (existing) clearTimeout(existing.timer);

  const fireTime = getNextFireTime(auto.postTime, auto.timezone, auto.frequency, auto.lastRunAt);
  const delayMs = fireTime.getTime() - Date.now();

  if (delayMs > 8 * 86400000) {
    log(`"${auto.name}" — next fire > 8 days out, will pick up on next sync`);
    scheduled.delete(auto.id);
    return;
  }

  const timer = setTimeout(async () => {
    scheduled.delete(auto.id);
    log(`⚡ FIRING "${auto.name}" (${auto.id})`);
    await triggerAutomation(auto.id);
  }, Math.max(delayMs, 100));

  scheduled.set(auto.id, { timer, fireTime });

  log(
    `"${auto.name}" → ${formatInTz(fireTime, auto.timezone)} ${auto.timezone} (in ${formatDelay(delayMs)})`,
  );
}

// ─── Trigger a single automation ───────────────────────────────────

async function triggerAutomation(automationId: string) {
  const auto = await db.automation.findUnique({
    where: { id: automationId },
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

  if (!auto || !auto.enabled) {
    log(`Automation ${automationId} no longer enabled, skipping`);
    rescheduleAfterTrigger(automationId);
    return;
  }

  const row = auto as unknown as AutoRow;

  if (!auto.seriesId) {
    log(`"${auto.name}" has no linked series, creating one...`);
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
    log(`Created series "${newSeries.name}" (${newSeries.id})`);
  }

  const pendingVideo = await db.video.findFirst({
    where: {
      seriesId: auto.seriesId,
      status: { in: ["QUEUED", "GENERATING"] },
    },
  });
  if (pendingVideo) {
    log(`"${auto.name}" already has a video in progress (${pendingVideo.id}), skipping`);
    rescheduleAfterTrigger(automationId);
    return;
  }

  await db.automation.update({
    where: { id: auto.id },
    data: { lastRunAt: new Date() },
  });

  const artStyle = getArtStyleById(auto.artStyle);
  const niche = getNicheById(auto.niche);
  const providers = resolveProviders(
    { llmProvider: auto.llmProvider, ttsProvider: auto.ttsProvider, imageProvider: auto.imageProvider },
    auto.user,
  );

  try {
    log(`Generating script for "${auto.name}" (LLM: ${providers.llm})`);

    const script = await generateScript(
      { niche: auto.niche, tone: auto.tone, artStyle: auto.artStyle, duration: auto.duration, language: auto.language },
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
    });

    log(`Enqueued video ${video.id} for "${auto.name}"`);
  } catch (e) {
    err(`Failed to generate for "${auto.name}":`, e);
  }

  rescheduleAfterTrigger(automationId);
}

async function rescheduleAfterTrigger(automationId: string) {
  try {
    const fresh = await db.automation.findUnique({
      where: { id: automationId },
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
    if (fresh?.enabled) {
      scheduleAutomation(fresh as unknown as AutoRow);
    }
  } catch (e) {
    err(`Failed to reschedule ${automationId}:`, e);
  }
}

// ─── Sync: pick up new/changed/disabled automations ────────────────

async function syncSchedules() {
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

    const activeIds = new Set(automations.map((a) => a.id));

    for (const [id, { timer }] of scheduled) {
      if (!activeIds.has(id)) {
        clearTimeout(timer);
        scheduled.delete(id);
        log(`Removed timer for disabled/deleted automation ${id}`);
      }
    }

    for (const auto of automations) {
      const existing = scheduled.get(auto.id);
      const row = auto as unknown as AutoRow;
      const nextFire = getNextFireTime(row.postTime, row.timezone, row.frequency, row.lastRunAt);

      if (existing && Math.abs(existing.fireTime.getTime() - nextFire.getTime()) < 60000) {
        continue;
      }

      scheduleAutomation(row);
    }

    log(`Synced: ${automations.length} automation(s), ${scheduled.size} timer(s) active`);

    await checkReadyVideosForPosting();
  } catch (e) {
    err("Sync error:", e);
  }
}

// ─── Auto-post ready videos ───────────────────────────────────────

async function checkReadyVideosForPosting() {
  try {
    const automationsWithTargets = await db.automation.findMany({
      where: {
        enabled: true,
        NOT: { targetPlatforms: { equals: [] } },
        seriesId: { not: null },
      },
      select: { targetPlatforms: true, seriesId: true },
    });

    const seriesIds = automationsWithTargets
      .map((a) => a.seriesId)
      .filter((id): id is string => id !== null);

    if (seriesIds.length === 0) return;

    const readyVideos = await db.video.findMany({
      where: { status: "READY", seriesId: { in: seriesIds } },
      take: 10,
    });

    for (const video of readyVideos) {
      const auto = automationsWithTargets.find((a) => a.seriesId === video.seriesId);
      if (!auto) continue;

      const targets = auto.targetPlatforms as string[];
      const rawPosted = (video.postedPlatforms ?? []) as (string | { platform: string })[];
      const postedSet = new Set(rawPosted.map((p) => (typeof p === "string" ? p : p.platform)));
      const remaining = targets.filter((t) => !postedSet.has(t));

      if (remaining.length === 0) continue;

      log(`Auto-posting video ${video.id} to ${remaining.join(", ")}`);
      await postVideoToSocials(video.id);
    }
  } catch (e) {
    err("Error checking ready videos:", e);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────

const SYNC_INTERVAL = 10 * 60 * 1000; // re-sync every 10 minutes
const POST_CHECK_INTERVAL = 5 * 60 * 1000;

log("Started (event-based). Performing initial sync...");
syncSchedules();

setInterval(() => {
  log("Periodic sync...");
  syncSchedules();
}, SYNC_INTERVAL);

setInterval(() => {
  checkReadyVideosForPosting();
}, POST_CHECK_INTERVAL);
