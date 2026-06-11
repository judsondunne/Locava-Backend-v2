import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { renderPlacesVisualizerPage } from "../../dashboard/places-visualizer.js";
import {
  buildPlaceImageCurationMeta,
  curatePlaceImageSearchResults,
} from "../../lib/pbf/curatePlaceImageSearchResults.js";
import {
  hasPlaceImageSearchApiKey,
  parsePlaceQueries,
  searchPlaceImages,
} from "../../lib/places/searchPlaceImages.service.js";
import { setRouteName } from "../../observability/request-context.js";
import type {
  PlaceImageBatchSearchSuccess,
  PlaceImageSearchError,
  PlaceImageSearchResponse,
  PlaceImageSearchSuccess,
  PlaceWithPhotos,
} from "../../types/places.js";

const SearchImagesBodySchema = z.object({
  placeName: z.string().trim().min(1).max(4000),
  strictTitleSourceMatch: z.boolean().optional(),
  scoringProfile: z.enum(["admin_strict", "undiscovered_app"]).optional(),
});

function curatePlaceResults(
  query: ReturnType<typeof parsePlaceQueries>[number],
  rawResults: Awaited<ReturnType<typeof searchPlaceImages>>["results"],
  source: "bing" | "serper" | "mock",
  options: {
    strictTitleSourceMatch: boolean;
    scoringProfile: "admin_strict" | "undiscovered_app";
  },
): PlaceWithPhotos {
  const curated = curatePlaceImageSearchResults(query, rawResults, options);
  const curation = buildPlaceImageCurationMeta(curated, rawResults.length, options);
  const warnings = curation.warnings.join(" ");
  const appMode = options.scoringProfile === "undiscovered_app";
  let error: string | undefined;
  if (rawResults.length === 0) {
    error = `No image results returned for "${query.displayName}".`;
  } else if (!curation.assetsReady) {
    error =
      curation.assetStatus === "skipped"
        ? warnings || "Place identity too generic for safe image lookup."
        : warnings ||
          (appMode
            ? "No good photos found — undiscovered app scoring rejected all results."
            : "No good photos found — strict metadata match rejected all results.");
  }
  return {
    placeName: query.displayName,
    searchQuery: query.searchQuery,
    results: curated.acceptedAssets,
    source,
    curation,
    error,
  };
}

export function registerPlacesVisualizerRoutes(app: FastifyInstance): void {
  app.get("/dashboard/places-visualizer", async (_request, reply) => {
    setRouteName("dashboard.places_visualizer.page");
    reply.type("text/html; charset=utf-8");
    return reply.send(renderPlacesVisualizerPage());
  });

  app.post("/api/places/search-images", async (request, reply) => {
    setRouteName("api.places.search_images.post");
    const env = app.config as AppEnv;

    let body: unknown;
    try {
      body = request.body ?? {};
    } catch {
      const payload: PlaceImageSearchError = {
        ok: false,
        error: "Request body must be valid JSON.",
        code: "INVALID_REQUEST",
      };
      return reply.status(400).send(payload);
    }

    const parsed = SearchImagesBodySchema.safeParse(body);
    if (!parsed.success) {
      const payload: PlaceImageSearchError = {
        ok: false,
        error: "placeName is required and must be a non-empty string.",
        code: "INVALID_REQUEST",
      };
      return reply.status(400).send(payload);
    }

    const scoringProfile = parsed.data.scoringProfile ?? "admin_strict";
    const strictTitleSourceMatch =
      scoringProfile === "undiscovered_app"
        ? false
        : parsed.data.strictTitleSourceMatch !== false;
    const curationOptions = { strictTitleSourceMatch, scoringProfile };
    const placeQueries = parsePlaceQueries(parsed.data.placeName);
    if (placeQueries.length === 0) {
      const payload: PlaceImageSearchError = {
        ok: false,
        error: "placeName is required and must be a non-empty string.",
        code: "INVALID_REQUEST",
      };
      return reply.status(400).send(payload);
    }

    if (placeQueries.length > 20) {
      const payload: PlaceImageSearchError = {
        ok: false,
        error: "Provide at most 20 lines (one place per line) per search.",
        code: "INVALID_REQUEST",
      };
      return reply.status(400).send(payload);
    }

    try {
      if (placeQueries.length === 1) {
        const query = placeQueries[0]!;
        const { results: rawResults, source } = await searchPlaceImages(query, env, { resultLimit: 12 });
        const place = curatePlaceResults(query, rawResults, source, curationOptions);

        if (rawResults.length === 0) {
          const payload: PlaceImageSearchError = {
            ok: false,
            error: hasPlaceImageSearchApiKey(env)
              ? `No image results found for "${query.displayName}".`
              : `No mock results for "${query.displayName}". Try one of the preset locations or configure SERPER_API_KEY / BING_SEARCH_API_KEY.`,
            code: "NOT_FOUND",
          };
          return reply.status(404).send(payload);
        }

        const payload: PlaceImageSearchSuccess = {
          ok: true,
          placeName: place.placeName,
          searchQuery: place.searchQuery,
          results: place.results,
          source: place.source,
          curation: place.curation,
        };
        return reply.status(200).send(payload satisfies PlaceImageSearchResponse);
      }

      const places: PlaceWithPhotos[] = await Promise.all(
        placeQueries.map(async (query) => {
          try {
            const { results: rawResults, source } = await searchPlaceImages(query, env, { resultLimit: 12 });
            return curatePlaceResults(query, rawResults, source, curationOptions);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Image search provider error.";
            return {
              placeName: query.displayName,
              searchQuery: query.searchQuery,
              results: [],
              source: "mock" as const,
              error: message,
            };
          }
        }),
      );

      const withRaw = places.filter((place) => (place.curation?.rawResultCount ?? 0) > 0);
      if (withRaw.length === 0) {
        const payload: PlaceImageSearchError = {
          ok: false,
          error: "No image results found for any of the requested places.",
          code: "NOT_FOUND",
        };
        return reply.status(404).send(payload);
      }

      const payload: PlaceImageBatchSearchSuccess = {
        ok: true,
        query: parsed.data.placeName,
        places,
      };
      return reply.status(200).send(payload satisfies PlaceImageSearchResponse);
    } catch (upstreamError) {
      const message =
        upstreamError instanceof Error
          ? upstreamError.message
          : "Image search provider error.";

      request.log.error(
        { placeQueries: placeQueries.map((q) => q.displayName), message },
        "places.search_images.upstream_failure",
      );

      const payload: PlaceImageSearchError = {
        ok: false,
        error: message,
        code: "UPSTREAM_ERROR",
      };
      return reply.status(502).send(payload);
    }
  });
}
