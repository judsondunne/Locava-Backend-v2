import type {
  UnexploredRoute,
  UnexploredSpot,
} from "../../../../contracts/entities/osm-national-entities.contract.js";
import type { OsmNationalWriteTarget } from "../osmNationalWriteGuard.js";
import type { PreviewQualityDiagnostics } from "./pbfCopierPreviewQuality.js";

/**
 * Master PBF OSM Copier — types
 *
 * PBF-first variant of the National Copier. Reads a local `.osm.pbf` file
 * end-to-end, runs the existing Locava classifier, and either previews or
 * writes the accepted spots/routes into `unexploredSpots` /
 * `unexploredRoutes`. Never writes `/posts`.
 */

export type PbfCopierMode = "dry_run_preview" | "fast_dry_run" | "write";

export type PbfCopierStatus =
  | "created"
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "failed";

export type PbfCopierPhase =
  | "idle"
  | "validating_file"
  | "opening_pbf"
  | "scanning_raw_osm"
  | "filtering_candidates"
  | "resolving_way_geometry"
  | "resolving_relation_geometry"
  | "running_locava_classifier"
  | "building_unexplored_docs"
  | "validating_docs"
  | "checking_existing_ids"
  | "dry_run_preview_ready"
  | "writing_batch"
  | "paused"
  | "cancelled"
  | "complete"
  | "failed";

export type PbfCopierConfig = {
  filePath: string;
  /** Cap on accepted spots/routes to collect in dry-run. Default 20. */
  dryRunLimit: number;
  /**
   * Stop dry-run as soon as `dryRunLimit` accepted spots/routes are found.
   * Rejection counts and scan metrics reflect everything processed before stop.
   */
  maxAcceptedMode: boolean;
  /** How dry-run decides to stop scanning. */
  dryRunStopMode: "max_accepted" | "quotas";
  /** Activity/category/route quotas, e.g. { beach: 10, hiking_route: 5 }. */
  dryRunQuotas: Record<string, number>;
  /**
   * Balanced preview scans into ways/routes before stopping. Node-only
   * previews are capped during the node section so trails do not get skipped.
   * Ignored when maxAcceptedMode is on.
   */
  balancedPreview: boolean;
  /** Do not stop dry-run until at least one way block has been scanned. */
  requireWaysBeforeStop: boolean;
  /** Minimum way candidates evaluated before balanced preview may stop. */
  minWayCandidatesBeforeStop: number;
  /** Max node spot previews while still in the node section. */
  dryRunNodePhaseCap: number;
  /** Max accepted node spot previews after ways are reached. */
  dryRunNodeSpotLimit: number;
  /** Max accepted way spot previews. */
  dryRunWaySpotLimit: number;
  /** Max accepted route previews. */
  dryRunRouteLimit: number;
  /**
   * Hard cap on raw OSM objects scanned, used for fast dry-runs and dev
   * speed tests. Set to `null` to scan the entire file.
   */
  maxRawObjectsToScan: number | null;
  /** Process candidate features in batches of this size. */
  classifyBatchSize: number;
  includeSpots: boolean;
  includeRoutes: boolean;
  includePublicOnly: boolean;
  includeReviewDocs: boolean;
  skipExisting: boolean;
  overwriteExisting: boolean;
  maxDocsToWrite: number | null;
  maxWritesPerSecond: number;
  maxWritesPerMinute: number;
  stopOnBudgetExceeded: boolean;
  /**
   * Optional default state-code stamped onto generated docs. PBF files
   * usually contain multiple states; for national-scale runs this can be
   * left as "US" and per-doc geo enrichment happens later.
   */
  stateCode: string;
  /**
   * When true, scan the entire PBF but only classify/preview features inside the
   * rectangular viewport bbox (center + radius km) — exhaustive region mode.
   */
  geoFilterEnabled: boolean;
  /** Center latitude; defaults to Quechee VT when geo filter enabled. */
  geoFilterCenterLat: number | null;
  /** Center longitude; defaults to Quechee VT when geo filter enabled. */
  geoFilterCenterLng: number | null;
  /** Viewport radius in km (same as OSM Classifier admin). Default 12. */
  geoFilterRadiusKm: number;
  /** @deprecated Prefer geoFilterRadiusKm — still accepted from older clients. */
  geoFilterRadiusMiles: number;
};

