import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteYouTubeVideo } from "@/lib/social/youtube";
import { deleteInstagramMedia } from "@/lib/social/instagram";
import { deleteFacebookVideo, getFreshFacebookToken } from "@/lib/social/facebook";
import { decrypt } from "@/lib/social/encrypt";

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

    let platforms: string[] | undefined;
    try {
      const body = await req.json();
      if (Array.isArray(body.platforms) && body.platforms.length > 0) {
        platforms = body.platforms;
      }
    } catch {
      // empty body = delete from all
    }

    const rawPosted = (video.postedPlatforms ?? []) as (string | PlatformEntry)[];
    const entries: PlatformEntry[] = rawPosted.map((p) => {
      if (typeof p === "string") return { platform: p, success: true as const };
      if (p.success === undefined && (p.postId || p.url)) return { ...p, success: true as const };
      return p;
    });

    const isActionable = (e: PlatformEntry) =>
      e.success === true || e.success === "scheduled";

    const toDelete = platforms
      ? entries.filter((e) => platforms!.includes(e.platform) && isActionable(e))
      : entries.filter((e) => isActionable(e));

    if (toDelete.length === 0) {
      return NextResponse.json({ error: "No posted content found to delete" }, { status: 400 });
    }

    const accounts = video.series.user.socialAccounts;
    const results: { platform: string; success: boolean; error?: string }[] = [];

    for (const entry of toDelete) {
      if (!entry.postId) {
        // Deferred schedule with no platform content (e.g. Instagram deferred)
        results.push({ platform: entry.platform, success: true });
        continue;
      }
      const postId = entry.postId;
      try {
        if (entry.platform === "YOUTUBE") {
          const ytAccount = accounts.find((a) => a.platform === "YOUTUBE");
          if (!ytAccount?.accessTokenEnc) {
            results.push({ platform: "YOUTUBE", success: false, error: "No YouTube account connected" });
            continue;
          }
          const accessToken = decrypt(ytAccount.accessTokenEnc);
          const refreshToken = ytAccount.refreshTokenEnc ? decrypt(ytAccount.refreshTokenEnc) : null;
          const res = await deleteYouTubeVideo(accessToken, refreshToken, postId, ytAccount.platformUserId, video.series.userId);
          results.push({ platform: "YOUTUBE", ...res });
        } else if (entry.platform === "INSTAGRAM") {
          const igAccount = accounts.find((a) => a.platform === "INSTAGRAM");
          if (!igAccount?.accessTokenEnc) {
            results.push({ platform: "INSTAGRAM", success: false, error: "No Instagram account connected. Reconnect in Channels." });
            continue;
          }
          let accessToken = decrypt(igAccount.accessTokenEnc);
          if (igAccount.refreshTokenEnc && igAccount.pageId) {
            try {
              accessToken = await getFreshFacebookToken(igAccount.id, accessToken, igAccount.refreshTokenEnc, igAccount.pageId, igAccount.tokenExpiresAt);
            } catch { /* use stored token */ }
          }
          const res = await deleteInstagramMedia(postId, accessToken);
          results.push({ platform: "INSTAGRAM", ...res });
        } else if (entry.platform === "FACEBOOK") {
          const fbAccount = accounts.find((a) => a.platform === "FACEBOOK");
          if (!fbAccount?.accessTokenEnc) {
            results.push({ platform: "FACEBOOK", success: false, error: "No Facebook account connected. Reconnect in Channels." });
            continue;
          }
          let pageToken = decrypt(fbAccount.accessTokenEnc);
          if (fbAccount.refreshTokenEnc && fbAccount.pageId) {
            try {
              pageToken = await getFreshFacebookToken(fbAccount.id, pageToken, fbAccount.refreshTokenEnc, fbAccount.pageId, fbAccount.tokenExpiresAt);
            } catch { /* use stored token */ }
          }
          const res = await deleteFacebookVideo(postId, pageToken);
          results.push({ platform: "FACEBOOK", ...res });
        } else {
          results.push({ platform: entry.platform, success: false, error: "Unsupported platform" });
        }
      } catch (err) {
        results.push({ platform: entry.platform, success: false, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    const NOT_FOUND_PATTERNS = ["cannot be found", "not found", "does not exist", "not exist"];
    const updatedPosted = entries.map((e) => {
      const result = results.find((r) => r.platform === e.platform);
      if (!result) return e;
      const errLower = (result.error ?? "").toLowerCase();
      const isNotFound = NOT_FOUND_PATTERNS.some((p) => errLower.includes(p));
      if (result.success || isNotFound) {
        return { ...e, success: "deleted" as const, deletedAt: new Date().toISOString() };
      }
      if (e.success === "scheduled") {
        return { ...e, success: "deleted" as const, deletedAt: new Date().toISOString() };
      }
      return e;
    });

    const stillPosted = updatedPosted.filter(
      (e) => e.success === true || e.success === "uploading" || e.success === "scheduled",
    );

    const deletedPlatforms = new Set(
      updatedPosted.filter((e) => e.success === "deleted").map((e) => e.platform),
    );
    const currentScheduled = (video.scheduledPlatforms ?? []) as string[];
    const newScheduled = currentScheduled.filter((p) => !deletedPlatforms.has(p));

    await db.video.update({
      where: { id },
      data: {
        postedPlatforms: updatedPosted as never,
        scheduledPlatforms: newScheduled,
        scheduledPostTime: newScheduled.length > 0 ? video.scheduledPostTime : (stillPosted.length > 0 ? video.scheduledPostTime : null),
        status: stillPosted.length > 0 ? video.status : "READY",
      },
    });

    return NextResponse.json({ success: true, results, postedPlatforms: updatedPosted });
  } catch (error) {
    console.error("Delete from platform error:", error);
    return NextResponse.json(
      { error: "Failed to delete from platform" },
      { status: 500 },
    );
  }
}
