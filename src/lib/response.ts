import type { ApiEnvelope } from "../types/api.js";
import { getRequestContext } from "../observability/request-context.js";

export function success<T>(data: T, latencyMs?: number): ApiEnvelope<T> {
  const ctx = getRequestContext();
  return {
    ok: true,
    data,
    meta: {
      requestId: ctx?.requestId ?? "unknown",
      latencyMs,
      db: ctx?.dbOps ?? { reads: 0, writes: 0, queries: 0 }
    }
  };
}

export function failure(code: string, message: string, details?: unknown): ApiEnvelope<never> {
  const ctx = getRequestContext();
  return {
    ok: false,
    error: { code, message, details },
    meta: {
      requestId: ctx?.requestId ?? "unknown",
      db: ctx?.dbOps ?? { reads: 0, writes: 0, queries: 0 }
    }
  };
}
