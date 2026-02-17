import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkVideoLimit } from "@/lib/permissions";
import { getArtStyleById } from "@/config/art-styles";
import { getNicheById } from "@/config/niches";
import { generateScript } from "@/services/script-generator";
import { enqueueVideoGeneration } from "@/services/queue";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const video = await db.video.findUnique({ where: { id }, include: { series: true } });
    if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });
    if (video.series.userId !== session.user.id && session.user.role === "USER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (video.status !== "FAILED" && video.status !== "QUEUED") {
      return NextResponse.json({ error: "Only failed or stuck videos can be retried" }, { status: 400 });
    }

    const videoCheck = await checkVideoLimit(session.user.id, session.user.role, session.user.plan);
    if (!videoCheck.allowed) {
      return NextResponse.json({ error: "Monthly video limit reached" }, { status: 403 });
    }

    const artStyle = getArtStyleById(video.series.artStyle);
    const niche = getNicheById(video.series.niche);

    let scriptText = video.scriptText ?? "";
    let title = video.title ?? "Untitled";
    let scenes: { text: string; visualDescription: string }[] = [];

    // If we have a script, parse scenes from it. Otherwise regenerate.
    if (scriptText && scriptText.includes("[Scene")) {
      const parts = scriptText.split(/\[Scene \d+\]\n/).filter(Boolean);
      scenes = parts.map((text) => ({
        text: text.trim(),
        visualDescription: `${artStyle?.promptModifier ?? "cinematic"}: scene depicting "${text.trim().slice(0, 100)}"`,
      }));
    }

    if (scenes.length === 0) {
      console.log(`[Retry] No existing scenes, regenerating script for ${id}`);
      const script = await generateScript({
        niche: niche?.name ?? video.series.niche,
        tone: "dramatic",
        artStyle: video.series.artStyle,
        duration: video.duration ?? 45,
      });
      scriptText = script.fullScript;
      title = script.title;
      scenes = script.scenes;
    }

    // Keep checkpoint data -- worker will resume from last completed stage
    await db.video.update({
      where: { id },
      data: {
        status: "QUEUED",
        generationStage: null,
        errorMessage: null,
        scriptText,
        title,
      },
    });

    await enqueueVideoGeneration({
      videoId: video.id,
      seriesId: video.seriesId,
      title,
      scriptText,
      scenes,
      artStyle: video.series.artStyle,
      artStylePrompt: artStyle?.promptModifier ?? "cinematic, high quality",
      voiceId: video.series.voiceId ?? "Charon",
      musicPath: niche?.defaultMusic,
      duration: video.duration ?? 45,
    });

    return NextResponse.json({ data: { videoId: video.id, status: "QUEUED" } });
  } catch (error) {
    console.error("Retry error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to retry" }, { status: 500 });
  }
}
