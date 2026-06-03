import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";

export type OffroadSourceType =
  | "usfs_mvum"
  | "blm_gtlf"
  | "osm_offroad"
  | "state_arcgis"
  | "state_geojson"
  | "manual_geojson"
  | "area_context"
  | "needs_research";

export type OffroadSourceTier = 1 | 2 | 3;

export type OffroadSourceStatus =
  | "active"
  | "ready"
  | "needs_source"
  | "needs_validation"
  | "failed"
  | "disabled";

export type OffroadQueryFormat = "arcgis" | "geojson" | "overpass" | "manual";

export type OffroadMergedConfidence =
  | "official_state"
  | "official_federal"
  | "official_limited"
  | "osm_explicit"
  | "osm_candidate";

export type OffroadSourceRegistryEntry = {
  sourceId: string;
  sourceName: string;
  sourceType: OffroadSourceType;
  tier: OffroadSourceTier;
  status: OffroadSourceStatus;
  endpoint?: string;
  layerIds?: number[];
  queryFormat?: OffroadQueryFormat;
  attribution: string;
  legalWarnings: string[];
  notes: string;
  supportsBbox: boolean;
  supportsStatewide: boolean;
  supportsPagination: boolean;
  maxRecordCount?: number;
  /** When true, produces area context only — no route lines */
  areaContextOnly?: boolean;
  whereClause?: string;
  outFields?: string;
};

export type OffroadStateRegistry = {
  stateCode: string;
  stateName: string;
  enabled: boolean;
  defaultEnabledSources: string[];
  sources: OffroadSourceRegistryEntry[];
};

export type OffroadStateFetchInput = {
  stateCode: string;
  bbox?: InventoryBbox;
  stateGeometry?: unknown;
  sourceIds?: string[];
  maxRecordsPerSource?: number;
  pageSize?: number;
  maxPages?: number;
  maxPagesPerChunk?: number;
  dryRun: true;
  importRunId: string;
  includeLimitedBlm?: boolean;
  includeNotAssessedBlm?: boolean;
  includeClass4?: boolean;
  includeLegalTrails?: boolean;
  includeClass6?: boolean;
  chunkConfig?: Partial<OffroadChunkConfig>;
};

export type OffroadBboxFetchInput = {
  bbox: InventoryBbox;
  stateCode?: string;
  sourceIds?: string[];
  maxRecordsPerSource?: number;
  pageSize?: number;
  maxPages?: number;
  dryRun: true;
  importRunId: string;
};

export type OffroadRawFeature = {
  sourceId: string;
  sourceType: OffroadSourceType;
  featureId: string;
  geometryType: "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon" | "unknown";
  geometry: unknown;
  properties: Record<string, unknown>;
  layerId?: number;
};

export type OffroadAreaContext = {
  id: string;
  sourceId: string;
  sourceDatasetName: string;
  stateCode: string;
  designation: "open" | "limited" | "closed" | "undesignated" | "unknown";
  bbox: InventoryBbox;
  center: { lat: number; lng: number };
  properties: Record<string, unknown>;
  warnings: string[];
};

export type RejectedOffroadCandidate = {
  kind: "rejected";
  sourceId: string;
  reason: string;
  properties: Record<string, unknown>;
};

export type OffroadNormalizeContext = {
  importRunId: string;
  stateCode: string;
  localityLabel?: string;
  layerId?: number;
  sourceTier?: OffroadSourceTier;
};

export type NationalOffroadSourceAdapter = {
  sourceId: string;
  sourceName: string;
  supportsState(stateCode: string): boolean;
  fetchForState(input: OffroadStateFetchInput): Promise<OffroadRawFeature[]>;
  fetchForBbox(input: OffroadBboxFetchInput): Promise<OffroadRawFeature[]>;
  normalizeFeature(
    feature: OffroadRawFeature,
    context: OffroadNormalizeContext
  ): LocavaInventoryRoute | OffroadAreaContext | RejectedOffroadCandidate | null;
};

export type OffroadChunkConfig = {
  chunkSizeDegreesLat: number;
  chunkSizeDegreesLng: number;
  maxConcurrentChunks: number;
  pageSize: number;
  maxPagesPerChunk: number;
};

export const DEFAULT_OFFROAD_CHUNK_CONFIG: OffroadChunkConfig = {
  chunkSizeDegreesLat: 0.5,
  chunkSizeDegreesLng: 0.5,
  maxConcurrentChunks: 3,
  pageSize: 1000,
  maxPagesPerChunk: 20,
};

export type MergedOffroadRouteMeta = {
  primarySourceId: string;
  sourceDatasetNames: string[];
  sourceSignals: string[];
  sourceKeys: string[];
  sourcePriority: string;
  mergedFrom: string[];
  confidence: OffroadMergedConfidence;
  accessStatus: string;
  accessWarnings: string[];
  legalDisplayLabel: string;
  offroadCategory: string;
  publicMapEligibleCandidate: boolean;
};

export type StateCoverageDiagnostics = {
  totalStates: number;
  statesWithFederalCoverage: number;
  statesWithActiveStateSpecificSource: number;
  statesWithNeedsValidationStateSource: number;
  statesNeedingStateSource: number;
  byState: Record<
    string,
    {
      enabled: boolean;
      federalActive: number;
      stateActive: number;
      needsValidation: number;
      needsSource: number;
    }
  >;
  sourceTotals: {
    usfsMvumActiveStates: number;
    blmGtlfActiveStates: number;
    osmActiveStates: number;
    activeStateSpecificSources: number;
    needsValidationSources: number;
    needsSourceSources: number;
  };
};

export const USFS_MVUM_WARNINGS = [
  "Verify current MVUM designations, seasonal restrictions, vehicle class, signage, and local conditions before driving.",
];

export const BLM_GTLF_WARNINGS = [
  "BLM route restrictions may vary by season, vehicle type, and travel management plan. Verify locally before driving.",
];

export const STATE_CLASS_ROAD_WARNINGS = [
  "Verify local access, signage, seasonal closures, and vehicle rules before driving.",
  "Road classification does not guarantee current motor vehicle access.",
];

export const OSM_OFFROAD_WARNINGS = [
  "OSM motorized access tags may be incomplete or outdated. Verify legal access before driving.",
];
