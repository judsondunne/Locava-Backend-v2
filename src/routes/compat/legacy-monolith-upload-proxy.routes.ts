import fastifyHttpProxy from "@fastify/http-proxy";
import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

/** Same path prefix as Locava Backend v1 product upload router. */
const PRODUCT_UPLOAD_PREFIX = "/api/v1/product/upload";

/**
 * Forwards `/api/v1/product/upload/*` to the classic monolith so post-creation pipelines
 * (`create-from-staged`, multipart `create-with-files`, Commons moderation uploads, etc.) keep
 * working while Backendv2 owns staging/presign natively.
 *
 * Register **after** `registerLegacyProductUploadRoutes` so explicit native routes win first.
 */
export async function registerLegacyMonolithUploadProxyRoutes(app: FastifyInstance, env: AppEnv): Promise<void> {
  const raw = env.LEGACY_MONOLITH_PROXY_BASE_URL?.trim();
  if (!raw) return;

  const upstream = `${trimBase(raw)}${PRODUCT_UPLOAD_PREFIX}`;

  await app.register(fastifyHttpProxy, {
    upstream,
    prefix: PRODUCT_UPLOAD_PREFIX,
    http2: false
  });
}
