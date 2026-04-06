import puppeteer, { type Browser, type Page, type CookieParam } from "puppeteer-core";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { createLogger } from "@/lib/logger";
import { getFlowCookieFilePath } from "@/lib/flow-cookie-path";

const execFileAsync = promisify(execFile);
const log = createLogger("FlowTV");

const FLOW_URL = "https://labs.google/fx/tools/flow";

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
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
  ],
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type FlowCookie = CookieParam;

function findChrome(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of CHROME_PATHS[process.platform] ?? []) {
    if (p && fsSync.existsSync(p)) return p;
  }
  return null;
}

async function loadFlowCookies(): Promise<FlowCookie[]> {
  const cookiePath = getFlowCookieFilePath();
  if (!cookiePath) return [];
  try {
    const raw = await fs.readFile(cookiePath, "utf-8");
    const cookies = JSON.parse(raw) as FlowCookie[];
    return Array.isArray(cookies) ? cookies : [];
  } catch {
    return [];
  }
}

async function launchFlowBrowser(): Promise<Browser> {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome/Chromium not found. Install Chromium on server or set CHROME_PATH.");
  }
  return puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
      "--disable-gpu",
      "--no-first-run",
      "--window-size=1440,900",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

async function prepPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})");
  const cookies = await loadFlowCookies();
  if (cookies.length > 0) {
    try {
      await page.setCookie(...cookies);
      log.log(`Loaded ${cookies.length} Flow cookie(s)`);
    } catch (e) {
      log.warn(`Could not apply Flow cookies: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return page;
}

async function waitAndClickByText(page: Page, text: string, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const clicked = await page.evaluate((label) => {
      const candidates = Array.from(document.querySelectorAll("button, a, div[role='button'], span"));
      const el = candidates.find((n) => (n.textContent ?? "").trim().toLowerCase().includes(label.toLowerCase())) as HTMLElement | undefined;
      if (!el) return false;
      el.click();
      return true;
    }, text);
    if (clicked) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

async function waitForAnySelector(page: Page, selectors: string[], timeoutMs = 25_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const s of selectors) {
      const ok = await page.$(s);
      if (ok) return s;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function renameProject(page: Page, projectName: string): Promise<void> {
  await waitAndClickByText(page, "Create").catch(() => {});
  const opened = await waitAndClickByText(page, "Untitled").catch(() => false);
  if (!opened) return;
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type(projectName, { delay: 8 });
  await page.keyboard.press("Enter");
}

async function maybeDismissCookieWall(page: Page): Promise<void> {
  await waitAndClickByText(page, "Accept all").catch(() => {});
  await waitAndClickByText(page, "Accept").catch(() => {});
}

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function screenshotStep(page: Page, dir: string, name: string): Promise<string> {
  const out = path.join(dir, `${sanitizeName(name)}.png`);
  await page.screenshot({ path: out, fullPage: false });
  return out;
}

async function extractLastFrame(inputVideo: string, outputFrame: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-sseof",
    "-0.2",
    "-i",
    inputVideo,
    "-vframes",
    "1",
    outputFrame,
  ]);
}

async function waitForDownloadFromInput(page: Page, timeoutMs = 180_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"));
      const candidate = inputs.find((i) => {
        const v = (i as HTMLInputElement).value ?? "";
        return /^https?:\/\//i.test(v);
      }) as HTMLInputElement | undefined;
      return candidate?.value ?? null;
    });
    if (value) return value;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

export type FlowSceneSpec = {
  sceneIndex: number;
  sceneName: string;
  imagePrompt: string;
  clipPrompt: string;
  durationSec: number;
};

export type FlowSceneResult = {
  sceneIndex: number;
  sceneName: string;
  sceneImagePath: string;
  clipPath: string;
  endFramePath: string;
};

export async function generateFlowStoryAssets(opts: {
  videoId: string;
  projectName: string;
  scenes: FlowSceneSpec[];
  outputDir: string;
  maxScenes?: number;
}): Promise<FlowSceneResult[]> {
  const maxScenes = Math.max(1, Math.min(opts.maxScenes ?? 2, 2));
  const scenes = opts.scenes.slice(0, maxScenes);
  const browser = await launchFlowBrowser();
  const artifactsDir = path.join(opts.outputDir, "flow-artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  const results: FlowSceneResult[] = [];

  try {
    const page = await prepPage(browser);
    await page.goto(FLOW_URL, { waitUntil: "networkidle2", timeout: 60_000 });
    await maybeDismissCookieWall(page);

    const requiresLogin = await page.evaluate(() => {
      const t = (document.body?.textContent ?? "").toLowerCase();
      return t.includes("sign in") || t.includes("log in");
    });
    if (requiresLogin) {
      throw new Error("Flow sign-in required. Please upload fresh Flow cookies in Settings.");
    }

    await renameProject(page, opts.projectName);
    await screenshotStep(page, artifactsDir, "flow-home");

    let previousLastFrame: string | null = null;
    for (const s of scenes) {
      const sceneSlug = sanitizeName(`${s.sceneIndex + 1}-${s.sceneName}`);
      const sceneImagePath = path.join(opts.outputDir, `scene-${String(s.sceneIndex).padStart(3, "0")}-${sceneSlug}.png`);
      const clipPath = path.join(opts.outputDir, `scene-${String(s.sceneIndex).padStart(3, "0")}-${sceneSlug}-clip.mp4`);
      const endFramePath = path.join(opts.outputDir, `scene-${String(s.sceneIndex).padStart(3, "0")}-${sceneSlug}-end-frame.png`);

      // Scene image
      const openedIngredients = await waitAndClickByText(page, "Ingredients to video", 20_000);
      if (!openedIngredients) throw new Error("Flow UI changed: cannot find Ingredients to video");

      const promptSelector = await waitForAnySelector(page, ["textarea", "div[contenteditable='true']"], 20_000);
      if (!promptSelector) throw new Error("Flow UI changed: prompt field not found");

      await page.focus(promptSelector);
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.type(s.imagePrompt, { delay: 6 });

      const generatedImage = await waitAndClickByText(page, "Generate", 10_000);
      if (!generatedImage) throw new Error("Flow image generation button not found");

      const imageUrl = await waitForDownloadFromInput(page, 180_000);
      if (!imageUrl) throw new Error(`Flow image generation timed out for scene ${s.sceneIndex + 1}`);
      const imageResp = await fetch(imageUrl);
      if (!imageResp.ok) throw new Error(`Failed downloading Flow image: HTTP ${imageResp.status}`);
      const imageBuf = Buffer.from(await imageResp.arrayBuffer());
      await fs.writeFile(sceneImagePath, imageBuf);

      // Chained clip: start from previous clip last frame if available, end at current scene image.
      const chainPrompt = previousLastFrame
        ? `${s.clipPrompt}. Start exactly from uploaded start frame and transition to uploaded end frame.`
        : `${s.clipPrompt}. Use uploaded end frame as destination.`;
      await page.focus(promptSelector);
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.type(chainPrompt, { delay: 5 });

      // Upload inputs (best effort based on generic file input).
      const fileInputs = await page.$$("input[type='file']");
      if (fileInputs.length > 0) {
        if (previousLastFrame) {
          await fileInputs[0].uploadFile(previousLastFrame);
          if (fileInputs[1]) await fileInputs[1].uploadFile(sceneImagePath);
        } else {
          await fileInputs[0].uploadFile(sceneImagePath);
        }
      }

      const generatedClip = await waitAndClickByText(page, "Generate", 10_000);
      if (!generatedClip) throw new Error("Flow clip generation button not found");
      const clipUrl = await waitForDownloadFromInput(page, 240_000);
      if (!clipUrl) throw new Error(`Flow clip generation timed out for scene ${s.sceneIndex + 1}`);
      const clipResp = await fetch(clipUrl);
      if (!clipResp.ok) throw new Error(`Failed downloading Flow clip: HTTP ${clipResp.status}`);
      const clipBuf = Buffer.from(await clipResp.arrayBuffer());
      await fs.writeFile(clipPath, clipBuf);

      await extractLastFrame(clipPath, endFramePath);
      previousLastFrame = endFramePath;

      await screenshotStep(page, artifactsDir, `scene-${s.sceneIndex + 1}-done`);
      results.push({
        sceneIndex: s.sceneIndex,
        sceneName: s.sceneName,
        sceneImagePath,
        clipPath,
        endFramePath,
      });
    }

    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}
