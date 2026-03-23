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
      include: {
        series: {
          select: {
            userId: true,
            automation: { select: { postTime: true, timezone: true } },
          },
        },
      },
    });

    if (!video)
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    if (video.series.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!["READY", "POSTED", "SCHEDULED"].includes(video.status))
      return NextResponse.json(
        { error: "Video is not ready for publishing" },
        { status: 400 },
      );

    let platforms: string[] | undefined;
    let immediate = false;
    try {
      const body = await req.json();
      if (Array.isArray(body.platforms) && body.platforms.length > 0) {
        const valid = new Set(["INSTAGRAM", "YOUTUBE", "FACEBOOK", "SHARECHAT", "MOJ"]);
        platforms = body.platforms.filter((p: string) => valid.has(p));
      }
      if (body.immediate === true) immediate = true;
    } catch {
      // empty body is fine — falls back to automation targets
    }

    let scheduledAt: Date | undefined;

    if (!immediate) {
      // Schedule natively — compute time from automation settings or default to 1h from now
      if (video.scheduledPostTime && new Date(video.scheduledPostTime).getTime() > Date.now() + 15 * 60 * 1000) {
        scheduledAt = new Date(video.scheduledPostTime);
      } else if (video.series.automation?.postTime && video.series.automation?.timezone) {
        const auto = video.series.automation;
        const [tH, tM] = auto.postTime.split(":").map(Number);
        const nowParts = new Intl.DateTimeFormat("en-US", {
          timeZone: auto.timezone, hour: "numeric", minute: "numeric", hour12: false,
        }).formatToParts(new Date());
        const nowH = parseInt(nowParts.find((p) => p.type === "hour")!.value);
        const nowM = parseInt(nowParts.find((p) => p.type === "minute")!.value);
        const targetMin = tH * 60 + tM;
        const nowMin = nowH * 60 + nowM;
        let guess = new Date(Date.now() + (targetMin - nowMin) * 60_000);
        if (guess.getTime() < Date.now() + 15 * 60 * 1000) {
          guess = new Date(guess.getTime() + 24 * 60 * 60 * 1000);
        }
        scheduledAt = guess;
      } else {
        scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
      }
    }

    if (scheduledAt) {
      await db.video.update({
        where: { id },
        data: { scheduledPostTime: scheduledAt },
      });
    }

    const results = await postVideoToSocials(id, platforms, scheduledAt);

    return NextResponse.json({ data: results, scheduledAt: scheduledAt ?? null, immediate });
  } catch (error) {
    console.error("Publish video error:", error);
    return NextResponse.json(
      { error: "Failed to publish video" },
      { status: 500 },
    );
  }
}
