import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { loadEnv } from "../config/env.js";
import { InMemoryCacheStore } from "../cache/in-memory-cache.js";
import { RedisCacheStore } from "../cache/redis-cache.js";
import type { CacheStore } from "../cache/types.js";

export type CoherenceProvider = {
  mode: "process_local" | "external_coordinator_stub" | "redis";
  cache: CacheStore;
  isDistributed: boolean;
  getDedupeResult<T>(key: string): Promise<T | undefined>;
  setDedupeResult<T>(key: string, value: T, ttlMs: number): Promise<void>;
  tryAcquireLease(key: string, ttlMs: number): Promise<{ token: string; acquired: boolean }>;
  releaseLease(key: string, token: string): Promise<void>;
};

let singleton: CoherenceProvider | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getCoherenceProvider(): CoherenceProvider {
  if (singleton) return singleton;
  const env = loadEnv();
  const memoryCache = new InMemoryCacheStore();

  if (env.COHERENCE_MODE === "redis" && env.REDIS_URL) {
    const redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true
    });
    const redisCache = new RedisCacheStore(redisClient, env.REDIS_KEY_PREFIX);
    singleton = {
      mode: "redis",
      cache: redisCache,
      isDistributed: true,
      async getDedupeResult<T>(key: string): Promise<T | undefined> {
        const raw = await redisCache.getRaw(`dedupe:result:${key}`);
        if (!raw) return undefined;
        return JSON.parse(raw) as T;
      },
      async setDedupeResult<T>(key: string, value: T, ttlMs: number): Promise<void> {
        await redisCache.setRaw(`dedupe:result:${key}`, JSON.stringify(value), ttlMs);
      },
      async tryAcquireLease(key: string, ttlMs: number): Promise<{ token: string; acquired: boolean }> {
        const token = randomUUID();
        const acquired = await redisCache.tryAcquire(`lease:${key}`, token, ttlMs);
        return { token, acquired };
      },
      async releaseLease(key: string, token: string): Promise<void> {
        await redisCache.releaseIfOwner(`lease:${key}`, token);
      }
    };
    return singleton;
  }

  singleton = {
    mode: env.COHERENCE_MODE === "external_coordinator_stub" ? "external_coordinator_stub" : "process_local",
    cache: memoryCache,
    isDistributed: false,
    getDedupeResult: async () => undefined,
    setDedupeResult: async () => {},
    async tryAcquireLease(): Promise<{ token: string; acquired: boolean }> {
      await sleep(0);
      return { token: "local", acquired: true };
    },
    releaseLease: async () => {}
  };
  return singleton;
}
