import path from "path";

function safeName(s: string, maxLen = 80): string {
  return s
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, maxLen);
}

export function buildVideoRelDir(
  userId: string,
  username: string,
  videoTitle: string,
  videoId: string,
  automationName?: string,
): string {
  const userDir = `${safeName(username || "user")}-${userId}`;
  const autoDir = safeName(automationName || "manual");
  const videoDir = `${safeName(videoTitle || "untitled")}-${videoId}`;
  return path.join("videos", userDir, autoDir, videoDir);
}

export function videoRelUrl(relDir: string): string {
  return `/${relDir}/video.mp4`;
}

export function absPath(relDir: string): string {
  return path.join(process.cwd(), "public", relDir);
}

export function videoAbsDir(relDir: string): string {
  return absPath(relDir);
}

export function scenesAbsDir(relDir: string): string {
  return path.join(absPath(relDir), "scenes");
}

export function videoAbsPath(relDir: string): string {
  return path.join(absPath(relDir), "video.mp4");
}

export function scriptAbsPath(relDir: string): string {
  return path.join(absPath(relDir), "script.txt");
}

export function voiceoverAbsPath(relDir: string, ext = "mp3"): string {
  return path.join(absPath(relDir), `voiceover.${ext}`);
}

export function contextAbsPath(relDir: string): string {
  return path.join(absPath(relDir), "context.txt");
}

export function relDirFromVideoUrl(videoUrl: string): string | null {
  // Handles both new (videos/user/auto/video-id/video.mp4) and old (videos/user/video-id/video.mp4) layouts
  const match = videoUrl.match(/^\/?(.*?)\/video\.mp4$/);
  if (match && match[1]) return match[1];
  return null;
}

export function resolveVideoFile(videoUrl: string): string {
  return path.join(process.cwd(), "public", videoUrl.replace(/^\//, ""));
}

export function resolveScenesDir(videoUrl: string): string {
  const relDir = relDirFromVideoUrl(videoUrl);
  if (relDir) return scenesAbsDir(relDir);
  const videoId = videoUrl.replace(/^\/?videos\//, "").replace(/\.mp4$/, "");
  return path.join(process.cwd(), "public", "videos", videoId, "scenes");
}
