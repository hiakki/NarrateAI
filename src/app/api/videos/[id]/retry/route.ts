import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkVideoLimit } from "@/lib/permissions";
import { getArtStyleById } from "@/config/art-styles";
import { getNicheById } from "@/config/niches";
import { getDefaultVoiceId } from "@/config/voices";
import { generateScript } from "@/services/script-generator";
import { enqueueVideoGeneration } from "@/services/queue";
import { resolveProviders } from "@/services/providers/resolve";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const video = await db.video.findUnique({
      where: { id },
      include: {
        series: {
          include: {
            user: {
              select: { defaultLlmProvider: true, defaultTtsProvider: true, defaultImageProvider: true },
            },
          },
        },
      },
    });
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
    const resolved = resolveProviders(video.series, video.series.user);

    let scriptText = video.scriptText ?? "";
    let title = video.title ?? "Untitled";
    let scenes: { text: string; visualDescription: string }[] = [];

    // Prefer persisted scenes from DB (preserves original LLM visualDescriptions)
    if (video.scenesJson && Array.isArray(video.scenesJson) && (video.scenesJson as unknown[]).length > 0) {
      scenes = video.scenesJson as { text: string; visualDescription: string }[];
      console.log(`[Retry] Restored ${scenes.length} scenes from DB for ${id}`);
    }

    if (scenes.length === 0) {
      console.log(`[Retry] No persisted scenes, regenerating script for ${id}`);
      const script = await generateScript({
        niche: niche?.name ?? video.series.niche,
        tone: video.series.tone ?? "dramatic",
        artStyle: video.series.artStyle,
        duration: video.targetDuration ?? video.duration ?? 45,
        language: video.series.language ?? "en",
      }, resolved.llm);
      scriptText = script.fullScript;
      title = script.title;
      scenes = script.scenes;
    }

    await db.video.update({
      where: { id },
      data: {
        status: "QUEUED",
        generationStage: null,
        errorMessage: null,
        scriptText,
        title,
        scenesJson: scenes as never,
      },
    });

    const voiceId = video.series.voiceId ?? getDefaultVoiceId(resolved.tts);

    await enqueueVideoGeneration({
      videoId: video.id,
      seriesId: video.seriesId,
      title,
      scriptText,
      scenes,
      artStyle: video.series.artStyle,
      artStylePrompt: artStyle?.promptModifier ?? "cinematic, high quality",
      negativePrompt: artStyle?.negativePrompt ?? "low quality, blurry, watermark, text",
      tone: video.series.tone ?? "dramatic",
      niche: video.series.niche,
      voiceId,
      language: video.series.language ?? "en",
      musicPath: niche?.defaultMusic,
      duration: video.targetDuration ?? video.duration ?? 45,
      llmProvider: resolved.llm,
      ttsProvider: resolved.tts,
      imageProvider: resolved.image,
    });

    return NextResponse.json({ data: { videoId: video.id, status: "QUEUED" } });
  } catch (error) {
    console.error("Retry error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to retry" }, { status: 500 });
  }
}
