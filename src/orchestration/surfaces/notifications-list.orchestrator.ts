import { globalCache } from "../../cache/global-cache.js";
import { setRouteCacheEntry } from "../../cache/route-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { NotificationsListResponse } from "../../contracts/surfaces/notifications-list.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { NotificationsService } from "../../services/surfaces/notifications.service.js";

export class NotificationsListOrchestrator {
  private static readonly ROUTE_TTL_MS = 30_000;

  constructor(private readonly service: NotificationsService) {}

  async run(input: {
    viewerId: string;
    cursor: string | null;
    limit: number;
    boundedList?: {
      maxNotificationDocs?: number;
      skipActorHydration?: boolean;
      syncUnreadFromViewerDoc?: boolean;
      strictPageHasMore?: boolean;
    };
  }): Promise<NotificationsListResponse> {
    const cursorPart = input.cursor ?? "start";
    const b = input.boundedList;
    const boundedKey = b
      ? `${b.maxNotificationDocs ?? ""}:${b.skipActorHydration ? "1" : "0"}:${b.syncUnreadFromViewerDoc ? "1" : "0"}:${b.strictPageHasMore ? "1" : "0"}`
      : "default";
    const cacheKey = buildCacheKey("list", [
      "notifications-v1",
      input.viewerId,
      cursorPart,
      String(input.limit),
      boundedKey,
    ]);
    const cached = await globalCache.get<NotificationsListResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const page = await this.service.loadNotificationsPage(input);
    const response: NotificationsListResponse = {
      routeName: "notifications.list.get",
      page: {
        cursorIn: input.cursor,
        limit: input.limit,
        count: page.items.length,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        sort: "created_desc",
      },
      items: page.items.map(({ viewerId: _v, ...rest }) => rest),
      unread: {
        count: page.unreadCount
      },
      degraded: page.degraded,
      fallbacks: page.fallbacks
    };
    // Session bootstrap prewarms the first notifications page; keep it warm long enough for the
    // user to actually open the screen, while mutations still invalidate this tag precisely.
    await setRouteCacheEntry(cacheKey, response, NotificationsListOrchestrator.ROUTE_TTL_MS, [
      `route:notifications.list:${input.viewerId}`
    ]);
    return response;
  }
}
