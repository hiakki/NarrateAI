/**
 * Fetches and persists video/account insights from YouTube, Instagram, Facebook.
 * Updates Video.insights, Video.insightsRefreshedAt and SocialAccount.metrics, SocialAccount.metricsRefreshedAt.
 */

import { PrismaClient } from "@prisma/client";
import { decrypt } from "@/lib/social/encrypt";
import {
  getYouTubeVideoStatistics,
  getYouTubeChannelSubscribers,
} from "@/lib/social/youtube";
import {
  getInstagramMediaIdFromShortcode,
  getInstagramMediaMetrics,
  getInstagramProfileFollowers,
} from "@/lib/social/instagram";
import {
  getFacebookVideoInsights,
  getFacebookPageFollowers,
} from "@/lib/social/facebook";
import { createLogger } from "@/lib/logger";

const log = createLogger("Insights");
const db = new PrismaClient();

interface PlatformEntry {
  platform: string;
  success?: boolean | "uploading";
  postId?: string | null;
  url?: string | null;
}

export interface VideoInsightPlatform {
  views?: number;
  likes?: number;
  comments?: number;
  reactions?: number;
}

export type VideoInsightsMap = Record<string, VideoInsightPlatform>;

/** Extract post ID from platform URL when postId was not stored (e.g. manual link). */
function postIdFromUrl(platform: string, url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const u = url.trim();
  if (platform === "YOUTUBE") {
    const m = u.match(/shorts\/([a-zA-Z0-9_-]+)/) ?? u.match(/[?&]v=([a-zA-Z0-9_-]+)/) ?? u.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }
  if (platform === "FACEBOOK") {
    const m = u.match(/facebook\.com\/reel\/(\d+)/i)
      ?? u.match(/fb\.watch\/(\d+)/i)
      ?? u.match(/reel\/(\d+)/i)
      ?? u.match(/\/videos?\/(\d+)/i);
    return m ? m[1] : null;
  }
  if (platform === "INSTAGRAM") {
    const m = u.match(/instagram\.com\/reels?\/([^/?]+)/i) ?? u.match(/instagram\.com\/p\/([^/?]+)/i);
    return m ? m[1].replace(/\/$/, "") : null;
  }
  return null;
}

export function parsePostedPlatforms(raw: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const arr = Array.isArray(raw) ? raw : [];
  for (const p of arr) {
    if (typeof p === "string") continue;
    const e = p as PlatformEntry;
    const platform = e?.platform;
    let postId = e?.postId ?? null;
    if (!postId && e?.url) postId = postIdFromUrl(platform, e.url as string);
    if (platform && postId) map.set(platform, String(postId));
  }
  return map;
}

/**
 * Refresh insights for the given user: all posted videos and account metrics.
 * Optionally limit to specific videoIds or automationId (that automation's series videos).
 */
