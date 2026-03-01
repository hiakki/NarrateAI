import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveScenesDir, resolveVideoFile } from "@/lib/video-paths";
import fs from "fs/promises";

async function countSceneImages(videoUrl: string | null, videoId: string): Promise<{ count: number; urls: string[] }> {
  if (!videoUrl) {
    const legacy = `${process.cwd()}/public/videos/${videoId}/scenes`;
    try {
      const files = await fs.readdir(legacy);
      const scenes = files.filter(f => f.startsWith("scene-")).sort();
      return { count: scenes.length, urls: scenes.map(f => `/videos/${videoId}/scenes/${f}`) };
    } catch {
      return { count: 0, urls: [] };
    }
  }

  const dir = resolveScenesDir(videoUrl);
  try {
    const files = await fs.readdir(dir);
    const scenes = files.filter(f => f.startsWith("scene-")).sort();
    const isNew = /\/video\.mp4$/.test(videoUrl);
    const baseUrl = isNew
      ? videoUrl.replace(/\/video\.mp4$/, "")
      : `/videos/${videoId}`;
    return {
      count: scenes.length,
      urls: scenes.map(f => `${baseUrl}/scenes/${f}`),
    };
  } catch {
    return { count: 0, urls: [] };
  }
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
    const video = await db.video.findUnique({
      where: { id },
      include: { series: { select: { userId: true, name: true, niche: true, artStyle: true } } },
    });

    if (!video)
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    if (video.series.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const sceneImages = await countSceneImages(video.videoUrl, id);
    const checkpoint = video.checkpointData as { totalImageCount?: number; imagePrompts?: string[] } | null;
    const scenesJson = video.scenesJson as { text: string; visualDescription: string }[] | null;
    const totalScenes = checkpoint?.totalImageCount ?? scenesJson?.length ?? 0;

    return NextResponse.json({
      data: {
        ...video,
        sceneImages: sceneImages.urls,
        sceneImageCount: sceneImages.count,
        totalScenes,
        imagePrompts: video.status === "REVIEW" ? (checkpoint?.imagePrompts ?? []) : undefined,
      },
    });
  } catch (error) {
    console.error("Get video error:", error);
    return NextResponse.json({ error: "Failed to get video" }, { status: 500 });
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
    const video = await db.video.findUnique({
      where: { id },
      include: { series: { select: { userId: true } } },
    });

    if (!video)
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    if (video.series.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (video.videoUrl) {
      const videoFile = resolveVideoFile(video.videoUrl);
      const videoDir = videoFile.replace(/\/video\.mp4$/, "");
      await fs.rm(videoDir, { recursive: true, force: true }).catch(() => {});
      await fs.unlink(videoFile).catch(() => {});
    }
    // Legacy path cleanup
    const legacyMp4 = `${process.cwd()}/public/videos/${id}.mp4`;
    const legacyDir = `${process.cwd()}/public/videos/${id}`;
    await fs.unlink(legacyMp4).catch(() => {});
    await fs.rm(legacyDir, { recursive: true, force: true }).catch(() => {});

    await db.video.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete video error:", error);
    return NextResponse.json({ error: "Failed to delete video" }, { status: 500 });
  }
}
