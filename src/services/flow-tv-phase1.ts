import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createLogger } from "@/lib/logger";
import {
  buildAssetName,
  recordAsset,
  findExistingLocalAsset,
  rememberOrphanedFlowUrl,
  consumeOrphanedFlowUrls,
  clearOrphanedFlowUrls,
} from "@/services/flow-tv-naming";
import {
  renameMostRecentAssetVerified,
  renameAndVerify,
  renameTileByImageSrcVerified,
  renameNewlyAddedImageTileVerified,
  snapshotGalleryImageSrcs,
  archiveTileByName,
  waitForTiles,
} from "@/services/flow-tv-rename";
import {
  scanProjectAssetsByDisplayName,
  waitForGalleryQuiescent,
  findImageTileForCanonicalName,
  findImageTileByPromptPrefix,
  findImageTileByAssetId,
  extractAssetIdFromUrl,
  type GalleryAssetEntry,
} from "@/services/flow-tv-gallery";
import {
  buildStorylinePrompt,
  classifyProtagonist,
  type StorylineBuildOpts,
} from "@/services/flow-tv-prompts";
import type { FlowNiche } from "@/services/flow-tv-run";

const log = createLogger("FlowTV:Phase1");
const execFileAsync = promisify(execFile);

export const FLOW_URL = "https://labs.google/fx/tools/flow";
export const FLOW_DATA_DIR = path.join(process.cwd(), "data", "flow-tv");
// Per-storySlug caches replace the legacy single-file storyline/project caches.
// Each Flow TV video gets its own JSON in these dirs, keyed by the
// date-suffixed storySlug.
export const STORYLINES_DIR = path.join(FLOW_DATA_DIR, "storylines");
export const PROJECTS_DIR = path.join(FLOW_DATA_DIR, "projects");
export const RUNS_DIR = path.join(FLOW_DATA_DIR, "runs");
export const PROFILE_DIR = path.join(process.cwd(), "data", "flow-chrome-profile");
// Storyline prompt now lives in src/services/flow-tv-prompts.ts; the legacy
// sample_prompt file is kept for reference but no longer read at runtime.

export function storylineFileFor(storySlug: string): string {
  return path.join(STORYLINES_DIR, `${storySlug}.json`);
}
export function projectFileFor(storySlug: string): string {
  return path.join(PROJECTS_DIR, `${storySlug}.json`);
}

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
  ],
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function findChrome(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of CHROME_PATHS[process.platform] ?? []) {
    if (p && fsSync.existsSync(p)) return p;
  }
  return null;
}

