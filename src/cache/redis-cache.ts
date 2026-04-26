import { Redis } from "ioredis";
import type { CacheStore } from "./types.js";

export class RedisCacheStore implements CacheStore {
  constructor(
    private readonly client: Redis,
    private readonly keyPrefix: string
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const payload = await this.client.get(this.namespaced(key));
    if (!payload) return undefined;
    return JSON.parse(payload) as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const serialized = JSON.stringify(value);
    await this.client.set(this.namespaced(key), serialized, "PX", Math.max(1, ttlMs));
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.namespaced(key));
  }

  async getRaw(key: string): Promise<string | null> {
    return this.client.get(this.namespaced(key));
  }

  async setRaw(key: string, value: string, ttlMs: number): Promise<void> {
    await this.client.set(this.namespaced(key), value, "PX", Math.max(1, ttlMs));
  }

  async tryAcquire(key: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(this.namespaced(key), token, "PX", Math.max(1, ttlMs), "NX");
    return result === "OK";
  }

  async releaseIfOwner(key: string, token: string): Promise<void> {
    const releaseScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.client.eval(releaseScript, 1, this.namespaced(key), token);
  }

  private namespaced(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}
