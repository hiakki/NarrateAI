import fs from "fs";
import path from "path";

const GRAPH_API = "https://graph.facebook.com/v21.0";

interface PostResult {
  success: boolean;
  postId?: string;
  error?: string;
}

/**
 * Post a video as an Instagram Reel using the Instagram Graph API.
 *
 * Flow:
 * 1. Upload video via /ig-user/media with media_type=REELS
 * 2. Poll for upload completion via /{container-id}?fields=status_code
 * 3. Publish via /ig-user/media_publish
 */
export async function postInstagramReel(
  igUserId: string,
  accessToken: string,
  videoPath: string,
  caption: string,
): Promise<PostResult> {
  try {
    const videoUrl = await uploadToTempHost(videoPath);

    const createRes = await fetch(
      `${GRAPH_API}/${igUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "REELS",
          video_url: videoUrl,
          caption,
          access_token: accessToken,
        }),
      },
    );

    if (!createRes.ok) {
      const err = await createRes.json();
      return { success: false, error: err.error?.message ?? "Failed to create media container" };
    }

    const { id: containerId } = await createRes.json();

    const ready = await pollMediaStatus(containerId, accessToken);
    if (!ready) {
      return { success: false, error: "Media container processing timed out" };
    }

    const publishRes = await fetch(
      `${GRAPH_API}/${igUserId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      },
    );

    if (!publishRes.ok) {
      const err = await publishRes.json();
      return { success: false, error: err.error?.message ?? "Failed to publish reel" };
    }

    const { id: postId } = await publishRes.json();
    return { success: true, postId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function pollMediaStatus(
  containerId: string,
  accessToken: string,
  maxAttempts = 30,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `${GRAPH_API}/${containerId}?fields=status_code&access_token=${accessToken}`,
    );
    const data = await res.json();
    if (data.status_code === "FINISHED") return true;
    if (data.status_code === "ERROR") return false;
  }
  return false;
}

/**
 * Placeholder: In production, upload to a publicly accessible URL.
 * Instagram requires a public video_url. Options:
 * - Upload to S3/GCS and return a signed URL
 * - Serve from the Next.js public folder if the server is publicly accessible
 */
async function uploadToTempHost(videoPath: string): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const filename = path.basename(videoPath);
  return `${appUrl}/videos/${filename}`;
}
