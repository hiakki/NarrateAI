function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function createLogger(tag: string) {
  return {
    log: (...args: unknown[]) => console.log(`[${ts()}] [${tag}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${ts()}] [${tag}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${ts()}] [${tag}]`, ...args),
  };
}
