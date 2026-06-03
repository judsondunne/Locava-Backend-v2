import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import type {
  UnexploredRoute,
  UnexploredSpot,
} from "../../../../contracts/entities/osm-national-entities.contract.js";
import type { OsmNationalWriteTarget } from "../osmNationalWriteGuard.js";

/**
 * Master National OSM Copier — types
 *
 * The copier presents a single national job to the user (no state selection in
 * the UI) while internally iterating safe per-state Overpass tiles to avoid
 * timeouts. State-level complexity is kept inside the runner.
 *
 * Dry run is the default. Writes are only enabled by explicit user action and
 * pass through the existing `osmNationalWriteGuard` allowlist.
 */

export type OsmNationalCopierMode = "dry_run_preview" | "write";

export type OsmNationalCopierStatus =
  | "created"
  | "planning"
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "failed";

export type OsmNationalCopierPhase =
  | "idle"
  | "planning"
  | "fetching"
  | "classifying"
  | "building_docs"
  | "checking_existing"
  | "writing"
  | "paused"
  | "complete"
  | "failed";

export type OsmNationalCopierTile = {
  tileId: string;
  tileIndex: number;
  stateCode: string;
  bbox: InventoryBbox;
};

export type OsmNationalCopierTileStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type OsmNationalCopierTileRecord = {
  tile: OsmNationalCopierTile;
  status: OsmNationalCopierTileStatus;
  attempts: number;
  acceptedSpots: number;
  acceptedRoutes: number;
  rejectedSkipped: number;
  duplicatesSkipped: number;
  existingSkipped: number;
  invalidSkipped: number;
  writtenSpots: number;
  writtenRoutes: number;
  overpassMs?: number;
  classifyMs?: number;
  buildMs?: number;
  writeMs?: number;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
};

export type OsmNationalCopierConfig = {
  dryRunLimit: number;
  includeSpots: boolean;
  includeRoutes: boolean;
  includePublicOnly: boolean;
  includeReviewDocs: boolean;
  buildUnexploredTiles: boolean;
  skipExisting: boolean;
  overwriteExisting: boolean;
  maxDocsToWrite: number | null;
  maxChunksToProcess: number | null;
  maxWritesPerSecond: number;
  maxWritesPerMinute: number;
  stopOnBudgetExceeded: boolean;
  chunkSizeKm: number;
  stateCodes?: string[];
};

export const DEFAULT_OSM_NATIONAL_COPIER_CONFIG: OsmNationalCopierConfig = {
  dryRunLimit: 20,
  includeSpots: true,
  includeRoutes: true,
  includePublicOnly: true,
  includeReviewDocs: false,
  buildUnexploredTiles: false,
  skipExisting: true,
  overwriteExisting: false,
  maxDocsToWrite: null,
  maxChunksToProcess: null,
  maxWritesPerSecond: 10,
  maxWritesPerMinute: 3000,
  stopOnBudgetExceeded: true,
  chunkSizeKm: 80,
};

export type OsmNationalCopierMetrics = {
  docsPreviewed: number;
  docsWritten: number;
  docsSkippedExisting: number;
  docsSkippedRejected: number;
  docsSkippedInvalid: number;
  docsSkippedDuplicate: number;
  writesEstimated: number;
  writesActual: number;
  readsEstimated: number;
  readsActual: number;
  chunksTotal: number;
  chunksCompleted: number;
  chunksFailed: number;
  chunksSkipped: number;
  overpassRequests: number;
  overpassFailures: number;
  retryCount: number;
  elapsedMs: number;
  averageDocsPerMinute: number;
  averageWritesPerMinute: number;
  estimatedTimeRemainingMs: number | null;
};

export function emptyCopierMetrics(): OsmNationalCopierMetrics {
  return {
    docsPreviewed: 0,
    docsWritten: 0,
    docsSkippedExisting: 0,
    docsSkippedRejected: 0,
    docsSkippedInvalid: 0,
    docsSkippedDuplicate: 0,
    writesEstimated: 0,
    writesActual: 0,
    readsEstimated: 0,
    readsActual: 0,
    chunksTotal: 0,
    chunksCompleted: 0,
    chunksFailed: 0,
    chunksSkipped: 0,
    overpassRequests: 0,
    overpassFailures: 0,
    retryCount: 0,
    elapsedMs: 0,
    averageDocsPerMinute: 0,
    averageWritesPerMinute: 0,
    estimatedTimeRemainingMs: null,
  };
}

export type OsmNationalCopierPreviewDoc = {
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
  bbox?: InventoryBbox;
  sourceFamily: string;
  sourceKeys: string[];
  sourceIds: string[];
  origin: "generated_osm";
  mapReadiness: "ready" | "review" | "hidden" | undefined;
  publicMapEligible: boolean;
  undiscovered: true;
  needsCapture: true;
  hasUserMedia: false;
  importRunId: string;
  importChunkId: string;
  importPipelineVersion: string;
  parking?: Record<string, unknown>;
  trailhead?: Record<string, unknown>;
  selectedParking?: Record<string, unknown> | null;
  selectedTrailhead?: Record<string, unknown> | null;
  parentPlaceName?: string;
  legalDisplayLabel?: string;
  offroadCategory?: string;
  distanceMeters?: number;
  distanceLabel?: string;
  geometryStorage?: { mode: string; pointCount: number; segmentCount: number };
  encodedPolylinePreviewLength?: number;
  sourceTagSample: Record<string, string>;
  warnings: string[];
};

export type OsmNationalCopierEvent = {
  eventId: string;
  runId: string;
  createdAt: string;
  level: "info" | "warn" | "error";
  message: string;
  phase: OsmNationalCopierPhase;
  tileId?: string;
  stateCode?: string;
  counts?: Record<string, number>;
};

export type OsmNationalCopierRun = {
  runId: string;
  mode: OsmNationalCopierMode;
  status: OsmNationalCopierStatus;
  phase: OsmNationalCopierPhase;
  writeMode: boolean;
  writeTarget: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  config: OsmNationalCopierConfig;
  tiles: OsmNationalCopierTileRecord[];
  metrics: OsmNationalCopierMetrics;
  previewDocs: OsmNationalCopierPreviewDoc[];
  currentTileId: string | null;
  currentStateCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  /** Set true the moment dryRunLimit is reached so the runner exits cleanly. */
  dryRunLimitReached: boolean;
  /** Sample of recent rejected reasons captured from classifier output. */
  rejectedReasonSamples: string[];
  /** Sample of accepted activities captured from accepted docs. */
  acceptedActivitySamples: string[];
  /** Sample warnings about missing metadata (no coordinates, no activities, etc.). */
  missingMetadataWarnings: string[];
};

/** Bundle of fully-built unexplored docs ready for writer / preview consumption. */
export type CopierTileResult = {
  tile: OsmNationalCopierTile;
  spots: UnexploredSpot[];
  routes: UnexploredRoute[];
  /** Inventory routes kept around solely so the writer can attach geometry overflow. */
  inventoryRoutes: import("../../../../lib/inventory/inventoryLocavaTypes.js").LocavaInventoryRoute[];
  rejectedCount: number;
  invalidCount: number;
  duplicatesSuppressed: number;
  rawObjectCount: number;
  overpassMs: number;
  classifyMs: number;
  buildMs: number;
  rejectedReasonSamples: string[];
  warnings: string[];
};
