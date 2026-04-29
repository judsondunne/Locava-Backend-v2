import type { FastifyInstance } from "fastify";
import { FieldValue } from "firebase-admin/firestore";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { legendsEventsSeenContract, LegendsEventsSeenParamsSchema } from "../../contracts/surfaces/legends-events-seen.contract.js";
import { legendsEventsUnseenContract } from "../../contracts/surfaces/legends-events-unseen.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { incrementDbOps, setRouteName } from "../../observability/request-context.js";
import { legendRepository } from "../../domains/legends/legend.repository.js";
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

export async function registerV2LegendsEventsRoutes(app: FastifyInstance): Promise<void> {
  app.get(legendsEventsUnseenContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Legends v2 surface is not enabled for this viewer"));
    }
    setRouteName(legendsEventsUnseenContract.routeName);
    const db = getFirestoreSourceClient();
    if (!db) {
      return success({ routeName: legendsEventsUnseenContract.routeName, events: [], count: 0, nextPollAfterMs: 0 });
    }

    const snap = await legendRepository.unseenLegendEventsQuery(viewer.viewerId, 5).get();
    incrementDbOps("queries", 1);
    incrementDbOps("reads", snap.docs.length);
    const events = snap.docs.map((doc) => {
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

    return success({
      routeName: legendsEventsUnseenContract.routeName,
      events,
      count: events.length,
      nextPollAfterMs: events.length > 0 ? 0 : 120_000
    });
  });

  app.post(legendsEventsSeenContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Legends v2 surface is not enabled for this viewer"));
    }
    setRouteName(legendsEventsSeenContract.routeName);
    const db = getFirestoreSourceClient();
    if (!db) {
      return success({ routeName: legendsEventsSeenContract.routeName, eventId: "", seen: true });
    }
    const params = LegendsEventsSeenParamsSchema.parse(request.params);
    const ref = legendRepository.legendEventRef(viewer.viewerId, params.eventId);
    await ref.set(
      { seen: true, seenAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    incrementDbOps("writes", 1);
    return success({ routeName: legendsEventsSeenContract.routeName, eventId: params.eventId, seen: true });
  });
}

