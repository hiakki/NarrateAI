// Phase 2 — Veo 3.1 video clip generation by chaining Phase-1 scene images.
//
//   Input  : a Phase-1 run dir with character + N scene images (image-01..N).
//   Output : (N - 1) MP4 clips (chained: clip-i uses image-i as start frame
//            and image-(i+1) as end frame), plus a final stitched MP4.
//
// The user's request, paraphrased:
//   - 1st image scene as starting frame, 2nd image as last frame    (clip 1)
//   - 2nd image scene as starting frame, 3rd image as last frame    (clip 2)
//   - keep the same character across both clips
//   - chain via the exact scene boundaries (no in-between cuts)
//
// Veo 3.1's "Frames" mode in Flow takes a `Start` frame, an `End` frame, a
// model (Lite / Fast / Quality), aspect ratio + count + a transition prompt.
// Output count is always x1 — we never burn extra credits during testing.

import type { Page } from "puppeteer-core";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createLogger } from "@/lib/logger";

import {
  // browser / project lifecycle
  launchBrowser,
  prepPage,
  focusChromeOnMac,
  dismissCookieWall,
  dismissWelcomeModal,
  isLoggedInToFlow,
  waitForLogin,
  ensureProject,
  takeScreenshot,
  waitForLoadingToClear,
  // settings panel
  clickChip,
  readChipState,
  waitForSettingsPanel,
  clickPanelTab,
  clickPanelTabBySuffix,
  closeSettingsPanel,
  isSettingsPanelOpen,
  isInImageEditView,
  exitImageEditView,
  RATIO_TAB_TEXT,
  type GenerationSettings,
  // prompt input + submit
  PROMPT_SLATE_SELECTOR,
  focusPromptInput,
  clickPromptSubmit,
  clickPromptInputArea,
  // upload helpers
  uploadImageThroughOpenPopover,
  // misc
  isHeadless,
  FLOW_URL,
  FLOW_DATA_DIR,
  RUNS_DIR,
  ensureFfmpegOk,
  type Storyline,
  loadProjectCache,
  storylineFileFor,
} from "@/services/flow-tv-phase1";
import {
  buildAssetName,
  recordAsset,
  findExistingLocalAsset,
  consumeOrphanedFlowUrls,
  rememberOrphanedFlowUrl,
  clearOrphanedFlowUrls,
  migrateRunDir,
  type CanonicalName,
} from "@/services/flow-tv-naming";
import {
  renameMostRecentAssetVerified,
  renameTileByVideoSrcVerified,
  findVideoTilesWithSrc,
  findImageTilesWithSrc,
  readTileName,
  archiveTileByName,
  waitForTiles,
} from "@/services/flow-tv-rename";
import {
  scanProjectAssetsByDisplayName,
  waitForGalleryQuiescent,
  extractAssetIdFromUrl,
  type GalleryAssetEntry,
} from "@/services/flow-tv-gallery";

const log = createLogger("FlowTV:Phase2");
const execFileAsync = promisify(execFile);

// (Per-storySlug storyline file path is resolved via storylineFileFor() at
// load time; no module-level constant needed.)
void FLOW_DATA_DIR; // re-exported for backwards compatibility with scripts

// ──────────────────────────────────────────────────────────────────────────────
//  Public types & progress reporting
// ──────────────────────────────────────────────────────────────────────────────

export type Phase2Status =
  | "idle"
  | "starting"
  | "browser_launching"
  | "loading_phase1"
  | "configuring_video_mode"
  | "generating_clip"
  | "stitching"
  | "done"
  | "error";

export interface Phase2Progress {
  status: Phase2Status;
  message: string;
  startedAt: number;
  updatedAt: number;
  clipCount: number;
  clipsDone: number;
  clipPaths: string[];
  finalVideoPath?: string;
  runDir?: string;
  sourceRunDir?: string;
  screenshots: string[];
  error?: string;
}

let _progress: Phase2Progress | null = null;
function setProgress(patch: Partial<Phase2Progress>): void {
  if (!_progress) return;
  _progress = { ..._progress, ...patch, updatedAt: Date.now() };
}
export function getPhase2Progress(): Phase2Progress | null {
  return _progress;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Veo settings — minimum credit cost
// ──────────────────────────────────────────────────────────────────────────────

// Veo 3.1 has three variants in the dropdown: Lite (cheapest), Fast, Quality.
// We default to Lite for dry-runs. Override via FLOW_TV_VEO_VARIANT env var.
export type VeoVariant = "Lite" | "Fast" | "Quality";
function getVeoVariant(): VeoVariant {
  const v = (process.env.FLOW_TV_VEO_VARIANT ?? "Lite").trim();
  if (v === "Fast" || v === "Quality") return v;
  return "Lite";
}

const DEFAULT_VIDEO_SETTINGS: GenerationSettings = { ratio: "16:9", count: 1 };

// ──────────────────────────────────────────────────────────────────────────────
//  Phase-1 source run resolution
// ──────────────────────────────────────────────────────────────────────────────

interface Phase1Source {
  runDir: string;
  characterPath: string;
  scenePaths: string[]; // ordered: image-01, image-02, image-03, …
  storyline: Storyline;
}

/**
 * Load the storyline for a specific Phase-2 run. We require an explicit
 * storySlug — Phase 2 must operate on the *same* storyline that Phase 1
 * generated, never on whatever happens to be "latest".
 */
async function loadStoryline(storySlug: string): Promise<Storyline> {
  const raw = await fs.readFile(storylineFileFor(storySlug), "utf-8");
  return JSON.parse(raw) as Storyline;
}

// Match canonical filenames anchored on the story slug. Critically: this
// MUST not match debug screenshots like `step-image-01-field-focused.png`
// (which happen to contain the substring `-image-01-...`). Hence the `^` and
// the explicit story-slug prefix.
function makeCanonicalMatchers(storySlug: string) {
  const slugRe = storySlug.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return {
    character: new RegExp(`^${slugRe}-character-\\d{2}\\.png$`),
    image: new RegExp(`^${slugRe}-image-\\d{2}-.+\\.png$`),
  };
}

async function findLatestPhase1Run(storyTitle: string, storySlug: string): Promise<string> {
  const entries = await fs.readdir(RUNS_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && /imgs\d+/.test(e.name))
    .map((e) => path.join(RUNS_DIR, e.name));
  if (dirs.length === 0) throw new Error(`No Phase-1 run dirs found under ${RUNS_DIR}`);

  // Make sure every candidate dir is migrated to the canonical naming scheme
  // before we evaluate it. This is idempotent.
  for (const d of dirs) {
    await migrateRunDir(d, storyTitle);
  }

  const matchers = makeCanonicalMatchers(storySlug);

  const ranked = await Promise.all(
    dirs.map(async (d) => {
      const stat = await fs.stat(d);
      const files = await fs.readdir(d);
      const hasCharacter = files.some((f) => matchers.character.test(f));
      const sceneCount = files.filter((f) => matchers.image.test(f)).length;
      return { dir: d, mtime: stat.mtimeMs, hasCharacter, sceneCount };
    }),
  );
  const usable = ranked
    .filter((r) => r.hasCharacter && r.sceneCount >= 2)
    .sort((a, b) => b.mtime - a.mtime);
  if (usable.length === 0) {
    throw new Error("No Phase-1 run dir contains both a character and ≥2 scene images");
  }
  return usable[0].dir;
}

async function resolvePhase1Source(storySlug: string, explicit?: string): Promise<Phase1Source> {
  const storyline = await loadStoryline(storySlug);
  const runDir = explicit ?? (await findLatestPhase1Run(storyline.title, storySlug));

  await migrateRunDir(runDir, storyline.title);

  const matchers = makeCanonicalMatchers(storySlug);

  const files = await fs.readdir(runDir);
  const characterFile = files.find((f) => matchers.character.test(f));
  if (!characterFile) throw new Error(`No character image in ${runDir}`);
  const sceneFiles = files.filter((f) => matchers.image.test(f)).sort();
  if (sceneFiles.length < 2) {
    throw new Error(
      `Need ≥2 canonical scene images (matching ^${storySlug}-image-NN-…\\.png$) in ${runDir}, found ${sceneFiles.length}`,
    );
  }
  return {
    runDir,
    characterPath: path.join(runDir, characterFile),
    scenePaths: sceneFiles.map((f) => path.join(runDir, f)),
    storyline,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  Settings panel — Video mode + ratio + count + Veo variant
// ──────────────────────────────────────────────────────────────────────────────

// Click a panel tab whose visible textContent ENDS with `wantedSuffix`. The
// inline icon name (e.g. "videocam", "image", "crop_free") is concatenated to
// the label by Material Icons, so we anchor with endsWith.
// Find the model dropdown trigger inside the open panel (text ends with
// "arrow_drop_down" and contains the current model name).
async function locateModelDropdown(page: Page): Promise<{ x: number; y: number; text: string } | null> {
  const src = `() => {
    var els = Array.prototype.slice.call(document.querySelectorAll('button, [role="combobox"], [role="button"]'));
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || '').trim();
      if (t.length < 4 || t.length > 80) continue;
      if (!/arrow_drop_down|expand_more/i.test(t)) continue;
      if (!/(veo|imagen|nano banana)/i.test(t)) continue;
      var r = els[i].getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: t };
    }
    return null;
  }`;
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${src})`)() as any,
  ) as Promise<{ x: number; y: number; text: string } | null>;
}

// Click a Veo variant menu item by partial label, e.g. "Veo 3.1 - Lite".
async function clickModelMenuItem(page: Page, label: string): Promise<boolean> {
  const src = `(needle) => {
    var items = Array.prototype.slice.call(document.querySelectorAll('[role="menuitem"], [role="option"], button'));
    var lower = needle.toLowerCase();
    for (var i = 0; i < items.length; i++) {
      var t = (items[i].textContent || '').trim().toLowerCase();
      if (t.indexOf(lower) === -1) continue;
      var r = items[i].getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    return null;
  }`;
  const pos = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${src})`)() as any,
    label,
  )) as { x: number; y: number } | null;
  if (!pos) return false;
  await page.mouse.click(pos.x, pos.y);
  return true;
}

