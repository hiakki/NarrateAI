import { PrismaClient, Platform } from "@prisma/client";
import { decrypt } from "@/lib/social/encrypt";
import { postInstagramReel } from "@/lib/social/instagram";
import { postFacebookReel } from "@/lib/social/facebook";
import { uploadYouTubeShort } from "@/lib/social/youtube";
import { generateVideoSEO, generateSocialCaption } from "@/lib/social/seo";
import path from "path";

const db = new PrismaClient();

interface PostResult {
  platform: string;
  success: boolean;
  postId?: string;
  error?: string;
}

export async function postVideoToSocials(videoId: string): Promise<PostResult[]> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    include: {
      series: {
        include: {
          automation: { select: { targetPlatforms: true } },
          user: {
            include: { socialAccounts: true },
          },
        },
      },
    },
  });

  if (!video || video.status !== "READY" || !video.videoUrl) {
    console.log(`[SocialPoster] Skipping ${videoId}: not ready or no video URL`);
    return [];
  }

  const targetPlatforms = (video.series.automation?.targetPlatforms as string[]) ?? [];
  if (targetPlatforms.length === 0) {
    console.log(`[SocialPoster] No target platforms for series ${video.seriesId}`);
    return [];
  }

  const videoPath = path.join(process.cwd(), "public", "videos", `${videoId}.mp4`);
  const nicheId = video.series.niche ?? "";
  const title = video.title ?? "Check this out!";
  const ytSeo = generateVideoSEO(title, nicheId, video.scriptText ?? undefined);
  const socialCaption = generateSocialCaption(title, nicheId, video.scriptText ?? undefined);

  const results: PostResult[] = [];

  for (const platform of targetPlatforms) {
    const accounts = video.series.user.socialAccounts.filter(
      (a) => a.platform === platform,
    );

    if (accounts.length === 0) {
      results.push({
        platform,
        success: false,
        error: "No connected account",
      });
      continue;
    }

    for (const account of accounts) {
      try {
        const accessToken = decrypt(account.accessTokenEnc);
        const refreshToken = account.refreshTokenEnc
          ? decrypt(account.refreshTokenEnc)
          : null;

        let result: { success: boolean; postId?: string; error?: string };

        switch (platform) {
          case "INSTAGRAM":
            result = await postInstagramReel(
              account.platformUserId,
              accessToken,
              videoPath,
              socialCaption,
            );
            break;

          case "FACEBOOK":
            result = await postFacebookReel(
              account.pageId ?? account.platformUserId,
              accessToken,
              videoPath,
              socialCaption,
            );
            break;

          case "YOUTUBE":
            result = await uploadYouTubeShort(
              accessToken,
              refreshToken,
              videoPath,
              ytSeo.title,
              ytSeo.description,
              ytSeo.tags,
              account.platformUserId,
              video.series.user.id,
              ytSeo.categoryId,
            );
            break;

          default:
            result = { success: false, error: `Unsupported platform: ${platform}` };
        }

        results.push({ platform, ...result });

        if (result.success) {
          console.log(
            `[SocialPoster] Posted to ${platform} (${account.username}): ${result.postId}`,
          );
        } else {
          console.error(
            `[SocialPoster] Failed to post to ${platform} (${account.username}): ${result.error}`,
          );
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        console.error(`[SocialPoster] Error posting to ${platform}:`, error);
        results.push({ platform, success: false, error });
      }
    }
  }

  const PLATFORM_URLS: Record<string, (id: string) => string> = {
    YOUTUBE: (pid) => `https://youtube.com/shorts/${pid}`,
    INSTAGRAM: (pid) => `https://www.instagram.com/reel/${pid}/`,
    FACEBOOK: (pid) => `https://www.facebook.com/reel/${pid}`,
  };

  const newEntries = results
    .filter((r) => r.success)
    .map((r) => ({
      platform: r.platform,
      postId: r.postId ?? null,
      url: r.postId && PLATFORM_URLS[r.platform]
        ? PLATFORM_URLS[r.platform](r.postId)
        : null,
    }));

  if (newEntries.length > 0) {
    const existing = (video.postedPlatforms as { platform: string }[]) ?? [];
    const existingPlatforms = new Set(existing.map((e) => e.platform));
    const merged = [
      ...existing,
      ...newEntries.filter((e) => !existingPlatforms.has(e.platform)),
    ];
    await db.video.update({
      where: { id: videoId },
      data: {
        postedPlatforms: merged,
        status: "POSTED",
      },
    });
  }

  return results;
}
