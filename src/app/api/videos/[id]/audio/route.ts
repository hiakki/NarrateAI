import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import fs from "fs/promises";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return new NextResponse("Unauthorized", { status: 401 });

    const { id } = await params;

    const video = await db.video.findUnique({
      where: { id },
      include: { series: { select: { userId: true } } },
    });

    if (!video || video.series.userId !== session.user.id)
      return new NextResponse("Not found", { status: 404 });

    const audioPath = video.voiceoverUrl;
    if (!audioPath)
      return new NextResponse("No audio", { status: 404 });

    const buffer = await fs.readFile(audioPath);
    const ext = audioPath.endsWith(".wav") ? "wav" : "mp3";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": ext === "wav" ? "audio/wav" : "audio/mpeg",
        "Content-Length": buffer.byteLength.toString(),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Audio not found", { status: 404 });
  }
}
