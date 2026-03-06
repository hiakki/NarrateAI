/**
 * Debug route: call Meta APIs for FB/IG video/reel and return raw responses.
 * GET /api/insights/test-responses (auth required)
 * Optional: ?videoId=xxx to use that video's posted FB/IG links instead of default test IDs.
 * Without videoId uses hardcoded test links (FB reel 769423079574206, IG DVQO3ahiL-L).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/social/encrypt";
import { parsePostedPlatforms } from "@/services/insights";
import { getInstagramMediaIdFromShortcode } from "@/lib/social/instagram";

const GRAPH = "https://graph.facebook.com/v21.0";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized", hint: "Log in at /dashboard (or sign in) and open this URL again in the same browser." },
        { status: 401 },
      );
    }

    const videoId = req.nextUrl.searchParams.get("videoId")?.trim() || null;

    let fbPostId: string | null = "769423079574206";
    let igPostId: string | null = "DVQO3ahiL-L"; // shortcode

    if (videoId) {
      const video = await db.video.findUnique({
        where: { id: videoId },
        select: { id: true, postedPlatforms: true, series: { select: { userId: true } } },
      });
      if (!video) {
        return NextResponse.json(
          { error: "Video not found", videoId },
          { status: 404 },
        );
      }
      if (video.series.userId !== session.user.id) {
        return NextResponse.json(
          { error: "Forbidden", hint: "Video must belong to you." },
          { status: 403 },
        );
      }
      const parsed = parsePostedPlatforms(video.postedPlatforms);
      fbPostId = parsed.get("FACEBOOK") ?? null;
      igPostId = parsed.get("INSTAGRAM") ?? null;
      if (!fbPostId && !igPostId) {
        return NextResponse.json({
          data: {},
          meta: {
            loggedInAs: session?.user?.email ?? session?.user?.id,
            videoId,
            hint: "This video has no Facebook or Instagram link in postedPlatforms. Add the FB/IG link on the video page and try again.",
            postedPlatforms: video.postedPlatforms,
            parsedPostIds: Object.fromEntries(parsed),
          },
        });
      }
    }

    const accounts = await db.socialAccount.findMany({
      where: { userId: session.user.id, platform: { in: ["FACEBOOK", "INSTAGRAM"] } },
      select: {
        platform: true,
        platformUserId: true,
        pageId: true,
        accessTokenEnc: true,
      },
    });

    const fbAccount = accounts.find((a) => a.platform === "FACEBOOK");
    const igAccount = accounts.find((a) => a.platform === "INSTAGRAM");

    const out: {
      facebook?: {
        videoNode?: unknown;
        videoNodeError?: string;
        videoInsightsTotalViews?: unknown;
        videoInsightsReelsPlays?: unknown;
        insightsError?: string;
        postIdUsed?: string | null;
      };
      instagram?: {
        mediaList?: unknown;
        mediaListError?: string;
        mediaNode?: unknown;
        mediaNodeError?: string;
        mediaInsights?: unknown;
        mediaInsightsError?: string;
        resolvedMediaId?: string;
        postIdUsed?: string | null;
      };
    } = {};

    // Facebook
    if (fbAccount?.accessTokenEnc && fbPostId) {
      try {
        let token: string | undefined;
        try {
          token = decrypt(fbAccount.accessTokenEnc);
        } catch (decErr) {
          out.facebook = { insightsError: decErr instanceof Error ? decErr.message : String(decErr) };
        }
        if (typeof token === "string") {
          out.facebook = { postIdUsed: fbPostId };
          const videoRes = await fetch(
            `${GRAPH}/${fbPostId}?fields=comments.summary(total_count),likes.summary(total_count)&access_token=${encodeURIComponent(token)}`,
          );
          out.facebook.videoNode = await videoRes.json().catch(async () => ({ _raw: await videoRes.text() }));

          const ins1 = await fetch(
            `${GRAPH}/${fbPostId}/video_insights?metric=total_video_views&period=lifetime&access_token=${encodeURIComponent(token)}`,
          );
          out.facebook.videoInsightsTotalViews = await ins1.json().catch(async () => ({ _raw: await ins1.text() }));

          const ins2 = await fetch(
            `${GRAPH}/${fbPostId}/video_insights?metric=fb_reels_total_plays&period=lifetime&access_token=${encodeURIComponent(token)}`,
          );
          out.facebook.videoInsightsReelsPlays = await ins2.json().catch(async () => ({ _raw: await ins2.text() }));
        }
      } catch (e) {
        out.facebook = out.facebook ?? {};
        out.facebook.insightsError = e instanceof Error ? e.message : String(e);
      }
    } else if (videoId && !fbPostId) {
      out.facebook = { postIdUsed: null, videoNodeError: "No Facebook link for this video." };
    }

    // Instagram: resolve shortcode to media ID if needed, then get media + insights
    if (igAccount?.accessTokenEnc && igAccount.platformUserId && igPostId) {
      try {
        let token: string | undefined;
        try {
          token = decrypt(igAccount.accessTokenEnc);
        } catch (decErr) {
          out.instagram = { mediaInsightsError: decErr instanceof Error ? decErr.message : String(decErr) };
        }
        if (typeof token === "string") {
          out.instagram = out.instagram ?? { postIdUsed: igPostId };
          const listRes = await fetch(
            `${GRAPH}/${igAccount.platformUserId}/media?fields=id,permalink&limit=50&access_token=${encodeURIComponent(token)}`,
          );
          const listJson = await listRes.json().catch(() => null);
          out.instagram.mediaList = listJson;
          if (listJson?.error) {
            out.instagram.mediaListError = listJson.error.message;
          } else {
            const shortcodeLike = /^[A-Za-z0-9_-]+$/.test(igPostId) && !/^\d+$/.test(igPostId);
            const mediaId = shortcodeLike
              ? await getInstagramMediaIdFromShortcode(token, igAccount.platformUserId, igPostId)
              : igPostId;
            if (mediaId) {
              out.instagram.resolvedMediaId = mediaId;
              const mediaRes = await fetch(
                `${GRAPH}/${mediaId}?fields=like_count,comments_count&access_token=${encodeURIComponent(token)}`,
              );
              out.instagram.mediaNode = await mediaRes.json().catch(() => null);

              const insightsRes = await fetch(
                `${GRAPH}/${mediaId}/insights?metric=views&period=lifetime&access_token=${encodeURIComponent(token)}`,
              );
              out.instagram.mediaInsights = await insightsRes.json().catch(() => null);
              if ((out.instagram.mediaInsights as { error?: { message?: string } })?.error) {
                out.instagram.mediaInsightsError = (out.instagram.mediaInsights as { error: { message: string } }).error.message;
              }
            } else {
              out.instagram.mediaNodeError = "Could not resolve shortcode to media ID.";
            }
          }
        }
      } catch (e) {
        out.instagram = out.instagram ?? {};
        out.instagram.mediaInsightsError = e instanceof Error ? e.message : String(e);
      }
    } else if (videoId && !igPostId) {
      out.instagram = { postIdUsed: null, mediaNodeError: "No Instagram link for this video." };
    }

    const hasFb = !!fbAccount;
    const hasIg = !!igAccount;

    // Build a short summary so the user sees what we got and why views may be missing
    const summary: { instagram?: string; facebook?: string } = {};
    const igData = out.instagram;
    if (igData?.mediaNode && typeof igData.mediaNode === "object") {
      const node = igData.mediaNode as { like_count?: number; comments_count?: number };
      const likes = node.like_count ?? 0;
      const comments = node.comments_count ?? 0;
      if (igData.mediaInsightsError) {
        summary.instagram = `Likes: ${likes}, Comments: ${comments} (from API). Views: blocked — ${igData.mediaInsightsError}. To get views: reconnect Instagram in Dashboard → Channels and ensure the app has "Instagram Manage Insights" permission.`;
      } else {
        const views = (igData.mediaInsights as { data?: { total_value?: { value?: number } }[] })?.data?.[0]?.total_value?.value ?? 0;
        summary.instagram = `Likes: ${likes}, Comments: ${comments}, Views: ${views}.`;
      }
    } else if (igData?.mediaInsightsError) {
      summary.instagram = `Views (and possibly media): ${igData.mediaInsightsError}. Reconnect Instagram with "Instagram Manage Insights" permission.`;
    }
    if (out.facebook?.videoNode && typeof out.facebook.videoNode === "object" && !(out.facebook.videoNode as { error?: unknown }).error) {
      const node = out.facebook.videoNode as { likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } };
      const reactions = node.likes?.summary?.total_count ?? 0;
      const comments = node.comments?.summary?.total_count ?? 0;
      summary.facebook = `Reactions: ${reactions}, Comments: ${comments}.`;
    } else if (out.facebook?.insightsError || (out.facebook?.videoInsightsTotalViews as { error?: { message?: string } })?.error) {
      summary.facebook = "Views require read_insights. Reconnect Facebook in Dashboard → Channels with Page Insights permission.";
    }

    return NextResponse.json({
      data: out,
      summary,
      meta: {
        loggedInAs: session?.user?.email ?? session?.user?.id,
        facebookConnected: hasFb,
        instagramConnected: hasIg,
        ...(videoId && { videoId, fbPostId, igPostId }),
        hint: !hasFb && !hasIg ? "Connect Facebook and/or Instagram in Dashboard → Channels, then try again." : undefined,
      },
    });
  } catch (error) {
    console.error("Test responses error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed",
        hint: "Check server logs. If decrypt failed, set SOCIAL_TOKEN_SECRET in .env (same value used when tokens were saved).",
      },
      { status: 500 },
    );
  }
}