export function isHeadless(): boolean {
  // Default visible for Phase 1 testing. Set FLOW_TV_HEADLESS=true on prod servers.
  const v = (process.env.FLOW_TV_HEADLESS ?? "false").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function sanitizeFilename(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Phase 1 step → progress reporting
// ──────────────────────────────────────────────────────────────────────────────

export type Phase1Status =
  | "idle"
  | "starting"
  | "storyline"
  | "browser_launching"
  | "project_setup"
  | "generating_character"
  | "generating_image"
  | "done"
  | "error";

export interface Phase1Progress {
  status: Phase1Status;
  message: string;
  startedAt: number;
  updatedAt: number;
  imageCount: number;
  imagesDone: number;
  storyline?: Storyline;
  project?: ProjectRef;
  runDir?: string;
  characterPath?: string;
  imagePaths: string[];
  screenshots: string[];
  error?: string;
}

/**
 * One spoken line in a scene. Supports multi-character conversations: a scene
 * can have 1–4 of these, each tagged with the speaker's role.
 */
export interface SceneDialogue {
  /**
   * Who speaks. Use "main" for the protagonist (the consistent character),
   * or the supporting character's `role` (matched against
   * `Storyline.supportingCast[].role`). Free-form description allowed if
   * the speaker is a one-off bystander (e.g. "passing chai-walla").
   */
  speaker: string;
  /** Devanagari / scripted line (or English when language=english). */
  lineHi: string;
  /** Latin-script transliteration of lineHi (for subtitle burn-in). */
  lineRoman: string;
}

/**
 * A non-protagonist character that may appear in one or more scenes.
 * Supporting cast are NOT visually consistent across scenes (they don't
 * have their own reference image) — Gemini describes them inline in each
 * scene's prompt and Veo renders them per-frame.
 */
export interface SupportingCharacter {
  /** Short stable role label, kebab-case if possible (e.g. "wife", "rival-boss", "dadi"). */
  role: string;
  /** Human-readable display name shown in UI/logs (e.g. "Wife — Geeta"). */
  name: string;
  /**
   * 30–60 word description: appearance, wardrobe, age band, vibe. Used by
   * Gemini when expanding scene prompts and by humans inspecting cache.
   * Not used to generate a separate reference image.
   */
  description: string;
}

export interface ImagePromptEntry {
  title: string;
  prompt: string;
  /**
   * Multi-speaker dialogues for this scene. Preferred new shape; if absent,
   * downstream code falls back to `dialogueHi`/`dialogueRoman` (legacy
   * single-speaker shape). Order matters — Veo bakes them in sequence.
   */
  dialogues?: SceneDialogue[];
  /** LEGACY: single-speaker line (auto-derived from dialogues[0] if absent). */
  dialogueHi?: string;
  /** LEGACY: Latin-script line (auto-derived from dialogues[0] if absent). */
  dialogueRoman?: string;
  /** Background music cue for this scene (Phase 2 appends to Veo prompt). */
  bgmCue?: string;
  /** Diegetic SFX cue for this scene (Phase 2 appends to Veo prompt). */
  sfxCue?: string;
}

export interface Storyline {
  title: string;
  logline: string;
  protagonist: string;
  characterPrompt: string;
  /**
   * Optional non-protagonist characters that recur in dialogue. The MAIN
   * character (described by `protagonist` + `characterPrompt`) is the only
   * visually consistent character — supporting cast are scene-local.
   */
  supportingCast?: SupportingCharacter[];
  imagePrompts: ImagePromptEntry[];
  generatedAt: number;
  imageCount: number;
  /** Creative options frozen with the storyline (so cache hits stay coherent). */
  niche?: string;
  language?: "hindi" | "english";
  characterStyle?: "cartoon_3d" | "hyperreal_3d" | "photoreal";
  aspectRatio?: "9:16" | "16:9";
  dialogue?: boolean;
  bgm?: boolean;
  sfx?: boolean;
}

export interface ProjectRef {
  projectName: string;
  projectUrl: string;
  createdAt: number;
}

let _progress: Phase1Progress | null = null;

function setProgress(patch: Partial<Phase1Progress>): void {
  if (!_progress) return;
  _progress = { ..._progress, ...patch, updatedAt: Date.now() };
}

export function getPhase1Progress(): Phase1Progress | null {
  return _progress;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Storyline (Gemini Flash, cached)
// ──────────────────────────────────────────────────────────────────────────────

export async function loadStorylineCache(
  storySlug: string,
  imageCount: number,
): Promise<Storyline | null> {
  try {
    const raw = await fs.readFile(storylineFileFor(storySlug), "utf-8");
    const cached = JSON.parse(raw) as Storyline;
    const ok =
      cached.imageCount === imageCount &&
      Array.isArray(cached.imagePrompts) &&
      cached.imagePrompts.length === imageCount &&
      typeof cached.characterPrompt === "string" &&
      cached.characterPrompt.trim().length > 20;
    if (ok) return cached;
    log.warn(
      `Storyline cache invalid for ${storySlug} (imageCount=${cached.imageCount}, prompts=${cached.imagePrompts?.length}, characterPrompt=${typeof cached.characterPrompt}); regenerating.`,
    );
    return null;
  } catch {
    return null;
  }
}

export async function saveStorylineCache(
  storySlug: string,
  storyline: Storyline,
): Promise<void> {
  await fs.mkdir(STORYLINES_DIR, { recursive: true });
  await fs.writeFile(storylineFileFor(storySlug), JSON.stringify(storyline, null, 2), "utf-8");
}

/**
 * Scan the storyline cache directory and return the most recent N stories
 * that match `niche`. Used to feed `avoidTitles` and `avoidArchetypes` to
 * the Gemini prompt so consecutive generations don't keep landing on the
 * same protagonist (e.g. always "uncle vs gadget").
 */
export async function loadRecentStorylinesForNiche(
  niche: FlowNiche,
  limit = 6,
): Promise<Storyline[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(STORYLINES_DIR);
  } catch {
    return [];
  }
  const items: Array<{ s: Storyline; mtime: number }> = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(STORYLINES_DIR, name);
    try {
      const stat = await fs.stat(full);
      const raw = await fs.readFile(full, "utf-8");
      const s = JSON.parse(raw) as Storyline;
      if ((s.niche ?? "zero-to-hero") !== niche) continue;
      if (!s.title || !s.protagonist) continue;
      items.push({ s, mtime: stat.mtimeMs });
    } catch {
      // skip corrupt files
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return items.slice(0, limit).map((x) => x.s);
}

/**
 * Build avoid-title + avoid-archetype hints by scanning the most recent
 * cached storylines for `niche`. Returns empty arrays if no prior stories
 * exist for the niche. Designed to be sprinkled into any `StorylineGenOptions`
 * before calling Gemini (API or Web).
 */
export async function buildVarietyHintsForNiche(
  niche: FlowNiche,
  limit = 6,
): Promise<{
  avoidTitles: string[];
  avoidArchetypes: string[];
  bannedCategories: string[];
}> {
  try {
    const recent = await loadRecentStorylinesForNiche(niche, limit);
    const protagonists = recent
      .map((s) => s.protagonist?.trim())
      .filter((p): p is string => Boolean(p && p.length > 0));
    const characterPrompts = recent
      .map((s) => s.characterPrompt?.trim())
      .filter((p): p is string => Boolean(p && p.length > 0));

    // Classify both protagonist sentences AND the longer characterPrompt so
    // we catch categories reliably even when the `protagonist` field is
    // terse. Dedupe across sources.
    const cats = new Set<string>();
    for (const text of [...protagonists, ...characterPrompts]) {
      const c = classifyProtagonist(text);
      if (c) cats.add(c);
    }

    return {
      avoidTitles: recent.map((s) => s.title).filter(Boolean),
      avoidArchetypes: protagonists,
      bannedCategories: Array.from(cats),
    };
  } catch {
    return { avoidTitles: [], avoidArchetypes: [], bannedCategories: [] };
  }
}

export type StorylineGenOptions = StorylineBuildOpts;

/**
 * True for transient Gemini failures we want to retry (overload, rate limit,
 * deadline, internal). Permanent errors (auth, invalid arg, schema) bubble.
 */
function isTransientGeminiError(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string } | undefined;
  const msg = (e?.message ?? "").toLowerCase();
  const code = e?.code ?? e?.status;
  if (code === 429 || code === 500 || code === 502 || code === 503 || code === 504) {
    return true;
  }
  return (
    msg.includes("unavailable") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("high demand") ||
    msg.includes("deadline") ||
    msg.includes("internal error")
  );
}

const RETRY_DELAYS_MS = [3_000, 8_000, 20_000, 45_000];

/**
 * Call Gemini Flash to draft a storyline. The options bag fully describes
 * niche, language, character style, aspect ratio, audio toggles, and any
 * `avoidTitles` to bias against known titles when refreshing.
 *
 * Wraps the API call in an exponential-ish backoff for transient errors
 * (503/UNAVAILABLE, 429/RESOURCE_EXHAUSTED, 5xx, deadline). On the final
 * attempt, falls back to a stable "pro" model if the configured one keeps
 * 503'ing.
 */
export async function generateStorylineWithGemini(
  opts: StorylineGenOptions,
): Promise<Omit<Storyline, "generatedAt" | "imageCount">> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const prompt = buildStorylinePrompt(opts);
  const ai = new GoogleGenAI({ apiKey });

  const primaryModel = (process.env.GEMINI_MODEL ?? "gemini-2.5-flash").trim();
  const fallbackModel = (
    process.env.GEMINI_FALLBACK_MODEL ?? "gemini-2.5-pro"
  ).trim();

  let response:
    | Awaited<ReturnType<typeof ai.models.generateContent>>
    | undefined;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const useFallback =
      attempt === RETRY_DELAYS_MS.length && primaryModel !== fallbackModel;
    const model = useFallback ? fallbackModel : primaryModel;
    log.log(
      `Calling Gemini (${model}${useFallback ? " — fallback" : ""}, attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}) niche=${opts.niche} lang=${opts.language} N=${opts.imageCount}${
        (opts.avoidTitles?.length ?? 0) > 0
          ? `, avoiding ${opts.avoidTitles!.length} prior title(s)`
          : ""
      }`,
    );
    try {
      response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 1.1,
          topP: 0.95,
        },
      });
      break;
    } catch (err) {
      lastErr = err;
      if (!isTransientGeminiError(err)) throw err;
      const delayMs = RETRY_DELAYS_MS[attempt];
      if (delayMs == null) {
        // Out of retries (and we already tried the fallback model on the last
        // pass); rethrow so the run state machine surfaces a clean error.
        log.error(
          `Gemini transient failure exhausted retries (${(err as Error).message?.slice(0, 200)})`,
        );
        throw err;
      }
      log.warn(
        `Gemini transient failure (${(err as Error).message?.slice(0, 160)}); retrying in ${Math.round(delayMs / 1000)}s…`,
      );
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  if (!response) {
    throw lastErr ?? new Error("Gemini call failed without a response");
  }

  const text = response.text ?? "";
  const parsed = JSON.parse(text) as Partial<Storyline>;

  if (
    !parsed.title ||
    !Array.isArray(parsed.imagePrompts) ||
    parsed.imagePrompts.length !== opts.imageCount ||
    typeof parsed.characterPrompt !== "string" ||
    parsed.characterPrompt.trim().length < 20
  ) {
    throw new Error(
      `Gemini returned invalid storyline (title=${parsed.title}, prompts=${parsed.imagePrompts?.length}, characterPrompt=${parsed.characterPrompt?.slice?.(0, 30)})`,
    );
  }

  return {
    title: String(parsed.title).slice(0, 80),
    logline: String(parsed.logline ?? ""),
    protagonist: String(parsed.protagonist ?? ""),
    characterPrompt: String(parsed.characterPrompt).trim(),
    supportingCast: normalizeSupportingCast(
      (parsed as { supportingCast?: unknown }).supportingCast,
    ),
    imagePrompts: parsed.imagePrompts.map((p, i) => {
      const e: ImagePromptEntry = {
        title: sanitizeFilename(String(p.title ?? `scene-${i + 1}`)),
        prompt: String(p.prompt ?? "").trim(),
      };
      if (opts.dialogue) {
        const dlg = normalizeSceneDialogues(
          (p as { dialogues?: unknown }).dialogues,
        );
        if (dlg.length > 0) {
          e.dialogues = dlg;
          // Keep legacy single-line fields populated from the first item so
          // older code paths (Phase 2 fallback, subtitles fallback) keep
          // working even on a multi-speaker scene.
          e.dialogueHi = dlg[0].lineHi;
          e.dialogueRoman = dlg[0].lineRoman;
        } else {
          // Gemini emitted only the legacy fields — keep them.
          e.dialogueHi = String(p.dialogueHi ?? "").trim();
          e.dialogueRoman = String(p.dialogueRoman ?? "").trim();
          // Mirror legacy line into the new shape so all downstream code
          // can treat `dialogues` as the single source of truth.
          if (e.dialogueHi || e.dialogueRoman) {
            e.dialogues = [
              {
                speaker: "main",
                lineHi: e.dialogueHi ?? "",
                lineRoman: e.dialogueRoman ?? e.dialogueHi ?? "",
              },
            ];
          }
        }
      }
      if (opts.bgm) {
        e.bgmCue = String(p.bgmCue ?? "").trim();
      }
      if (opts.sfx) {
        e.sfxCue = String(p.sfxCue ?? "").trim();
      }
      return e;
    }),
    niche: opts.niche,
    language: opts.language,
    characterStyle: opts.characterStyle,
    aspectRatio: opts.aspectRatio,
    dialogue: opts.dialogue,
    bgm: opts.bgm,
    sfx: opts.sfx,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  Storyline shape normalizers (multi-character + multi-speaker dialogues)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Coerce Gemini's `supportingCast` field into the canonical
 * `SupportingCharacter[]` shape, dropping malformed entries.
 *
 * Tolerated synonyms:
 *   - `cast`, `characters`, `supportingCharacters` (top-level alias)
 *   - per-entry: `name`/`role`/`description` already canonical;
 *     also accepts `display`, `displayName`, `desc`, `details`, `appearance`.
 */
function normalizeSupportingCast(raw: unknown): SupportingCharacter[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: SupportingCharacter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const role = String(o.role ?? o.tag ?? o.type ?? "").trim();
    const name = String(o.name ?? o.display ?? o.displayName ?? role).trim();
    const description = String(
      o.description ?? o.desc ?? o.details ?? o.appearance ?? "",
    ).trim();
    if (!role || !description) continue;
    out.push({
      role: role.slice(0, 60),
      name: (name || role).slice(0, 80),
      description: description.slice(0, 600),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Coerce Gemini's `dialogues` field into the canonical `SceneDialogue[]`
 * shape, dropping malformed entries.
 *
 * Tolerated synonyms:
 *   - per-entry: `speaker`/`lineHi`/`lineRoman` already canonical;
 *     also accepts `who`, `role`, `text`, `hindi`, `lineHindi`,
 *     `roman`, `transliteration`, `english`, `lineEnglish`.
 */
function normalizeSceneDialogues(raw: unknown): SceneDialogue[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: SceneDialogue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speaker = String(o.speaker ?? o.who ?? o.role ?? "main").trim() || "main";
    const lineHi = String(
      o.lineHi ?? o.hindi ?? o.lineHindi ?? o.text ?? o.line ?? "",
    ).trim();
    const lineRoman = String(
      o.lineRoman ?? o.roman ?? o.transliteration ?? o.english ?? o.lineEnglish ?? lineHi,
    ).trim();
    if (!lineHi && !lineRoman) continue;
    out.push({
      speaker: speaker.slice(0, 50),
      lineHi: (lineHi || lineRoman).slice(0, 240),
      lineRoman: (lineRoman || lineHi).slice(0, 240),
    });
  }
  return out;
}

/**
 * Get a cached storyline for `storySlug` or generate a fresh one. The slug
 * isolates each Flow TV video's storyline file (no cross-talk between runs).
 *
 * If `opts` is omitted (legacy callers), defaults to the original photoreal
 * zero-to-hero / English / 16:9 / no-audio configuration so existing scripts
 * don't break.
 */
export async function getOrGenerateStoryline(
  storySlug: string,
  imageCount: number,
  opts?: Partial<StorylineGenOptions>,
): Promise<Storyline> {
  const niche = opts?.niche ?? "zero-to-hero";
  const fullOpts: StorylineGenOptions = {
    imageCount,
    niche,
    language: opts?.language ?? "english",
    characterStyle: opts?.characterStyle ?? "photoreal",
    aspectRatio: opts?.aspectRatio ?? "16:9",
    dialogue: opts?.dialogue ?? false,
    bgm: opts?.bgm ?? false,
    sfx: opts?.sfx ?? false,
    avoidTitles: opts?.avoidTitles,
    avoidArchetypes: opts?.avoidArchetypes,
    storyTitleHint: opts?.storyTitleHint,
  };

  const cached = await loadStorylineCache(storySlug, imageCount);
  if (cached) {
    log.log(`Storyline cache hit (${storySlug}): "${cached.title}"`);
    return cached;
  }

  // Auto-bias against recently-used titles AND protagonists in the same
  // niche so consecutive generations don't keep landing on the same
  // archetype (e.g. always "uncle vs gadget").
  if (
    !fullOpts.avoidTitles?.length ||
    !fullOpts.avoidArchetypes?.length
  ) {
    try {
      const recent = await loadRecentStorylinesForNiche(niche, 6);
      if (recent.length > 0) {
        if (!fullOpts.avoidTitles?.length) {
          fullOpts.avoidTitles = recent.map((s) => s.title).filter(Boolean);
        }
        if (!fullOpts.avoidArchetypes?.length) {
          fullOpts.avoidArchetypes = recent
            .map((s) => s.protagonist?.trim())
            .filter((p): p is string => Boolean(p && p.length > 0));
        }
        log.log(
          `Variety hint: avoiding ${fullOpts.avoidTitles?.length ?? 0} title(s) and ${fullOpts.avoidArchetypes?.length ?? 0} protagonist(s) from prior ${niche} runs`,
        );
      }
    } catch (e) {
      log.warn(
        `loadRecentStorylinesForNiche failed (continuing without variety hint): ${(e as Error).message}`,
      );
    }
  }

  const draft = await generateStorylineWithGemini(fullOpts);
  const storyline: Storyline = { ...draft, generatedAt: Date.now(), imageCount };
  await saveStorylineCache(storySlug, storyline);
  log.log(`Storyline cached (${storySlug}): "${storyline.title}" (${storyline.imagePrompts.length} prompts)`);
  return storyline;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Browser
// ──────────────────────────────────────────────────────────────────────────────

export async function launchBrowser(): Promise<Browser> {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome not found. Install Chrome or set CHROME_PATH.");
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  return puppeteer.launch({
    executablePath: chromePath,
    headless: isHeadless(),
    userDataDir: PROFILE_DIR, // persistent login across runs
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
}

export async function prepPage(browser: Browser): Promise<Page> {
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setUserAgent(UA);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return page;
}

export async function takeScreenshot(page: Page, runDir: string, name: string): Promise<string> {
  const out = path.join(runDir, `step-${sanitizeFilename(name)}.png`);
  await page.screenshot({ path: out, fullPage: false }).catch(() => {});
  if (_progress) _progress.screenshots.push(out);
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
//  UI helpers — best-effort, generic, with screenshots on failure
// ──────────────────────────────────────────────────────────────────────────────

export async function focusChromeOnMac(): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    // Bring the Chrome instance running our user-data-dir to front. There can be
    // multiple Chrome.app instances; this targets the one with our profile path.
    await execFileAsync("osascript", [
      "-e",
      `tell application "System Events" to set frontmost of (first process whose name is "Google Chrome") to true`,
    ]);
  } catch {
    // best-effort
  }
}

export async function isLoggedInToFlow(page: Page): Promise<boolean> {
  let url = "";
  try {
    url = page.url().toLowerCase();
  } catch {
    return false;
  }
  // Hard-fail: if we're on Google's auth domain or a labs.google sign-in/consent
  // path, we are not logged in yet.
  if (url.includes("accounts.google.com")) return false;
  if (!url.includes("labs.google")) return false;
  if (url.includes("/signin") || url.includes("consent") || url.includes("oauthchooseaccount")) return false;

  const ctaSrc = `() => {
    var els = Array.prototype.slice.call(document.querySelectorAll('button, a'));
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || '').trim().toLowerCase();
      if (t.length === 0 || t.length > 40) continue;
      if (t === 'sign in' || t === 'log in' || t === 'sign in with google' || t === 'continue with google' || t === 'log in with google') return true;
    }
    return false;
  }`;
  const hasSignInCta = (await page
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .evaluate(new Function(`return (${ctaSrc})`)() as any)
    .catch(() => false)) as boolean;

  return !hasSignInCta;
}

export async function waitForLogin(
  page: Page,
  runDir?: string,
  timeoutMs = 15 * 60_000,
): Promise<boolean> {
  // Default screenshots dir for ad-hoc inspection scripts that don't pass a
  // run-dir explicitly. The run-machine always passes the per-run dir.
  const snapDir = runDir ?? path.join(FLOW_DATA_DIR, "login-screens");
  const start = Date.now();
  let lastSnapshotAt = 0;
  let snapshotCount = 0;
  let lastUrl = "";
  while (Date.now() - start < timeoutMs) {
    if (await isLoggedInToFlow(page)) return true;

    let url = "";
    try { url = page.url().toLowerCase(); } catch {
      log.error("Browser was closed during login wait.");
      return false;
    }
    if (url !== lastUrl) {
      log.log(`login: page is at ${url}`);
      lastUrl = url;
      await focusChromeOnMac();
    }
    if (Date.now() - lastSnapshotAt > 30_000) {
      lastSnapshotAt = Date.now();
      snapshotCount += 1;
      await takeScreenshot(page, snapDir, `login-progress-${String(snapshotCount).padStart(2, "0")}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function clickByText(page: Page, text: string, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const clicked = await page.evaluate((label) => {
      const candidates = Array.from(document.querySelectorAll("button, a, div[role='button'], span[role='button']"));
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

/**
 * Find the project's main prompt input (the "What do you want to create?" box at
 * the bottom). Distinct from the global search bar at the top. Returns a
 * function that focuses and types into it, plus a separate submit() helper.
 */
// Flow's prompt input is a Slate.js editor: a contenteditable div with
// data-slate-editor="true". We target it explicitly to avoid grabbing the top
// search bar by accident.
export const PROMPT_SLATE_SELECTOR = "div[data-slate-editor='true'][role='textbox']";

export async function focusPromptInput(page: Page, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = await page.$(PROMPT_SLATE_SELECTOR);
    if (el) {
      await el.evaluate((node: Element) => {
        (node as HTMLElement).scrollIntoView({ block: "center" });
        node.setAttribute("data-narrateai-prompt", "1");
      });
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function clickPromptSubmit(page: Page): Promise<{ ok: boolean; description: string }> {
  // Strategy: the submit arrow always sits immediately to the right of the
  // generation-settings chip in both image-mode and video-mode (in video mode
  // the chip+arrow live inside a small floating prompt popover).
  //
  //   1. Look for an element whose innerText contains the Material Icons name
  //      "arrow_forward" (works for the image-mode bottom bar).
  //   2. Otherwise, find the chip (Nano Banana / Imagen / Video) and pick the
  //      smallest clickable element whose center is within ~150px to the right
  //      of the chip and within ±25px vertically. This catches video mode
  //      where the submit is rendered as a <div> (no role=button) inside the
  //      popover.
  //   3. Fall back to the rightmost ≤60x60 element below the chip's y band.
  //
  // We dispatch a real mouse click via puppeteer (page.mouse.click) so React's
  // pointerdown/up sequence fires correctly — programmatic .click() has been
  // unreliable on Flow's React-controlled buttons.
  const src = `() => {
    function rect(el){ return el.getBoundingClientRect(); }
    function visible(el){ var r = rect(el); return r.width > 0 && r.height > 0; }

    // 1. arrow_forward by text (image mode)
    var iconBtns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
    for (var i = 0; i < iconBtns.length; i++){
      var b = iconBtns[i];
      if (b.disabled) continue;
      if (!visible(b)) continue;
      var t = (b.textContent || '').toLowerCase();
      if (t.indexOf('arrow_forward') >= 0){
        var r = rect(b);
        return {
          ok: true,
          mode: 'arrow_forward',
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          description: 'click@(' + Math.round(r.left) + ',' + Math.round(r.top) + ') size=' +
                        Math.round(r.width) + 'x' + Math.round(r.height) +
                        ' text="' + (b.textContent || '').slice(0, 40) + '"',
        };
      }
    }

    // 2. anchor on chip: find the chip, then a small element ≤80x80 immediately
    //    to its right.
    var chipBtns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
    var chip = null;
    for (var i = 0; i < chipBtns.length; i++){
      var b = chipBtns[i];
      if (!visible(b)) continue;
      var t = (b.textContent || '').trim();
      // Count is rendered "1x"/"2x" today (Flow changed from legacy "x1"/"x2"). Accept both.
      if (!/(\\dx|x\\d)/.test(t)) continue;
      if (!/crop_/.test(t)) continue;
      if (!/(nano banana|imagen|^Video)/i.test(t)) continue;
      chip = b;
      break;
    }
    if (chip){
      var cr = rect(chip);
      var cy = cr.top + cr.height / 2;
      var bestRight = -Infinity;
      var picked = null;
      // Cast a wide net: include divs, spans, anything clickable.
      var all = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], [tabindex], div, span'));
      for (var k = 0; k < all.length; k++){
        var el = all[k];
        if (!visible(el)) continue;
        var er = rect(el);
        if (er.width > 80 || er.height > 80) continue;
        if (er.width < 16 || er.height < 16) continue;
        // Must be to the right of the chip but within ~180px
        if (er.left < cr.right - 8) continue;
        if (er.left > cr.right + 200) continue;
        // y must overlap chip's y band ±25px
        var ey = er.top + er.height / 2;
        if (Math.abs(ey - cy) > 25) continue;
        // Must contain text indicating an arrow / send / play OR be empty (icon-only)
        var txt = (el.textContent || '').trim().toLowerCase();
        var iconish = /(arrow_forward|send|play_arrow|trending_flat|east|chevron_right)/.test(txt) || txt.length === 0;
        if (!iconish && txt.length > 6) continue;
        if (er.right > bestRight){
          bestRight = er.right;
          picked = el;
        }
      }
      if (picked){
        var pr = rect(picked);
        return {
          ok: true,
          mode: 'chip_anchored',
          x: Math.round(pr.left + pr.width / 2),
          y: Math.round(pr.top + pr.height / 2),
          description: 'click@(' + Math.round(pr.left) + ',' + Math.round(pr.top) + ') size=' +
                        Math.round(pr.width) + 'x' + Math.round(pr.height) +
                        ' text="' + (picked.textContent || '').slice(0, 40) + '"',
        };
      }
    }

    // 3. Last-resort fallback: rightmost small icon button below the prompt area.
    var fallback = null;
    var fallbackRight = -Infinity;
    var minY = chip ? rect(chip).top - 40 : 600;
    for (var i = 0; i < iconBtns.length; i++){
      var b = iconBtns[i];
      if (b.disabled) continue;
      if (!visible(b)) continue;
      var r = rect(b);
      if (r.top < minY) continue;
      if (r.width > 60 || r.height > 60) continue;
      // Avoid the left sidebar rail (x < 80) which holds archive/settings icons.
      if (r.left < 80) continue;
      if (r.right > fallbackRight){
        fallbackRight = r.right;
        fallback = b;
      }
    }
    if (fallback){
      var fr = rect(fallback);
      return {
        ok: true,
        mode: 'fallback_rightmost',
        x: Math.round(fr.left + fr.width / 2),
        y: Math.round(fr.top + fr.height / 2),
        description: 'click@(' + Math.round(fr.left) + ',' + Math.round(fr.top) + ') size=' +
                      Math.round(fr.width) + 'x' + Math.round(fr.height) +
                      ' text="' + (fallback.textContent || '').slice(0, 40) + '"',
      };
    }

    return { ok: false, mode: 'none', description: 'no candidate' };
  }`;
  const hit = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${src})`)() as any,
  )) as { ok: boolean; mode: string; x?: number; y?: number; description: string };
  if (hit.ok && typeof hit.x === "number" && typeof hit.y === "number") {
    await page.mouse.click(hit.x, hit.y);
  }
  return { ok: hit.ok, description: `[${hit.mode}] ${hit.description}` };
}

export async function dismissCookieWall(page: Page): Promise<void> {
  await clickByText(page, "Accept all", 4_000).catch(() => {});
  await clickByText(page, "Accept", 2_000).catch(() => {});
}

/**
 * Dismiss any "What's New" / changelog / onboarding modal that Flow TV
 * shows on first visit after a release (e.g. "Archive, Shortcuts and more!"
 * with a "Get started" button). These overlays cover the entire prompt area
 * and silently break clickChip / focusPromptInput.
 *
 * Strategy:
 *   1. Detect a centered modal dialog with the recognisable title text.
 *   2. Click the dialog's primary CTA inside the dialog only ("Get started",
 *      "Got it", "Continue", "Dismiss"). We scope the search to the dialog
 *      so we don't accidentally click the home page's "Get started" CTA
 *      (which would create a project we don't want).
 *   3. Fallback: if the dialog has a close (X) button, click it.
 *   4. Final fallback: press Escape.
 *
 * Cheap to call repeatedly — returns immediately when no modal is present.
 */
export async function dismissWelcomeModal(page: Page): Promise<boolean> {
  const closed = await page
    .evaluate(() => {
      // Find the topmost dialog/modal overlay. Flow uses [role="dialog"]
      // and Material-style portals; we detect both. We require the dialog
      // to actually contain visible CTA-ish text to avoid matching tiny
      // tooltip popovers.
      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[role='dialog'], [role='alertdialog'], [aria-modal='true']",
        ),
      ).filter((d) => {
        const r = d.getBoundingClientRect();
        return r.width > 200 && r.height > 200;
      });
      if (dialogs.length === 0) return { closed: false, reason: "no-dialog" };

      // Heuristic: only treat it as a "welcome / changelog" modal if it
      // contains one of these keywords. Otherwise we'd accidentally close
      // the rename or settings dialogs.
      const KEYWORDS = [
        "what's new",
        "whats new",
        "shortcuts and more",
        "archive, shortcuts",
        "welcome to flow",
        "introducing",
        "now available",
        "is here",
        "happy creating",
        "the flow team",
        "veo 3.1",
        "veo 3",
        "flow tour",
        "take the tour",
        "join our discord",
        "tips and tricks",
        "spaces",
        "pin to flow",
      ];
      const dialog = dialogs.find((d) => {
        const txt = (d.textContent || "").toLowerCase();
        return KEYWORDS.some((k) => txt.includes(k));
      });
      if (!dialog) return { closed: false, reason: "not-welcome-modal" };

      // Try the obvious primary CTAs, scoped to this dialog.
      const CTA_LABELS = ["get started", "got it", "continue", "dismiss", "okay", "ok"];
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button, a, div[role='button'], span[role='button']",
        ),
      );
      for (const lbl of CTA_LABELS) {
        const btn = buttons.find(
          (b) => (b.textContent || "").trim().toLowerCase() === lbl,
        );
        if (btn) {
          btn.click();
          return { closed: true, via: `cta:${lbl}` };
        }
      }

      // Fallback: try a close (X) icon button.
      const closeBtn = buttons.find((b) => {
        const al = (b.getAttribute("aria-label") || "").toLowerCase();
        return al === "close" || al === "dismiss";
      });
      if (closeBtn) {
        closeBtn.click();
        return { closed: true, via: "close-x" };
      }

      return { closed: false, reason: "found-but-no-cta" };
    })
    .catch(() => ({ closed: false, reason: "evaluate-error" }) as const);

  if (closed.closed) {
    log.log(`Dismissed welcome/changelog modal (${"via" in closed ? closed.via : ""})`);
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }

  // Last-ditch fallback: if SOMETHING modal-shaped is still on screen, try
  // Escape. Harmless if no modal is open.
  if (closed.reason === "found-but-no-cta") {
    log.log("Welcome modal had no recognisable CTA — pressing Escape");
    await page.keyboard.press("Escape").catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }
  return false;
}

export async function waitForLoadingToClear(page: Page, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const loading = await page.evaluate(() => {
      const text = (document.body?.textContent ?? "").trim().toLowerCase();
      // Page is essentially empty showing only "Loading..."
      return text === "loading…" || text === "loading..." || text === "loading";
    }).catch(() => false);
    if (!loading) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Generation settings panel
//  ─────────────────────────
//  The bottom prompt bar exposes a single combined chip whose visible text
//  encodes (model · ratio · count), e.g. "🍌 Nano Banana 2crop_16_9x2".
//  Clicking the chip opens one panel containing four sections (verified via
//  scripts/flow-tv-inspect-chip.ts):
//    - Image / Video tabs            (we always want Image)
//    - Aspect ratio tabs             text="crop_16_916:9", "crop_9_169:16", …
//    - Output count tabs             text="x1", "x2", "x3", "x4"
//    - Model dropdown                text="🍌 Nano Banana 2arrow_drop_down"
//  Settings persist on the project, so we apply them once per Phase 1 run and
//  short-circuit when the chip already reports the desired values.
// ──────────────────────────────────────────────────────────────────────────────

export interface GenerationSettings {
  ratio: "9:16" | "3:4" | "1:1" | "4:3" | "16:9";
  count: 1 | 2 | 3 | 4;
}

// 16:9 horizontal for character + every scene + downstream video. Phase 1's
// previous default was 9:16; do not revert without updating sample_prompt and
// the regenerator below to match.
const DESIRED_SETTINGS: GenerationSettings = { ratio: "16:9", count: 1 };

export const RATIO_TAB_TEXT: Record<GenerationSettings["ratio"], string> = {
  "16:9": "crop_16_9",
  "4:3": "crop_landscape",
  "1:1": "crop_square",
  "3:4": "crop_portrait",
  "9:16": "crop_9_16",
};

// Read what the chip currently advertises (model · ratio token · count token).
// Note: the chip's textContent concatenates the Material Icons name (e.g.
// "crop_9_16") with the count ("x1") with no separator, e.g. "crop_9_16x1".
// We match the known ratio tokens exactly to avoid greedy regex bugs.
// `mode` indicates which kind of chip we expect to find:
//   - "image": the chip in image-gen mode reads "🍌 Nano Banana 2crop_16_9x1"
//   - "video": the chip in video-gen mode reads "Videocrop_16_9x1"
//   - "any":   accept either (used for generic detection)
export async function readChipState(
  page: Page,
  mode: "image" | "video" | "any" = "image",
): Promise<{ text: string; ratio?: string; count?: number; mode?: "image" | "video" } | null> {
  const matchImage = mode === "image" || mode === "any";
  const matchVideo = mode === "video" || mode === "any";
  const src = `() => {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      // Count is rendered "1x"/"2x" today (Flow changed from legacy "x1"/"x2"). Accept both.
      if (!/(\\dx|x\\d)/.test(t)) continue;
      if (!/crop_/.test(t)) continue;
      var isImageChip = ${matchImage} && /(nano banana|imagen)/i.test(t);
      // Video chip starts with literal "Video" (no "Veo" — that's a model name).
      var isVideoChip = ${matchVideo} && /^Video/.test(t);
      if (!isImageChip && !isVideoChip) continue;
      // Extract count from either "1x" (current) or "x1" (legacy) form.
      var m = t.match(/(\\d)x|x(\\d)/);
      var countDigit = m ? (m[1] || m[2]) : null;
      var tokens = ['crop_16_9', 'crop_landscape', 'crop_square', 'crop_portrait', 'crop_9_16'];
      var ratio = null;
      for (var k = 0; k < tokens.length; k++) {
        if (t.indexOf(tokens[k]) >= 0) { ratio = tokens[k]; break; }
      }
      return {
        text: t,
        ratio: ratio,
        count: countDigit ? Number(countDigit) : null,
        mode: isVideoChip ? 'video' : 'image',
      };
    }
    return null;
  }`;
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${src})`)() as any,
  ) as Promise<{ text: string; ratio?: string; count?: number; mode?: "image" | "video" } | null>;
}

// Locate the bottom-bar chip and return its center coordinates so we can
// dispatch a real mouse click via puppeteer's page.mouse, which propagates the
// pointerdown/up sequence Slate/React expect (a programmatic .click() did NOT
// open the panel reliably).
export async function locateChipCenter(
  page: Page,
  mode: "image" | "video" | "any" = "any",
): Promise<{ x: number; y: number } | null> {
  const matchImage = mode === "image" || mode === "any";
  const matchVideo = mode === "video" || mode === "any";
  const src = `() => {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var t = (b.textContent || '').trim();
      // Count is rendered "1x"/"2x" today (Flow changed from legacy "x1"/"x2"). Accept both.
      if (!/(\\dx|x\\d)/.test(t)) continue;
      if (!/crop_/.test(t)) continue;
      var isImageChip = ${matchImage} && /(nano banana|imagen)/i.test(t);
      var isVideoChip = ${matchVideo} && /^Video/.test(t);
      if (!isImageChip && !isVideoChip) continue;
      var r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.top < 600) continue;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    return null;
  }`;
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${src})`)() as any,
  ) as Promise<{ x: number; y: number } | null>;
}

