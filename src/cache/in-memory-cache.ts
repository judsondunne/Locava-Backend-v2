import type { CacheStore } from "./types.js";

type MemoryRecord = {
  value: unknown;
  expiresAtEpochMs: number;
};

export class InMemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, MemoryRecord>();

  async get<T>(key: string): Promise<T | undefined> {
    const record = this.map.get(key);
    if (!record) return undefined;
    if (Date.now() > record.expiresAtEpochMs) {
      this.map.delete(key);
      return undefined;
    }
    return record.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.map.set(key, {
      value,
      expiresAtEpochMs: Date.now() + ttlMs
    });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}
