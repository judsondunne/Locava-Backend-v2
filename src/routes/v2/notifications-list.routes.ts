import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  NotificationsListQuerySchema,
  notificationsListContract,
  type NotificationsListResponse,
} from "../../contracts/surfaces/notifications-list.contract.js";
import {
  NOTIFICATIONS_LIST_MAX_DOCS,
  NOTIFICATIONS_META_MAX_DOCS,
} from "../../constants/firestore-read-budgets.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { NotificationsListOrchestrator } from "../../orchestration/surfaces/notifications-list.orchestrator.js";
import { setRouteName } from "../../observability/request-context.js";
import { notificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { resolveCompatViewerId } from "../compat/resolve-compat-viewer-id.js";
import { NotificationsService } from "../../services/surfaces/notifications.service.js";

/**
 * REIMPLEMENTED AFTER FIRESTORE READ CONTAINMENT: bounded/cached implementation.
 * Do not replace with unbounded scans or collectionGroup listeners.
 */

function hashViewerId(viewerId: string): string {
  return createHash("sha256").update(viewerId).digest("hex").slice(0, 12);
}

const listInflight = new Map<string, Promise<NotificationsListResponse>>();
const lastCoalesceAt = new Map<string, number>();

export async function registerV2NotificationsListRoutes(app: FastifyInstance): Promise<void> {
  const service = new NotificationsService(notificationsRepository);
  const orchestrator = new NotificationsListOrchestrator(service);

  app.get(notificationsListContract.path, async (request, reply) => {
    setRouteName(notificationsListContract.routeName);
    const parsed = NotificationsListQuerySchema.parse(request.query);
    const viewerId = resolveCompatViewerId(request);
    if (!viewerId || viewerId === "anonymous") {
      return reply.status(401).send(failure("not_authenticated", "Sign in to view notifications"));
    }
    const viewerCtx = buildViewerContext(request);
    if (!canUseV2Surface("notifications", viewerCtx.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Notifications v2 surface is not enabled"));
    }

    const limit = Math.min(parsed.limit, NOTIFICATIONS_LIST_MAX_DOCS);
    const dedupeKey = `${viewerId}:${parsed.cursor ?? ""}:${limit}`;
    const now = Date.now();
    const lastAt = lastCoalesceAt.get(dedupeKey) ?? 0;
    if (now - lastAt < 400) {
      request.log.info(
        {
          route: "/v2/notifications",
          source: "notifications_bounded_v2",
          event: "notifications_list_coalesced",
          viewerHash: hashViewerId(viewerId),
          limit,
        },
        "notifications list coalesced (rapid repeat)",
      );
    }
    lastCoalesceAt.set(dedupeKey, now);

    const existing = listInflight.get(dedupeKey);
    if (existing) {
      const payload = await existing;
      return success(payload);
    }

    const estimatedDocsMax = NOTIFICATIONS_LIST_MAX_DOCS + NOTIFICATIONS_META_MAX_DOCS;
    request.log.info(
      {
        route: "/v2/notifications",
        source: "notifications_bounded_v2",
        readBudgetMax: estimatedDocsMax,
        estimatedDocsRead: Math.min(limit, NOTIFICATIONS_LIST_MAX_DOCS) + NOTIFICATIONS_META_MAX_DOCS,
        resultCountCap: limit,
        viewerHash: hashViewerId(viewerId),
        limit,
      },
      "notifications bounded list request",
    );

    const run = (async (): Promise<NotificationsListResponse> => {
      return orchestrator.run({
        viewerId,
        cursor: parsed.cursor ?? null,
        limit,
        boundedList: {
          maxNotificationDocs: NOTIFICATIONS_LIST_MAX_DOCS,
          skipActorHydration: true,
          syncUnreadFromViewerDoc: true,
          strictPageHasMore: true,
        },
      });
    })();

    listInflight.set(dedupeKey, run);
    try {
      const payload = await run;
      return success(payload);
    } finally {
      listInflight.delete(dedupeKey);
    }
  });
}
