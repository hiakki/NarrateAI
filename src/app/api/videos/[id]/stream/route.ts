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

    const stat = fs.statSync(filePath);
    const range = req.headers.get("range");

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      const body = new ReadableStream({
        start(controller) {
          stream.on("data", (chunk) => controller.enqueue(chunk));
          stream.on("end", () => controller.close());
          stream.on("error", (err) => controller.error(err));
        },
      });

      return new NextResponse(body, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": "video/mp4",
        },
      });
    }

    const buffer = fs.readFileSync(filePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": stat.size.toString(),
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    console.error("Stream error:", error);
    return NextResponse.json({ error: "Stream failed" }, { status: 500 });
  }
}
