import { z } from "zod";
import { InventoryBboxSchema } from "./inventory-entities.contract.js";

export const OsmNationalRunStatusSchema = z.enum([
  "created",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const OsmNationalWriteTargetSchema = z.enum(["none", "emulator", "production"]);

export const OsmNationalTileBuildModeSchema = z.enum(["none", "per_chunk", "per_state", "after_run"]);

export const OsmNationalRunConfigSchema = z.object({
  states: z.array(z.string()),
  chunkSizeKm: z.number().positive(),
  maxConcurrentStates: z.number().int().positive(),
  maxConcurrentChunks: z.number().int().positive(),
  maxWritesPerSecond: z.number().nonnegative(),
  maxChunksPerMinute: z.number().nonnegative(),
  includeOsmSpots: z.boolean(),
  includeOsmRoutes: z.boolean(),
  includeOffroad: z.boolean(),
  includePublicOnly: z.boolean(),
  includeReviewItems: z.boolean(),
  skipCompletedChunks: z.boolean(),
  forceReprocess: z.boolean(),
  dryRunOnly: z.boolean(),
  tileBuildMode: OsmNationalTileBuildModeSchema,
  maxTotalWrites: z.number().int().nonnegative().optional(),
  maxWritesPerMinute: z.number().nonnegative().optional(),
  maxStateWrites: z.number().int().nonnegative().optional(),
  maxChunkWrites: z.number().int().nonnegative().optional(),
  stopOnBudgetExceeded: z.boolean().optional(),
  pauseOnErrorRateAbovePercent: z.number().min(0).max(100).optional(),
});

export const OsmNationalProgressSchema = z.object({
  totalStates: z.number().int().nonnegative(),
  completedStates: z.number().int().nonnegative(),
  failedStates: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
  completedChunks: z.number().int().nonnegative(),
  runningChunks: z.number().int().nonnegative(),
  failedChunks: z.number().int().nonnegative(),
  skippedChunks: z.number().int().nonnegative(),
  estimatedTotalChunks: z.number().int().nonnegative(),
  percentComplete: z.number().min(0).max(100),
  etaSeconds: z.number().nonnegative().nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const OsmNationalCountsSchema = z.object({
  rawObjects: z.number().int().nonnegative(),
  acceptedSpots: z.number().int().nonnegative(),
  acceptedRoutes: z.number().int().nonnegative(),
  acceptedOffroadRoutes: z.number().int().nonnegative(),
  rejectedObjects: z.number().int().nonnegative(),
  duplicateSuppressed: z.number().int().nonnegative(),
  writtenSpots: z.number().int().nonnegative(),
  writtenRoutes: z.number().int().nonnegative(),
  writtenTiles: z.number().int().nonnegative(),
  skippedExisting: z.number().int().nonnegative(),
  writeErrors: z.number().int().nonnegative(),
  readOperationsEstimated: z.number().int().nonnegative(),
  writeOperationsEstimated: z.number().int().nonnegative(),
});

export const OsmNationalCurrentActivitySchema = z.object({
  stateCode: z.string().nullable(),
  chunkId: z.string().nullable(),
  step: z.string().nullable(),
  message: z.string().nullable(),
  startedAt: z.string().nullable(),
});

export const OsmNationalSafetySchema = z.object({
  productionWritesBlockedByDefault: z.boolean(),
  productionWriteConfirmed: z.boolean(),
  maxWriteBudget: z.number().int().nonnegative(),
  stoppedBecauseBudgetExceeded: z.boolean(),
});

export const OsmNationalRunSchema = z.object({
  runId: z.string(),
  runType: z.literal("national_osm_unexplored_import"),
  status: OsmNationalRunStatusSchema,
  writeMode: z.boolean(),
  writeTarget: OsmNationalWriteTargetSchema,
  confirmProductionWrite: z.string().optional(),
  config: OsmNationalRunConfigSchema,
  progress: OsmNationalProgressSchema,
  counts: OsmNationalCountsSchema,
  currentActivity: OsmNationalCurrentActivitySchema,
  safety: OsmNationalSafetySchema,
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const OsmStateRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "paused",
  "cancelled",
]);

export const OsmStateRunSchema = z.object({
  runId: z.string(),
  stateCode: z.string(),
  stateName: z.string(),
  status: OsmStateRunStatusSchema,
  bbox: InventoryBboxSchema,
  progress: z.object({
    totalChunks: z.number().int().nonnegative(),
    completedChunks: z.number().int().nonnegative(),
    failedChunks: z.number().int().nonnegative(),
    skippedChunks: z.number().int().nonnegative(),
    percentComplete: z.number().min(0).max(100),
    etaSeconds: z.number().nonnegative().nullable(),
  }),
  counts: OsmNationalCountsSchema,
  enabledSources: z.object({
    osm: z.boolean(),
    offroadFederal: z.boolean(),
    offroadState: z.boolean(),
  }),
  currentChunkId: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const OsmChunkRunStatusSchema = z.enum([
  "pending",
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const OsmChunkCheckpointSchema = z.object({
  fetchStartedAt: z.string().nullable(),
  fetchCompletedAt: z.string().nullable(),
  classifyStartedAt: z.string().nullable(),
  classifyCompletedAt: z.string().nullable(),
  writeStartedAt: z.string().nullable(),
  writeCompletedAt: z.string().nullable(),
  tileStartedAt: z.string().nullable(),
  tileCompletedAt: z.string().nullable(),
});

export const OsmChunkRunSchema = z.object({
  runId: z.string(),
  stateCode: z.string(),
  chunkId: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  bbox: InventoryBboxSchema,
  status: OsmChunkRunStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  lockedBy: z.string().nullable(),
  lockExpiresAt: z.string().nullable(),
  checkpoint: OsmChunkCheckpointSchema,
  counts: OsmNationalCountsSchema,
  samples: z.object({
    acceptedSpotNames: z.array(z.string()),
    acceptedRouteNames: z.array(z.string()),
    offroadNames: z.array(z.string()),
    rejectedReasons: z.array(z.string()),
  }),
  artifactRefs: z.object({
    rawJsonPath: z.string().optional(),
    diagnosticsPath: z.string().optional(),
    rejectedSummaryPath: z.string().optional(),
    tilePreviewPath: z.string().optional(),
  }),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const OsmNationalEventLevelSchema = z.enum(["info", "warn", "error"]);

export const OsmNationalEventTypeSchema = z.enum([
  "run_started",
  "state_started",
  "chunk_started",
  "fetching_osm",
  "fetching_offroad",
  "classifying",
  "writing",
  "chunk_completed",
  "chunk_failed",
  "state_completed",
  "budget_warning",
  "paused",
  "resumed",
  "cancelled",
]);

export const OsmNationalEventSchema = z.object({
  eventId: z.string(),
  runId: z.string(),
  stateCode: z.string().optional(),
  chunkId: z.string().optional(),
  level: OsmNationalEventLevelSchema,
  type: OsmNationalEventTypeSchema,
  message: z.string(),
  counts: z.record(z.number()).optional(),
  createdAt: z.string(),
});

export const UnexploredImportBlockSchema = z.object({
  runId: z.string(),
  stateCode: z.string(),
  chunkId: z.string(),
  importedAt: z.string(),
  pipelineVersion: z.string(),
  writeMode: z.boolean(),
  writeTarget: OsmNationalWriteTargetSchema,
});

export const UnexploredAuditBlockSchema = z.object({
  createdBy: z.literal("national_osm_importer"),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSeenAt: z.string(),
  sourceUpdatedAt: z.string().optional(),
  contentHash: z.string(),
  geometryHash: z.string().optional(),
});

export const UnexploredClassificationBlockSchema = z.object({
  algorithmVersion: z.string(),
  reason: z.string(),
  tagSignals: z.array(z.string()),
  negativeSignals: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const UnexploredSpotSchema = z.object({
  id: z.string(),
  kind: z.literal("unexplored_spot"),
  itemType: z.literal("undiscovered_spot"),
  sourceCollection: z.literal("unexploredSpots"),
  origin: z.literal("generated_osm"),
  sourceFamily: z.string(),
  sourceIds: z.array(z.string()),
  sourceKeys: z.array(z.string()),
  sourceAttribution: z.record(z.unknown()),
  sourceDatasets: z.array(z.string()),
  displayName: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  rawName: z.string().nullable().optional(),
  titleQuality: z.string().optional(),
  primaryActivity: z.string().nullable().optional(),
  activities: z.array(z.string()),
  activityWeights: z.record(z.number()).optional(),
  searchableAliases: z.array(z.string()).optional(),
  searchText: z.string().optional(),
  searchBoostTerms: z.array(z.string()).optional(),
  category: z.string(),
  categories: z.array(z.string()),
  placeKind: z.string().optional(),
  parentPlaceId: z.string().optional(),
  parentPlaceName: z.string().optional(),
  childFeatureTypes: z.array(z.string()).optional(),
  lat: z.number(),
  lng: z.number(),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    geohash: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
  }),
  displayCenter: z.object({ lat: z.number(), lng: z.number() }).optional(),
  areaCenter: z.object({ lat: z.number(), lng: z.number() }).optional(),
  bbox: InventoryBboxSchema.optional(),
  geohash: z.string().optional(),
  /** Web Mercator tile keys (z/x/y) for z=10..15 — used for tile-index map reads. */
  mapTileKeys: z.array(z.string()).optional(),
  /** Primary display tile at z=14. */
  primaryTileKey: z.string().optional(),
  mapReadiness: z.enum(["ready", "review", "hidden"]).optional(),
  publicMapEligible: z.boolean(),
  undiscovered: z.literal(true),
  needsCapture: z.literal(true),
  hasUserMedia: z.literal(false),
  mediaStatus: z.enum(["none", "candidate_found"]).optional(),
  existingMediaRefs: z.array(z.unknown()).optional(),
  parking: z.record(z.unknown()).optional(),
  trailhead: z.record(z.unknown()).optional(),
  accessStatus: z.string().optional(),
  accessWarnings: z.array(z.string()).optional(),
  seasonalWarnings: z.array(z.string()).optional(),
  confidence: z.string(),
  locavaScore: z.number(),
  displayPriority: z.string(),
  showAtZoom: z.number(),
  sourceTags: z.record(z.unknown()),
  source: z.object({
    provider: z.enum(["openstreetmap", "geofabrik_pbf"]),
    osmType: z.enum(["node", "way", "relation"]).optional(),
    osmId: z.union([z.string(), z.number()]).optional(),
    tags: z.record(z.string()).optional(),
    wikidata: z.string().optional(),
    wikipedia: z.string().optional(),
    website: z.string().optional(),
    image: z.string().optional(),
    mapillary: z.string().optional(),
  }),
  status: z.object({
    undiscovered: z.literal(true),
    needsCapture: z.literal(true),
    hasUserMedia: z.literal(false),
    publicMapEligible: z.boolean(),
    mapReadiness: z.enum(["ready", "review", "hidden"]),
  }),
  social: z.object({
    saveCount: z.number().int().nonnegative(),
    shareCount: z.number().int().nonnegative(),
    viewCount: z.number().int().nonnegative(),
  }),
  rawProperties: z.record(z.unknown()),
  classification: UnexploredClassificationBlockSchema,
  import: UnexploredImportBlockSchema,
  audit: UnexploredAuditBlockSchema,
  stateCode: z.string(),
});

export const UnexploredRouteGeometryStorageSchema = z.object({
  mode: z.enum(["inline", "artifact_ref", "chunked_subcollection"]),
  artifactRef: z.string().optional(),
  pointCount: z.number().int().nonnegative(),
  segmentCount: z.number().int().nonnegative(),
  geometryHash: z.string(),
});

export const UnexploredRouteSchema = z.object({
  id: z.string(),
  kind: z.literal("unexplored_route"),
  itemType: z.literal("undiscovered_route"),
  sourceCollection: z.literal("unexploredRoutes"),
  routeKind: z.string(),
  routeType: z.enum([
    "hiking_trail",
    "offroad_class4_road",
    "offroad_class6_road",
    "offroad_legal_trail",
    "offroad_candidate",
    "walking_route",
    "biking_route",
  ]),
  origin: z.literal("generated_osm"),
  sourceFamily: z.string(),
  sourceIds: z.array(z.string()),
  sourceKeys: z.array(z.string()),
  sourceAttribution: z.record(z.unknown()),
  sourceDatasets: z.array(z.string()),
  displayName: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  rawName: z.string().nullable().optional(),
  legalDisplayLabel: z.string().optional(),
  primaryActivity: z.string().nullable().optional(),
  activities: z.array(z.string()),
  activityWeights: z.record(z.number()).optional(),
  searchableAliases: z.array(z.string()).optional(),
  category: z.string().optional(),
  categories: z.array(z.string()),
  routeActivity: z.string(),
  offroadCategory: z.string().optional(),
  offroadConfidence: z.string().optional(),
  accessStatus: z.string().optional(),
  accessWarnings: z.array(z.string()).optional(),
  seasonalWarnings: z.array(z.string()).optional(),
  center: z.object({ lat: z.number(), lng: z.number() }),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    geohash: z.string().optional(),
  }),
  bbox: InventoryBboxSchema,
  distanceMeters: z.number(),
  distanceMiles: z.number(),
  distanceLabel: z.string(),
  geometryType: z.string(),
  encodedPolyline: z.string().optional(),
  simplifiedPolylines: z.record(z.string()).optional(),
  coordinatesPreview: z.array(z.object({ lat: z.number(), lng: z.number() })).optional(),
  geometry: z.object({
    pointCount: z.number().int().nonnegative(),
    encodedPolyline: z.string().optional(),
    previewPoints: z.array(z.object({ lat: z.number(), lng: z.number() })).optional(),
    geometryChunked: z.boolean(),
  }),
  geometryStorage: UnexploredRouteGeometryStorageSchema,
  selectedTrailhead: z.record(z.unknown()).nullable().optional(),
  selectedParking: z.record(z.unknown()).nullable().optional(),
  parkingCandidatesSummary: z.array(z.record(z.unknown())).optional(),
  trailheadCandidatesSummary: z.array(z.record(z.unknown())).optional(),
  parentPlaceId: z.string().optional(),
  parentPlaceName: z.string().optional(),
  mapReadiness: z.enum(["ready", "review", "hidden"]).optional(),
  /** Web Mercator tile keys (z/x/y) for map tile reads. */
  mapTileKeys: z.array(z.string()).optional(),
  /** Primary display tile at z=14. */
  primaryTileKey: z.string().optional(),
  publicMapEligible: z.boolean(),
  undiscovered: z.literal(true),
  needsCapture: z.literal(true),
  hasUserMedia: z.literal(false),
  confidence: z.string(),
  locavaScore: z.number(),
  displayPriority: z.string(),
  showAtZoom: z.number(),
  sourceTags: z.record(z.unknown()),
  source: z.object({
    provider: z.enum(["openstreetmap", "geofabrik_pbf", "vtrans", "nhdot", "usfs", "blm"]),
    osmType: z.enum(["way", "relation"]).optional(),
    osmId: z.union([z.string(), z.number()]).optional(),
    officialClass: z.enum(["VT_CLASS_4", "VT_LEGAL_TRAIL", "NH_CLASS_6"]).optional(),
    tags: z.record(z.string()).optional(),
  }),
  status: z.object({
    undiscovered: z.literal(true),
    needsCapture: z.literal(true),
    hasUserMedia: z.literal(false),
    publicMapEligible: z.boolean(),
    mapReadiness: z.enum(["ready", "review", "hidden"]),
  }),
  social: z.object({
    saveCount: z.number().int().nonnegative(),
    shareCount: z.number().int().nonnegative(),
    viewCount: z.number().int().nonnegative(),
  }),
  rawProperties: z.record(z.unknown()),
  classification: UnexploredClassificationBlockSchema,
  import: UnexploredImportBlockSchema,
  audit: UnexploredAuditBlockSchema,
  stateCode: z.string(),
});

export const UnexploredTileItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["unexplored_spot", "unexplored_route"]),
  displayName: z.string(),
  primaryActivity: z.string().nullable().optional(),
  activities: z.array(z.string()),
  lat: z.number().optional(),
  lng: z.number().optional(),
  center: z.object({ lat: z.number(), lng: z.number() }).optional(),
  bbox: InventoryBboxSchema.optional(),
  encodedPolyline: z.string().optional(),
  category: z.string().optional(),
  displayPriority: z.string(),
  sourceFamily: z.string(),
  hasParking: z.boolean().optional(),
  mapReadiness: z.string().optional(),
});

export const UnexploredTileSchema = z.object({
  tileKey: z.string(),
  z: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  version: z.string(),
  generatedAt: z.string(),
  runId: z.string(),
  items: z.array(UnexploredTileItemSchema),
});

export type OsmNationalRun = z.infer<typeof OsmNationalRunSchema>;
export type OsmStateRun = z.infer<typeof OsmStateRunSchema>;
export type OsmChunkRun = z.infer<typeof OsmChunkRunSchema>;
export type OsmNationalEvent = z.infer<typeof OsmNationalEventSchema>;
export type OsmNationalEventType = z.infer<typeof OsmNationalEventTypeSchema>;
export type OsmNationalRunConfig = z.infer<typeof OsmNationalRunConfigSchema>;
export type OsmNationalCounts = z.infer<typeof OsmNationalCountsSchema>;
export type UnexploredSpot = z.infer<typeof UnexploredSpotSchema>;
export type UnexploredRoute = z.infer<typeof UnexploredRouteSchema>;
export type UnexploredTile = z.infer<typeof UnexploredTileSchema>;

export const OSM_NATIONAL_PIPELINE_VERSION = "locava_national_osm_import_v1";

export function emptyOsmNationalCounts(): OsmNationalCounts {
  return {
    rawObjects: 0,
    acceptedSpots: 0,
    acceptedRoutes: 0,
    acceptedOffroadRoutes: 0,
    rejectedObjects: 0,
    duplicateSuppressed: 0,
    writtenSpots: 0,
    writtenRoutes: 0,
    writtenTiles: 0,
    skippedExisting: 0,
    writeErrors: 0,
    readOperationsEstimated: 0,
    writeOperationsEstimated: 0,
  };
}

export function emptyOsmChunkCheckpoint(): z.infer<typeof OsmChunkCheckpointSchema> {
  return {
    fetchStartedAt: null,
    fetchCompletedAt: null,
    classifyStartedAt: null,
    classifyCompletedAt: null,
    writeStartedAt: null,
    writeCompletedAt: null,
    tileStartedAt: null,
    tileCompletedAt: null,
  };
}
