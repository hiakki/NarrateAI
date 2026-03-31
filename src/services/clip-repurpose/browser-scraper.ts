import puppeteer, { type Browser, type Page, type HTTPRequest } from "puppeteer-core";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { createLogger } from "@/lib/logger";
import { getDataCookiePath, getCookieFilePath } from "@/lib/cookie-path";

const log = createLogger("BrowserScraper");

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

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function findChrome(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const fsSync = require("fs") as typeof import("fs");
  for (const p of CHROME_PATHS[process.platform] ?? []) {
    if (!p || p.startsWith("\\")) continue;
    if (fsSync.existsSync(p)) return p;
  }
  return null;
}

export interface ScrapedVideo {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  viewCount: number;
  durationSec: number;
  platform: "facebook" | "instagram";
}

/**
 * Load Netscape-format cookies from disk and convert to Puppeteer format.
 * Handles Windows \r\n line endings and validates fields before passing to CDP.
 */
async function loadCookiesForPuppeteer(
  domain: string,
): Promise<Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; expires: number }>> {
  const cookiePath = getCookieFilePath();
  if (!cookiePath) return [];

  try {
    const text = await fs.readFile(cookiePath, "utf-8");
    const cookies: Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; expires: number }> = [];

    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("# ")) continue;

      const isHttpOnly = line.startsWith("#HttpOnly_");
      const stripped = isHttpOnly ? line.slice(10) : line;
      const parts = stripped.split("\t").map((f) => f.trim());
      if (parts.length < 7) continue;

      const [dom, , pth, sec, exp, name, value] = parts;
      if (!dom || !dom.includes(domain)) continue;
      if (!name) continue;

      const expNum = Number(exp) || 0;
      if (expNum > 0 && expNum < Date.now() / 1000) continue;

      cookies.push({
        name,
        value: value ?? "",
        domain: dom.startsWith(".") ? dom : `.${dom}`,
        path: pth || "/",
        secure: sec === "TRUE",
        httpOnly: isHttpOnly,
        expires: expNum || -1,
      });
    }

    return cookies;
  } catch {
    return [];
  }
}

async function launchBrowser(): Promise<Browser> {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome/Chromium not found");

  return puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
      "--disable-gpu",
      "--no-first-run",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

async function prepPage(browser: Browser, domain: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.evaluateOnNewDocument("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})");
  await page.setViewport({ width: 1280, height: 900 });

  const cookies = await loadCookiesForPuppeteer(domain);
  if (cookies.length > 0) {
    try {
      await page.setCookie(...cookies);
      log.log(`Loaded ${cookies.length} cookies for ${domain}`);
    } catch (cookieErr) {
      log.warn(`[${domain}] Failed to set ${cookies.length} cookies, continuing without: ${cookieErr instanceof Error ? cookieErr.message : cookieErr}`);
    }
  }

  return page;
}

function parseViewCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/,/g, "").trim().toLowerCase();
  const m = cleaned.match(/([\d.]+)\s*(k|m|b)?/);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  const suffix = m[2];
  if (suffix === "k") return Math.round(num * 1_000);
  if (suffix === "m") return Math.round(num * 1_000_000);
  if (suffix === "b") return Math.round(num * 1_000_000_000);
  return Math.round(num);
}

// ---------------------------------------------------------------------------
// Facebook search-based discovery (response interception + DOM fallback)
// ---------------------------------------------------------------------------

interface FbInterceptedVideo {
  id: string;
  url: string;
  title: string;
  channelName: string;
  viewCount: number;
}

