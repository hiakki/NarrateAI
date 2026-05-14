// Flow TV — Run state machine.
//
// A "Flow TV Run" is the journey from `generate storyline` → `final video`,
// with optional approval gates between stages. Multiple runs can be created
// concurrently but only ONE actually executes at a time (BullMQ concurrency=1)
// because every browser-driven stage holds an exclusive Chrome session.
//
// State persisted on disk under `data/flow-tv/runs-state/<runId>.json`.
// Phase 1 outputs live under `<runDir>/phase1`; Phase 2 outputs under
// `<runDir>/phase2`; final video is `<runDir>/phase2/<story>-final.mp4`.
//
// Stages (linear, with optional pause-points marked ⏸):
//
//   queued
//     → generating_storyline       (no browser, ~3s)
//     ⏸ awaiting_storyline_approval (only if approvalMode includes "storyline")
//     → generating_images          (browser; character + N scene images)
//     ⏸ awaiting_images_approval   (only if approvalMode includes "images")
//     → generating_clips           (browser; N-1 chained Veo clips)
//     ⏸ awaiting_clips_approval    (only if approvalMode includes "clips")
//     → stitching                  (no browser; ffmpeg concat)
//     → finalizing                 (creates Series+Automation+Video rows;
//                                    schedules posts to platforms)
//     → done
//
// Refresh requests (per-asset regeneration) re-use the SAME run; they edit
// only the affected asset and leave subsequent stages alone.

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createLogger } from "@/lib/logger";
import {
  dateSuffixedSlug,
  flowProjectNameFromStorySlug,
  buildAssetName,
} from "@/services/flow-tv-naming";
import {
  FLOW_DATA_DIR,
  generateStorylineWithGemini,
  saveStorylineCache,
  loadStorylineCache,
  resetPhase1Cache,
  runPhase1,
  regeneratePhase1Asset,
  buildVarietyHintsForNiche,
  type Storyline,
} from "@/services/flow-tv-phase1";
import {
  runPhase2,
  regeneratePhase2Clip,
  stitchPhase2Clips,
  type VeoVariant,
} from "@/services/flow-tv-phase2";
import { classifyProtagonist } from "@/services/flow-tv-prompts";

const log = createLogger("FlowTV:Run");

export const RUNS_STATE_DIR = path.join(FLOW_DATA_DIR, "runs-state");
export const RUNS_DIR = path.join(FLOW_DATA_DIR, "runs");

// ──────────────────────────────────────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────────────────────────────────────

export type ApprovalMode =
  | "auto"                 // 0 gates — generate end-to-end
  | "storyline"            // 1 gate — stop after storyline
  | "storyline+images"     // 2 gates — also stop after images
  | "storyline+images+clips"; // 3 gates — also stop after clips

export type FlowLanguage = "hindi" | "english";

export type FlowNiche =
  | "zero-to-hero"
  | "funny"
  | "moral"
  | "horror"
  | "mythological";

export type FlowCharacterStyle = "cartoon_3d" | "hyperreal_3d" | "photoreal";

export type FlowAspectRatio = "9:16" | "16:9";

/**
 * Where the storyline JSON comes from.
 *   - `api`: `generativelanguage.googleapis.com` Gemini Flash (default;
 *     subject to 503/UNAVAILABLE during peak demand).
 *   - `web`: scrape `gemini.google.com/app` with the user's logged-in
 *     Google session via Puppeteer (different capacity pool, "Gemini 3 Fast").
 */
export type FlowStorylineSource = "api" | "web";

export type RunStage =
  | "queued"
  | "generating_storyline"
  | "awaiting_storyline_approval"
  | "generating_images"
  | "awaiting_images_approval"
  | "generating_clips"
  | "awaiting_clips_approval"
  | "stitching"
  | "finalizing"
  | "done"
  | "error";

export interface RunEvent {
  ts: number;
  stage: RunStage;
  message: string;
  level: "info" | "warn" | "error";
}

export interface FlowRun {
  id: string;
  createdAt: number;
  updatedAt: number;

  // Provenance.
  userId: string;
  niche: FlowNiche;       // niche template drives storyline tone + arc
  triggerSource: string;  // "ui" | "scheduler" | "api"

  // Plan parameters (set at create time).
  imageCount: number;     // 2..12; clipCount = imageCount - 1
  clipCount: number;
  veoVariant: VeoVariant;
  approvalMode: ApprovalMode;
  storyTitleHint?: string; // optional initial title hint; Gemini may override

  // Creative options (set at create time, locked for the run).
  language: FlowLanguage;            // dialogue + narration language
  characterStyle: FlowCharacterStyle; // visual style of characters/scenes
  aspectRatio: FlowAspectRatio;      // 9:16 (Shorts) or 16:9 (long-form)
  dialogue: boolean;                 // Veo 3.1 bakes lip-synced speech
  bgm: boolean;                      // Veo prompt-driven background music
  sfx: boolean;                      // Veo native sound effects
  subtitles: boolean;                // ffmpeg burn-in (romanized) on final mp4
  useRecurringCharacter: boolean;    // adopt prior run's character
  adoptedFromRunId?: string;         // populated when recurring character was used
  /**
   * When set, this run will re-use the saved character (DB id from the
   * Character library, type=flow_tv) instead of generating a new one. Phase 1
   * copies that character's image into the run dir and overrides
   * storyline.characterPrompt with the saved fullPrompt. Takes precedence
   * over `useRecurringCharacter`.
   */
  reuseCharacterId?: string;
  storylineSource: FlowStorylineSource; // api (default) or web (gemini.google.com)