async function isVideoModeActive(page: Page): Promise<boolean> {
  const state = await readChipState(page, "any");
  return state?.mode === "video";
}

// Configure Video mode + Veo variant + ratio + count + Frames sub-tab. Idempotent.
async function ensureVideoSettings(
  page: Page,
  runDir: string,
  variant: VeoVariant,
  settings: GenerationSettings = DEFAULT_VIDEO_SETTINGS,
): Promise<void> {
  // Dismiss any per-release "What's new" / changelog modal that Flow shows
  // on first project visit; it sits on top of the chip and silently blocks
  // clicks (same root cause as the Phase-1 occlusion bug).
  await dismissWelcomeModal(page).catch(() => false);

  if (!(await exitImageEditView(page, runDir))) {
    throw new Error("Cannot apply video settings: stuck in image-edit view");
  }

  // Short-circuit: if chip is already Video + 16:9 + x1, we're done. (We
  // accept that the Veo variant might silently be different; verifying that
  // requires opening the panel anyway, so just always open it and check.)
  // — fall through to panel logic below regardless.

  // Open chip panel.
  let panelOpen = false;
  for (let attempt = 1; attempt <= 4 && !panelOpen; attempt++) {
    if (attempt > 1) await dismissWelcomeModal(page).catch(() => false);
    if (!(await clickChip(page, "any"))) {
      // First fallback: try the keyword-based modal dismiss.
      await dismissWelcomeModal(page).catch(() => false);
      if (!(await clickChip(page, "any"))) {
        // Second fallback: brute-force Escape (twice). Harmless on no-modal,
        // closes any dialog Flow throws up that we don't have a keyword for
        // yet (e.g. a brand-new "What's new in Veo X.Y" we haven't seen).
        log.warn(
          `Chip click still failing after keyword-dismiss — trying brute-force Escape (attempt ${attempt}/4)`,
        );
        await page.keyboard.press("Escape").catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
        await page.keyboard.press("Escape").catch(() => {});
        await new Promise((r) => setTimeout(r, 700));
        // Also try clicking the body to dismiss any non-dialog overlays.
        try {
          const vp = page.viewport();
          if (vp) {
            await page.mouse.click(vp.width - 40, 80).catch(() => {});
            await new Promise((r) => setTimeout(r, 400));
          }
        } catch {
          // best-effort
        }
        if (!(await clickChip(page, "any"))) {
          if (attempt < 4) {
            log.warn(`  chip still not clickable after Escape; retrying outer loop (${attempt + 1}/4)`);
            continue;
          }
          await takeScreenshot(page, runDir, "phase2-chip-occluded");
          throw new Error(
            "Settings chip not clickable — likely occluded by a Flow TV welcome/changelog modal that our dismisser doesn't recognise. Screenshot saved to phase2-chip-occluded; open Flow TV manually, dismiss any overlay, then retry.",
          );
        }
      }
    }
    panelOpen = await waitForSettingsPanel(page, 4_000);
    if (!panelOpen) log.log(`  panel did not open on attempt ${attempt}, retrying`);
  }
  if (!panelOpen) {
    await takeScreenshot(page, runDir, "phase2-panel-stuck-closed");
    throw new Error("Settings panel never opened");
  }
  await takeScreenshot(page, runDir, "phase2-panel-open");

  // 1. Switch to Video tab.
  const videoSwitch = await clickPanelTabBySuffix(page, "video");
  if (!videoSwitch.ok) throw new Error("Video tab not found in settings panel");
  log.log(`  mode → Video (${videoSwitch.alreadySelected ? "already selected" : "clicked"})`);
  if (!videoSwitch.alreadySelected) await new Promise((r) => setTimeout(r, 700));

  // 2. Frames sub-tab (vs Ingredients) — make sure we're in the start/end
  // frame chaining mode, not the ingredients-style multi-asset compositing.
  const framesSwitch = await clickPanelTabBySuffix(page, "frames");
  if (framesSwitch.ok) {
    log.log(`  sub-mode → Frames (${framesSwitch.alreadySelected ? "already selected" : "clicked"})`);
    if (!framesSwitch.alreadySelected) await new Promise((r) => setTimeout(r, 400));
  } else {
    log.log("  Frames sub-tab not present (ok if Veo defaults to it)");
  }

  // 3. Aspect ratio.
  const ratioToken = RATIO_TAB_TEXT[settings.ratio];
  const r = await clickPanelTab(page, ratioToken);
  if (r.ok) log.log(`  ratio → ${settings.ratio} (${r.alreadySelected ? "already selected" : "clicked"})`);
  else log.error(`  ratio button '${ratioToken}' not found`);
  await new Promise((r2) => setTimeout(r2, 400));

  // 4. Output count.
  // Count tab text changed from "x1"/"x2" (legacy) to "1x"/"2x" (current).
  // Try the new format first, fall back to legacy.
  let c = await clickPanelTab(page, `${settings.count}x`);
  if (!c.ok) c = await clickPanelTab(page, `x${settings.count}`);
  if (c.ok) log.log(`  count → x${settings.count} (${c.alreadySelected ? "already selected" : "clicked"})`);
  else log.error(`  count button 'x${settings.count}' / '${settings.count}x' not found`);
  await new Promise((r2) => setTimeout(r2, 400));

  // 5. Veo variant. Open dropdown, click target, panel re-renders.
  const dd = await locateModelDropdown(page);
  if (dd) {
    const target = `Veo 3.1 - ${variant}`;
    if (dd.text.toLowerCase().includes(target.toLowerCase())) {
      log.log(`  model already ${target}`);
    } else {
      log.log(`  switching model: ${dd.text} → ${target}`);
      await page.mouse.click(dd.x, dd.y);
      await new Promise((r2) => setTimeout(r2, 700));
      const ok = await clickModelMenuItem(page, target);
      if (!ok) {
        log.warn(`  Veo variant "${target}" not found in menu — keeping current`);
      } else {
        log.log(`  model selected: ${target}`);
        await new Promise((r2) => setTimeout(r2, 700));
      }
    }
  } else {
    log.warn("  model dropdown not located inside the panel");
  }

  await takeScreenshot(page, runDir, "phase2-panel-applied");

  await closeSettingsPanel(page, runDir);
  await new Promise((r2) => setTimeout(r2, 400));

  // Hard verify the chip says Video / <ratio> / x<count>.
  if (!(await isVideoModeActive(page))) {
    await takeScreenshot(page, runDir, "phase2-mode-not-video");
    throw new Error("Chip is not in Video mode after applying settings");
  }
  const state = await readChipState(page, "video");
  if (!state) throw new Error("Could not read video chip state");
  if (state.ratio !== ratioToken || state.count !== settings.count) {
    await takeScreenshot(page, runDir, "phase2-settings-mismatch");
    throw new Error(
      `Video settings did not stick: chip="${state.text}" want ratio=${ratioToken}, count=${settings.count}`,
    );
  }
  log.log(`Video settings confirmed: chip="${state.text}"`);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Frame slot interaction (Start / End)
// ──────────────────────────────────────────────────────────────────────────────

// Locate the small Start/End slot buttons that sit above the prompt input.
// They are inline <div> elements with textContent === "Start" or "End", sized
// 50x50, in the y band 650-800 in our 1366x850 viewport.
async function locateFrameSlot(
  page: Page,
  which: "Start" | "End",
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const src = `(label) => {
    var els = Array.prototype.slice.call(document.querySelectorAll('*'));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var t = (el.textContent || '').trim();
      if (t.length > 12) continue;
      if (t.toLowerCase() !== label.toLowerCase()) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.top < 650 || r.top > 800) continue;
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }
    return null;
  }`;
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${src})`)() as any,
    which,
  ) as Promise<{ x: number; y: number; w: number; h: number } | null>;
}

// After uploading a file via the Start/End picker, wait for the slot to
// actually show an uploaded thumbnail. A naive "literal label vanished"
// check is unsafe because Flow renders an empty grey placeholder during the
// upload (no label visible there either) — submitting in that state makes
// Veo silently no-op.
//
// We require BOTH:
//   1. No upload-progress text ("46%" etc.) is visible anywhere on the page
//      (this signals every gallery upload has completed).
//   2. The slot location no longer shows the literal "Start"/"End" label.
async function waitForFrameSlotReady(
  page: Page,
  which: "Start" | "End",
  timeoutMs = 90_000,
): Promise<boolean> {
  const start = Date.now();
  let lastReason = "";
  while (Date.now() - start < timeoutMs) {
    const state = (await page.evaluate((label: string) => {
      // (a) Slot still shows the literal "Start"/"End" label?
      let labelStillVisible = false;
      const all = Array.from(document.querySelectorAll<HTMLElement>("*"));
      for (const el of all) {
        const t = (el.textContent ?? "").trim();
        if (t.toLowerCase() !== label.toLowerCase()) continue;
        if (t.length > 12) continue;
        const r = el.getBoundingClientRect();
        if (r.top < 650 || r.top > 800) continue;
        if (r.width === 0 || r.height === 0) continue;
        labelStillVisible = true;
        break;
      }
      // (b) Any "<n>%" text visible? (gallery upload progress)
      const bodies = Array.from(document.querySelectorAll<HTMLElement>("div, span"));
      let percentText: string | null = null;
      for (const b of bodies) {
        const t = (b.textContent || "").trim();
        if (/^\d{1,3}%$/.test(t)) {
          const r = b.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          percentText = t;
          break;
        }
      }
      return { labelStillVisible, percentText };
    }, which)) as { labelStillVisible: boolean; percentText: string | null };

    if (state.labelStillVisible) {
      lastReason = `slot still shows "${which}"`;
    } else if (state.percentText) {
      lastReason = `gallery uploading ${state.percentText}`;
    } else {
      return true;
    }
    if (Date.now() - start > 0 && Date.now() - start < 4_000) {
      // Short status only at start — avoid log spam.
      log.log(`  waiting for ${which} frame: ${lastReason}`);
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  log.warn(`waitForFrameSlotReady(${which}) timed out: ${lastReason}`);
  return false;
}

async function uploadIntoFrameSlot(
  page: Page,
  which: "Start" | "End",
  filePath: string,
  runDir: string,
  stepLabel: string,
  /**
   * If provided, FIRST try to pick the existing project asset (with this
   * Flow asset id) from the slot popover. Avoids re-uploading the local
   * file (which creates a duplicate gallery tile per Veo submit). Falls
   * back to upload if the picker can't find a matching thumb.
   */
  existingAssetId?: string | null,
): Promise<void> {
  if (!fsSync.existsSync(filePath)) throw new Error(`Frame image missing: ${filePath}`);

  const slot = await locateFrameSlot(page, which);
  if (!slot) {
    await takeScreenshot(page, runDir, `${stepLabel}-no-${which.toLowerCase()}-slot`);
    throw new Error(`Frame slot "${which}" not found above prompt bar`);
  }
  log.log(`[${stepLabel}] clicking ${which} slot at (${slot.x},${slot.y})`);
  await page.mouse.click(slot.x, slot.y);
  await new Promise((r) => setTimeout(r, 900));
  await takeScreenshot(page, runDir, `${stepLabel}-${which.toLowerCase()}-popover`);

  let usedPicker = false;
  if (existingAssetId) {
    const thumb = await findThumbInSlotPopoverByAssetId(page, existingAssetId);
    if (thumb) {
      log.log(
        `[${stepLabel}] picking existing project asset (id=${existingAssetId}) from popover @(${thumb.x},${thumb.y}) — no re-upload`,
      );
      await page.mouse.click(thumb.x, thumb.y);
      await new Promise((r) => setTimeout(r, 800));
      usedPicker = true;
    } else {
      log.log(
        `[${stepLabel}] expected asset id=${existingAssetId} NOT in popover — will upload local file`,
      );
    }
  }

  if (!usedPicker) {
    await uploadImageThroughOpenPopover(page, filePath, runDir, `${stepLabel}-${which.toLowerCase()}`);
  }

  // Popover dismisses itself after upload/pick completes; wait until the
  // slot label disappears (replaced by a thumb). Picker case usually
  // resolves in <5s; upload can take up to 90s on slow connections.
  const ready = await waitForFrameSlotReady(page, which, usedPicker ? 30_000 : 90_000);
  await takeScreenshot(page, runDir, `${stepLabel}-${which.toLowerCase()}-ready`);
  if (!ready) {
    throw new Error(`${which} frame slot did not show a thumbnail within ${usedPicker ? "30s" : "90s"}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Prompt typing (re-implemented locally to keep it self-contained for video)
// ──────────────────────────────────────────────────────────────────────────────

async function typePromptIntoEditor(page: Page, text: string, runDir: string, stepLabel: string): Promise<void> {
  if (await isSettingsPanelOpen(page)) {
    await closeSettingsPanel(page, runDir);
  }

  if (!(await focusPromptInput(page))) {
    await takeScreenshot(page, runDir, `${stepLabel}-no-prompt-input`);
    throw new Error("Prompt input not found");
  }
  await page.click(PROMPT_SLATE_SELECTOR, { clickCount: 3 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  // Clear any existing text.
  await page.keyboard.down("Meta"); await page.keyboard.press("KeyA"); await page.keyboard.up("Meta");
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.press("Delete");
  await new Promise((r) => setTimeout(r, 150));
  await page.keyboard.type(text, { delay: 8 });
  await new Promise((r) => setTimeout(r, 400));

  // Verify the editor actually contains a slice of the prompt.
  const live = (await page
    .$eval(PROMPT_SLATE_SELECTOR, (el) => (el as HTMLElement).innerText.trim())
    .catch(() => "")) as string;
  const slice = text.slice(0, 30).toLowerCase();
  if (live.length < 20 || !live.toLowerCase().includes(slice)) {
    await takeScreenshot(page, runDir, `${stepLabel}-prompt-mismatch`);
    throw new Error(`Prompt typing failed: editor shows "${live.slice(0, 80)}…"`);
  }
  log.log(`[${stepLabel}] prompt typed (${text.length} chars, editor has ${live.length})`);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Submit + wait for video URL
// ──────────────────────────────────────────────────────────────────────────────

// We track URLs known on the page BEFORE submitting so we can detect a
// genuinely-new clip URL after submission. We MUST only look at <video>
// elements (each gallery video tile contains a hidden <video> with its mp4
// URL), NOT <img> thumbnails — Flow's media-redirect endpoint serves both
// images and videos through `media.getMediaUrlRedirect?name=<id>`, so an
// <img> with that URL is a thumbnail (JPEG) and downloading it would save
// as a corrupt MP4. The earlier (broken) implementation matched <img> URLs
// here, which is what produced the "videos with JPEG content" bug.
async function snapshotKnownVideoUrls(page: Page): Promise<Set<string>> {
  const urls = (await page.evaluate(() => {
    const out = new Set<string>();
    document.querySelectorAll("video").forEach((v) => {
      const src = (v as HTMLVideoElement).src || (v as HTMLVideoElement).currentSrc;
      if (src) out.add(src);
      v.querySelectorAll("source").forEach((s) => {
        const ss = (s as HTMLSourceElement).src;
        if (ss) out.add(ss);
      });
    });
    document.querySelectorAll("input").forEach((i) => {
      const v = (i as HTMLInputElement).value;
      if (v && /^https?:\/\//i.test(v) && /\.(mp4|webm|m3u8)/i.test(v)) out.add(v);
    });
    return Array.from(out);
  })) as string[];
  return new Set(urls);
}

async function waitForNewVideoUrl(
  page: Page,
  before: Set<string>,
  timeoutMs = 6 * 60_000,
): Promise<string | null> {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    const found = (await page.evaluate(() => {
      const collect = new Set<string>();
      // Only <video> sources — these are the actual rendered clips. Hidden
      // <video> elements inside button-wrapped gallery tiles have their src
      // set as soon as the render finishes.
      document.querySelectorAll("video").forEach((v) => {
        const src = (v as HTMLVideoElement).src || (v as HTMLVideoElement).currentSrc;
        if (src) collect.add(src);
        v.querySelectorAll("source").forEach((s) => {
          const ss = (s as HTMLSourceElement).src;
          if (ss) collect.add(ss);
        });
      });
      document.querySelectorAll("input").forEach((i) => {
        const v = (i as HTMLInputElement).value;
        if (v && /^https?:\/\//i.test(v) && /\.(mp4|webm|m3u8)/i.test(v)) collect.add(v);
      });
      return Array.from(collect);
    })) as string[];

    for (const u of found) {
      if (before.has(u)) continue;
      // Filter out preview/poster URLs (these are JPEGs).
      if (/\.(jpg|jpeg|png|webp)/i.test(u)) continue;
      // Filter out blob: URLs that haven't resolved to a real source yet.
      if (u.startsWith("blob:")) continue;
      return u;
    }

    // Detect explicit Flow error toasts.
    const errSrc = `() => {
      var sels = ['[role="alert"]', '[data-testid*="toast"]', '[class*="Toast"]', '[class*="Snackbar"]'];
      for (var s = 0; s < sels.length; s++) {
        var nodes = document.querySelectorAll(sels[s]);
        for (var i = 0; i < nodes.length; i++) {
          var t = (nodes[i].textContent || '').trim();
          if (t && /(error|fail|unable|denied|insufficient credits|quota)/i.test(t)) return t.slice(0, 200);
        }
      }
      return null;
    }`;
    const err = (await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function(`return (${errSrc})`)() as any,
    ).catch(() => null)) as string | null;
    if (err) {
      log.error(`Flow surfaced error: ${err}`);
      return null;
    }

    if (Date.now() - lastLog > 30_000) {
      const remaining = Math.round((timeoutMs - (Date.now() - start)) / 1000);
      log.log(`  still waiting on Veo render (${remaining}s remaining)`);
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

// Strict download — single path, no silent fallback to thumbnails.
//
// Mechanism:
//   1. Open the trpc media-redirect URL in a fresh tab via tab.goto. Browser
//      navigation Accept headers steer Flow to redirect to the video CDN
//      (/video/<id>) rather than the image CDN (/image/<id>).
//   2. Listen for any flow-content.google /video/ response with Expires=
//      query param — that's the signed mp4 URL.
//   3. Node-fetch the signed URL directly (signature is self-authenticating).
//   4. Reject anything that isn't a real mp4 (content-type, size, ftyp magic).
//
// Anything that isn't a clean Veo video render throws — callers MUST NOT
// auto-retry credit-burning operations on these errors.
async function downloadVideoFromPage(
  page: Page,
  url: string,
  timeoutMs = 120_000,
): Promise<Buffer> {
  return await captureCdnAndDownload(page, url, timeoutMs);
}

async function captureCdnAndDownload(
  page: Page,
  url: string,
  timeoutMs: number,
): Promise<Buffer> {
  type Resp = import("puppeteer-core").HTTPResponse;

  const browser = page.browser();
  const tab = await browser.newPage();
  const cdnUrls: string[] = [];

  const onResp = (resp: Resp) => {
    const u = resp.url();
    if (/flow-content\.google\/video\/[^?]+\?.*Expires=\d+/i.test(u)) {
      cdnUrls.push(u);
    }
  };
  tab.on("response", onResp);

  let signedUrl: string | null = null;
  try {
    await tab
      .goto(url, { waitUntil: "networkidle2", timeout: Math.min(timeoutMs, 60_000) })
      .catch(() => {});

    const start = Date.now();
    while (cdnUrls.length === 0 && Date.now() - start < 10_000) {
      await new Promise((r) => setTimeout(r, 500));
    }
    signedUrl = cdnUrls[0] ?? null;
  } finally {
    tab.off("response", onResp);
    await tab.close().catch(() => {});
  }

  if (!signedUrl) {
    throw new Error(
      `Could not capture signed video CDN URL for ${url.slice(0, 100)}… — Flow redirected to a non-video path (this URL is likely a thumbnail/image, not a Veo render)`,
    );
  }
  log.log(`  captured signed video CDN URL: ${signedUrl.slice(0, 120)}…`);

  const ctrl = new AbortController();
  const guard = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(signedUrl, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`Signed URL HTTP ${resp.status}`);
    const ct = resp.headers.get("content-type") || "";
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!/^video\//i.test(ct)) {
      throw new Error(`Signed URL returned non-video content-type ${ct} (${buf.length}B)`);
    }
    if (buf.length < 200_000) {
      throw new Error(`Signed URL response too small (${buf.length}B, ct=${ct}) — not a real video`);
    }
    if (
      buf.length >= 12 &&
      !(buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70)
    ) {
      throw new Error(
        `Signed URL bytes are not a valid mp4 (no ftyp magic at offset 4); first bytes: ${buf.subarray(0, 16).toString("hex")}`,
      );
    }
    log.log(`  cdn download ok: ${buf.byteLength} bytes (ct=${ct})`);
    return buf;
  } finally {
    clearTimeout(guard);
  }
}

// Scan the project gallery for a video tile already labelled with our
// expected display name. Returns the tile's <video src> if found, else null.
//
// This is the "gallery dedup gate" that lets retries / restarts skip Veo
// submits when the previous attempt already rendered the clip in Flow's
// gallery (but couldn't finish downloading or recording it). Without this,
// every restart of a partially-failed Phase 2 burns another Veo credit.
async function findExistingClipInGallery(
  page: Page,
  expectedDisplayName: string,
): Promise<string | null> {
  let tiles: Array<{ rect: { x: number; y: number; w: number; h: number }; src: string }>;
  try {
    tiles = await findVideoTilesWithSrc(page);
  } catch {
    return null;
  }
  if (tiles.length === 0) return null;
  // Right-clicking each tile to read its name is expensive — cap at 8.
  for (const t of tiles.slice(0, 8)) {
    let name: string | null = null;
    try {
      name = await readTileName(page, t.rect);
    } catch {
      continue;
    }
    if (name && name.trim() === expectedDisplayName.trim()) {
      return t.src;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Gallery inventory + frame-slot picker (idempotent re-use)
//
//  Before Phase 2 starts uploading frames or submitting Veo, we scan the
//  Flow project gallery for assets that match our expected display names.
//  If a Phase-1 image (e.g. "<story> — Image 02 — Code Breakthrough") is
//  already in the gallery, we click it from the slot popover instead of
//  re-uploading the local file (which would create a redundant gallery
//  tile for every Veo submit).
//
//  This addresses the user-reported bug where each clip's Start/End frame
//  uploads created 2 new gallery tiles per clip (despite the source images
//  already living in the project from Phase 1).
// ──────────────────────────────────────────────────────────────────────────────

// Gallery scan helpers live in @/services/flow-tv-gallery — both Phase 1
// and Phase 2 import them. Definitions previously inlined here have moved
// out so Phase 1 can use the same pre-flight scan to avoid duplicate image
// generations after a mid-run failure.


// After clicking a slot to open the picker popover, scan the popover's
// 40×40 thumbnail strip (Flow renders this at a fixed x-column, see
// scripts/flow-tv-probe-frame-popover.ts). Returns the centre coords of the
// thumb whose <img src> contains `name=<assetId>`, or null if no match.
async function findThumbInSlotPopoverByAssetId(
  page: Page,
  assetId: string,
): Promise<{ x: number; y: number } | null> {
  const PICKER_PROBE_SRC = `
    (assetId) => {
      var imgs = Array.prototype.slice.call(document.querySelectorAll("img"));
      for (var i = 0; i < imgs.length; i++) {
        var im = imgs[i];
        var r = im.getBoundingClientRect();
        if (r.width < 30 || r.width > 80) continue;
        if (r.height < 30 || r.height > 80) continue;
        var src = im.src || "";
        if (src.indexOf("name=" + assetId) === -1) continue;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }
      return null;
    }
  `;
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Function(`return (${PICKER_PROBE_SRC})`)() as any,
    assetId,
  ).catch(() => null)) as { x: number; y: number } | null;
}

// Validate that a saved mp4 file plays via ffprobe and has a video stream of
// at least minDurationSec. Throws on failure — caller marks the run as error
// and should NOT auto-retry credit-burning operations.
async function ffprobeValidateMp4(
  filePath: string,
  minDurationSec = 1,
): Promise<{ width: number; height: number; durationSec: number }> {
  let stdout = "";
  try {
    const { stdout: out } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      filePath,
    ]);
    stdout = out;
  } catch (e) {
    throw new Error(`ffprobe failed: ${(e as Error).message}`);
  }
  let meta: {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  try {
    meta = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`ffprobe returned non-JSON: ${(e as Error).message}`);
  }
  const v = (meta.streams ?? []).find((s) => s.codec_type === "video");
  if (!v) throw new Error("ffprobe: no video stream");
  const dur = parseFloat(meta.format?.duration ?? "0");
  if (!Number.isFinite(dur) || dur < minDurationSec) {
    throw new Error(`ffprobe: duration too short (${dur}s, min ${minDurationSec}s)`);
  }
  return { width: v.width ?? 0, height: v.height ?? 0, durationSec: dur };
}

// Extract the scene slug from a canonical image filename. For
// `the-discovered-sketchbook-image-01-rainy-underpass-sketch.png` we want
// just `rainy-underpass-sketch` so we can join two of them into the video
// clip's `sceneSlug` (e.g. `rainy-underpass-sketch-to-gallery-curator…`).
function sceneSlugFromImageFilename(filename: string): string {
  const stem = path.basename(filename).replace(/\.png$/i, "");
  const m = stem.match(/-image-\d{2}-(.+)$/);
  return m ? m[1] : stem;
}

interface ClipPlan {
  index: number;
  startPath: string;
  endPath: string;
  prompt: string;
  outputPath: string;
  name: CanonicalName; // canonical naming for this clip
  /**
   * Optional: Flow asset id for the start-frame image, if it's already in
   * the project gallery (resolved by pre-flight scan against the canonical
   * `<story> — Image NN — <slug>` display name). When set, the frame slot
   * picker skips re-uploading the local PNG.
   */
  startAssetId?: string | null;
  /** Same idea for the end-frame image. */
  endAssetId?: string | null;
  /** Aspect ratio token expected on Flow's chip ("crop_16_9" / "crop_9_16"). */
  expectedRatioToken?: string;
}

export async function generateOneClip(
  page: Page,
  clip: ClipPlan,
  runDir: string,
  storySlug: string,
): Promise<void> {
  const stepLabel = `clip-${String(clip.index).padStart(2, "0")}`;
  log.log("─".repeat(60));
  log.log(`[${stepLabel}] start frame: ${path.basename(clip.startPath)}`);
  log.log(`[${stepLabel}] end frame  : ${path.basename(clip.endPath)}`);
  log.log(`[${stepLabel}] prompt     : ${clip.prompt.slice(0, 100)}${clip.prompt.length > 100 ? "…" : ""}`);

  // Defensive: close any panel that may still be open from previous step.
  if (await isSettingsPanelOpen(page)) await closeSettingsPanel(page, runDir);
  if (await isInImageEditView(page)) await exitImageEditView(page, runDir);

  // ── GALLERY-AWARE IDEMPOTENCY ──────────────────────────────────────────
  // If a video tile with our expected display name already exists (e.g. a
  // previous attempt rendered it but failed to download), recover that one
  // instead of re-submitting Veo. This is what prevents "infinite duplicate
  // clip-01 renders" when retries kick in.
  try {
    const existingUrl = await findExistingClipInGallery(page, clip.name.flowDisplayName);
    if (existingUrl) {
      log.log(`[${stepLabel}] gallery has existing tile "${clip.name.flowDisplayName}" → recovering (no Veo submit)`);
      const buf = await downloadVideoFromPage(page, existingUrl, 90_000);
      await fs.writeFile(clip.outputPath, buf);
      const meta = await ffprobeValidateMp4(clip.outputPath, 1);
      log.log(`[${stepLabel}] recovered: ${buf.byteLength}B, ${meta.width}x${meta.height}, ${meta.durationSec.toFixed(2)}s`);
      await recordAsset({
        storySlug,
        kind: clip.name.kind,
        index: clip.name.index,
        sceneSlug: clip.name.sceneSlug,
        filename: clip.name.filename,
        flowDisplayName: clip.name.flowDisplayName,
        localPath: clip.outputPath,
        flowUrl: existingUrl,
      });
      return;
    }
  } catch (e) {
    // Gallery scan is best-effort; if it fails, fall through to Veo submit.
    log.warn(`[${stepLabel}] gallery scan failed (${(e as Error).message}); proceeding with Veo submit`);
  }

  // 1. Capture URL snapshot BEFORE we start uploading frames so any new
  //    project asset thumbs we surface don't trip the "new video" detector.
  const beforeVideoUrls = await snapshotKnownVideoUrls(page);

  // 2. Fill Start frame, then End frame. If the source image is already in
  //    the project gallery (passed via clip.startAssetId/endAssetId), the
  //    helper picks it from the popover instead of re-uploading the local
  //    file (avoids creating dup gallery tiles per Veo submit).
  await uploadIntoFrameSlot(
    page, "Start", clip.startPath, runDir, stepLabel, clip.startAssetId,
  );
  await uploadIntoFrameSlot(
    page, "End", clip.endPath, runDir, stepLabel, clip.endAssetId,
  );

  // 3. Type transition prompt.
  await typePromptIntoEditor(page, clip.prompt, runDir, stepLabel);

  // 4. Re-verify chip is Video / <ratio> / x1 BEFORE submission.
  const expectedRatio = clip.expectedRatioToken ?? "crop_16_9";
  const state = await readChipState(page, "video");
  if (!state || state.ratio !== expectedRatio || state.count !== 1) {
    await takeScreenshot(page, runDir, `${stepLabel}-bad-settings`);
    throw new Error(
      `Refusing to submit — chip="${state?.text ?? "n/a"}" not Video/${expectedRatio}/x1`,
    );
  }
  log.log(`[${stepLabel}] chip verified: "${state.text}"`);

  // 5. Submit.
  await takeScreenshot(page, runDir, `${stepLabel}-pre-submit`);
  const sub = await clickPromptSubmit(page);
  if (!sub.ok) {
    await takeScreenshot(page, runDir, `${stepLabel}-submit-fail`);
    throw new Error("Failed to click submit (no candidate)");
  }
  log.log(`[${stepLabel}] submit: ${sub.description}`);

  // 6. Wait for Veo to render the clip (typically 60-180s for Lite).
  log.log(`[${stepLabel}] waiting on Veo render…`);
  const url = await waitForNewVideoUrl(page, beforeVideoUrls, 6 * 60_000);
  if (!url) {
    await takeScreenshot(page, runDir, `${stepLabel}-render-timeout`);
    throw new Error("Veo did not produce a new video URL within 6 minutes");
  }
  log.log(`[${stepLabel}] new clip URL: ${url}`);

  // 7. CRITICAL: persist this URL into the graveyard BEFORE attempting to
  //    download. If the download stalls or the script is killed, the next run
  //    will see this URL and try to download it instead of burning Veo
  //    credits a second time.
  await rememberOrphanedFlowUrl(storySlug, clip.name.registryKey, url);

  // 8. Download the clip with strict validation — content-type must be
  //    video/*, size >= 200KB, and ffprobe must confirm a real mp4 with a
  //    video stream of >= 1 second. Anything else is rejected; the run will
  //    error out and operators must investigate (NEVER auto-retry the Veo
  //    submit on a download failure).
  const buf = await downloadVideoFromPage(page, url);
  await fs.writeFile(clip.outputPath, buf);
  try {
    const meta = await ffprobeValidateMp4(clip.outputPath, 1);
    log.log(`[${stepLabel}] ffprobe: ${meta.width}x${meta.height}, ${meta.durationSec.toFixed(2)}s`);
  } catch (e) {
    // Delete the bogus file so a retry doesn't reuse it via dedup A.
    await fs.unlink(clip.outputPath).catch(() => {});
    throw new Error(`Downloaded mp4 failed validation: ${(e as Error).message}`);
  }
  log.log(`[${stepLabel}] saved ${buf.byteLength} bytes → ${clip.outputPath}`);
  await takeScreenshot(page, runDir, `${stepLabel}-saved`);

  // 9. Register the asset, then drop the URL from the graveyard (we have the
  //    bytes locally now).
  await recordAsset({
    storySlug,
    kind: clip.name.kind,
    index: clip.name.index,
    sceneSlug: clip.name.sceneSlug,
    filename: clip.name.filename,
    flowDisplayName: clip.name.flowDisplayName,
    localPath: clip.outputPath,
    flowUrl: url,
  });
  await clearOrphanedFlowUrls(storySlug, clip.name.registryKey);

  // 10. SOFT rename — bytes are already on disk and recorded with flowUrl.
  //     The prior STRICT behaviour aborted the stage if the rename click
  //     missed, which on retry caused Veo to re-render the SAME clip,
  //     burning a fresh credit. The local mp4 is what stitching consumes;
  //     a misnamed gallery tile is a cosmetic UI nit, not a pipeline
  //     failure. We still attempt the rename (so manual cleanup can find
  //     the tile by its canonical name) but we no longer abort on click
  //     failure — we log and proceed, leaving the URL persisted via the
  //     pre-emptive `rememberOrphanedFlowUrl` call below so a follow-up
  //     run / cleanup script can re-target the rename without re-rendering.
  try {
    await renameTileByVideoSrcVerified(page, url, clip.name.flowDisplayName);
    log.log(`[${stepLabel}] flow rename: verified → "${clip.name.flowDisplayName}"`);
  } catch (renameErr) {
    log.warn(
      `[${stepLabel}] flow rename failed (non-fatal — bytes saved & recorded): ${(renameErr as Error).message.slice(0, 200)}`,
    );
    // Re-persist the URL so a manual cleanup script (or a future
    // background reconciler) can find the tile by `name=<assetId>` and
    // rename it without re-rendering the clip.
    await rememberOrphanedFlowUrl(storySlug, clip.name.registryKey, url).catch(() => {});
  }

  // 8. Clear frames + prompt for next iteration. Easiest path: just clear the
  //    text and trust that the next clip will overwrite Start/End slots when
  //    we click them again. If that proves wrong, add explicit slot-clear
  //    steps here.
  await clickPromptInputArea(page);
  await page.keyboard.down("Meta"); await page.keyboard.press("KeyA"); await page.keyboard.up("Meta");
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.press("Delete");
  await new Promise((r) => setTimeout(r, 300));
}

// ──────────────────────────────────────────────────────────────────────────────
//  Transition prompt builder
// ──────────────────────────────────────────────────────────────────────────────

// Build a concise transition prompt that tells Veo what motion/feel to target
// between the start and end frames. The visual content is locked in by the
// frames themselves; the prompt just shapes the in-between motion.
//
// When `runOpts` carries dialogue / BGM / SFX cues for either the start or
// end scene, those are appended as separate lines so Veo's native audio path
// bakes them into the rendered clip.
function buildTransitionPrompt(
  storyline: Storyline,
  startTitle: string,
  endTitle: string,
  endIndex: number,
  runOpts?: {
    aspectRatio?: GenerationSettings["ratio"];
    dialogue?: boolean;
    bgm?: boolean;
    sfx?: boolean;
    language?: "hindi" | "english";
  },
): string {
  const beat = (raw: string) => raw.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  const startBeat = beat(startTitle);
  const endBeat = beat(endTitle);

  const ratio: GenerationSettings["ratio"] =
    runOpts?.aspectRatio ?? (storyline.aspectRatio as GenerationSettings["ratio"] | undefined) ?? "16:9";
  const ratioLine =
    ratio === "9:16"
      ? `9:16 vertical mobile-first composition, ~5 seconds.`
      : ratio === "16:9"
        ? `16:9 horizontal cinematic composition, ~5 seconds.`
        : `${ratio} composition, ~5 seconds.`;

  const lines: string[] = [
    `Smooth cinematic camera move from "${startBeat}" to "${endBeat}".`,
    `Same protagonist throughout: ${storyline.protagonist}.`,
    `Maintain visual continuity — same hair, clothing, key prop, body language.`,
    `Subtle parallax, natural breathing motion, ambient lighting shift between scenes.`,
    `Quiet, grounded pacing — no jump cuts, no zooms.`,
    ratioLine,
  ];

  // Per-scene audio cues — pulled from the END scene because that's the
  // emotional pay-off frame each clip lands on. Falls back to the START
  // scene if the end scene didn't get a cue.
  const endScene = storyline.imagePrompts[endIndex];
  const startScene = storyline.imagePrompts[endIndex - 1];

  if (runOpts?.dialogue) {
    const langLabel = runOpts.language === "hindi" ? "Hindi" : "English";
    // Prefer the new multi-speaker `dialogues[]` shape when present; fall back
    // to the legacy single-line `dialogueHi` field.
    const multi = (endScene?.dialogues ?? startScene?.dialogues) ?? [];
    if (multi.length > 0) {
      // Resolve speaker labels: "main" → main character; otherwise look up the
      // role in supportingCast so Veo gets a hint about who's talking.
      const cast = storyline.supportingCast ?? [];
      const speakerLabel = (speaker: string): string => {
        const tag = (speaker ?? "").trim().toLowerCase();
        if (!tag || tag === "main" || tag === "protagonist") {
          return "Main character";
        }
        const found = cast.find(
          (c) =>
            c.role.toLowerCase() === tag ||
            c.name.toLowerCase() === tag,
        );
        if (found) return found.name || found.role;
        return speaker;
      };

      const formatted = multi
        .map((d) => `${speakerLabel(d.speaker)} says: "${d.lineHi}"`)
        .join(" Then, ");
      lines.push(
        `Conversational exchange (lip-synced, ${langLabel}): ${formatted}. Cut/cross-cut between speakers as needed; keep mouth movements natural and subtle for each speaker.`,
      );
    } else {
      const hi =
        (endScene?.dialogueHi ?? startScene?.dialogueHi ?? "").trim();
      if (hi) {
        lines.push(
          `Character speaks (lip-synced, ${langLabel}): "${hi}". Keep mouth movements natural and subtle.`,
        );
      }
    }
  }
  if (runOpts?.bgm) {
    const bgm =
      (endScene?.bgmCue ?? startScene?.bgmCue ?? "").trim();
    if (bgm) lines.push(`Background music: ${bgm}.`);
    else lines.push(`Subtle background music matching the scene's tone.`);
  }
  if (runOpts?.sfx) {
    const sfx =
      (endScene?.sfxCue ?? startScene?.sfxCue ?? "").trim();
    if (sfx) lines.push(`Diegetic sound effects: ${sfx}.`);
    else lines.push(`Diegetic ambient sound effects appropriate to the scene.`);
  }

  return lines.join(" ");
}

// ──────────────────────────────────────────────────────────────────────────────
//  Stitch clips → final mp4 with ffmpeg concat demuxer
// ──────────────────────────────────────────────────────────────────────────────

async function stitchClipsWithFfmpeg(clipPaths: string[], outputPath: string): Promise<void> {
  if (clipPaths.length === 0) throw new Error("No clips to stitch");
  if (clipPaths.length === 1) {
    await fs.copyFile(clipPaths[0], outputPath);
    return;
  }
  // Build a temporary concat list.
  const listFile = `${outputPath}.concat.txt`;
  const lines = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`);
  await fs.writeFile(listFile, lines.join("\n"), "utf-8");
  try {
    log.log(`Stitching ${clipPaths.length} clips → ${outputPath}`);
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      outputPath,
    ]);
  } catch (e) {
    // Stream copy can fail if codecs differ between clips; re-encode as a
    // fallback. Veo clips should all share H.264/AAC so this rarely fires.
    log.warn(`ffmpeg stream copy failed (${(e as Error).message}); re-encoding`);
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-c:a", "aac",
      "-b:a", "192k",
      outputPath,
    ]);
  } finally {
    await fs.rm(listFile, { force: true });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Public orchestrator
// ──────────────────────────────────────────────────────────────────────────────

export interface RunPhase2Opts {
  /** Per-video isolation key (date-suffixed slug). REQUIRED. */
  storySlug: string;
  /** Project name shown in Flow's UI. Usually identical to storySlug. */
  projectName: string;
  /** Phase-1 run dir to source images from. Defaults to latest matching slug. */
  sourceRunDir?: string;
  /** How many clips to chain. Pairs are (img i, img i+1) for i=1..clipCount. */
  clipCount?: number;
  /** Veo variant override (default: env FLOW_TV_VEO_VARIANT or "Lite"). */
  veoVariant?: VeoVariant;
  /** Optional: caller-provided run dir (e.g. <runId>/phase2). */
  runDir?: string;
  /** Aspect ratio for Flow's video chip + transition prompt. Default 16:9. */
  aspectRatio?: GenerationSettings["ratio"];
  /** When true, request lip-synced dialogue in the Veo clip prompt. */
  dialogue?: boolean;
  /** When true, request background music in the Veo clip prompt. */
  bgm?: boolean;
  /** When true, request diegetic SFX in the Veo clip prompt. */
  sfx?: boolean;
  /** Dialogue language (drives the "Hindi"/"English" label in the Veo prompt). */
  language?: "hindi" | "english";
}

export async function runPhase2(opts: RunPhase2Opts): Promise<Phase2Progress> {
  const variant = opts.veoVariant ?? getVeoVariant();
  const requestedClipCount = Math.max(1, Math.min(opts.clipCount ?? 2, 11));
  const aspectRatio: GenerationSettings["ratio"] = opts.aspectRatio ?? "16:9";
  const expectedRatioToken = RATIO_TAB_TEXT[aspectRatio];
  const videoSettings: GenerationSettings = { ratio: aspectRatio, count: 1 };

  const runDir =
    opts.runDir ??
    path.join(
      RUNS_DIR,
      `${new Date().toISOString().replace(/[:.]/g, "-")}-clips${requestedClipCount}-${opts.storySlug}`,
    );
  await fs.mkdir(runDir, { recursive: true });

  _progress = {
    status: "starting",
    message: `Phase 2 starting — ${requestedClipCount} chained clips, Veo ${variant}`,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    clipCount: requestedClipCount,
    clipsDone: 0,
    clipPaths: [],
    runDir,
    screenshots: [],
  };

  await ensureFfmpegOk();

  try {
    setProgress({ status: "loading_phase1", message: "Resolving Phase-1 source assets" });
    const src = await resolvePhase1Source(opts.storySlug, opts.sourceRunDir);
    if (src.scenePaths.length < requestedClipCount + 1) {
      throw new Error(
        `Need at least ${requestedClipCount + 1} scene images for ${requestedClipCount} chained clips, ` +
          `found ${src.scenePaths.length} in ${src.runDir}`,
      );
    }
    setProgress({ sourceRunDir: src.runDir });
    log.log(`Phase-1 source: ${src.runDir}`);
    log.log(`  character    : ${path.basename(src.characterPath)}`);
    src.scenePaths.forEach((p, i) => log.log(`  scene-${i + 1}      : ${path.basename(p)}`));

    setProgress({ status: "browser_launching", message: `Launching ${isHeadless() ? "headless" : "visible"} Chrome` });
    const browser = await launchBrowser();
    try {
      const page = await prepPage(browser);

      setProgress({ message: "Opening Flow TV homepage" });
      await page.bringToFront().catch(() => {});
      await focusChromeOnMac();
      await page.goto(FLOW_URL, { waitUntil: "networkidle2", timeout: 60_000 });
      await dismissCookieWall(page);
      await dismissWelcomeModal(page).catch(() => false);
      await page.bringToFront().catch(() => {});
      await focusChromeOnMac();
      await takeScreenshot(page, runDir, "00-flow-home");

      const alreadyIn = await isLoggedInToFlow(page);
      if (!alreadyIn) {
        setProgress({ message: "Sign in to Google in the opened Chrome window (15 min timeout)" });
        const ok = await waitForLogin(page, runDir);
        if (!ok) throw new Error("Login timed out after 15 minutes.");
      }
      await takeScreenshot(page, runDir, "01-post-login");

      // Reuse the cached Phase-1 project (per-storySlug). We never create a
      // new project here — Phase 1 must have run for this storySlug first.
      const cached = await loadProjectCache(opts.storySlug);
      if (!cached) {
        throw new Error(
          `No cached Flow project for storySlug=${opts.storySlug} — run Phase 1 first`,
        );
      }
      log.log(`Reusing project: ${cached.projectName}`);
      const project = await ensureProject(page, runDir, opts.storySlug, opts.projectName);
      await waitForLoadingToClear(page, 30_000);
      setProgress({ message: `Project: ${project.projectName}` });
      await takeScreenshot(page, runDir, "02-project-open");

      setProgress({
        status: "configuring_video_mode",
        message: `Switching to Video / Veo 3.1 - ${variant} / ${aspectRatio} / x1`,
      });
      await ensureVideoSettings(page, runDir, variant, videoSettings);
      await takeScreenshot(page, runDir, "03-video-mode-ready");

      // ── PRE-FLIGHT GALLERY INVENTORY ─────────────────────────────────
      // Before doing ANY work, scan the project gallery and wait for
      // quiescence. The inventory lets us:
      //   • count images vs videos already in the project,
      //   • map each Phase-1 image's display name → Flow asset id, so
      //     subsequent frame uploads can pick the existing tile from the
      //     slot popover instead of re-uploading and creating a duplicate.
      setProgress({ status: "configuring_video_mode", message: "Pre-flight: scanning project gallery" });
      await waitForGalleryQuiescent(page, 60_000);
      const galleryByName = await scanProjectAssetsByDisplayName(page, 16);
      await takeScreenshot(page, runDir, "03b-gallery-inventory");

      // Plan the chain. For requestedClipCount=2 we get:
      //   clip-01: scene[0] → scene[1]
      //   clip-02: scene[1] → scene[2]
      // IMPORTANT: use opts.storySlug (date-suffixed) so the asset registry
      // lookups are scoped to *this* video. We must NOT recompute it from the
      // raw title here — that would lose the date suffix and collide with
      // earlier runs of the same story.
      const storySlug = opts.storySlug;
      const clips: ClipPlan[] = [];

      // Resolve a Phase-1 image PNG path to its Flow asset id (if present
      // in the gallery inventory). We try multiple lookup keys because Flow
      // auto-names uploaded tiles by filename if our rename step was
      // previously skipped (e.g. because Phase 1 reused a local file via
      // Dedup A and never re-entered the upload-and-rename path):
      //   1. Canonical display name: "<storyTitle> — Image NN — <slug>"
      //   2. Original upload filename: "<storyslug>-image-NN-<slug>.png"
      // First match wins.
      const resolveAssetIdForFrame = (imagePngPath: string): string | null => {
        const fname = path.basename(imagePngPath);
        const m = fname.match(/-image-(\d{2})-(.+)\.png$/i);
        if (!m) return null;
        const idx = parseInt(m[1], 10);
        const slug = m[2];
        const name = buildAssetName({
          storyTitle: src.storyline.title,
          storySlug: opts.storySlug,
          kind: "image",
          index: idx,
          sceneSlug: slug,
          ext: "png",
        });
        const candidates = [name.flowDisplayName, name.filename];
        for (const key of candidates) {
          const entry = galleryByName.get(key);
          if (entry) return entry.assetId;
        }
        return null;
      };

      for (let i = 0; i < requestedClipCount; i++) {
        const startScene = src.scenePaths[i];
        const endScene = src.scenePaths[i + 1];
        const startTitle = src.storyline.imagePrompts[i]?.title ?? `scene-${i + 1}`;
        const endTitle = src.storyline.imagePrompts[i + 1]?.title ?? `scene-${i + 2}`;
        const startSlug = sceneSlugFromImageFilename(startScene);
        const endSlug = sceneSlugFromImageFilename(endScene);
        const sceneSlug = `${startSlug}-to-${endSlug}`;
        const prompt = buildTransitionPrompt(
          src.storyline,
          startTitle,
          endTitle,
          i + 1,
          {
            aspectRatio,
            dialogue: opts.dialogue,
            bgm: opts.bgm,
            sfx: opts.sfx,
            language: opts.language,
          },
        );
        const name = buildAssetName({
          storyTitle: src.storyline.title,
          storySlug: opts.storySlug,
          kind: "video",
          index: i + 1,
          sceneSlug,
          ext: "mp4",
        });
        clips.push({
          index: i + 1,
          startPath: startScene,
          endPath: endScene,
          prompt,
          outputPath: path.join(runDir, name.filename),
          name,
          startAssetId: resolveAssetIdForFrame(startScene),
          endAssetId: resolveAssetIdForFrame(endScene),
          expectedRatioToken,
        });
      }

      log.log(`Plan: ${clips.length} clips (${variant})`);
      clips.forEach((c) => {
        log.log(
          `  ${c.name.filename}  [${path.basename(c.startPath)}${c.startAssetId ? ` (gallery id=${c.startAssetId.slice(0, 8)}…)` : " (will upload)"} → ${path.basename(c.endPath)}${c.endAssetId ? ` (gallery id=${c.endAssetId.slice(0, 8)}…)` : " (will upload)"}]`,
        );
      });

      for (const clip of clips) {
        setProgress({
          status: "generating_clip",
          message: `Clip ${clip.index}/${clips.length}: ${clip.name.filename}`,
        });

        // Dedup A: a previously-saved local file for this exact clip name —
        // but ONLY reuse if ffprobe confirms it's a real mp4 with a video
        // stream. The earlier (broken) version reused JPEG-thumbnails-saved-
        // as-mp4 here, which is what made corrupted runs look "complete".
        const existingLocal = await findExistingLocalAsset(storySlug, clip.name.registryKey);
        let reusedLocal = false;
        if (existingLocal && fsSync.existsSync(existingLocal)) {
          try {
            await ffprobeValidateMp4(existingLocal, 1);
            if (existingLocal !== clip.outputPath) {
              try {
                await fs.link(existingLocal, clip.outputPath);
              } catch {
                await fs.copyFile(existingLocal, clip.outputPath);
              }
            }
            log.log(`[${clip.name.registryKey}] reuse local (ffprobe ok): ${existingLocal}`);
            await recordAsset({
              storySlug,
              kind: clip.name.kind,
              index: clip.name.index,
              sceneSlug: clip.name.sceneSlug,
              filename: clip.name.filename,
              flowDisplayName: clip.name.flowDisplayName,
              localPath: clip.outputPath,
            });
            reusedLocal = true;
          } catch (e) {
            log.warn(
              `[${clip.name.registryKey}] existing local mp4 failed ffprobe (${(e as Error).message}); deleting and recovering`,
            );
            // Delete both source and dest copies so they don't trip Dedup A
            // again on the next iteration.
            await fs.unlink(existingLocal).catch(() => {});
            if (fsSync.existsSync(clip.outputPath)) await fs.unlink(clip.outputPath).catch(() => {});
          }
        }
        if (!reusedLocal) {
          // Dedup B: orphan Veo URLs from prior failed/killed runs. Try them
          // in reverse order (newest first) — if any returns valid bytes,
          // skip Veo entirely.
          const orphans = await consumeOrphanedFlowUrls(storySlug, clip.name.registryKey);
          let downloadedFromOrphan = false;
          if (orphans.length > 0) {
            log.log(`[${clip.name.registryKey}] trying ${orphans.length} orphan URL(s) before Veo`);
            for (let oi = orphans.length - 1; oi >= 0; oi--) {
              const url = orphans[oi];
              try {
                // Tight 90s ceiling per orphan: a healthy CDN response
                // downloads within ~10s; anything slower probably means the
                // URL has expired, so fail fast and try the next one.
                const buf = await downloadVideoFromPage(page, url, 90_000);
                await fs.writeFile(clip.outputPath, buf);
                log.log(`[${clip.name.registryKey}] orphan-download ok (${buf.byteLength}B) → ${clip.outputPath}`);
                await recordAsset({
                  storySlug,
                  kind: clip.name.kind,
                  index: clip.name.index,
                  sceneSlug: clip.name.sceneSlug,
                  filename: clip.name.filename,
                  flowDisplayName: clip.name.flowDisplayName,
                  localPath: clip.outputPath,
                  flowUrl: url,
                });
                await clearOrphanedFlowUrls(storySlug, clip.name.registryKey);
                downloadedFromOrphan = true;
                break;
              } catch (e) {
                log.warn(
                  `[${clip.name.registryKey}] orphan URL failed (${(e as Error).message}); will try next`,
                );
              }
            }
          }
          if (!downloadedFromOrphan) {
            // No usable cache → submit Veo for real.
            await generateOneClip(page, clip, runDir, storySlug);
          }
        }
        if (_progress) {
          _progress.clipPaths.push(clip.outputPath);
          _progress.clipsDone = clip.index;
        }
      }

      setProgress({ status: "stitching", message: `Stitching ${clips.length} clips into final video` });
      const finalName = buildAssetName({
        storyTitle: src.storyline.title,
        storySlug: opts.storySlug,
        kind: "final",
        ext: "mp4",
      });
      const finalPath = path.join(runDir, finalName.filename);
      await stitchClipsWithFfmpeg(
        clips.map((c) => c.outputPath),
        finalPath,
      );
      await recordAsset({
        storySlug,
        kind: "final",
        index: 0,
        filename: finalName.filename,
        flowDisplayName: finalName.flowDisplayName,
        localPath: finalPath,
      });
      log.log(`Final stitched video: ${finalPath}`);
      if (_progress) _progress.finalVideoPath = finalPath;

      setProgress({ status: "done", message: `Phase 2 complete: ${clips.length} clips + final video` });
      log.log(`Phase 2 complete. Run dir: ${runDir}`);
      return _progress!;
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`Phase 2 failed: ${msg}`);
    setProgress({ status: "error", message: `Phase 2 failed: ${msg}`, error: msg });
    return _progress!;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Refresh-one-clip helper (used by run-machine for "Refresh this clip")
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Regenerate ONE Phase-2 clip in place: open Flow → archive existing
 * `<story>-video-NN-…` tile → re-render with the same start/end frames + Veo
 * variant → strict-rename. Used at the clips-approval gate when the user
 * doesn't like clip i and wants a fresh take.
 *
 * Caller must ensure Phase-1 ran for this storySlug (we read scene images
 * from `phase1RunDir`).
 */
export async function regeneratePhase2Clip(opts: {
  storySlug: string;
  projectName: string;
  /** Phase-1 source run dir (where character + scene images live). */
  phase1RunDir: string;
  /** Phase-2 run dir (where clips + final video live). */
  runDir: string;
  /** 1-based clip index. For 2-clip chain: 1 = scenes[0]→scenes[1], etc. */
  index: number;
  veoVariant?: VeoVariant;
  aspectRatio?: GenerationSettings["ratio"];
  dialogue?: boolean;
  bgm?: boolean;
  sfx?: boolean;
  language?: "hindi" | "english";
}): Promise<string> {
  const variant = opts.veoVariant ?? getVeoVariant();
  const aspectRatio: GenerationSettings["ratio"] = opts.aspectRatio ?? "16:9";
  const expectedRatioToken = RATIO_TAB_TEXT[aspectRatio];
  const videoSettings: GenerationSettings = { ratio: aspectRatio, count: 1 };
  await fs.mkdir(opts.runDir, { recursive: true });

  // Resolve source frames from the Phase-1 run dir using canonical matchers.
  const storyline = await loadStoryline(opts.storySlug);
  const matchers = makeCanonicalMatchers(opts.storySlug);
  const files = await fs.readdir(opts.phase1RunDir);
  const sceneFiles = files.filter((f) => matchers.image.test(f)).sort();
  if (sceneFiles.length < opts.index + 1) {
    throw new Error(
      `regeneratePhase2Clip: need ≥${opts.index + 1} scene images, found ${sceneFiles.length}`,
    );
  }
  const startPath = path.join(opts.phase1RunDir, sceneFiles[opts.index - 1]);
  const endPath = path.join(opts.phase1RunDir, sceneFiles[opts.index]);
  const startTitle = storyline.imagePrompts[opts.index - 1]?.title ?? `scene-${opts.index}`;
  const endTitle = storyline.imagePrompts[opts.index]?.title ?? `scene-${opts.index + 1}`;
  const sceneSlug = `${sceneSlugFromImageFilename(startPath)}-to-${sceneSlugFromImageFilename(endPath)}`;

  const name = buildAssetName({
    storyTitle: storyline.title,
    storySlug: opts.storySlug,
    kind: "video",
    index: opts.index,
    sceneSlug,
    ext: "mp4",
  });
  const outputPath = path.join(opts.runDir, name.filename);

  log.log(`[regen ${name.registryKey}] starting (variant=${variant})`);

  await ensureFfmpegOk();
  const browser = await launchBrowser();
  try {
    const page = await prepPage(browser);
    await page.bringToFront().catch(() => {});
    await focusChromeOnMac();
    await page.goto(FLOW_URL, { waitUntil: "networkidle2", timeout: 60_000 });
    await dismissCookieWall(page);
    await dismissWelcomeModal(page).catch(() => false);

    const alreadyIn = await isLoggedInToFlow(page);
    if (!alreadyIn) {
      const ok = await waitForLogin(page, opts.runDir);
      if (!ok) throw new Error("Login timed out during clip refresh");
    }

    const project = await ensureProject(page, opts.runDir, opts.storySlug, opts.projectName);
    log.log(`[regen ${name.registryKey}] project: ${project.projectName}`);

    await ensureVideoSettings(page, opts.runDir, variant, videoSettings);

    // Archive the existing clip tile if present.
    const archived = await archiveTileByName(page, name.flowDisplayName);
    if (archived) {
      log.log(`[regen ${name.registryKey}] archived old clip tile`);
      await waitForTiles(page, 0, 4_000);
    } else {
      log.warn(`[regen ${name.registryKey}] no existing tile named "${name.flowDisplayName}"`);
    }

    const clip: ClipPlan = {
      index: opts.index,
      startPath,
      endPath,
      prompt: buildTransitionPrompt(storyline, startTitle, endTitle, opts.index, {
        aspectRatio,
        dialogue: opts.dialogue,
        bgm: opts.bgm,
        sfx: opts.sfx,
        language: opts.language,
      }),
      outputPath,
      name,
      expectedRatioToken,
    };

    await generateOneClip(page, clip, opts.runDir, opts.storySlug);
    return outputPath;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Stitch existing clips into the final MP4. Used by the run-machine after
 * the user approves all clips. Idempotent: re-running overwrites the final.
 */
export async function stitchPhase2Clips(opts: {
  storySlug: string;
  storyline: Storyline;
  runDir: string;
  clipPaths: string[];
}): Promise<string> {
  await ensureFfmpegOk();
  const finalName = buildAssetName({
    storyTitle: opts.storyline.title,
    storySlug: opts.storySlug,
    kind: "final",
    ext: "mp4",
  });
  const finalPath = path.join(opts.runDir, finalName.filename);
  await stitchClipsWithFfmpeg(opts.clipPaths, finalPath);
  await recordAsset({
    storySlug: opts.storySlug,
    kind: "final",
    index: 0,
    filename: finalName.filename,
    flowDisplayName: finalName.flowDisplayName,
    localPath: finalPath,
  });
  return finalPath;
}
