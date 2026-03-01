const INSTANCE_ID = process.env.INSTANCE_ID ?? "";
const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase();

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const threshold = LEVELS[LOG_LEVEL as keyof typeof LEVELS] ?? LEVELS.info;

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function prefix(tag: string): string {
  return INSTANCE_ID ? `[${ts()}] [${INSTANCE_ID}] [${tag}]` : `[${ts()}] [${tag}]`;
}

export function createLogger(tag: string) {
  const p = () => prefix(tag);
  return {
    log: (...args: unknown[]) => {
      if (threshold <= LEVELS.info) console.log(p(), ...args);
    },
    debug: (...args: unknown[]) => {
      if (threshold <= LEVELS.debug) console.log(p(), ...args);
    },
    warn: (...args: unknown[]) => {
      if (threshold <= LEVELS.warn) console.warn(p(), ...args);
    },
    error: (...args: unknown[]) => {
      if (threshold <= LEVELS.error) console.error(p(), ...args);
    },
  };
}