  /**
   * Optional Automation row id (automationType="flow-tv") that spawned this
   * run. Set by the scheduler dispatch path so finalize attributes the
   * resulting Video to THIS schedule's series instead of collapsing every
   * scheduled run onto the singleton "Flow TV — Zero to Hero" automation.
   */
  automationId?: string;

  // Derived identity (set on first storyline generation).
  storySlug?: string;       // <title-slug>-DDMMYYYY
  projectName?: string;     // identical to storySlug (Flow display)

  // Filesystem layout.
  runDir: string;           // data/flow-tv/runs/<runId>
  phase1RunDir: string;     // data/flow-tv/runs/<runId>/phase1
  phase2RunDir: string;     // data/flow-tv/runs/<runId>/phase2

  // Stage tracking.
  stage: RunStage;
  stageStartedAt: number;
  stageUpdatedAt: number;
  lastMessage: string;
  error?: string;

  // Stage outputs.
  storyline?: Storyline;
  characterPath?: string;
  imagePaths?: string[];
  clipPaths?: string[];
  finalVideoPath?: string;
  videoId?: string;          // NarrateAI Video.id, set after finalize.

  // Append-only history (capped at 200 events).
  events: RunEvent[];
}

// ──────────────────────────────────────────────────────────────────────────────
//  Persistence
// ──────────────────────────────────────────────────────────────────────────────

function runStateFile(runId: string): string {
  return path.join(RUNS_STATE_DIR, `${runId}.json`);
}

export async function saveRun(run: FlowRun): Promise<FlowRun> {
  await fs.mkdir(RUNS_STATE_DIR, { recursive: true });
  run.updatedAt = Date.now();
  await fs.writeFile(runStateFile(run.id), JSON.stringify(run, null, 2), "utf-8");
  return run;
}

export async function loadRun(runId: string): Promise<FlowRun | null> {
  if (!fsSync.existsSync(runStateFile(runId))) return null;
  const raw = await fs.readFile(runStateFile(runId), "utf-8");
  try {
    const run = JSON.parse(raw) as FlowRun;
    // Backwards-compat shims.
    run.events ??= [];
    run.imagePaths ??= [];
    run.clipPaths ??= [];
    // New-options shims (older runs predate the niche/language/etc fields).
    run.niche ??= "zero-to-hero";
    run.language ??= "english";
    run.characterStyle ??= "photoreal";
    run.aspectRatio ??= "16:9";
    run.dialogue ??= false;
    run.bgm ??= false;
    run.sfx ??= false;
    run.subtitles ??= false;
    run.useRecurringCharacter ??= false;
    run.storylineSource ??= "api";
    return run;
  } catch (e) {
    log.warn(`Corrupted run state for ${runId}: ${(e as Error).message}`);
    return null;
  }
}

export async function listRuns(opts?: { limit?: number; userId?: string }): Promise<FlowRun[]> {
  if (!fsSync.existsSync(RUNS_STATE_DIR)) return [];
  const files = await fs.readdir(RUNS_STATE_DIR);
  const runs: FlowRun[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const id = f.replace(/\.json$/, "");
    const r = await loadRun(id);
    if (!r) continue;
    if (opts?.userId && r.userId !== opts.userId) continue;
    runs.push(r);
  }
  runs.sort((a, b) => b.createdAt - a.createdAt);
  return opts?.limit ? runs.slice(0, opts.limit) : runs;
}

/**
 * Delete a run end-to-end:
 *   • Cancel any pending BullMQ advance job (best-effort).
 *   • Delete the run state file (`runs-state/<runId>.json`).
 *   • Delete the per-run output dir (`runs/<runId>/`) — phase1 + phase2
 *     screenshots, character + scene images, clips, stitched MP4.
 *
 * Does NOT delete the per-storySlug storyline cache or Flow TV gallery
 * tiles — those are keyed by storySlug, not runId, and may be shared by
 * recurring-character / refresh flows.
 *
 * Caller is expected to have verified userId ownership before calling.
 * Returns `true` if the state file was found + deleted.
 */
