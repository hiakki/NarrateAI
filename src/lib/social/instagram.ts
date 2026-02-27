import fs from "fs";
import { createLogger } from "@/lib/logger";

const log = createLogger("Instagram");
const GRAPH_VERSION = "v21.0";
const GRAPH_API = `https://graph.facebook.com/${GRAPH_VERSION}`;

function logMetaSupportPayload(payload: Record<string, unknown>) {
  // Single-line structured payload for quick support escalation.
  log.error(`[META_SUPPORT_PAYLOAD] ${JSON.stringify(payload)}`);
}

/**
 * Inspect an access token via Meta's debug_token endpoint.
 * Returns the app_id embedded in the token, or null on failure.
 */
async function debugToken(accessToken: string): Promise<{ appId: string | null; type: string | null; isValid: boolean }> {
  try {
    const appId = process.env.FACEBOOK_APP_ID ?? "";
    const appSecret = process.env.FACEBOOK_APP_SECRET ?? "";
    const appToken = `${appId}|${appSecret}`;
    const res = await fetch(
      `${GRAPH_API}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`,
    );
    if (!res.ok) return { appId: null, type: null, isValid: false };
    const { data } = await res.json();
    return {
      appId: data?.app_id ?? null,
      type: data?.type ?? null,
      isValid: data?.is_valid ?? false,
    };
  } catch {
    return { appId: null, type: null, isValid: false };
  }
}

interface PostResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

/** Translate raw Meta/IG API errors into actionable messages for logs & UI. */
function classifyMetaError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("api access blocked"))
    return "Rate limited by Meta — too many posts in 24h. Wait a few hours and retry. (Original: " + raw.slice(0, 100) + ")";
  if (lower.includes("app id") && lower.includes("does not match"))
    return "App ID mismatch — please disconnect & reconnect Instagram in Channels. (Original: " + raw.slice(0, 100) + ")";
  if (lower.includes("token") && (lower.includes("expired") || lower.includes("invalid")))
    return "Access token expired. Reconnect Instagram in Channels. (Original: " + raw.slice(0, 80) + ")";
  if (lower.includes("permission") || lower.includes("not authorized"))
    return "Missing permissions. Reconnect Instagram with full access in Channels. (Original: " + raw.slice(0, 80) + ")";
  if (lower.includes("spam") || lower.includes("restricted"))
    return "Meta flagged this as spam or restricted your account. Check your Instagram account status.";
  if (lower.includes("media posted before the minimum interval"))
    return "Posting too fast — Instagram requires a gap between posts. Wait 5-10 minutes.";
  if (lower.includes("copyright"))
    return "Copyright issue — Instagram detected copyrighted content in this video.";
  return raw;
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
  pageAccessToken?: string | null,
  pageId?: string | null,
): Promise<PostResult> {
  try {
    log.log(`Starting resumable upload for IG user ${igUserId}`);

    // Diagnose token before proceeding
    const envAppId = process.env.FACEBOOK_APP_ID ?? "(not set)";
    const tokenInfo = await debugToken(accessToken);
    let pageTokenInfo: { appId: string | null; type: string | null; isValid: boolean } | null = null;
    log.log(`Token debug: app_id=${tokenInfo.appId} type=${tokenInfo.type} valid=${tokenInfo.isValid} | env FACEBOOK_APP_ID=${envAppId}`);
    if (tokenInfo.appId && tokenInfo.appId !== envAppId) {
      log.error(`APP ID MISMATCH: token belongs to app ${tokenInfo.appId} but env is ${envAppId}`);
    }

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
      const raw = err.error?.message ?? "Failed to create media container";
      logMetaSupportPayload({
        stage: "create_container",
        graphVersion: GRAPH_VERSION,
        igUserId,
        pageId: pageId ?? null,
        envAppId,
        userTokenAppId: tokenInfo.appId,
        userTokenType: tokenInfo.type,
        userTokenValid: tokenInfo.isValid,
        error: raw,
        at: new Date().toISOString(),
      });
      return { success: false, error: classifyMetaError(raw) };
    }

    const createData = await createRes.json();
    const containerId = createData.id;
    const uploadUri: string | undefined = createData.uri;
    log.log(`Container created: ${containerId} | uri: ${uploadUri ?? "(none — using fallback)"}`);

    const videoBuffer = fs.readFileSync(videoPath);
    const fileSize = videoBuffer.length;
    log.log(`Uploading ${Math.round(fileSize / 1024)}KB video to rupload.facebook.com...`);

    const uploadUrl = uploadUri ?? `${GRAPH_API}/${containerId}/uploads`;

    // Try upload with user token first
    let uploadResult = await uploadWithRetry(uploadUrl, accessToken, videoBuffer, fileSize);

    // If user token fails with app_id mismatch AND we have a page token, retry with it
    if (!uploadResult.success && pageAccessToken && uploadResult.error?.toLowerCase().includes("app id")) {
      log.warn(`User token upload failed with App ID mismatch. Retrying with page access token...`);
      pageTokenInfo = await debugToken(pageAccessToken);
      log.log(`Page token debug: app_id=${pageTokenInfo.appId} type=${pageTokenInfo.type} valid=${pageTokenInfo.isValid}`);
      uploadResult = await uploadWithRetry(uploadUrl, pageAccessToken, videoBuffer, fileSize);
    }

    if (!uploadResult.success) {
      logMetaSupportPayload({
        stage: "upload_binary",
        graphVersion: GRAPH_VERSION,
        igUserId,
        pageId: pageId ?? null,
        containerId,
        uploadUri: uploadUrl,
        envAppId,
        userTokenAppId: tokenInfo.appId,
        userTokenType: tokenInfo.type,
        userTokenValid: tokenInfo.isValid,
        pageTokenAppId: pageTokenInfo?.appId ?? null,
        pageTokenType: pageTokenInfo?.type ?? null,
        pageTokenValid: pageTokenInfo?.isValid ?? null,
        fbTraceId: uploadResult.traceId ?? null,
        fbDebug: uploadResult.debugId ?? null,
        fbApiVersion: uploadResult.apiVersion ?? null,
        error: uploadResult.error,
        at: new Date().toISOString(),
      });
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
      const raw = err.error?.message ?? "Failed to publish reel";
      logMetaSupportPayload({
        stage: "publish_reel",
        graphVersion: GRAPH_VERSION,
        igUserId,
        pageId: pageId ?? null,
        containerId,
        envAppId,
        userTokenAppId: tokenInfo.appId,
        userTokenType: tokenInfo.type,
        userTokenValid: tokenInfo.isValid,
        error: raw,
        at: new Date().toISOString(),
      });
      return { success: false, error: classifyMetaError(raw) };
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
    const raw = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: classifyMetaError(raw) };
  }
}

