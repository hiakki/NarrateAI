import fs from "fs";
import { createLogger } from "@/lib/logger";

const log = createLogger("Instagram");
const GRAPH_API = "https://graph.facebook.com/v21.0";
const UPLOAD_API = "https://rupload.facebook.com/ig-api-upload/v21.0";

interface PostResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

/**
 * Post a video as an Instagram Reel via resumable upload.
 * Uploads the video binary directly to Meta servers -- no public URL needed.
 *
 * 1. Create container with upload_type=resumable
 * 2. Upload binary to rupload.facebook.com
 * 3. Poll for processing completion
 * 4. Publish
 */
export async function postInstagramReel(
  igUserId: string,
  accessToken: string,
  videoPath: string,
  caption: string,
): Promise<PostResult> {
  try {
    log.log(`Starting resumable upload for IG user ${igUserId}`);

    const createRes = await fetch(`${GRAPH_API}/${igUserId}/media`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        media_type: "REELS",
        upload_type: "resumable",
        caption,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json();
      return { success: false, error: err.error?.message ?? "Failed to create media container" };
    }

    const { id: containerId, uri: uploadUri } = await createRes.json();
    log.log(`Container created: ${containerId}`);

    const videoBuffer = fs.readFileSync(videoPath);
    const fileSize = videoBuffer.length;
    log.log(`Uploading ${Math.round(fileSize / 1024)}KB video to rupload.facebook.com...`);

    const uploadUrl = uploadUri ?? `${UPLOAD_API}/${containerId}`;
    const uploadResult = await uploadWithRetry(uploadUrl, accessToken, videoBuffer, fileSize);
    if (!uploadResult.success) {
      return { success: false, error: uploadResult.error };
    }

    log.log(`Upload complete, polling for processing...`);
    const pollResult = await pollMediaStatus(containerId, accessToken);
    if (!pollResult.ready) {
      return { success: false, error: pollResult.error ?? "Media container processing timed out" };
    }

    log.log(`Container ${containerId} ready, publishing...`);
    const publishRes = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ creation_id: containerId }),
    });

    if (!publishRes.ok) {
      const err = await publishRes.json();
      return { success: false, error: err.error?.message ?? "Failed to publish reel" };
    }

    const { id: postId } = await publishRes.json();
    log.log(`Published reel: ${postId}, fetching permalink...`);

    let postUrl: string | undefined;
    try {
      const metaRes = await fetch(
        `${GRAPH_API}/${postId}?fields=permalink`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (metaRes.ok) {
        const metaData = await metaRes.json();
        postUrl = metaData.permalink ?? undefined;
      }
    } catch {
      log.log(`Could not fetch permalink for ${postId}, using fallback`);
    }

    log.log(`Published reel: ${postId} → ${postUrl ?? "(no permalink)"}`);
    return { success: true, postId, postUrl };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function uploadWithRetry(
  uploadUrl: string,
  accessToken: string,
  videoBuffer: Buffer,
  fileSize: number,
  maxRetries = 3,
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `OAuth ${accessToken}`,
          offset: "0",
          file_size: String(fileSize),
          "Content-Type": "application/octet-stream",
        },
        body: videoBuffer,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success === false) {
          const msg = data.debug_info?.message ?? data.error?.message ?? "Upload rejected";
          log.error(`Upload attempt ${attempt} rejected: ${msg}`);
          if (attempt === maxRetries) return { success: false, error: msg };
          await new Promise((r) => setTimeout(r, 3000 * attempt));
          continue;
        }
        return { success: true };
      }

      const text = await res.text().catch(() => "");
      log.error(`Upload attempt ${attempt} failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
      if (attempt === maxRetries) return { success: false, error: `Upload failed after ${maxRetries} attempts (HTTP ${res.status})` };
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      log.error(`Upload attempt ${attempt} error: ${msg}`);
      if (attempt === maxRetries) return { success: false, error: msg };
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  return { success: false, error: "Upload failed" };
}

async function pollMediaStatus(
  containerId: string,
  accessToken: string,
  maxAttempts = 60,
): Promise<{ ready: boolean; error?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(
        `${GRAPH_API}/${containerId}?fields=status_code,status,video_status`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await res.json();
      const status = data.status_code ?? "UNKNOWN";

      if (i % 6 === 0 || status === "FINISHED" || status === "ERROR") {
        const phase = data.video_status?.processing_phase?.status ?? "";
        log.log(`Poll ${i + 1}/${maxAttempts}: status=${status}${phase ? ` processing=${phase}` : ""}`);
      }

      if (status === "FINISHED") return { ready: true };
      if (status === "ERROR") {
        const detail = data.status ?? "unknown error";
        log.error(`Container ${containerId} failed: ${detail}`);
        return { ready: false, error: `Instagram processing failed: ${detail}` };
      }
    } catch {
      log.error(`Poll ${i + 1} network error, retrying...`);
    }
  }
  log.error(`Container ${containerId} timed out after ${maxAttempts * 5}s`);
  return { ready: false, error: `Media processing timed out after ${Math.round(maxAttempts * 5 / 60)} minutes` };
}
