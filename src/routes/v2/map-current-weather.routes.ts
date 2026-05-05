import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { loadEnv } from "../../config/env.js";
import { mapCurrentWeatherContract, MapCurrentWeatherQuerySchema } from "../../contracts/surfaces/map-current-weather.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { MapCurrentWeatherService } from "../../services/surfaces/map-current-weather.service.js";

export async function registerV2MapCurrentWeatherRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();
  const service = new MapCurrentWeatherService(env.OPENWEATHER_API_KEY);

  app.get(mapCurrentWeatherContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("map", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Map v2 surface is not enabled for this viewer"));
    }

    const parsed = MapCurrentWeatherQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(failure("validation_error", "Invalid lat/lon", parsed.error.flatten()));
    }

    const { lat, lon } = parsed.data;
    setRouteName(mapCurrentWeatherContract.routeName);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let payload: Awaited<ReturnType<MapCurrentWeatherService["getCurrent"]>>;
    try {
      payload = await service.getCurrent({ lat, lon, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!payload) {
      return reply.status(502).send(failure("weather_upstream_error", "Unable to load weather from provider"));
    }

    return success(payload);
  });
}
