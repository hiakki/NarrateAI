import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueClipRepurpose } from "@/services/queue";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const automations = await db.automation.findMany({
      where: { userId: session.user.id, automationType: "clip-repurpose" },
      include: {
        series: {
          include: {
            _count: { select: { videos: true } },
            videos: {
              orderBy: { createdAt: "desc" },
              take: 10,
              select: {
                id: true,
                title: true,
                status: true,
                videoUrl: true,
                duration: true,
                sourceUrl: true,
                sourceMetadata: true,
                postedPlatforms: true,
                errorMessage: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const data = automations.map((a) => ({
      ...a,
      series: a.series
        ? {
            _count: a.series._count,
            lastVideo: a.series.videos[0] ?? null,
            videos: a.series.videos,
          }
        : null,
    }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error("List clip-repurpose error:", error);
    return NextResponse.json({ error: "Failed to list" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as {
      action?: "create" | "trigger" | "toggle" | "update" | "delete" | "stop" | "clear-failed";
      automationId?: string;
      enabled?: boolean;
      name?: string;
      clipNiche?: string;
      clipDurationSec?: number;
      cropMode?: string;
      frequency?: string;
      postTime?: string;
      timezone?: string;
      targetPlatforms?: string[];
      includeAiTags?: boolean;
      crossPlatformOnly?: boolean;
      enableBgm?: boolean;
      enableHflip?: boolean;
    };

    if (body.action === "stop" && body.automationId) {
      const auto = await db.automation.findFirst({
        where: { id: body.automationId, userId: session.user.id },
        select: { seriesId: true },
      });
      if (!auto?.seriesId) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const updated = await db.video.updateMany({
        where: { seriesId: auto.seriesId, status: { in: ["QUEUED", "GENERATING"] } },
        data: { status: "FAILED", errorMessage: "Stopped by user" },
      });
      return NextResponse.json({ ok: true, stopped: updated.count });
    }

    // Toggle enabled/disabled
    if (body.action === "toggle" && body.automationId) {
      await db.automation.updateMany({
        where: { id: body.automationId, userId: session.user.id },
        data: { enabled: body.enabled ?? false },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "update" && body.automationId) {
      const existing = await db.automation.findFirst({
        where: { id: body.automationId, userId: session.user.id },
      });
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const existingClip = (existing.clipConfig ?? {}) as Record<string, unknown>;
      const updatedClipConfig = {
        ...existingClip,
        ...(body.clipNiche !== undefined ? { clipNiche: body.clipNiche } : {}),
        ...(body.clipDurationSec !== undefined ? { clipDurationSec: body.clipDurationSec } : {}),
        ...(body.cropMode !== undefined ? { cropMode: body.cropMode } : {}),
      };

      await db.automation.update({
        where: { id: body.automationId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.targetPlatforms !== undefined ? { targetPlatforms: body.targetPlatforms } : {}),
          ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
          ...(body.postTime !== undefined ? { postTime: body.postTime } : {}),
          ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
          ...(body.includeAiTags !== undefined ? { includeAiTags: body.includeAiTags } : {}),
          ...(body.crossPlatformOnly !== undefined ? { crossPlatformOnly: body.crossPlatformOnly } : {}),
          ...(body.enableBgm !== undefined ? { enableBgm: body.enableBgm } : {}),
          ...(body.enableHflip !== undefined ? { enableHflip: body.enableHflip } : {}),
          clipConfig: updatedClipConfig,
        },
      });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete" && body.automationId) {
      const existing = await db.automation.findFirst({
        where: { id: body.automationId, userId: session.user.id },
        select: { id: true, seriesId: true },
      });
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

      await db.automation.delete({ where: { id: body.automationId } });
      if (existing.seriesId) {
        await db.video.deleteMany({ where: { seriesId: existing.seriesId } });
        await db.series.delete({ where: { id: existing.seriesId } }).catch(() => {});
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "clear-failed") {
      const userAutos = await db.automation.findMany({
        where: { userId: session.user.id, automationType: "clip-repurpose" },
        select: { seriesId: true },
      });
      const seriesIds = userAutos.map((a) => a.seriesId).filter(Boolean) as string[];
      const result = await db.video.deleteMany({
        where: { seriesId: { in: seriesIds }, status: "FAILED" },
      });
      return NextResponse.json({ ok: true, deleted: result.count });
    }

    if (body.action === "trigger" && body.automationId) {
      const auto = await db.automation.findFirst({
        where: { id: body.automationId, userId: session.user.id },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      if (!auto) return NextResponse.json({ error: "Not found" }, { status: 404 });

      let seriesId = auto.seriesId;
      if (!seriesId) {
        const series = await db.series.create({
          data: {
            userId: session.user.id,
            name: `[Clip] ${auto.name}`,
            niche: "clip-repurpose",
            artStyle: "realistic",
            tone: "dramatic",
          },
        });
        await db.automation.update({ where: { id: auto.id }, data: { seriesId: series.id } });
        seriesId = series.id;
      }

      const targetPlatforms = (auto.targetPlatforms ?? []) as string[];

      // Compute scheduled post time from automation settings
      let scheduledPostTime: Date | undefined;
      if (auto.postTime && auto.timezone && targetPlatforms.length > 0) {
        const [tH, tM] = auto.postTime.split(":").map(Number);
        const now = new Date();
        const dateParts = new Intl.DateTimeFormat("en-US", {
          timeZone: auto.timezone, year: "numeric", month: "numeric", day: "numeric",
        }).formatToParts(now);
        const year = parseInt(dateParts.find((p) => p.type === "year")!.value);
        const month = parseInt(dateParts.find((p) => p.type === "month")!.value) - 1;
        const day = parseInt(dateParts.find((p) => p.type === "day")!.value);

        // Estimate UTC offset using noon (avoids midnight hour ambiguity)
        const noonUtc = new Date(Date.UTC(year, month, day, 12, 0, 0));
        const noonParts = new Intl.DateTimeFormat("en-US", {
          timeZone: auto.timezone, hour: "numeric", minute: "numeric", hour12: false,
        }).formatToParts(noonUtc);
        const noonH = parseInt(noonParts.find((p) => p.type === "hour")!.value);
        const noonM = parseInt(noonParts.find((p) => p.type === "minute")!.value);
        const offsetMin = (noonH * 60 + noonM) - 720;
        const targetUtcMin = tH * 60 + tM - offsetMin;
        let guess = new Date(Date.UTC(year, month, day, 0, targetUtcMin, 0));

        for (let i = 0; i < 3; i++) {
          const lp = new Intl.DateTimeFormat("en-US", {
            timeZone: auto.timezone, hour: "numeric", minute: "numeric", hour12: false,
          }).formatToParts(guess);
          const lh = parseInt(lp.find((p) => p.type === "hour")!.value);
          const lm = parseInt(lp.find((p) => p.type === "minute")!.value);
          const diff = (tH * 60 + tM) - (lh * 60 + lm);
          if (diff === 0) break;
          guess = new Date(guess.getTime() + diff * 60000);
        }
        if (guess.getTime() < Date.now() + 15 * 60 * 1000) {
          guess = new Date(guess.getTime() + 24 * 60 * 60 * 1000);
        }
        scheduledPostTime = guess;
      }

      const triggeredAt = new Date();
      const video = await db.video.create({
        data: {
          seriesId,
          targetDuration: 45,
          status: "QUEUED",
          sourceMetadata: {
            generationContext: {
              triggerSource: "user-run-now",
              triggerType: "manual",
              triggerLabel: "Run Now",
              reason: "User clicked Run Now for clip automation",
              triggeredAt: triggeredAt.toISOString(),
            },
          } as never,
          ...(scheduledPostTime ? { scheduledPostTime, scheduledPlatforms: targetPlatforms } : {}),
        },
      });

      const clipConfig = (auto.clipConfig ?? {}) as Record<string, unknown>;
      await enqueueClipRepurpose({
        videoId: video.id,
        seriesId,
        userId: auto.user.id,
        userName: auto.user.name ?? auto.user.email?.split("@")[0] ?? "user",
        automationId: auto.id,
        automationName: auto.name,
        niche: "clip-repurpose",
        language: auto.language,
        tone: auto.tone,
        clipConfig: {
          clipNiche: (clipConfig.clipNiche as string) ?? "auto",
          clipDurationSec: (clipConfig.clipDurationSec as number) ?? 45,
          cropMode: (clipConfig.cropMode as "blur-bg" | "center-crop") ?? "blur-bg",
          creditOriginal: true,
          enableBgm: auto.enableBgm,
          enableHflip: auto.enableHflip,
        },
        targetPlatforms,
        triggerSource: "user-run-now",
        triggerType: "manual",
        triggerLabel: "Run Now",
        triggerReason: "User clicked Run Now for clip automation",
        triggeredAt: triggeredAt.toISOString(),
      });

      return NextResponse.json({ videoId: video.id, message: "Clip job queued", scheduledPostTime });
    }

    // Create new clip-repurpose automation
    const name = body.name ?? "Viral Clips";
    const series = await db.series.create({
      data: {
        userId: session.user.id,
        name: `[Clip] ${name}`,
        niche: "clip-repurpose",
        artStyle: "realistic",
        tone: "dramatic",
      },
    });

    const automation = await db.automation.create({
      data: {
        userId: session.user.id,
        name,
        niche: "clip-repurpose",
        automationType: "clip-repurpose",
        clipConfig: {
          clipNiche: body.clipNiche ?? "auto",
          clipDurationSec: body.clipDurationSec ?? 45,
          cropMode: body.cropMode ?? "blur-bg",
          creditOriginal: true,
        },
        targetPlatforms: body.targetPlatforms ?? ["FACEBOOK", "YOUTUBE", "INSTAGRAM"],
        includeAiTags: body.includeAiTags ?? false,
        crossPlatformOnly: body.crossPlatformOnly ?? false,
        enableBgm: body.enableBgm ?? true,
        enableHflip: body.enableHflip ?? false,
        frequency: body.frequency ?? "daily",
        postTime: body.postTime ?? "10:00",
        timezone: body.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        seriesId: series.id,
        enabled: true,
      },
    });

    return NextResponse.json({ data: automation }, { status: 201 });
  } catch (error) {
    console.error("Clip-repurpose API error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
