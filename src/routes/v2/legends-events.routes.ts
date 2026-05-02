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
import { loadUnseenLegendEventsFast } from "../../domains/legends/legend-events-unseen.service.js";

export async function registerV2LegendsEventsRoutes(app: FastifyInstance): Promise<void> {
  app.get(legendsEventsUnseenContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Legends v2 surface is not enabled for this viewer"));
    }
    setRouteName(legendsEventsUnseenContract.routeName);
    const loaded = await loadUnseenLegendEventsFast({ viewerId: viewer.viewerId, log: request.log });
    incrementDbOps("queries", loaded.dbQueries);
    incrementDbOps("reads", loaded.dbReads);
    const events = loaded.events;
    const nextPoll = loaded.degraded ? 60_000 : events.length > 0 ? 0 : 120_000;
    return success({
      routeName: legendsEventsUnseenContract.routeName,
      events,
      count: events.length,
      nextPollAfterMs: nextPoll,
      ...(loaded.degraded ? { degraded: true as const, reason: loaded.reason } : {}),
      debugTimingsMs: loaded.debugTimingsMs
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

