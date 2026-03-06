/**
 * Moj app video upload.
 * Moj does not provide a public developer API for video uploads.
 * Use this stub when Moj launches a partner/creator API — replace
 * the implementation with the official upload flow and credentials.
 */

export interface MojPostResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

const NOT_AVAILABLE =
  "Moj upload is not available: no public API. Contact Moj/ShareChat for partner/creator API access.";

export async function uploadMojVideo(
  _accessToken: string,
  _videoPath: string,
  _title: string,
  _caption?: string,
): Promise<MojPostResult> {
  return { success: false, error: NOT_AVAILABLE };
}
