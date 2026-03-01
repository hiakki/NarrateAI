import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueVideoGeneration } from "@/services/queue";
import { getArtStyleById } from "@/config/art-styles";
import { getNicheById } from "@/config/niches";
import { resolveProviders } from "@/services/providers/resolve";
import { createLogger } from "@/lib/logger";

const log = createLogger("API:Trigger");

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const auto = await db.automation.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            defaultLlmProvider: true,
            defaultTtsProvider: true,
            defaultImageProvider: true,
          },
        },
      },
    });

    if (!auto)
      return NextResponse.json({ error: "Automation not found" }, { status: 404 });
    if (auto.user.id !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (!auto.seriesId) {
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
      auto.seriesId = newSeries.id;
    }

    const pendingVideo = await db.video.findFirst({
      where: {
        seriesId: auto.seriesId,
        status: { in: ["QUEUED", "GENERATING"] },
      },
    });
    if (pendingVideo) {
      return NextResponse.json(
        { error: "A video is already being generated for this automation" },
        { status: 409 },
      );
    }

    let characterPrompt: string | undefined;
    if (auto.characterId) {
      const char = await db.character.findUnique({
        where: { id: auto.characterId },
        select: { fullPrompt: true },
      });
      if (char) characterPrompt = char.fullPrompt;
    }

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

    // Create video record immediately — script generation happens in the worker
    const video = await db.video.create({
      data: {
        seriesId: auto.seriesId,
        targetDuration: auto.duration,
        status: "QUEUED",
      },
    });

    await enqueueVideoGeneration({
      videoId: video.id,
      seriesId: auto.seriesId,
      userId: auto.user.id,
      userName: auto.user.name ?? auto.user.email?.split("@")[0] ?? "user",
      automationName: auto.name,
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
      characterPrompt,
    });

    await db.automation.update({
      where: { id: auto.id },
      data: { lastRunAt: new Date() },
    });

    log.log(`Triggered "${auto.name}" → video ${video.id} queued`);

    return NextResponse.json({
      data: { videoId: video.id, title: auto.name },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`Trigger failed: ${msg.slice(0, 200)}`);
    return NextResponse.json(
      { error: "Failed to trigger automation" },
      { status: 500 },
    );
  }
}
