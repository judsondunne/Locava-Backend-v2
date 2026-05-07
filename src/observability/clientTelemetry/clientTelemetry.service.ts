import type { FastifyBaseLogger } from "fastify";
import type { ClientTelemetryBatch, ClientTelemetryEvent } from "./clientTelemetry.schema.js";

type SessionState = {
  sessionId: string;
  startedAtMs: number;
  lastSeenAtMs: number;
  appVersion: string | null;
  platform: "ios" | "android" | null;
  buildProfile: string | null;
  networkTypesSeen: Set<string>;
  events: ClientTelemetryEvent[];
  startupDedup: Map<string, number>;
};

const MAX_SESSIONS = 100;
const MAX_EVENTS_PER_SESSION = 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;

class ClientTelemetryService {
  private readonly sessions = new Map<string, SessionState>();

  ingest(batch: ClientTelemetryBatch, logger: FastifyBaseLogger, verbose: boolean): void {
    const now = Date.now();
    const state = this.ensureSession(batch, now);
    for (const event of batch.events) {
      state.events.push(event);
      if (state.events.length > MAX_EVENTS_PER_SESSION) {
        state.events.shift();
      }
      state.lastSeenAtMs = now;
      if (event.network?.type) state.networkTypesSeen.add(event.network.type);
      this.logCompact(state, event, logger, verbose);
    }
    this.evictOld(now);
  }

  listSessions(): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    for (const state of this.sessions.values()) {
      const events = state.events;
      const routeCount = events.filter((e) => e.category === "route").length;
      const videoCount = events.filter((e) => e.category === "video").length;
      const errorCount = events.filter((e) => e.category === "error" || e.ok === false).length;
      rows.push({
        sessionId: state.sessionId,
        startedAt: new Date(state.startedAtMs).toISOString(),
        lastSeenAt: new Date(state.lastSeenAtMs).toISOString(),
        eventCount: events.length,
        appVersion: state.appVersion,
        platform: state.platform,
        buildProfile: state.buildProfile,
        networkTypesSeen: [...state.networkTypesSeen],
        routeCount,
        videoCount,
        errorCount
      });
    }
    return rows.sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  }

  getSessionTimeline(sessionId: string): SessionState | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getSessionSummary(sessionId: string): Record<string, unknown> | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    const routeDurations = state.events.filter((e) => e.category === "route" && typeof e.durationMs === "number").map((e) => e.durationMs as number);
    const videoFirstFrames = state.events.filter((e) => typeof e.video?.firstFrameMs === "number").map((e) => e.video?.firstFrameMs as number);
    return {
      sessionId,
      routes: { count: routeDurations.length, avg: avg(routeDurations), p50: pct(routeDurations, 50), p95: pct(routeDurations, 95) },
      videos: {
        firstFrameCount: videoFirstFrames.length,
        firstFrameAvg: avg(videoFirstFrames),
        firstFrameP50: pct(videoFirstFrames, 50),
        firstFrameP95: pct(videoFirstFrames, 95),
        stalls: state.events.filter((e) => e.video?.stalled === true || e.name.includes("stall")).length,
        errors: state.events.filter((e) => e.video?.error === true || e.category === "error").length
      }
    };
  }

  private ensureSession(batch: ClientTelemetryBatch, now: number): SessionState {
    const existing = this.sessions.get(batch.sessionId);
    if (existing) {
      existing.lastSeenAtMs = now;
      return existing;
    }
    const next: SessionState = {
      sessionId: batch.sessionId,
      startedAtMs: now,
      lastSeenAtMs: now,
      appVersion: batch.appVersion ?? null,
      platform: batch.platform ?? null,
      buildProfile: batch.buildProfile ?? null,
      networkTypesSeen: new Set<string>(),
      events: [],
      startupDedup: new Map<string, number>()
    };
    this.sessions.set(batch.sessionId, next);
    while (this.sessions.size > MAX_SESSIONS) {
      const firstKey = this.sessions.keys().next().value;
      if (!firstKey) break;
      this.sessions.delete(firstKey);
    }
    return next;
  }

  private evictOld(now: number): void {
    for (const [key, state] of this.sessions.entries()) {
      if (now - state.lastSeenAtMs > SESSION_TTL_MS) this.sessions.delete(key);
    }
  }

  private logCompact(state: SessionState, event: ClientTelemetryEvent, logger: FastifyBaseLogger, verbose: boolean): void {
    const startupPhase = String((event.meta?.phase ?? "") || "").trim();
    if (event.name === "app.startup_phase" && !startupPhase) {
      return;
    }
    if (event.name === "app.startup_phase" && startupPhase) {
      const lastSeenAtMs = state.startupDedup.get(startupPhase);
      if (typeof lastSeenAtMs === "number" && Math.abs(event.clientTimestampMs - lastSeenAtMs) <= 250) {
        return;
      }
      state.startupDedup.set(startupPhase, event.clientTimestampMs);
    }
    const delta = (() => {
      if (typeof event.monotonicMs === "number" && Number.isFinite(event.monotonicMs)) {
        return Math.max(0, Math.round(event.monotonicMs));
      }
      const firstEventTs = state.events.length > 0 ? state.events[0]?.clientTimestampMs : null;
      const baseline = typeof firstEventTs === "number" && Number.isFinite(firstEventTs) ? firstEventTs : state.startedAtMs;
      return Math.max(0, Math.round(event.clientTimestampMs - baseline));
    })();
    const routeInfo = [event.method, event.path].filter(Boolean).join(" ");
    const core = `[PHONE_PERF] s=${state.sessionId.slice(0, 8)} +${String(delta).padStart(4, "0")} ${event.name}`;
    const extras = [
      event.name === "app.startup_phase" && startupPhase ? `phase=${startupPhase}` : null,
      routeInfo || null,
      event.statusCode ? String(event.statusCode) : null,
      typeof event.durationMs === "number" ? `client=${Math.round(event.durationMs)}ms` : null,
      event.postId ? `post=${event.postId}` : null,
      event.assetId ? `asset=${event.assetId}` : null,
      event.video?.visibleToFirstFrameMs ? `visible=${Math.round(event.video.visibleToFirstFrameMs)}ms` : null,
      event.network?.type ? `net=${event.network.type}` : null
    ].filter(Boolean);
    logger.info(`${core}${extras.length ? ` ${extras.join(" ")}` : ""}`);
    if (verbose) logger.info({ event, sessionId: state.sessionId }, "[PHONE_PERF_VERBOSE]");
  }
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}
function pct(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx] ?? null;
}

export const clientTelemetryService = new ClientTelemetryService();