/** Post a first comment on a published Instagram media object. */
export async function postInstagramComment(
  mediaId: string,
  accessToken: string,
  text: string,
): Promise<{ success: boolean; commentId?: string; error?: string }> {
  try {
    const res = await fetch(`${GRAPH_API}/${mediaId}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) {
      const err = await res.json();
      const raw = err.error?.message ?? "Failed to post comment";
      log.warn(`IG first comment failed: ${raw}`);
      return { success: false, error: classifyMetaError(raw) };
    }
    const { id } = await res.json();
    log.log(`IG first comment posted: ${id} at ${new Date().toISOString()} | text: "${text.slice(0, 80)}..."`);
    return { success: true, commentId: id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    log.warn(`IG first comment error: ${msg}`);
    return { success: false, error: msg };
  }
}

async function uploadWithRetry(
  uploadUrl: string,
  accessToken: string,
  videoBuffer: Buffer,
  fileSize: number,
  maxRetries = 3,
): Promise<{ success: boolean; error?: string; traceId?: string; debugId?: string; apiVersion?: string }> {
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
        body: new Uint8Array(videoBuffer),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success === false) {
          let msg = data.debug_info?.message ?? data.error?.message ?? "Upload rejected";
          try { const inner = JSON.parse(msg); msg = inner?.error?.message ?? msg; } catch {}
          const traceId = res.headers.get("x-fb-trace-id") ?? "";
          const debugId = res.headers.get("x-fb-debug") ?? "";
          log.error(`Upload attempt ${attempt} rejected: ${msg}${traceId ? ` | x-fb-trace-id=${traceId}` : ""}${debugId ? ` | x-fb-debug=${debugId}` : ""}`);
          if (attempt === maxRetries) {
            const errWithTrace = `${msg}${traceId ? ` (trace: ${traceId})` : ""}`;
            return {
              success: false,
              error: classifyMetaError(errWithTrace),
              traceId: traceId || undefined,
              debugId: debugId || undefined,
            };
          }
          await new Promise((r) => setTimeout(r, 3000 * attempt));
          continue;
        }
        return { success: true };
      }

      const text = await res.text().catch(() => "");
      const traceId = res.headers.get("x-fb-trace-id") ?? "";
      const debugId = res.headers.get("x-fb-debug") ?? "";
      const apiVersion = res.headers.get("facebook-api-version") ?? "";
      log.error(
        `Upload attempt ${attempt} failed (HTTP ${res.status}): ${text.slice(0, 200)}`
        + `${traceId ? ` | x-fb-trace-id=${traceId}` : ""}`
        + `${debugId ? ` | x-fb-debug=${debugId}` : ""}`
        + `${apiVersion ? ` | fb-api-version=${apiVersion}` : ""}`,
      );
      if (attempt === maxRetries) {
        const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();
        const apiMsg = parsed?.error?.message ?? parsed?.debug_info?.message;
        const base = apiMsg ?? `Upload failed after ${maxRetries} attempts (HTTP ${res.status})`;
        const errWithTrace = `${base}${traceId ? ` (trace: ${traceId})` : ""}`;
        return {
          success: false,
          error: classifyMetaError(errWithTrace),
          traceId: traceId || undefined,
          debugId: debugId || undefined,
          apiVersion: apiVersion || undefined,
        };
      }
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
        const detail = data.status ?? data.error?.message ?? "unknown error";
        log.error(`Container ${containerId} failed: ${detail}`);
        return { ready: false, error: classifyMetaError(`Instagram processing failed: ${detail}`) };
      }
    } catch {
      log.error(`Poll ${i + 1} network error, retrying...`);
    }
  }
  log.error(`Container ${containerId} timed out after ${maxAttempts * 5}s`);
  return { ready: false, error: `Media processing timed out after ${Math.round(maxAttempts * 5 / 60)} minutes` };
}