export async function deleteRun(runId: string): Promise<boolean> {
  // Best-effort cancel any pending advance job in BullMQ. Importing inside
  // the function avoids pulling the queue into module-load time for
  // read-only callers (listRuns / loadRun).
  try {
    const { getFlowTvRunQueue } = await import("@/services/queue");
    const queue = getFlowTvRunQueue();
    const job = await queue.getJob(`advance-${runId}`);
    if (job) {
      await job.remove();
      log.log(`[run ${runId}] removed pending advance job`);
    }
  } catch (e) {
    log.warn(`[run ${runId}] could not check/remove BullMQ job: ${(e as Error).message}`);
  }

  const stateFile = runStateFile(runId);
  const stateExisted = fsSync.existsSync(stateFile);
  if (stateExisted) {
    try {
      await fs.unlink(stateFile);
    } catch (e) {
      log.warn(`[run ${runId}] could not delete state file ${stateFile}: ${(e as Error).message}`);
    }
  }

  // Wipe the per-run output dir (idempotent — fs.rm ignores ENOENT).
  const runDir = path.join(RUNS_DIR, runId);
  try {
    await fs.rm(runDir, { recursive: true, force: true });
  } catch (e) {
    log.warn(`[run ${runId}] could not remove run dir ${runDir}: ${(e as Error).message}`);
  }

  log.log(`[run ${runId}] deleted (stateExisted=${stateExisted})`);
  return stateExisted;
}

function appendEvent(run: FlowRun, message: string, level: RunEvent["level"] = "info"): void {
  run.events.push({ ts: Date.now(), stage: run.stage, message, level });
  if (run.events.length > 200) run.events.splice(0, run.events.length - 200);
  run.lastMessage = message;
  run.stageUpdatedAt = Date.now();
}

function setStage(run: FlowRun, stage: RunStage, message: string): void {
  run.stage = stage;
  run.stageStartedAt = Date.now();
  appendEvent(run, message, "info");
}

// ──────────────────────────────────────────────────────────────────────────────
//  Create / kick-off
// ──────────────────────────────────────────────────────────────────────────────

export interface CreateRunOpts {
  userId: string;
  niche?: FlowNiche;
  imageCount?: number;
  veoVariant?: VeoVariant;
  approvalMode?: ApprovalMode;
  storyTitleHint?: string;
  triggerSource?: string;
  language?: FlowLanguage;
  characterStyle?: FlowCharacterStyle;
  aspectRatio?: FlowAspectRatio;
  dialogue?: boolean;
  bgm?: boolean;
  sfx?: boolean;
  subtitles?: boolean;
  useRecurringCharacter?: boolean;
  reuseCharacterId?: string;
  storylineSource?: FlowStorylineSource;
  /**
   * If set, the resulting Video is attributed to this specific Automation row
   * at finalize time (used by the multi-slot Flow TV scheduler). Falls back
   * to the legacy "ensure singleton" path when undefined.
   */
  automationId?: string;
}

