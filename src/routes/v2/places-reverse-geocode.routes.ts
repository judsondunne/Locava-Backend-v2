import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  placesReverseGeocodeContract,
  PlacesReverseGeocodeQuerySchema,
} from "../../contracts/surfaces/places-reverse-geocode.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { searchPlacesIndexService } from "../../services/surfaces/search-places-index.service.js";

export async function registerV2PlacesReverseGeocodeRoutes(app: FastifyInstance): Promise<void> {
  app.get(placesReverseGeocodeContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Places v2 surface is not enabled for this viewer"));
    }
    const query = PlacesReverseGeocodeQuerySchema.parse(request.query);
    setRouteName(placesReverseGeocodeContract.routeName);
    const lng = query.lng ?? query.lon;
    const match = lng == null ? null : searchPlacesIndexService.reverseLookup(query.lat, lng);
    return success({
      routeName: "places.reverse_geocode.get" as const,
      success: Boolean(match),
      address: match ? `${match.text}, ${match.stateName}` : null,
      match: match
        ? {
            text: match.text,
            stateName: match.stateName,
            lat: match.lat,
            lng: match.lng,
          }
        : null,
    });
  });
}