export async function clickChip(
  page: Page,
  mode: "image" | "video" | "any" = "any",
): Promise<boolean> {
  const center = await locateChipCenter(page, mode);
  if (!center) return false;
  await page.mouse.click(center.x, center.y);
  return true;
}

// Heuristic: wait for the panel to actually render by polling for the count
// tabs (1x/2x/3x/4x today, x1/x2/x3/x4 legacy) — they only exist while the panel is open.
export async function waitForSettingsPanel(page: Page, timeoutMs = 5_000): Promise<boolean> {
  const start = Date.now();
  const src = `() => {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('button[role="tab"]'));
    for (var i = 0; i < tabs.length; i++) {
      var t = (tabs[i].textContent || '').trim();
      if (t === '1x' || t === '2x' || t === '3x' || t === '4x') return true;
      if (t === 'x1' || t === 'x2' || t === 'x3' || t === 'x4') return true;
    }
    return false;
  }`;
  while (Date.now() - start < timeoutMs) {
    const open = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${src})`)() as any,
    )) as boolean;
    if (open) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Locate the tab inside the open settings panel whose textContent starts
// with `prefix` (e.g. "crop_9_16" for 9:16 aspect, "x1" for count=1). Returns
// the tab's centre coordinates plus its selected state so the caller can
// decide whether to click and so we can dispatch a real puppeteer mouse click.
export async function locatePanelTab(
  page: Page,
  prefix: string,
): Promise<{ x: number; y: number; alreadySelected: boolean } | null> {
  const src = `(prefix) => {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('button[role="tab"]'));
    for (var i = 0; i < tabs.length; i++) {
      var t = (tabs[i].textContent || '').trim();
      if (t.indexOf(prefix) === 0) {
        var r = tabs[i].getBoundingClientRect();
        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          alreadySelected: tabs[i].getAttribute('aria-selected') === 'true',
        };
      }
    }
    return null;
  }`;
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${src})`)() as any,
    prefix,
  ) as Promise<{ x: number; y: number; alreadySelected: boolean } | null>;
}

