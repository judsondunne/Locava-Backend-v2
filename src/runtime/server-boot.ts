/**
 * Process boot clock + startup grace window.
 * P3/P4 routes must not contend with P1/P2 first paint during the grace period (see low-priority-request-gate).
 */

const SERVER_T0_MS = Date.now();

export function serverBootNowMs(): number {
  return SERVER_T0_MS;
}

export function serverAgeMs(): number {
  return Date.now() - SERVER_T0_MS;
}

export function startupGraceMs(): number {
  const raw = process.env.BACKENDV2_STARTUP_GRACE_MS;
  if (raw != null && raw !== "") {
    const n = Number.parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 0 && n <= 120_000) return n;
  }
  return 10_000;
}

export function isStartupGracePeriod(): boolean {
  if (process.env.BACKENDV2_TEST_STARTUP_GRACE === "1") return true;
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return false;
  return serverAgeMs() < startupGraceMs();
}

type TimelineRow = { event: string; ageMs: number; meta?: Record<string, unknown> };
const timeline: TimelineRow[] = [];

export function logStartupTimeline(event: string, meta?: Record<string, unknown>): void {
  const row: TimelineRow = { event, ageMs: serverAgeMs(), ...(meta ? { meta } : {}) };
  timeline.push(row);
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    console.info(JSON.stringify({ kind: "startup_timeline", event, ageMs: row.ageMs, ...meta }));
  }
}

export function snapshotStartupTimeline(): TimelineRow[] {
  return [...timeline];
}
