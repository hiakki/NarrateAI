// Flow TV — Gemini web scraper (alternative to the API path).
//
// Why this exists: the `generativelanguage.googleapis.com` API for
// `gemini-2.5-flash` periodically returns 503 / "high demand" during peak
// hours. The user has a logged-in Google session in our persistent Chrome
// profile (same one Flow TV uses), so we can drive the regular consumer
// chat at https://gemini.google.com/app to produce the storyline using
// "Gemini 3 Fast" — which has independent capacity from the API tier.
//
// Behaviour notes:
//   - We reuse the same persistent Chrome profile (`PROFILE_DIR`) so the
//     user only signs in once via the Flow login button. No separate auth.
//   - If the page redirects to accounts.google.com we throw a typed error
//     `GeminiWebNotLoggedInError` so the caller can fall back / surface a
//     helpful UI message.
//   - The selectors here are best-effort. Google ships UI changes
//     constantly — we use a small ladder of fallbacks for each click /
//     text read, and screenshot every step on failure for debugging.
//   - We force "Gemini 3 Fast" via the model picker. If that exact label
//     isn't present we fall back to whatever the picker exposes that
//     contains "Fast", and last resort we just use the default model.

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import fs from "fs/promises";
import path from "path";
import { createLogger } from "@/lib/logger";
import {
  PROFILE_DIR,
  findChrome,
  isHeadless,
  sanitizeFilename,
  type Storyline,
  type ImagePromptEntry,
  type SceneDialogue,
  type SupportingCharacter,
} from "@/services/flow-tv-phase1";
import { buildStorylinePrompt, type StorylineBuildOpts } from "@/services/flow-tv-prompts";

const log = createLogger("FlowTV:GeminiWeb");

const GEMINI_WEB_URL = "https://gemini.google.com/app";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PREFERRED_MODEL_NAMES = [
  "Gemini 3 Fast",
  "3 Fast",
  "Gemini 3.0 Fast",
  "Fast",
];

const SCREENSHOTS_DIR = path.join(
  process.cwd(),
  "data",
  "flow-tv",
  "gemini-web-debug",
);

// ──────────────────────────────────────────────────────────────────────────────
//  Errors
// ──────────────────────────────────────────────────────────────────────────────

export class GeminiWebNotLoggedInError extends Error {
  constructor(msg = "Gemini web is not logged in. Use the Flow login button to sign in to Google.") {
    super(msg);
    this.name = "GeminiWebNotLoggedInError";
  }
}

export class GeminiWebTimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "GeminiWebTimeoutError";
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Browser
// ──────────────────────────────────────────────────────────────────────────────

async function launchBrowserHere(): Promise<Browser> {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome not found. Install Chrome or set CHROME_PATH.");
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  return puppeteer.launch({
    executablePath: chromePath,
    headless: isHeadless(),
    userDataDir: PROFILE_DIR,
    defaultViewport: { width: 1280, height: 900 },
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

async function snap(page: Page, name: string): Promise<void> {
  try {
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
    const out = path.join(
      SCREENSHOTS_DIR,
      `${Date.now()}-${sanitizeFilename(name)}.png`,
    );
    await page.screenshot({ path: out, fullPage: false });
    log.log(`screenshot → ${out}`);
  } catch {
    // best effort
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  DOM helpers (run inside page.evaluate where possible)
// ──────────────────────────────────────────────────────────────────────────────

/** Wait for a contenteditable input to appear. Gemini uses Quill/Lexical. */
async function waitForComposer(page: Page, timeoutMs = 25_000): Promise<void> {
  const selectors = [
    'div[contenteditable="true"][role="textbox"]',
    'rich-textarea div[contenteditable="true"]',
    'div.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"]',
  ];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const handle = await page.$(sel);
      if (handle) return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new GeminiWebTimeoutError(
    `Composer (textbox) not found within ${timeoutMs}ms`,
  );
}

/**
 * Try to click the model picker and choose "Gemini 3 Fast". This is
 * best-effort: if we can't find the picker we just continue with the
 * default model.
 */
async function selectModel(page: Page): Promise<string | null> {
  // The model name is always visible in the top bar. We try to click any
  // element whose visible text starts with "Gemini" near the top of the
  // viewport.
  // NOTE: avoid named sub-functions inside evaluate() — tsx injects a __name
  // helper that doesn't exist in browser context.
  const clickedPicker = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, [role='button'], [role='combobox'], [aria-haspopup='menu']",
      ),
    );
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0 && r.top < 250)) continue;
      const txt = (el.innerText ?? "").trim();
      if (
        /Gemini\s*\d/i.test(txt) ||
        /^\s*(Fast|Pro|Thinking|2\.5|3\.0)/i.test(txt)
      ) {
        el.click();
        return txt.slice(0, 80);
      }
    }
    return null;
  });
  if (!clickedPicker) {
    log.warn("Could not locate model picker; using default model.");
    return null;
  }
  log.log(`Opened model picker (was: ${clickedPicker})`);
  await new Promise((r) => setTimeout(r, 800));

  const chosen = await page.evaluate((preferredNames: string[]) => {
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="option"], button',
      ),
    );
    const visible: HTMLElement[] = [];
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) visible.push(el);
    }
    for (const want of preferredNames) {
      const wantLc = want.toLowerCase();
      for (const el of visible) {
        const txt = (el.innerText ?? "").trim();
        if (!txt) continue;
        if (txt.toLowerCase().includes(wantLc)) {
          el.click();
          return txt.slice(0, 80);
        }
      }
    }
    return null;
  }, PREFERRED_MODEL_NAMES);

  if (chosen) {
    log.log(`Selected model: ${chosen}`);
  } else {
    log.warn(
      `Could not find a "${PREFERRED_MODEL_NAMES.join(" / ")}" option in the picker; closing it and continuing with default.`,
    );
    await page.keyboard.press("Escape").catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 400));
  return chosen;
}