export async function clickPanelTab(page: Page, prefix: string): Promise<{ ok: boolean; alreadySelected: boolean }> {
  const tab = await locatePanelTab(page, prefix);
  if (!tab) return { ok: false, alreadySelected: false };
  if (!tab.alreadySelected) await page.mouse.click(tab.x, tab.y);
  return { ok: true, alreadySelected: tab.alreadySelected };
}

/**
 * Click a tab inside the open settings panel whose visible text ENDS WITH
 * `wantedSuffix` (case-insensitive). Used to flip the top-of-panel mode
 * tabs ("Image" / "Video") which often have a Material icon prefix in the
 * concatenated textContent (e.g. "image_outlinedImage").
 *
 * Returns ok:false if no matching tab is found.
 */
export async function clickPanelTabBySuffix(
  page: Page,
  wantedSuffix: string,
): Promise<{ ok: boolean; alreadySelected: boolean }> {
  const src = `(suffix) => {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"], button'));
    var lower = suffix.toLowerCase();
    for (var i = 0; i < tabs.length; i++) {
      var t = (tabs[i].textContent || '').trim().toLowerCase();
      if (!t.endsWith(lower)) continue;
      var r = tabs[i].getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      var alreadySelected = tabs[i].getAttribute('aria-selected') === 'true';
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        alreadySelected: alreadySelected,
      };
    }
    return null;
  }`;
  const hit = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${src})`)() as any,
    wantedSuffix,
  )) as { x: number; y: number; alreadySelected: boolean } | null;
  if (!hit) return { ok: false, alreadySelected: false };
  if (!hit.alreadySelected) {
    await page.mouse.click(hit.x, hit.y);
  }
  return { ok: true, alreadySelected: hit.alreadySelected };
}

// Detect whether we're inside an image-edit / detail view rather than the
// project's main creation surface. Image-edit view has a "Done" button at the
// top-right and shows "What do you want to change?" placeholder. The bottom
// chip in that mode does NOT show ratio/count tokens.
export async function isInImageEditView(page: Page): Promise<boolean> {
  const src = `() => {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
    var hasDone = false;
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      if (t === 'Done' || t === 'doneDone') { hasDone = true; break; }
    }
    var placeholderHit = false;
    var divs = document.querySelectorAll('div, span');
    for (var j = 0; j < divs.length; j++) {
      var dt = (divs[j].textContent || '').trim();
      if (dt === 'What do you want to change?') { placeholderHit = true; break; }
    }
    return hasDone || placeholderHit;
  }`;
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${src})`)() as any,
  ) as Promise<boolean>;
}

// Bounce out of any image-edit / detail view back to the project's main
// creation surface so settings + prompts apply globally.
export async function exitImageEditView(page: Page, runDir: string): Promise<boolean> {
  const wasIn = await isInImageEditView(page);
  if (!wasIn) return true;
  log.log("Currently in image-edit view, navigating back to project");
  await takeScreenshot(page, runDir, "exit-edit-view-before");
  // Click the back arrow at top-left (text="arrow_backGo Back").
  const clicked = await page
    .evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const b of btns) {
        const t = ((b as HTMLElement).textContent || "").trim();
        if (t === "arrow_backGo Back") {
          (b as HTMLElement).click();
          return true;
        }
      }
      return false;
    })
    .catch(() => false);
  if (!clicked) {
    log.warn("  back button not found, trying Escape + browser back");
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 400));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const stillIn = await isInImageEditView(page);
  await takeScreenshot(page, runDir, "exit-edit-view-after");
  if (stillIn) {
    log.error("Still in image-edit view after attempting to exit");
    return false;
  }
  log.log("Returned to project creation surface");
  return true;
}

// Place the cursor in the prompt input. Safe to use as a panel-dismiss target
// because clicking the input does NOT open any image and it's the next thing
// we need anyway.
export async function clickPromptInputArea(page: Page): Promise<void> {
  await page.click(PROMPT_SLATE_SELECTOR).catch(() => {});
  await new Promise((r) => setTimeout(r, 250));
}

