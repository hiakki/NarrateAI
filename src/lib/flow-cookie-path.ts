import * as fs from "fs";
import * as path from "path";

const DATA_FLOW_COOKIE_PATH = path.join(process.cwd(), "data", "flow-cookies.json");

/**
 * Resolve Flow TV cookie file path.
 * Priority: FLOW_TV_COOKIES_FILE env var -> data/flow-cookies.json.
 */
export function getFlowCookieFilePath(): string | null {
  const envPath = process.env.FLOW_TV_COOKIES_FILE;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (fs.existsSync(DATA_FLOW_COOKIE_PATH)) return DATA_FLOW_COOKIE_PATH;
  return null;
}

export function getFlowDataCookiePath(): string {
  return DATA_FLOW_COOKIE_PATH;
}
