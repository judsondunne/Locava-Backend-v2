type CacheEntry<T> = { value: T; expiresAtMs: number };

const memory = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export type WikimediaMvpCacheStats = {
  hits: number;
  misses: number;
};

const stats: WikimediaMvpCacheStats = { hits: 0, misses: 0 };

export function wikimediaMvpCacheResetStats(): void {
  stats.hits = 0;
  stats.misses = 0;
}

export function wikimediaMvpCacheStatsSnapshot(): WikimediaMvpCacheStats {
  return { ...stats };
}

export function wikimediaMvpCacheGet<T>(key: string): T | null {
  const row = memory.get(key);
  if (!row) {
    stats.misses += 1;
    return null;
  }
  if (Date.now() > row.expiresAtMs) {
    memory.delete(key);
    stats.misses += 1;
    return null;
  }
  stats.hits += 1;
  return row.value as T;
}

export function wikimediaMvpCacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  memory.set(key, { value, expiresAtMs: Date.now() + ttlMs });
}

export function wikimediaMvpCacheClear(): void {
  memory.clear();
}
