import { buildCacheKey } from "../../cache/types.js";
import { globalCache } from "../../cache/global-cache.js";
import { registerRouteCacheKey } from "../../cache/route-cache-index.js";
import type { ProfileGridResponse } from "../../contracts/surfaces/profile-grid.contract.js";
import { finalizeProfileGridWireItem } from "../../dto/compact-wire-slim.js";
import { enrichGridPreviewItemsWithAppPostV2 } from "../../lib/posts/app-post-v2/enrichAppPostV2Response.js";
import { debugLog } from "../../lib/logging/debug-log.js";
import {
  getRequestContext,
  recordCacheHit,
  recordCacheMiss,
  recordFallback,
  recordSurfaceTimings,
} from "../../observability/request-context.js";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

export class ProfileGridOrchestrator {
  constructor(private readonly service: ProfileService) {}

  async run(input: { viewerId: string; userId: string; cursor: string | null; limit: number }): Promise<ProfileGridResponse> {
    const { viewerId, userId, cursor, limit } = input;

    const pageCacheKey = buildCacheKey("list", ["profile-grid-page-v5", viewerId, userId, cursor ?? "start", limit]);
    const cached = await globalCache.get<ProfileGridResponse>(pageCacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    let fallbacks: string[] = [];
    let page;
    try {
      const startedAt = performance.now();
      page = await this.service.loadGridPage(userId, cursor, limit);
      recordSurfaceTimings({
        profile_grid_page_fetch_ms: performance.now() - startedAt,
      });
    } catch {
      fallbacks = ["invalid_cursor_fallback_to_start"];
      recordFallback("invalid_cursor_fallback_to_start");
      const startedAt = performance.now();
      page = await this.service.loadGridPage(userId, null, limit);
      recordSurfaceTimings({
        profile_grid_page_fetch_ms: performance.now() - startedAt,
      });
    }

    const enrichStartedAt = performance.now();
    const enriched = await enrichGridPreviewItemsWithAppPostV2(
      page.items as Array<Record<string, unknown>>,
      viewerId === "anonymous" ? null : viewerId,
      { hydrateViewerState: false }
    );
    const items = enriched.map((row) =>
      finalizeProfileGridWireItem(row as Record<string, unknown>),
    ) as ProfileGridResponse["items"];
    recordSurfaceTimings({
      profile_grid_app_post_attach_ms: performance.now() - enrichStartedAt,
    });

    try {
      const totalPayloadBytes = Buffer.byteLength(JSON.stringify(items), "utf8");
      const mediaBytesEstimate = items.reduce((acc, row) => {
        const r = row as Record<string, unknown>;
        const ap = r.appPostV2 as Record<string, unknown> | undefined;
        const m = ap?.media;
        const apBytes =
          Buffer.byteLength(JSON.stringify(ap ?? {}), "utf8") +
          Buffer.byteLength(JSON.stringify(m ?? {}), "utf8");
        const thumb = typeof r.thumbUrl === "string" ? r.thumbUrl.length : 0;
        return acc + thumb * 4 + Math.min(apBytes, 240_000);
      }, 0);
      debugLog("feed", "PROFILE_GRID_PAYLOAD_BREAKDOWN", {
        itemCount: items.length,
        totalPayloadBytes,
        avgBytesPerItem: items.length > 0 ? Math.round(totalPayloadBytes / items.length) : 0,
        mediaBytesEstimate: Math.round(mediaBytesEstimate),
        duplicatedAuthorBytes: 0,
        fullDetailFieldsPresent: false,
        trimMode: "profile_grid_wire_v5",
        PROFILE_GRID_COMPACT_MODE: true,
      });
    } catch {
      // diagnostics only
    }

    const response: ProfileGridResponse = {
      routeName: "profile.grid.get",
      profileUserId: userId,
      page: {
        cursorIn: cursor,
        limit,
        count: items.length,
        hasMore: page.nextCursor != null,
        nextCursor: page.nextCursor,
        sort: "updatedAtMs_desc"
      },
      items,
      degraded: fallbacks.length > 0,
      fallbacks,
      debug:
        process.env.NODE_ENV === "production"
          ? undefined
          : {
              timingsMs: {
                pageFetch: getRequestContext()?.surfaceTimings.profile_grid_page_fetch_ms ?? 0,
                appPostAttach: getRequestContext()?.surfaceTimings.profile_grid_app_post_attach_ms ?? 0,
              },
              counts: {
                grid: page.items.length,
                collections: 0,
                achievements: 0,
              },
              profilePicSource: null,
              dbOps: getRequestContext()
                ? {
                    reads: getRequestContext()!.dbOps.reads,
                    writes: getRequestContext()!.dbOps.writes,
                    queries: getRequestContext()!.dbOps.queries,
                  }
                : undefined,
            }
    };

    void globalCache.set(pageCacheKey, response, 10_000).catch(() => undefined);
    void registerRouteCacheKey(pageCacheKey, [
      `route:profile.grid:${userId}`,
      `route:profile.grid:${userId}:${viewerId}`,
    ]).catch(() => undefined);
    return response;
  }
}
