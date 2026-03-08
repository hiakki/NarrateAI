import fs from "fs";
import { createLogger } from "@/lib/logger";

const log = createLogger("Facebook");
const GRAPH_API = "https://graph.facebook.com/v21.0";

/** Return the full API error body as a string so logs/UI show exactly what FB returned (no sugarcoating). */
function rawFbError(body: unknown): string {
  if (body == null) return "Unknown error";
  try {
    const s = typeof body === "string" ? body : JSON.stringify(body);
    return s.length > 2000 ? s.slice(0, 2000) + "…" : s;
  } catch {
    return String(body);
  }
}

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
      const err = await startRes.json().catch(() => ({}));
      return { success: false, error: rawFbError(err) };
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
      let parsed: unknown;
      try { parsed = JSON.parse(err); } catch { parsed = err; }
      return { success: false, error: rawFbError(parsed) };
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
      const err = await finishRes.json().catch(() => ({}));
      return { success: false, error: rawFbError(err) };
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
    return { success: false, error: raw };
  }
}

function parseInsightValue(insightsData: unknown): number {
  const d = insightsData as { data?: { total_value?: { value?: number }; values?: { value?: number }[]; value?: number }[] };
  const first = d?.data?.[0];
  if (!first) return 0;
  // Meta docs: total_value.value, or values[].value (InsightsValue)
  let val: number | undefined =
    first.total_value?.value ??
    (Array.isArray(first.values) && first.values.length > 0 ? first.values[first.values.length - 1]?.value ?? first.values[0]?.value : undefined) ??
    (first as { value?: number }).value;
  if (typeof val === "number") return val;
  if (val != null) return parseInt(String(val), 10) || 0;
  return 0;
}

/** Video insights (views, reactions, comments) for a single reel. Views from video_insights (total_video_views or fb_reels_total_plays for Reels). */
export async function getFacebookVideoInsights(
  pageAccessToken: string,
  videoId: string,
): Promise<{ views: number; reactions: number; comments: number }> {
  try {
    let views = 0;
    for (const metric of ["total_video_views", "fb_reels_total_plays"]) {
      const insightsRes = await fetch(
        `${GRAPH_API}/${videoId}/video_insights?metric=${metric}&period=lifetime&access_token=${encodeURIComponent(pageAccessToken)}`,
      );
      if (insightsRes.ok) {
        const insightsData = await insightsRes.json();
        views = parseInsightValue(insightsData as never);
        if (views > 0) break;
      }
    }

    // Video/Reel node: use comments + likes (reactions field does not exist on all Video objects)
    const res = await fetch(
      `${GRAPH_API}/${videoId}?fields=comments.summary(total_count),likes.summary(total_count)&access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    if (!res.ok) return { views, reactions: 0, comments: 0 };
    const data = await res.json();
    const comments = typeof data.comments?.summary?.total_count === "number"
      ? data.comments.summary.total_count
      : parseInt(String(data.comments?.summary?.total_count ?? 0), 10) || 0;
    const reactions = typeof data.likes?.summary?.total_count === "number"
      ? data.likes.summary.total_count
      : parseInt(String(data.likes?.summary?.total_count ?? 0), 10) || 0;
    return { views, reactions, comments };
  } catch {
    return { views: 0, reactions: 0, comments: 0 };
  }
}

/** Page follower count for insights. */
export async function getFacebookPageFollowers(
  pageAccessToken: string,
  pageId: string,
): Promise<number> {
  try {
    const res = await fetch(
      `${GRAPH_API}/${pageId}?fields=followers_count&access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return typeof data.followers_count === "number" ? data.followers_count : parseInt(String(data.followers_count ?? 0), 10) || 0;
  } catch {
    return 0;
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
      const err = await res.json().catch(() => ({}));
      const raw = rawFbError(err);
      log.warn(`FB first comment failed on ${videoId}: ${raw}`);
      return { success: false, error: raw };
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
