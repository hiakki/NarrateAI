// Canonical asset naming + cross-run registry for Flow TV.
//
// Naming convention (mandatory — every asset, local file AND Flow project
// item, follows this format):
//
//     <story-slug>-<kind>-<NN>[-<scene-slug>].<ext>
//
//   kind ∈ "character" | "image" | "video" | "final"
//   NN   = 2-digit zero-padded index (01, 02, 03, …)
//   scene-slug, where used:
//     - image-NN  → the scene title slug         (e.g. "rainy-underpass-sketch")
//     - video-NN  → "<startSceneSlug>-to-<endSceneSlug>"
//     - character → no scene slug (one per story)
//     - final     → no scene slug
//
// Examples:
//   the-discovered-sketchbook-character-01.png
//   the-discovered-sketchbook-image-01-rainy-underpass-sketch.png
//   the-discovered-sketchbook-video-01-rainy-underpass-sketch-to-gallery-curator-discovery.mp4
//   the-discovered-sketchbook-final.mp4
//
// Reasoning: anchoring every asset on the story slug makes deduplication
// trivial (cross-run, cross-product) and prevents Phase 2 from ever
// re-submitting a Veo render whose result we already have on disk or whose
// URL we already captured.
//
// The registry (`asset-registry.json`) lives alongside the runs/ dir and
// records, for each (storySlug, kind, index, sceneSlug) tuple:
//   - the canonical filename
//   - the local absolute path (if downloaded)
//   - the Flow asset URL we captured (if any)
//   - the Flow project URL (helps locate the project later)
//   - createdAt timestamp
//
// Phase 1 + Phase 2 both consult this registry before generating: if a usable
// local file exists, skip; if a cached Flow URL exists, attempt to download
// it (via the live page's in-page fetch) before falling back to a fresh
// (credit-burning) generation.

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

export const FLOW_DATA_DIR = path.join(process.cwd(), "data", "flow-tv");
export const REGISTRY_FILE = path.join(FLOW_DATA_DIR, "asset-registry.json");

export type AssetKind = "character" | "image" | "video" | "final";

export interface CanonicalName {
  filename: string; // local file basename (with extension)
  flowDisplayName: string; // human-friendly name to set in Flow's UI
  registryKey: string; // unique key inside asset-registry.json
  storySlug: string;
  kind: AssetKind;
  index: number; // 1-based; 0 for "final"
  sceneSlug?: string;
  ext: "png" | "mp4";
}

export interface AssetRecord {
  storySlug: string;
  kind: AssetKind;
  index: number;
  sceneSlug?: string;
  filename: string;
  flowDisplayName: string;
  localPath?: string; // absolute path on disk if downloaded
  flowUrl?: string; // last-known Flow CDN/redirect URL
  flowAssetId?: string; // the UUID inside Flow's URL, when known
  flowProjectUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RegistryFile {
  version: 1;
  stories: Record<string, Record<string, AssetRecord>>;
  // urlGraveyard tracks Veo URLs we generated but couldn't download (e.g. the
  // run was killed mid-flight). On the next run we attempt these first to
  // avoid burning Veo credits a second time.
  urlGraveyard: Record<string, string[]>; // registryKey → [url, url, …]
}

// ──────────────────────────────────────────────────────────────────────────────
//  Slugging
// ──────────────────────────────────────────────────────────────────────────────

export function slug(s: string, maxLen = 60): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
}

// Date-suffixed slug used to isolate every Flow TV video into its own
// project + asset namespace. Format: `<title-slug>-DDMMYYYY`. We avoid the
// hour/minute parts on purpose — two videos created the same day share one
// project, which is fine for the human reading Flow's project list.
export function dateSuffixedSlug(storyTitle: string, when: Date = new Date()): string {
  const dd = String(when.getDate()).padStart(2, "0");
  const mm = String(when.getMonth() + 1).padStart(2, "0");
  const yyyy = String(when.getFullYear());
  const base = slug(storyTitle, 50) || "untitled";
  return `${base}-${dd}${mm}${yyyy}`;
}