// Detect whether the Image/Video tabs are visible — that pair only renders
// while the bottom-bar settings panel is open. We use this to detect a stuck
// panel and to verify it actually closed.
export async function isSettingsPanelOpen(page: Page): Promise<boolean> {
  const src = `() => {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('button[role="tab"]'));
    var hasCount = false, hasRatio = false;
    for (var i = 0; i < tabs.length; i++) {
      var t = (tabs[i].textContent || '').trim();
      if (t === '1x' || t === '2x' || t === '3x' || t === '4x') hasCount = true;
      if (t === 'x1' || t === 'x2' || t === 'x3' || t === 'x4') hasCount = true;
      if (t.indexOf('crop_') === 0) hasRatio = true;
    }
    return hasCount && hasRatio;
  }`;
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${src})`)() as any,
  ).catch(() => false)) as boolean;
}

// Aggressively close the settings panel: press Escape (closes most popovers
// in React-based UIs), check, click well-clear of the panel as a fallback,
// re-check. Throw if still open — staying inside the panel breaks every
// subsequent typing/submit step.
export async function closeSettingsPanel(page: Page, runDir: string): Promise<void> {
  if (!(await isSettingsPanelOpen(page))) return;
  log.log("Settings panel still open — pressing Escape to dismiss");
  await page.keyboard.press("Escape").catch(() => {});
  await new Promise((r) => setTimeout(r, 350));
  if (!(await isSettingsPanelOpen(page))) return;

  // Fallback: click far above the prompt bar and panel to drop focus, then
  // press Escape again. We avoid (100, 400) which can land on a project tile
  // and open image-edit view; aim at the top-left empty area instead.
  log.log("  Escape didn't close panel — clicking top-left empty area");
  await page.mouse.click(8, 200).catch(() => {});
  await new Promise((r) => setTimeout(r, 250));
  await page.keyboard.press("Escape").catch(() => {});
  await new Promise((r) => setTimeout(r, 350));
  if (!(await isSettingsPanelOpen(page))) return;

  await takeScreenshot(page, runDir, "settings-panel-stuck-open");
  throw new Error("Settings panel refused to close after Escape + outside click");
}

// Hard-verify the chip state matches what we want. This is the single source
// of truth before submitting any prompt — if it returns false, the caller
// MUST refuse to generate, otherwise we burn credits on wrong-aspect output.
export async function verifyChipMatches(
  page: Page,
  desired: GenerationSettings,
  mode: "image" | "video" = "image",
): Promise<{ ok: boolean; reason: string; chipText?: string }> {
  if (await isInImageEditView(page)) {
    return { ok: false, reason: "page is in image-edit view, not project creation surface" };
  }
  const state = await readChipState(page, mode);
  if (!state) return { ok: false, reason: `settings chip not found on page (mode=${mode})` };
  if (state.mode !== mode) {
    return { ok: false, reason: `chip is in ${state.mode} mode but expected ${mode}`, chipText: state.text };
  }
  const wantRatio = RATIO_TAB_TEXT[desired.ratio];
  const issues: string[] = [];
  if (state.ratio !== wantRatio) issues.push(`ratio=${state.ratio} (want ${wantRatio} = ${desired.ratio})`);
  if (state.count !== desired.count) issues.push(`count=x${state.count} (want x${desired.count})`);
  if (issues.length > 0) return { ok: false, reason: issues.join(", "), chipText: state.text };
  return { ok: true, reason: "match", chipText: state.text };
}

export async function ensureGenerationSettings(
  page: Page,
  runDir: string,
  desired: GenerationSettings = DESIRED_SETTINGS,
): Promise<void> {
  // Step 0: dismiss any blocking welcome / changelog / "what's new" modal
  // that Flow TV pops up after a release. These overlays sit on top of the
  // entire prompt area and make the settings chip silently unclickable.
  await dismissWelcomeModal(page).catch(() => false);

  // Step 1: make sure we're not stuck inside an image-edit view, otherwise
  // any settings we apply will be local to that image, not the project.
  if (!(await exitImageEditView(page, runDir))) {
    throw new Error("Cannot apply generation settings: stuck in image-edit view");
  }

  const before = await verifyChipMatches(page, desired);
  if (before.ok) {
    log.log(`Generation settings already correct: chip="${before.chipText}"`);
    return;
  }
  log.log(`Generation settings need update (${before.reason}); chip="${before.chipText ?? "unknown"}"`);
  await takeScreenshot(page, runDir, "settings-before");

  let panelOpen = false;
  for (let attempt = 1; attempt <= 3 && !panelOpen; attempt++) {
    // Re-dismiss between attempts in case a modal re-opened (rare but
    // happens if Flow's onboarding tour re-triggers).
    if (attempt > 1) await dismissWelcomeModal(page).catch(() => false);
    if (!(await clickChip(page))) {
      log.error(`Settings chip not found on attempt ${attempt}`);
      await takeScreenshot(page, runDir, `settings-chip-not-found-${attempt}`);
      // One more dismiss + screenshot before giving up: the chip likely
      // exists but is occluded.
      const dismissed = await dismissWelcomeModal(page).catch(() => false);
      if (dismissed) {
        log.log("Dismissed an overlay; retrying chip click once more");
        if (await clickChip(page)) {
          panelOpen = await waitForSettingsPanel(page, 4_000);
          if (panelOpen) break;
        }
      }
      throw new Error(
        "Settings chip not clickable — it may be occluded by a Flow TV welcome/changelog modal. Open Flow TV manually and dismiss any overlays, then retry.",
      );
    }
    panelOpen = await waitForSettingsPanel(page, 4_000);
    if (!panelOpen) log.log(`  panel did not open on attempt ${attempt}, retrying`);
  }
  if (!panelOpen) {
    log.error("Settings panel never opened after 3 attempts");
    await takeScreenshot(page, runDir, "settings-panel-stuck-closed");
    throw new Error("Settings panel never opened");
  }
  await takeScreenshot(page, runDir, "settings-panel-open");

  // Step 1.5: ensure the panel is on the Image tab. The persistent Chrome
  // profile remembers the user's last mode, so if they previously did
  // anything in Video mode the panel will open with Video selected — and
  // any ratio/count clicks below would silently configure the WRONG mode.
  const imageSwitch = await clickPanelTabBySuffix(page, "image");
  if (imageSwitch.ok) {
    log.log(`  mode → Image (${imageSwitch.alreadySelected ? "already selected" : "clicked"})`);
    if (!imageSwitch.alreadySelected) await new Promise((r2) => setTimeout(r2, 700));
  } else {
    log.warn("  Image tab not found in settings panel (Flow may have changed labels)");
  }

  const ratioToken = RATIO_TAB_TEXT[desired.ratio];
  const r = await clickPanelTab(page, ratioToken);
  if (r.ok) log.log(`  ratio → ${desired.ratio} (${r.alreadySelected ? "already selected" : "clicked"})`);
  else log.error(`  ratio button '${ratioToken}' not found in panel`);
  await new Promise((r2) => setTimeout(r2, 400));

  // Count tab text changed from "x1"/"x2" (legacy) to "1x"/"2x" (current).
  // Try the new format first, fall back to legacy.
  let c = await clickPanelTab(page, `${desired.count}x`);
  if (!c.ok) c = await clickPanelTab(page, `x${desired.count}`);
  if (c.ok) log.log(`  count → x${desired.count} (${c.alreadySelected ? "already selected" : "clicked"})`);
  else log.error(`  count button 'x${desired.count}' / '${desired.count}x' not found in panel`);
  await new Promise((r2) => setTimeout(r2, 400));

  await takeScreenshot(page, runDir, "settings-panel-applied");

  // Dismiss the panel hard. Pressing Escape is far more reliable than
  // clicking the prompt input — clicks may be intercepted by the panel
  // overlay even at coordinates outside it, and the prompt input click
  // sometimes does NOT close the panel after a tab change.
  await closeSettingsPanel(page, runDir);
  await new Promise((r2) => setTimeout(r2, 400));
  await takeScreenshot(page, runDir, "settings-after");

  const after = await verifyChipMatches(page, desired);
  if (!after.ok) {
    log.error(`Settings did not stick: ${after.reason}; chip="${after.chipText}"`);
    throw new Error(`Settings did not stick after applying: ${after.reason}`);
  }
  log.log(`Generation settings confirmed: chip="${after.chipText}"`);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Project: create or reuse
// ──────────────────────────────────────────────────────────────────────────────

export async function loadProjectCache(storySlug?: string): Promise<ProjectRef | null> {
  // When called with a slug, return that exact project's cache.
  // When called without a slug (mostly inspection/test scripts), fall back to
  // the most recently modified per-slug project file, then to the legacy
  // single-file cache for backwards compatibility.
  if (storySlug) {
    try {
      const raw = await fs.readFile(projectFileFor(storySlug), "utf-8");
      const ref = JSON.parse(raw) as ProjectRef;
      if (ref.projectUrl && ref.projectName) return ref;
      return null;
    } catch {
      return null;
    }
  }
  try {
    const entries = await fs.readdir(PROJECTS_DIR);
    const candidates = entries.filter((e) => e.endsWith(".json"));
    let best: { path: string; mtimeMs: number } | null = null;
    for (const e of candidates) {
      const p = path.join(PROJECTS_DIR, e);
      try {
        const st = await fs.stat(p);
        if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
      } catch {
        // ignore
      }
    }
    if (best) {
      const raw = await fs.readFile(best.path, "utf-8");
      const ref = JSON.parse(raw) as ProjectRef;
      if (ref.projectUrl && ref.projectName) return ref;
    }
  } catch {
    // ignore — PROJECTS_DIR may not exist yet
  }
  // Final fallback: legacy single-file cache from before per-slug refactor.
  try {
    const raw = await fs.readFile(path.join(FLOW_DATA_DIR, "project.json"), "utf-8");
    const ref = JSON.parse(raw) as ProjectRef;
    if (ref.projectUrl && ref.projectName) return ref;
  } catch {
    // ignore
  }
  return null;
}

async function saveProjectCache(storySlug: string, ref: ProjectRef): Promise<void> {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  await fs.writeFile(projectFileFor(storySlug), JSON.stringify(ref, null, 2), "utf-8");
}

/**
 * Open the cached Flow project for `storySlug`, or create + name a fresh one.
 * The displayed project name in Flow's UI is exactly `projectName`, which is
 * the date-suffixed storySlug (e.g. `the-discovered-sketchbook-26042026`).
 */
export async function ensureProject(
  page: Page,
  runDir: string,
  storySlug: string,
  projectName: string,
): Promise<ProjectRef> {
  const cached = await loadProjectCache(storySlug);
  if (cached) {
    log.log(`Project cache hit (${storySlug}): ${cached.projectName} → ${cached.projectUrl}`);
    setProgress({ status: "project_setup", message: `Opening existing project: ${cached.projectName}` });
    await page.goto(cached.projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    await dismissCookieWall(page);
    await waitForLoadingToClear(page, 30_000);
    // Flow's per-release "What's new" / onboarding modal can appear here
    // and silently block downstream clicks (chip, prompt input). Dismiss
    // before any further interaction.
    await dismissWelcomeModal(page).catch(() => false);
    await takeScreenshot(page, runDir, "project-reopened");

    // If the on-page title doesn't match our cached name, rename to fix it.
    const currentTitle = await page.$eval(PROJECT_TITLE_SELECTOR, (el) => (el as HTMLInputElement).value).catch(() => "");
    if (currentTitle && currentTitle !== cached.projectName) {
      log.log(`Project title is "${currentTitle}", renaming to "${cached.projectName}"`);
      await renameProjectInPlace(page, cached.projectName, runDir);
    }
    return cached;
  }

  log.log(`No cached project for ${storySlug} — creating new one named "${projectName}"`);
  setProgress({ status: "project_setup", message: `Creating new Flow project: ${projectName}` });
  await page.goto(FLOW_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await dismissCookieWall(page);
  await dismissWelcomeModal(page).catch(() => false);
  await takeScreenshot(page, runDir, "flow-home");

  // Try the obvious project-creation CTAs in order. We deliberately do NOT
  // fall back to "Get started" here — Flow's welcome/changelog modals also
  // use that label, so a stray match would dismiss the modal but never
  // create the project, leaving rename to fail downstream.
  const created =
    (await clickByText(page, "New project", 8_000)) ||
    (await clickByText(page, "Create", 8_000)) ||
    (await clickByText(page, "Start a new", 4_000));

  if (!created) {
    await takeScreenshot(page, runDir, "no-create-button-found");
    throw new Error("Flow UI: no 'Create / New project' button found. Save a screenshot and adjust selectors.");
  }
  await new Promise((r) => setTimeout(r, 2500));
  await waitForLoadingToClear(page, 30_000);
  await dismissWelcomeModal(page).catch(() => false);
  await takeScreenshot(page, runDir, "after-create-click");

  await renameProjectInPlace(page, projectName, runDir);

  const projectUrl = page.url();
  const ref: ProjectRef = {
    projectName,
    projectUrl,
    createdAt: Date.now(),
  };
  await saveProjectCache(storySlug, ref);
  log.log(`Project created and cached (${storySlug}): ${projectUrl}`);
  return ref;
}

/**
 * Flow auto-titles new projects with a date string like "25 Apr, 21:29".
 * The title sits at the top-left of the project page. Clicking it makes it
 * editable. Implementation: scan top-left strip for an element whose text
 * matches a date-time pattern, click it, type the new name, blur.
 */
// Flow's project title at top-left is an actual <input aria-label="Editable text"
// value="25 Apr, 21:29">. We click it, select-all, type new name, press Enter.
const PROJECT_TITLE_SELECTOR = "input[aria-label='Editable text']";

async function renameProjectInPlace(page: Page, newName: string, runDir: string): Promise<void> {
  // Wait up to 15s for the title input to render.
  let handle = null;
  for (let i = 0; i < 30; i++) {
    handle = await page.$(PROJECT_TITLE_SELECTOR);
    if (handle) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!handle) {
    await takeScreenshot(page, runDir, "rename-no-title-found");
    log.warn(`Could not locate project title input — proceeding without rename.`);
    return;
  }

  await page.click(PROJECT_TITLE_SELECTOR, { clickCount: 3 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 250));
  await page.keyboard.down("Meta"); await page.keyboard.press("KeyA"); await page.keyboard.up("Meta");
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.type(newName, { delay: 8 });
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 800));

  // Verify and log
  const after = await page.$eval(PROJECT_TITLE_SELECTOR, (el) => (el as HTMLInputElement).value).catch(() => "");
  log.log(`Project title is now "${after}" (target was "${newName}")`);
  await takeScreenshot(page, runDir, "after-rename");
}

// ──────────────────────────────────────────────────────────────────────────────
//  Image generation (no clip, no chaining)
// ──────────────────────────────────────────────────────────────────────────────

async function waitForImageUrl(page: Page, timeoutMs = 180_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"));
      const fromInput = inputs
        .map((i) => (i as HTMLInputElement).value)
        .find((v) => v && /^https?:\/\//i.test(v) && /\.(png|jpe?g|webp)/i.test(v));
      if (fromInput) return fromInput;
      const imgs = Array.from(document.querySelectorAll("img"));
      const fromImg = imgs
        .map((i) => (i as HTMLImageElement).src)
        .find((src) => src && /lh3\.googleusercontent|storage\.googleapis|labs\.google/i.test(src));
      return fromImg ?? null;
    });
    if (value) return value;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

async function snapshotKnownImageUrls(page: Page): Promise<Set<string>> {
  const src = `() => {
    var out = [];
    var imgs = Array.prototype.slice.call(document.querySelectorAll('img'));
    for (var i = 0; i < imgs.length; i++) {
      var s = imgs[i].src;
      if (s && /^https?:\\/\\//i.test(s)) out.push(s);
    }
    return out;
  }`;
  const urls = (await page
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .evaluate(new Function(`return (${src})`)() as any)
    .catch(() => [] as string[])) as string[];
  return new Set(urls);
}

async function waitForNewImageUrl(
  page: Page,
  before: Set<string>,
  runDir: string,
  stepLabel: string,
  timeoutMs = 360_000,
): Promise<string | null> {
  const start = Date.now();
  const knownArr = Array.from(before);
  let lastSnapAt = 0;
  let snapIdx = 0;
  // Match ANY new image whose src looks like a media URL (http(s), not data:),
  // excluding obvious ui assets. Flow may host on multiple domains so don't be
  // too picky.
  const finderSrc = `
    (known) => {
      var imgs = Array.prototype.slice.call(document.querySelectorAll('img'));
      var cand = [];
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src;
        if (!src) continue;
        if (known.indexOf(src) !== -1) continue;
        if (src.indexOf('data:') === 0) continue;
        if (!/^https?:\\/\\//i.test(src)) continue;
        // Skip avatars, icons, ui pieces.
        if (/avatar|icon|logo|favicon|google-id|gstatic\\/images/i.test(src)) continue;
        var r = imgs[i].getBoundingClientRect();
        // Real generated outputs are reasonably sized.
        if (r.width < 80 || r.height < 80) continue;
        cand.push(src);
      }
      return cand[0] || null;
    }
  `;
  // Detect explicit visible error toasts/snackbars only. Body text alone is
  // unreliable because React hidden templates can contain error strings.
  const errSrc = `
    () => {
      var nodes = Array.prototype.slice.call(document.querySelectorAll('[role="alert"], [role="status"], [data-testid*="toast" i], [data-testid*="snackbar" i], [class*="toast" i], [class*="snackbar" i], [class*="error" i]'));
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        var t = (n.textContent || '').toLowerCase();
        if (t.length < 4 || t.length > 300) continue;
        if (t.indexOf('out of credits') >= 0) return 'out_of_credits';
        if (t.indexOf('rate limit') >= 0) return 'rate_limited';
        if (t.indexOf('try again') >= 0) return 'try_again';
        if (t.indexOf('not available in your region') >= 0) return 'region_block';
        if (t.indexOf('failed') >= 0 && t.indexOf('generation') >= 0) return 'generation_failed';
      }
      return null;
    }
  `;
  while (Date.now() - start < timeoutMs) {
    const found = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${finderSrc})`)() as any,
      knownArr,
    )) as string | null;
    if (found) return found;

    const err = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${errSrc})`)() as any,
    ).catch(() => null)) as string | null;
    if (err) {
      log.error(`Flow returned an error state: ${err}`);
      await takeScreenshot(page, runDir, `${stepLabel}-flow-error-${err}`);
      return null;
    }

    if (Date.now() - lastSnapAt > 30_000) {
      lastSnapAt = Date.now();
      snapIdx += 1;
      const elapsed = Math.round((Date.now() - start) / 1000);
      log.log(`[${stepLabel}] still waiting (${elapsed}s elapsed)`);
      await takeScreenshot(page, runDir, `${stepLabel}-wait-${String(snapIdx).padStart(2, "0")}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Ingredient (reference image) upload
//  ───────────────────────────────────
//  Flow's bottom prompt bar has a "+" button (textContent "add_2Create") that
//  opens an asset picker popover. The popover contains a list of project
//  assets plus an "Upload image" entry (textContent "uploadUpload image").
//  Clicking that triggers a native <input type="file"> we can fulfil with
//  page.waitForFileChooser. After upload, a small thumbnail appears just above
//  the prompt input ("staged ingredient slot") with an × button to remove it.
//  Submitting the prompt then uses that ingredient as a visual reference and
//  consumes it (the slot clears for the next prompt).
//
//  We re-upload the character file for every scene because:
//    - it's bulletproof regardless of project state
//    - the character file is tiny (~300KB) so the upload cost is negligible
//    - using the project asset list would require flaky name/URL matching
// ──────────────────────────────────────────────────────────────────────────────

const PLUS_BTN_FINDER_SRC = `
  () => {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      if (t !== 'add_2Create' && t !== 'add_2') continue;
      var r = btns[i].getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Must be on the bottom prompt bar — y > 600 — to avoid grabbing some
      // other "+ Create" affordance elsewhere on the page.
      if (r.top < 600) continue;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    return null;
  }
`;

// Accepts any visible element whose text contains "Upload image" (Material
// Icons font may inject an unpredictable icon name prefix like "upload" or
// "file_upload"). We walk EVERY element (not only buttons/role=button) because
// Flow renders the row as a generic <div> that becomes clickable via JS.
//
// We pick the *innermost* match (smallest bbox) so we click the actual button,
// not its giant ancestor container.
const UPLOAD_BTN_FINDER_SRC = `
  () => {
    var els = Array.prototype.slice.call(document.querySelectorAll('*'));
    var best = null;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var t = (el.textContent || '').trim();
      if (!t) continue;
      if (t.length > 60) continue;
      if (!/upload image/i.test(t)) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width > 400 || r.height > 200) continue;
      var area = r.width * r.height;
      if (!best || area < best.area) {
        best = {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          text: t,
          tag: el.tagName.toLowerCase(),
          area: area,
        };
      }
    }
    if (best) return { x: best.x, y: best.y, text: best.text, tag: best.tag };
    return null;
  }
`;

// Diagnostic: dump every element whose text contains "upload" (case-insensitive)
// plus its bbox and tag. Used when the primary finder fails so we can debug.
const UPLOAD_DEBUG_DUMP_SRC = `
  () => {
    var els = Array.prototype.slice.call(document.querySelectorAll('*'));
    var out = [];
    for (var i = 0; i < els.length && out.length < 30; i++) {
      var el = els[i];
      var t = (el.textContent || '').trim();
      if (!t) continue;
      if (t.length > 80) continue;
      if (!/upload/i.test(t)) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        text: t.slice(0, 60),
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
    return out;
  }
`;

