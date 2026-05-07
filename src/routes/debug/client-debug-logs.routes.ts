import type { FastifyInstance } from "fastify";
import { failure, success } from "../../lib/response.js";
import {
  clientDebugLogBatchSchema,
  type ClientDebugLogBatch
} from "../../observability/clientDebugLog/clientDebugLog.schema.js";
import {
  printClientDebugLogBatch,
  type ClientDebugLogPrinter
} from "../../observability/clientDebugLog/clientDebugLog.print.js";

const ROUTE_PATH = "/v2/debug/client-logs";

const MAX_BATCH_BYTES_DEFAULT = 64 * 1024;

function isIngestEnabled(): boolean {
  const flag = (process.env.ENABLE_CLIENT_DEBUG_LOG_INGEST ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

function maxBatchBytes(): number {
  const raw = process.env.CLIENT_DEBUG_LOG_MAX_BATCH_BYTES;
  if (!raw) return MAX_BATCH_BYTES_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1024) return MAX_BATCH_BYTES_DEFAULT;
  return Math.min(parsed, 512 * 1024);
}

function computeAgeMs(batch: ClientDebugLogBatch, now: number): number {
  const candidates: number[] = [];
  if (typeof batch.deviceTime === "number") candidates.push(now - batch.deviceTime);
  for (const entry of batch.entries) {
    if (typeof entry.deviceTime === "number") candidates.push(now - entry.deviceTime);
  }
  if (candidates.length === 0) return 0;
  const filtered = candidates.filter((value) => Number.isFinite(value) && value >= 0 && value < 5 * 60 * 1000);
  if (filtered.length === 0) return 0;
  return Math.round(Math.max(...filtered));
}

function makePrinter(app: FastifyInstance): ClientDebugLogPrinter {
  return {
    info: (line: string) => {
      app.log.info({ event: "client_debug_log" }, line);
    },
    warn: (line: string) => {
      app.log.warn({ event: "client_debug_log" }, line);
    },
    error: (line: string) => {
      app.log.error({ event: "client_debug_log" }, line);
    }
  };
}

/**
 * Opt-in client debug log ingest. Disabled unless ENABLE_CLIENT_DEBUG_LOG_INGEST is on.
 *
 * - No Firestore reads/writes.
 * - No persistence anywhere; logs are streamed to the Backendv2 console only.
 * - Sensitive fields are redacted via clientDebugLog.print.ts before printing.
 * - Oversized payloads are rejected with 413 (clients are expected to chunk batches).
 */
export async function registerClientDebugLogIngestRoutes(app: FastifyInstance): Promise<void> {
  app.post(ROUTE_PATH, async (request, reply) => {
    if (!isIngestEnabled()) {
      // Quiet 404 so a misconfigured production deploy never advertises the route.
      return reply.status(404).send(failure("not_found", "client debug log ingest disabled"));
    }

    const rawPayloadBytes = Buffer.byteLength(JSON.stringify(request.body ?? {}), "utf8");
    if (rawPayloadBytes > maxBatchBytes()) {
      return reply.status(413).send(failure("payload_too_large", "client debug log batch too large"));
    }

    const parsed = clientDebugLogBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(failure("validation_error", "invalid client debug log batch"));
    }

    const now = Date.now();
    const ctx = {
      serverReceivedAt: new Date(now).toISOString(),
      ageMs: computeAgeMs(parsed.data, now)
    };

    try {
      printClientDebugLogBatch(parsed.data, ctx, makePrinter(app));
    } catch (error) {
      // Never let logging cost the client a non-2xx; record a single line and ack.
      app.log.warn(
        {
          event: "client_debug_log_print_failed",
          message: error instanceof Error ? error.message : String(error),
          session: parsed.data.clientSessionId
        },
        "client debug log print failed"
      );
    }

    return reply.status(202).send(
      success({
        accepted: parsed.data.entries.length,
        serverReceivedAt: ctx.serverReceivedAt
      })
    );
  });
}

export const __TEST__ = {
  ROUTE_PATH,
  isIngestEnabled,
  maxBatchBytes,
  computeAgeMs
};