export const DEFAULT_PBF_COPIER_CONFIG: PbfCopierConfig = {
  filePath: "",
  dryRunLimit: 20,
  maxAcceptedMode: true,
  dryRunStopMode: "max_accepted",
  dryRunQuotas: {},
  balancedPreview: true,
  requireWaysBeforeStop: true,
  minWayCandidatesBeforeStop: 5,
  dryRunNodePhaseCap: 15,
  dryRunNodeSpotLimit: 30,
  dryRunWaySpotLimit: 15,
  dryRunRouteLimit: 15,
  /** No raw cap by default — scan until accepted preview limit or file end. */
  maxRawObjectsToScan: null,
  classifyBatchSize: 1000,
  includeSpots: true,
  includeRoutes: true,
  includePublicOnly: true,
  includeReviewDocs: false,
  skipExisting: true,
  overwriteExisting: false,
  maxDocsToWrite: null,
  maxWritesPerSecond: 10,
  maxWritesPerMinute: 3000,
  stopOnBudgetExceeded: true,
  stateCode: "US",
  geoFilterEnabled: false,
  geoFilterCenterLat: null,
  geoFilterCenterLng: null,
  geoFilterRadiusKm: 12,
  geoFilterRadiusMiles: 20,
};

export type PbfCopierMetrics = {
  fileBytesRead: number;
  fileBytesTotal: number;
  rawObjectsScanned: number;
  nodesScanned: number;
  waysScanned: number;
  relationsScanned: number;
  /** Relations forwarded with geometry not reconstructed in V1. */
  relationsSkippedGeometry: number;
  candidateObjectsFound: number;
  candidatesSentToClassifier: number;
  acceptedSpots: number;
  acceptedRoutes: number;
  rejectedByClassifier: number;
  skippedInvalid: number;
  skippedMissingCoordinates: number;
  skippedMissingActivities: number;
  skippedDuplicate: number;
  skippedExisting: number;
  docsPreviewed: number;
  docsWritten: number;
  batchesWritten: number;
  writerCalls: number;
  estimatedWrites: number;
  estimatedReads: number;
  errors: number;
  warnings: number;
  rawObjectsPerSecond: number;
  candidatesPerSecond: number;
  acceptedDocsPerSecond: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  /** Raw entities that passed type support but failed the PBF tag filter. */
  tagFilterSkipped: number;
  /** Entities that failed PBF → Overpass adaptation. */
  adapterSkipped: number;
  /** Classifier-accepted spots before doc-builder public/review filtering. */
  classifierAcceptedSpots: number;
  /** Classifier-accepted routes before doc-builder public/review filtering. */
  classifierAcceptedRoutes: number;
  /** Dropped at doc-build because includePublicOnly / review filters. */
  docBuilderFilteredPublicOnly: number;
  /** Dropped at doc-build because includeReviewDocs is off. */
  docBuilderFilteredReview: number;
  /** Failed validateUnexplored* after doc build. */
  docBuilderInvalid: number;
  /** Way entities that passed the tag filter. */
  wayCandidatesFound: number;
  /** Relation entities that passed the tag filter. */
  relationCandidatesFound: number;
  /** Preview docs skipped because geo filter was enabled and doc was outside bbox. */
  geoFilterExcludedPreviewCount: number;
  /** Raw candidates skipped before classification because outside geo filter bbox. */
  geoFilterSkippedCandidates: number;
  /** Route docs skipped because line geometry was missing. */
  routesSkippedMissingGeometry: number;
  /** Accepted preview docs that used name inference. */
  nameInferredPreviewCount: number;
};

