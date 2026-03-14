import { AsyncLocalStorage } from "async_hooks";

const INSTANCE_ID = process.env.INSTANCE_ID ?? "";
const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase();

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const threshold = LEVELS[LOG_LEVEL as keyof typeof LEVELS] ?? LEVELS.info;

interface LogContext {
  videoId?: string;
  /** When set, logs use [worker-videoId] or [scheduler-automationId] prefix. */
  kind?: "worker" | "scheduler";
  automationId?: string;
}

export const logContextStorage = new AsyncLocalStorage<LogContext>();

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function prefix(tag: string): string {
  const ctx = logContextStorage.getStore();
  if (ctx?.kind === "worker" && ctx.videoId) {
    return `[worker-${ctx.videoId}] [${tag}]`;
  }
  if (ctx?.kind === "scheduler" && ctx.automationId) {
    return `[scheduler-${ctx.automationId}] [${tag}]`;
  }
  const videoPart = ctx?.videoId ? ` [${ctx.videoId}]` : "";
  const base = INSTANCE_ID ? `[${ts()}] [${INSTANCE_ID}] [${tag}]` : `[${ts()}] [${tag}]`;
  return `${base}${videoPart}`;
}

/**
 * Run fn with videoId set in log context. Logs use [worker-videoId] [tag] format.
 */
export function runWithVideoId<T>(videoId: string, fn: () => T): T {
  return logContextStorage.run({ kind: "worker", videoId }, fn);
}

export function runWithVideoIdAsync<T>(videoId: string, fn: () => Promise<T>): Promise<T> {
  return logContextStorage.run({ kind: "worker", videoId }, fn);
}

/**
 * Run fn with automationId set in log context. Logs use [scheduler-automationId] [tag] format.
 */
export function runWithAutomationId<T>(automationId: string, fn: () => T): T {
  return logContextStorage.run({ kind: "scheduler", automationId }, fn);
}

export function runWithAutomationIdAsync<T>(automationId: string, fn: () => Promise<T>): Promise<T> {
  return logContextStorage.run({ kind: "scheduler", automationId }, fn);
}

export function createLogger(tag: string) {
  /** If first arg is [Stage], use it as the line tag. */
  const lineTag = (args: unknown[]): [string, unknown[]] => {
    if (args.length > 0 && typeof args[0] === "string" && /^\[[\w-]+\]$/.test(args[0])) {
      return [args[0].slice(1, -1), args.slice(1)];
    }
    return [tag, args];
  };
  return {
    log: (...args: unknown[]) => {
      if (threshold <= LEVELS.info) {
        const [t, rest] = lineTag(args);
        console.log(prefix(t), ...rest);
      }
    },
    debug: (...args: unknown[]) => {
      if (threshold <= LEVELS.debug) {
        const [t, rest] = lineTag(args);
        console.log(prefix(t), ...rest);
      }
    },
    warn: (...args: unknown[]) => {
      if (threshold <= LEVELS.warn) {
        const [t, rest] = lineTag(args);
        console.warn(prefix(t), ...rest);
      }
    },
    error: (...args: unknown[]) => {
      if (threshold <= LEVELS.error) {
        const [t, rest] = lineTag(args);
        console.error(prefix(t), ...rest);
      }
    },
  };
}
