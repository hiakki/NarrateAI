import path from "path";

function slugify(s: string, maxLen = 40): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen);
}

export function buildVideoRelDir(
  userId: string,
  username: string,
  videoTitle: string,
  videoId: string,
): string {
  const userSlug = `${userId}_${slugify(username || "user")}`;
  const videoSlug = `${slugify(videoTitle || "untitled")}_${videoId}`;
  return path.join("videos", userSlug, videoSlug);
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
  const match = videoUrl.match(/^\/?videos\/(.+)\/video\.mp4$/);
  if (match) return path.join("videos", match[1]);
  const legacy = videoUrl.match(/^\/?videos\/([^/]+)\.mp4$/);
  if (legacy) return null;
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
