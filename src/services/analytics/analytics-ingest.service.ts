import { randomUUID } from "node:crypto";
import type { AppEnv } from "../../config/env.js";
import type { AnalyticsEventEnvelope } from "../../contracts/surfaces/analytics-events.contract.js";
import { KNOWN_ANALYTICS_EVENT_NAMES } from "../../contracts/surfaces/analytics-events.contract.js";
import type { AnalyticsPublisher, AnalyticsPublisherDestination, AnalyticsRow } from "../../repositories/analytics/analytics-publisher.js";

type AnalyticsEventInput = AnalyticsEventEnvelope;

type NormalizedAnalyticsEvent = {
  event: string;
  eventId: string;
  schemaVersion: string;
  userId: string | null;
  anonId: string;
  installId: string;
  sessionId: string;
  clientTime: number;
  receivedAt: number;
  platform: string;
  requestIp: string | null;
  userAgent: string | null;
  properties: Record<string, unknown>;
  ingestId: string;
};

type QueuedAnalyticsEvent = {
  event: NormalizedAnalyticsEvent;
  attempts: number;
};

type AnalyticsRecentEvent = {
  event: string;
  eventId: string;
  receivedAt: string;
  userId: string | null;
  sessionId: string;
  properties: Record<string, unknown>;
};

export type AnalyticsAcceptInput = {
  events: AnalyticsEventInput[];
  requestUserId?: string | null;
  requestIp?: string | null;
  userAgent?: string | null;
};

export type AnalyticsAcceptResult = {
  accepted: number;
  queued: number;
  dropped: number;
  duplicates: number;
  disabled: boolean;
  destination: AnalyticsPublisherDestination;
};

export type AnalyticsDebugSnapshot = {
  enabled: boolean;
  destination: AnalyticsPublisherDestination;
  queueDepth: number;
  recentAccepted: AnalyticsRecentEvent[];
  recentPublished: AnalyticsRecentEvent[];
  recentFailures: Array<{ eventId: string; event: string; attempts: number; error: string; at: string }>;
};

const KNOWN_EVENT_NAME_SET = new Set<string>(KNOWN_ANALYTICS_EVENT_NAMES);
const MAX_STRING_LENGTH = 2_048;
const MAX_OBJECT_KEYS = 100;
const MAX_ARRAY_ITEMS = 50;
const MAX_EVENT_BYTES = 16 * 1024;
const MAX_PROPERTIES_BYTES = 16 * 1024;
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1_000;
const DEDUPE_MAX_KEYS = 50_000;
const RECENT_BUFFER_LIMIT = 200;
const RETRY_TIMER_FLOOR_MS = 250;

function inferPlatformFromUserAgent(userAgent: string | null | undefined): string | null {
  const normalizedUserAgent = String(userAgent ?? "").trim().toLowerCase();
  if (!normalizedUserAgent) return null;
  if (
    normalizedUserAgent.includes("cfnetwork") ||
    normalizedUserAgent.includes("darwin") ||
    normalizedUserAgent.includes("iphone") ||
    normalizedUserAgent.includes("ios")
  ) {
    return "ios";
  }
  if (normalizedUserAgent.includes("okhttp") || normalizedUserAgent.includes("android")) {
    return "android";
  }
  return null;
}

function normalizePlatform(value: string | undefined, userAgent: string | null | undefined): string {
  const normalized = String(value ?? "unknown").trim().toLowerCase();
  const inferredNativePlatform = inferPlatformFromUserAgent(userAgent);
  if (normalized === "ios" || normalized === "android") return normalized;
  if (normalized === "native") return inferredNativePlatform ?? "native";
  if (normalized === "web" && inferredNativePlatform) return inferredNativePlatform;
  if (normalized === "web" || normalized === "backend") return normalized;
  if (inferredNativePlatform) return inferredNativePlatform;
  if (!normalized) return "unknown";
  return normalized.slice(0, 32);
}

function trimString(value: string, max = MAX_STRING_LENGTH): string {
  return value.trim().slice(0, max);
}

function approxBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return MAX_EVENT_BYTES + 1;
  }
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 5) return null;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => sanitizeUnknown(entry, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      const safe = sanitizeUnknown(nested, depth + 1);
      if (safe !== undefined) out[key.slice(0, 128)] = safe;
    }
    return out;
  }
  return String(value).slice(0, MAX_STRING_LENGTH);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function propertyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function validateKnownEvent(event: string, properties: Record<string, unknown>, input: AnalyticsEventInput): string[] {
  const errors: string[] = [];
  const screenName = propertyString(properties.screenName) ?? propertyString(input.screenName);
  const query = propertyString(properties.query) ?? propertyString(properties.q);
  const onboardingStep =
    propertyString(properties.step_name) ??
    propertyString(properties.step) ??
    propertyString(properties.stepName);
  const tabName =
    propertyString(properties.tabName) ??
    propertyString(properties.tab_name) ??
    propertyString(properties.routeName);

  switch (event) {
    case "screen_view":
      if (!screenName) errors.push("screen_view requires properties.screenName");
      break;
    case "tab_view":
      if (!tabName) errors.push("tab_view requires properties.tabName or properties.routeName");
      break;
    case "search_query":
      if (!query) errors.push("search_query requires properties.query or properties.q");
      break;
    case "onboarding_step_view":
    case "onboarding_step_complete":
      if (!onboardingStep) errors.push(`${event} requires onboarding step metadata`);
      break;
    default:
      break;
  }

  return errors;
}

function toRecentEvent(event: NormalizedAnalyticsEvent): AnalyticsRecentEvent {
  return {
    event: event.event,
    eventId: event.eventId,
    receivedAt: new Date(event.receivedAt).toISOString(),
    userId: event.userId,
    sessionId: event.sessionId,
    properties: event.properties
  };
}

function pushBounded<T>(target: T[], entry: T, limit: number): void {
  target.push(entry);
  if (target.length > limit) {
    target.splice(0, target.length - limit);
  }
}

