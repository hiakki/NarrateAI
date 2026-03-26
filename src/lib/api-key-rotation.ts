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

export interface ProviderExhaustionStatus {
  envVar: string;
  totalKeys: number;
  availableKeys: number;
  exhaustedKeys: Array<{ masked: string; reason: string; expiresAt: number }>;
}

export class KeyRotator {
  private readonly envVar: string;
  private readonly aliases: string[];
  private keys: string[];
  private exhausted = new Map<string, ExhaustionRecord>();
  private roundRobinIdx = 0;

  constructor(envVar: string, aliases?: string[]) {
    this.envVar = envVar;
    this.aliases = aliases ?? [];
    this.keys = this.loadKeys();
  }

  private loadKeys(): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const v of [this.envVar, ...this.aliases]) {
      const raw = process.env[v] ?? "";
      for (const k of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!seen.has(k)) { seen.add(k); result.push(k); }
      }
    }
    return result;
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

  getStatus(envVar: string): ProviderExhaustionStatus {
    this.pruneExpired();
    const exhaustedKeys: ProviderExhaustionStatus["exhaustedKeys"] = [];
    for (const k of this.keys) {
      const rec = this.exhausted.get(k);
      if (rec) {
        const masked = k.length > 8 ? k.slice(0, 4) + "…" + k.slice(-4) : "***";
        exhaustedKeys.push({ masked, reason: rec.reason, expiresAt: rec.until });
      }
    }
    return { envVar, totalKeys: this.keys.length, availableKeys: this.availableCount, exhaustedKeys };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, rec] of this.exhausted) {
      if (rec.until <= now) this.exhausted.delete(key);
    }
  }
}

const rotators = new Map<string, KeyRotator>();

/** Get or create a singleton KeyRotator for a given env var name (+ optional aliases). */
export function getKeyRotator(envVar: string, aliases?: string[]): KeyRotator {
  let r = rotators.get(envVar);
  if (!r) {
    r = new KeyRotator(envVar, aliases ?? ENV_ALIASES[envVar]);
    rotators.set(envVar, r);
  }
  return r;
}

/**
 * Reset exhaustion records for daily-reset providers only.
 * One-time credit providers keep their exhaustion state across builds
 * since their credits never replenish.
 */
export function resetDailyExhaustion(dailyEnvVars: Set<string>): void {
  let cleared = 0;
  for (const [envVar, rotator] of rotators) {
    if (!dailyEnvVars.has(envVar)) continue;
    if (rotator.availableCount < rotator.count) {
      log.log(`[${envVar}] Clearing daily-reset exhaustion (${rotator.count - rotator.availableCount} exhausted → fresh)`);
      cleared++;
    }
    rotator.reset();
  }
  if (cleared > 0) log.log(`Reset exhaustion for ${cleared} daily-reset provider(s)`);
}

/**
 * Reset exhaustion for ALL providers (used on app restart).
 */
export function resetAllExhaustion(): void {
  let cleared = 0;
  for (const [envVar, rotator] of rotators) {
    if (rotator.availableCount < rotator.count) {
      log.log(`[${envVar}] Clearing exhaustion records (${rotator.count - rotator.availableCount} exhausted → fresh)`);
      cleared++;
    }
    rotator.reset();
  }
  if (cleared > 0) log.log(`Reset exhaustion for ${cleared} provider key pool(s) — fresh start`);
}

/**
 * Get exhaustion status for all known rotators.
 */
export function getAllExhaustionStatus(): ProviderExhaustionStatus[] {
  const result: ProviderExhaustionStatus[] = [];
  for (const [envVar, rotator] of rotators) {
    result.push(rotator.getStatus(envVar));
  }
  return result;
}

/**
 * Well-known env var alias groups.
 * When a KeyRotator is created for any of these primary vars, it also checks the aliases.
 */
const ENV_ALIASES: Record<string, string[]> = {
  HUGGINGFACE_API_KEY: ["HUGGINGFACE_API_TOKEN", "HF_TOKEN"],
};

/** Resolves known aliases for an env var name. */
export function envAliases(envVar: string): string[] | undefined {
  return ENV_ALIASES[envVar];
}

export { DEFAULT_EXHAUSTION_TTL_MS, RATE_LIMIT_TTL_MS };
