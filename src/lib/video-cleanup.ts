import fs from "fs/promises";
import path from "path";

// Helper to construct paths at runtime, opaque to Turbopack's static analysis.
function resolvePath(...segments: string[]) {
  return path.resolve(...segments);
}

/**
 * Clean up video files and directories for a list of videos.
 */
export async function cleanupVideoFiles(
  videos: { id: string; videoUrl?: string | null }[],
) {
  const baseDir = resolvePath(process.cwd(), "public");
  const videosDir = resolvePath(baseDir, "videos");

  await Promise.allSettled(
    videos.map(async (v) => {
      if (v.videoUrl?.includes("/video.mp4")) {
        const dir = resolvePath(
          baseDir,
          v.videoUrl.replace(/^\//, "").replace(/\/video\.mp4$/, ""),
        );
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      await fs
        .unlink(resolvePath(videosDir, `${v.id}.mp4`))
        .catch(() => {});
      await fs
        .rm(resolvePath(videosDir, v.id), { recursive: true, force: true })
        .catch(() => {});
    }),
  );
}
