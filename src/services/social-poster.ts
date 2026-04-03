import { PrismaClient } from "@prisma/client";
import { decrypt } from "@/lib/social/encrypt";
import { postInstagramReel } from "@/lib/social/instagram";
import { postFacebookReel, getFreshFacebookToken } from "@/lib/social/facebook";
import { uploadYouTubeShort } from "@/lib/social/youtube";
import { uploadShareChatVideo } from "@/lib/social/sharechat";
import { uploadMojVideo } from "@/lib/social/moj";
import { generateVideoSEO, generateInstagramCaption, generateFacebookCaption } from "@/lib/social/seo";
import { createLogger } from "@/lib/logger";
import type { AutomationFileLogger } from "@/lib/file-logger";
import { deriveVideoStatusFromPlatforms, shouldPromoteVideoToPosted } from "@/lib/video-state";
import { getPlatformEntriesArray, upsertPlatformEntry, type PlatformEntry } from "@/lib/platform-utils";
import path from "path";

const log = createLogger("SocialPoster");

const db = new PrismaClient();

/** Extract user-facing message from API error (e.g. Meta JSON). Log raw to console only. */
function sanitizeErrorForUi(raw: string): string {
  if (!raw || typeof raw !== "string") return "Something went wrong. Try again later.";
  const trimmed = raw.trim();
  if (!trimmed) return "Something went wrong. Try again later.";
  try {
    if ((trimmed.startsWith("{") && trimmed.includes('"error"')) || trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed) as { error?: { message?: string; error_user_msg?: string; code?: number; type?: string }; message?: string };
      const err = parsed?.error;
      console.error("[SocialPoster] API error (raw):", trimmed.length > 1500 ? trimmed.slice(0, 1500) + "…" : trimmed);

      if (err?.code === 190 || err?.type === "OAuthException") {
        return "Token expired or revoked. Please reconnect your account in Channels.";
      }

      const msg = err?.error_user_msg || err?.message || parsed?.message;
      if (typeof msg === "string" && msg.trim()) {
        const lower = msg.toLowerCase();
        if (lower.includes("log in") || lower.includes("expired") || lower.includes("session")) {
          return "Token expired. Please reconnect your account in Channels.";
        }
        return msg.trim();
      }
    }
  } catch {
    // not JSON or no message field
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("expired") || lower.includes("revoked") || lower.includes("log in")) {
    return "Token expired. Please reconnect your account in Channels.";
  }
  return trimmed;
}

