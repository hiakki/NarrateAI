import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod/v4";
import fs from "fs/promises";
import path from "path";
import { IMAGE_TO_VIDEO_PROVIDERS } from "@/config/image-to-video-providers";
import { getDurationRangeForNiche } from "@/config/niches";

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
            const dir = path.join(process.cwd(), "public", v.videoUrl.replace(/^\//, "").replace(/\/video\.mp4$/, ""));
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
          }
          await fs.unlink(path.join(process.cwd(), "public", "videos", `${v.id}.mp4`)).catch(() => {});
          await fs.rm(path.join(process.cwd(), "public", "videos", v.id), { recursive: true, force: true }).catch(() => {});
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
