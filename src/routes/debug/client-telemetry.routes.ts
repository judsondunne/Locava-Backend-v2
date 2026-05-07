import type { FastifyInstance } from "fastify";
import { failure, success } from "../../lib/response.js";
import { clientTelemetryBatchSchema } from "../../observability/clientTelemetry/clientTelemetry.schema.js";
import { clientTelemetryService } from "../../observability/clientTelemetry/clientTelemetry.service.js";

function isEnabled(app: FastifyInstance): boolean {
  const env = app.config.NODE_ENV;
  const explicit = process.env.ENABLE_CLIENT_TELEMETRY_INGEST === "1" || process.env.ENABLE_CLIENT_TELEMETRY_INGEST === "true";
  return env === "development" || explicit;
}

export async function registerClientTelemetryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/debug/client-telemetry/events", async (request, reply) => {
    if (!isEnabled(app)) {
      return reply.status(404).send(failure("not_found", "client telemetry ingest disabled"));
    }
    const rawPayloadBytes = Buffer.byteLength(JSON.stringify(request.body ?? {}), "utf8");
    const maxPayload = Number(process.env.CLIENT_TELEMETRY_MAX_PAYLOAD_BYTES ?? "50000");
    if (rawPayloadBytes > maxPayload) {
      return reply.status(413).send(failure("payload_too_large", "client telemetry payload too large"));
    }
    const parsed = clientTelemetryBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(failure("validation_error", "invalid telemetry batch"));
    }
    clientTelemetryService.ingest(parsed.data, request.log, process.env.CLIENT_TELEMETRY_VERBOSE === "1");
    return reply.status(202).send(success({ accepted: parsed.data.events.length }));
  });

  app.get("/debug/client-telemetry/sessions", async (_request, _reply) => {
    return success({ sessions: clientTelemetryService.listSessions() });
  });

  app.get<{ Params: { sessionId: string } }>("/debug/client-telemetry/sessions/:sessionId", async (request, reply) => {
    const row = clientTelemetryService.getSessionTimeline(request.params.sessionId);
    if (!row) return reply.status(404).send(failure("not_found", "session not found"));
    return success({
      sessionId: row.sessionId,
      startedAt: new Date(row.startedAtMs).toISOString(),
      lastSeenAt: new Date(row.lastSeenAtMs).toISOString(),
      eventCount: row.events.length,
      events: row.events
    });
  });

  app.get<{ Params: { sessionId: string } }>("/debug/client-telemetry/sessions/:sessionId/summary", async (request, reply) => {
    const summary = clientTelemetryService.getSessionSummary(request.params.sessionId);
    if (!summary) return reply.status(404).send(failure("not_found", "session not found"));
    return success(summary);
  });
}
