import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod/v4";
import fs from "fs/promises";
import path from "path";
import { IMAGE_TO_VIDEO_PROVIDERS } from "@/config/image-to-video-providers";
import { getDurationRangeForNiche } from "@/config/niches";
import { resolveVideoFile } from "@/lib/video-paths";
import { CLIP_NICHE_META } from "@/config/clip-niches";

function parseMinuteOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => Number.parseInt(v, 10));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return hh * 60 + mm;
}

function circularMinuteDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}

async function appendSchedulerLog(automationId: string, outcome: string, message: string, videoId?: string) {
  await db.schedulerLog.create({
    data: {
      automationId,
      outcome,
      message,
      durationMs: 0,
      videoId,
    },
  });
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
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  niche: z.string().min(1).optional(),
  artStyle: z.string().min(1).optional(),
  voiceId: z.string().optional(),
  language: z.string().optional(),
  tone: z.string().optional(),
  duration: z.number().min(15).max(600).optional(),
  llmProvider: z.string().nullable().optional(),
  ttsProvider: z.string().nullable().optional(),
  imageProvider: z.string().nullable().optional(),
  imageToVideoProvider: z.string().nullable().optional(),
  characterId: z.string().nullable().optional(),
  targetPlatforms: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  includeAiTags: z.boolean().optional(),
  frequency: z.enum(["daily", "every_other_day", "weekly"]).optional(),
  postTime: z.string().refine(
    (v) => v.split(",").every((t) => /^\d{2}:\d{2}$/.test(t.trim())),
    "Each time must be HH:MM, comma-separated for multiple",
  ).optional(),
  timezone: z.string().min(1).optional(),
});

