import fastifyHttpProxy from "@fastify/http-proxy";
import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

const LOCATION_PREFIX = "/api/v1/product/location";
const DYNAMIC_PREFIX = "/api/v1/product/dynamic-collections";
const REELS_PREFIX = "/api/v1/product/reels";

const upstreamUnavailable = {
  ok: false,
  success: false,
  code: "upstream_unavailable",
  message:
    "LEGACY_MONOLITH_PROXY_BASE_URL is not configured; location, dynamic-collections, and reels are not served by Backendv2 alone. Set the monolith base URL to proxy these routes."
};

/**
 * Proxies legacy product **location**, **dynamic-collections**, and **reels** paths to the classic monolith when
 * `LEGACY_MONOLITH_PROXY_BASE_URL` is set. Otherwise registers explicit 503 handlers so clients never
 * receive fake empty geocoder / materialization payloads.
 */
export async function registerLegacyMonolithProductProxyRoutes(app: FastifyInstance, env: AppEnv): Promise<void> {
  const raw = env.LEGACY_MONOLITH_PROXY_BASE_URL?.trim();
  if (raw) {
    const base = trimBase(raw);
    await app.register(fastifyHttpProxy, {
      upstream: `${base}${LOCATION_PREFIX}`,
      prefix: LOCATION_PREFIX,
      http2: false
    });
    await app.register(fastifyHttpProxy, {
      upstream: `${base}${DYNAMIC_PREFIX}`,
      prefix: DYNAMIC_PREFIX,
      http2: false
    });
    await app.register(fastifyHttpProxy, {
      upstream: `${base}${REELS_PREFIX}`,
      prefix: REELS_PREFIX,
      http2: false
    });
    return;
  }

  app.get(`${LOCATION_PREFIX}/autocomplete`, async (_request, reply) =>
    reply.status(503).send(upstreamUnavailable)
  );
  app.post(`${LOCATION_PREFIX}/forward-geocode`, async (_request, reply) =>
    reply.status(503).send(upstreamUnavailable)
  );
  app.get(`${LOCATION_PREFIX}/reverse-geocode`, async (_request, reply) =>
    reply.status(503).send(upstreamUnavailable)
  );

  app.post(`${DYNAMIC_PREFIX}/materialize`, async (_request, reply) =>
    reply.status(503).send(upstreamUnavailable)
  );

  app.get(`${REELS_PREFIX}/bootstrap`, async (_request, reply) =>
    reply.status(503).send(upstreamUnavailable)
  );
  app.post(`${REELS_PREFIX}/for-you-bootstrap`, async (_request, reply) =>
    reply.status(503).send(upstreamUnavailable)
  );
  app.post(`${REELS_PREFIX}/following-bootstrap`, async (_request, reply) =>
    reply.status(503).send(upstreamUnavailable)
  );
  app.get(`${REELS_PREFIX}/near-me`, async (_request, reply) =>
    reply.status(503).send(upstreamUnavailable)
  );
  app.get(`${REELS_PREFIX}/near-me/count`, async (_request, reply) =>
    reply.status(503).send(upstreamUnavailable)
  );
  app.get<{ Params: { slug: string } }>(`${DYNAMIC_PREFIX}/by-slug/:slug`, async (request, reply) =>
    reply.status(503).send({ ...upstreamUnavailable, slug: request.params.slug })
  );
}
