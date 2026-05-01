import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { failure, success } from "../../lib/response.js";
import { healthDashboardService } from "../../services/internal/health-dashboard.service.js";
import { setRouteName } from "../../observability/request-context.js";

type DashboardQuery = {
  token?: string;
};

function resolveDashboardToken(request: FastifyRequest): string | null {
  const headerToken = request.headers["x-internal-dashboard-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }
  const query = (request.query ?? {}) as DashboardQuery;
  if (typeof query.token === "string" && query.token.trim()) {
    return query.token.trim();
  }
  return null;
}

function authorizeDashboardRequest(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): { allowed: boolean; authWarning: string | null; resolvedToken: string | null } {
  const configuredToken = app.config.INTERNAL_DASHBOARD_TOKEN?.trim();
  const providedToken = resolveDashboardToken(request);

  if (configuredToken) {
    if (providedToken !== configuredToken) {
      void reply.status(401).send(failure("unauthorized", "Valid INTERNAL_DASHBOARD_TOKEN is required."));
      return { allowed: false, authWarning: null, resolvedToken: null };
    }
    return { allowed: true, authWarning: null, resolvedToken: configuredToken };
  }

  if (app.config.NODE_ENV !== "production") {
    return {
      allowed: true,
      authWarning: "Local mode: dashboard is not token protected.",
      resolvedToken: null
    };
  }

  void reply
    .status(503)
    .send(failure("internal_dashboard_disabled", "INTERNAL_DASHBOARD_TOKEN must be configured in production."));
  return {
    allowed: false,
    authWarning: null,
    resolvedToken: null
  };
}

export async function registerInternalHealthDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/internal/health-dashboard/data", async (request, reply) => {
    setRouteName("internal.health_dashboard.data");
    const auth = authorizeDashboardRequest(app, request, reply);
    if (!auth.allowed) return reply;

    const payload = await healthDashboardService.buildData({
      env: app.config,
      authWarning: auth.authWarning
    });
    return success(payload);
  });

  app.get("/internal/health-dashboard", async (request, reply) => {
    setRouteName("internal.health_dashboard.html");
    const auth = authorizeDashboardRequest(app, request, reply);
    if (!auth.allowed) return reply;

    const payload = await healthDashboardService.buildData({
      env: app.config,
      authWarning: auth.authWarning
    });
    reply.type("text/html; charset=utf-8");
    return reply.send(healthDashboardService.renderHtml(payload, { token: auth.resolvedToken }));
  });
}
