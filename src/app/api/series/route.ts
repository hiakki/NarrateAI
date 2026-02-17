import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkSeriesLimit, checkVideoLimit } from "@/lib/permissions";
import { getArtStyleById } from "@/config/art-styles";
import { getNicheById } from "@/config/niches";
import { enqueueVideoGeneration } from "@/services/queue";
import { z } from "zod/v4";

const createSchema = z.object({
  name: z.string().min(1),
  niche: z.string().min(1),
  artStyle: z.string().min(1),
  voiceId: z.string().min(1),
  tone: z.string().min(1),
  duration: z.number().min(15).max(120),
  title: z.string().min(1),
  scriptText: z.string().min(1),
  scenes: z.array(z.object({ text: z.string().min(1), visualDescription: z.string().min(1) })),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const input = createSchema.parse(body);

    const seriesCheck = await checkSeriesLimit(session.user.id, session.user.role, session.user.plan);
    if (!seriesCheck.allowed) {
      return NextResponse.json({ error: `Series limit reached (${seriesCheck.current}/${seriesCheck.limit})` }, { status: 403 });
    }

    const videoCheck = await checkVideoLimit(session.user.id, session.user.role, session.user.plan);
    if (!videoCheck.allowed) {
      return NextResponse.json({ error: `Monthly video limit reached (${videoCheck.current}/${videoCheck.limit})` }, { status: 403 });
    }

    const artStyle = getArtStyleById(input.artStyle);
    const niche = getNicheById(input.niche);

    const result = await db.$transaction(async (tx) => {
      const series = await tx.series.create({
        data: {
          userId: session.user.id,
          name: input.name,
          niche: input.niche,
          artStyle: input.artStyle,
          voiceId: input.voiceId,
        },
      });
      const video = await tx.video.create({
        data: { seriesId: series.id, title: input.title, scriptText: input.scriptText, status: "QUEUED" },
      });
      return { series, video };
    });

    await enqueueVideoGeneration({
      videoId: result.video.id,
      seriesId: result.series.id,
      title: input.title,
      scriptText: input.scriptText,
      scenes: input.scenes,
      artStyle: input.artStyle,
      artStylePrompt: artStyle?.promptModifier ?? "cinematic, high quality",
      voiceId: input.voiceId,
      musicPath: niche?.defaultMusic,
      duration: input.duration,
    });

    return NextResponse.json({ data: { seriesId: result.series.id, videoId: result.video.id } }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    console.error("Create series error:", error);
    return NextResponse.json({ error: "Failed to create series" }, { status: 500 });
  }
}
