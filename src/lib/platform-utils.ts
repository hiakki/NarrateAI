export interface PlatformEntry {
  platform: string;
  success?: boolean | "uploading" | "scheduled" | "deleted";
  postId?: string;
  url?: string;
  error?: string;
  scheduledFor?: string;
  startedAt?: number;
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
