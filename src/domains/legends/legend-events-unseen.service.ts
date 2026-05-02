import type { QuerySnapshot } from "firebase-admin/firestore";
import { recordFallback, recordSurfaceTimings } from "../../observability/request-context.js";
import { legendRepository } from "./legend.repository.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

type FirestoreMap = Record<string, unknown>;

function finiteInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

function mapSnapToEvents(snap: QuerySnapshot): Array<{
  eventId: string;
  eventType: string;
  scopeId: string;
  scopeType: string;
  scopeTitle: string;
  activityId: string | null;
  placeType: string | null;
  placeId: string | null;
  geohash: string | null;
  previousRank: number | null;
  newRank: number | null;
  previousLeaderCount: number;
  newLeaderCount: number;
  viewerCount: number;
  deltaToReclaim: number;
  overtakenByUserId: string | null;
  sourcePostId: string;
  createdAt: unknown;
  seen: boolean;
}> {
  return snap.docs.map((doc) => {
    const row = (doc.data() as FirestoreMap | undefined) ?? {};
    return {
      eventId: String(row.eventId ?? doc.id),
      eventType: String(row.eventType ?? ""),
      scopeId: String(row.scopeId ?? ""),
      scopeType: String(row.scopeType ?? ""),
      scopeTitle: String(row.scopeTitle ?? ""),
      activityId: row.activityId == null ? null : String(row.activityId),
      placeType: row.placeType == null ? null : String(row.placeType),
      placeId: row.placeId == null ? null : String(row.placeId),
      geohash: row.geohash == null ? null : String(row.geohash),
      previousRank: row.previousRank == null ? null : Math.max(1, finiteInt(row.previousRank, 1)),
      newRank: row.newRank == null ? null : Math.max(1, finiteInt(row.newRank, 1)),
      previousLeaderCount: Math.max(0, finiteInt(row.previousLeaderCount, 0)),
      newLeaderCount: Math.max(0, finiteInt(row.newLeaderCount, 0)),
      viewerCount: Math.max(0, finiteInt(row.viewerCount, 0)),
      deltaToReclaim: Math.max(0, finiteInt(row.deltaToReclaim, 0)),
      overtakenByUserId: row.overtakenByUserId == null ? null : String(row.overtakenByUserId),
      sourcePostId: String(row.sourcePostId ?? ""),
      createdAt: row.createdAt,
      seen: row.seen === true
    };
  });
}

const OPTIONAL_WORK_BUDGET_MS = 45;

/**
 * Legends unseen must never block first paint: bounded optional Firestore read with fail-open empty payload.
 */
export async function loadUnseenLegendEventsFast(input: {
  viewerId: string;
  log: { warn: (o: Record<string, unknown>, m: string) => void; info: (o: Record<string, unknown>, m: string) => void };
}): Promise<{
  events: ReturnType<typeof mapSnapToEvents>;
  degraded: boolean;
  reason?: string;
  debugTimingsMs: Record<string, number>;
  dbQueries: number;
  dbReads: number;
}> {
  const t0 = Date.now();
  const debugTimingsMs: Record<string, number> = {};
  const db = getFirestoreSourceClient();
  debugTimingsMs.afterDbResolve = Date.now() - t0;
  if (!db) {
    recordFallback("legends_events_unseen_no_firestore");
    return { events: [], degraded: true, reason: "no_firestore", debugTimingsMs, dbQueries: 0, dbReads: 0 };
  }

  let snap: QuerySnapshot | null = null;
  const queryStarted = Date.now();
  try {
    snap = (await Promise.race([
      legendRepository.unseenLegendEventsQuery(input.viewerId, 5).get(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("legends_unseen_optional_timeout")), OPTIONAL_WORK_BUDGET_MS)
      )
    ])) as QuerySnapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "legends_unseen_optional_timeout") {
      recordFallback("legends_events_unseen_timeout");
      recordSurfaceTimings({ legends_unseen_optional_timeout_ms: OPTIONAL_WORK_BUDGET_MS });
      input.log.info(
        {
          event: "legends_events_unseen_degraded",
          reason: "timeout",
          budgetMs: OPTIONAL_WORK_BUDGET_MS,
          timingsMs: { ...debugTimingsMs, queryWait: Date.now() - queryStarted }
        },
        "legends unseen optional work exceeded budget"
      );
      return {
        events: [],
        degraded: true,
        reason: "timeout",
        debugTimingsMs: { ...debugTimingsMs, queryWait: Date.now() - queryStarted },
        dbQueries: 0,
        dbReads: 0
      };
    }
    const low = message.toLowerCase();
    if (low.includes("index") || low.includes("failed_precondition")) {
      recordFallback("legends_events_unseen_missing_index");
      return {
        events: [],
        degraded: true,
        reason: "missing_index",
        debugTimingsMs: { ...debugTimingsMs, queryWait: Date.now() - queryStarted },
        dbQueries: 0,
        dbReads: 0
      };
    }
    input.log.warn({ event: "legends_events_unseen_error", message }, "legends unseen query failed");
    throw error;
  }

  debugTimingsMs.queryWait = Date.now() - queryStarted;
  debugTimingsMs.total = Date.now() - t0;
  const events = snap ? mapSnapToEvents(snap) : [];
  return {
    events,
    degraded: false,
    debugTimingsMs,
    dbQueries: 1,
    dbReads: snap?.docs.length ?? 0
  };
}
