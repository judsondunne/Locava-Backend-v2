import type { FastifyBaseLogger } from "fastify";
import type { ClientTelemetryBatch, ClientTelemetryEvent } from "./clientTelemetry/clientTelemetry.schema.js";

function envTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "TRUE";
}

export function isClientTelemetryIngestEnvEnabled(): boolean {
  return (
    envTruthy(process.env.ENABLE_CLIENT_TELEMETRY_INGEST) ||
    envTruthy(process.env.ENABLE_CLIENT_DEBUG_LOG_INGEST) ||
    envTruthy(process.env.FIELD_TEST_LOGGING_ENABLED)
  );
}

export function isFieldTestStructuredClientLogEnabled(): boolean {
  return envTruthy(process.env.ENABLE_CLIENT_DEBUG_LOG_INGEST) || envTruthy(process.env.FIELD_TEST_LOGGING_ENABLED);
}

type WindowState = { windowStartMs: number; count: number };

const windows = new Map<string, WindowState>();
const WINDOW_MS = 60_000;
const MAX_EVENTS_PER_WINDOW = 80;

function pruneWindows(now: number): void {
  for (const [k, w] of windows.entries()) {
    if (now - w.windowStartMs > WINDOW_MS) windows.delete(k);
  }
}

/** Per-session token bucket so a forgotten phone cannot spam Cloud Logging. */
export function allowFieldTestClientLog(fieldTestSessionId: string): boolean {
  const now = Date.now();
  pruneWindows(now);
  const row = windows.get(fieldTestSessionId);
  if (!row || now - row.windowStartMs > WINDOW_MS) {
    windows.set(fieldTestSessionId, { windowStartMs: now, count: 1 });
    return true;
  }
  if (row.count >= MAX_EVENTS_PER_WINDOW) return false;
  row.count += 1;
  return true;
}

const recentDedupe = new Map<string, number>();
const DEDUPE_MS = 400;

function isVideoReadinessEvidenceEvent(clientEventName: string): boolean {
  return (
    clientEventName === "video.first_frame" ||
    clientEventName === "video.stall_start" ||
    clientEventName === "video.stall_end" ||
    clientEventName === "video.native_mounted" ||
    clientEventName.startsWith("video.readiness_") ||
    clientEventName.startsWith("video.native_prepare_") ||
    clientEventName === "video.native_claimed" ||
    clientEventName === "video.native_claim_miss" ||
    clientEventName === "video.native_eviction_decision"
  );
}

function shouldCoalesceDuplicate(fieldTestSessionId: string, clientEventName: string, clientTs: number): boolean {
  const key = `${fieldTestSessionId}:${clientEventName}`;
  const last = recentDedupe.get(key);
  if (typeof last === "number" && clientTs - last < DEDUPE_MS) return true;
  recentDedupe.set(key, clientTs);
  if (recentDedupe.size > 5000) recentDedupe.clear();
  return false;
}

export function logFieldTestClientEvents(input: {
  logger: FastifyBaseLogger;
  fieldTestSessionId: string;
  events: ClientTelemetryEvent[];
}): void {
  if (!isFieldTestStructuredClientLogEnabled()) return;
  const { logger, fieldTestSessionId, events } = input;
  if (!fieldTestSessionId) return;
  for (const event of events) {
    const clientEventName = event.name.includes(".") ? event.name : `${event.category}.${event.name}`;
    if (isVideoReadinessEvidenceEvent(clientEventName)) {
      logger.info({
        event: "FIELD_TEST_CLIENT_EVENT",
        fieldTestSessionId,
        clientEventName,
        clientTs: event.clientTimestampMs,
        surface: event.surface ?? null,
        postId: event.postId ?? null,
        route: event.path ?? event.routeName ?? null,
        latency: typeof event.durationMs === "number" ? event.durationMs : null,
        videoAssetId: event.assetId ?? null,
        videoUriKind: event.video?.selectedUrlKind ?? null,
        videoNativeState: event.meta ?? null,
        clientSessionId: event.sessionId,
        category: event.category,
        fieldTestEvidenceBypass: true,
      });
      continue;
    }
    if (shouldCoalesceDuplicate(fieldTestSessionId, clientEventName, event.clientTimestampMs)) continue;
    if (!allowFieldTestClientLog(fieldTestSessionId)) {
      logger.warn(
        { event: "FIELD_TEST_CLIENT_LOG_RATE_LIMITED", fieldTestSessionId },
        "field test client log rate limited"
      );
      break;
    }
    logger.info({
      event: "FIELD_TEST_CLIENT_EVENT",
      fieldTestSessionId,
      clientEventName,
      clientTs: event.clientTimestampMs,
      surface: event.surface ?? null,
      postId: event.postId ?? null,
      route: event.path ?? event.routeName ?? null,
      latency: typeof event.durationMs === "number" ? event.durationMs : null,
      videoAssetId: event.assetId ?? null,
      videoUriKind: event.video?.selectedUrlKind ?? null,
      videoNativeState: event.meta ?? null,
      clientSessionId: event.sessionId,
      category: event.category
    });
  }
}

export function resolveFieldTestSessionIdFromRequest(
  headers: Record<string, string | string[] | undefined>,
  batch?: ClientTelemetryBatch
): string | null {
  const fromHeader = String(headers["x-locava-field-test-session-id"] ?? "").trim();
  if (fromHeader) return fromHeader.slice(0, 220);
  const fromBatch = typeof batch?.fieldTestSessionId === "string" ? batch.fieldTestSessionId.trim() : "";
  if (fromBatch) return fromBatch.slice(0, 220);
  return null;
}

export const FIELD_TEST_LOGS_EXPLORER_SNIPPET = String.raw`resource.type="cloud_run_revision"
resource.labels.service_name="<SERVICE_NAME>"
jsonPayload.fieldTestSessionId="<SESSION_ID>"`;

export const FIELD_TEST_GCLOUD_TAIL_SNIPPET = String.raw`gcloud alpha logging tail \
'resource.type="cloud_run_revision"
 AND resource.labels.service_name="<SERVICE_NAME>"
 AND jsonPayload.fieldTestSessionId="<SESSION_ID>"' \
--project=<PROJECT_ID>`;
