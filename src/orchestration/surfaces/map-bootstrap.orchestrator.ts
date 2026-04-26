import { globalCache } from "../../cache/global-cache.js";
import { setRouteCacheEntry } from "../../cache/route-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { MapBootstrapResponse } from "../../contracts/surfaces/map-bootstrap.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { MapService } from "../../services/surfaces/map.service.js";

export class MapBootstrapOrchestrator {
  constructor(private readonly service: MapService) {}

  async run(input: { viewerId: string; bbox: string; limit: number }): Promise<MapBootstrapResponse> {
    const cacheKey = buildCacheKey("bootstrap", ["map-bootstrap-v1", input.viewerId, input.bbox, String(input.limit)]);
    const cached = await globalCache.get<MapBootstrapResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const bounds = this.service.parseBounds(input.bbox);
    const requestKey = `${input.viewerId}:${input.bbox}:${input.limit}`;
    const response: MapBootstrapResponse = {
      routeName: "map.bootstrap.get",
      requestKey,
      query: {
        bbox: bounds,
        limit: input.limit
      },
      page: {
        count: 0,
        hasMore: false,
        nextCursor: null,
        sort: "ts_desc"
      },
      markers: [],
      degraded: false,
      fallbacks: []
    };
    await setRouteCacheEntry(cacheKey, response, 6_000, [`route:map.bootstrap:${input.viewerId}`]);
    return response;
  }
}
