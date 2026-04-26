export type CacheEntry<T> = {
  key: string;
  value: T;
  expiresAtEpochMs: number;
};

export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
}

export type CacheNamespace = "entity" | "list" | "bootstrap";

export function buildCacheKey(namespace: CacheNamespace, parts: Array<string | number>): string {
  return [namespace, ...parts.map(String)].join(":");
}