interface PostResult {
  platform: string;
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
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
  // Narrow scans to recently posted videos only.
  const recent = await db.video.findMany({
    where: {
      id: { not: excludeVideoId },
      updatedAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      status: "POSTED",
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
  const entries = getPlatformEntriesArray(row?.postedPlatforms);
  return new Map(entries.map((entry) => [entry.platform, entry]));
}

/**
 * Check if a platform should be skipped (already posted or currently uploading).
 */
function shouldSkip(entry: PlatformEntry | undefined): { skip: boolean; reason: string } {
  if (!entry) return { skip: false, reason: "" };

  if (entry.success === true) {
    return { skip: true, reason: "already posted" };
  }

  if (entry.success === "scheduled") {
    return { skip: true, reason: "already scheduled" };
  }

  if (entry.success === "uploading") {
    const age = Date.now() - (entry.startedAt ?? 0);
    if (age < STALE_UPLOAD_MS) {
      return { skip: true, reason: `upload in progress (${Math.round(age / 1000)}s ago)` };
    }
    return { skip: false, reason: "" };
  }

  if (entry.success === "cooldown") {
    if (entry.retryAfter && Date.now() < entry.retryAfter) {
      return { skip: true, reason: `cooldown until ${new Date(entry.retryAfter).toISOString()}` };
    }
    return { skip: false, reason: "" };
  }

  return { skip: false, reason: "" };
}

/**
 * Atomically claim a platform for uploading by writing an "uploading" entry.
 * Returns true if the claim succeeded, false if someone else got there first.
 */
async function claimPlatform(videoId: string, platform: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const row = await tx.video.findUnique({
      where: { id: videoId },
      select: { postedPlatforms: true },
    });
    const entries = getPlatformEntriesArray(row?.postedPlatforms);
    const existing = entries.find((entry) => entry.platform === platform);
    const { skip, reason } = shouldSkip(existing);
    if (skip) {
      log.log(`Claim denied for ${platform} on ${videoId}: ${reason}`);
      return false;
    }

    const next = upsertPlatformEntry(entries, {
      platform,
      success: "uploading",
      startedAt: Date.now(),
    });
    await tx.video.update({
      where: { id: videoId },
      data: { postedPlatforms: next as never },
    });
    log.log(`Claimed ${platform} for ${videoId} (uploading)`);
    return true;
  });
}

/**
 * Finalize a platform result (success or failure), replacing the "uploading" entry.
 */
async function finalizePlatform(
  videoId: string,
  targetPlatforms: string[],
  entry:
    | { platform: string; success: true; postId: string | null; url: string | null }
    | { platform: string; success: false; error: string },
) {
  try {
    await db.$transaction(async (tx) => {
      const row = await tx.video.findUnique({
        where: { id: videoId },
        select: { status: true, postedPlatforms: true },
      });
      if (!row) return;
      const entries = getPlatformEntriesArray(row.postedPlatforms);
      const filtered = upsertPlatformEntry(entries, entry as PlatformEntry);
      const forcePosted = shouldPromoteVideoToPosted(filtered, targetPlatforms);
      const derivedStatus = deriveVideoStatusFromPlatforms(row.status, filtered, targetPlatforms);
      const nextStatus = forcePosted ? "POSTED" : derivedStatus;

      const summary = entry.success
        ? `success postId=${(entry as { postId?: string | null }).postId ?? "?"}`
        : `failed: ${(entry as { error?: string }).error ?? "unknown"}`;
      log.log(`Finalizing ${entry.platform} for ${videoId}: ${summary}`);

      await tx.video.update({
        where: { id: videoId },
        data: {
          postedPlatforms: filtered as never,
          status: nextStatus,
        },
      });
    });
  } catch (e) {
    log.error(`Failed to finalize ${entry.platform} for ${videoId}:`, e);
  }
}

async function finalizePlatformEx(
  videoId: string,
  targetPlatforms: string[],
  entry:
    | { platform: string; success: true | "scheduled"; postId: string | null; url: string | null }
    | { platform: string; success: false; error: string },
) {
  try {
    await db.$transaction(async (tx) => {
      const row = await tx.video.findUnique({
        where: { id: videoId },
        select: { status: true, postedPlatforms: true },
      });
      if (!row) return;
      const entries = getPlatformEntriesArray(row.postedPlatforms);
      const filtered = upsertPlatformEntry(entries, entry as PlatformEntry);
      const forcePosted = shouldPromoteVideoToPosted(filtered, targetPlatforms);
      const derivedStatus = deriveVideoStatusFromPlatforms(row.status, filtered, targetPlatforms);
      const nextStatus = forcePosted ? "POSTED" : derivedStatus;

      const summary = entry.success
        ? `${entry.success} postId=${(entry as { postId?: string | null }).postId ?? "?"}`
        : `failed: ${(entry as { error?: string }).error ?? "unknown"}`;
      log.log(`Finalizing ${entry.platform} for ${videoId}: ${summary}`);

      await tx.video.update({
        where: { id: videoId },
        data: {
          postedPlatforms: filtered as never,
          status: nextStatus,
        },
      });
    });
  } catch (e) {
    log.error(`Failed to finalize ${entry.platform} for ${videoId}:`, e);
  }
}

const PLATFORM_URLS: Record<string, (id: string) => string> = {
  YOUTUBE: (pid) => `https://youtube.com/shorts/${pid}`,
  FACEBOOK: (pid) => `https://www.facebook.com/reel/${pid}`,
  SHARECHAT: (pid) => `https://sharechat.com/video/${pid}`,
  MOJ: (pid) => `https://mojapp.in/video/${pid}`,
};

export async function postVideoToSocials(
  videoId: string,
  platformOverride?: string[],
  scheduledAt?: Date,
  fileLogger?: AutomationFileLogger,
): Promise<PostResult[]> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    include: {
      series: {
        include: {
          automation: { select: { targetPlatforms: true, includeAiTags: true, crossPlatformOnly: true } },
          user: {
            include: { socialAccounts: true },
          },
        },
      },
    },
  });

  if (!video || !video.videoUrl) {
    log.log(`Skipping ${videoId}: no video URL`);
    fileLogger?.poster(`SKIP: video=${videoId} — no video URL`);
    return [];
  }

  if (!["READY", "POSTED", "SCHEDULED"].includes(video.status)) {
    log.log(`Skipping ${videoId}: status is ${video.status}`);
    fileLogger?.poster(`SKIP: video=${videoId} — status=${video.status}`);
    return [];
  }

  // Wait if the video just became READY to let file I/O settle
  const age = Date.now() - new Date(video.updatedAt).getTime();
  if (age < POST_COOLDOWN_MS) {
    const wait = POST_COOLDOWN_MS - age;
    log.log(`Video ${videoId} became ready ${Math.round(age / 1000)}s ago, waiting ${Math.round(wait / 1000)}s before posting`);
    await sleep(wait);
  }

  let targetPlatforms = platformOverride
    ?? (video.series.automation?.targetPlatforms as string[])
    ?? [];

  // Cross-platform routing: skip posting to the same platform the clip was sourced from.
  // Controlled per-automation via crossPlatformOnly flag.
  const crossPlatformOnly = video.series.automation?.crossPlatformOnly ?? false;
  const sourcePlatform = (video.sourceMetadata as { platform?: string } | null)?.platform;
  if (crossPlatformOnly && sourcePlatform && !platformOverride) {
    const PLATFORM_MAP: Record<string, string> = { youtube: "YOUTUBE", facebook: "FACEBOOK", instagram: "INSTAGRAM" };
    const skipPlatform = PLATFORM_MAP[sourcePlatform.toLowerCase()];
    if (skipPlatform && targetPlatforms.includes(skipPlatform)) {
      log.log(`Cross-platform routing: source is ${sourcePlatform}, skipping ${skipPlatform}`);
      targetPlatforms = targetPlatforms.filter((p) => p !== skipPlatform);
    }
  }

  if (targetPlatforms.length === 0) {
    log.log(`No target platforms for video ${videoId}`);
    return [];
  }

  const videoPath = path.join(process.cwd(), "public", (video.videoUrl ?? "").replace(/^\//, ""));
  const seriesNiche = video.series.niche ?? "";
  const sourceNiche = (video.sourceMetadata as { niche?: string } | null)?.niche;
  const nicheId = seriesNiche === "clip-repurpose" && sourceNiche ? sourceNiche : seriesNiche;
  const rawTitle = video.title ?? "Check this out!";
  const title = rawTitle
    .replace(/^#\d+\s+/, "")         // "#3 Title" → "Title"
    .replace(/\s*\[\d+s?-\d+s?\]\s*/g, " ")  // "[0s-24s]" → " "
    .replace(/\s{2,}/g, " ")
    .trim();
  const scriptText = video.scriptText ?? undefined;
  const includeAiTags = video.series.automation?.includeAiTags ?? false;

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
        const entries = (prevVideo.postedPlatforms ?? []) as unknown as PlatformEntry[];
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
  let igCaption = generateInstagramCaption(title, nicheId, scriptText, includeAiTags);
  let fbCaption = generateFacebookCaption(title, nicheId, scriptText, includeAiTags);

  // For clip-repurpose videos, append the copyright credit from the video description
  const isClipRepurpose = !!video.sourceUrl;
  if (isClipRepurpose && video.description) {
    const creditSection = video.description;
    igCaption += `\n\n${creditSection}`;
    fbCaption += `\n\n${creditSection}`;
    ytSeo.description += `\n\n${creditSection}`;
  }

  // For IG app-level delayed jobs we intentionally call without scheduledAt.
  // Keep YT/FB native scheduling only.
  const isIgOnlyImmediateJob = !scheduledAt
    && targetPlatforms.length === 1
    && targetPlatforms[0] === "INSTAGRAM";

  // Post to all platforms in parallel
  async function postToPlatform(platform: string): Promise<PostResult> {
    const claimed = await claimPlatform(videoId, platform);
    if (!claimed) {
      fileLogger?.poster(`${platform}: already claimed/handled`);
      return { platform, success: true, postId: "already-handled" };
    }

    const accounts = video!.series.user.socialAccounts.filter(
      (a) => a.platform === platform,
    );

    // ShareChat/Moj: no public API yet; stub returns a clear message even with no account
    if ((platform === "SHARECHAT" || platform === "MOJ") && accounts.length === 0) {
      const stubResult = platform === "SHARECHAT"
        ? await uploadShareChatVideo("", videoPath, title, igCaption)
        : await uploadMojVideo("", videoPath, title, igCaption);
      await finalizePlatform(videoId, targetPlatforms, {
        platform, success: false, error: stubResult.error ?? "Upload not available",
      });
      return { platform, success: false, error: stubResult.error };
    }

    if (accounts.length === 0) {
      await finalizePlatform(videoId, targetPlatforms, {
        platform, success: false, error: "No connected account",
      });
      return { platform, success: false, error: "No connected account" };
    }

    const isDeferred = !!scheduledAt;
    const gapMs = Math.max(0, PLATFORM_POST_GAP_MINUTES) * 60 * 1000;
    if (gapMs > 0 && !isDeferred) {
      const latestSuccessAt = await getLatestPlatformSuccessTime(
        video!.series.user.id,
        platform,
        videoId,
      );
      if (latestSuccessAt) {
        const elapsedMs = Date.now() - latestSuccessAt.getTime();
        if (elapsedMs < gapMs) {
          const retryAfterMs = latestSuccessAt.getTime() + gapMs;
          const remainingMin = Math.ceil((gapMs - elapsedMs) / 60000);
          const msg = `Platform cooldown: retrying automatically in ~${remainingMin}m`;
          log.warn(`${msg} (video=${videoId}, retryAfter=${new Date(retryAfterMs).toISOString()})`);
          fileLogger?.poster(`${platform}: COOLDOWN — ${msg}`);

          const entries = await getPlatformEntries(videoId);
          const filtered = [...entries.values()].filter((e) => e.platform !== platform);
          filtered.push({
            platform,
            success: "cooldown",
            error: msg,
            retryAfter: retryAfterMs,
          });
          await db.video.update({
            where: { id: videoId },
            data: { postedPlatforms: filtered as never },
          });
          return { platform, success: false, error: msg };
        }
      }
    }

    for (const account of accounts) {
      let accessToken = decrypt(account.accessTokenEnc);
      const refreshToken = account.refreshTokenEnc
        ? decrypt(account.refreshTokenEnc)
        : null;

      // Proactively refresh Meta tokens (Facebook/Instagram) before they expire
      if ((platform === "FACEBOOK" || platform === "INSTAGRAM") && account.refreshTokenEnc && account.pageId) {
        try {
          accessToken = await getFreshFacebookToken(
            account.id,
            accessToken,
            account.refreshTokenEnc,
            account.pageId,
            account.tokenExpiresAt,
          );
        } catch (e) {
          log.warn(`Token refresh failed for ${platform}, proceeding with stored token:`, e instanceof Error ? e.message : e);
        }
      }

      const shouldNativeSchedule = !!scheduledAt && !isIgOnlyImmediateJob;
      const schedUnix = shouldNativeSchedule ? Math.floor(scheduledAt.getTime() / 1000) : undefined;
      const schedIso = shouldNativeSchedule ? scheduledAt.toISOString() : undefined;

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
                schedUnix,
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
                schedIso,
              );
              break;

            case "SHARECHAT":
              lastResult = await uploadShareChatVideo(
                accessToken,
                videoPath,
                title,
                igCaption,
              );
              break;

            case "MOJ":
              lastResult = await uploadMojVideo(
                accessToken,
                videoPath,
                title,
                igCaption,
              );
              break;

            default:
              lastResult = { success: false, error: `Unsupported platform: ${platform}` };
          }
        } catch (e) {
          const raw = e instanceof Error ? e.message : "Unknown error";
          lastResult = { success: false, error: sanitizeErrorForUi(raw) };
        }

        if (lastResult?.success) {
          log.log(`Posted to ${platform} (${account.username}) on attempt ${attempt}: ${lastResult.postId}`);
          break;
        }

        const errLower = (lastResult?.error ?? "").toLowerCase();
        const noRetry = errLower.includes("reconnect") || errLower.includes("expired") || errLower.includes("revoked") || errLower.includes("quota");
        if (noRetry) {
          log.error(`${platform} (${account.username}): ${lastResult?.error} — not retryable`);
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
        const successStatus: true | "scheduled" = shouldNativeSchedule ? "scheduled" : true;
        await finalizePlatformEx(videoId, targetPlatforms, {
          platform, success: successStatus, postId: result.postId ?? null, url: url ?? null,
        });
        if (shouldNativeSchedule) {
          const entries = await getPlatformEntries(videoId);
          const platEntry = entries.get(platform);
          if (platEntry) {
            platEntry.scheduledFor = scheduledAt.toISOString();
            await db.video.update({ where: { id: videoId }, data: { postedPlatforms: [...entries.values()] as never } });
          }
        }
        fileLogger?.poster(
          `${platform}: ${successStatus === "scheduled" ? "SCHEDULED" : "POSTED"} postId=${result.postId ?? "?"}${url ? ` url=${url}` : ""}`,
        );
        return { platform, ...result };
      } else {
        const errMsg = result.error ?? "Unknown error";
        const cleanMsg = sanitizeErrorForUi(errMsg);
        const displayError = platform === "FACEBOOK"
          ? `${cleanMsg}\nRetry after 24 hours.`
          : cleanMsg;
        await finalizePlatform(videoId, targetPlatforms, {
          platform, success: false, error: displayError,
        });
        fileLogger?.poster(`${platform}: FAILED — ${cleanMsg}`);
        return { platform, success: false, error: displayError };
      }
    }

    return { platform, success: false, error: "No accounts processed" };
  }

  log.log(`${scheduledAt && !isIgOnlyImmediateJob ? "Scheduling" : "Posting"} video ${videoId} to ${targetPlatforms.join(", ")}${scheduledAt ? ` for ${scheduledAt.toISOString()} (unix=${Math.floor(scheduledAt.getTime() / 1000)})` : " immediately"}`);
  const settled = await Promise.allSettled(targetPlatforms.map(postToPlatform));

  const results: PostResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      results.push(s.value);
    } else {
      const platform = targetPlatforms[i];
      const errMsg = sanitizeErrorForUi(String(s.reason));
      log.error(`Platform ${platform} threw unhandled:`, s.reason);
      await finalizePlatform(videoId, targetPlatforms, { platform, success: false, error: errMsg });
      results.push({ platform, success: false, error: errMsg });
    }
  }

  return results;
}
