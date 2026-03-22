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
 */
async function loadCookiesForPuppeteer(
  domain: string,
): Promise<Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; expires: number }>> {
  const cookiePath = getCookieFilePath();
  if (!cookiePath) return [];

  try {
    const text = await fs.readFile(cookiePath, "utf-8");
    return text
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("# "))
      .map((line) => {
        const stripped = line.startsWith("#HttpOnly_") ? line.slice(10) : line;
        const isHttpOnly = line.startsWith("#HttpOnly_");
        const parts = stripped.split("\t");
        if (parts.length < 7) return null;
        const [dom, , pth, sec, exp, name, value] = parts;
        if (!dom.includes(domain)) return null;
        return {
          name,
          value,
          domain: dom.startsWith(".") ? dom : `.${dom}`,
          path: pth,
          secure: sec === "TRUE",
          httpOnly: isHttpOnly,
          expires: Number(exp) || -1,
        };
      })
      .filter(Boolean) as Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; expires: number }>;
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
    await page.setCookie(...cookies);
    log.log(`Loaded ${cookies.length} cookies for ${domain}`);
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
// Facebook discovery: scrape page videos
// ---------------------------------------------------------------------------
export async function discoverFbPageVideos(
  pageUrl: string,
  maxItems = 15,
): Promise<ScrapedVideo[]> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await prepPage(browser, "facebook.com");

    log.log(`[FB] Navigating to ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));

    // Scroll aggressively to load more content and find high-view videos
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, 2000));
      await new Promise((r) => setTimeout(r, 2000));
    }

    const fbExtractScript = `
      (function() {
        var max = ${maxItems};
        var results = [];
        var seenIds = {};

        var links = document.querySelectorAll('a[href*="/watch/"], a[href*="/reel/"], a[href*="/videos/"]');
        for (var i = 0; i < links.length; i++) {
          if (results.length >= max) break;
          var href = links[i].href || "";
          if (!href) continue;

          var vidMatch = href.match(/(?:\\/watch\\/\\?v=|\\/reel\\/|\\/videos\\/)(\\d+)/);
          if (!vidMatch) continue;
          var vidId = vidMatch[1];
          if (seenIds[vidId]) continue;
          seenIds[vidId] = true;

          // Stay close to the video link — use article or walk up max 3 levels
          var container = links[i].closest('[role="article"]');
          if (!container) {
            container = links[i].parentElement;
            for (var p = 0; p < 3 && container && container.parentElement; p++) container = container.parentElement;
          }
          var text = container ? container.textContent || "" : "";

          // Only match "X views" or "X plays" patterns (not page-level totals)
          var views = "";
          var vPats = [
            /(\\d[\\d,.]*\\s*[KkMmBb])\\s*(?:views|Views|plays|Plays)/,
            /(\\d[\\d,.]+)\\s*(?:views|Views|plays|Plays)/,
          ];
          for (var vi = 0; vi < vPats.length; vi++) {
            var vm = text.match(vPats[vi]);
            if (vm) { views = vm[1]; break; }
          }

          var spans = container ? container.querySelectorAll("span") : [];
          var title = "";
          for (var si = 0; si < spans.length; si++) {
            var t = (spans[si].textContent || "").trim();
            if (t.length > 15 && t.length < 300
              && !/^(All reactions|\\d+ comment|\\d+ share|Like|Comment|Share|Verified)/i.test(t)
              && !/^\\d+[KkMmBb]?$/.test(t)
              && !/(reels$|'s reels$)/i.test(t)) {
              title = t;
              break;
            }
          }

          results.push({ url: href, title: title, views: views, vidId: vidId });
        }
        return results;
      })()
    `;
    const videos = await page.evaluate(fbExtractScript) as Array<{
      url: string; title: string; views: string; vidId: string;
    }>;

    // Extract page name from URL
    const pageNameMatch = pageUrl.match(/facebook\.com\/([^/?]+)/);
    const pageName = pageNameMatch ? pageNameMatch[1] : "Unknown";

    return videos.map((v) => {
      // Strip FB date/view suffixes from titles: "Title text3 days ago  · 1.1M views"
      let title = (v.title || "").replace(/\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*ago.*$/i, "").trim();
      if (!title || title.length < 5) title = `Video from ${pageName}`;
      return {
        videoId: v.vidId || (v.url.match(/(?:\/watch\/?\?v=|\/reel\/|\/videos\/)(\d+)/) || [])[1] || "",
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
      urls: string[]; title: string; views: string;
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
      durationSec: duration,
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
// Instagram discovery: scrape profile reels
// ---------------------------------------------------------------------------
export async function discoverIgReels(
  profileUrl: string,
  maxItems = 15,
): Promise<ScrapedVideo[]> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await prepPage(browser, "instagram.com");

    // Navigate to reels tab
    const reelsUrl = profileUrl.replace(/\/?$/, "/reels/");
    log.log(`[IG] Navigating to ${reelsUrl}`);
    await page.goto(reelsUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));

    // Scroll to load more
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await new Promise((r) => setTimeout(r, 2000));
    }

    const reels = await page.evaluate((max: number) => {
      const results: Array<{ url: string; views: string }> = [];
      const seen = new Set<string>();

      // IG reels are links to /reel/SHORTCODE/
      const links = document.querySelectorAll('a[href*="/reel/"]');
      for (const link of links) {
        if (results.length >= max) break;
        const href = (link as HTMLAnchorElement).href;
        if (seen.has(href)) continue;
        seen.add(href);

        // View count is often in an overlay or nearby span
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

    const profileName = (profileUrl.match(/instagram\.com\/([^/?]+)/) || [])[1] || "Unknown";

    return reels.map((r) => ({
      videoId: (r.url.match(/\/reel\/([^/]+)/) || [])[1] || "",
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
