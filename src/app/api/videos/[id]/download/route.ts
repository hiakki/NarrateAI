import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import fs from "fs";
import path from "path";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    if (!video || !video.videoUrl) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    if (video.series.userId !== session.user.id && session.user.role === "USER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const filePath = path.join(process.cwd(), "public", video.videoUrl);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Video file not found" }, { status: 404 });
    }

    const buffer = fs.readFileSync(filePath);
    const filename = `${video.title || "narrateai-video"}.mp4`.replace(/[^a-zA-Z0-9.-]/g, "_");

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
