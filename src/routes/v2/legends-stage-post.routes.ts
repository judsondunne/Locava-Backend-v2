import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { legendsStagePostContract, LegendsStagePostBodySchema } from "../../contracts/surfaces/legends-stage-post.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { legendService } from "../../domains/legends/legend.service.js";
import { encodeGeohash } from "../../lib/latlng-geohash.js";
import { resolveReverseGeocodeDetails } from "../../lib/location/reverse-geocode.js";

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export async function registerV2LegendsStagePostRoutes(app: FastifyInstance): Promise<void> {
  app.post(legendsStagePostContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Legends v2 surface is not enabled for this viewer"));
    }
    setRouteName(legendsStagePostContract.routeName);
    const startedAt = Date.now();
    const body = LegendsStagePostBodySchema.parse(request.body);
    const lat = toFiniteNumber(body.lat);
    const lng = toFiniteNumber(body.lng);
    const derivedGeohash =
      body.geohash ??
      (lat != null && lng != null
        ? encodeGeohash(lat, lng, 9)
        : null);
    const needsLocationBackfill = !body.city || !body.state || !body.country;
    const reverse =
      needsLocationBackfill && lat != null && lng != null
        ? await resolveReverseGeocodeDetails({
            lat,
            lng,
            allowNetwork: true,
            timeoutMs: 650,
          })
        : null;
    request.log.info({
      event: "legends_stage_post_input",
      viewerId: viewer.viewerId,
      userId: body.userId?.trim() || viewer.viewerId,
      lat: lat ?? null,
      lng: lng ?? null,
      geohashProvided: Boolean(body.geohash),
      geohashDerived: derivedGeohash,
      activityCount: (body.activityIds ?? []).length,
      hasCity: Boolean(body.city),
      hasState: Boolean(body.state),
      hasCountry: Boolean(body.country),
      reverseBackfillApplied: Boolean(reverse),
      reverseCity: reverse?.city ?? null,
      reverseRegion: reverse?.region ?? null,
      reverseCounty: reverse?.county ?? null,
      reverseCountry: reverse?.country ?? null
    });
    const payload = await legendService.stagePost({
      userId: body.userId?.trim() || viewer.viewerId,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      geohash: derivedGeohash,
      activityIds: body.activityIds ?? [],
      city: body.city ?? reverse?.city ?? null,
      state: body.state ?? reverse?.region ?? null,
      country: body.country ?? reverse?.country ?? null,
      region: body.region ?? reverse?.county ?? reverse?.region ?? null
    });
    request.log.info({
      event: "legends_stage_post_output",
      viewerId: viewer.viewerId,
      stageId: payload.stageId,
      derivedScopeCount: payload.derivedScopes.length,
      previewCardCount: payload.previewCards.length,
      derivedScopes: payload.derivedScopes,
      elapsedMs: Date.now() - startedAt
    });
    return success({
      routeName: legendsStagePostContract.routeName,
      stageId: payload.stageId,
      derivedScopes: payload.derivedScopes,
      previewCards: payload.previewCards
    });
  });
}

