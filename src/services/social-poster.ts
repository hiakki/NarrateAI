import { PrismaClient, Platform } from "@prisma/client";
import { decrypt } from "@/lib/social/encrypt";
import { postInstagramReel, postInstagramComment } from "@/lib/social/instagram";
import { postFacebookReel, postFacebookComment } from "@/lib/social/facebook";
import { uploadYouTubeShort, postYouTubeComment } from "@/lib/social/youtube";
import { generateVideoSEO, generateInstagramCaption, generateFacebookCaption, generateFirstComment } from "@/lib/social/seo";
import { createLogger } from "@/lib/logger";
import path from "path";

const log = createLogger("SocialPoster");

const db = new PrismaClient();

interface PostResult {
  platform: string;
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

interface PlatformEntry {
  platform: string;
  success?: boolean | "uploading";
  postId?: string | null;
  url?: string | null;
  error?: string;
  startedAt?: number;
}

const STALE_UPLOAD_MS = 10 * 60 * 1000; // 10 minutes
const POST_COOLDOWN_MS = 10_000; // wait after video becomes READY before posting
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10_000;
const PLATFORM_POST_GAP_MINUTES = parseInt(process.env.PLATFORM_POST_GAP_MINUTES ?? "60", 10);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function entryIsSuccessful(entry: string | PlatformEntry, platform: string): boolean {
  if (typeof entry === "string") return entry === platform;
  if (entry.platform !== platform) return false;
  if (entry.success === true) return true;
  return entry.success === undefined && !!(entry.postId || entry.url);
}

async function getLatestPlatformSuccessTime(
  userId: string,
  platform: string,
  excludeVideoId: string,
): Promise<Date | null> {
  // Look back 48h for recent success entries; enough for cooldown checks.
  const recent = await db.video.findMany({
    where: {
      id: { not: excludeVideoId },
      updatedAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      series: { userId },
    },
    select: { id: true, updatedAt: true, postedPlatforms: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  for (const v of recent) {
    const entries = (v.postedPlatforms ?? []) as (string | PlatformEntry)[];
    if (entries.some((e) => entryIsSuccessful(e, platform))) {
      return v.updatedAt;
    }
  }
  return null;
}

/**
 * Read platform entries from DB. Returns the full entry map.
 */
async function getPlatformEntries(videoId: string): Promise<Map<string, PlatformEntry>> {
  const row = await db.video.findUnique({
    where: { id: videoId },
    select: { postedPlatforms: true },
  });
  const raw = (row?.postedPlatforms ?? []) as (string | PlatformEntry)[];
  const map = new Map<string, PlatformEntry>();
  for (const p of raw) {
    if (typeof p === "string") {
      map.set(p, { platform: p, success: true });
    } else {
      const entry = { ...p };
      if (entry.success === undefined && (entry.postId || entry.url)) {
        entry.success = true;
      }
      map.set(entry.platform, entry);
    }
  }
  return map;
}

/**
 * Check if a platform should be skipped (already posted or currently uploading).
 */
function shouldSkip(entry: PlatformEntry | undefined): { skip: boolean; reason: string } {
  if (!entry) return { skip: false, reason: "" };

  if (entry.success === true) {
    return { skip: true, reason: "already posted" };
  }

  if (entry.success === "uploading") {
    const age = Date.now() - (entry.startedAt ?? 0);
    if (age < STALE_UPLOAD_MS) {
      return { skip: true, reason: `upload in progress (${Math.round(age / 1000)}s ago)` };
    }
    // Stale upload — treat as failed, allow retry
    return { skip: false, reason: "" };
  }

  // success === false → failed, allow retry
  return { skip: false, reason: "" };
}

/**
 * Atomically claim a platform for uploading by writing an "uploading" entry.
 * Returns true if the claim succeeded, false if someone else got there first.
 */
async function claimPlatform(videoId: string, platform: string): Promise<boolean> {
  const entries = await getPlatformEntries(videoId);
  const existing = entries.get(platform);
  const { skip, reason } = shouldSkip(existing);

  if (skip) {
    log.log(`Claim denied for ${platform} on ${videoId}: ${reason}`);
    return false;
  }

  // Write "uploading" marker to DB
  const allEntries = [...entries.values()].filter((e) => e.platform !== platform);
  const uploadingEntry: PlatformEntry = {
    platform,
    success: "uploading",
    startedAt: Date.now(),
  };
  allEntries.push(uploadingEntry);

  await db.video.update({
    where: { id: videoId },
    data: { postedPlatforms: allEntries },
  });

  log.log(`Claimed ${platform} for ${videoId} (uploading)`);
  return true;
}

/**
 * Finalize a platform result (success or failure), replacing the "uploading" entry.
 */
async function finalizePlatform(
  videoId: string,
  entry:
    | { platform: string; success: true; postId: string | null; url: string | null }
    | { platform: string; success: false; error: string },
) {
  try {
    const entries = await getPlatformEntries(videoId);
    const filtered = [...entries.values()].filter((e) => e.platform !== entry.platform);
    filtered.push(entry as PlatformEntry);

    const hasAnySuccess = filtered.some((e) => e.success === true);

    log.log(`Finalizing ${entry.platform} for ${videoId}: ${JSON.stringify(entry)} | saving ${filtered.length} entries`);

    await db.video.update({
      where: { id: videoId },
      data: {
        postedPlatforms: filtered,
        ...(hasAnySuccess ? { status: "POSTED" } : {}),
      },
    });

    const verify = await db.video.findUnique({
      where: { id: videoId },
      select: { postedPlatforms: true },
    });
    log.log(`Verified ${videoId} postedPlatforms: ${JSON.stringify(verify?.postedPlatforms)}`);
  } catch (e) {
    log.error(`Failed to finalize ${entry.platform} for ${videoId}:`, e);
  }
}

const PLATFORM_URLS: Record<string, (id: string) => string> = {
  YOUTUBE: (pid) => `https://youtube.com/shorts/${pid}`,
  FACEBOOK: (pid) => `https://www.facebook.com/reel/${pid}`,
};

export async function postVideoToSocials(
  videoId: string,
  platformOverride?: string[],
): Promise<PostResult[]> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    include: {
      series: {
        include: {
          automation: { select: { targetPlatforms: true, includeAiTags: true } },
          user: {
            include: { socialAccounts: true },
          },
        },
      },
    },
  });

  if (!video || !video.videoUrl) {
    log.log(`Skipping ${videoId}: no video URL`);
    return [];
  }

  if (!["READY", "POSTED"].includes(video.status)) {
    log.log(`Skipping ${videoId}: status is ${video.status}`);
    return [];
  }

  // Wait if the video just became READY to let file I/O settle
  const age = Date.now() - new Date(video.updatedAt).getTime();
  if (age < POST_COOLDOWN_MS) {
    const wait = POST_COOLDOWN_MS - age;
    log.log(`Video ${videoId} became ready ${Math.round(age / 1000)}s ago, waiting ${Math.round(wait / 1000)}s before posting`);
    await sleep(wait);
  }

  const targetPlatforms = platformOverride
    ?? (video.series.automation?.targetPlatforms as string[])
    ?? [];
  if (targetPlatforms.length === 0) {
    log.log(`No target platforms for video ${videoId}`);
    return [];
  }

  const videoPath = path.join(process.cwd(), "public", (video.videoUrl ?? "").replace(/^\//, ""));
  const nicheId = video.series.niche ?? "";
  const title = video.title ?? "Check this out!";
  const scriptText = video.scriptText ?? undefined;
  const includeAiTags = video.series.automation?.includeAiTags ?? true;

  let previousYtUrl: string | undefined;
  if (targetPlatforms.includes("YOUTUBE")) {
    try {
      const prevVideo = await db.video.findFirst({
        where: {
          seriesId: video.seriesId,
          id: { not: videoId },
          status: "POSTED",
        },
        orderBy: { createdAt: "desc" },
        select: { postedPlatforms: true },
      });
      if (prevVideo) {
        const entries = (prevVideo.postedPlatforms ?? []) as PlatformEntry[];
        const ytEntry = entries.find((e) => e.platform === "YOUTUBE" && e.success === true);
        if (ytEntry?.url) {
          previousYtUrl = ytEntry.url;
        } else if (ytEntry?.postId) {
          previousYtUrl = `https://youtube.com/shorts/${ytEntry.postId}`;
        }
      }
    } catch (e) {
      log.warn("Failed to look up previous YT video:", e);
    }
  }

  const ytSeo = generateVideoSEO(title, nicheId, scriptText, includeAiTags, previousYtUrl);
  const igCaption = generateInstagramCaption(title, nicheId, scriptText, includeAiTags);
  const fbCaption = generateFacebookCaption(title, nicheId, scriptText, includeAiTags);
  const firstComment = generateFirstComment(nicheId, scriptText);

  // Post to all platforms in parallel
  async function postToPlatform(platform: string): Promise<PostResult> {
    const claimed = await claimPlatform(videoId, platform);
    if (!claimed) {
      return { platform, success: true, postId: "already-handled" };
    }

    const accounts = video!.series.user.socialAccounts.filter(
      (a) => a.platform === platform,
    );

    if (accounts.length === 0) {
      await finalizePlatform(videoId, {
        platform, success: false, error: "No connected account",
      });
      return { platform, success: false, error: "No connected account" };
    }

    // Enforce minimum gap between successful posts per platform per user.
    const gapMs = Math.max(0, PLATFORM_POST_GAP_MINUTES) * 60 * 1000;
    if (gapMs > 0) {
      const latestSuccessAt = await getLatestPlatformSuccessTime(
        video.series.user.id,
        platform,
        videoId,
      );
      if (latestSuccessAt) {
        const elapsedMs = Date.now() - latestSuccessAt.getTime();
        if (elapsedMs < gapMs) {
          const remainingMin = Math.ceil((gapMs - elapsedMs) / 60000);
          const msg = `Platform cooldown active: wait ~${remainingMin}m before next ${platform} post`;
          log.warn(`${msg} (video=${videoId})`);
          await finalizePlatform(videoId, { platform, success: false, error: msg });
          return { platform, success: false, error: msg };
        }
      }
    }

    for (const account of accounts) {
      const accessToken = decrypt(account.accessTokenEnc);
      const refreshToken = account.refreshTokenEnc
        ? decrypt(account.refreshTokenEnc)
        : null;

      let lastResult: { success: boolean; postId?: string; postUrl?: string; error?: string } | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          switch (platform) {
            case "INSTAGRAM":
              lastResult = await postInstagramReel(
                account.platformUserId,
                accessToken,
                videoPath,
                igCaption,
                refreshToken,
                account.pageId,
              );
              break;

            case "FACEBOOK":
              lastResult = await postFacebookReel(
                account.pageId ?? account.platformUserId,
                accessToken,
                videoPath,
                fbCaption,
              );
              break;

            case "YOUTUBE":
              lastResult = await uploadYouTubeShort(
                accessToken,
                refreshToken,
                videoPath,
                ytSeo.title,
                ytSeo.description,
                ytSeo.tags,
                account.platformUserId,
                video!.series.user.id,
                ytSeo.categoryId,
              );
              break;

            default:
              lastResult = { success: false, error: `Unsupported platform: ${platform}` };
          }
        } catch (e) {
          lastResult = { success: false, error: e instanceof Error ? e.message : "Unknown error" };
        }

        if (lastResult?.success) {
          log.log(`Posted to ${platform} (${account.username}) on attempt ${attempt}: ${lastResult.postId}`);
          break;
        }

        if (attempt < MAX_RETRIES) {
          log.warn(`Attempt ${attempt}/${MAX_RETRIES} failed for ${platform} (${account.username}): ${lastResult?.error}. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await sleep(RETRY_DELAY_MS);
        } else {
          log.error(`All ${MAX_RETRIES} attempts failed for ${platform} (${account.username}): ${lastResult?.error}`);
        }
      }

      const result = lastResult!;

      if (result.success) {
        const url = result.postUrl
          ?? (result.postId && PLATFORM_URLS[platform]
            ? PLATFORM_URLS[platform](result.postId)
            : null);
        await finalizePlatform(videoId, {
          platform, success: true, postId: result.postId ?? null, url: url ?? null,
        });

        if (result.postId) {
          void (async () => {
            try {
              // Do not block platform posting completion; comments run best-effort in parallel.
              await sleep(3000);
              switch (platform) {
                case "INSTAGRAM":
                  await postInstagramComment(result.postId, accessToken, firstComment.ig);
                  break;
                case "FACEBOOK":
                  await postFacebookComment(result.postId, accessToken, firstComment.fb);
                  break;
                case "YOUTUBE":
                  await postYouTubeComment(
                    accessToken,
                    refreshToken,
                    result.postId,
                    firstComment.yt,
                    account.platformUserId,
                    video!.series.user.id,
                  );
                  break;
              }
            } catch (e) {
              log.warn(`First comment failed for ${platform} (${result.postId}):`, e);
            }
          })();
        }
      } else {
        await finalizePlatform(videoId, {
          platform, success: false, error: result.error ?? "Unknown error",
        });
      }

      return { platform, ...result };
    }

    return { platform, success: false, error: "No accounts processed" };
  }

  log.log(`Posting video ${videoId} to ${targetPlatforms.join(", ")} in parallel`);
  const settled = await Promise.allSettled(targetPlatforms.map(postToPlatform));

  const results: PostResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    log.error(`Platform ${targetPlatforms[i]} threw:`, s.reason);
    return { platform: targetPlatforms[i], success: false, error: String(s.reason) };
  });

  return results;
}
