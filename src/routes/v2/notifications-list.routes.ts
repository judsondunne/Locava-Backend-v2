import type { FastifyInstance } from "fastify";
import { NotificationsListQuerySchema, notificationsListContract } from "../../contracts/surfaces/notifications-list.contract.js";
import { success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";

// =====================================================================
// TEMP DISABLED: caused extreme Firebase read usage in Query Insights.
// Do not re-enable without bounded reads, rate limiting, and explicit approval.
// Disabled: 2026-05-12 (read containment emergency)
//
// Original behaviour: /v2/notifications fanned out to
// `users/{viewerId}/notifications orderBy(timestamp, desc).limit(50)` plus
// up to 10 chunked `users` doc reads per request to hydrate sender metadata.
// Query Insights linked the `users/*/notifications` collection-group
// fingerprint to ~1,529,783 reads + ~45,650 reads in a single day.
//
// Route shape is preserved so the native modal still renders an empty list
// and the unread badge falls back to zero. No Firestore reads execute.
// =====================================================================

const DISABLED_REASON = "TEMP_DISABLED_FIRESTORE_READ_CONTAINMENT";

export async function registerV2NotificationsListRoutes(app: FastifyInstance): Promise<void> {
  app.get(notificationsListContract.path, async (request, _reply) => {
    setRouteName(notificationsListContract.routeName);
    const parsed = NotificationsListQuerySchema.parse(request.query);
    return success({
      routeName: "notifications.list.get" as const,
      page: {
        cursorIn: parsed.cursor ?? null,
        limit: parsed.limit,
        count: 0,
        hasMore: false,
        nextCursor: null,
        sort: "created_desc" as const,
      },
      items: [],
      unread: { count: 0 },
      degraded: true,
      fallbacks: [DISABLED_REASON],
    });
  });
}