export function emptyPbfCopierMetrics(): PbfCopierMetrics {
  return {
    fileBytesRead: 0,
    fileBytesTotal: 0,
    rawObjectsScanned: 0,
    nodesScanned: 0,
    waysScanned: 0,
    relationsScanned: 0,
    relationsSkippedGeometry: 0,
    candidateObjectsFound: 0,
    candidatesSentToClassifier: 0,
    acceptedSpots: 0,
    acceptedRoutes: 0,
    rejectedByClassifier: 0,
    skippedInvalid: 0,
    skippedMissingCoordinates: 0,
    skippedMissingActivities: 0,
    skippedDuplicate: 0,
    skippedExisting: 0,
    docsPreviewed: 0,
    docsWritten: 0,
    batchesWritten: 0,
    writerCalls: 0,
    estimatedWrites: 0,
    estimatedReads: 0,
    errors: 0,
    warnings: 0,
    rawObjectsPerSecond: 0,
    candidatesPerSecond: 0,
    acceptedDocsPerSecond: 0,
    elapsedMs: 0,
    estimatedRemainingMs: null,
    tagFilterSkipped: 0,
    adapterSkipped: 0,
    classifierAcceptedSpots: 0,
    classifierAcceptedRoutes: 0,
    docBuilderFilteredPublicOnly: 0,
    docBuilderFilteredReview: 0,
    docBuilderInvalid: 0,
    wayCandidatesFound: 0,
    relationCandidatesFound: 0,
    nameInferredPreviewCount: 0,
    geoFilterExcludedPreviewCount: 0,
    geoFilterSkippedCandidates: 0,
    routesSkippedMissingGeometry: 0,
  };
}

export type PbfCopierCurrentActivity = {
  /** What object is currently being looked at, e.g. "way" / "node". */
  currentObjectType: "node" | "way" | "relation" | null;
  /** OSM id, if known. */
  currentOsmId: number | null;
  /** Human-friendly name/tag summary (truncated). */
  currentLabel: string | null;
  /** Detail string about the current phase, e.g. "batch 4/?". */
  currentPhaseDetail: string | null;
};

/** One classifier-rejected candidate kept for dry-run inspection in the admin UI. */
export type PbfCopierRejectedSample = {
  sourceKey: string;
  sourceId: string;
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string | null;
  displayLabel: string;
  rawTypeLabel: string;
  rejectionReason: string;
  locavaScore: number;
  lat: number | null;
  lng: number | null;
  topTags: Record<string, string>;
  tagSignals: string[];
  negativeSignals: string[];
  warnings: string[];
};

