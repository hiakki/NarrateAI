/**
 * ShareChat video upload.
 * ShareChat does not provide a public developer API for video uploads.
 * Use this stub when ShareChat launches a partner/creator API — replace
 * the implementation with the official upload flow and credentials.
 */

export interface ShareChatPostResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

const NOT_AVAILABLE =
  "ShareChat upload is not available: no public API. Contact ShareChat for partner/creator API access.";

export async function uploadShareChatVideo(
  _accessToken: string,
  _videoPath: string,
  _title: string,
  _caption?: string,
): Promise<ShareChatPostResult> {
  return { success: false, error: NOT_AVAILABLE };
}
