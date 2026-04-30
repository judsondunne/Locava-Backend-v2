import type { FastifyRequest, FastifyReply } from "fastify";
import type { AppEnv } from "../../config/env.js";
import type { RequestContext } from "../../observability/request-context.js";
import { resolveCompatViewerId } from "../../routes/compat/resolve-compat-viewer-id.js";
import { getAnalyticsIngestService } from "./analytics-runtime.js";

export function recordBackendRouteObservation(input: {
  env: AppEnv;
  request: FastifyRequest;
  reply: FastifyReply;
  ctx: RequestContext | undefined;
  latencyMs: number;
  budgetViolations: string[];
}): void {
  const routePath = input.request.routeOptions.url ?? input.request.url;
  if (!routePath.startsWith("/v2/")) return;
  if (routePath.startsWith("/v2/analytics/")) return;
  const viewerId = resolveCompatViewerId(input.request);
  getAnalyticsIngestService(input.env).observeRoute({
    routeName: input.ctx?.routeName ?? routePath,
    routePath,
    method: input.request.method,
    statusCode: input.reply.statusCode,
    latencyMs: input.latencyMs,
    payloadBytes: input.ctx?.payloadBytes ?? 0,
    dbReads: input.ctx?.dbOps.reads ?? 0,
    dbWrites: input.ctx?.dbOps.writes ?? 0,
    dbQueries: input.ctx?.dbOps.queries ?? 0,
    viewerId: viewerId !== "anonymous" ? viewerId : null,
    errorCode: input.request.analyticsErrorCode ?? null,
    surface: input.ctx?.orchestration.surface ?? null,
    requestGroup: input.ctx?.orchestration.requestGroup ?? null,
    hydrationMode: input.ctx?.orchestration.hydrationMode ?? null,
    budgetViolations: input.budgetViolations
  });
}
