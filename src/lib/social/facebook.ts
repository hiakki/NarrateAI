import fs from "fs";
import { createLogger } from "@/lib/logger";

const log = createLogger("Facebook");
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

/** Translate raw Facebook API errors into actionable messages for logs & UI. */
function classifyFbError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("api access blocked"))
    return "Rate limited by Meta — too many posts in 24h. Wait a few hours and retry. (Original: " + raw.slice(0, 100) + ")";
  if (lower.includes("token") && (lower.includes("expired") || lower.includes("invalid")))
    return "Page access token expired. Reconnect Facebook in Channels. (Original: " + raw.slice(0, 80) + ")";
  if (lower.includes("permission") || lower.includes("not authorized"))
    return "Missing page permissions. Reconnect Facebook with full page access in Channels. (Original: " + raw.slice(0, 80) + ")";
  if (lower.includes("spam") || lower.includes("restricted"))
    return "Meta flagged this as spam or restricted your page. Check your Facebook page status.";
  if (lower.includes("duplicate") || lower.includes("already been posted"))
    return "Duplicate video — this reel was already posted to this page.";
  if (lower.includes("copyright"))
    return "Copyright issue — Facebook detected copyrighted content in this video.";
  if (lower.includes("upload") && lower.includes("fail"))
    return "Video upload failed on Meta servers. Try again in a few minutes.";
  return raw;
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
      const raw = err.error?.message ?? "Failed to start upload";
      return { success: false, error: classifyFbError(raw) };
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
      return { success: false, error: classifyFbError(`Upload failed: ${err}`) };
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
      const raw = err.error?.message ?? "Failed to finish upload";
      return { success: false, error: classifyFbError(raw) };
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
    const raw = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: classifyFbError(raw) };
  }
}

/** Post a first comment on a published Facebook video/reel. */
export async function postFacebookComment(
  videoId: string,
  pageAccessToken: string,
  text: string,
): Promise<{ success: boolean; commentId?: string; error?: string }> {
  try {
    const res = await fetch(`${GRAPH_API}/${videoId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        access_token: pageAccessToken,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      const raw = err.error?.message ?? "Failed to post comment";
      log.warn(`FB first comment failed on ${videoId}: ${raw}`);
      return { success: false, error: classifyFbError(raw) };
    }
    const { id } = await res.json();
    log.log(`FB first comment posted: ${id} at ${new Date().toISOString()} | text: "${text.slice(0, 80)}..."`);
    return { success: true, commentId: id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    log.warn(`FB first comment error on ${videoId}: ${msg}`);
    return { success: false, error: msg };
  }
}