// True once the upload progress vanishes AND the staged-ingredient slot above
// the prompt bar shows a real <img> thumbnail (not the placeholder grey box).
const INGREDIENT_READY_SRC = `
  () => {
    // Upload progress shows as text "<n>%". If anything containing a percent
    // is visible at top-left, we're still uploading.
    var bodies = Array.prototype.slice.call(document.querySelectorAll('div, span'));
    for (var i = 0; i < bodies.length; i++) {
      var t = (bodies[i].textContent || '').trim();
      if (/^\\d{1,3}%$/.test(t)) {
        var r = bodies[i].getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        return { ready: false, reason: 'uploading ' + t };
      }
    }
    // Look for the small ingredient thumbnail rendered inside the prompt
    // bar. Today Flow places it at the top-left of the prompt block (which
    // can be ~300-400 px above the very bottom of the viewport when the
    // prompt has multiple lines). Constraints:
    //   - small (≤ 80 px on either side) — gallery tiles are >120 px
    //   - in the lower half of the viewport, on the left half — avoids the
    //     top-right user avatar (which is also ≤ 80 px)
    //   - has a non-empty, non-data: src (data: avatars are not real uploads)
    var imgs = Array.prototype.slice.call(document.querySelectorAll('img'));
    var vh = window.innerHeight;
    var vw = window.innerWidth;
    for (var j = 0; j < imgs.length; j++) {
      var ir = imgs[j].getBoundingClientRect();
      if (ir.width === 0 || ir.height === 0) continue;
      if (ir.width > 80 || ir.height > 80) continue;
      // Lower half of viewport.
      if (ir.top < vh / 2) continue;
      // Left half of viewport (avoid top-right avatar even if it scrolled into lower half somehow).
      if (ir.left > vw / 2) continue;
      var src = imgs[j].src || '';
      if (!src || src.indexOf('data:') === 0) continue;
      return { ready: true, src: src.slice(0, 80) };
    }
    // Also accept the staged slot existing as an empty grey box ONLY if no
    // upload progress is visible — Flow renders the ingredient ready state
    // briefly without a real <img> in some cases.
    return { ready: false, reason: 'no ingredient thumb yet' };
  }
`;

export async function clickPlusButton(page: Page): Promise<boolean> {
  const pos = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${PLUS_BTN_FINDER_SRC})`)() as any,
  )) as { x: number; y: number } | null;
  if (!pos) return false;
  await page.mouse.click(pos.x, pos.y);
  return true;
}

export async function clickUploadInPopover(
  page: Page,
): Promise<{ x: number; y: number; text: string; tag?: string } | null> {
  const start = Date.now();
  while (Date.now() - start < 8_000) {
    const pos = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${UPLOAD_BTN_FINDER_SRC})`)() as any,
    )) as { x: number; y: number; text: string; tag?: string } | null;
    if (pos) return pos;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function dumpUploadCandidates(page: Page): Promise<unknown[]> {
  try {
    return (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${UPLOAD_DEBUG_DUMP_SRC})`)() as any,
    )) as unknown[];
  } catch {
    return [];
  }
}

export async function waitForIngredientReady(page: Page, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  let lastReason = "";
  while (Date.now() - start < timeoutMs) {
    const state = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${INGREDIENT_READY_SRC})`)() as any,
    )) as { ready: boolean; reason?: string; src?: string };
    if (state.ready) {
      log.log(`  ingredient ready (thumb src=${state.src ?? "n/a"})`);
      return true;
    }
    if (state.reason && state.reason !== lastReason) {
      log.log(`  waiting on ingredient: ${state.reason}`);
      lastReason = state.reason;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

// Shared upload step. Assumes a popover is already open (whoever called this
// has just clicked +/Start/End and seen the asset picker render). Clicks
// "Upload image" inside the popover, accepts the local file via the native
// file chooser, returns once the chooser resolved. Caller is responsible for
// verifying the asset actually attached (since the "ready" signature differs
// for ingredients vs. start/end frame slots).
export async function uploadImageThroughOpenPopover(
  page: Page,
  filePath: string,
  runDir: string,
  stepLabel: string,
): Promise<{ uploadX: number; uploadY: number; tag?: string }> {
  if (!fsSync.existsSync(filePath)) throw new Error(`Image missing: ${filePath}`);

  const uploadPos = await clickUploadInPopover(page);
  if (!uploadPos) {
    await takeScreenshot(page, runDir, `${stepLabel}-no-upload-btn`);
    const candidates = await dumpUploadCandidates(page);
    log.error(
      `[${stepLabel}] upload-button candidates dump: ${JSON.stringify(candidates).slice(0, 1200)}`,
    );
    throw new Error("'Upload image' button not found in popover");
  }
  log.log(
    `[${stepLabel}] upload button at (${uploadPos.x},${uploadPos.y}) tag=${uploadPos.tag ?? "?"} text="${uploadPos.text}"`,
  );
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 10_000 }),
    page.mouse.click(uploadPos.x, uploadPos.y),
  ]);
  await chooser.accept([filePath]);
  return { uploadX: uploadPos.x, uploadY: uploadPos.y, tag: uploadPos.tag };
}

export async function attachReferenceImage(
  page: Page,
  filePath: string,
  runDir: string,
  stepLabel: string,
): Promise<void> {
  if (!fsSync.existsSync(filePath)) throw new Error(`Reference image missing: ${filePath}`);
  log.log(`[${stepLabel}] attaching reference: ${path.basename(filePath)}`);

  // Open + popover (image-mode ingredient picker).
  const openedPlus = await clickPlusButton(page);
  if (!openedPlus) {
    await takeScreenshot(page, runDir, `${stepLabel}-no-plus`);
    throw new Error("+ button not found on prompt bar");
  }
  await new Promise((r) => setTimeout(r, 700));
  await takeScreenshot(page, runDir, `${stepLabel}-popover-open`);

  await uploadImageThroughOpenPopover(page, filePath, runDir, stepLabel);

  // Wait for upload + ingredient thumbnail to appear in the prompt bar.
  // Flow occasionally finishes the percent-progress UI but takes a few extra
  // seconds to swap in the small thumbnail. 180s is generous but harmless
  // because waitForIngredientReady returns as soon as the thumb is visible.
  const ready = await waitForIngredientReady(page, 180_000);
  await takeScreenshot(page, runDir, `${stepLabel}-ingredient-ready`);
  if (!ready) {
    throw new Error("Ingredient upload did not complete within 180s");
  }
}

export async function generateOneImage(
  page: Page,
  prompt: string,
  outputPath: string,
  runDir: string,
  index: number,
  opts?: {
    stepLabel?: string;
    referencePath?: string;
    desiredSettings?: GenerationSettings;
  },
): Promise<{ url: string }> {
  const stepLabel = opts?.stepLabel ?? `image-${String(index + 1).padStart(2, "0")}`;
  const desiredSettings = opts?.desiredSettings ?? DESIRED_SETTINGS;
  log.log(`[${stepLabel}] entering prompt${opts?.referencePath ? " (with character reference)" : ""}`);

  await waitForLoadingToClear(page);

  // Defensive: if the settings panel somehow drifted open (e.g. a previous
  // step left it stuck), close it before any focus/typing. Typing into a
  // covered Slate editor silently no-ops — exactly the bug we're guarding.
  await closeSettingsPanel(page, runDir);

  const focused = await focusPromptInput(page);
  if (!focused) {
    await takeScreenshot(page, runDir, `${stepLabel}-no-field`);
    throw new Error(`Flow UI: prompt Slate editor not found for ${stepLabel}`);
  }

  // Click the Slate editor to bring focus. Slate handles native browser
  // beforeinput / input events fine when the contenteditable is properly focused.
  await page.click(PROMPT_SLATE_SELECTOR);
  await new Promise((r) => setTimeout(r, 300));
  await takeScreenshot(page, runDir, `${stepLabel}-field-focused`);

  // Clear any text already there (in Slate, select-all + Backspace clears).
  await page.keyboard.down("Meta"); await page.keyboard.press("KeyA"); await page.keyboard.up("Meta");
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 100));

  await page.keyboard.type(prompt, { delay: 4 });
  await new Promise((r) => setTimeout(r, 500));

  // Verify Slate received the text. CRITICAL: the Slate editor's textContent
  // returns the placeholder ("What do you want to create?") when empty — it's
  // 27 chars and slipped past an old length-only gate. We require the read-back
  // to be (a) longer than the placeholder, (b) NOT identical to the placeholder,
  // and (c) contain a non-trivial slice of the prompt we just typed.
  const PROMPT_PLACEHOLDER = "What do you want to create?";
  const expectedHead = prompt.slice(0, 25).trim();
  const got = (await page.evaluate(
    `(function(){ var el = document.querySelector("${PROMPT_SLATE_SELECTOR}"); return el ? (el.textContent || '').trim() : ''; })()`
  ).catch(() => "")) as string;
  log.log(`[${stepLabel}] prompt field now contains ${got.length} chars (preview: "${got.slice(0, 60)}…")`);
  await takeScreenshot(page, runDir, `${stepLabel}-prompt-typed`);

  const acceptedTyping =
    got.length >= PROMPT_PLACEHOLDER.length + 10 &&
    got !== PROMPT_PLACEHOLDER &&
    got.includes(expectedHead);
  if (!acceptedTyping) {
    log.error(
      `[${stepLabel}] Slate did NOT accept the prompt. Got "${got.slice(0, 80)}", expected to contain "${expectedHead}".`,
    );
    await takeScreenshot(page, runDir, `${stepLabel}-typing-failed`);
    throw new Error(
      `Slate editor did not accept prompt (got=${got.length}ch, placeholder=${got === PROMPT_PLACEHOLDER}). Aborting before submit.`,
    );
  }

  // If we have a character reference image, attach it AFTER typing has been
  // verified but BEFORE submitting. We do this last so the typing check runs
  // against a clean prompt-bar state (the popover would otherwise hide it).
  if (opts?.referencePath) {
    await attachReferenceImage(page, opts.referencePath, runDir, stepLabel);
    // Re-focus the slate editor in case the popover stole focus.
    await page.click(PROMPT_SLATE_SELECTOR).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── HARD GATE ───────────────────────────────────────────────────────────
  // Verify the chip matches the desired settings RIGHT BEFORE submit. If it
  // doesn't, refuse to submit so we don't burn a credit on wrong-aspect or
  // multi-output generation. Re-apply settings and re-check; if still wrong,
  // abort the whole run instead of silently producing junk.
  const preflight = await verifyChipMatches(page, desiredSettings);
  if (!preflight.ok) {
    log.error(`[${stepLabel}] PRE-SUBMIT CHECK FAILED: ${preflight.reason}; chip="${preflight.chipText}"`);
    await takeScreenshot(page, runDir, `${stepLabel}-preflight-failed`);
    log.log(`[${stepLabel}] re-applying settings and retrying once`);
    await ensureGenerationSettings(page, runDir, desiredSettings);
    // Re-focus the prompt input and re-type, since settings panel may have
    // cleared focus / state. Same select-all + delete as initial path.
    await focusPromptInput(page);
    await page.keyboard.down("Meta"); await page.keyboard.press("KeyA"); await page.keyboard.up("Meta");
    await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(prompt, { delay: 6 });
    await new Promise((r) => setTimeout(r, 350));
    const recheck = await verifyChipMatches(page, desiredSettings);
    if (!recheck.ok) {
      throw new Error(
        `Refusing to submit — chip still wrong after retry: ${recheck.reason}; chip="${recheck.chipText}"`,
      );
    }
    log.log(`[${stepLabel}] settings re-applied: chip="${recheck.chipText}"`);
  } else {
    log.log(`[${stepLabel}] preflight OK: chip="${preflight.chipText}"`);
  }

  const before = await snapshotKnownImageUrls(page);
  log.log(`[${stepLabel}] image-url baseline: ${before.size} existing <img> srcs`);

  const submitted = await clickPromptSubmit(page);
  if (submitted.ok) {
    log.log(`[${stepLabel}] submit clicked → ${submitted.description}`);
  } else {
    log.log(`[${stepLabel}] submit button not found (${submitted.description}); pressing Enter`);
    await page.keyboard.press("Enter");
  }
  await takeScreenshot(page, runDir, `${stepLabel}-submitted`);
  log.log(`[${stepLabel}] waiting for new image URL (up to 6 min)`);

  const url = await waitForNewImageUrl(page, before, runDir, stepLabel, 360_000);
  if (!url) {
    await takeScreenshot(page, runDir, `${stepLabel}-timeout`);
    throw new Error(`Flow image generation timed out for ${stepLabel}`);
  }
  log.log(`[${stepLabel}] image url: ${url.slice(0, 120)}…`);

  const buf = await downloadInBrowser(page, url);
  await fs.writeFile(outputPath, buf);
  log.log(`[${stepLabel}] saved → ${outputPath} (${(buf.length / 1024).toFixed(1)} KB)`);
  await takeScreenshot(page, runDir, `${stepLabel}-saved`);
  return { url };
}

