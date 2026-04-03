import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import fs from "fs/promises";
import { resolveVideoFile } from "@/lib/video-paths";

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

    const series = await db.series.findUnique({
      where: { id },
      include: { videos: { select: { id: true, videoUrl: true } } },
    });

    if (!series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    if (series.userId !== session.user.id && session.user.role === "USER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await Promise.allSettled(
      series.videos.map(async (v) => {
        if (v.videoUrl?.includes("/video.mp4")) {
          const videoFile = resolveVideoFile(v.videoUrl);
          const dir = videoFile.replace(/\/video\.mp4$/, "");
          await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
          await fs.unlink(videoFile).catch(() => {});
        }
        // Legacy cleanup
        const legacyMp4 = resolveVideoFile(`/videos/${v.id}.mp4`);
        const legacyDir = resolveVideoFile(`/videos/${v.id}/video.mp4`).replace(/\/video\.mp4$/, "");
        await fs.unlink(legacyMp4).catch(() => {});
        await fs.rm(legacyDir, { recursive: true, force: true }).catch(() => {});
      }),
    );

    await db.series.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete series error:", error);
    return NextResponse.json(
      { error: "Failed to delete series" },
      { status: 500 },
    );
  }
}
