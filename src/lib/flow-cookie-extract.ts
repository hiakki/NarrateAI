import puppeteer, { type Browser, type Page } from "puppeteer-core";
import crypto from "crypto";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { getFlowDataCookiePath } from "@/lib/flow-cookie-path";

// Mirrors the meta file written by /api/settings/flow-cookies POST so the
// UI can report a single "Logged in (N cookies, saved <ago>)" status
// regardless of whether cookies were uploaded manually or extracted via
// the in-app login button.
const META_PATH = path.join(process.cwd(), "data", "flow-cookie-meta.json");

function fingerprintCookies(
  cookies: Array<{ name: string; value: string; domain: string; path: string }>,
): string {
  const normalized = [...cookies]
    .map((c) => `${c.name}|${c.domain ?? ""}|${c.path ?? "/"}|${c.value}`)
    .sort()
    .join("\n");
  return crypto.createHash("md5").update(normalized).digest("hex");
}

const FLOW_URL = "https://labs.google/fx/tools/flow";

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
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

function findChrome(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of CHROME_PATHS[process.platform] ?? []) {
    if (p && fsSync.existsSync(p)) return p;
  }
  return null;
}

async function applyStealth(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  );
}

type FlowCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

// Names of the Google session cookies that get set after a real Google login.
// We treat the user as authenticated once at least two of these are present
// for a google.com domain — that's a far more reliable signal than scraping
// the visible page text (which still contains "sign in"/"log in" in
// tooltips, footers, and account chips even AFTER login).
const GOOGLE_AUTH_COOKIE_NAMES = new Set([
  "SID",
  "SAPISID",
  "HSID",
  "SSID",
  "APISID",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PSIDTS",
  "__Secure-3PSIDTS",
  "LSID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
]);

interface RawCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

function countGoogleAuthCookies(cookies: RawCookie[]): number {
  let n = 0;
  for (const c of cookies) {
    if (!c.domain.includes("google.com")) continue;
    if (!c.value || c.value.length < 10) continue;
    if (GOOGLE_AUTH_COOKIE_NAMES.has(c.name)) n++;
  }
  return n;
}

// CTA-text detection: presence of an explicit sign-in / continue-with-google
// button proves we are STILL logged out (Flow's home page only renders these
// buttons on the unauthenticated landing). Mirrors flow-tv-phase1's
// isLoggedInToFlow so behaviour stays consistent across the cookie-extract
// path and real run-machine path.
async function hasSignInCta(page: Page): Promise<boolean> {
  return await page
    .evaluate(() => {
      const els = Array.from(document.querySelectorAll("button, a"));
      for (const el of els) {
        const t = (el.textContent || "").trim().toLowerCase();
        if (!t || t.length > 40) continue;
        if (
          t === "sign in" ||
          t === "log in" ||
          t === "sign in with google" ||
          t === "continue with google" ||
          t === "log in with google"
        ) {
          return true;
        }
      }
      return false;
    })
    .catch(() => false);
}

export async function extractFlowCookiesViaGoogleLogin(): Promise<{
  success: boolean;
  message: string;
  cookieCount: number;
}> {
  const chromePath = findChrome();
  if (!chromePath) {
    return {
      success: false,
      message: "Chrome/Chromium not found. Install Chrome or set CHROME_PATH.",
      cookieCount: 0,
    };
  }

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      defaultViewport: { width: 1366, height: 850 },
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "--disable-extensions",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    const page = (await browser.pages())[0] ?? (await browser.newPage());
    await applyStealth(page);
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });

    let loggedIn = false;
    let lastUrl = "";
    let lastAuthCount = 0;
    let stableHits = 0;
    const cdp = await page.createCDPSession();

    // Poll every 2s for up to ~10 minutes. The user is authenticated when:
    //   1. We're back on labs.google (no longer on accounts.google.com), AND
    //   2. The Flow page no longer renders an explicit sign-in CTA, AND
    //   3. At least 2 Google session cookies (SID/SAPISID/...) are present.
    // We require these conditions to remain stable for two consecutive polls
    // before declaring success — that avoids racing the consent screen.
    for (let i = 0; i < 300; i++) {
      // Browser-closed guard. If the user closed the window themselves we
      // bail out cleanly instead of looping forever.
      try {
        const pages = await browser.pages();
        if (pages.length === 0) {
          return { success: false, message: "Browser was closed before login completed.", cookieCount: 0 };
        }
      } catch {
        return { success: false, message: "Browser was closed before login completed.", cookieCount: 0 };
      }

      let url = "";
      try {
        url = page.url().toLowerCase();
      } catch {
        return { success: false, message: "Browser tab was closed before login completed.", cookieCount: 0 };
      }
      if (url !== lastUrl) {
        // eslint-disable-next-line no-console
        console.log(`[flow-cookie-extract] page is at ${url}`);
        lastUrl = url;
      }

      const inGoogleAuth = url.includes("accounts.google.com");
      const onLabs = url.includes("labs.google");
      const onSigninPath =
        url.includes("/signin") || url.includes("consent") || url.includes("oauthchooseaccount");

      let cookies: RawCookie[] = [];
      try {
        const r = (await cdp.send("Network.getAllCookies")) as { cookies: RawCookie[] };
        cookies = r.cookies;
      } catch {
        // CDP transient failure — try again on the next tick.
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }
      const authCount = countGoogleAuthCookies(cookies);
      if (authCount !== lastAuthCount) {
        // eslint-disable-next-line no-console
        console.log(`[flow-cookie-extract] google auth cookies present: ${authCount}`);
        lastAuthCount = authCount;
      }

      let stableNow = false;
      if (!inGoogleAuth && onLabs && !onSigninPath && authCount >= 2) {
        const cta = await hasSignInCta(page);
        if (!cta) stableNow = true;
      }

      if (stableNow) {
        stableHits++;
        if (stableHits >= 2) {
          loggedIn = true;
          break;
        }
      } else {
        stableHits = 0;
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!loggedIn) {
      return { success: false, message: "Login timed out (10 minutes). Please try again.", cookieCount: 0 };
    }

    const { cookies } = (await cdp.send("Network.getAllCookies")) as { cookies: RawCookie[] };

    const filtered: FlowCookie[] = cookies
      .filter((c) => c.domain.includes("google.com") || c.domain.includes("labs.google"))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        expires: typeof c.expires === "number" ? c.expires : -1,
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        sameSite: c.sameSite === "Strict" || c.sameSite === "None" ? c.sameSite : "Lax",
      }));

    if (filtered.length === 0) {
      return { success: false, message: "Login detected but no Google/Flow cookies found.", cookieCount: 0 };
    }

    const outPath = getFlowDataCookiePath();
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(filtered, null, 2), "utf-8");

    // Write meta so /api/settings/flow-cookies GET reports savedAt + count
    // (and so the UI can persist the "Logged in" badge across reloads).
    const meta = {
      savedAt: new Date().toISOString(),
      cookieCount: filtered.length,
      fingerprint: fingerprintCookies(filtered),
    };
    await fs.mkdir(path.dirname(META_PATH), { recursive: true });
    await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf-8");

    return { success: true, message: `Saved ${filtered.length} Flow cookies.`, cookieCount: filtered.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, message: `Flow login extraction failed: ${msg}`, cookieCount: 0 };
  } finally {
    try {
      if (browser) await browser.close();
    } catch {}
  }
}
