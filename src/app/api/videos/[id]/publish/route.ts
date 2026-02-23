import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { postVideoToSocials } from "@/services/social-poster";

export async function POST(
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
      include: { series: { select: { userId: true } } },
    });

    if (!video)
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    if (video.series.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (video.status !== "READY" && video.status !== "POSTED")
      return NextResponse.json(
        { error: "Video is not ready for publishing" },
        { status: 400 },
      );

    const results = await postVideoToSocials(id);

    return NextResponse.json({ data: results });
  } catch (error) {
    console.error("Publish video error:", error);
    return NextResponse.json(
      { error: "Failed to publish video" },
      { status: 500 },
    );
  }
}
