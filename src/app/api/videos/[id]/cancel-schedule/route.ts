import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteYouTubeVideo } from "@/lib/social/youtube";
import { deleteFacebookVideo, getFreshFacebookToken } from "@/lib/social/facebook";
import { decrypt } from "@/lib/social/encrypt";
import { clearPostQueueJobsForVideo, clearReconcileQueueJobsForVideo } from "@/services/queue";

interface PlatformEntry {
  platform: string;
  success?: boolean | "uploading" | "scheduled" | "deleted";
  postId?: string | null;
  url?: string | null;
  error?: string;
  scheduledFor?: string;
}

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
            user: {
              select: {
                id: true,
                socialAccounts: {
                  select: {
                    id: true,
                    platform: true,
                    platformUserId: true,
                    accessTokenEnc: true,
                    refreshTokenEnc: true,
                    pageId: true,
                    tokenExpiresAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!video)
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    if (video.series.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const currentScheduled = (video.scheduledPlatforms ?? []) as string[];
    const postedRaw = (video.postedPlatforms ?? []) as (string | PlatformEntry)[];
    const entries: PlatformEntry[] = postedRaw.map((p) => {
      if (typeof p === "string") return { platform: p, success: true as const };
      if (p.success === undefined && (p.postId || p.url)) return { ...p, success: true as const };
      return p;
    });

    const hasScheduledEntries = entries.some(
      (e) => e.success === "scheduled" || (e.success === true && e.postId),
    );

    if (currentScheduled.length === 0 && !video.scheduledPostTime && !hasScheduledEntries) {
      return NextResponse.json({ error: "No scheduled post to cancel" }, { status: 400 });
    }

    let platforms: string[] | undefined;
    try {
      const body = await req.json();
      if (Array.isArray(body.platforms) && body.platforms.length > 0) {
        platforms = body.platforms;
      }
    } catch {
      // empty body = cancel all
    }

    const toCancel = platforms ? new Set(platforms) : null;

    // Clear scheduledPlatforms
    let newScheduled: string[];
    if (toCancel) {
      newScheduled = currentScheduled.filter((p) => !toCancel.has(p));
    } else {
      newScheduled = [];
    }

    const accounts = video.series.user.socialAccounts;
    const results: { platform: string; success: boolean; error?: string }[] = [];

    // For each entry being cancelled, call platform API if it has a postId (native schedule)
    for (const entry of entries) {
      if (toCancel && !toCancel.has(entry.platform)) continue;
      if (entry.success !== true && entry.success !== "scheduled") continue;

      if (entry.postId) {
        try {
          if (entry.platform === "YOUTUBE") {
            const ytAccount = accounts.find((a) => a.platform === "YOUTUBE");
            if (ytAccount?.accessTokenEnc) {
              const token = decrypt(ytAccount.accessTokenEnc);
              const refreshToken = ytAccount.refreshTokenEnc ? decrypt(ytAccount.refreshTokenEnc) : null;
              const res = await deleteYouTubeVideo(token, refreshToken, entry.postId, ytAccount.platformUserId, video.series.userId);
              results.push({ platform: "YOUTUBE", ...res });
            } else {
              results.push({ platform: "YOUTUBE", success: false, error: "No YouTube account connected" });
            }
          } else if (entry.platform === "FACEBOOK") {
            const fbAccount = accounts.find((a) => a.platform === "FACEBOOK");
            if (fbAccount?.accessTokenEnc) {
              let pageToken = decrypt(fbAccount.accessTokenEnc);
              if (fbAccount.refreshTokenEnc && fbAccount.pageId) {
                try {
                  pageToken = await getFreshFacebookToken(fbAccount.id, pageToken, fbAccount.refreshTokenEnc, fbAccount.pageId, fbAccount.tokenExpiresAt);
                } catch { /* use stored token */ }
              }
              const res = await deleteFacebookVideo(entry.postId, pageToken);
              results.push({ platform: "FACEBOOK", ...res });
            } else {
              results.push({ platform: "FACEBOOK", success: false, error: "No Facebook account connected. Reconnect in Channels." });
            }
          } else {
            results.push({ platform: entry.platform, success: true });
          }
        } catch (err) {
          results.push({ platform: entry.platform, success: false, error: err instanceof Error ? err.message : "Unknown error" });
        }
      } else {
        results.push({ platform: entry.platform, success: true });
      }
    }

    const NOT_FOUND_PATTERNS = ["cannot be found", "not found", "does not exist", "not exist"];
    const updatedPosted = entries.map((e) => {
      if (toCancel && !toCancel.has(e.platform)) return e;
      if (e.success !== true && e.success !== "scheduled") return e;

      const result = results.find((r) => r.platform === e.platform);
      if (!result) return e;
      const errLower = (result.error ?? "").toLowerCase();
      const isNotFound = NOT_FOUND_PATTERNS.some((p) => errLower.includes(p));
      if (result.success || isNotFound) {
        return { platform: e.platform, success: "deleted" as const, postId: e.postId, url: e.url };
      }
      // Platform API failed but still clear the schedule from our side
      if (e.success === "scheduled") {
        return { platform: e.platform, success: "deleted" as const };
      }
      return e;
    });

    const stillPosted = updatedPosted.filter(
      (e) => e.success === true || e.success === "uploading" || e.success === "scheduled",
    );

    await db.video.update({
      where: { id },
      data: {
        scheduledPlatforms: newScheduled,
        scheduledPostTime: newScheduled.length > 0 ? video.scheduledPostTime : null,
        postedPlatforms: updatedPosted as never,
        status: stillPosted.length > 0 ? video.status : "READY",
      },
    });
    await clearPostQueueJobsForVideo(id);
    await clearReconcileQueueJobsForVideo(id);

    return NextResponse.json({
      success: true,
      results,
      scheduledPlatforms: newScheduled,
      scheduledPostTime: newScheduled.length > 0 ? video.scheduledPostTime : null,
    });
  } catch (error) {
    console.error("Cancel schedule error:", error);
    return NextResponse.json(
      { error: "Failed to cancel scheduled post" },
      { status: 500 },
    );
  }
}