export type PbfCopierPreviewDoc = {
  id: string;
  kind: "unexplored_spot" | "unexplored_route";
  collection: "unexploredSpots" | "unexploredRoutes";
  displayName: string;
  primaryActivity: string | null;
  activities: string[];
  primaryCategory: string;
  lat: number;
  lng: number;
  center?: { lat: number; lng: number };
  sourceFamily: string;
  sourceKeys: string[];
  sourceIds: string[];
  osmType: "node" | "way" | "relation";
  osmId: number;
  origin: "generated_osm";
  mapReadiness: "ready" | "review" | "hidden" | undefined;
  publicMapEligible: boolean;
  undiscovered: true;
  needsCapture: true;
  hasUserMedia: false;
  importRunId: string;
  importPipelineVersion: string;
  pbfFilePath: string;
  sourceProvider: string;
  /** Up to PREVIEW_TAG_SAMPLE_FIELDS tag entries from the source object. */
  sourceTagSample: Record<string, string>;
  /** Full Firestore doc payload this run would write for this item. */
  writePayload?: Record<string, unknown>;
  warnings: string[];
  nameInferenceUsed?: boolean;
  nameInferenceReason?: string | null;
  nameInferenceBlockedReason?: string | null;
  supportingTags?: string[];
  disqualifyingTags?: string[];
  explicitTagCategory?: string | null;
  /** Route trail line for map preview (decoded from encodedPolyline). */
  routeLineCoordinates?: Array<{ lat: number; lng: number }>;
  /** When stitch fails, draw each segment in the same trail color. */
  routeLineSegments?: Array<Array<{ lat: number; lng: number }>>;
  /** Hex color for merged hiking trail lines on V2 map. */
  routeLineColor?: string;
  encodedPolyline?: string;
  geometryType?: string;
  distanceMiles?: number;
  distanceMeters?: number;
  geometryPointCount?: number;
  hasRouteGeometry?: boolean;
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  /** Human-readable distance label (e.g. "2.4 mi"). */
  distanceLabel?: string;
  /** Loop / out-and-back / point-to-point hint from geometry + tags. */
  routeShapeHint?: "loop" | "out_and_back" | "point_to_point" | "unknown";
  /** Post-fetch quality filter state (V2 admin preview). */
  filteredOut?: boolean;
  filteredBy?: string[];
  filterReason?: string;
  supportMetadata?: {
    parking?: Array<{
      displayName: string;
      lat: number;
      lng: number;
      osmType: string;
      osmId: number;
      distanceMeters: number;
      tags: Record<string, string>;
      attachReason: string;
    }>;
    benches?: Array<{
      displayName: string;
      lat: number;
      lng: number;
      osmType: string;
      osmId: number;
      distanceMeters: number;
      tags: Record<string, string>;
      attachReason: string;
    }>;
    shelters?: Array<{
      displayName: string;
      lat: number;
      lng: number;
      osmType: string;
      osmId: number;
      distanceMeters: number;
      tags: Record<string, string>;
      attachReason: string;
    }>;
    toilets?: Array<{
      displayName: string;
      lat: number;
      lng: number;
      osmType: string;
      osmId: number;
      distanceMeters: number;
      tags: Record<string, string>;
      attachReason: string;
    }>;
    informationMaps?: Array<{
      displayName: string;
      lat: number;
      lng: number;
      osmType: string;
      osmId: number;
      distanceMeters: number;
      tags: Record<string, string>;
      attachReason: string;
    }>;
    trailheads?: Array<{
      displayName: string;
      lat: number;
      lng: number;
      osmType: string;
      osmId: number;
      distanceMeters: number;
      tags: Record<string, string>;
      attachReason: string;
    }>;
    viewpoints?: Array<{
      displayName: string;
      lat: number;
      lng: number;
      osmType: string;
      osmId: number;
      distanceMeters: number;
      tags: Record<string, string>;
      attachReason: string;
    }>;
    waterfalls?: Array<{
      displayName: string;
      lat: number;
      lng: number;
      osmType: string;
      osmId: number;
      distanceMeters: number;
      tags: Record<string, string>;
      attachReason: string;
    }>;
    connectors?: Array<{
      displayName: string;
      lat: number;
      lng: number;
      osmType: string;
      osmId: number;
      distanceMeters: number;
      tags: Record<string, string>;
      attachReason: string;
    }>;
  };
  attachedTo?: { osmType: string; osmId: number; displayName: string };
  attachReason?: string;
  destinationGroupId?: string;
  attachedToRouteId?: string;
  routeMarkerCoordinate?: { lat: number; lng: number };
  routeCenterCoordinate?: { lat: number; lng: number };
  derivedName?: boolean;
  nameSource?: string;
  nameConfidence?: string;
};

export type PbfCopierEvent = {
  eventId: string;
  runId: string;
  createdAt: string;
  level: "info" | "warn" | "error";
  message: string;
  phase: PbfCopierPhase;
  counts?: Record<string, number>;
};

