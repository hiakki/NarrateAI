import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod/v4";

const createSchema = z.object({
  name: z.string().min(1),
  niche: z.string().min(1),
  artStyle: z.string().min(1),
  voiceId: z.string().optional(),
  language: z.string().default("en"),
  tone: z.string().default("dramatic"),
  duration: z.number().min(15).max(120).default(45),
  llmProvider: z.string().optional(),
  ttsProvider: z.string().optional(),
  imageProvider: z.string().optional(),
  targetPlatforms: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  includeAiTags: z.boolean().default(true),
  frequency: z.enum(["daily", "every_other_day", "weekly"]).default("daily"),
  postTime: z.string().refine(
    (v) => v.split(",").every((t) => /^\d{2}:\d{2}$/.test(t.trim())),
    "Each time must be HH:MM, comma-separated for multiple",
  ).default("09:00"),
  timezone: z.string().min(1),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const automations = await db.automation.findMany({
      where: { userId: session.user.id },
      include: {
        series: {
          include: {
            _count: { select: { videos: true } },
            videos: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                title: true,
                status: true,
                postedPlatforms: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const data = automations.map((a) => ({
      ...a,
      series: a.series
        ? {
            _count: a.series._count,
            lastVideo: a.series.videos[0] ?? null,
          }
        : null,
    }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error("List automations error:", error);
    return NextResponse.json(
      { error: "Failed to list automations" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const input = createSchema.parse(body);

    const validPlatforms = new Set(["INSTAGRAM", "YOUTUBE", "FACEBOOK"]);
    const filteredPlatforms = input.targetPlatforms.filter((p) =>
      validPlatforms.has(p),
    );

    const result = await db.$transaction(async (tx) => {
      const series = await tx.series.create({
        data: {
          userId: session.user.id,
          name: `[Auto] ${input.name}`,
          niche: input.niche,
          artStyle: input.artStyle,
          voiceId: input.voiceId ?? null,
          language: input.language,
          tone: input.tone,
          llmProvider: (input.llmProvider as never) ?? null,
          ttsProvider: (input.ttsProvider as never) ?? null,
          imageProvider: (input.imageProvider as never) ?? null,
        },
      });

      const automation = await tx.automation.create({
        data: {
          userId: session.user.id,
          name: input.name,
          niche: input.niche,
          artStyle: input.artStyle,
          voiceId: input.voiceId ?? null,
          language: input.language,
          tone: input.tone,
          duration: input.duration,
          llmProvider: (input.llmProvider as never) ?? null,
          ttsProvider: (input.ttsProvider as never) ?? null,
          imageProvider: (input.imageProvider as never) ?? null,
          targetPlatforms: filteredPlatforms,
          enabled: input.enabled,
          includeAiTags: input.includeAiTags,
          frequency: input.frequency,
          postTime: input.postTime,
          timezone: input.timezone,
          seriesId: series.id,
        },
      });

      return automation;
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    console.error("Create automation error:", error);
    return NextResponse.json(
      { error: "Failed to create automation" },
      { status: 500 },
    );
  }
}