export class AnalyticsIngestService {
  private readonly queue: QueuedAnalyticsEvent[] = [];
  private readonly dedupeExpiries = new Map<string, number>();
  private readonly recentAccepted: AnalyticsRecentEvent[] = [];
  private readonly recentPublished: AnalyticsRecentEvent[] = [];
  private readonly recentFailures: Array<{ eventId: string; event: string; attempts: number; error: string; at: string }> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    private readonly env: AppEnv,
    private readonly publisher: AnalyticsPublisher
  ) {}

  acceptBatch(input: AnalyticsAcceptInput): AnalyticsAcceptResult {
    const destination = this.publisher.getDestination();
    if (!this.env.ANALYTICS_ENABLED) {
      return {
        accepted: 0,
        queued: this.queue.length,
        dropped: input.events.length,
        duplicates: 0,
        disabled: true,
        destination
      };
    }

    const ingestId = randomUUID();
    const receivedAt = Date.now();
    let accepted = 0;
    let dropped = 0;
    let duplicates = 0;

    for (const [index, rawEvent] of input.events.entries()) {
      const normalized = this.normalizeEvent(rawEvent, {
        ingestId,
        index,
        receivedAt,
        requestUserId: input.requestUserId ?? null,
        requestIp: input.requestIp ?? null,
        userAgent: input.userAgent ?? null
      });
      if ("errors" in normalized) {
        dropped += 1;
        pushBounded(
          this.recentFailures,
          {
            eventId: rawEvent.eventId?.trim() || `${ingestId}-${index}`,
            event: rawEvent.event,
            attempts: 0,
            error: normalized.errors.join("; "),
            at: new Date(receivedAt).toISOString()
          },
          RECENT_BUFFER_LIMIT
        );
        continue;
      }

      this.evictExpiredDedupeEntries(receivedAt);
      if (this.isDuplicate(normalized.eventId, receivedAt)) {
        duplicates += 1;
        continue;
      }

      if (this.queue.length >= this.env.ANALYTICS_QUEUE_MAX_ITEMS) {
        this.queue.shift();
        dropped += 1;
      }

      this.queue.push({ event: normalized, attempts: 0 });
      accepted += 1;
      pushBounded(this.recentAccepted, toRecentEvent(normalized), RECENT_BUFFER_LIMIT);
    }

    if (this.queue.length >= this.env.ANALYTICS_PUBLISH_BATCH_SIZE) {
      this.scheduleFlush(0);
    } else if (accepted > 0) {
      this.scheduleFlush(1_000);
    }

    return {
      accepted,
      queued: this.queue.length,
      dropped,
      duplicates,
      disabled: false,
      destination
    };
  }

  observeRoute(input: {
    routeName: string;
    routePath: string;
    method: string;
    statusCode: number;
    latencyMs: number;
    payloadBytes: number;
    dbReads: number;
    dbWrites: number;
    dbQueries: number;
    viewerId: string | null;
    errorCode?: string | null;
    surface?: string | null;
    requestGroup?: string | null;
    hydrationMode?: string | null;
    budgetViolations?: string[];
  }): void {
    const event: AnalyticsEventInput = {
      eventId: `backend-route-${randomUUID()}`,
      event: "backend_route_observation",
      schemaVersion: "1.0.0",
      platform: "backend",
      clientTime: Date.now(),
      sessionId: "backend",
      anonId: "backend",
      installId: "backend",
      userId: input.viewerId ?? undefined,
      properties: {
        routeName: input.routeName,
        routePath: input.routePath,
        method: input.method,
        statusCode: input.statusCode,
        latencyMs: Number(input.latencyMs.toFixed(2)),
        payloadBytes: input.payloadBytes,
        dbReads: input.dbReads,
        dbWrites: input.dbWrites,
        dbQueries: input.dbQueries,
        errorCode: input.errorCode ?? null,
        surface: input.surface ?? null,
        requestGroup: input.requestGroup ?? null,
        hydrationMode: input.hydrationMode ?? null,
        budgetViolations: input.budgetViolations ?? []
      }
    };
    this.acceptBatch({
      events: [event],
      requestUserId: input.viewerId ?? null
    });
  }

  getDebugSnapshot(): AnalyticsDebugSnapshot {
    return {
      enabled: this.env.ANALYTICS_ENABLED,
      destination: this.publisher.getDestination(),
      queueDepth: this.queue.length,
      recentAccepted: [...this.recentAccepted].reverse().slice(0, this.env.ANALYTICS_DEBUG_RECENT_LIMIT),
      recentPublished: [...this.recentPublished].reverse().slice(0, this.env.ANALYTICS_DEBUG_RECENT_LIMIT),
      recentFailures: [...this.recentFailures].reverse().slice(0, this.env.ANALYTICS_DEBUG_RECENT_LIMIT)
    };
  }

  async publishDebugProbe(): Promise<AnalyticsAcceptResult> {
    return this.acceptBatch({
      events: [
        {
          eventId: `debug-probe-${randomUUID()}`,
          event: "app_open",
          schemaVersion: "1.0.0",
          platform: "backend",
          clientTime: Date.now(),
          sessionId: "debug-probe",
          anonId: "debug-probe",
          installId: "debug-probe",
          properties: {
            source: "local_debug_probe"
          }
        }
      ]
    });
  }

  async flushNowForTests(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushQueue();
  }

  resetForTests(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.queue.length = 0;
    this.dedupeExpiries.clear();
    this.recentAccepted.length = 0;
    this.recentPublished.length = 0;
    this.recentFailures.length = 0;
    this.flushing = false;
  }

  private normalizeEvent(
    rawEvent: AnalyticsEventInput,
    input: {
      ingestId: string;
      index: number;
      receivedAt: number;
      requestUserId: string | null;
      requestIp: string | null;
      userAgent: string | null;
    }
  ): NormalizedAnalyticsEvent | { errors: string[] } {
    const event = trimString(rawEvent.event, 128).toLowerCase();
    const eventId = trimString(rawEvent.eventId || `${input.ingestId}-${input.index}`, 128);
    const userId = propertyString(rawEvent.userId) ?? input.requestUserId ?? null;
    const anonId = propertyString(rawEvent.anonId) ?? `legacy-${input.ingestId}-${input.index}`;
    const installId = propertyString(rawEvent.installId) ?? anonId;
    const sessionId = propertyString(rawEvent.sessionId) ?? "unknown";
    const properties = sanitizeUnknown(asRecord(rawEvent.properties)) as Record<string, unknown>;

    if (rawEvent.attribution) {
      properties.attribution = sanitizeUnknown(rawEvent.attribution);
    }
    if (rawEvent.branch_link_data_first) {
      properties.branch_link_data_first = sanitizeUnknown(rawEvent.branch_link_data_first);
    }
    if (rawEvent.branch_link_data_last) {
      properties.branch_link_data_last = sanitizeUnknown(rawEvent.branch_link_data_last);
    }
    if (rawEvent.installId || installId) {
      properties.installId = installId;
    }
    if (rawEvent.platform) {
      properties.clientPlatform = trimString(rawEvent.platform, 32);
    }

    const errors: string[] = [];
    if (!event) errors.push("event is required");
    if (KNOWN_EVENT_NAME_SET.has(event)) {
      errors.push(...validateKnownEvent(event, properties, rawEvent));
    }
    if (approxBytes(properties) > MAX_PROPERTIES_BYTES) {
      errors.push("properties exceed 16KB");
    }

    const normalized: NormalizedAnalyticsEvent = {
      event,
      eventId,
      schemaVersion: trimString(rawEvent.schemaVersion || "1.0.0", 32),
      userId,
      anonId,
      installId,
      sessionId,
      clientTime: rawEvent.clientTime ?? rawEvent.serverTime ?? input.receivedAt,
      receivedAt: input.receivedAt,
      platform: normalizePlatform(rawEvent.platform, input.userAgent),
      requestIp: input.requestIp,
      userAgent: input.userAgent,
      properties,
      ingestId: input.ingestId
    };

    if (approxBytes(normalized) > MAX_EVENT_BYTES) {
      errors.push("event exceeds 16KB");
    }

    if (errors.length > 0) {
      return { errors };
    }

    return normalized;
  }

  private toRow(event: NormalizedAnalyticsEvent): AnalyticsRow {
    const compatibleProperties = {
      ...event.properties,
      eventId: event.eventId,
      ingestId: event.ingestId
    };
    return {
      event: event.event,
      schemaVersion: event.schemaVersion,
      userId: event.userId,
      anonId: event.anonId,
      sessionId: event.sessionId,
      clientTime: Number.isFinite(event.clientTime) ? new Date(event.clientTime) : null,
      receivedAt: new Date(event.receivedAt),
      platform: event.platform,
      requestIp: event.requestIp,
      userAgent: event.userAgent,
      properties: Object.keys(compatibleProperties).length > 0 ? JSON.stringify(compatibleProperties) : null
    };
  }

  private isDuplicate(eventId: string, nowMs: number): boolean {
    const existing = this.dedupeExpiries.get(eventId);
    if (existing && existing > nowMs) {
      return true;
    }
    this.dedupeExpiries.set(eventId, nowMs + DEDUPE_TTL_MS);
    if (this.dedupeExpiries.size > DEDUPE_MAX_KEYS) {
      const oldest = this.dedupeExpiries.keys().next().value;
      if (oldest) this.dedupeExpiries.delete(oldest);
    }
    return false;
  }

  private evictExpiredDedupeEntries(nowMs: number): void {
    if (this.dedupeExpiries.size < 1_000) return;
    for (const [eventId, expiresAt] of this.dedupeExpiries) {
      if (expiresAt <= nowMs) {
        this.dedupeExpiries.delete(eventId);
      }
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushQueue();
    }, Math.max(RETRY_TIMER_FLOOR_MS, delayMs));
    this.flushTimer.unref?.();
  }

  private async flushQueue(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.env.ANALYTICS_PUBLISH_BATCH_SIZE);
    try {
      await this.publisher.publish(batch.map(({ event }) => this.toRow(event)));
      for (const item of batch) {
        pushBounded(this.recentPublished, toRecentEvent(item.event), RECENT_BUFFER_LIMIT);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable: QueuedAnalyticsEvent[] = [];
      for (const item of batch) {
        const nextAttempts = item.attempts + 1;
        if (nextAttempts < this.env.ANALYTICS_RETRY_MAX_ATTEMPTS) {
          retryable.push({ event: item.event, attempts: nextAttempts });
        } else {
          pushBounded(
            this.recentFailures,
            {
              eventId: item.event.eventId,
              event: item.event.event,
              attempts: nextAttempts,
              error: message,
              at: new Date().toISOString()
            },
            RECENT_BUFFER_LIMIT
          );
        }
      }
      this.queue.unshift(...retryable);
      const delayMs = Math.min(
        this.env.ANALYTICS_RETRY_MAX_DELAY_MS,
        this.env.ANALYTICS_RETRY_BASE_DELAY_MS * Math.max(1, retryable[0]?.attempts ?? 1)
      );
      if (retryable.length > 0) {
        this.scheduleFlush(delayMs);
      }
    } finally {
      this.flushing = false;
      if (this.queue.length > 0 && !this.flushTimer) {
        this.scheduleFlush(250);
      }
    }
  }
}