export async function createRun(opts: CreateRunOpts): Promise<FlowRun> {
  const id = randomUUID();
  const imageCount = Math.max(2, Math.min(opts.imageCount ?? 3, 12));
  const clipCount = imageCount - 1;
  const runDir = path.join(RUNS_DIR, id);
  const phase1RunDir = path.join(runDir, "phase1");
  const phase2RunDir = path.join(runDir, "phase2");
  await fs.mkdir(phase1RunDir, { recursive: true });
  await fs.mkdir(phase2RunDir, { recursive: true });

  const niche = opts.niche ?? "funny";
  const language = opts.language ?? "hindi";
  const characterStyle = opts.characterStyle ?? "hyperreal_3d";
  const aspectRatio = opts.aspectRatio ?? "9:16";
  const dialogue = opts.dialogue ?? true;
  const bgm = opts.bgm ?? true;
  const sfx = opts.sfx ?? true;
  const subtitles = opts.subtitles ?? false;
  const useRecurringCharacter = opts.useRecurringCharacter ?? false;
  const reuseCharacterId = opts.reuseCharacterId?.trim() || undefined;
  const storylineSource = opts.storylineSource ?? "web";
  const approvalMode = opts.approvalMode ?? "storyline+images+clips";

  const now = Date.now();
  const run: FlowRun = {
    id,
    createdAt: now,
    updatedAt: now,
    userId: opts.userId,
    niche,
    triggerSource: opts.triggerSource ?? "ui",
    imageCount,
    clipCount,
    veoVariant: opts.veoVariant ?? "Lite",
    approvalMode,
    storyTitleHint: opts.storyTitleHint,
    language,
    characterStyle,
    aspectRatio,
    dialogue,
    bgm,
    sfx,
    subtitles,
    useRecurringCharacter,
    reuseCharacterId,
    storylineSource,
    automationId: opts.automationId,
    runDir,
    phase1RunDir,
    phase2RunDir,
    stage: "queued",
    stageStartedAt: now,
    stageUpdatedAt: now,
    lastMessage: "Run created — waiting for worker.",
    events: [
      {
        ts: now,
        stage: "queued",
        message: `Run created: niche=${niche} lang=${language} style=${characterStyle} ratio=${aspectRatio} ${imageCount} images / ${clipCount} clips / ${approvalMode}`,
        level: "info",
      },
    ],
  };
  await saveRun(run);
  log.log(
    `[run ${id}] created niche=${niche} lang=${language} ratio=${aspectRatio} mode=${approvalMode} images=${imageCount}`,
  );
  return run;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Stage transitions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Burn romanized subtitles on top of the stitched final MP4 if the run has
 * subtitles=true AND dialogue=true (no point burning empty captions). Returns
 * the new `finalVideoPath` to use, or the original if no burn happened.
 */
async function maybeBurnSubtitles(run: FlowRun): Promise<string> {
  if (!run.finalVideoPath || !run.clipPaths || !run.storyline) {
    return run.finalVideoPath ?? "";
  }
  if (!run.subtitles || !run.dialogue) return run.finalVideoPath;

  try {
    const { burnSubtitles } = await import("@/services/flow-tv-subtitles");
    const subbed = await burnSubtitles({
      finalMp4Path: run.finalVideoPath,
      runDir: run.phase2RunDir,
      clipPaths: run.clipPaths,
      storyline: run.storyline,
    });
    if (subbed) {
      appendEvent(run, `Subtitles burned in → ${path.basename(subbed)}`);
      return subbed;
    }
    appendEvent(
      run,
      "Subtitles burn skipped (no romanized dialogue available on any clip).",
      "warn",
    );
    return run.finalVideoPath;
  } catch (e) {
    // Don't fail the whole run on a subtitles failure; log the warning and
    // fall back to the un-subbed mp4. The user can re-stitch manually if
    // they want subtitles after-the-fact.
    appendEvent(
      run,
      `Subtitles burn FAILED: ${(e as Error).message.slice(0, 200)}; using un-subbed video`,
      "warn",
    );
    return run.finalVideoPath;
  }
}

/**
 * Recurring-character resolver. Searches prior runs (most recent first) for
 * one that matches the current run's niche+language+characterStyle and that
 * has a usable character image on disk. Returns the source character image
 * path (or null), and stamps `run.adoptedFromRunId` so the adoption is
 * traceable. Caller is expected to pass the returned path into
 * `runPhase1({ adoptedCharacterPath })`.
 */
async function tryAdoptRecurringCharacter(run: FlowRun): Promise<string | null> {
  const candidates = await listRuns({ userId: run.userId, limit: 50 });
  for (const c of candidates) {
    if (c.id === run.id) continue;
    if (c.stage !== "done") continue;
    if (c.niche !== run.niche) continue;
    if (c.language !== run.language) continue;
    if (c.characterStyle !== run.characterStyle) continue;
    if (!c.characterPath) continue;
    if (!fsSync.existsSync(c.characterPath)) continue;
    run.adoptedFromRunId = c.id;
    log.log(
      `[run ${run.id}] adopting character from prior run ${c.id} (${c.storyline?.title ?? "?"})`,
    );
    return c.characterPath;
  }
  log.warn(
    `[run ${run.id}] useRecurringCharacter=true but no prior done run matches niche=${run.niche} lang=${run.language} style=${run.characterStyle}; falling back to fresh generation.`,
  );
  return null;
}

function gateRequired(run: FlowRun, gate: "storyline" | "images" | "clips"): boolean {
  switch (run.approvalMode) {
    case "auto":
      return false;
    case "storyline":
      return gate === "storyline";
    case "storyline+images":
      return gate === "storyline" || gate === "images";
    case "storyline+images+clips":
      return true;
  }
}

/**
 * Run the next stage of the run-machine. May execute multiple stages in
 * sequence (when no gate forces a pause). Returns the updated run.
 *
 * Idempotent w.r.t. already-completed stages: re-invoking on a `done` run is
 * a no-op; re-invoking after an `error` retries the failed stage.
 */
export async function advanceRun(runId: string): Promise<FlowRun> {
  let run = await loadRun(runId);
  if (!run) throw new Error(`advanceRun: no run ${runId}`);

  log.log(`[run ${runId}] advance from stage=${run.stage}`);

  // Loop through stages until we hit a gate, finish, or error.
  // Each iteration advances by exactly one stage.
  for (let safety = 0; safety < 10; safety++) {
    if (run.stage === "done" || run.stage === "error") return run;

    try {
      run = await stepOnce(run);
      run = await saveRun(run);
      // Stop on gate or terminal stages.
      if (
        run.stage === "awaiting_storyline_approval" ||
        run.stage === "awaiting_images_approval" ||
        run.stage === "awaiting_clips_approval" ||
        run.stage === "done" ||
        run.stage === "error"
      ) {
        return run;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`[run ${runId}] stage=${run.stage} failed: ${msg}`);
      // Friendly summary for the most common transient — Gemini overloaded.
      // We already retried internally; if we still got here, all retries +
      // fallback model failed.
      const friendly = /UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED|503|429/i.test(
        msg,
      )
        ? "Gemini is currently overloaded after retries. Click Retry in a few minutes — or set GEMINI_FALLBACK_MODEL in .env to bypass."
        : msg;
      run.error = friendly;
      run.stage = "error";
      appendEvent(run, `Stage failed: ${friendly}`, "error");
      await saveRun(run);
      return run;
    }
  }
  // Safety break: shouldn't happen, but log it.
  log.warn(`[run ${runId}] advance hit safety break at stage=${run.stage}`);
  return run;
}

async function stepOnce(run: FlowRun): Promise<FlowRun> {
  switch (run.stage) {
    case "queued":
      setStage(run, "generating_storyline", "Generating storyline with Gemini");
      return run;

    case "generating_storyline": {
      // Generate (or retrieve cached) storyline; once we have it, derive the
      // storySlug and persist it to the per-slug cache.
      const variety = await buildVarietyHintsForNiche(run.niche, 6);
      if (variety.avoidArchetypes.length > 0 || variety.bannedCategories.length > 0) {
        appendEvent(
          run,
          `Variety hint: avoiding ${variety.avoidArchetypes.length} prior protagonist(s) and ${variety.avoidTitles.length} title(s); banned categories: [${variety.bannedCategories.join(", ") || "none"}]`,
        );
      }
      const opts = {
        imageCount: run.imageCount,
        niche: run.niche,
        language: run.language,
        characterStyle: run.characterStyle,
        aspectRatio: run.aspectRatio,
        dialogue: run.dialogue,
        bgm: run.bgm,
        sfx: run.sfx,
        avoidTitles: variety.avoidTitles.length > 0 ? variety.avoidTitles : undefined,
        avoidArchetypes:
          variety.avoidArchetypes.length > 0 ? variety.avoidArchetypes : undefined,
        bannedCategories:
          variety.bannedCategories.length > 0 ? variety.bannedCategories : undefined,
        storyTitleHint: run.storyTitleHint,
      };
      let partial: Awaited<ReturnType<typeof generateStorylineWithGemini>>;
      if (run.storylineSource === "web") {
        const { generateStorylineViaWeb } = await import(
          "@/services/flow-tv-gemini-web"
        );
        appendEvent(
          run,
          "Driving gemini.google.com/app for storyline (Gemini 3 Fast)…",
        );
        // No silent API fallback: the user explicitly chose the web source
        // (usually because the API is 503'ing). If the web path fails, surface
        // it directly so the user can either retry, fix login, or switch
        // source from the UI.
        const res = await generateStorylineViaWeb(opts);
        partial = res.partial;
        if (res.modelUsed) {
          appendEvent(run, `Web Gemini model used: ${res.modelUsed}`);
        }
      } else {
        partial = await generateStorylineWithGemini(opts);
      }
      // If the user provided a hint and Gemini's title is blank-ish, prefer
      // the hint. Otherwise trust Gemini.
      const title = partial.title || run.storyTitleHint || "Untitled Story";
      const storyline: Storyline = {
        ...partial,
        title,
        imageCount: run.imageCount,
        generatedAt: Date.now(),
      };
      const storySlug = dateSuffixedSlug(storyline.title);
      const projectName = flowProjectNameFromStorySlug(storySlug);
      await saveStorylineCache(storySlug, storyline);
      run.storySlug = storySlug;
      run.projectName = projectName;
      run.storyline = storyline;
      appendEvent(
        run,
        `Storyline ready: "${storyline.title}" (${storyline.imagePrompts.length} scenes) — slug=${storySlug}`,
      );

      if (gateRequired(run, "storyline")) {
        setStage(run, "awaiting_storyline_approval", "Awaiting storyline approval");
      } else {
        setStage(run, "generating_images", "Generating character + scene images");
      }
      return run;
    }

    case "awaiting_storyline_approval":
      // Caller (API) flips this stage forward via approveStoryline().
      return run;

    case "generating_images": {
      if (!run.storySlug || !run.projectName || !run.storyline) {
        throw new Error("generating_images: missing storySlug/projectName/storyline");
      }

      // 1) Library-picked reuse takes precedence: if the user explicitly chose
      //    a saved character from the dashboard library, copy that file in
      //    AND override storyline.characterPrompt with the saved prompt so
      //    every scene's reference matches.
      let adoptedCharacterPath: string | null = null;
      if (run.reuseCharacterId) {
        try {
          const { loadFlowTvCharacter } = await import(
            "@/services/flow-tv-character-library"
          );
          const saved = await loadFlowTvCharacter(
            run.reuseCharacterId,
            run.userId,
          );
          if (saved?.absolutePath) {
            adoptedCharacterPath = saved.absolutePath;
            run.adoptedFromRunId = `lib:${saved.id}`;
            run.storyline.characterPrompt = saved.fullPrompt;
            appendEvent(
              run,
              `Reusing character "${saved.name}" from library (id=${saved.id.slice(0, 8)}…); overriding characterPrompt.`,
            );
          } else {
            appendEvent(
              run,
              `reuseCharacterId=${run.reuseCharacterId} not found / no preview on disk; falling back to fresh generation.`,
              "warn",
            );
          }
        } catch (e) {
          appendEvent(
            run,
            `Library lookup failed (${(e as Error).message?.slice(0, 120)}); falling back to fresh generation.`,
            "warn",
          );
        }
      }

      // 2) If recurring-character (auto-pick prior run) is on AND no library
      //    pick, use that heuristic.
      if (!adoptedCharacterPath && run.useRecurringCharacter) {
        adoptedCharacterPath = await tryAdoptRecurringCharacter(run);
        if (adoptedCharacterPath) {
          appendEvent(
            run,
            `Recurring character adopted from run ${run.adoptedFromRunId} → ${path.basename(adoptedCharacterPath)}`,
          );
        }
      }

      const result = await runPhase1({
        imageCount: run.imageCount,
        storySlug: run.storySlug,
        projectName: run.projectName,
        runDir: run.phase1RunDir,
        aspectRatio: run.aspectRatio,
        storyline: run.storyline,
        adoptedCharacterPath: adoptedCharacterPath ?? undefined,
      });
      if (result.status !== "done") {
        throw new Error(result.error ?? result.message ?? "Phase 1 failed");
      }
      run.characterPath = result.characterPath;
      run.imagePaths = result.imagePaths;
      appendEvent(
        run,
        `Phase 1 complete: ${result.imagePaths.length} scene images + character`,
      );

      // Register the freshly-rendered character into the library — but only
      // if it's a NEW one (the run didn't reuse from the library / a prior
      // run). Best-effort; failures are logged inside the helper and we
      // never abort the run on a registry write.
      if (
        result.characterPath &&
        !run.reuseCharacterId &&
        !run.adoptedFromRunId &&
        run.storyline?.characterPrompt
      ) {
        try {
          const { registerFlowTvCharacter } = await import(
            "@/services/flow-tv-character-library"
          );
          await registerFlowTvCharacter({
            userId: run.userId,
            characterPath: result.characterPath,
            name: run.storyline.title || "Untitled character",
            fullPrompt: run.storyline.characterPrompt,
            niche: run.niche,
            language: run.language,
            characterStyle: run.characterStyle,
          });
        } catch (e) {
          appendEvent(
            run,
            `Library registration failed (non-fatal): ${(e as Error).message?.slice(0, 120)}`,
            "warn",
          );
        }
      }
      if (gateRequired(run, "images")) {
        setStage(run, "awaiting_images_approval", "Awaiting images approval");
      } else {
        setStage(run, "generating_clips", "Generating Veo clips");
      }
      return run;
    }

    case "awaiting_images_approval":
      return run;

    case "generating_clips": {
      if (!run.storySlug || !run.projectName) {
        throw new Error("generating_clips: missing storySlug/projectName");
      }
      const result = await runPhase2({
        storySlug: run.storySlug,
        projectName: run.projectName,
        clipCount: run.clipCount,
        veoVariant: run.veoVariant,
        sourceRunDir: run.phase1RunDir,
        runDir: run.phase2RunDir,
        aspectRatio: run.aspectRatio,
        dialogue: run.dialogue,
        bgm: run.bgm,
        sfx: run.sfx,
        language: run.language,
      });
      if (result.status !== "done") {
        throw new Error(result.error ?? result.message ?? "Phase 2 failed");
      }
      run.clipPaths = result.clipPaths;
      run.finalVideoPath = result.finalVideoPath;
      appendEvent(run, `Phase 2 complete: ${result.clipPaths.length} clips, final stitched`);
      // Burn subtitles before the clips-approval gate so the user reviews
      // the final mp4 with subtitles already in place.
      run.finalVideoPath = await maybeBurnSubtitles(run);
      if (gateRequired(run, "clips")) {
        setStage(run, "awaiting_clips_approval", "Awaiting clips approval (final video ready)");
      } else {
        setStage(run, "finalizing", "Finalizing — creating Video row + scheduling posts");
      }
      return run;
    }

    case "awaiting_clips_approval":
      return run;

    case "stitching": {
      // Phase 2 already stitches as part of runPhase2; this stage exists only
      // for the rare path where the user refreshed clip(s) at the gate and
      // the final needs re-stitching. We re-stitch using the registered
      // clipPaths.
      if (!run.storySlug || !run.storyline || !run.clipPaths) {
        throw new Error("stitching: missing storySlug/storyline/clipPaths");
      }
      const finalPath = await stitchPhase2Clips({
        storySlug: run.storySlug,
        storyline: run.storyline,
        runDir: run.phase2RunDir,
        clipPaths: run.clipPaths,
      });
      run.finalVideoPath = finalPath;
      appendEvent(run, `Re-stitched final video → ${path.basename(finalPath)}`);
      // Re-burn subtitles too — the new clip set may have different dialogue.
      run.finalVideoPath = await maybeBurnSubtitles(run);
      setStage(run, "finalizing", "Finalizing — creating Video row + scheduling posts");
      return run;
    }

    case "finalizing": {
      if (!run.storyline || !run.storySlug || !run.finalVideoPath) {
        throw new Error("finalizing: missing storyline/storySlug/finalVideoPath");
      }
      const { finalizeFlowRun } = await import("@/services/flow-tv-finalize");
      const { videoId } = await finalizeFlowRun(run);
      run.videoId = videoId;
      appendEvent(run, `Video row created: ${videoId} — scheduled to platforms`);
      setStage(run, "done", "Run complete");
      return run;
    }

    default:
      return run;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  User actions on gated stages
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Apply storyline edits AT the storyline-approval gate. Title, logline, and
 * characterPrompt are editable; image prompts are read-only (a storyline
 * refresh re-generates the whole thing).
 */
export async function editStoryline(
  runId: string,
  patch: { title?: string; logline?: string; characterPrompt?: string },
): Promise<FlowRun> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`editStoryline: no run ${runId}`);
  if (run.stage !== "awaiting_storyline_approval") {
    throw new Error(`editStoryline: run is ${run.stage}, expected awaiting_storyline_approval`);
  }
  if (!run.storyline || !run.storySlug) {
    throw new Error("editStoryline: missing storyline");
  }
  if (patch.title !== undefined) run.storyline.title = patch.title;
  if (patch.logline !== undefined) run.storyline.logline = patch.logline;
  if (patch.characterPrompt !== undefined) run.storyline.characterPrompt = patch.characterPrompt;
  await saveStorylineCache(run.storySlug, run.storyline);
  appendEvent(run, "Storyline edited at approval gate");
  return saveRun(run);
}

/** Discard the storyline and re-roll. */
export async function refreshStoryline(runId: string): Promise<FlowRun> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`refreshStoryline: no run ${runId}`);
  if (run.stage !== "awaiting_storyline_approval") {
    throw new Error(`refreshStoryline: run is ${run.stage}, expected awaiting_storyline_approval`);
  }
  // Clear cache for the OLD slug so a fresh title doesn't collide.
  if (run.storySlug) {
    await resetPhase1Cache({ storySlug: run.storySlug, storyline: true });
  }
  const oldTitle = run.storyline?.title;
  const oldProtagonist = run.storyline?.protagonist?.trim();
  const oldCharacterPrompt = run.storyline?.characterPrompt?.trim();
  const variety = await buildVarietyHintsForNiche(run.niche, 6);
  const avoidTitlesSet = new Set<string>(variety.avoidTitles);
  if (oldTitle) avoidTitlesSet.add(oldTitle);
  const avoidArchetypesSet = new Set<string>(variety.avoidArchetypes);
  if (oldProtagonist) avoidArchetypesSet.add(oldProtagonist);

  // Make sure we ban the just-rejected protagonist's category too — that's
  // usually why the user pressed "refresh" in the first place.
  const bannedCategoriesSet = new Set<string>(variety.bannedCategories);
  for (const text of [oldProtagonist, oldCharacterPrompt]) {
    if (!text) continue;
    const cat = classifyProtagonist(text);
    if (cat) bannedCategoriesSet.add(cat);
  }

  const opts = {
    imageCount: run.imageCount,
    niche: run.niche,
    language: run.language,
    characterStyle: run.characterStyle,
    aspectRatio: run.aspectRatio,
    dialogue: run.dialogue,
    bgm: run.bgm,
    sfx: run.sfx,
    avoidTitles:
      avoidTitlesSet.size > 0 ? Array.from(avoidTitlesSet) : undefined,
    avoidArchetypes:
      avoidArchetypesSet.size > 0 ? Array.from(avoidArchetypesSet) : undefined,
    bannedCategories:
      bannedCategoriesSet.size > 0 ? Array.from(bannedCategoriesSet) : undefined,
    storyTitleHint: run.storyTitleHint,
  };
  let partial: Awaited<ReturnType<typeof generateStorylineWithGemini>>;
  if (run.storylineSource === "web") {
    const { generateStorylineViaWeb } = await import(
      "@/services/flow-tv-gemini-web"
    );
    const res = await generateStorylineViaWeb(opts);
    partial = res.partial;
  } else {
    partial = await generateStorylineWithGemini(opts);
  }
  const storyline: Storyline = {
    ...partial,
    title: partial.title,
    imageCount: run.imageCount,
    generatedAt: Date.now(),
  };
  const storySlug = dateSuffixedSlug(storyline.title);
  const projectName = flowProjectNameFromStorySlug(storySlug);
  await saveStorylineCache(storySlug, storyline);
  run.storySlug = storySlug;
  run.projectName = projectName;
  run.storyline = storyline;
  appendEvent(run, `Storyline refreshed: "${storyline.title}" — slug=${storySlug}`);
  return saveRun(run);
}

