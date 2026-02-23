import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

async function countSceneImages(videoId: string): Promise<{ count: number; urls: string[] }> {
  const dir = path.join(process.cwd(), "public", "videos", videoId, "scenes");
  try {
    const files = await fs.readdir(dir);
    const scenes = files.filter(f => f.startsWith("scene-")).sort();
    return {
      count: scenes.length,
      urls: scenes.map(f => `/videos/${videoId}/scenes/${f}`),
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
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const video = await db.video.findUnique({
      where: { id },
      include: {
        series: {
          select: { userId: true, name: true, niche: true, artStyle: true },
        },
      },
    });

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    if (
      video.series.userId !== session.user.id &&
      session.user.role === "USER"
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sceneImages = await countSceneImages(id);
    const checkpoint = video.checkpointData as {
      totalImageCount?: number;
      imagePrompts?: string[];
      audioPath?: string;
    } | null;
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
    return NextResponse.json(
      { error: "Failed to get video" },
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
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const video = await db.video.findUnique({
      where: { id },
      include: { series: { select: { userId: true } } },
    });

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    if (
      video.series.userId !== session.user.id &&
      session.user.role === "USER"
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const videoFile = path.join(
      process.cwd(),
      "public",
      "videos",
      `${id}.mp4`,
    );
    await fs.unlink(videoFile).catch(() => {});

    await db.video.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete video error:", error);
    return NextResponse.json(
      { error: "Failed to delete video" },
      { status: 500 },
    );
  }
}
