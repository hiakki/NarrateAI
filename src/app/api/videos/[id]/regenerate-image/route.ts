import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getImageProvider } from "@/services/providers/image";
import fs from "fs/promises";
import path from "path";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { index, prompt } = await req.json();

    if (typeof index !== "number" || !prompt)
      return NextResponse.json({ error: "index and prompt required" }, { status: 400 });

    const video = await db.video.findUnique({
      where: { id },
      include: { series: { select: { userId: true, imageProvider: true } } },
    });

    if (!video || video.series.userId !== session.user.id)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (video.status !== "REVIEW")
      return NextResponse.json({ error: "Video not in review" }, { status: 400 });

    const checkpoint = video.checkpointData as {
      imagePaths?: string[];
      imagePrompts?: string[];
    } | null;

    if (!checkpoint?.imagePaths || index >= checkpoint.imagePaths.length)
      return NextResponse.json({ error: "Invalid image index" }, { status: 400 });

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { defaultImageProvider: true },
    });

    const { resolveProviders } = await import("@/services/providers/resolve");
    const resolved = resolveProviders(
      { llmProvider: null, ttsProvider: null, imageProvider: video.series.imageProvider },
      user,
    );

    const provider = getImageProvider(resolved.image);
    const result = await provider.generateImages(
      [{ visualDescription: prompt }],
      "",
      undefined,
    );

    const newImagePath = result.imagePaths[0];
    const ext = path.extname(newImagePath) || ".png";

    const { resolveScenesDir } = await import("@/lib/video-paths");
    const scenesDir = video.videoUrl
      ? resolveScenesDir(video.videoUrl)
      : path.join(process.cwd(), "public", "videos", id, "scenes");
    await fs.mkdir(scenesDir, { recursive: true });
    const sceneName = `scene-${index.toString().padStart(3, "0")}${ext}`;
    const dest = path.join(scenesDir, sceneName);
    await fs.copyFile(newImagePath, dest);

    checkpoint.imagePaths[index] = newImagePath;
    if (checkpoint.imagePrompts) checkpoint.imagePrompts[index] = prompt;

    await db.video.update({
      where: { id },
      data: { checkpointData: checkpoint as never },
    });

    const baseUrl = video.videoUrl
      ? video.videoUrl.replace(/\/video\.mp4$/, "")
      : `/videos/${id}`;

    return NextResponse.json({
      data: { url: `${baseUrl}/scenes/${sceneName}` },
    });
  } catch (error) {
    console.error("Regenerate image error:", error);
    return NextResponse.json({ error: "Failed to regenerate image" }, { status: 500 });
  }
}
