import fs from "fs";
import { createLogger } from "@/lib/logger";

const log = createLogger("Instagram");
const GRAPH_VERSION = "v21.0";
const GRAPH_API = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Return the full API error body as a string so logs/UI show exactly what Meta returned (no sugarcoating). */
function rawMetaError(body: unknown): string {
  if (body == null) return "Unknown error";
  try {
    const s = typeof body === "string" ? body : JSON.stringify(body);
    return s.length > 2000 ? s.slice(0, 2000) + "…" : s;
  } catch {
    return String(body);
  }
}

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
      const err = await createRes.json().catch(() => ({}));
      const raw = rawMetaError(err);
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
      return { success: false, error: raw };
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
      const err = await publishRes.json().catch(() => ({}));
      const raw = rawMetaError(err);
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
      return { success: false, error: raw };
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
    return { success: false, error: raw };
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
      const err = await res.json().catch(() => ({}));
      const raw = rawMetaError(err);
      log.warn(`IG first comment failed: ${raw}`);
      return { success: false, error: raw };
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

const GRAPH_API_IG = GRAPH_API;

/** Resolve Instagram shortcode (from URL e.g. DVQO3ahiL-L) to numeric media ID. Lists user media and matches permalink. */
export async function getInstagramMediaIdFromShortcode(
  accessToken: string,
  igUserId: string,
  shortcode: string,
): Promise<string | null> {
  const norm = shortcode.replace(/\/$/, "").toLowerCase();
  let url: string | null = `${GRAPH_API_IG}/${igUserId}/media?fields=id,permalink&limit=50&access_token=${encodeURIComponent(accessToken)}`;
  for (let page = 0; page < 3 && url; page++) {
    try {
      const res: Response = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const list: { id: string; permalink?: string }[] = data.data ?? [];
      for (const m of list) {
        const link = (m.permalink ?? "").toLowerCase();
        if (link.includes(`/reels/${norm}`) || link.includes(`/p/${norm}`) || link.endsWith(`/${norm}`) || link.endsWith(`/${norm}/`))
          return m.id;
      }
      url = data.paging?.next ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Media metrics (likes, comments, views) for insights. Views come from Insights API (required for Reels). */
export async function getInstagramMediaMetrics(
  accessToken: string,
  mediaIds: string[],
): Promise<Record<string, { likes: number; comments: number; views: number }>> {
  const result: Record<string, { likes: number; comments: number; views: number }> = {};
  for (const id of mediaIds.slice(0, 25)) {
    try {
      const res = await fetch(
        `${GRAPH_API_IG}/${id}?fields=like_count,comments_count&access_token=${encodeURIComponent(accessToken)}`,
      );
      if (!res.ok) continue;
      const data = await res.json();
      let likes = typeof data.like_count === "number" ? data.like_count : parseInt(data.like_count ?? "0", 10) || 0;
      let comments = typeof data.comments_count === "number" ? data.comments_count : parseInt(data.comments_count ?? "0", 10) || 0;
      let views = 0;
      try {
        const insightsRes = await fetch(
          `${GRAPH_API_IG}/${id}/insights?metric=views&period=lifetime&access_token=${encodeURIComponent(accessToken)}`,
        );
        if (insightsRes.ok) {
          const insightsData = (await insightsRes.json()) as {
            data?: { total_value?: { value?: number }; values?: { value?: number }[]; value?: number }[];
          };
          const first = insightsData?.data?.[0];
          if (first) {
            const val =
              first.total_value?.value ??
              (Array.isArray(first.values) && first.values.length > 0 ? first.values[first.values.length - 1]?.value ?? first.values[0]?.value : undefined) ??
              (first as { value?: number }).value;
            if (typeof val === "number") views = val;
            else if (val != null) views = parseInt(String(val), 10) || 0;
          }
        }
      } catch {
        // views unavailable (e.g. media too new, or no insights permission)
      }
      result[id] = { likes, comments, views };
    } catch {
      // skip
    }
  }
  return result;
}

/** Profile follower count for insights. */
export async function getInstagramProfileFollowers(
  accessToken: string,
  igUserId: string,
): Promise<number> {
  try {
    const res = await fetch(
      `${GRAPH_API_IG}/${igUserId}?fields=followers_count&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return typeof data.followers_count === "number" ? data.followers_count : parseInt(data.followers_count ?? "0", 10) || 0;
  } catch {
    return 0;
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
          const traceId = res.headers.get("x-fb-trace-id") ?? "";
          const debugId = res.headers.get("x-fb-debug") ?? "";
          const raw = rawMetaError(data);
          log.error(`Upload attempt ${attempt} rejected: ${raw}${traceId ? ` | x-fb-trace-id=${traceId}` : ""}${debugId ? ` | x-fb-debug=${debugId}` : ""}`);
          if (attempt === maxRetries) {
            const errWithTrace = traceId || debugId ? `${raw}${traceId ? ` | x-fb-trace-id=${traceId}` : ""}${debugId ? ` | x-fb-debug=${debugId}` : ""}` : raw;
            return {
              success: false,
              error: errWithTrace,
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
        let parsed: unknown;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
        const raw = rawMetaError(parsed ?? { status: res.status, text: text.slice(0, 500) });
        const errWithTrace = traceId || debugId ? `${raw}${traceId ? ` | x-fb-trace-id=${traceId}` : ""}${debugId ? ` | x-fb-debug=${debugId}` : ""}` : raw;
        return {
          success: false,
          error: errWithTrace,
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
        const raw = rawMetaError(data);
        log.error(`Container ${containerId} failed: ${raw}`);
        return { ready: false, error: raw };
      }
    } catch {
      log.error(`Poll ${i + 1} network error, retrying...`);
    }
  }
  log.error(`Container ${containerId} timed out after ${maxAttempts * 5}s`);
  return { ready: false, error: `Media processing timed out after ${Math.round(maxAttempts * 5 / 60)} minutes` };
}
