import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createLogger } from "@/lib/logger";
import { downloadFbVideo, downloadIgVideo } from "./browser-scraper";

const execFileAsync = promisify(execFile);
const log = createLogger("ClipDownloader");

export interface DownloadResult {
  videoPath: string;
  infoJsonPath: string;
  subsPath: string | null;
  tmpDir: string;
}

export interface HeatmapPoint {
  start_time: number;
  end_time: number;
  value: number;
}

export interface VideoInfo {
  id: string;
  title: string;
  duration: number;
  channel: string;
  channel_id: string;
  view_count: number;
  heatmap: HeatmapPoint[] | null;
  subtitles: Record<string, Array<{ url: string; ext: string }>> | null;
  automatic_captions: Record<string, Array<{ url: string; ext: string }>> | null;
  licensedContent?: boolean;
}

function findYtDlp(): string {
  return process.env.YTDLP_PATH ?? "yt-dlp";
}

/**
 * Download a YouTube video along with its metadata (heatmap) and subtitles.
 */
export async function downloadVideo(
  videoUrl: string,
  options?: { maxHeight?: number; subsLang?: string },
): Promise<DownloadResult> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-clip-"));
  const outputTemplate = path.join(tmpDir, "%(id)s.%(ext)s");
  const maxHeight = options?.maxHeight ?? 1080;
  const subsLang = options?.subsLang ?? "en";

  const commonArgs = [
    "--write-info-json",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--no-warnings",
    "-o", outputTemplate,
  ];

  const { getCookieFilePath } = await import("@/lib/cookie-path");
  const cookieFile = getCookieFilePath();
  if (cookieFile) {
    commonArgs.push("--cookies", cookieFile);
  }

  log.log(`Downloading: ${videoUrl}`);
  const ytdlp = findYtDlp();

  const attempts: Array<{ name: string; args: string[] }> = [
    {
      name: "default+subs",
      args: [
        ...commonArgs,
        "--write-auto-subs",
        "--sub-lang", subsLang,
        "--sub-format", "vtt",
        "-f", `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/bestvideo+bestaudio/best`,
        videoUrl,
      ],
    },
    {
      name: "youtube-client-fallback",
      args: [
        ...commonArgs,
        "-f", `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/bestvideo+bestaudio/best`,
        "--extractor-args", "youtube:player_client=android,web",
        "--force-ipv4",
        videoUrl,
      ],
    },
    {
      name: "single-stream-fallback",
      args: [
        ...commonArgs,
        "-f", `best[height<=${maxHeight}]/best`,
        "--extractor-args", "youtube:player_client=android,web",
        "--force-ipv4",
        videoUrl,
      ],
    },
  ];

  const errors: string[] = [];
  let ok = false;
  for (const attempt of attempts) {
    try {
      const { stdout, stderr } = await execFileAsync(ytdlp, attempt.args, {
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (stderr) log.debug(`yt-dlp [${attempt.name}] stderr: ${stderr.slice(0, 300)}`);
      log.debug(`yt-dlp [${attempt.name}] stdout: ${stdout.slice(0, 200)}`);
      ok = true;
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${attempt.name}] ${msg.slice(0, 260)}`);
      log.warn(`yt-dlp attempt failed (${attempt.name}): ${msg.slice(0, 200)}`);
    }
  }

  if (!ok) {
    const hint = !cookieFile
      ? " No cookies file found. Upload cookies in Settings or set YTDLP_COOKIES_FILE."
      : "";
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`yt-dlp failed after ${attempts.length} attempts.${hint} ${errors.join(" | ").slice(0, 1200)}`);
  }

  const files = await fs.readdir(tmpDir);
  const videoFile = files.find((f) => /\.(mp4|webm|mkv)$/.test(f) && !f.endsWith(".info.json"));
  const infoFile = files.find((f) => f.endsWith(".info.json"));
  const subsFile = files.find((f) => f.endsWith(".vtt"));

  if (!videoFile || !infoFile) {
    const listing = files.join(", ");
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`yt-dlp did not produce expected files. Found: ${listing}`);
  }

  log.log(`Downloaded: ${videoFile} (${(await fs.stat(path.join(tmpDir, videoFile))).size / 1024 / 1024 | 0}MB)`);

  return {
    videoPath: path.join(tmpDir, videoFile),
    infoJsonPath: path.join(tmpDir, infoFile),
    subsPath: subsFile ? path.join(tmpDir, subsFile) : null,
    tmpDir,
  };
}

/**
 * Parse the yt-dlp info.json to extract video metadata and heatmap.
 */
export async function parseVideoInfo(infoJsonPath: string): Promise<VideoInfo> {
  const raw = await fs.readFile(infoJsonPath, "utf-8");
  const data = JSON.parse(raw) as Record<string, unknown>;

  return {
    id: String(data.id ?? ""),
    title: String(data.title ?? ""),
    duration: Number(data.duration ?? 0),
    channel: String(data.channel ?? data.uploader ?? ""),
    channel_id: String(data.channel_id ?? ""),
    view_count: Number(data.view_count ?? 0),
    heatmap: Array.isArray(data.heatmap) ? data.heatmap as HeatmapPoint[] : null,
    subtitles: data.subtitles as VideoInfo["subtitles"] ?? null,
    automatic_captions: data.automatic_captions as VideoInfo["automatic_captions"] ?? null,
    licensedContent: typeof data.license === "string" ? data.license !== "creativeCommon" : undefined,
  };
}

/**
 * Platform-aware download that falls back to browser scraping for FB/IG.
 * For YouTube, uses yt-dlp. For FB/IG, uses Puppeteer-based download.
 */
export async function downloadVideoAuto(
  videoUrl: string,
  options?: { maxHeight?: number; subsLang?: string },
): Promise<DownloadResult> {
  const isFb = /facebook\.com|fb\.watch|fb\.com/i.test(videoUrl);
  const isIg = /instagram\.com|instagr\.am/i.test(videoUrl);

  if (!isFb && !isIg) {
    return downloadVideo(videoUrl, options);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-clip-"));

  // Try yt-dlp first (might work for some URLs)
  try {
    return await downloadVideo(videoUrl, options);
  } catch (err) {
    log.log(`yt-dlp failed for ${isFb ? "FB" : "IG"} URL, falling back to browser download: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
  }

  // Browser-based fallback
  const result = isFb
    ? await downloadFbVideo(videoUrl, tmpDir)
    : await downloadIgVideo(videoUrl, tmpDir);

  if (!result) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Browser download failed for ${videoUrl}`);
  }

  // Create a minimal info.json for compatibility
  const infoJsonPath = path.join(tmpDir, "browser-video.info.json");
  const infoData = {
    id: videoUrl.match(/(?:\/reel\/|\/watch\/?\?v=|\/videos\/)([^/?&]+)/)?.[1] || "unknown",
    title: result.title,
    duration: result.durationSec,
    channel: "",
    channel_id: "",
    view_count: result.viewCount,
    heatmap: null,
    subtitles: null,
    automatic_captions: null,
  };
  await fs.writeFile(infoJsonPath, JSON.stringify(infoData, null, 2));

  return {
    videoPath: result.videoPath,
    infoJsonPath,
    subsPath: null,
    tmpDir,
  };
}
