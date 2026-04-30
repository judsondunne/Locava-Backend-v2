import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  analyticsEventsContract,
  AnalyticsEventsBodySchema
} from "../../contracts/surfaces/analytics-events.contract.js";
import { success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AnalyticsEventsOrchestrator } from "../../orchestration/surfaces/analytics-events.orchestrator.js";
import { resolveCompatViewerId } from "../compat/resolve-compat-viewer-id.js";
import { getAnalyticsIngestService } from "../../services/analytics/analytics-runtime.js";

export async function registerV2AnalyticsEventsRoutes(app: FastifyInstance): Promise<void> {
  const orchestrator = new AnalyticsEventsOrchestrator(getAnalyticsIngestService(app.config));

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    setRouteName(analyticsEventsContract.routeName);
    const body = AnalyticsEventsBodySchema.parse(request.body);
    const viewerId = resolveCompatViewerId(request);
    const payload = await orchestrator.run({
      body,
      requestUserId: viewerId !== "anonymous" ? viewerId : null,
      requestIp: request.ip,
      userAgent: request.headers["user-agent"]?.toString() ?? null
    });
    return reply.status(202).send(
      success({
        routeName: analyticsEventsContract.routeName,
        accepted: payload.accepted,
        queued: payload.queued,
        dropped: payload.dropped,
        duplicates: payload.duplicates,
        disabled: payload.disabled,
        destination: payload.destination
      })
    );
  };

  app.post(analyticsEventsContract.path, handler);
  app.post("/api/analytics/v2/events", handler);
}