/**
 * Approve the storyline → advance to image generation.
 *
 * Note: this only transitions the stage and persists. The caller is expected
 * to enqueue an advance job (so heavy browser work runs in the worker, not
 * inside the API request).
 */
export async function approveStoryline(runId: string): Promise<FlowRun> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`approveStoryline: no run ${runId}`);
  if (run.stage !== "awaiting_storyline_approval") {
    throw new Error(`approveStoryline: run is ${run.stage}`);
  }
  setStage(run, "generating_images", "Storyline approved — generating images");
  return saveRun(run);
}

/** Approve the image set → advance to clip generation. */
export async function approveImages(runId: string): Promise<FlowRun> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`approveImages: no run ${runId}`);
  if (run.stage !== "awaiting_images_approval") {
    throw new Error(`approveImages: run is ${run.stage}`);
  }
  setStage(run, "generating_clips", "Images approved — generating clips");
  return saveRun(run);
}

/**
 * Refresh (re-render) ONE Phase-1 asset at the images gate. After this call
 * the run is still in `awaiting_images_approval`.
 */
export async function refreshImage(opts: {
  runId: string;
  kind: "character" | "image";
  index: number;
}): Promise<FlowRun> {
  const run = await loadRun(opts.runId);
  if (!run) throw new Error(`refreshImage: no run ${opts.runId}`);
  if (run.stage !== "awaiting_images_approval") {
    throw new Error(`refreshImage: run is ${run.stage}, expected awaiting_images_approval`);
  }
  if (!run.storyline || !run.storySlug || !run.projectName) {
    throw new Error("refreshImage: missing storyline/storySlug/projectName");
  }
  const newPath = await regeneratePhase1Asset({
    storySlug: run.storySlug,
    projectName: run.projectName,
    storyline: run.storyline,
    kind: opts.kind,
    index: opts.index,
    runDir: run.phase1RunDir,
    aspectRatio: run.aspectRatio,
  });
  if (opts.kind === "character") {
    run.characterPath = newPath;
  } else {
    run.imagePaths ??= [];
    // Keep the existing list ordered by index; replace the matching entry.
    const expectedFn = buildAssetName({
      storyTitle: run.storyline.title,
      storySlug: run.storySlug,
      kind: "image",
      index: opts.index,
      sceneSlug: run.storyline.imagePrompts[opts.index - 1].title,
      ext: "png",
    }).filename;
    const existing = run.imagePaths.find((p) => path.basename(p) === expectedFn);
    if (existing) {
      // path is the same since we wrote to runDir; nothing to swap.
    } else {
      run.imagePaths.push(newPath);
    }
  }
  appendEvent(run, `Refreshed ${opts.kind} ${opts.index}`);
  return saveRun(run);
}

