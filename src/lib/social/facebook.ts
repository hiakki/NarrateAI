import fs from "fs";
import path from "path";

const GRAPH_API = "https://graph.facebook.com/v21.0";

interface PostResult {
  success: boolean;
  postId?: string;
  error?: string;
}

/**
 * Post a video as a Facebook Reel using the Facebook Pages API.
 *
 * Flow:
 * 1. Initialize upload via /{page-id}/video_reels with upload_phase=start
 * 2. Upload binary via the returned upload_url
 * 3. Finish via /{page-id}/video_reels with upload_phase=finish
 */
export async function postFacebookReel(
  pageId: string,
  pageAccessToken: string,
  videoPath: string,
  description: string,
): Promise<PostResult> {
  try {
    const startRes = await fetch(`${GRAPH_API}/${pageId}/video_reels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upload_phase: "start",
        access_token: pageAccessToken,
      }),
    });

    if (!startRes.ok) {
      const err = await startRes.json();
      return { success: false, error: err.error?.message ?? "Failed to start upload" };
    }

    const { video_id: videoId, upload_url: uploadUrl } = await startRes.json();

    const fileBuffer = fs.readFileSync(videoPath);
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${pageAccessToken}`,
        offset: "0",
        file_size: String(fileBuffer.length),
        "Content-Type": "application/octet-stream",
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return { success: false, error: `Upload failed: ${err}` };
    }

    const finishRes = await fetch(`${GRAPH_API}/${pageId}/video_reels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upload_phase: "finish",
        video_id: videoId,
        video_state: "PUBLISHED",
        description,
        access_token: pageAccessToken,
      }),
    });

    if (!finishRes.ok) {
      const err = await finishRes.json();
      return { success: false, error: err.error?.message ?? "Failed to finish upload" };
    }

    const result = await finishRes.json();
    return { success: true, postId: result.video_id ?? videoId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