// Download bytes by navigating a fresh tab in the same browser session. This
// follows the labs.google redirect into the actual CDN image URL, with all
// auth cookies attached, and bypasses the browser's CORS restrictions that
// block in-page fetch() for cross-origin redirects.
export async function downloadInBrowser(page: Page, url: string): Promise<Buffer> {
  const browser = page.browser();
  const dl = await browser.newPage();
  try {
    const resp = await dl.goto(url, { waitUntil: "load", timeout: 60_000 });
    if (!resp) throw new Error("no response from download navigation");
    const status = resp.status();
    if (status >= 400) throw new Error(`HTTP ${status} from ${resp.url()}`);
    const buf = await resp.buffer();
    if (buf.length < 1024) {
      throw new Error(`download too small (${buf.length} bytes) — likely an HTML page, not an image`);
    }
    return buf;
  } finally {
    await dl.close().catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Phase 1 orchestrator
// ──────────────────────────────────────────────────────────────────────────────

export async function ensureFfmpegOk(): Promise<void> {
  // Not strictly required for image generation, but verify chrome path early.
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    log.warn("ffmpeg not found — phase 1 image gen does not need it but later phases will.");
  }
}

/**
 * Adopt an already-existing gallery tile for our canonical asset slot.
 *
 * Two cases the caller has already discriminated:
 *
 *   1. The tile's visible display name MATCHES the canonical Flow display
 *      name exactly — Veo finished + rename succeeded on a prior run, but
 *      we never wrote the local file (download crashed, run was killed,
 *      etc.). We just need to download bytes back.
 *
 *   2. The tile's visible display name matches the canonical UPLOAD filename
 *      (e.g. "iron-bar-hero-06052026-image-03-the-hero-moment.png") — Veo
 *      finished but the rename step crashed, so Flow auto-named the tile
 *      from our source upload's filename. We need to rename to canonical,
 *      then download.
 *
 * In both cases we pull bytes via `downloadInBrowser` (uses the page's auth
 * cookies), write them to the local canonical path, and record in the
 * naming registry so subsequent runs find the local file instantly.
 */
async function adoptGalleryTile(
  page: Page,
  tile: GalleryAssetEntry,
  localPath: string,
  canonicalDisplayName: string,
  registryKey: string,
): Promise<void> {
  const wasAlreadyCanonical = tile.displayName.trim() === canonicalDisplayName.trim();
  if (!wasAlreadyCanonical) {
    log.log(
      `Adopting orphan gallery tile "${tile.displayName}" → renaming to "${canonicalDisplayName}"`,
    );
    try {
      await renameAndVerify(page, tile.rect, canonicalDisplayName, 2);
      log.log(`  rename verified → "${canonicalDisplayName}"`);
    } catch (e) {
      log.warn(
        `  rename failed (${(e as Error).message.slice(0, 120)}); proceeding to download anyway — local file is what the pipeline cares about most.`,
      );
    }
  } else {
    log.log(`Adopting canonical gallery tile "${tile.displayName}" (already named correctly)`);
  }

  if (!fsSync.existsSync(localPath)) {
    log.log(`  downloading bytes from ${tile.src.slice(0, 90)}…`);
    const buf = await downloadInBrowser(page, tile.src);
    await fs.writeFile(localPath, buf);
    log.log(`  saved → ${localPath} (${(buf.length / 1024).toFixed(1)} KB)`);
  } else {
    log.log(`  local file already present at ${localPath}; skipping download`);
  }

  // Echo into the naming registry so the next run hits findExistingLocalAsset
  // first (cheaper than a gallery scan).
  // NOTE: registryKey is intentionally NOT exposed here — the caller already
  // calls recordAsset() right after adoptGalleryTile() returns.
  void registryKey;
}

/**
 * Re-scan the gallery and try to find a tile by previously-orphaned URL(s)
 * recorded for this slot via `rememberOrphanedFlowUrl`. Returns the tile or
 * null if none of the persisted URLs are present in the live gallery.
 *
 * This is the recovery path for the bug where:
 *   "After last image is generated, app is unable to rename it / download
 *    it, so it keeps regenerating the same image."
 *
 * On the failed attempt we now persist the URL we got from Veo. On retry,
 * the pre-flight scan rediscovers the tile by `name=<assetId>` and we adopt
 * it without burning another credit.
 */
async function tryAdoptByOrphanUrls(
  page: Page,
  storySlug: string,
  registryKey: string,
  gallery: Map<string, GalleryAssetEntry>,
  localPath: string,
  canonicalDisplayName: string,
): Promise<boolean> {
  const orphanUrls = await consumeOrphanedFlowUrls(storySlug, registryKey);
  if (orphanUrls.length === 0) return false;
  log.log(
    `Found ${orphanUrls.length} orphan URL(s) for ${registryKey}; trying to adopt the live tile…`,
  );
  for (const url of orphanUrls.slice().reverse()) {
    const assetId = extractAssetIdFromUrl(url);
    if (!assetId) continue;
    const hit = findImageTileByAssetId(gallery, assetId);
    if (!hit) continue;
    await adoptGalleryTile(page, hit, localPath, canonicalDisplayName, registryKey);
    await clearOrphanedFlowUrls(storySlug, registryKey);
    return true;
  }
  log.warn(
    `None of the persisted orphan URLs for ${registryKey} are present in the gallery (live signatures may have rotated).`,
  );
  return false;
}

/**
 * The full "obtain a Phase-1 image for this slot" ladder. Order matters:
 *
 *   1. Local file already on disk (from the naming registry).
 *   2. Gallery tile with our exact canonical Flow display name.
 *   3. Gallery tile auto-named from the upload filename.
 *   4. Gallery tile auto-named from the GENERATION PROMPT (Flow's default
 *      when our rename step crashed AFTER Veo finished rendering).
 *   5. Previously-persisted orphan URL we now find live in the gallery.
 *   6. NO MATCHES → run `generateOneImage` (the only credit-burning path)
 *      THEN rename the tile by URL identity (NOT "most recent" — that's
 *      what produced wrong-tile renames in production), then download.
 *      If anything between Veo and download fails, the URL is persisted as
 *      an orphan so the NEXT pre-flight scan picks it up — no regen.
 *
 * Returns the URL of the tile we ended up using (useful for downstream
 * Phase 2 / debugging) or `null` if the slot was satisfied entirely from a
 * local hard-link / copy.
 */
async function obtainImageForSlot(
  page: Page,
  runDir: string,
  storySlug: string,
  galleryByName: Map<string, GalleryAssetEntry>,
  desiredSettings: GenerationSettings,
  slot: {
    kind: "character" | "image";
    canonical: { flowDisplayName: string; filename: string; registryKey: string };
    localPath: string;
    prompt: string;
    referencePath?: string;
    stepIndex: number;
    progressLabel: string;
  },
): Promise<{ url: string | null; source: "local" | "gallery-name" | "gallery-prompt" | "gallery-orphan-url" | "generated" }> {
  // Reusable rescue branch: try (in order) canonical-name, prompt-prefix,
  // and orphan-URL adoptions. Returns true if any succeeded.
  const tryRescues = async (): Promise<{ matched: boolean; source: "gallery-name" | "gallery-prompt" | "gallery-orphan-url" } | null> => {
    const byName = findImageTileForCanonicalName(galleryByName, slot.canonical);
    if (byName) {
      await adoptGalleryTile(
        page,
        byName,
        slot.localPath,
        slot.canonical.flowDisplayName,
        slot.canonical.registryKey,
      );
      return { matched: true, source: "gallery-name" };
    }
    const byPrompt = findImageTileByPromptPrefix(galleryByName, slot.prompt);
    if (byPrompt) {
      await adoptGalleryTile(
        page,
        byPrompt,
        slot.localPath,
        slot.canonical.flowDisplayName,
        slot.canonical.registryKey,
      );
      return { matched: true, source: "gallery-prompt" };
    }
    const orphanAdopted = await tryAdoptByOrphanUrls(
      page,
      storySlug,
      slot.canonical.registryKey,
      galleryByName,
      slot.localPath,
      slot.canonical.flowDisplayName,
    );
    if (orphanAdopted) {
      return { matched: true, source: "gallery-orphan-url" };
    }
    return null;
  };

  // 1) NO REGENS path — exhaust gallery rescue options before generating.
  const rescued = await tryRescues();
  if (rescued) {
    log.log(
      `[${slot.canonical.registryKey}] satisfied via ${rescued.source} (no Veo credit burned)`,
    );
    return { url: null, source: rescued.source };
  }

  // 2) Wait for the gallery to be quiescent BEFORE we kick off a new
  // generation (otherwise we may submit while Flow is still rendering a
  // prior tile and Veo will queue / reject our submit).
  log.log(`[${slot.canonical.registryKey}] waiting for gallery to be quiescent before submit…`);
  try {
    await waitForGalleryQuiescent(page, 60_000);
  } catch {
    // best-effort
  }

  // Snapshot every <img> src in the gallery RIGHT BEFORE submit. After
  // generation we identify the new tile by set-difference (post − pre).
  // This is robust to Flow resolving its trpc redirect URL into a
  // googleusercontent CDN URL between submit and render — URL-equality
  // matching breaks across that resolution but set-difference doesn't.
  const beforeGallerySrcs = await snapshotGalleryImageSrcs(page);
  log.log(
    `[${slot.canonical.registryKey}] gallery pre-submit snapshot: ${beforeGallerySrcs.size} tile(s)`,
  );

  // 3) Generate.
  setProgress({
    status: slot.kind === "character" ? "generating_character" : "generating_image",
    message: slot.progressLabel,
  });
  let result: { url: string };
  try {
    result = await generateOneImage(page, slot.prompt, slot.localPath, runDir, slot.stepIndex, {
      stepLabel: slot.canonical.registryKey,
      referencePath: slot.referencePath,
      desiredSettings,
    });
  } catch (e) {
    log.error(`[${slot.canonical.registryKey}] generation failed: ${(e as Error).message}`);
    throw e;
  }

  // 4) Diff-based rename. We always persist the captured URL up-front so
  // that ANY failure (rename, verify, download) leaves a recoverable
  // breadcrumb the next pre-flight scan can adopt — no regen.
  await rememberOrphanedFlowUrl(storySlug, slot.canonical.registryKey, result.url).catch((e) =>
    log.warn(`  pre-emptive orphan-URL persist failed: ${(e as Error).message}`),
  );

  let renamedTile: { rect: { x: number; y: number; w: number; h: number }; src: string } | null = null;
  try {
    renamedTile = await renameNewlyAddedImageTileVerified(
      page,
      beforeGallerySrcs,
      slot.canonical.flowDisplayName,
      3,
      90_000,
    );
    log.log(
      `[${slot.canonical.registryKey}] diff-based rename verified → "${slot.canonical.flowDisplayName}"`,
    );
  } catch (diffErr) {
    log.warn(
      `[${slot.canonical.registryKey}] diff-based rename missed: ${(diffErr as Error).message.slice(0, 160)}; trying URL-precise rename as fallback…`,
    );
    try {
      const urlTile = await renameTileByImageSrcVerified(
        page,
        result.url,
        slot.canonical.flowDisplayName,
        3,
        30_000,
      );
      renamedTile = urlTile;
      log.log(
        `[${slot.canonical.registryKey}] URL-precise rename verified → "${slot.canonical.flowDisplayName}"`,
      );
    } catch (urlErr) {
      log.warn(
        `[${slot.canonical.registryKey}] URL-precise rename also failed: ${(urlErr as Error).message.slice(0, 160)}`,
      );
      throw new Error(
        `Could not locate the just-rendered tile for "${slot.canonical.flowDisplayName}" (diff: ${(diffErr as Error).message.slice(0, 100)}; url-match: ${(urlErr as Error).message.slice(0, 100)}). The tile WAS rendered and its URL has been persisted. Re-run the stage — the pre-flight scan will adopt the existing tile by prompt-prefix or orphan URL without burning another credit.`,
      );
    }
  }

  // Rename succeeded — clear the orphan-URL breadcrumb so retries don't
  // dredge up stale URLs.
  await clearOrphanedFlowUrls(storySlug, slot.canonical.registryKey).catch(() => {});
  void renamedTile;

  return { url: result.url, source: "generated" };
}

/**
 * Whole-of-Phase-1 orchestrator. Used by the run-machine when running in
 * "auto" mode (no human approval gates). For gated mode the run-machine calls
 * the discrete step helpers directly.
 *
 * `storySlug` is the per-video isolation key (date-suffixed). `projectName`
 * is the human-readable name shown in Flow's UI; usually identical to the
 * storySlug.
 */
export async function runPhase1(opts: {
  imageCount: number;
  storySlug: string;
  projectName: string;
  /** Optional: caller-provided run dir (e.g. <runId>/phase1). Otherwise a
   * timestamped subdir of RUNS_DIR is created. */
  runDir?: string;
  /** Aspect ratio for Flow's generation chip (defaults to 16:9 for legacy callers). */
  aspectRatio?: GenerationSettings["ratio"];
  /**
   * Caller-provided storyline. When passed, Phase 1 skips the storyline
   * generation step and uses this storyline directly. Used by the run-machine
   * which generates the storyline in its own stage so it can serve approval
   * gates. Legacy callers (none right now) get the auto-generated default.
   */
  storyline?: Storyline;
  /**
   * If provided, copy the character image from this path into the run dir
   * instead of generating one in Flow. Used for recurring-character mode.
   */
  adoptedCharacterPath?: string;
}): Promise<Phase1Progress> {
  const imageCount = Math.max(1, Math.min(opts.imageCount || 3, 12));
  const aspectRatio = opts.aspectRatio ?? "16:9";
  const runDir =
    opts.runDir ??
    path.join(
      RUNS_DIR,
      `${new Date().toISOString().replace(/[:.]/g, "-")}-imgs${imageCount}-${opts.storySlug}`,
    );
  await fs.mkdir(runDir, { recursive: true });

  _progress = {
    status: "starting",
    message: `Starting Phase 1 with ${imageCount} images`,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    imageCount,
    imagesDone: 0,
    runDir,
    imagePaths: [],
    screenshots: [],
  };

  await ensureFfmpegOk();

  try {
    let storyline: Storyline;
    if (opts.storyline) {
      // Caller (run-machine) already generated the storyline in its own stage
      // so we can hit approval gates without losing browser state.
      storyline = opts.storyline;
      setProgress({ status: "storyline", message: "Using caller-provided storyline" });
      setProgress({ storyline });
    } else {
      setProgress({ status: "storyline", message: "Loading or generating storyline via Gemini Flash" });
      storyline = await getOrGenerateStoryline(opts.storySlug, imageCount);
      setProgress({ storyline });
    }

    setProgress({ status: "browser_launching", message: `Launching ${isHeadless() ? "headless" : "visible"} Chrome` });
    const browser = await launchBrowser();
    try {
      const page = await prepPage(browser);

      // Navigate to Flow first to establish session against persistent profile.
      setProgress({ message: "Opening Flow TV homepage" });
      await page.bringToFront().catch(() => {});
      await focusChromeOnMac();
      await page.goto(FLOW_URL, { waitUntil: "networkidle2", timeout: 60_000 });
      await dismissCookieWall(page);
      await page.bringToFront().catch(() => {});
      await focusChromeOnMac();
      await takeScreenshot(page, runDir, "initial-load");

      // Only treat as needs-login if URL is on Google auth or there is a real
      // sign-in CTA on the labs.google page. Footer text alone doesn't count.
      const alreadyIn = await isLoggedInToFlow(page);
      if (!alreadyIn) {
        setProgress({ message: "Sign in to Google in the opened Chrome window (15 min timeout)" });
        log.log("Login required — Chrome window is opened on your screen. Waiting up to 15 minutes.");
        const ok = await waitForLogin(page, runDir);
        if (!ok) throw new Error("Login timed out after 15 minutes.");
        log.log("Login detected — profile will persist for next runs.");
      } else {
        log.log("Persistent Chrome profile is already authenticated to Flow — no login needed.");
      }
      await takeScreenshot(page, runDir, "post-login");

      const project = await ensureProject(page, runDir, opts.storySlug, opts.projectName);
      setProgress({ project });

      // Apply settings panel ONCE (ratio, count). Persists for the project, so
      // we never need to fight Flow's defaults during the per-image loop.
      const desiredSettings: GenerationSettings = { ratio: aspectRatio, count: 1 };
      setProgress({
        status: "project_setup",
        message: `Configuring generation settings: ${desiredSettings.ratio}, x${desiredSettings.count}`,
      });
      await ensureGenerationSettings(page, runDir, desiredSettings);

      // ── Pre-flight gallery scan ────────────────────────────────────────────
      // Scan the project gallery BEFORE any generation. If a tile already
      // exists for the canonical character / scene name (because a prior run
      // crashed mid-pipeline AFTER Veo rendered but BEFORE we downloaded the
      // image, OR the rename succeeded but the local file got deleted), we
      // reuse that tile instead of burning another credit and creating a
      // duplicate gallery tile. See user-reported bug:
      //   "after last image is generated, app is unable to rename it and
      //    download it, that's why it keeps generating same last image"
      setProgress({
        status: "project_setup",
        message: "Scanning existing gallery tiles for prior partial runs…",
      });
      try {
        await waitForGalleryQuiescent(page, 30_000);
      } catch {
        // best-effort
      }
      const galleryByName = await scanProjectAssetsByDisplayName(page, 32);
      log.log(`Phase 1 pre-flight: ${galleryByName.size} keyed gallery entries`);

      // Step A: generate a character reference image (no ingredient attached).
      // Used as the ingredient for every subsequent scene to keep the
      // protagonist visually consistent.
      // Canonical name: <story-slug>-character-01.png (no scene tail).
      const characterName = buildAssetName({
        storyTitle: storyline.title,
        storySlug: opts.storySlug,
        kind: "character",
        index: 1,
        ext: "png",
      });
      const characterPath = path.join(runDir, characterName.filename);
      const existingCharacter = await findExistingLocalAsset(
        characterName.storySlug,
        characterName.registryKey,
      );
      if (opts.adoptedCharacterPath && fsSync.existsSync(opts.adoptedCharacterPath)) {
        // Recurring-character mode: copy the prior run's character image into
        // this run so Phase 2 frame uploads and the per-scene reference
        // attachment find it at the canonical path. Skip Flow generation (no
        // credit burn). The image is also uploaded into Flow as an ingredient
        // when the first scene runs (no rename — recurring character keeps
        // its original Flow display name in the upstream project).
        if (!fsSync.existsSync(characterPath)) {
          try {
            await fs.link(opts.adoptedCharacterPath, characterPath);
          } catch {
            await fs.copyFile(opts.adoptedCharacterPath, characterPath);
          }
        }
        log.log(
          `Recurring character adopted: ${opts.adoptedCharacterPath} → ${characterPath}`,
        );
      } else if (existingCharacter) {
        // Bring the cached character into this run dir so Phase 2 finds it
        // alongside the scene images. Hard-link first, fall back to copy.
        if (!fsSync.existsSync(characterPath)) {
          try {
            await fs.link(existingCharacter, characterPath);
          } catch {
            await fs.copyFile(existingCharacter, characterPath);
          }
        }
        log.log(`Character reuse: ${existingCharacter} → ${characterPath}`);
      } else {
        // Use the unified slot-obtain ladder: scan, match by name, prompt,
        // orphan-URL; only generate as last resort and rename by URL identity.
        await obtainImageForSlot(page, runDir, opts.storySlug, galleryByName, desiredSettings, {
          kind: "character",
          canonical: {
            flowDisplayName: characterName.flowDisplayName,
            filename: characterName.filename,
            registryKey: characterName.registryKey,
          },
          localPath: characterPath,
          prompt: storyline.characterPrompt,
          stepIndex: 0,
          progressLabel: `Generating character reference image (${storyline.protagonist.slice(0, 60)}…)`,
        });
      }
      await recordAsset({
        storySlug: characterName.storySlug,
        kind: characterName.kind,
        index: characterName.index,
        sceneSlug: characterName.sceneSlug,
        filename: characterName.filename,
        flowDisplayName: characterName.flowDisplayName,
        localPath: characterPath,
      });
      if (_progress) _progress.characterPath = characterPath;

      // Step B: per-scene generation with the character image attached as
      // the reference ingredient. Each scene re-uploads the same character
      // file (cheap; ~300KB per upload).
      for (let i = 0; i < storyline.imagePrompts.length; i++) {
        const ip = storyline.imagePrompts[i];
        const sceneName = buildAssetName({
          storyTitle: storyline.title,
          storySlug: opts.storySlug,
          kind: "image",
          index: i + 1,
          sceneSlug: ip.title,
          ext: "png",
        });
        const outputPath = path.join(runDir, sceneName.filename);

        const existingScene = await findExistingLocalAsset(
          sceneName.storySlug,
          sceneName.registryKey,
        );
        if (existingScene) {
          if (!fsSync.existsSync(outputPath)) {
            try {
              await fs.link(existingScene, outputPath);
            } catch {
              await fs.copyFile(existingScene, outputPath);
            }
          }
          log.log(`Scene ${i + 1} reuse: ${existingScene} → ${outputPath}`);
        } else {
          // Unified slot-obtain ladder. NO REGENS unless every gallery
          // rescue (canonical name, prompt prefix, orphan URL) misses.
          await obtainImageForSlot(page, runDir, opts.storySlug, galleryByName, desiredSettings, {
            kind: "image",
            canonical: {
              flowDisplayName: sceneName.flowDisplayName,
              filename: sceneName.filename,
              registryKey: sceneName.registryKey,
            },
            localPath: outputPath,
            prompt: ip.prompt,
            referencePath: characterPath,
            stepIndex: i,
            progressLabel: `Generating scene ${i + 1} of ${storyline.imagePrompts.length}: ${ip.title}`,
          });
        }
        await recordAsset({
          storySlug: sceneName.storySlug,
          kind: sceneName.kind,
          index: sceneName.index,
          sceneSlug: sceneName.sceneSlug,
          filename: sceneName.filename,
          flowDisplayName: sceneName.flowDisplayName,
          localPath: outputPath,
        });
        if (_progress) {
          _progress.imagePaths.push(outputPath);
          _progress.imagesDone = i + 1;
        }
      }

      setProgress({ status: "done", message: `Phase 1 complete: ${storyline.imagePrompts.length} images generated.` });
      log.log(`Phase 1 complete. Run dir: ${runDir}`);
      return _progress!;
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`Phase 1 failed: ${msg}`);
    setProgress({ status: "error", message: `Phase 1 failed: ${msg}`, error: msg });
    return _progress!;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Refresh-one-asset helper (used by run-machine for "Refresh this image")
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Regenerate ONE Phase-1 asset (character or scene image), in place.
 *
 * Flow: open browser → navigate to cached project → archive existing tile
 * matching the canonical display name → re-run generation with the same
 * prompt → strict-rename the new tile → record asset.
 *
 * The character image is always re-attached as a reference for scene
 * regenerations (consistency).
 *
 * Caller must provide a `runDir` (typically the same one Phase 1 used) so
 * the regenerated image lands next to its siblings.
 */
export async function regeneratePhase1Asset(opts: {
  storySlug: string;
  projectName: string;
  storyline: Storyline;
  kind: "character" | "image";
  /** 1-based index. For "character" always pass 1. */
  index: number;
  runDir: string;
  aspectRatio?: GenerationSettings["ratio"];
}): Promise<string> {
  const desiredSettings: GenerationSettings = {
    ratio: opts.aspectRatio ?? "16:9",
    count: 1,
  };
  if (opts.kind === "image" && (opts.index < 1 || opts.index > opts.storyline.imagePrompts.length)) {
    throw new Error(`regeneratePhase1Asset: image index ${opts.index} out of range`);
  }
  await fs.mkdir(opts.runDir, { recursive: true });

  const name =
    opts.kind === "character"
      ? buildAssetName({
          storyTitle: opts.storyline.title,
          storySlug: opts.storySlug,
          kind: "character",
          index: 1,
          ext: "png",
        })
      : buildAssetName({
          storyTitle: opts.storyline.title,
          storySlug: opts.storySlug,
          kind: "image",
          index: opts.index,
          sceneSlug: opts.storyline.imagePrompts[opts.index - 1].title,
          ext: "png",
        });
  const outputPath = path.join(opts.runDir, name.filename);

  const characterName = buildAssetName({
    storyTitle: opts.storyline.title,
    storySlug: opts.storySlug,
    kind: "character",
    index: 1,
    ext: "png",
  });
  const characterPath = path.join(opts.runDir, characterName.filename);

  log.log(
    `[regen ${name.registryKey}] starting — archiving existing tile and regenerating`,
  );

  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    await page.bringToFront().catch(() => {});
    await focusChromeOnMac();
    await page.goto(FLOW_URL, { waitUntil: "networkidle2", timeout: 60_000 });
    await dismissCookieWall(page);

    const alreadyIn = await isLoggedInToFlow(page);
    if (!alreadyIn) {
      const ok = await waitForLogin(page, opts.runDir);
      if (!ok) throw new Error("Login timed out during refresh");
    }

    const project = await ensureProject(page, opts.runDir, opts.storySlug, opts.projectName);
    log.log(`[regen ${name.registryKey}] project: ${project.projectName}`);
    await ensureGenerationSettings(page, opts.runDir, desiredSettings);

    // Archive the existing tile (best-effort — if it's already gone, that's
    // fine, we just skip the archive step and generate a fresh one).
    const archived = await archiveTileByName(page, name.flowDisplayName);
    if (archived) {
      log.log(`[regen ${name.registryKey}] archived old tile "${name.flowDisplayName}"`);
      // Allow the grid to reflow.
      await waitForTiles(page, 0, 4_000);
    } else {
      log.warn(
        `[regen ${name.registryKey}] no existing tile named "${name.flowDisplayName}" — generating fresh`,
      );
    }

    // For scene images we need the character path on disk to attach as a
    // reference. If the user asked to refresh the character itself, skip that.
    const referencePath =
      opts.kind === "image" && fsSync.existsSync(characterPath) ? characterPath : undefined;
    const prompt =
      opts.kind === "character"
        ? opts.storyline.characterPrompt
        : opts.storyline.imagePrompts[opts.index - 1].prompt;

    await generateOneImage(page, prompt, outputPath, opts.runDir, opts.index - 1, {
      stepLabel: name.registryKey,
      referencePath,
      desiredSettings,
    });
    await renameMostRecentAssetVerified(page, name.flowDisplayName);
    log.log(`[regen ${name.registryKey}] verified → "${name.flowDisplayName}"`);

    await recordAsset({
      storySlug: name.storySlug,
      kind: name.kind,
      index: name.index,
      sceneSlug: name.sceneSlug,
      filename: name.filename,
      flowDisplayName: name.flowDisplayName,
      localPath: outputPath,
    });

    return outputPath;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Maintenance utilities (called by API for resets)
// ──────────────────────────────────────────────────────────────────────────────

export async function resetPhase1Cache(opts: {
  storySlug: string;
  storyline?: boolean;
  project?: boolean;
}): Promise<void> {
  if (opts.storyline) await fs.rm(storylineFileFor(opts.storySlug), { force: true });
  if (opts.project) await fs.rm(projectFileFor(opts.storySlug), { force: true });
}
