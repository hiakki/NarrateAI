import fs from "fs/promises";
import path from "path";

const LOGS_ROOT = path.join(process.cwd(), "logs");
const SCHEDULER_LOGS_DIR = path.join(LOGS_ROOT, "_scheduler");
const MAX_AGE_DAYS = 30;
function safeName(s: string, maxLen = 80): string {
  return s
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, maxLen);
}

function ts(): string {
  const tz = process.env.LOG_TIMEZONE
    ?? process.env.BUILD_ALL_TIMEZONE
    ?? process.env.TZ
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  });
  const parts = fmt.formatToParts(d);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const tzPart = v("timeZoneName").replace(/^GMT/, "");
  const offset = tzPart === "" ? "+00:00" : tzPart;
  return `${v("year")}-${v("month")}-${v("day")} ${v("hour")}:${v("minute")}:${v("second")} ${offset}`;
}

function todayFile(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`;
}

export interface AutomationFileLogger {
  scheduler: (msg: string) => void;
  worker: (msg: string) => void;
  poster: (msg: string) => void;
}

/**
 * Build the directory path for a given automation's logs.
 * Exported so the API route can locate files.
 */
export function automationLogDir(
  userId: string,
  userName: string,
  automationId: string,
  automationName: string,
): string {
  const userDir = `${safeName(userName || "user")}-${userId}`;
  const autoDir = `${safeName(automationName || "automation")}-${automationId}`;
  return path.join(LOGS_ROOT, userDir, autoDir);
}

let dirCreated = new Set<string>();

async function appendLine(dir: string, tag: string, msg: string) {
  try {
    if (!dirCreated.has(dir)) {
      await fs.mkdir(dir, { recursive: true });
      dirCreated.add(dir);
    }
    const file = path.join(dir, todayFile());
    const line = `[${ts()}] [${tag}] ${msg}\n`;
    await fs.appendFile(file, line, "utf-8");
  } catch {
    // File logging must never crash the caller
  }
}

export function getAutomationFileLogger(
  userId: string,
  userName: string,
  automationId: string,
  automationName: string,
): AutomationFileLogger {
  const dir = automationLogDir(userId, userName, automationId, automationName);
  return {
    scheduler: (msg: string) => { appendLine(dir, "SCHEDULER", msg); },
    worker: (msg: string) => { appendLine(dir, "WORKER", msg); },
    poster: (msg: string) => { appendLine(dir, "POSTER", msg); },
  };
}

// ── Dedicated scheduler file logger ──

let schedulerDirCreated = false;

async function appendSchedulerLine(tag: string, msg: string) {
  try {
    if (!schedulerDirCreated) {
      await fs.mkdir(SCHEDULER_LOGS_DIR, { recursive: true });
      schedulerDirCreated = true;
    }
    const file = path.join(SCHEDULER_LOGS_DIR, todayFile());
    const line = `[${ts()}] [${tag}] ${msg}\n`;
    await fs.appendFile(file, line, "utf-8");
  } catch {
    // File logging must never crash the caller
  }
}

export interface SchedulerFileLogger {
  /** Logs a scheduler action: bootstrap, optimize, build-planning, safety-net, etc. */
  action: (msg: string) => void;
  /** Logs reconciliation events (scheduled→posted checks). */
  reconcile: (msg: string) => void;
  /** Logs errors from scheduler-level operations. */
  error: (msg: string) => void;
}

let _schedulerFL: SchedulerFileLogger | null = null;

/**
 * Returns a singleton file logger that writes to `logs/_scheduler/YYYY-MM-DD.log`.
 * All scheduler-level events go here (bootstrap, optimize, build planning,
 * safety net, reconciliation) — separate from per-automation logs.
 */
export function getSchedulerFileLogger(): SchedulerFileLogger {
  if (!_schedulerFL) {
    _schedulerFL = {
      action: (msg: string) => { appendSchedulerLine("ACTION", msg); },
      reconcile: (msg: string) => { appendSchedulerLine("RECONCILE", msg); },
      error: (msg: string) => { appendSchedulerLine("ERROR", msg); },
    };
  }
  return _schedulerFL;
}

/**
 * Delete log files older than MAX_AGE_DAYS. Call once on process startup.
 */
export async function cleanupOldLogs() {
  try {
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    await walkAndClean(LOGS_ROOT, cutoff);
  } catch {
    // best-effort
  }
}

async function walkAndClean(dir: string, cutoff: number) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAndClean(full, cutoff);
      // remove empty dirs
      const remaining = await fs.readdir(full).catch(() => ["x"]);
      if (remaining.length === 0) await fs.rmdir(full).catch(() => {});
    } else if (entry.name.endsWith(".log")) {
      const stat = await fs.stat(full).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) {
        await fs.unlink(full).catch(() => {});
      }
    }
  }
}

/**
 * List available log dates for an automation directory.
 */
export async function listLogDates(logDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(logDir);
    return files
      .filter((f) => f.endsWith(".log"))
      .map((f) => f.replace(".log", ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Read a specific date's log file contents.
 */
export async function readLogFile(logDir: string, date: string): Promise<string | null> {
  try {
    const file = path.join(logDir, `${date}.log`);
    return await fs.readFile(file, "utf-8");
  } catch {
    return null;
  }
}
