import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

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
      include: { videos: { select: { id: true } } },
    });

    if (!series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    if (series.userId !== session.user.id && session.user.role === "USER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const videoDir = path.join(process.cwd(), "public", "videos");
    await Promise.allSettled(
      series.videos.map((v) =>
        fs.unlink(path.join(videoDir, `${v.id}.mp4`)).catch(() => {}),
      ),
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
