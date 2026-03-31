import * as path from "path";
import * as fs from "fs";

const DATA_COOKIE_PATH = path.join(process.cwd(), "data", "ytdlp-cookies.txt");

/**
 * Resolve the cookie file path for yt-dlp.
 * Priority: YTDLP_COOKIES_FILE env var → data/ytdlp-cookies.txt (uploaded via UI).
 * Returns null if no cookie file exists.
 */
export function getCookieFilePath(): string | null {
  const envPath = process.env.YTDLP_COOKIES_FILE;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (fs.existsSync(DATA_COOKIE_PATH)) return DATA_COOKIE_PATH;
  return null;
}

export function getDataCookiePath(): string {
  return DATA_COOKIE_PATH;
}
