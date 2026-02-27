import { google } from "googleapis";
import { PrismaClient } from "@prisma/client";
import { encrypt, decrypt } from "./encrypt";
import { createLogger } from "@/lib/logger";
import fs from "fs";

const log = createLogger("YouTube");

const db = new PrismaClient();

interface PostResult {
  success: boolean;
  postId?: string;
  error?: string;
}

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_APP_URL}/api/social/callback/youtube`,
  );
}

async function refreshAndPersist(
  refreshToken: string,
  platformUserId: string,
  userId: string,
): Promise<string> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error("Refresh did not return a new access token");
  }

  log.log(`Token refreshed for channel ${platformUserId}`);

  await db.socialAccount.updateMany({
    where: { userId, platform: "YOUTUBE", platformUserId },
    data: {
      accessTokenEnc: encrypt(credentials.access_token),
      tokenExpiresAt: credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : null,
    },
  });

  return credentials.access_token;
}

/**
 * Get a valid access token -- refresh proactively if expired or about to expire.
 */
async function getFreshAccessToken(
  accessToken: string,
  refreshToken: string | null,
  platformUserId?: string,
  userId?: string,
): Promise<string> {
  if (!refreshToken || !platformUserId || !userId) return accessToken;

  const account = await db.socialAccount.findFirst({
    where: { userId, platform: "YOUTUBE", platformUserId },
    select: { tokenExpiresAt: true, accessTokenEnc: true },
  });

  if (account?.tokenExpiresAt) {
    const expiresIn = account.tokenExpiresAt.getTime() - Date.now();
    if (expiresIn < 5 * 60 * 1000) {
      log.log(`Token expires in ${Math.round(expiresIn / 1000)}s, refreshing proactively`);
      return refreshAndPersist(refreshToken, platformUserId, userId);
    }
    if (account.accessTokenEnc) {
      return decrypt(account.accessTokenEnc);
    }
  }

  return accessToken;
}

function isAuthError(err: unknown): boolean {
  const code = (err as { code?: number | string }).code;
  if (code === 401 || code === "401") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.toLowerCase().includes("invalid authentication") ||
    msg.toLowerCase().includes("invalid credentials") ||
    msg.toLowerCase().includes("token has been expired or revoked")
  );
}

/** Translate raw YouTube API errors into actionable messages for logs & UI. */
function classifyYtError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("token has been expired or revoked"))
    return "YouTube token expired/revoked. Reconnect YouTube in Channels.";
  if (lower.includes("quota") || lower.includes("quotaexceeded"))
    return "YouTube daily upload quota exceeded. Quota resets at midnight Pacific Time. Try again tomorrow.";
  if (lower.includes("forbidden") || lower.includes("insufficient permission"))
    return "Missing YouTube permissions. Reconnect your account in Channels with full upload access.";
  if (lower.includes("rateLimitExceeded") || lower.includes("rate limit"))
    return "YouTube rate limit hit. Wait a few minutes and retry.";
  if (lower.includes("duplicate"))
    return "Duplicate video — YouTube rejected this upload because it already exists on your channel.";
  if (lower.includes("video is too long") || lower.includes("file too large"))
    return "Video exceeds YouTube Shorts limits (max 60 seconds, 256 MB).";
  if (lower.includes("not found") || lower.includes("channel not found"))
    return "YouTube channel not found. Make sure your connected account has an active channel.";
  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("timeout"))
    return "Network error while uploading to YouTube. Check your connection and retry.";
  return raw;
}

export async function uploadYouTubeShort(
  accessToken: string,
  refreshToken: string | null,
  videoPath: string,
  title: string,
  description: string,
  tags: string[] = [],
  platformUserId?: string,
  userId?: string,
  categoryId: string = "22",
): Promise<PostResult> {
  try {
    const token = await getFreshAccessToken(
      accessToken,
      refreshToken,
      platformUserId,
      userId,
    );

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: token,
      refresh_token: refreshToken ?? undefined,
    });

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const doUpload = () =>
      youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: title.slice(0, 100),
            description: description.slice(0, 5000),
            tags: tags.slice(0, 30),
            categoryId,
            defaultLanguage: "en",
          },
          status: {
            privacyStatus: "public",
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: fs.createReadStream(videoPath),
        },
      });

    try {
      const res = await doUpload();
      return { success: true, postId: res.data.id ?? undefined };
    } catch (err: unknown) {
      if (!isAuthError(err) || !refreshToken || !platformUserId || !userId) {
        const raw = err instanceof Error ? err.message : String(err);
        return { success: false, error: classifyYtError(raw) };
      }

      log.log(`Auth failed on upload, refreshing token...`);
      const freshToken = await refreshAndPersist(
        refreshToken,
        platformUserId,
        userId,
      );

      oauth2Client.setCredentials({
        access_token: freshToken,
        refresh_token: refreshToken,
      });

      const res = await doUpload();
      return { success: true, postId: res.data.id ?? undefined };
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: classifyYtError(raw) };
  }
}

/** Post a first comment on a published YouTube video/short. */
export async function postYouTubeComment(
  accessToken: string,
  refreshToken: string | null,
  videoId: string,
  text: string,
  platformUserId?: string,
  userId?: string,
): Promise<{ success: boolean; commentId?: string; error?: string }> {
  try {
    const token = await getFreshAccessToken(
      accessToken,
      refreshToken,
      platformUserId,
      userId,
    );

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: token,
      refresh_token: refreshToken ?? undefined,
    });

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const res = await youtube.commentThreads.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          videoId,
          topLevelComment: {
            snippet: { textOriginal: text },
          },
        },
      },
    });

    const commentId = res.data.id ?? undefined;
    log.log(`YT first comment posted: ${commentId} on video ${videoId} at ${new Date().toISOString()} | text: "${text.slice(0, 80)}..."`);
    return { success: true, commentId };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    log.warn(`YT first comment failed on ${videoId}: ${raw}`);
    return { success: false, error: classifyYtError(raw) };
  }
}