export async function refreshInsightsForUser(
  userId: string,
  options?: { videoIds?: string[]; automationId?: string },
): Promise<{ refreshedAt: Date; videoCount: number; errors: string[] }> {
  const errors: string[] = [];
  const refreshedAt = new Date();

  const whereClause: { series: { userId: string; id?: string }; status?: "POSTED"; id?: { in: string[] } } = {
    series: { userId },
  };
  if (options?.videoIds?.length) {
    whereClause.id = { in: options.videoIds };
    // When refreshing specific videos (e.g. from video detail page), include them even if not POSTED (e.g. manual links added)
  } else if (options?.automationId) {
    const auto = await db.automation.findFirst({
      where: { id: options.automationId, userId },
      select: { seriesId: true },
    });
    if (!auto?.seriesId) {
      return { refreshedAt, videoCount: 0, errors: ["Automation or series not found"] };
    }
    whereClause.series = { userId, id: auto.seriesId };
    whereClause.status = "POSTED";
  } else {
    whereClause.status = "POSTED";
  }

  const videos = await db.video.findMany({
    where: whereClause as never,
    select: { id: true, postedPlatforms: true, insights: true },
  });

  const accounts = await db.socialAccount.findMany({
    where: { userId },
    select: {
      id: true,
      platform: true,
      platformUserId: true,
      pageId: true,
      accessTokenEnc: true,
      refreshTokenEnc: true,
      metricsBaseline: true,
    },
  });

  const accountByPlatform = new Map(accounts.map((a) => [a.platform, a]));

  // Build per-platform lists: platform -> [ { videoId, postId } ]
  const ytList: { videoId: string; postId: string }[] = [];
  const igList: { videoId: string; postId: string }[] = [];
  const fbList: { videoId: string; postId: string }[] = [];

  for (const v of videos) {
    const postIds = parsePostedPlatforms(v.postedPlatforms);
    for (const [platform, postId] of postIds) {
      if (platform === "YOUTUBE") ytList.push({ videoId: v.id, postId });
      else if (platform === "INSTAGRAM") igList.push({ videoId: v.id, postId });
      else if (platform === "FACEBOOK") fbList.push({ videoId: v.id, postId });
    }
  }

  // Fetch YouTube video stats and channel subscribers
  const ytAccount = accountByPlatform.get("YOUTUBE");
  const ytStatsByPostId: Record<string, { views: number; likes: number; comments: number }> = {};
  let ytSubscribers = 0;
  if (ytAccount && (ytList.length > 0 || true)) {
    try {
      const accessToken = decrypt(ytAccount.accessTokenEnc);
      const refreshToken = ytAccount.refreshTokenEnc ? decrypt(ytAccount.refreshTokenEnc) : null;
      const postIds = [...new Set(ytList.map((x) => x.postId))];
      const stats = await getYouTubeVideoStatistics(
        accessToken,
        refreshToken,
        postIds,
        ytAccount.platformUserId,
        userId,
      );
      Object.assign(ytStatsByPostId, stats);
      ytSubscribers = await getYouTubeChannelSubscribers(
        accessToken,
        refreshToken,
        ytAccount.platformUserId,
        ytAccount.platformUserId,
        userId,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`YouTube: ${msg}`);
      log.warn("YouTube insights error:", msg);
    }
  }

  // Fetch Instagram media metrics and profile followers (resolve shortcodes from URLs to media IDs)
  const igAccount = accountByPlatform.get("INSTAGRAM");
  const igStatsByPostId: Record<string, { likes: number; comments: number; views: number }> = {};
  let igFollowers = 0;
  if (igAccount && (igList.length > 0 || true)) {
    try {
      const accessToken = decrypt(igAccount.accessTokenEnc);
      const postIds = [...new Set(igList.map((x) => x.postId))];
      const shortcodeLike = (id: string) => /^[A-Za-z0-9_-]+$/.test(id) && !/^\d+$/.test(id);
      const postIdToMediaId = new Map<string, string>();
      for (const pid of postIds) {
        if (shortcodeLike(pid)) {
          const mediaId = await getInstagramMediaIdFromShortcode(accessToken, igAccount.platformUserId, pid);
          if (mediaId) postIdToMediaId.set(pid, mediaId);
          else postIdToMediaId.set(pid, pid);
        } else {
          postIdToMediaId.set(pid, pid);
        }
      }
      const mediaIds = [...new Set(postIds.map((pid) => postIdToMediaId.get(pid) ?? pid))].filter(Boolean);
      if (mediaIds.length > 0) {
        const stats = await getInstagramMediaMetrics(accessToken, mediaIds);
        for (const [postId, mediaId] of postIdToMediaId) {
          if (stats[mediaId]) igStatsByPostId[postId] = stats[mediaId];
        }
      }
      igFollowers = await getInstagramProfileFollowers(accessToken, igAccount.platformUserId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Instagram: ${msg}`);
      log.warn("Instagram insights error:", msg);
    }
  }

  // Fetch Facebook video insights and page followers
  const fbAccount = accountByPlatform.get("FACEBOOK");
  const fbStatsByPostId: Record<string, { views: number; reactions: number; comments: number }> = {};
  let fbFollowers = 0;
  if (fbAccount && (fbList.length > 0 || true)) {
    try {
      const accessToken = decrypt(fbAccount.accessTokenEnc);
      const pageId = fbAccount.pageId ?? fbAccount.platformUserId;
      for (const { postId } of fbList) {
        const ins = await getFacebookVideoInsights(accessToken, postId);
        fbStatsByPostId[postId] = ins;
      }
      fbFollowers = await getFacebookPageFollowers(accessToken, pageId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Facebook: ${msg}`);
      log.warn("Facebook insights error:", msg);
    }
  }

  // Merge into each video's insights
  for (const v of videos) {
    const existing = (v.insights as VideoInsightsMap) ?? {};
    const postIds = parsePostedPlatforms(v.postedPlatforms);
    const next: VideoInsightsMap = { ...existing };

    const ytPostId = postIds.get("YOUTUBE");
    if (ytPostId && ytStatsByPostId[ytPostId]) {
      const s = ytStatsByPostId[ytPostId];
      next.YOUTUBE = { views: s.views, likes: s.likes, comments: s.comments };
    }
    const igPostId = postIds.get("INSTAGRAM");
    if (igPostId && igStatsByPostId[igPostId]) {
      const s = igStatsByPostId[igPostId];
      next.INSTAGRAM = { views: s.views, likes: s.likes, comments: s.comments };
    }
    const fbPostId = postIds.get("FACEBOOK");
    if (fbPostId && fbStatsByPostId[fbPostId]) {
      const s = fbStatsByPostId[fbPostId];
      next.FACEBOOK = { views: s.views, reactions: s.reactions, comments: s.comments };
    }

    await db.video.update({
      where: { id: v.id },
      data: { insights: next as never, insightsRefreshedAt: refreshedAt },
    });
  }

  // Update account metrics (subscribers/followers); set baseline on first run so "gained" is tracked
  const updateAccountMetrics = async (
    account: { id: string; metricsBaseline: unknown },
    metrics: { subscribers?: number; followers?: number },
  ) => {
    const baseline = account.metricsBaseline as { subscribers?: number; followers?: number } | null;
    const hasBaseline = baseline && (typeof baseline.subscribers === "number" || typeof baseline.followers === "number");
    const newBaseline = hasBaseline ? undefined : (metrics as never);
    await db.socialAccount.update({
      where: { id: account.id },
      data: {
        metrics: metrics as never,
        metricsRefreshedAt: refreshedAt,
        ...(newBaseline !== undefined && { metricsBaseline: newBaseline }),
      },
    });
  };
  if (ytAccount && (ytList.length > 0 || ytSubscribers >= 0)) {
    await updateAccountMetrics(ytAccount, { subscribers: ytSubscribers });
  }
  if (igAccount) {
    await updateAccountMetrics(igAccount, { followers: igFollowers });
  }
  if (fbAccount) {
    await updateAccountMetrics(fbAccount, { followers: fbFollowers });
  }

  log.log(`Insights refreshed for user ${userId}: ${videos.length} videos`);
  return { refreshedAt, videoCount: videos.length, errors };
}
