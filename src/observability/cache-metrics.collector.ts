export type CacheInvalidationRecord = {
  timestamp: string;
  invalidationType: string;
  keyCount: number;
  entityKeyCount: number;
  routeKeyCount: number;
};

export type CacheStoreRuntimeStats = {
  provider: string;
  size: number | null;
  distributed: boolean;
};

type CacheMetricsSnapshot = {
  routeCache: {
    hits: number;
    misses: number;
  };
  entityCache: {
    hits: number;
    misses: number;
  };
  storageOps: {
    sets: number;
    deletes: number;
  };
  recentInvalidations: CacheInvalidationRecord[];
  store: CacheStoreRuntimeStats | null;
};

const MAX_INVALIDATION_RECORDS = 50;

class CacheMetricsCollector {
  private routeCacheHits = 0;
  private routeCacheMisses = 0;
  private entityCacheHits = 0;
  private entityCacheMisses = 0;
  private storageSets = 0;
  private storageDeletes = 0;
  private readonly recentInvalidations: CacheInvalidationRecord[] = [];
  private statsProvider: (() => CacheStoreRuntimeStats | null) | null = null;

  recordRouteCacheHit(): void {
    this.routeCacheHits += 1;
  }

  recordRouteCacheMiss(): void {
    this.routeCacheMisses += 1;
  }

  recordEntityCacheHit(): void {
    this.entityCacheHits += 1;
  }

  recordEntityCacheMiss(): void {
    this.entityCacheMisses += 1;
  }

  recordStorageSet(): void {
    this.storageSets += 1;
  }

  recordStorageDelete(): void {
    this.storageDeletes += 1;
  }

  recordInvalidation(input: {
    invalidationType: string;
    keyCount?: number;
    entityKeyCount?: number;
    routeKeyCount?: number;
  }): void {
    this.recentInvalidations.push({
      timestamp: new Date().toISOString(),
      invalidationType: input.invalidationType,
      keyCount: input.keyCount ?? 0,
      entityKeyCount: input.entityKeyCount ?? input.keyCount ?? 0,
      routeKeyCount: input.routeKeyCount ?? 0
    });
    if (this.recentInvalidations.length > MAX_INVALIDATION_RECORDS) {
      this.recentInvalidations.shift();
    }
  }

  setStatsProvider(provider: (() => CacheStoreRuntimeStats | null) | null): void {
    this.statsProvider = provider;
  }

  getSnapshot(): CacheMetricsSnapshot {
    return {
      routeCache: {
        hits: this.routeCacheHits,
        misses: this.routeCacheMisses
      },
      entityCache: {
        hits: this.entityCacheHits,
        misses: this.entityCacheMisses
      },
      storageOps: {
        sets: this.storageSets,
        deletes: this.storageDeletes
      },
      recentInvalidations: [...this.recentInvalidations].reverse(),
      store: this.statsProvider?.() ?? null
    };
  }

  clear(): void {
    this.routeCacheHits = 0;
    this.routeCacheMisses = 0;
    this.entityCacheHits = 0;
    this.entityCacheMisses = 0;
    this.storageSets = 0;
    this.storageDeletes = 0;
    this.recentInvalidations.length = 0;
  }
}

export const cacheMetricsCollector = new CacheMetricsCollector();
