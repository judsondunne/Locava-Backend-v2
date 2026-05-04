import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  placesReverseGeocodeContract,
  PlacesReverseGeocodeQuerySchema,
} from "../../contracts/surfaces/places-reverse-geocode.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { normalizeCanonicalPostLocation } from "../../lib/location/post-location-normalizer.js";
import { resolveReverseGeocodeDetails } from "../../lib/location/reverse-geocode.js";

const reverseGeocodeCache = new Map<string, { expiresAtMs: number; match: Awaited<ReturnType<typeof resolveReverseGeocodeDetails>> }>();

export async function registerV2PlacesReverseGeocodeRoutes(app: FastifyInstance): Promise<void> {
  app.get(placesReverseGeocodeContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Places v2 surface is not enabled for this viewer"));
    }
    const query = PlacesReverseGeocodeQuerySchema.parse(request.query);
    setRouteName(placesReverseGeocodeContract.routeName);
    const lng = query.lng ?? query.lon;
    const startedAt = Date.now();
    const roundedLat = Math.round(query.lat * 1_000) / 1_000;
    const roundedLng = lng == null ? null : Math.round(lng * 1_000) / 1_000;
    const cacheKey = roundedLng == null ? null : `${roundedLat}:${roundedLng}`;
    const cached = cacheKey ? reverseGeocodeCache.get(cacheKey) : undefined;
    const freshCached = cached && cached.expiresAtMs > Date.now() ? cached.match : null;
    const match = lng == null
      ? null
      : freshCached ??
        await resolveReverseGeocodeDetails({
          lat: query.lat,
          lng,
          allowNetwork: true,
          timeoutMs: 180,
        });
    if (cacheKey && match) {
      reverseGeocodeCache.set(cacheKey, { expiresAtMs: Date.now() + 5 * 60_000, match });
    }
    const location = normalizeCanonicalPostLocation({
      latitude: query.lat,
      longitude: lng ?? null,
      addressDisplayName: match?.addressDisplayName ?? null,
      city: match?.city ?? null,
      region: match?.region ?? null,
      country: match?.country ?? null,
      source: "user_selected",
      reverseGeocodeMatched: match?.matched === true
    });
    request.log.info({
      event: "places_reverse_geocode_summary",
      lat: query.lat,
      lng: lng ?? null,
      success: Boolean(match),
      source: match?.source ?? null,
      address: location.addressDisplayName,
      city: location.city,
      region: location.region,
      county: match?.county ?? null,
      country: location.country,
      fallbackPrecision: location.fallbackPrecision,
      reverseGeocodeStatus: location.reverseGeocodeStatus,
      elapsedMs: Date.now() - startedAt,
    });
    return success({
      routeName: "places.reverse_geocode.get" as const,
      success: Boolean(match),
      address: location.addressDisplayName,
      locationDisplayName: location.locationDisplayName,
      fallbackPrecision: location.fallbackPrecision,
      reverseGeocodeStatus: location.reverseGeocodeStatus,
      city: location.city,
      region: location.region,
      country: location.country,
      county: match?.county ?? null,
      match: match
        ? {
            text: match.city ?? match.addressDisplayName ?? "Unknown",
            stateName: match.region ?? "Unknown",
            lat: query.lat,
            lng,
          }
        : null,
    });
  });
}
