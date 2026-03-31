/**
 * Format a date as a relative time string (past or future).
 * Handles "just now", minutes, hours+minutes, days, months.
 */
export function formatRelative(date: Date): string {
  const diff = date.getTime() - Date.now();

  if (diff < 0) {
    const ago = Math.abs(diff);
    if (ago < 60_000) return "just now";
    if (ago < 3600_000) return `${Math.floor(ago / 60_000)}m ago`;
    if (ago < 86_400_000) return `${Math.floor(ago / 3600_000)}h ${Math.floor((ago % 3600_000) / 60_000)}m ago`;
    const days = Math.floor(ago / 86_400_000);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  if (diff < 60_000) return "< 1m";
  if (diff < 3600_000) return `in ${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.floor(diff / 3600_000)}h ${Math.floor((diff % 3600_000) / 60_000)}m`;
  return `in ${Math.floor(diff / 86_400_000)}d`;
}

/** Shortcut: ISO string → relative time string */
export function timeAgo(dateStr: string): string {
  return formatRelative(new Date(dateStr));
}

/** Format a date in a locale-friendly absolute form */
export function formatAbsolute(dateStr: string, tz?: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(dateStr));
  } catch {
    return new Date(dateStr).toLocaleString();
  }
}

/** Format a large number with K/M suffixes */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}
