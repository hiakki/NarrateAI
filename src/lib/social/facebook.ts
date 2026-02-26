import fs from "fs";

const GRAPH_API = "https://graph.facebook.com/v21.0";

interface PostResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * After a reel is published, attempt to fetch its permalink so the stored URL
 * actually works for any viewer (not just the page admin).
 */
async function fetchReelPermalink(
  videoId: string,
  pageId: string,
  pageAccessToken: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(attempt === 0 ? 3000 : 5000);
    try {
      const res = await fetch(
        `${GRAPH_API}/${videoId}?fields=permalink_url,source&access_token=${pageAccessToken}`,
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data.permalink_url) {
        // permalink_url is a relative path like /pagename/videos/123/
        // Convert to full URL
        const permalink = data.permalink_url.startsWith("http")
          ? data.permalink_url
          : `https://www.facebook.com${data.permalink_url}`;
        return permalink;
      }
    } catch {
      // Video may still be processing
    }
  }
  return null;
}

/**
 * Post a video as a Facebook Reel using the Facebook Pages API.
 *
 * Flow:
 * 1. Initialize upload via /{page-id}/video_reels with upload_phase=start
 * 2. Upload binary via the returned upload_url
 * 3. Finish via /{page-id}/video_reels with upload_phase=finish
 * 4. Fetch the permalink for a publicly shareable URL
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
    const finalVideoId = result.video_id ?? videoId;

    // Fetch the real permalink -- this is what actually works for other users
    const permalink = await fetchReelPermalink(finalVideoId, pageId, pageAccessToken);

    return {
      success: true,
      postId: finalVideoId,
      postUrl: permalink ?? `https://www.facebook.com/reel/${finalVideoId}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
