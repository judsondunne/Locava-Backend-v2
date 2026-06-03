/**
 * Short-lived server cache for PBF Copier V2 viewport scan results.
 * Avoids re-uploading large item arrays for quality-filter toggles.
 */
import { randomUUID } from "node:crypto";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

type CacheEntry = {
  items: PbfCopierPreviewDoc[];
  createdAt: number;
  pbfPath: string;
};

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 5;

const cache = new Map<string, CacheEntry>();

function pruneCache(): void {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (now - entry.createdAt > TTL_MS) cache.delete(id);
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (!oldest) break;
    cache.delete(oldest[0]);
  }
}

export function storePbfCopierV2ScanCache(pbfPath: string, items: PbfCopierPreviewDoc[]): string {
  pruneCache();
  const id = randomUUID();
  cache.set(id, { items, createdAt: Date.now(), pbfPath });
  return id;
}

export function getPbfCopierV2ScanCache(cacheId: string): PbfCopierPreviewDoc[] | null {
  pruneCache();
  const entry = cache.get(cacheId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(cacheId);
    return null;
  }
  return entry.items;
}

export function clearPbfCopierV2ScanCacheForTests(): void {
  cache.clear();
}
