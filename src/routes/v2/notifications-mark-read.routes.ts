import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  NotificationsMarkReadBodySchema,
  notificationsMarkReadContract
} from "../../contracts/surfaces/notifications-mark-read.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { NotificationsMarkReadOrchestrator } from "../../orchestration/mutations/notifications-mark-read.orchestrator.js";
import { notificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { NotificationsService } from "../../services/surfaces/notifications.service.js";

export async function registerV2NotificationsMarkReadRoutes(app: FastifyInstance): Promise<void> {
  const service = new NotificationsService(notificationsRepository);
  const orchestrator = new NotificationsMarkReadOrchestrator(service);

  app.post(notificationsMarkReadContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("notifications", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Notifications v2 surface is not enabled for this viewer"));
    }
    const body = NotificationsMarkReadBodySchema.parse(request.body);
    setRouteName(notificationsMarkReadContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      notificationIds: body.notificationIds
    });
    return success(payload);
  });
}
