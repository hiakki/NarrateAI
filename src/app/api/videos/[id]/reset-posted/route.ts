import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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
        { error: "Video is not in a posted/ready state" },
        { status: 400 },
      );

    let platforms: string[] | undefined;
    try {
      const body = await req.json();
      if (Array.isArray(body.platforms) && body.platforms.length > 0) {
        platforms = body.platforms;
      }
    } catch {
      // empty body = reset all
    }

    const currentPosted = (video.postedPlatforms ?? []) as (
      | string
      | { platform: string; postId?: string; url?: string }
    )[];

    let newPosted: typeof currentPosted;
    if (platforms && platforms.length > 0) {
      const toRemove = new Set(platforms);
      newPosted = currentPosted.filter((p) => {
        const key = typeof p === "string" ? p : p.platform;
        return !toRemove.has(key);
      });
    } else {
      newPosted = [];
    }

    await db.video.update({
      where: { id },
      data: {
        postedPlatforms: newPosted,
        status: newPosted.length > 0 ? "POSTED" : "READY",
      },
    });

    return NextResponse.json({ success: true, postedPlatforms: newPosted });
  } catch (error) {
    console.error("Reset posted error:", error);
    return NextResponse.json(
      { error: "Failed to reset posted status" },
      { status: 500 },
    );
  }
}