/**
 * Paste the prompt into the composer and submit. We use clipboard paste
 * (instead of typing char-by-char) because the prompt is long and Gemini's
 * Lexical editor is slow to type into.
 */
async function pastePrompt(page: Page, prompt: string): Promise<void> {
  // Click the composer to focus it.
  const focused = await page.evaluate(() => {
    const sels = [
      'div[contenteditable="true"][role="textbox"]',
      'rich-textarea div[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"]',
    ];
    for (const sel of sels) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        el.focus();
        return true;
      }
    }
    return false;
  });
  if (!focused) {
    throw new GeminiWebTimeoutError("Could not focus the Gemini composer");
  }

  // Use the Clipboard API via a headless paste event. Puppeteer's
  // `page.keyboard.type` would emit ~10k key events for a long prompt; this
  // is faster and matches how real users paste.
  await page.evaluate(async (text: string) => {
    const sels = [
      'div[contenteditable="true"][role="textbox"]',
      'rich-textarea div[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"]',
    ];
    let target: HTMLElement | null = null;
    for (const sel of sels) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        target = el;
        break;
      }
    }
    if (!target) throw new Error("composer disappeared mid-paste");
    target.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const evt = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(evt);
    // Some Gemini builds ignore synthetic paste; fall back to setting innerText.
    if ((target.innerText ?? "").trim().length < 10) {
      target.innerText = text;
      target.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }, prompt);

  await new Promise((r) => setTimeout(r, 700));

  // Click Send. The send button is usually `[aria-label*="Send"]` or
  // `[data-test-id="send-button"]`.
  const sent = await page.evaluate(() => {
    const sels = [
      'button[aria-label*="Send" i]',
      'button[data-test-id="send-button"]',
      'button[mattooltip*="Send" i]',
    ];
    for (const sel of sels) {
      const btn = document.querySelector<HTMLElement>(sel);
      if (btn && !btn.hasAttribute("disabled")) {
        btn.click();
        return true;
      }
    }
    return false;
  });
  if (!sent) {
    // Last resort — Enter key.
    await page.keyboard.press("Enter");
  }
}

/**
 * Wait for Gemini to finish streaming and extract the *final* assistant
 * reply text. We watch for the response container to stabilise (no growth
 * for `quietMs` ms) before reading.
 */
async function waitForResponseAndExtract(
  page: Page,
  timeoutMs = 180_000,
  quietMs = 4_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastLen = -1;
  let lastChange = Date.now();

  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => {
      // model-response, .model-response-text, [data-test-id="model-response"]
      // are all variants we've seen across builds.
      const containers = Array.from(
        document.querySelectorAll<HTMLElement>(
          [
            "model-response",
            ".model-response",
            ".model-response-text",
            "[data-test-id='model-response']",
            "message-content",
            ".markdown",
          ].join(", "),
        ),
      );
      // Take the LAST visible one — that's the active reply.
      let last: HTMLElement | null = null;
      for (const el of containers) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) last = el;
      }
      const text = last?.innerText ?? "";
      // Detect "still streaming": Gemini renders a stop button while
      // generation is in progress.
      const stillStreaming = !!document.querySelector(
        'button[aria-label*="Stop" i], button[data-test-id="stop-button"]',
      );
      return { len: text.length, text, stillStreaming };
    });

    if (snapshot.len !== lastLen) {
      lastLen = snapshot.len;
      lastChange = Date.now();
    }

    if (
      !snapshot.stillStreaming &&
      snapshot.len > 80 &&
      Date.now() - lastChange > quietMs
    ) {
      return snapshot.text;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new GeminiWebTimeoutError(
    `Gemini web did not finish responding within ${Math.round(timeoutMs / 1000)}s`,
  );
}

