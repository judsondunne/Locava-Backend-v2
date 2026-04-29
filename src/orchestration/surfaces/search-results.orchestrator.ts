import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { SearchResultsResponse } from "../../contracts/surfaces/search-results.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { SearchService } from "../../services/surfaces/search.service.js";

export class SearchResultsOrchestrator {
  constructor(private readonly service: SearchService) {}

  async run(input: {
    viewerId: string;
    query: string;
    cursor: string | null;
    limit: number;
    lat: number | null;
    lng: number | null;
    wantedTypes: Set<string>;
    includeDebug: boolean;
  }): Promise<SearchResultsResponse> {
    const { viewerId, query, cursor, limit, lat, lng, wantedTypes, includeDebug } = input;
    const normalized = query.trim().toLowerCase();
    const cursorPart = cursor ?? "start";
    const geoKey =
      typeof lat === "number" && typeof lng === "number"
        ? `${lat.toFixed(3)},${lng.toFixed(3)}`
        : "nogeo";
    const cacheKey = buildCacheKey("list", [
      "search-results-v2",
      viewerId,
      normalized,
      cursorPart,
      String(limit),
      geoKey,
      [...wantedTypes].sort().join(","),
      includeDebug ? "debug" : "nodebug",
    ]);
    const cached = await globalCache.get<SearchResultsResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const bundle = await this.service.loadResultsBundle({
      viewerId,
      query: normalized,
      cursor,
      limit,
      lat,
      lng,
      wantedTypes,
      includeDebug,
    });
    const requestKey = `${viewerId}:${normalized}:${cursorPart}:${limit}`;
    const response: SearchResultsResponse = {
      routeName: "search.results.get",
      requestKey,
      queryEcho: normalized,
      page: bundle.page,
      items: bundle.items,
      ...(bundle.debugSearch ? { debugSearch: bundle.debugSearch } : {}),
      sections: bundle.sections,
      degraded: bundle.degraded,
      fallbacks: bundle.fallbacks
    };

    void globalCache.set(cacheKey, response, 8_000).catch(() => undefined);
    return response;
  }
}
