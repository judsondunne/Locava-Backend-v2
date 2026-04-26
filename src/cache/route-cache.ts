import { globalCache } from "./global-cache.js";
import { registerRouteCacheKey } from "./route-cache-index.js";

export async function setRouteCacheEntry<T>(key: string, value: T, ttlMs: number, tags: string[]): Promise<void> {
  await globalCache.set(key, value, ttlMs);
  await registerRouteCacheKey(key, tags);
}
