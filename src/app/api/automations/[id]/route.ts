import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod/v4";
import fs from "fs/promises";
import path from "path";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  niche: z.string().min(1).optional(),
  artStyle: z.string().min(1).optional(),
  voiceId: z.string().optional(),
  language: z.string().optional(),
  tone: z.string().optional(),
  duration: z.number().min(15).max(120).optional(),
  llmProvider: z.string().nullable().optional(),
  ttsProvider: z.string().nullable().optional(),
  imageProvider: z.string().nullable().optional(),
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
        series: {
          include: {
            videos: { orderBy: { createdAt: "desc" }, take: 20 },
          },
        },
      },
    });

    if (!automation)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (automation.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    return NextResponse.json({ data: automation });
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
    if (input.targetPlatforms !== undefined) {
      const valid = new Set(["INSTAGRAM", "YOUTUBE", "FACEBOOK"]);
      data.targetPlatforms = input.targetPlatforms.filter((p) => valid.has(p));
    }
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.includeAiTags !== undefined) data.includeAiTags = input.includeAiTags;
    if (input.frequency !== undefined) data.frequency = input.frequency;
    if (input.postTime !== undefined) data.postTime = input.postTime;
    if (input.timezone !== undefined) data.timezone = input.timezone;

    const scheduleChanged =
      input.postTime !== undefined ||
      input.frequency !== undefined ||
      input.timezone !== undefined;
    if (scheduleChanged) data.lastRunAt = null;

    const updated = await db.automation.update({ where: { id }, data });

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
        series: { include: { videos: { select: { id: true } } } },
      },
    });

    if (!automation)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (automation.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (automation.series) {
      const videoDir = path.join(process.cwd(), "public", "videos");
      await Promise.allSettled(
        automation.series.videos.map((v) =>
          fs.unlink(path.join(videoDir, `${v.id}.mp4`)).catch(() => {}),
        ),
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