function extractVideosFromFbJson(
  json: unknown,
  results: Map<string, FbInterceptedVideo>,
  maxItems: number,
): void {
  if (results.size >= maxItems || !json || typeof json !== "object") return;

  const obj = json as Record<string, unknown>;

  // FB GraphQL video node shapes: look for video IDs + view counts in nested data
  const id = obj.id ?? obj.videoId ?? obj.video_id;
  const viewCount =
    (obj.video_view_count as number) ??
    (obj.play_count as number) ??
    (obj.view_count as number) ??
    (typeof obj.feedback === "object" && obj.feedback
      ? (obj.feedback as Record<string, unknown>).video_view_count as number
      : undefined);

  if (id && typeof id === "string" && /^\d+$/.test(id) && typeof viewCount === "number" && viewCount > 0) {
    if (!results.has(id)) {
      const title =
        (typeof obj.title === "object" && obj.title ? (obj.title as Record<string, unknown>).text : obj.title) ??
        obj.message ??
        obj.name ??
        "";
      const owner =
        typeof obj.owner === "object" && obj.owner ? (obj.owner as Record<string, unknown>).name ?? "" : "";
      results.set(id, {
        id,
        url: `https://www.facebook.com/watch/?v=${id}`,
        title: String(title || ""),
        channelName: String(owner || ""),
        viewCount,
      });
    }
  }

  // Recurse into arrays and nested objects
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      for (const item of val) extractVideosFromFbJson(item, results, maxItems);
    } else if (val && typeof val === "object") {
      extractVideosFromFbJson(val, results, maxItems);
    }
  }
}

