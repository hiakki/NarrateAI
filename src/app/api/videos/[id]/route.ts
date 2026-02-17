import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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
      include: {
        series: { select: { userId: true, name: true, niche: true, artStyle: true } },
      },
    });

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    if (video.series.userId !== session.user.id && session.user.role === "USER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ data: video });
  } catch (error) {
    console.error("Get video error:", error);
    return NextResponse.json({ error: "Failed to get video" }, { status: 500 });
  }
}
