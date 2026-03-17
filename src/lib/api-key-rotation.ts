/**
 * API key rotation with per-key exhaustion tracking.
 * Reads comma-separated keys from an env var and cycles through them,
 * temporarily skipping keys that have been marked exhausted (402/429).
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("KeyRotator");

const DEFAULT_EXHAUSTION_TTL_MS = 60 * 60 * 1000; // 1 hour for 402 (quota)
const RATE_LIMIT_TTL_MS = 60 * 1000; // 60s for 429 (rate limit)

interface ExhaustionRecord {
  until: number;
  reason: string;
}

export class KeyRotator {
  private readonly envVar: string;
  private keys: string[];
  private exhausted = new Map<string, ExhaustionRecord>();
  private roundRobinIdx = 0;

  constructor(envVar: string) {
    this.envVar = envVar;
    this.keys = this.loadKeys();
  }

  private loadKeys(): string[] {
    const raw = process.env[this.envVar] ?? "";
    return raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }

  /** Reload keys from env (useful if env changed at runtime). */
  reload(): void {
    this.keys = this.loadKeys();
  }

  /** Total number of configured keys. */
  get count(): number {
    return this.keys.length;
  }

  /** True if at least one key is configured. */
  get hasKeys(): boolean {
    return this.keys.length > 0;
  }

  /**
   * Get next available (non-exhausted) key using round-robin.
   * Returns null if all keys are exhausted or none configured.
   */
  getNextKey(): string | null {
    if (this.keys.length === 0) return null;
    this.pruneExpired();

    const len = this.keys.length;
    for (let i = 0; i < len; i++) {
      const idx = (this.roundRobinIdx + i) % len;
      const key = this.keys[idx];
      if (!this.exhausted.has(key)) {
        this.roundRobinIdx = (idx + 1) % len;
        return key;
      }
    }
    return null;
  }

  /**
   * Mark a key as temporarily exhausted (e.g. after 402 or 429).
   * @param key The API key string
   * @param ttlMs How long to skip this key (default: 1 hour)
   * @param reason Human-readable reason for logging
   */
  markExhausted(key: string, ttlMs?: number, reason?: string): void {
    const ttl = ttlMs ?? DEFAULT_EXHAUSTION_TTL_MS;
    const r = reason ?? "exhausted";
    this.exhausted.set(key, { until: Date.now() + ttl, reason: r });
    const masked = key.length > 8 ? key.slice(0, 4) + "…" + key.slice(-4) : "***";
    log.warn(`[${this.envVar}] Key ${masked} marked exhausted for ${(ttl / 1000).toFixed(0)}s: ${r}`);
  }

  /** Mark exhausted with a short TTL suitable for rate-limit (429) errors. */
  markRateLimited(key: string): void {
    this.markExhausted(key, RATE_LIMIT_TTL_MS, "rate-limited (429)");
  }

  /** Clear all exhaustion records. */
  reset(): void {
    this.exhausted.clear();
    this.roundRobinIdx = 0;
  }

  /** Number of currently available (non-exhausted) keys. */
  get availableCount(): number {
    this.pruneExpired();
    let n = 0;
    for (const k of this.keys) {
      if (!this.exhausted.has(k)) n++;
    }
    return n;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, rec] of this.exhausted) {
      if (rec.until <= now) this.exhausted.delete(key);
    }
  }
}

const rotators = new Map<string, KeyRotator>();

/** Get or create a singleton KeyRotator for a given env var name. */
export function getKeyRotator(envVar: string): KeyRotator {
  let r = rotators.get(envVar);
  if (!r) {
    r = new KeyRotator(envVar);
    rotators.set(envVar, r);
  }
  return r;
}

export { DEFAULT_EXHAUSTION_TTL_MS, RATE_LIMIT_TTL_MS };
