type CacheEntry<T> = { expiresAtMs: number; value: T };

export class MixCache {
  private readonly map = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly maxKeys = 400) {}

  get<T>(key: string): T | null {
    const row = this.map.get(key);
    if (!row) return null;
    if (row.expiresAtMs <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return row.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.map.set(key, { expiresAtMs: Date.now() + Math.max(1, ttlMs), value });
    this.trim();
  }

  async dedupe<T>(key: string, runner: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return (await existing) as T;
    const promise = runner();
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private trim(): void {
    while (this.map.size > this.maxKeys) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.map.delete(oldestKey);
    }
  }
}

export const mixCache = new MixCache();