async function verifyOwnership(id: string, userId: string, role: string) {
  const automation = await db.automation.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!automation) return { error: "Not found", status: 404 };
  if (automation.userId !== userId && role === "USER")
    return { error: "Forbidden", status: 403 };
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

    const automation = await db.automation.findUnique({
      where: { id },
      include: {
        schedulerLogs: {
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            outcome: true,
            message: true,
            errorDetail: true,
            durationMs: true,
            videoId: true,
            createdAt: true,
          },
        },
        series: {
          include: {
            videos: {
              orderBy: { createdAt: "desc" },
              take: limit,
              skip: offset,
              select: {
                id: true,
                title: true,
                status: true,
                videoUrl: true,
                thumbnailUrl: true,
                duration: true,
                sourceUrl: true,
                sourceMetadata: true,
                postedPlatforms: true,
                scheduledPostTime: true,
                scheduledPlatforms: true,
                createdAt: true,
                updatedAt: true,
                errorMessage: true,
                retryCount: true,
              },
            },
            _count: { select: { videos: true } },
          },
        },
      },
    });

    if (!automation)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (automation.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const totalVideos = (automation.series as unknown as { _count?: { videos: number } })?._count?.videos ?? 0;
    return NextResponse.json({ data: automation, totalVideos });
  } catch (error) {
    console.error("Get automation error:", error);
    return NextResponse.json(
      { error: "Failed to get automation" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const check = await verifyOwnership(id, session.user.id, session.user.role);
    if (check)
      return NextResponse.json({ error: check.error }, { status: check.status });

    const body = await req.json();
    const input = updateSchema.parse(body);

    if (input.duration !== undefined) {
      const current = await db.automation.findUnique({
        where: { id },
        select: { niche: true },
      });
      const effectiveNiche = input.niche ?? current?.niche;
      if (effectiveNiche) {
        const range = getDurationRangeForNiche(effectiveNiche);
        if (input.duration < range.min || input.duration > range.max) {
          return NextResponse.json(
            { error: `Duration must be ${range.min}-${range.max}s for this niche` },
            { status: 400 },
          );
        }
      }
    }

    const currentAutomation = await db.automation.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        userId: true,
        enabled: true,
        automationType: true,
        clipConfig: true,
        postTime: true,
        timezone: true,
      },
    });
    if (!currentAutomation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.niche !== undefined) data.niche = input.niche;
    if (input.artStyle !== undefined) data.artStyle = input.artStyle;
    if (input.voiceId !== undefined) data.voiceId = input.voiceId;
    if (input.language !== undefined) data.language = input.language;
    if (input.tone !== undefined) data.tone = input.tone;
    if (input.duration !== undefined) data.duration = input.duration;
    if (input.llmProvider !== undefined) data.llmProvider = input.llmProvider;
    if (input.ttsProvider !== undefined) data.ttsProvider = input.ttsProvider;
    if (input.imageProvider !== undefined)
      data.imageProvider = input.imageProvider;
    if (input.imageToVideoProvider !== undefined) {
      const val = input.imageToVideoProvider ?? null;
      if (val !== null) {
        const valid = new Set(Object.keys(IMAGE_TO_VIDEO_PROVIDERS));
        if (!valid.has(val)) {
          return NextResponse.json(
            { error: `Invalid imageToVideoProvider: ${val}` },
            { status: 400 },
          );
        }
      }
      data.imageToVideoProvider = val;
    }
    if (input.characterId !== undefined)
      data.characterId = input.characterId;
    if (input.targetPlatforms !== undefined) {
      const valid = new Set(["INSTAGRAM", "YOUTUBE", "FACEBOOK", "SHARECHAT", "MOJ"]);
      data.targetPlatforms = input.targetPlatforms.filter((p) => valid.has(p));
    }
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.includeAiTags !== undefined) data.includeAiTags = input.includeAiTags;
    if (input.frequency !== undefined) data.frequency = input.frequency;
    if (input.postTime !== undefined) data.postTime = input.postTime;
    if (input.timezone !== undefined) data.timezone = input.timezone;

    if (
      input.enabled === true &&
      currentAutomation.enabled === false &&
      currentAutomation.automationType === "clip-repurpose" &&
      input.postTime === undefined
    ) {
      const clipConfig = (currentAutomation.clipConfig ?? {}) as Record<string, unknown>;
      const clipNiche = (clipConfig.clipNiche as string) ?? "auto";
      const preferredTimes = CLIP_NICHE_META[clipNiche]?.bestTimesUTC ?? [currentAutomation.postTime ?? "07:00"];
      const gapMins = Math.max(15, Number.parseInt(process.env.PLATFORM_POST_GAP_MINUTES ?? "60", 10));
      const otherEnabled = await db.automation.findMany({
        where: {
          userId: currentAutomation.userId,
          enabled: true,
          automationType: "clip-repurpose",
          id: { not: id },
        },
        select: { postTime: true },
      });
      const occupied = otherEnabled
        .map((a) => (a.postTime ?? "").split(",").map((t) => t.trim()))
        .flat()
        .filter((t) => /^\d{2}:\d{2}$/.test(t))
        .map(parseMinuteOfDay);
      const chosen = preferredTimes.find((candidate) => {
        const minute = parseMinuteOfDay(candidate);
        return occupied.every((o) => circularMinuteDistance(minute, o) >= gapMins);
      }) ?? preferredTimes[0];
      data.postTime = chosen;
    }

    const scheduleFieldsSent =
      input.postTime !== undefined ||
      input.frequency !== undefined ||
      input.timezone !== undefined;
    if (scheduleFieldsSent) {
      const current = await db.automation.findUnique({
        where: { id },
        select: { postTime: true, frequency: true, timezone: true },
      });
      const actuallyChanged =
        (input.postTime !== undefined && input.postTime !== current?.postTime) ||
        (input.frequency !== undefined && input.frequency !== current?.frequency) ||
        (input.timezone !== undefined && input.timezone !== current?.timezone);
      if (actuallyChanged) data.lastRunAt = null;
    }

    const updated = await db.automation.update({ where: { id }, data });

    if (input.enabled !== undefined && input.enabled !== currentAutomation.enabled) {
      const nowIso = new Date().toISOString();
      if (input.enabled) {
        const activationReason = updated.automationType === "clip-repurpose"
          ? `Activated niche automation. postTime=${updated.postTime}, timezone=${updated.timezone}`
          : `Activated automation. postTime=${updated.postTime}, timezone=${updated.timezone}`;
        await appendSchedulerLog(
          id,
          "activated",
          `[MANUAL_ENABLE] [${nowIso}] ${activationReason}`,
        );
      } else {
        await appendSchedulerLog(
          id,
          "deactivated",
          `[MANUAL_DISABLE] [${nowIso}] Automation paused by user`,
        );
      }
    }

    // Keep linked series in sync so retries use the same providers (no fallbacks)
    const providerKeys = ["llmProvider", "ttsProvider", "imageProvider"] as const;
    const hasProviderUpdate = providerKeys.some((k) => input[k] !== undefined);
    if (hasProviderUpdate && updated.seriesId) {
      const seriesData: Record<string, unknown> = {};
      if (input.llmProvider !== undefined) seriesData.llmProvider = input.llmProvider;
      if (input.ttsProvider !== undefined) seriesData.ttsProvider = input.ttsProvider;
      if (input.imageProvider !== undefined) seriesData.imageProvider = input.imageProvider;
      if (Object.keys(seriesData).length > 0) {
        await db.series.update({
          where: { id: updated.seriesId },
          data: seriesData as never,
        });
      }
    }

    return NextResponse.json({ data: updated });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    console.error("Update automation error:", error);
    return NextResponse.json(
      { error: "Failed to update automation" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const automation = await db.automation.findUnique({
      where: { id },
      include: {
        series: { include: { videos: { select: { id: true, videoUrl: true } } } },
      },
    });

    if (!automation)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (automation.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (automation.series) {
      await Promise.allSettled(
        automation.series.videos.map(async (v) => {
          if (v.videoUrl?.includes("/video.mp4")) {
            const videoFile = resolveVideoFile(v.videoUrl);
            const dir = videoFile.replace(/\/video\.mp4$/, "");
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
            await fs.unlink(videoFile).catch(() => {});
          }
          // Legacy cleanup
          const legacyMp4 = resolveVideoFile(`/videos/${v.id}.mp4`);
          const legacyDir = resolveVideoFile(`/videos/${v.id}/video.mp4`).replace(/\/video\.mp4$/, "");
          await fs.unlink(legacyMp4).catch(() => {});
          await fs.rm(legacyDir, { recursive: true, force: true }).catch(() => {});
        }),
      );
      await db.series.delete({ where: { id: automation.series.id } });
    }

    await db.automation.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete automation error:", error);
    return NextResponse.json(
      { error: "Failed to delete automation" },
      { status: 500 },
    );
  }
}