export type PbfCopierRun = {
  runId: string;
  mode: PbfCopierMode;
  status: PbfCopierStatus;
  phase: PbfCopierPhase;
  writeMode: boolean;
  writeTarget: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  confirmUndiscoveredShape?: string;
  config: PbfCopierConfig;
  metrics: PbfCopierMetrics;
  currentActivity: PbfCopierCurrentActivity;
  previewDocs: PbfCopierPreviewDoc[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  /** Set true the moment dryRunLimit is reached. */
  dryRunLimitReached: boolean;
  /** True once maxRawObjectsToScan is hit. */
  rawScanLimitReached: boolean;
  /** True when the PBF reader exhausted the file (not stopped by cap/limit). */
  fileEnded: boolean;
  /** Human-readable scan quality badge for the admin UI. */
  scanQualityBadge: string | null;
  scanQualityBadgeId: string | null;
  scanStopReason: string | null;
  scanWarnings: string[];
  byteProgressUnavailable: boolean;
  /** Sample of recent rejection reasons captured from classifier output. */
  rejectedReasonSamples: string[];
  /** Full rejection-reason histogram from classifier output. */
  rejectionReasonCounts: Record<string, number>;
  /** Detailed rejected candidates for dry-run inspection (capped). */
  rejectedSamples: PbfCopierRejectedSample[];
  /** True when rejectedSamples.length hit the storage cap. */
  rejectedSamplesTruncated: boolean;
  /** Sample of accepted activities captured from accepted docs. */
  acceptedActivitySamples: string[];
  /** Sample warnings (missing coordinates, missing activities, etc.). */
  missingMetadataWarnings: string[];
  /** Route/trail diagnostics for dry-run inspection. */
  routeTrailDiagnostics: {
    wayCandidatesFound: number;
    relationCandidatesFound: number;
    trailCandidates: number;
    offroadCandidates: number;
    acceptedRoutes: number;
    rejectedRouteReasons: Record<string, number>;
    geometryMissingCount: number;
    relationGeometryUnsupportedCount: number;
    rawRouteCandidatesSeen: number;
    trailAssemblyRoutesBuilt: number;
    builtPublicRouteDocsCount: number;
    routeMapReadinessCounts: Record<string, number>;
    routesSkippedMissingGeometry: number;
    acceptedRoutePreviewCount: number;
    sampleAcceptedRoutes: PbfCopierPreviewDoc[];
    sampleRejectedRoutes: Array<{ name: string; reason: string; tags: Record<string, string> }>;
  };
  /** Live quota fill progress when dryRunStopMode=quotas. */
  dryRunQuotaProgress: Record<string, number>;
  /** PBF parser metadata captured during open. */
  parserId: string | null;
  parserVersion: string | null;
  sourceProvider: string | null;
  sourceTimestamp: string | null;
  /** Hash of (filePath, key config knobs) that succeeded as a dry-run. */
  dryRunProofToken: string | null;
  /** Post-run preview quality report (deduped names, canonical activities). */
  previewQuality: PreviewQualityDiagnostics | null;
  /** When set, this write run persists preview docs from a completed dry-run (no PBF rescan). */
  previewWriteSourceRunId?: string | null;
  previewWritePlannedSpots?: number | null;
  previewWritePlannedRoutes?: number | null;
  previewWriteSpotLimit?: number | null;
};

/**
 * Bundle returned when a write run requires a prior dry-run proof.
 */
export type PbfCopierWriteProof = {
  filePath: string;
  /** Hash that must match the prior dry-run. */
  proofToken: string;
};

/** Accepted bundle ready to be written or previewed. */
export type PbfCopierAcceptedBundle = {
  spots: UnexploredSpot[];
  routes: UnexploredRoute[];
  inventoryRoutes: import("../../../../lib/inventory/inventoryLocavaTypes.js").LocavaInventoryRoute[];
  rejectedCount: number;
  invalidCount: number;
  duplicatesSuppressed: number;
  rawObjectCount: number;
  classifyMs: number;
  buildMs: number;
  rejectedReasonSamples: string[];
  acceptedActivitySamples: string[];
  warnings: string[];
};
