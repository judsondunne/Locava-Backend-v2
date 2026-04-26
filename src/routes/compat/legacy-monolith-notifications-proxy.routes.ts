import fastifyHttpProxy from "@fastify/http-proxy";
import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

const LEGACY_NOTIFICATIONS_PREFIX = "/api/notifications";

const upstreamUnavailable = {
  ok: false,
  success: false,
  code: "upstream_unavailable",
  message:
    "Legacy notification mutation/push routes are monolith-backed. Set LEGACY_MONOLITH_PROXY_BASE_URL to enable /api/notifications parity."
};

function registerUnavailableRoutes(app: FastifyInstance): void {
  // Legacy read surfaces are available under /api/v1/product/notifications* (compat -> v2),
  // but /api/notifications mutation/push endpoints are still monolith-owned.
  app.get(`${LEGACY_NOTIFICATIONS_PREFIX}`, async (_request, reply) => reply.status(503).send(upstreamUnavailable));
  app.get(`${LEGACY_NOTIFICATIONS_PREFIX}/stats`, async (_request, reply) => reply.status(503).send(upstreamUnavailable));
  app.get(`${LEGACY_NOTIFICATIONS_PREFIX}/bootstrap`, async (_request, reply) => reply.status(503).send(upstreamUnavailable));
  app.put(`${LEGACY_NOTIFICATIONS_PREFIX}/read-all`, async (_request, reply) => reply.status(503).send(upstreamUnavailable));
  app.post(`${LEGACY_NOTIFICATIONS_PREFIX}/read-all`, async (_request, reply) => reply.status(503).send(upstreamUnavailable));

  const mutationPaths = [
    "/collaboration",
    "/follow",
    "/like",
    "/comment",
    "/mention",
    "/collection-shared",
    "/place-follow",
    "/audio-like",
    "/system",
    "/push",
    "/test/follow",
    "/test/like",
    "/test/comment",
    "/test/mention",
    "/test/chat",
    "/test/invite",
    "/test/collection-shared",
    "/test/place-follow",
    "/test/audio-like",
    "/test/system",
    "/test/post",
    "/test/push",
    "/trigger/post-ready"
  ];
  for (const path of mutationPaths) {
    app.post(`${LEGACY_NOTIFICATIONS_PREFIX}${path}`, async (_request, reply) => reply.status(503).send(upstreamUnavailable));
  }
}

/**
 * Proxies classic `/api/notifications/*` mutation + push paths to old backend when configured.
 * Without the monolith base URL, it returns explicit 503 upstream_unavailable (never fake 200).
 */
export async function registerLegacyMonolithNotificationsProxyRoutes(app: FastifyInstance, env: AppEnv): Promise<void> {
  const raw = env.LEGACY_MONOLITH_PROXY_BASE_URL?.trim();
  if (!raw) {
    registerUnavailableRoutes(app);
    return;
  }
  const upstream = `${trimBase(raw)}${LEGACY_NOTIFICATIONS_PREFIX}`;
  await app.register(fastifyHttpProxy, {
    upstream,
    prefix: LEGACY_NOTIFICATIONS_PREFIX,
    http2: false
  });
}
