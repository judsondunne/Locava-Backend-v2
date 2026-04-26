import type { FastifyRequest } from "fastify";
import { buildViewerContext, type ViewerContext } from "../../auth/viewer-context.js";
import { resolveCompatViewerId } from "./resolve-compat-viewer-id.js";

/**
 * Compat product routes resolve the viewer id from JWT when `x-viewer-id` is missing or anonymous.
 * Profile/chats orchestrators need the same uid as {@link resolveCompatViewerId} for relationship
 * and self-profile semantics; {@link buildViewerContext} alone would stay `anonymous`.
 */
export function buildCompatMergedViewerContext(request: FastifyRequest): ViewerContext {
  const base = buildViewerContext(request);
  const resolved = resolveCompatViewerId(request);
  if (resolved && resolved !== "anonymous") {
    return { ...base, viewerId: resolved };
  }
  return base;
}
