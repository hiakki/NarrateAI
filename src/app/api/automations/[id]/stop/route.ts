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

    const automation = await db.automation.findUnique({
      where: { id },
      select: { userId: true, seriesId: true, name: true, enabled: true },
    });

    if (!automation)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (automation.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Disable the automation
    await db.automation.update({
      where: { id },
      data: { enabled: false },
    });

    let cancelledVideoId: string | null = null;

    // Cancel any in-progress video for this automation's series
    if (automation.seriesId) {
      const activeVideo = await db.video.findFirst({
        where: {
          seriesId: automation.seriesId,
          status: { in: ["QUEUED", "GENERATING"] },
        },
      });

      if (activeVideo) {
        await db.video.update({
          where: { id: activeVideo.id },
          data: {
            status: "FAILED",
            generationStage: null,
            errorMessage: "Stopped by user",
          },
        });
        cancelledVideoId = activeVideo.id;
      }
    }

    return NextResponse.json({
      data: {
        stopped: true,
        cancelledVideoId,
        message: cancelledVideoId
          ? `Automation "${automation.name}" stopped and in-progress video cancelled`
          : `Automation "${automation.name}" stopped`,
      },
    });
  } catch (error) {
    console.error("Stop automation error:", error);
    return NextResponse.json(
      { error: "Failed to stop automation" },
      { status: 500 },
    );
  }
}