export async function searchFbVideos(
  query: string,
  maxItems = 15,
): Promise<ScrapedVideo[]> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await prepPage(browser, "facebook.com");

    const intercepted = new Map<string, FbInterceptedVideo>();

    // Intercept ALL JSON responses (FB uses many internal API endpoints)
    page.on("response", async (response) => {
      try {
        const ct = response.headers()["content-type"] ?? "";
        if (!ct.includes("json") && !ct.includes("javascript")) return;
        const status = response.status();
        if (status < 200 || status >= 400) return;
        const text = await response.text();
        if (!text.includes("video") && !text.includes("play_count") && !text.includes("view_count")) return;
        for (const chunk of text.split("\n")) {
          const trimmed = chunk.trim();
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
          try {
            const json = JSON.parse(trimmed);
            extractVideosFromFbJson(json, intercepted, maxItems);
          } catch { /* not JSON */ }
        }
      } catch { /* response body unavailable */ }
    });

    const searchUrl = `https://www.facebook.com/search/videos/?q=${encodeURIComponent(query)}`;
    log.log(`[FB] Searching: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 5000));

    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.scrollBy(0, 2500));
      await new Promise((r) => setTimeout(r, 2000));
    }

    log.log(`[FB] Intercepted ${intercepted.size} video(s) from API responses`);

    // --- DOM fallback if interception got nothing ---
    if (intercepted.size === 0) {
      log.log(`[FB] Falling back to DOM extraction...`);
      const domVideos = await page.evaluate((max: number) => {
        const results: Array<{ url: string; title: string; views: string; vidId: string; channelName: string }> = [];
        const seenIds: Record<string, boolean> = {};

        const links = document.querySelectorAll(
          'a[href*="/watch/"], a[href*="/reel/"], a[href*="/videos/"], a[href*="fb.watch"]',
        );
        for (const link of links) {
          if (results.length >= max) break;
          const href = (link as HTMLAnchorElement).href || "";
          if (!href) continue;

          const vidMatch = href.match(/(?:\/watch\/?\?v=|\/reel\/|\/videos\/|fb\.watch\/)(\d+)/);
          if (!vidMatch) continue;
          const vidId = vidMatch[1];
          if (seenIds[vidId]) continue;
          seenIds[vidId] = true;

          // Walk up to find a reasonable container
          let container: Element | null =
            link.closest('[role="article"]') ??
            link.closest('[role="listitem"]') ??
            link.closest('[data-pagelet]');
          if (!container) {
            container = link.parentElement;
            for (let p = 0; p < 5 && container?.parentElement; p++) container = container.parentElement;
          }
          const text = container?.textContent ?? "";

          let views = "";
          const vPats = [
            /(\d[\d,.]*\s*[KkMmBb])\s*(?:views|Views|plays|Plays)/,
            /(\d[\d,.]+)\s*(?:views|Views|plays|Plays)/,
          ];
          for (const pat of vPats) {
            const m = text.match(pat);
            if (m) { views = m[1]; break; }
          }

          const spans = container?.querySelectorAll("span") ?? [];
          let title = "";
          let channelName = "";
          for (const span of spans) {
            const t = span.textContent?.trim() ?? "";
            if (!channelName && t.length > 2 && t.length < 60 && !/^(\d|All reactions|Like|Comment|Share|Verified)/i.test(t)) {
              channelName = t;
            }
            if (!title && t.length > 15 && t.length < 300
              && !/^(All reactions|\d+ comment|\d+ share|Like|Comment|Share|Verified)/i.test(t)
              && !/^\d+[KkMmBb]?$/.test(t)) {
              title = t;
            }
          }
          results.push({ url: href, title, views, vidId, channelName });
        }
        return results;
      }, maxItems);

      log.log(`[FB] DOM fallback found ${domVideos.length} video(s)`);

      return domVideos.map((v) => {
        let title = (v.title || "").replace(/\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*ago.*$/i, "").trim();
        if (!title || title.length < 5) title = `FB Video: ${query}`;
        return {
          videoId: v.vidId || "",
          url: v.url,
          title,
          channelName: v.channelName || "Facebook",
          viewCount: parseViewCount(v.views),
          durationSec: 0,
          platform: "facebook" as const,
        };
      });
    }

    // Return intercepted results
    return [...intercepted.values()].slice(0, maxItems).map((v) => {
      let title = (v.title || "").replace(/\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*ago.*$/i, "").trim();
      if (!title || title.length < 5) title = `FB Video: ${query}`;
      return {
        videoId: v.id,
        url: v.url,
        title,
        channelName: v.channelName || "Facebook",
        viewCount: v.viewCount,
        durationSec: 0,
        platform: "facebook" as const,
      };
    });
  } catch (err) {
    log.warn(`[FB] Search failed for "${query}": ${err instanceof Error ? err.message : err}`);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Instagram search-based discovery (explore tags)
// ---------------------------------------------------------------------------
export async function searchIgReels(
  query: string,
  maxItems = 15,
): Promise<ScrapedVideo[]> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await prepPage(browser, "instagram.com");

    const tag = query.replace(/\s+/g, "").toLowerCase();
    const tagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
    log.log(`[IG] Searching tag: ${tagUrl}`);
    await page.goto(tagUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await new Promise((r) => setTimeout(r, 2000));
    }

    const reels = await page.evaluate((max: number) => {
      const results: Array<{ url: string; views: string }> = [];
      const seen = new Set<string>();

      const links = document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]');
      for (const link of links) {
        if (results.length >= max) break;
        const href = (link as HTMLAnchorElement).href;
        if (seen.has(href)) continue;
        seen.add(href);

        const container = link.closest("div");
        const viewSpans = container?.querySelectorAll("span") || [];
        let views = "";
        for (const span of viewSpans) {
          const text = span.textContent?.trim() || "";
          if (/[\d,.]+[KkMm]?/.test(text) && text.length < 20) {
            views = text;
            break;
          }
        }
        results.push({ url: href, views });
      }
      return results;
    }, maxItems);

    log.log(`[IG] Tag search found ${reels.length} reel(s) for #${tag}`);

    return reels.map((r) => ({
      videoId: (r.url.match(/\/reel\/([^/]+)/) || r.url.match(/\/p\/([^/]+)/) || [])[1] || "",
      url: r.url,
      title: `#${tag} reel`,
      channelName: `#${tag}`,
      viewCount: parseViewCount(r.views),
      durationSec: 0,
      platform: "instagram" as const,
    }));
  } catch (err) {
    log.warn(`[IG] Tag search failed for "${query}": ${err instanceof Error ? err.message : err}`);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Facebook page discovery (response interception + DOM fallback)
// ---------------------------------------------------------------------------
export async function discoverFbPageVideos(
  pageUrl: string,
  maxItems = 15,
): Promise<ScrapedVideo[]> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await prepPage(browser, "facebook.com");

    const intercepted = new Map<string, FbInterceptedVideo>();

    // Widen interception: capture ALL JSON responses (FB uses many internal endpoints)
    page.on("response", async (response) => {
      try {
        const ct = response.headers()["content-type"] ?? "";
        if (!ct.includes("json") && !ct.includes("javascript") && !ct.includes("text/html")) return;
        const status = response.status();
        if (status < 200 || status >= 400) return;
        const text = await response.text();
        if (!text.includes("video") && !text.includes("play_count") && !text.includes("view_count")) return;
        for (const chunk of text.split("\n")) {
          const trimmed = chunk.trim();
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
          try {
            const json = JSON.parse(trimmed);
            extractVideosFromFbJson(json, intercepted, maxItems);
          } catch { /* not JSON */ }
        }
      } catch { /* response body unavailable */ }
    });

    log.log(`[FB] Navigating to ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 5000));

    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("checkpoint")) {
      log.warn(`[FB] Login wall detected (redirected to ${currentUrl})`);
      return [];
    }

    for (let i = 0; i < 14; i++) {
      await page.evaluate(() => window.scrollBy(0, 2500));
      await new Promise((r) => setTimeout(r, 2000));
    }

    log.log(`[FB] Intercepted ${intercepted.size} video(s) from API responses on ${pageUrl}`);

    const pageNameMatch = pageUrl.match(/facebook\.com\/([^/?]+)/);
    const pageName = pageNameMatch ? pageNameMatch[1] : "Unknown";

    if (intercepted.size > 0) {
      return [...intercepted.values()].slice(0, maxItems).map((v) => {
        let title = (v.title || "").replace(/\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*ago.*$/i, "").trim();
        if (!title || title.length < 5) title = `Video from ${pageName}`;
        return {
          videoId: v.id,
          url: v.url,
          title,
          channelName: v.channelName || pageName,
          viewCount: v.viewCount,
          durationSec: 0,
          platform: "facebook" as const,
        };
      });
    }

    // --- DOM + HTML source fallback ---
    log.log(`[FB] Falling back to DOM + HTML extraction for ${pageUrl}...`);
    const domResult = await page.evaluate((max: number) => {
      const results: Array<{ url: string; title: string; views: string; vidId: string }> = [];
      const seenIds: Record<string, boolean> = {};
      const bodyText = document.body?.textContent ?? "";
      const html = document.documentElement.innerHTML;
      const htmlLen = html.length;

      // Strategy 1: Standard link selectors
      const links = document.querySelectorAll(
        'a[href*="/watch/"], a[href*="/reel/"], a[href*="/videos/"], a[href*="fb.watch"]',
      );
      for (const link of links) {
        if (results.length >= max) break;
        const href = (link as HTMLAnchorElement).href || "";
        if (!href) continue;
        const vidMatch = href.match(/(?:\/watch\/?\?v=|\/reel\/|\/videos\/|fb\.watch\/)(\d+)/);
        if (!vidMatch) continue;
        const vidId = vidMatch[1];
        if (seenIds[vidId]) continue;
        seenIds[vidId] = true;

        let container: Element | null =
          link.closest('[role="article"]') ?? link.closest('[role="listitem"]') ??
          link.closest('[data-pagelet]');
        if (!container) {
          container = link.parentElement;
          for (let p = 0; p < 5 && container?.parentElement; p++) container = container.parentElement;
        }
        const text = container?.textContent ?? "";
        let views = "";
        for (const pat of [
          /(\d[\d,.]*\s*[KkMmBb])\s*(?:views|Views|plays|Plays)/,
          /(\d[\d,.]+)\s*(?:views|Views|plays|Plays)/,
        ]) {
          const m = text.match(pat);
          if (m) { views = m[1]; break; }
        }
        const spans = container?.querySelectorAll("span") ?? [];
        let title = "";
        for (const span of spans) {
          const t = span.textContent?.trim() ?? "";
          if (t.length > 15 && t.length < 300
            && !/^(All reactions|\d+ comment|\d+ share|Like|Comment|Share|Verified)/i.test(t)
            && !/^\d+[KkMmBb]?$/.test(t)
            && !/(reels$|'s reels$)/i.test(t)) { title = t; break; }
        }
        results.push({ url: href, title, views, vidId });
      }

      // Strategy 2: Extract video IDs from HTML source (FB embeds them in JSON data in scripts)
      if (results.length < max) {
        const vidIdPat = /\"videoId\"\s*:\s*\"(\d{10,})\"|\"video_id\"\s*:\s*\"(\d{10,})\"|\/videos\/(\d{10,})/g;
        let m2;
        while ((m2 = vidIdPat.exec(html)) !== null && results.length < max) {
          const vid = m2[1] || m2[2] || m2[3];
          if (!vid || seenIds[vid]) continue;
          seenIds[vid] = true;
          results.push({
            url: `https://www.facebook.com/watch/?v=${vid}`,
            title: "",
            views: "",
            vidId: vid,
          });
        }
      }

      const linkSample = Array.from(document.querySelectorAll("a"))
        .slice(0, 200)
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h && (h.includes("video") || h.includes("watch") || h.includes("reel")))
        .slice(0, 10);

      return {
        results,
        htmlLen,
        hasLogin: bodyText.includes("Log in") || bodyText.includes("Log Into"),
        linkSample,
      };
    }, maxItems) as {
      results: Array<{ url: string; title: string; views: string; vidId: string }>;
      htmlLen: number;
      hasLogin: boolean;
      linkSample: string[];
    };

    log.log(`[FB] DOM+HTML extraction found ${domResult.results.length} video(s), HTML=${domResult.htmlLen} chars, loginPrompt=${domResult.hasLogin}`);
    if (domResult.linkSample.length > 0) {
      log.log(`[FB] Sample video-related links: ${domResult.linkSample.join(" | ")}`);
    }
    if (domResult.results.length === 0 && domResult.hasLogin) {
      log.warn(`[FB] Page appears to require login — cookies may be expired`);
    }

    return domResult.results.map((v) => {
      let title = (v.title || "").replace(/\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*ago.*$/i, "").trim();
      if (!title || title.length < 5) title = `Video from ${pageName}`;
      return {
        videoId: v.vidId || "",
        url: v.url,
        title,
        channelName: pageName,
        viewCount: parseViewCount(v.views),
        durationSec: 0,
        platform: "facebook" as const,
      };
    });
  } catch (err) {
    log.warn(`[FB] Discovery failed for ${pageUrl}: ${err instanceof Error ? err.message : err}`);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Facebook video download: intercept CDN URLs
// ---------------------------------------------------------------------------
export async function downloadFbVideo(
  videoUrl: string,
  outputDir?: string,
): Promise<{ videoPath: string; title: string; durationSec: number; viewCount: number } | null> {
  let browser: Browser | null = null;
  const tmpDir = outputDir || await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-fb-"));

  try {
    browser = await launchBrowser();
    const page = await prepPage(browser, "facebook.com");

    const interceptedVideoUrls: string[] = [];

    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");

    // Intercept all responses to catch video CDN URLs
    cdp.on("Network.responseReceived", (event: { response: { url: string; mimeType: string } }) => {
      const { url, mimeType } = event.response;
      if (
        (mimeType?.startsWith("video/") || /\.mp4(\?|$)/.test(url)) &&
        (url.includes("fbcdn.net") || url.includes("scontent"))
      ) {
        interceptedVideoUrls.push(url);
      }
    });

    // Normalize to mobile watch URL which reliably exposes video source
    const videoIdMatch = videoUrl.match(/(?:\/watch\/?\?v=|\/reel\/|\/videos\/)(\d+)/);
    const videoId = videoIdMatch?.[1];
    const mobileUrl = videoId
      ? `https://m.facebook.com/watch/?v=${videoId}`
      : videoUrl.replace("www.facebook.com", "m.facebook.com").replace("web.facebook.com", "m.facebook.com");
    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    );
    log.log(`[FB] Loading video page (mobile): ${mobileUrl}`);
    await page.goto(mobileUrl, { waitUntil: "networkidle2", timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 3000));

    // Extract video URL and metadata from mobile page (string-eval to avoid esbuild __name issue)
    const extractScript = `
      (function() {
        var urls = [];
        var video = document.querySelector("video");
        if (video && video.src && video.src.indexOf("http")===0) urls.push(video.src);
        var og = document.querySelector('meta[property="og:video:secure_url"]');
        if (og && og.content) urls.push(og.content);
        var og2 = document.querySelector('meta[property="og:video"]');
        if (og2 && og2.content) urls.push(og2.content);

        // Search for CDN video URLs in the full HTML (FB embeds them in script data)
        var html = document.documentElement.innerHTML;
        var cdnPat = /https:\\/\\/scontent[^"\\s]*?\\.mp4[^"\\s]*/g;
        var m;
        while ((m = cdnPat.exec(html))) {
          var u = m[0].replace(/&amp;/g, "&");
          if (u.length > 50) urls.push(u);
        }

        var titleEl = document.querySelector('meta[property="og:title"]');
        var title = titleEl ? titleEl.getAttribute("content") || document.title : document.title;
        var allText = document.body.textContent || "";
        var viewMatch = allText.match(/(\\d[\\d,.]*[KkMmBb]?)\\s*(?:views|Views)/);
        return { urls: urls, title: title || "", views: viewMatch ? viewMatch[1] : "0" };
      })()
    `;
    const extracted = await page.evaluate(extractScript) as {
      urls: string[]; title: string; views: string; duration?: number;
    };

    const allUrls = [...new Set([...extracted.urls, ...interceptedVideoUrls])];
    log.log(`[FB] Found ${allUrls.length} video URL(s) (${extracted.urls.length} page, ${interceptedVideoUrls.length} intercepted)`);

    if (allUrls.length === 0) {
      log.warn("[FB] No video URLs found");
      return null;
    }

    const bestUrl = allUrls[0];
    const outPath = path.join(tmpDir, "fb-video.mp4");

    // Download using Node fetch with cookies from browser
    const allCookies = await cdp.send("Network.getAllCookies") as { cookies: Array<{ name: string; value: string; domain: string }> };
    const cookieHeader = allCookies.cookies
      .filter((c) => c.domain.includes("facebook.com"))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const response = await fetch(bestUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15",
        Cookie: cookieHeader,
        Referer: "https://m.facebook.com/",
      },
      redirect: "follow",
    });

    if (!response.ok || !response.body) {
      throw new Error(`Video download failed: HTTP ${response.status}`);
    }

    const chunks: Buffer[] = [];
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    const videoBuffer = Buffer.concat(chunks);
    await fs.writeFile(outPath, videoBuffer);

    const sizeMb = (videoBuffer.length / 1024 / 1024).toFixed(1);
    log.log(`[FB] Downloaded video: ${sizeMb}MB → ${outPath}`);

    // Get duration from file if not available from page
    let duration = extracted.duration;
    if (!duration) {
      try {
        const { execSync } = require("child_process");
        const probe = execSync(
          `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outPath}"`,
        ).toString().trim();
        duration = parseFloat(probe) || 0;
      } catch { /* ok */ }
    }

    return {
      videoPath: outPath,
      title: extracted.title && extracted.title !== "Facebook" ? extracted.title : `FB Video`,
      durationSec: duration ?? 0,
      viewCount: parseViewCount(extracted.views),
    };
  } catch (err) {
    log.warn(`[FB] Download failed for ${videoUrl}: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Instagram discovery: scrape profile reels (API interception + DOM fallback)
// ---------------------------------------------------------------------------

interface IgInterceptedReel {
  id: string;
  url: string;
  playCount: number;
}

function extractReelsFromIgJson(
  json: unknown,
  results: Map<string, IgInterceptedReel>,
  maxItems: number,
): void {
  if (results.size >= maxItems || !json || typeof json !== "object") return;

  const obj = json as Record<string, unknown>;

  // IG GraphQL node shapes: clips (reels) have code/shortcode + play_count/video_view_count
  const code = obj.code ?? obj.shortcode;
  const playCount =
    (obj.play_count as number) ??
    (obj.video_play_count as number) ??
    (obj.video_view_count as number) ??
    (typeof obj.media === "object" && obj.media
      ? (obj.media as Record<string, unknown>).play_count as number
      : undefined);

  if (code && typeof code === "string" && code.length > 5 && typeof playCount === "number" && playCount > 0) {
    if (!results.has(code)) {
      results.set(code, {
        id: code,
        url: `https://www.instagram.com/reel/${code}/`,
        playCount,
      });
    }
  }

  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      for (const item of val) extractReelsFromIgJson(item, results, maxItems);
    } else if (val && typeof val === "object") {
      extractReelsFromIgJson(val, results, maxItems);
    }
  }
}