// Project name shown in Flow's UI (project list). Kept identical to the
// storySlug so the project is greppable by the same key we use in registry +
// cache filenames.
export function flowProjectNameFromStorySlug(storySlug: string): string {
  return storySlug;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Canonical name builder
// ──────────────────────────────────────────────────────────────────────────────

export interface BuildNameOpts {
  storyTitle: string;
  /**
   * Override the slug used in filenames + registry key. When omitted, derived
   * from storyTitle (legacy behavior). NEW Flow TV runs ALWAYS pass this with
   * a date suffix (`<title-slug>-DDMMYYYY`) so each video has its own
   * isolated namespace and re-running the same story on a different day
   * doesn't collide with previously-saved assets.
   */
  storySlug?: string;
  kind: AssetKind;
  index?: number; // required for character/image/video; ignored for "final"
  sceneSlug?: string; // for image: scene title slug; for video: "<start>-to-<end>"
  ext: "png" | "mp4";
}

export function buildAssetName(opts: BuildNameOpts): CanonicalName {
  const storySlug = opts.storySlug ?? (slug(opts.storyTitle, 50) || "untitled");
  const idxNum = opts.kind === "final" ? 0 : opts.index ?? 1;
  const idxStr = opts.kind === "final" ? "" : String(idxNum).padStart(2, "0");
  const sceneSlug = opts.sceneSlug ? slug(opts.sceneSlug, 80) : undefined;

  const parts: string[] = [storySlug, opts.kind];
  if (idxStr) parts.push(idxStr);
  if (sceneSlug) parts.push(sceneSlug);
  const baseNoExt = parts.join("-");
  const filename = `${baseNoExt}.${opts.ext}`;

  // Display name uses spaces + Title Case for the kind, keeps the scene slug
  // as words. Story title is preserved as the user wrote it.
  const titleCase = (s: string) =>
    s.replace(/(^|-)(\w)/g, (_m, b: string, c: string) => `${b ? " " : ""}${c.toUpperCase()}`);
  const kindLabel = opts.kind.charAt(0).toUpperCase() + opts.kind.slice(1);
  const displayParts: string[] = [opts.storyTitle.trim() || "Untitled Story"];
  displayParts.push(idxStr ? `${kindLabel} ${idxStr}` : kindLabel);
  if (sceneSlug) displayParts.push(titleCase(sceneSlug));

  const registryKey = idxStr
    ? sceneSlug
      ? `${opts.kind}-${idxStr}-${sceneSlug}`
      : `${opts.kind}-${idxStr}`
    : opts.kind;

  return {
    filename,
    flowDisplayName: displayParts.join(" — "),
    registryKey,
    storySlug,
    kind: opts.kind,
    index: idxNum,
    sceneSlug,
    ext: opts.ext,
  };
}

// Parse a legacy filename and return a canonical name so we can migrate older
// run dirs (`character-01-<slug>.png`, `image-NN-<slug>.png`) to the new
// convention.
export function reinterpretLegacyFilename(
  storyTitle: string,
  filename: string,
): CanonicalName | null {
  const ext = filename.endsWith(".png") ? "png" : filename.endsWith(".mp4") ? "mp4" : null;
  if (!ext) return null;
  const stem = filename.replace(/\.(png|mp4)$/i, "");

  // character-NN-<slug>
  const charMatch = stem.match(/^character-(\d{1,3})(?:-(.+))?$/);
  if (charMatch) {
    return buildAssetName({
      storyTitle,
      kind: "character",
      index: parseInt(charMatch[1], 10),
      // don't carry the protagonist slug into the canonical name: the
      // convention is "<story> - character NN" with no scene tail.
      ext,
    });
  }

  // image-NN-<sceneSlug>
  const imgMatch = stem.match(/^image-(\d{1,3})-(.+)$/);
  if (imgMatch) {
    return buildAssetName({
      storyTitle,
      kind: "image",
      index: parseInt(imgMatch[1], 10),
      sceneSlug: imgMatch[2],
      ext,
    });
  }

  // clip-NN-<startSlug>-to-<endSlug>
  const clipMatch = stem.match(/^clip-(\d{1,3})-(.+)$/);
  if (clipMatch) {
    return buildAssetName({
      storyTitle,
      kind: "video",
      index: parseInt(clipMatch[1], 10),
      sceneSlug: clipMatch[2],
      ext,
    });
  }

  // story-<slug> → final
  if (stem.startsWith("story-")) {
    return buildAssetName({ storyTitle, kind: "final", ext });
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Registry persistence
// ──────────────────────────────────────────────────────────────────────────────

async function ensureRegistryFile(): Promise<RegistryFile> {
  if (!fsSync.existsSync(REGISTRY_FILE)) {
    const empty: RegistryFile = { version: 1, stories: {}, urlGraveyard: {} };
    await fs.mkdir(path.dirname(REGISTRY_FILE), { recursive: true });
    await fs.writeFile(REGISTRY_FILE, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  const raw = await fs.readFile(REGISTRY_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw) as RegistryFile;
    parsed.stories ??= {};
    parsed.urlGraveyard ??= {};
    return parsed;
  } catch {
    const empty: RegistryFile = { version: 1, stories: {}, urlGraveyard: {} };
    await fs.writeFile(REGISTRY_FILE, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
}

export async function loadRegistry(): Promise<RegistryFile> {
  return ensureRegistryFile();
}

export async function saveRegistry(reg: RegistryFile): Promise<void> {
  await fs.mkdir(path.dirname(REGISTRY_FILE), { recursive: true });
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(reg, null, 2), "utf-8");
}

export async function lookupAsset(
  storySlug: string,
  registryKey: string,
): Promise<AssetRecord | null> {
  const reg = await loadRegistry();
  return reg.stories[storySlug]?.[registryKey] ?? null;
}

export async function recordAsset(record: Omit<AssetRecord, "createdAt" | "updatedAt"> & {
  createdAt?: number;
}): Promise<AssetRecord> {
  const reg = await loadRegistry();
  reg.stories[record.storySlug] ??= {};
  const key = canonicalRegistryKey(record);
  const now = Date.now();
  const existing = reg.stories[record.storySlug][key];
  const merged: AssetRecord = {
    ...existing,
    ...record,
    createdAt: existing?.createdAt ?? record.createdAt ?? now,
    updatedAt: now,
  };
  reg.stories[record.storySlug][key] = merged;
  await saveRegistry(reg);
  return merged;
}

export function canonicalRegistryKey(
  rec: { kind: AssetKind; index: number; sceneSlug?: string },
): string {
  const idxStr = rec.kind === "final" ? "" : String(rec.index).padStart(2, "0");
  if (!idxStr) return rec.kind;
  return rec.sceneSlug ? `${rec.kind}-${idxStr}-${rec.sceneSlug}` : `${rec.kind}-${idxStr}`;
}

// Add a Veo URL we generated but haven't downloaded yet. Phase 2 will attempt
// these on the next run (in reverse order — most-recent first) before
// resorting to a fresh credit-burning render.
export async function rememberOrphanedFlowUrl(
  storySlug: string,
  registryKey: string,
  url: string,
): Promise<void> {
  const reg = await loadRegistry();
  const id = `${storySlug}|${registryKey}`;
  const list = reg.urlGraveyard[id] ?? [];
  if (!list.includes(url)) list.push(url);
  reg.urlGraveyard[id] = list;
  await saveRegistry(reg);
}

export async function consumeOrphanedFlowUrls(
  storySlug: string,
  registryKey: string,
): Promise<string[]> {
  const reg = await loadRegistry();
  const id = `${storySlug}|${registryKey}`;
  return reg.urlGraveyard[id] ?? [];
}

export async function clearOrphanedFlowUrls(
  storySlug: string,
  registryKey: string,
): Promise<void> {
  const reg = await loadRegistry();
  const id = `${storySlug}|${registryKey}`;
  delete reg.urlGraveyard[id];
  await saveRegistry(reg);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Migration of legacy run dirs
// ──────────────────────────────────────────────────────────────────────────────

// Rename any legacy `character-NN-*.png`, `image-NN-*.png`, `clip-NN-*.mp4`,
// or `story-*.mp4` files in `runDir` to canonical names rooted on
// `storyTitle`. Returns the migration map for logging.
export async function migrateRunDir(
  runDir: string,
  storyTitle: string,
): Promise<Array<{ from: string; to: string; record: AssetRecord }>> {
  if (!fsSync.existsSync(runDir)) return [];
  const entries = await fs.readdir(runDir);
  const moves: Array<{ from: string; to: string; record: AssetRecord }> = [];
  for (const entry of entries) {
    const reinterpreted = reinterpretLegacyFilename(storyTitle, entry);
    if (!reinterpreted) continue;
    if (entry === reinterpreted.filename) continue;
    const fromPath = path.join(runDir, entry);
    const toPath = path.join(runDir, reinterpreted.filename);
    if (fsSync.existsSync(toPath)) {
      // Already migrated; keep the new file, drop the old to avoid drift.
      try {
        await fs.rm(fromPath, { force: true });
      } catch {
        // ignore
      }
      continue;
    }
    await fs.rename(fromPath, toPath);
    const record = await recordAsset({
      storySlug: reinterpreted.storySlug,
      kind: reinterpreted.kind,
      index: reinterpreted.index,
      sceneSlug: reinterpreted.sceneSlug,
      filename: reinterpreted.filename,
      flowDisplayName: reinterpreted.flowDisplayName,
      localPath: toPath,
    });
    moves.push({ from: entry, to: reinterpreted.filename, record });
  }
  return moves;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Lookup helpers exposed to Phase 1 / Phase 2 orchestrators
// ──────────────────────────────────────────────────────────────────────────────

// Return a usable local file path if the registered local copy still exists.
export async function findExistingLocalAsset(
  storySlug: string,
  registryKey: string,
): Promise<string | null> {
  const rec = await lookupAsset(storySlug, registryKey);
  if (!rec?.localPath) return null;
  if (!fsSync.existsSync(rec.localPath)) return null;
  return rec.localPath;
}
