import { z } from "zod";
import { defineContract } from "../conventions.js";

export const MAP_LAYER_UNDISCOVERED_V1_ID = "undiscovered_osm_v1";

export const MapLayerCoordinateSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const MapLayerDetailRefSchema = z.object({
  type: z.enum(["unexploredSpot", "unexploredRoute", "post"]),
  id: z.string(),
});

export const MapLayerOsmMetaSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  tagsSummary: z.record(z.string()).optional(),
});

export const MapLayerRouteSummarySchema = z.object({
  pointCount: z.number().int().nonnegative(),
  geometrySource: z.string(),
  routePreviewCoordinates: z.array(MapLayerCoordinateSchema),
  encodedPolyline: z.string().optional(),
  simplifiedLevel: z.enum(["low", "medium", "full"]).optional(),
  routeLineColor: z.string().optional(),
  trailLike: z.boolean().optional(),
  lineWidth: z.number().positive().optional(),
  lineOpacity: z.number().min(0).max(1).optional(),
  showTrailStartDot: z.boolean().optional(),
});

export const MapLayerPointFeatureSchema = z.object({
  id: z.string(),
  layerKind: z.literal("undiscovered"),
  featureKind: z.literal("point"),
  source: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  emoji: z.string().optional(),
  iconKey: z.string().optional(),
  category: z.string().optional(),
  activities: z.array(z.string()).optional(),
  publicMapEligible: z.boolean(),
  osm: MapLayerOsmMetaSchema.optional(),
  detailRef: MapLayerDetailRefSchema,
  updatedAt: z.union([z.string(), z.number()]).optional(),
});

export const MapLayerRouteAnchorSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  reason: z.enum(["trailhead", "parking", "line_start", "line_end_near_road", "centroid_fallback"]),
});

export const MapLayerClusterFeatureSchema = z.object({
  id: z.string(),
  layerKind: z.literal("undiscovered"),
  featureKind: z.literal("cluster"),
  latitude: z.number(),
  longitude: z.number(),
  count: z.number().int().nonnegative(),
  pointCount: z.number().int().nonnegative(),
  routeCount: z.number().int().nonnegative(),
});

export const MapLayerRouteFeatureSchema = z.object({
  id: z.string(),
  layerKind: z.literal("undiscovered"),
  featureKind: z.literal("route"),
  source: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  centroid: MapLayerCoordinateSchema.optional(),
  routeAnchor: MapLayerRouteAnchorSchema.optional(),
  routeLengthMeters: z.number().nonnegative().optional(),
  routeConfidence: z.enum(["high", "medium", "low"]).optional(),
  emoji: z.string().optional(),
  iconKey: z.string().optional(),
  category: z.string().optional(),
  activities: z.array(z.string()).optional(),
  publicMapEligible: z.boolean(),
  routeSummary: MapLayerRouteSummarySchema,
  osm: MapLayerOsmMetaSchema.optional(),
  detailRef: MapLayerDetailRefSchema,
  updatedAt: z.union([z.string(), z.number()]).optional(),
});

export const MapLayerFeatureSchema = z.discriminatedUnion("featureKind", [
  MapLayerPointFeatureSchema,
  MapLayerRouteFeatureSchema,
  MapLayerClusterFeatureSchema,
]);

export const UndiscoveredMapLayerResponseSchema = z.object({
  routeName: z.literal("map.layers.undiscovered.get"),
  layerId: z.string(),
  layerVersion: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  zoom: z.number().optional(),
  mode: z.enum(["durable", "viewport"]).optional(),
  source: z.enum(["bbox", "tile", "cache", "fallback"]),
  features: z.array(MapLayerFeatureSchema),
  counts: z.object({
    points: z.number().int().nonnegative(),
    routes: z.number().int().nonnegative(),
    routeGeometries: z.number().int().nonnegative(),
    clustersCount: z.number().int().nonnegative().optional(),
    individualPoiCount: z.number().int().nonnegative().optional(),
    routeAnchorCount: z.number().int().nonnegative().optional(),
    routeLineCount: z.number().int().nonnegative().optional(),
    hiddenDueToZoomCount: z.number().int().nonnegative().optional(),
    hiddenDueToDensityCount: z.number().int().nonnegative().optional(),
    lowConfidenceRouteCount: z.number().int().nonnegative().optional(),
    mergedRouteFragmentCount: z.number().int().nonnegative().optional(),
  }),
  diagnostics: z
    .object({
      payloadBytes: z.number().int().nonnegative().optional(),
      reads: z.number().int().nonnegative().optional(),
      docsScanned: z.number().int().nonnegative().optional(),
      cacheHit: z.boolean().optional(),
      cacheSource: z.enum(["miss", "hit"]).optional(),
      tileKeys: z.array(z.string()).optional(),
      droppedInvalid: z.number().int().nonnegative().optional(),
      droppedHidden: z.number().int().nonnegative().optional(),
      fetchMs: z.number().nonnegative().optional(),
    })
    .optional(),
  etag: z.string().optional(),
  generatedAt: z.number().int().nonnegative(),
});

export type MapLayerPointFeature = z.infer<typeof MapLayerPointFeatureSchema>;
export type MapLayerRouteFeature = z.infer<typeof MapLayerRouteFeatureSchema>;
export type MapLayerFeature = z.infer<typeof MapLayerFeatureSchema>;
export type UndiscoveredMapLayerResponse = z.infer<typeof UndiscoveredMapLayerResponseSchema>;

export const undiscoveredMapLayerContract = defineContract({
  routeName: "map.layers.undiscovered.get",
  method: "GET",
  path: "/v2/map/layers/undiscovered",
  query: z.object({
    bbox: z.string().min(1),
    zoom: z.coerce.number().int().min(1).max(20).optional(),
    mode: z.enum(["durable", "viewport"]).default("durable"),
    layerVersion: z.string().optional(),
  }),
  body: z.object({}).strict(),
  response: UndiscoveredMapLayerResponseSchema,
});