/** Strip ```json fences / leading prose / trailing prose around the JSON. */
function extractJsonBlock(raw: string): string {
  let s = raw.trim();
  // Code fences.
  const fence = s.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fence) s = fence[1].trim();
  // Leading prose before the first {.
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }
  return s;
}

/**
 * Coerce Gemini's `supportingCast` (web flow) into the canonical
 * `SupportingCharacter[]` shape, dropping malformed entries. Mirrors the
 * helper in `flow-tv-phase1` so downstream code is uniform.
 */
function normalizeSupportingCastWeb(
  raw: unknown,
): SupportingCharacter[] | undefined {
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
 * Coerce Gemini's `dialogues` (web flow) into the canonical
 * `SceneDialogue[]` shape, dropping malformed entries.
 */
function normalizeSceneDialoguesWeb(raw: unknown): SceneDialogue[] {
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
 * Map common Gemini field-name drift to our canonical schema. Gemini Web (3
 * Fast) sometimes emits `character_summary` instead of `characterPrompt`,
 * `scene_title` instead of `title`, `description` instead of `prompt`, etc.
 * This is purely best-effort renaming — values are passed through unchanged.
 */
function normalizeStorylineShape(
  raw: Record<string, unknown>,
): Partial<Storyline> {
  const out: Record<string, unknown> = { ...raw };

  const aliasGroups: Array<[string, string[]]> = [
    [
      "characterPrompt",
      [
        "character_prompt",
        "character_summary",
        "characterSummary",
        "character_description",
        "characterDescription",
        "character_reference_prompt",
        "characterReferencePrompt",
        "character",
      ],
    ],
    [
      "imagePrompts",
      ["image_prompts", "scenes", "scene_prompts", "scenePrompts", "prompts"],
    ],
    ["title", ["story_title", "video_title", "name"]],
    ["logline", ["log_line", "summary", "synopsis"]],
    [
      "protagonist",
      [
        "protagonist_summary",
        "protagonistSummary",
        "main_character",
        "mainCharacter",
        "lead",
      ],
    ],
    [
      "supportingCast",
      [
        "supporting_cast",
        "supporting_characters",
        "supportingCharacters",
        "cast",
        "characters",
        "side_characters",
        "sideCharacters",
      ],
    ],
  ];

  for (const [canonical, aliases] of aliasGroups) {
    if (out[canonical] === undefined || out[canonical] === null) {
      for (const alias of aliases) {
        if (out[alias] !== undefined && out[alias] !== null) {
          out[canonical] = out[alias];
          break;
        }
      }
    }
  }

  // Per-scene field aliases.
  if (Array.isArray(out.imagePrompts)) {
    out.imagePrompts = (out.imagePrompts as Array<Record<string, unknown>>).map(
      (it) => {
        const o: Record<string, unknown> = { ...it };
        const sceneAliases: Array<[string, string[]]> = [
          ["title", ["scene_title", "sceneTitle", "name", "label", "slug"]],
          ["prompt", ["description", "scene_prompt", "scenePrompt", "image_prompt", "imagePrompt", "visual_prompt"]],
          ["dialogueHi", ["dialogue_hi", "dialogue_devanagari", "dialogueDevanagari", "hindi_dialogue", "dialogue"]],
          ["dialogueRoman", ["dialogue_roman", "dialogue_romanized", "dialogueRomanized", "romanized_dialogue", "transliteration"]],
          ["dialogues", ["dialogue_lines", "dialogueLines", "lines", "spoken", "exchanges", "conversation"]],
          ["bgmCue", ["bgm_cue", "bgm", "background_music", "music_cue", "musicCue"]],
          ["sfxCue", ["sfx_cue", "sfx", "sound_effects", "soundEffects"]],
        ];
        for (const [canon, aliases] of sceneAliases) {
          if (o[canon] === undefined || o[canon] === null) {
            for (const a of aliases) {
              if (o[a] !== undefined && o[a] !== null) {
                o[canon] = o[a];
                break;
              }
            }
          }
        }
        // Normalize per-line synonyms inside dialogues[] so the per-entry
        // aliasing in flow-tv-phase1's normalizeSceneDialogues already sees
        // canonical-ish keys. (Defensive — phase1 also handles synonyms.)
        if (Array.isArray(o.dialogues)) {
          o.dialogues = (o.dialogues as Array<Record<string, unknown>>).map(
            (d) => {
              if (!d || typeof d !== "object") return d;
              const dd: Record<string, unknown> = { ...d };
              const dlgAliases: Array<[string, string[]]> = [
                ["speaker", ["who", "role", "character", "by", "from"]],
                ["lineHi", ["hindi", "line_hindi", "lineHindi", "text_hi", "textHi", "devanagari", "line"]],
                ["lineRoman", ["roman", "line_roman", "lineRoman", "transliteration", "romanized", "line_romanized", "english", "line_english", "lineEnglish", "text_roman", "textRoman"]],
              ];
              for (const [canon, aliases] of dlgAliases) {
                if (dd[canon] === undefined || dd[canon] === null) {
                  for (const a of aliases) {
                    if (dd[a] !== undefined && dd[a] !== null) {
                      dd[canon] = dd[a];
                      break;
                    }
                  }
                }
              }
              return dd;
            },
          );
        }
        return o;
      },
    );
  }

  return out as Partial<Storyline>;
}

/**
 * Build a one-shot follow-up message that asks Gemini to re-emit the JSON
 * with strict canonical field names. Used when the first response was
 * structurally close but has the wrong field names or missing
 * characterPrompt / scene fields.
 */
function buildFixupPrompt(missing: string[]): string {
  return `Your last response was almost correct but used the wrong field names. Re-emit the SAME JSON, no prose, with these EXACT keys at the top level:
- "title"
- "logline"
- "protagonist"
- "characterPrompt"   ← MUST be present, 40-80 word standalone reference-image prompt
- "imagePrompts"      ← array of objects each with EXACTLY these keys: "title", "prompt"${missing.includes("dialogueHi") ? `, "dialogueHi", "dialogueRoman"` : ""}${missing.includes("bgmCue") ? `, "bgmCue"` : ""}${missing.includes("sfxCue") ? `, "sfxCue"` : ""}

Do not use snake_case (e.g. "character_summary", "scene_title", "image_prompt"). Use the camelCase names above verbatim. Output ONLY valid JSON, no markdown fences, no commentary.`;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Public entrypoint
// ──────────────────────────────────────────────────────────────────────────────

export interface GeminiWebResult {
  partial: Omit<Storyline, "generatedAt" | "imageCount">;
  /** Model name we ended up using (best-effort detection). */
  modelUsed: string | null;
}

/**
 * Drive gemini.google.com/app to generate a storyline JSON. Reuses the
 * persistent Chrome profile so no separate login is required.
 *
 * Throws `GeminiWebNotLoggedInError` if redirected to accounts.google.com.
 * Throws `GeminiWebTimeoutError` if the chat doesn't respond.
 */
export async function generateStorylineViaWeb(
  opts: StorylineBuildOpts,
): Promise<GeminiWebResult> {
  const prompt = buildStorylinePrompt(opts);
  const browser = await launchBrowserHere();
  let page: Page | null = null;
  try {
    page = (await browser.pages())[0] ?? (await browser.newPage());
    await page.setUserAgent(UA);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    log.log(`Opening ${GEMINI_WEB_URL}`);
    await page.goto(GEMINI_WEB_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // If we hit the accounts page we're not logged in.
    const url = page.url();
    if (
      url.includes("accounts.google.com") ||
      url.includes("ServiceLogin") ||
      url.includes("/signin")
    ) {
      await snap(page, "not-logged-in");
      throw new GeminiWebNotLoggedInError();
    }

    await waitForComposer(page);
    await snap(page, "01-composer-ready");

    const modelUsed = await selectModel(page);
    await snap(page, "02-model-selected");

    log.log(`Pasting prompt (${prompt.length} chars)`);
    await pastePrompt(page, prompt);
    await snap(page, "03-prompt-sent");

    const raw = await waitForResponseAndExtract(page);
    await snap(page, "04-response-ready");

    // Always dump the raw assistant reply to disk so failures are diagnosable
    // even when the worker logs are gone.
    try {
      await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
      const rawPath = path.join(
        SCREENSHOTS_DIR,
        `${Date.now()}-raw-response.txt`,
      );
      await fs.writeFile(rawPath, raw, "utf-8");
      log.log(`raw response → ${rawPath} (${raw.length} chars)`);
    } catch {
      // best effort
    }

    const parseAndNormalize = (text: string): Partial<Storyline> => {
      const json = extractJsonBlock(text);
      const obj = JSON.parse(json) as Record<string, unknown>;
      return normalizeStorylineShape(obj);
    };

    let parsed: Partial<Storyline>;
    try {
      parsed = parseAndNormalize(raw);
    } catch (e) {
      log.error(
        `Could not parse Gemini-web response as JSON. Raw (first 600 chars): ${raw.slice(0, 600)}`,
      );
      throw new Error(
        `Gemini web returned non-JSON response: ${(e as Error).message}`,
      );
    }

    const isValid = (p: Partial<Storyline>): boolean =>
      !!p.title &&
      Array.isArray(p.imagePrompts) &&
      p.imagePrompts.length === opts.imageCount &&
      typeof p.characterPrompt === "string" &&
      p.characterPrompt.trim().length >= 20;

    // One-shot fix-up: if the response is structurally close but missing
    // canonical fields (characterPrompt undefined, scene fields renamed),
    // ask Gemini to re-emit with strict keys. We only retry once.
    if (!isValid(parsed)) {
      const missing: string[] = [];
      if (!parsed.characterPrompt) missing.push("characterPrompt");
      if (opts.dialogue) missing.push("dialogueHi");
      if (opts.bgm) missing.push("bgmCue");
      if (opts.sfx) missing.push("sfxCue");

      log.warn(
        `Gemini web first response shape invalid (title=${parsed.title}, prompts=${parsed.imagePrompts?.length}, characterPrompt=${typeof parsed.characterPrompt}); asking for a strict-keys fix-up.`,
      );

      try {
        await pastePrompt(page, buildFixupPrompt(missing));
        await snap(page, "05-fixup-sent");
        const raw2 = await waitForResponseAndExtract(page);
        await snap(page, "06-fixup-response-ready");
        try {
          await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
          await fs.writeFile(
            path.join(SCREENSHOTS_DIR, `${Date.now()}-fixup-raw-response.txt`),
            raw2,
            "utf-8",
          );
        } catch {
          // best effort
        }
        const reparsed = parseAndNormalize(raw2);
        if (isValid(reparsed)) {
          parsed = reparsed;
          log.log("Fix-up pass produced a valid storyline shape.");
        } else {
          log.warn(
            `Fix-up pass still invalid (title=${reparsed.title}, prompts=${reparsed.imagePrompts?.length}, characterPrompt=${typeof reparsed.characterPrompt}).`,
          );
        }
      } catch (e) {
        log.warn(
          `Fix-up pass failed: ${(e as Error).message?.slice(0, 200)}`,
        );
      }
    }

    if (!isValid(parsed)) {
      const shape = JSON.stringify(parsed)?.slice(0, 600);
      log.error(
        `Gemini web parsed but invalid. parsed shape: ${shape}; raw (first 400): ${raw.slice(0, 400)}`,
      );
      throw new Error(
        `Gemini web returned invalid storyline (title=${parsed.title}, prompts=${parsed.imagePrompts?.length}, characterPrompt=${parsed.characterPrompt?.slice?.(0, 30)}). See data/flow-tv/gemini-web-debug/ for raw response.`,
      );
    }

    const partial: Omit<Storyline, "generatedAt" | "imageCount"> = {
      title: String(parsed.title).slice(0, 80),
      logline: String(parsed.logline ?? ""),
      protagonist: String(parsed.protagonist ?? ""),
      characterPrompt: String(parsed.characterPrompt).trim(),
      supportingCast: normalizeSupportingCastWeb(
        (parsed as { supportingCast?: unknown }).supportingCast,
      ),
      imagePrompts: (parsed.imagePrompts ?? []).map((p, i) => {
        const e: ImagePromptEntry = {
          title: sanitizeFilename(String(p.title ?? `scene-${i + 1}`)),
          prompt: String(p.prompt ?? "").trim(),
        };
        if (opts.dialogue) {
          const dlg = normalizeSceneDialoguesWeb(
            (p as { dialogues?: unknown }).dialogues,
          );
          if (dlg.length > 0) {
            e.dialogues = dlg;
            e.dialogueHi = dlg[0].lineHi;
            e.dialogueRoman = dlg[0].lineRoman;
          } else {
            e.dialogueHi = String(p.dialogueHi ?? "").trim();
            e.dialogueRoman = String(p.dialogueRoman ?? "").trim();
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
        if (opts.bgm) e.bgmCue = String(p.bgmCue ?? "").trim();
        if (opts.sfx) e.sfxCue = String(p.sfxCue ?? "").trim();
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

    return { partial, modelUsed };
  } catch (e) {
    if (page) await snap(page, `error-${(e as Error).name ?? "unknown"}`);
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}
