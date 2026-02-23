import { google } from "googleapis";
import { PrismaClient } from "@prisma/client";
import { encrypt, decrypt } from "./encrypt";
import fs from "fs";

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

  console.log(`[YouTube] Token refreshed for channel ${platformUserId}`);

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
      console.log(`[YouTube] Token expires in ${Math.round(expiresIn / 1000)}s, refreshing proactively`);
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

export async function uploadYouTubeShort(
  accessToken: string,
  refreshToken: string | null,
  videoPath: string,
  title: string,
  description: string,
  tags: string[] = [],
  platformUserId?: string,
  userId?: string,
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

    const shortTitle = title.includes("#Shorts")
      ? title
      : `${title} #Shorts`;

    const doUpload = () =>
      youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: shortTitle,
            description: `${description}\n\n#Shorts`,
            tags: [...tags, "Shorts"],
            categoryId: "22",
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
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      console.log(`[YouTube] Auth failed on upload, refreshing token...`);
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
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
