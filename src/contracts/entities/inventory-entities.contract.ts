import { z } from "zod";

export const InventoryBboxSchema = z.object({
  minLat: z.number().min(-90).max(90),
  minLng: z.number().min(-180).max(180),
  maxLat: z.number().min(-90).max(90),
  maxLng: z.number().min(-180).max(180),
});

export const InventoryAttributionSchema = z.object({
  source: z.string(),
  sourceId: z.string().optional(),
  license: z.string().optional(),
  url: z.string().optional(),
});

export const InventorySpotStatusSchema = z.enum(["staged", "active", "hidden", "rejected"]);
export const InventoryRouteStatusSchema = z.enum(["staged", "active", "hidden", "rejected"]);
export const InventorySourceSchema = z.enum(["osm", "fixture", "manual", "other"]);
export const InventorySpotSourceTypeSchema = z.enum(["node", "way", "relation", "fixture"]);
export const InventoryRouteSourceTypeSchema = z.enum(["way", "relation", "fixture"]);
export const InventoryRouteActivitySchema = z.enum(["hiking", "walking", "running", "biking", "offroading", "other"]);

export const InventorySpotSchema = z.object({
  id: z.string(),
  kind: z.literal("inventory_spot"),
  source: InventorySourceSchema,
  sourceType: InventorySpotSourceTypeSchema.optional(),
  sourceId: z.string(),
  sourceKey: z.string(),
  name: z.string(),
  normalizedName: z.string(),
  category: z.string(),
  categories: z.array(z.string()),
  activities: z.array(z.string()),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  geohash: z.string().optional(),
  bbox: InventoryBboxSchema.optional(),
  regionKey: z.string(),
  hasMedia: z.literal(false),
  linkedPostCount: z.number().int().nonnegative(),
  qualityScore: z.number().min(0).max(100),
  status: InventorySpotStatusSchema,
  tags: z.record(z.unknown()),
  attribution: InventoryAttributionSchema,
  importRunId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const InventoryRouteCenterSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const InventoryRouteCoordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const InventoryRouteSchema = z.object({
  id: z.string(),
  kind: z.literal("inventory_route"),
  source: InventorySourceSchema,
  sourceType: InventoryRouteSourceTypeSchema.optional(),
  sourceId: z.string(),
  sourceKey: z.string(),
  name: z.string(),
  normalizedName: z.string(),
  activity: InventoryRouteActivitySchema,
  categories: z.array(z.string()),
  activities: z.array(z.string()),
  center: InventoryRouteCenterSchema,
  bbox: InventoryBboxSchema,
  distanceMeters: z.number().nonnegative().optional(),
  encodedPolyline: z.string().optional(),
  coordinates: z.array(InventoryRouteCoordinateSchema).optional(),
  simplifiedPolylines: z.record(z.string()).optional(),
  regionKey: z.string(),
  hasMedia: z.literal(false),
  linkedPostCount: z.number().int().nonnegative(),
  qualityScore: z.number().min(0).max(100),
  status: InventoryRouteStatusSchema,
  tags: z.record(z.unknown()),
  attribution: InventoryAttributionSchema,
  importRunId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const InventoryTileSpotSummarySchema = z.object({
  id: z.string(),
  kind: z.literal("inventory_spot"),
  name: z.string(),
  category: z.string(),
  categories: z.array(z.string()),
  activities: z.array(z.string()),
  lat: z.number(),
  lng: z.number(),
  qualityScore: z.number(),
  hasMedia: z.literal(false),
});

export const InventoryTileRouteSummarySchema = z.object({
  id: z.string(),
  kind: z.literal("inventory_route"),
  name: z.string(),
  activity: z.string(),
  categories: z.array(z.string()),
  activities: z.array(z.string()),
  center: InventoryRouteCenterSchema,
  bbox: InventoryBboxSchema,
  distanceMeters: z.number().optional(),
  encodedPolyline: z.string().optional(),
  qualityScore: z.number(),
  hasMedia: z.literal(false),
});

export const InventoryTilePayloadSchema = z.object({
  tileKey: z.string(),
  z: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  version: z.string(),
  generatedAt: z.string(),
  spots: z.array(InventoryTileSpotSummarySchema),
  routes: z.array(InventoryTileRouteSummarySchema),
});

export const InventoryImportRunStatusSchema = z.enum([
  "created",
  "dry_run_running",
  "dry_run_complete",
  "staged",
  "commit_running",
  "committed",
  "tile_build_running",
  "tiles_built",
  "published",
  "failed",
  "rolled_back",
]);

export const InventoryCommitTargetSchema = z.enum(["none", "emulator", "production"]);

export const InventoryImportCountsSchema = z.object({
  rawObjects: z.number().int().nonnegative(),
  acceptedSpots: z.number().int().nonnegative(),
  acceptedRoutes: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  tilesGenerated: z.number().int().nonnegative(),
  firestoreSpotWrites: z.number().int().nonnegative(),
  firestoreRouteWrites: z.number().int().nonnegative(),
  firestoreTileWrites: z.number().int().nonnegative(),
});

export const InventoryImportIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  sample: z.unknown().optional(),
});

export const InventoryImportRunSchema = z.object({
  runId: z.string(),
  source: z.string(),
  regionKey: z.string(),
  regionLabel: z.string(),
  bbox: InventoryBboxSchema,
  status: InventoryImportRunStatusSchema,
  dryRun: z.boolean(),
  commitTarget: InventoryCommitTargetSchema,
  counts: InventoryImportCountsSchema,
  errors: z.array(InventoryImportIssueSchema),
  warnings: z.array(InventoryImportIssueSchema),
  sampleSpots: z.array(InventorySpotSchema),
  sampleRoutes: z.array(InventoryRouteSchema),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  committedAt: z.string().optional(),
  tilesBuiltAt: z.string().optional(),
  publishedAt: z.string().optional(),
});

export const InventoryImportDryRunResultSchema = z.object({
  run: InventoryImportRunSchema,
  stagedSpots: z.array(InventorySpotSchema),
  stagedRoutes: z.array(InventoryRouteSchema),
});

export const InventoryCommitResultSchema = z.object({
  runId: z.string(),
  commitTarget: InventoryCommitTargetSchema,
  spotWrites: z.number().int().nonnegative(),
  routeWrites: z.number().int().nonnegative(),
  runWrite: z.boolean(),
});

export const InventoryTileBuildResultSchema = z.object({
  runId: z.string(),
  tilesGenerated: z.number().int().nonnegative(),
  tileWrites: z.number().int().nonnegative(),
  dryRun: z.boolean(),
  tiles: z.array(InventoryTilePayloadSchema),
  zoomRange: z.object({ minZ: z.number().int(), maxZ: z.number().int() }),
});

export type InventoryBbox = z.infer<typeof InventoryBboxSchema>;
export type InventorySpot = z.infer<typeof InventorySpotSchema>;
export type InventoryRoute = z.infer<typeof InventoryRouteSchema>;
export type InventoryTilePayload = z.infer<typeof InventoryTilePayloadSchema>;
export type InventoryImportRun = z.infer<typeof InventoryImportRunSchema>;
export type InventoryImportRunStatus = z.infer<typeof InventoryImportRunStatusSchema>;
export type InventoryImportDryRunResult = z.infer<typeof InventoryImportDryRunResultSchema>;
export type InventoryCommitResult = z.infer<typeof InventoryCommitResultSchema>;
export type InventoryTileBuildResult = z.infer<typeof InventoryTileBuildResultSchema>;
export type InventoryCommitTarget = z.infer<typeof InventoryCommitTargetSchema>;

export function emptyInventoryImportCounts(): z.infer<typeof InventoryImportCountsSchema> {
  return {
    rawObjects: 0,
    acceptedSpots: 0,
    acceptedRoutes: 0,
    rejected: 0,
    duplicates: 0,
    tilesGenerated: 0,
    firestoreSpotWrites: 0,
    firestoreRouteWrites: 0,
    firestoreTileWrites: 0,
  };
}