/** Approve the clip set → advance to stitch + finalize. */
export async function approveClips(runId: string): Promise<FlowRun> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`approveClips: no run ${runId}`);
  if (run.stage !== "awaiting_clips_approval") {
    throw new Error(`approveClips: run is ${run.stage}`);
  }
  // If runPhase2 already stitched, jump straight to finalizing. Otherwise
  // we may need to re-stitch (e.g. user refreshed clips after Phase 2).
  if (run.finalVideoPath && fsSync.existsSync(run.finalVideoPath)) {
    setStage(run, "finalizing", "Clips approved — finalizing");
  } else {
    setStage(run, "stitching", "Clips approved — re-stitching final video");
  }
  return saveRun(run);
}

/**
 * Refresh ONE Phase-2 clip at the clips gate. Run stays in
 * `awaiting_clips_approval` after.
 */
export async function refreshClip(opts: {
  runId: string;
  index: number;
}): Promise<FlowRun> {
  const run = await loadRun(opts.runId);
  if (!run) throw new Error(`refreshClip: no run ${opts.runId}`);
  if (run.stage !== "awaiting_clips_approval") {
    throw new Error(`refreshClip: run is ${run.stage}, expected awaiting_clips_approval`);
  }
  if (!run.storySlug || !run.projectName) {
    throw new Error("refreshClip: missing storySlug/projectName");
  }
  const newPath = await regeneratePhase2Clip({
    storySlug: run.storySlug,
    projectName: run.projectName,
    phase1RunDir: run.phase1RunDir,
    runDir: run.phase2RunDir,
    index: opts.index,
    veoVariant: run.veoVariant,
    aspectRatio: run.aspectRatio,
    dialogue: run.dialogue,
    bgm: run.bgm,
    sfx: run.sfx,
    language: run.language,
  });
  run.clipPaths ??= [];
  // Replace the entry at index opts.index-1 if present, else append.
  const idx = opts.index - 1;
  if (idx < run.clipPaths.length) {
    run.clipPaths[idx] = newPath;
  } else {
    run.clipPaths.push(newPath);
  }
  // Invalidate the final video — it must be re-stitched on approval.
  run.finalVideoPath = undefined;
  appendEvent(run, `Refreshed clip ${opts.index} — final video will be re-stitched on approval`);
  return saveRun(run);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Cancellation
// ──────────────────────────────────────────────────────────────────────────────

export async function cancelRun(runId: string, reason?: string): Promise<FlowRun> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`cancelRun: no run ${runId}`);
  if (run.stage === "done" || run.stage === "error") return run;
  run.stage = "error";
  run.error = reason ?? "Cancelled by user";
  appendEvent(run, run.error, "warn");
  return saveRun(run);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Retry (recover a failed run)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Recover a run that's stuck in `error`. We replay the last in-flight stage
 * (the one that was running when the failure occurred) by walking the events
 * backwards to find the last non-error stage, then re-enqueueing advance.
 *
 * Caller is responsible for enqueueing `enqueueFlowTvAdvance(runId)` after.
 */
export async function retryRun(runId: string): Promise<FlowRun> {
  const run = await loadRun(runId);
  if (!run) throw new Error(`retryRun: no run ${runId}`);
  if (run.stage !== "error") {
    throw new Error(`retryRun: run is not in error state (stage=${run.stage})`);
  }

  // Walk events backward to find the last stage that was in flight before
  // the error. Skip the final `error` event.
  let resumeStage: RunStage | null = null;
  for (let i = run.events.length - 1; i >= 0; i--) {
    const ev = run.events[i];
    if (ev.stage === "error") continue;
    resumeStage = ev.stage;
    break;
  }
  if (!resumeStage) resumeStage = "queued";

  run.stage = resumeStage;
  run.error = undefined;
  appendEvent(run, `Retrying from stage=${resumeStage}`, "info");
  return saveRun(run);
}

// Re-export storyline loader for the API surface.
export { loadStorylineCache };
