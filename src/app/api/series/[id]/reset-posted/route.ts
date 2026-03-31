import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const series = await db.series.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!series)
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    if (series.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const result = await db.video.updateMany({
      where: {
        seriesId: id,
        status: { in: ["READY", "POSTED"] },
      },
      data: {
        postedPlatforms: [],
        status: "READY",
      },
    });

    return NextResponse.json({ success: true, count: result.count });
  } catch (error) {
    console.error("Bulk reset posted error:", error);
    return NextResponse.json(
      { error: "Failed to reset posted status" },
      { status: 500 },
    );
  }
}
