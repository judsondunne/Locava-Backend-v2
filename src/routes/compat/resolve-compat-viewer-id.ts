import type { FastifyRequest } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";

/**
 * Prefer `x-viewer-id` (sent by native for Backendv2). If missing or anonymous, try Firebase ID
 * token `sub` from Authorization — avoids compat routes echoing `anonymous` when the client is
 * actually signed in but only sent a Bearer token.
 */
export function resolveCompatViewerId(request: FastifyRequest): string {
  const fromHeader = buildViewerContext(request).viewerId;
  if (fromHeader && fromHeader !== "anonymous") {
    return fromHeader;
  }

  const fromJwt = tryFirebaseSubFromBearer(request.headers.authorization);
  if (fromJwt) {
    return fromJwt;
  }

  return fromHeader;
}

function tryFirebaseSubFromBearer(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  const payloadSegment = parts[1];
  if (!payloadSegment) {
    return null;
  }
  try {
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { sub?: unknown };
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (sub && sub !== "anonymous") {
      return sub;
    }
  } catch {
    return null;
  }
  return null;
}
