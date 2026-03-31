import puppeteer, { type Browser, type Page } from "puppeteer-core";
import * as fs from "fs/promises";
import * as path from "path";
import { getDataCookiePath } from "./cookie-path";

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  ],
};

function findChrome(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = CHROME_PATHS[process.platform] ?? [];
  const fsSync = require("fs") as typeof import("fs");
  for (const p of candidates) {
    if (!p || p.startsWith("\\")) continue;
    if (fsSync.existsSync(p)) return p;
  }
  return null;
}

const REALISTIC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function applyStealthToPage(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });

    // @ts-expect-error - overriding browser internals
    window.navigator.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };

    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });

    Object.defineProperty(navigator, "plugins", {
      get: () => [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
        { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
      ],
    });

    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (params: { name: string }) =>
      params.name === "notifications"
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : origQuery(params as PermissionDescriptor);
  });
  await page.setUserAgent(REALISTIC_UA);
}

interface ExtractProgress {
  status: "launching" | "waiting_login" | "extracting" | "done" | "error";
  message: string;
  platform?: string;
}

type ProgressCallback = (p: ExtractProgress) => void;

function cookieToNetscape(c: { name: string; value: string; domain: string; path: string; secure: boolean; expires: number; httpOnly: boolean }): string {
  const httpOnly = c.httpOnly ? "#HttpOnly_" : "";
  const domain = c.domain.startsWith(".") ? c.domain : `.${c.domain}`;
  const flag = "TRUE";
  const secureTxt = c.secure ? "TRUE" : "FALSE";
  const expiry = c.expires > 0 ? Math.floor(c.expires) : "0";
  return `${httpOnly}${domain}\t${flag}\t${c.path}\t${secureTxt}\t${expiry}\t${c.name}\t${c.value}`;
}

/**
 * Open a visible Chrome window, navigate to the target platform's login page,
 * wait for the user to log in, then extract cookies and save them.
 */
export async function extractPlatformCookies(
  platform: "facebook" | "instagram" | "both",
  onProgress?: ProgressCallback,
): Promise<{ success: boolean; message: string; cookieCount: number }> {
  const chromePath = findChrome();
  if (!chromePath) {
    return { success: false, message: "Chrome/Chromium not found. Install Google Chrome.", cookieCount: 0 };
  }

  onProgress?.({ status: "launching", message: "Opening browser...", platform });

  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      defaultViewport: { width: 520, height: 750 },
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        `--window-size=520,750`,
        "--window-position=100,50",
        "--auto-open-devtools-for-tabs=false",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    await applyStealthToPage(page);

    const urls = platform === "instagram"
      ? ["https://www.instagram.com/accounts/login/"]
      : platform === "facebook"
      ? ["https://www.facebook.com/login/"]
      : ["https://www.facebook.com/login/"];

    await page.goto(urls[0], { waitUntil: "domcontentloaded", timeout: 30_000 });

    onProgress?.({ status: "waiting_login", message: "Please log in to your account in the browser window...", platform });

    const loginIndicators = platform === "instagram"
      ? ["sessionid", "ds_user_id", "ig_did"]
      : ["c_user", "xs", "datr", "sb"];

    const cdp = await page.createCDPSession();

    let loggedIn = false;
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      try {
        const { cookies } = await cdp.send("Network.getAllCookies") as {
          cookies: Array<{ name: string; value: string; domain: string }>;
        };

        const fbCookies = cookies.filter((c) =>
          c.domain.includes("facebook.com") || c.domain.includes("instagram.com"),
        );

        if (i % 5 === 4) {
          const fbOnly = fbCookies.filter((c) => c.domain.includes("facebook.com"));
          const igOnly = fbCookies.filter((c) => c.domain.includes("instagram.com"));
          const plat = platform === "instagram" ? "IG" : "FB";
          const relevant = platform === "instagram" ? igOnly : fbOnly;
          const names = relevant.map((c) => c.name).join(", ");
          console.log(`[cookie-check ${i * 2}s] [${plat}] cookies (${relevant.length}): ${names.slice(0, 200)}`);
        }

        // Detect login: c_user for FB, sessionid for IG - the definitive cookie
        const primaryIndicator = platform === "instagram" ? "sessionid" : "c_user";
        const hasLogin = fbCookies.some((c) => c.name === primaryIndicator && c.value);

        if (hasLogin) {
          console.log(`[cookie-check] Login detected via "${primaryIndicator}" cookie!`);
          loggedIn = true;
          break;
        }

        // Checkpoint detection - warn user
        const isCheckpoint = fbCookies.some((c) => c.name === "checkpoint" && c.value);
        if (isCheckpoint && i % 5 === 4) {
          console.log(`[cookie-check] Facebook checkpoint detected - please complete verification in the browser`);
        }
      } catch {
        break;
      }

      try {
        await browser.pages();
      } catch {
        return { success: false, message: "Browser was closed before login completed.", cookieCount: 0 };
      }
    }

    if (!loggedIn) {
      return { success: false, message: "Login timed out (5 minutes). Please try again.", cookieCount: 0 };
    }

    onProgress?.({ status: "extracting", message: "Login detected! Extracting cookies...", platform });

    // If "both", also navigate to the other platform to capture those cookies
    if (platform === "both") {
      try {
        await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 15_000 });
        await new Promise((r) => setTimeout(r, 3000));
      } catch { /* IG might not be logged in, that's OK */ }
    }

    // Extract all cookies from the browser
    const { cookies: allCookies } = await cdp.send("Network.getAllCookies") as {
      cookies: Array<{ name: string; value: string; domain: string; path: string; secure: boolean; expires: number; httpOnly: boolean }>;
    };

    // Filter to relevant domains
    const relevantDomains = [".facebook.com", ".instagram.com", ".fbcdn.net", ".fbsbx.com"];
    const filtered = allCookies.filter((c) =>
      relevantDomains.some((d) => c.domain.endsWith(d) || c.domain === d.slice(1)),
    );

    if (filtered.length === 0) {
      return { success: false, message: "No relevant cookies found after login.", cookieCount: 0 };
    }

    // Convert to Netscape format
    const lines = [
      "# Netscape HTTP Cookie File",
      "# Extracted by NarrateAI",
      `# ${new Date().toISOString()}`,
      "",
      ...filtered.map(cookieToNetscape),
    ];

    // Save
    const cookiePath = getDataCookiePath();
    await fs.mkdir(path.dirname(cookiePath), { recursive: true });

    // Only replace cookies for the platform being extracted (preserve other platforms)
    const replaceDomains = platform === "instagram"
      ? [".instagram.com", ".cdninstagram.com"]
      : platform === "facebook"
      ? [".facebook.com", ".fbcdn.net", ".fbsbx.com"]
      : relevantDomains;

    let existingLines: string[] = [];
    try {
      const existing = await fs.readFile(cookiePath, "utf-8");
      existingLines = existing.split("\n").filter((l) => {
        if (!l.trim() || l.startsWith("#")) return false;
        return !replaceDomains.some((d) => l.includes(d));
      });
    } catch { /* no existing file */ }

    const finalContent = [...lines, ...existingLines].join("\n") + "\n";
    await fs.writeFile(cookiePath, finalContent, "utf-8");

    onProgress?.({ status: "done", message: `Saved ${filtered.length} cookies`, platform });

    return { success: true, message: `Saved ${filtered.length} cookies for content discovery.`, cookieCount: filtered.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Cookie extraction failed: ${msg}`, cookieCount: 0 };
  } finally {
    try {
      if (browser) await browser.close();
    } catch { /* already closed */ }
  }
}
