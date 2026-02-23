import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueVideoGeneration } from "@/services/queue";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const selectedIndices: number[] | undefined = body.selectedIndices;

    const video = await db.video.findUnique({
      where: { id },
      include: {
        series: {
          select: {
            userId: true, niche: true, artStyle: true, tone: true,
            voiceId: true, language: true,
            llmProvider: true, ttsProvider: true, imageProvider: true,
          },
        },
      },
    });

    if (!video || video.series.userId !== session.user.id)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (video.status !== "REVIEW")
      return NextResponse.json({ error: "Video not in review" }, { status: 400 });

    const checkpoint = video.checkpointData as {
      imagePaths?: string[];
      imagePrompts?: string[];
      audioPath?: string;
      durationMs?: number;
      sceneTimings?: { startMs: number; endMs: number }[];
      expandedTimings?: { startMs: number; endMs: number }[];
      musicPath?: string;
      completedStages?: string[];
    } | null;

    if (!checkpoint?.imagePaths || !checkpoint?.audioPath)
      return NextResponse.json({ error: "Missing checkpoint data" }, { status: 400 });

    let finalImagePaths = checkpoint.imagePaths;
    let finalTimings = checkpoint.expandedTimings ?? checkpoint.sceneTimings ?? [];

    if (selectedIndices && selectedIndices.length > 0 && selectedIndices.length < finalImagePaths.length) {
      const sorted = [...selectedIndices].sort((a, b) => a - b);
      finalImagePaths = sorted.map(i => finalImagePaths![i]);
      finalTimings = sorted.map(i => finalTimings[i]);
    }

    await db.video.update({
      where: { id },
      data: {
        status: "GENERATING",
        generationStage: "ASSEMBLY",
        checkpointData: {
          ...checkpoint,
          imagePaths: finalImagePaths,
          sceneTimings: finalTimings,
          completedStages: [...(checkpoint.completedStages ?? [])],
          reviewMode: false,
        } as never,
      },
    });

    const scenes = (video.scenesJson ?? []) as { text: string; visualDescription: string }[];

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { defaultLlmProvider: true, defaultTtsProvider: true, defaultImageProvider: true },
    });

    const { resolveProviders } = await import("@/services/providers/resolve");
    const resolved = resolveProviders(
      {
        llmProvider: video.series.llmProvider,
        ttsProvider: video.series.ttsProvider,
        imageProvider: video.series.imageProvider,
      },
      user,
    );

    await enqueueVideoGeneration({
      videoId: id,
      seriesId: video.seriesId,
      title: video.title ?? "Untitled",
      scriptText: video.scriptText ?? "",
      scenes,
      artStyle: video.series.artStyle,
      artStylePrompt: "",
      negativePrompt: "",
      tone: video.series.tone ?? "dramatic",
      niche: video.series.niche,
      voiceId: video.series.voiceId ?? "",
      language: video.series.language ?? "en",
      musicPath: checkpoint.musicPath,
      duration: video.targetDuration ?? 45,
      llmProvider: resolved.llm,
      ttsProvider: resolved.tts,
      imageProvider: resolved.image,
      reviewMode: false,
    });

    return NextResponse.json({ data: { status: "GENERATING" } });
  } catch (error) {
    console.error("Assemble error:", error);
    return NextResponse.json({ error: "Failed to start assembly" }, { status: 500 });
  }
}
