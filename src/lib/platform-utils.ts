export interface PlatformEntry {
  platform: string;
  success?: boolean | "uploading" | "scheduled" | "deleted" | "cooldown";
  postId?: string;
  url?: string;
  error?: string;
  scheduledFor?: string;
  startedAt?: number;
  retryAfter?: number;
}

export function parsePlatformEntries(raw: (string | PlatformEntry)[]): Map<string, PlatformEntry> {
  const map = new Map<string, PlatformEntry>();
  for (const p of raw) {
    if (typeof p === "string") {
      map.set(p, { platform: p, success: true });
    } else {
      const entry = { ...p };
      if (entry.success === undefined && (entry.postId || entry.url)) entry.success = true;
      map.set(entry.platform, entry);
    }
  }
  return map;
}

export function getPlatformEntriesArray(raw: unknown): PlatformEntry[] {
  const arr = Array.isArray(raw) ? (raw as (string | PlatformEntry)[]) : [];
  return [...parsePlatformEntries(arr).values()];
}

export function upsertPlatformEntry(entries: PlatformEntry[], entry: PlatformEntry): PlatformEntry[] {
  const filtered = entries.filter((e) => e.platform !== entry.platform);
  filtered.push(entry);
  return filtered;
}

export function isTerminalPlatformSuccess(entry: PlatformEntry | undefined): boolean {
  if (!entry) return false;
  return entry.success === true || entry.success === "deleted";
}
