import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { NotificationsListQuerySchema, notificationsListContract } from "../../contracts/surfaces/notifications-list.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { formatServerTimingHeader, getRequestContext, setRouteName } from "../../observability/request-context.js";
import { NotificationsListOrchestrator } from "../../orchestration/surfaces/notifications-list.orchestrator.js";
import { NotificationsRepositoryError, notificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { NotificationsService } from "../../services/surfaces/notifications.service.js";

export async function registerV2NotificationsListRoutes(app: FastifyInstance): Promise<void> {
  const service = new NotificationsService(notificationsRepository);
  const orchestrator = new NotificationsListOrchestrator(service);

  app.get(notificationsListContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("notifications", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Notifications v2 surface is not enabled for this viewer"));
    }
    const query = NotificationsListQuerySchema.parse(request.query);
    setRouteName(notificationsListContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        cursor: query.cursor ?? null,
        limit: query.limit
      });
      const ctx = getRequestContext();
      const st = ctx?.surfaceTimings;
      if (st && Object.keys(st).length > 0) {
        reply.header("Server-Timing", formatServerTimingHeader(st));
      }
      return success(payload);
    } catch (error) {
      if (error instanceof NotificationsRepositoryError && error.code === "invalid_cursor") {
        return reply.status(400).send(failure("invalid_cursor", error.message));
      }
      throw error;
    }
  });
}