export async function discoverIgReels(
  profileUrl: string,
  maxItems = 15,
): Promise<ScrapedVideo[]> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await prepPage(browser, "instagram.com");

    const intercepted = new Map<string, IgInterceptedReel>();

    // Widen interception: capture ALL JSON responses
    page.on("response", async (response) => {
      try {
        const ct = response.headers()["content-type"] ?? "";
        if (!ct.includes("json") && !ct.includes("javascript")) return;
        const status = response.status();
        if (status < 200 || status >= 400) return;
        const text = await response.text();
        if (!text.includes("shortcode") && !text.includes("play_count") && !text.includes("video_")) return;
        for (const chunk of text.split("\n")) {
          const trimmed = chunk.trim();
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
          try {
            const json = JSON.parse(trimmed);
            extractReelsFromIgJson(json, intercepted, maxItems);
          } catch { /* not JSON */ }
        }
      } catch { /* response body unavailable */ }
    });

    const reelsUrl = profileUrl.replace(/\/?$/, "/reels/");
    log.log(`[IG] Navigating to ${reelsUrl}`);
    await page.goto(reelsUrl, { waitUntil: "networkidle2", timeout: 40_000 });
    await new Promise((r) => setTimeout(r, 4000));

    const currentUrl = page.url();
    if (currentUrl.includes("/accounts/login") || currentUrl.includes("/challenge")) {
      log.warn(`[IG] Login wall detected (redirected to ${currentUrl})`);
      return [];
    }

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 1500));
      await new Promise((r) => setTimeout(r, 2500));
    }

    const profileName = (profileUrl.match(/instagram\.com\/([^/?]+)/) || [])[1] || "Unknown";

    log.log(`[IG] Intercepted ${intercepted.size} reel(s) from API responses for @${profileName}`);

    if (intercepted.size > 0) {
      return [...intercepted.values()].slice(0, maxItems).map((r) => ({
        videoId: r.id,
        url: r.url,
        title: `Reel by @${profileName}`,
        channelName: profileName,
        viewCount: r.playCount,
        durationSec: 0,
        platform: "instagram" as const,
      }));
    }

    // --- DOM + HTML source fallback ---
    log.log(`[IG] Falling back to DOM + HTML extraction for @${profileName}...`);
    const domResult = await page.evaluate((max: number) => {
      const results: Array<{ url: string; views: string; code: string }> = [];
      const seen = new Set<string>();
      const html = document.documentElement.innerHTML;
      const htmlLen = html.length;
      const hasLogin = (document.body?.textContent ?? "").includes("Log in") ||
        (document.body?.textContent ?? "").includes("Sign up");

      // Strategy 1: Standard link selectors
      const links = document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]');
      for (const link of links) {
        if (results.length >= max) break;
        const href = (link as HTMLAnchorElement).href;
        if (!href.includes("/reel/") && !href.includes("/p/")) continue;
        const code = (href.match(/\/reel\/([^/]+)/) || href.match(/\/p\/([^/]+)/) || [])[1] || "";
        if (!code || seen.has(code)) continue;
        seen.add(code);

        let container: Element | null = link;
        for (let p = 0; p < 4 && container?.parentElement; p++) container = container.parentElement;
        const spans = container?.querySelectorAll("span") ?? [];
        let views = "";
        for (const span of spans) {
          const text = span.textContent?.trim() ?? "";
          if (/^[\d,.]+[KkMmBb]?$/.test(text) && text.length < 15) { views = text; break; }
        }
        results.push({ url: href, views, code });
      }

      // Strategy 2: Extract shortcodes from HTML source (IG embeds them in JSON data)
      if (results.length < max) {
        const codePat = /\"shortcode\"\s*:\s*\"([A-Za-z0-9_-]{8,})\"/g;
        let m;
        while ((m = codePat.exec(html)) !== null && results.length < max) {
          const code = m[1];
          if (seen.has(code)) continue;
          seen.add(code);
          results.push({
            url: `https://www.instagram.com/reel/${code}/`,
            views: "",
            code,
          });
        }
      }

      return { results, htmlLen, hasLogin };
    }, maxItems) as { results: Array<{ url: string; views: string; code: string }>; htmlLen: number; hasLogin: boolean };

    log.log(`[IG] DOM+HTML extraction found ${domResult.results.length} reel(s), HTML=${domResult.htmlLen} chars, loginPrompt=${domResult.hasLogin}`);

    if (domResult.results.length === 0 && domResult.hasLogin) {
      log.warn(`[IG] Profile page requires login — cookies may be expired`);
    }

    return domResult.results.map((r) => ({
      videoId: r.code || (r.url.match(/\/reel\/([^/]+)/) || r.url.match(/\/p\/([^/]+)/) || [])[1] || "",
      url: r.url,
      title: `Reel by @${profileName}`,
      channelName: profileName,
      viewCount: parseViewCount(r.views),
      durationSec: 0,
      platform: "instagram" as const,
    }));
  } catch (err) {
    log.warn(`[IG] Discovery failed for ${profileUrl}: ${err instanceof Error ? err.message : err}`);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Instagram video download
// ---------------------------------------------------------------------------
export async function downloadIgVideo(
  reelUrl: string,
  outputDir?: string,
): Promise<{ videoPath: string; title: string; durationSec: number; viewCount: number } | null> {
  let browser: Browser | null = null;
  const tmpDir = outputDir || await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-ig-"));

  try {
    browser = await launchBrowser();
    const page = await prepPage(browser, "instagram.com");

    const videoUrls: string[] = [];

    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");

    cdp.on("Network.responseReceived", (event: { response: { url: string; mimeType: string } }) => {
      const { url, mimeType } = event.response;
      if (
        (mimeType?.startsWith("video/") || url.includes(".mp4")) &&
        (url.includes("cdninstagram.com") || url.includes("fbcdn.net") || url.includes("scontent"))
      ) {
        videoUrls.push(url);
      }
    });

    log.log(`[IG] Loading reel: ${reelUrl}`);
    await page.goto(reelUrl, { waitUntil: "networkidle2", timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 5000));

    // Extract video URLs from page source (string eval to avoid esbuild __name issue)
    const igExtract = `
      (function() {
        var urls = [];
        var video = document.querySelector("video");
        if (video && video.src && video.src.indexOf("http")===0) urls.push(video.src);
        var og = document.querySelector('meta[property="og:video"]');
        if (og && og.content) urls.push(og.content);
        var html = document.documentElement.innerHTML;
        var cdnPat = /https:\\/\\/scontent[^"\\s]*?\\.mp4[^"\\s]*/g;
        var m; while ((m = cdnPat.exec(html))) { var u = m[0].replace(/&amp;/g,"&"); if (u.length > 50) urls.push(u); }
        var titleEl = document.querySelector('meta[property="og:title"]');
        var title = titleEl ? titleEl.getAttribute("content") || "" : "";
        var allText = document.body.textContent || "";
        var viewMatch = allText.match(/(\\d[\\d,.]*[KkMmBb]?)\\s*(?:views|plays)/i);
        return { urls: urls, title: title, views: viewMatch ? viewMatch[1] : "0", duration: video ? video.duration || 0 : 0 };
      })()
    `;
    const igResult = await page.evaluate(igExtract) as { urls: string[]; title: string; views: string; duration: number };
    videoUrls.push(...igResult.urls);
    const meta = { title: igResult.title, views: igResult.views, duration: igResult.duration };

    if (videoUrls.length === 0) {
      log.warn("[IG] No video URLs found");
      return null;
    }

    const bestUrl = videoUrls[videoUrls.length - 1];
    const outPath = path.join(tmpDir, "ig-video.mp4");

    const response = await fetch(bestUrl, {
      headers: { "User-Agent": UA, Referer: "https://www.instagram.com/" },
    });

    if (!response.ok || !response.body) {
      throw new Error(`IG download failed: HTTP ${response.status}`);
    }

    const chunks: Buffer[] = [];
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    await fs.writeFile(outPath, Buffer.concat(chunks));

    log.log(`[IG] Downloaded: ${outPath}`);

    return {
      videoPath: outPath,
      title: meta.title,
      durationSec: meta.duration,
      viewCount: parseViewCount(meta.views),
    };
  } catch (err) {
    log.warn(`[IG] Download failed for ${reelUrl}: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
