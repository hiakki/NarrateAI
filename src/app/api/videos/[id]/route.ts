import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveScenesDir, resolveVideoFile } from "@/lib/video-paths";
import fs from "fs/promises";

const SCENE_IMG_RE = /^scene-\d+\.(jpg|jpeg|png|webp)$/i;
const SCENE_CLIP_RE = /^scene-(\d+)-clip\.mp4$/i;

async function countSceneImages(videoUrl: string | null, videoId: string): Promise<{ count: number; urls: string[]; clipUrls: (string | null)[] }> {
  function buildResult(files: string[], baseUrl: string) {
    const images = files.filter(f => SCENE_IMG_RE.test(f)).sort();
    const clipSet = new Map<string, string>();
    for (const f of files) {
      const m = SCENE_CLIP_RE.exec(f);
      if (m) clipSet.set(m[1], f);
    }
    const clipUrls = images.map((img) => {
      const idx = img.match(/scene-(\d+)\./)?.[1];
      const clipFile = idx ? clipSet.get(idx) : undefined;
      return clipFile ? `${baseUrl}/scenes/${clipFile}` : null;
    });
    return { count: images.length, urls: images.map(f => `${baseUrl}/scenes/${f}`), clipUrls };
  }

  if (!videoUrl) {
    const legacy = `${process.cwd()}/public/videos/${videoId}/scenes`;
    try {
      const files = await fs.readdir(legacy);
      return buildResult(files, `/videos/${videoId}`);
    } catch {
      return { count: 0, urls: [], clipUrls: [] };
    }
  }

  const dir = resolveScenesDir(videoUrl);
  try {
    const files = await fs.readdir(dir);
    const isNew = /\/video\.mp4$/.test(videoUrl);
    const baseUrl = isNew
      ? videoUrl.replace(/\/video\.mp4$/, "")
      : `/videos/${videoId}`;
    return buildResult(files, baseUrl);
  } catch {
    return { count: 0, urls: [], clipUrls: [] };
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
    const checkpoint = video.checkpointData as { totalImageCount?: number; imagePrompts?: string[]; stageTimings?: Record<string, { startedAt: number; completedAt: number; durationMs: number }>; imageToVideoProvider?: string; usedProviders?: { tts?: string; image?: string; i2v?: string; bgm?: string; sfx?: string } } | null;
    const scenesJson = video.scenesJson as { text: string; visualDescription: string }[] | null;
    const totalScenes = checkpoint?.totalImageCount ?? scenesJson?.length ?? 0;
    const stageTimings = video.stageTimings ?? checkpoint?.stageTimings ?? null;

    return NextResponse.json({
      data: {
        ...video,
        sceneImages: sceneImages.urls,
        sceneClips: sceneImages.clipUrls,
        sceneImageCount: sceneImages.count,
        totalScenes,
        imagePrompts: video.status === "REVIEW" ? (checkpoint?.imagePrompts ?? []) : undefined,
        stageTimings,
        imageToVideoProvider: checkpoint?.imageToVideoProvider ?? null,
        usedProviders: checkpoint?.usedProviders ?? null,
      },
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
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
