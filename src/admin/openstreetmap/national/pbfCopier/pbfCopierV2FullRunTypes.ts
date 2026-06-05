import type { PbfDestinationQualityCounters } from "./pbfCopierV2DestinationQuality.js";
import type { PbfQualityFilterSettings } from "./pbfCopierV2QualityFilters.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import type { PbfCopierV2ViewportPreviewStats } from "./pbfCopierV2ViewportPreview.js";
import type { VermontTile } from "./pbfCopierV2VermontTiles.js";

export type PbfV2FullRunMode = "dry_run" | "write_test" | "write_prod";
export type PbfV2FullRunStatus =
  | "pending"
  | "running"
  | "pausing"
  | "paused"
  | "stopping"
  | "stopped"
  | "complete"
  | "error";

export type PbfV2FullRunPhase =
  | "idle"
  | "scanning_nodes"
  | "scanning_ways"
  | "scanning_relations"
  | "classifying"
  | "filtering"
  | "grouping"
  | "writing"
  | "paused"
  | "complete"
  | "error";

export type PbfV2FullRunStats = {
  rawObjectsScanned: number;
  nodesScanned: number;
  waysScanned: number;
  relationsScanned: number;
  geometrySkipped: number;
  outsideBboxSkipped: number;
  classifierAcceptedSpots: number;
  classifierAcceptedRoutes: number;
  rejectedByClassifier: number;
  residentialHomesFiltered: number;
  hikingTrailGroupsMerged: number;
  hikingTrailSegmentsCollapsed: number;
  visibleItems: number;
  hiddenItems: number;
  chunksProcessed: number;
  chunksWritten: number;
  chunksFailed: number;
  writeBatchesCommitted: number;
  duplicateStableIdsSkipped: number;
  claimedOrUserOwnedSkipped: number;
  dbWriteRetries: number;
  dbWriteErrors: number;
  destinationQuality: PbfDestinationQualityCounters;
};

export type PbfV2FullRunWriteStats = {
  attempted: number;
  written: number;
  skippedDuplicates: number;
  spotsWritten: number;
  routesWritten: number;
  tilesWritten: number;
  errors: number;
};

export type PbfV2FullRunWriteHeartbeat = {
  status: "idle" | "writing" | "complete" | "error";
  dryRun: boolean;
  writeTarget: string;
  stage: "loading" | "building_payload" | "checking_duplicates" | "spots" | "routes" | "done";
  batchIndex: number;
  batchCount: number;
  spotsPlanned: number;
  routesPlanned: number;
  spotsWritten: number;
  routesWritten: number;
  tilesWritten: number;
  skippedDuplicates: number;
  errors: string[];
  message?: string;
  updatedAt: string;
};

export type PbfV2FullRunRecord = {
  runId: string;
  region: "vermont";
  sourceFilePath: string;
  sourceFileHash: string | null;
  sourceFileBytes: number | null;
  status: PbfV2FullRunStatus;
  mode: PbfV2FullRunMode;
  phase: PbfV2FullRunPhase;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  lastCheckpoint: string | null;
  processedBytes: number | null;
  totalBytes: number | null;
  percentComplete: number;
  percentEstimated: boolean;
  processedObjects: number;
  totalObjectsEstimate: number | null;
  elapsedMs: number;
  avgObjectsPerSec: number;
  avgBytesPerSec: number;
  etaMs: number | null;
  currentChunkIndex: number;
  totalChunks: number;
  completedChunkIds: string[];
  writtenChunkIds: string[];
  stats: PbfV2FullRunStats;
  writeStats: PbfV2FullRunWriteStats;
  errorsSample: string[];
  errorCount: number;
  qualityFilterSettings: PbfQualityFilterSettings;
  maxChunks: number | null;
  /** Stop after this many visible spots (sum across processed tiles; approximate). */
  maxTotalSpots: number | null;
  tileStepDegrees: number;
  currentTile: VermontTile | null;
  validationWarnings: string[];
  /** Updated during long per-tile PBF scans so status polling shows life. */
  scanHeartbeat?: {
    tileIndex: number;
    tileId: string;
    objectsScannedThisTile: number;
    updatedAt: string;
  } | null;
  /** Live progress while writing spots/routes/tiles to Firestore. */
  writeHeartbeat?: PbfV2FullRunWriteHeartbeat | null;
  /** Rolling operator log for write operations (newest last). */
  writeLog?: string[];
};

export type PbfV2FullRunChunkRecord = {
  chunkId: string;
  tileId: string;
  tileIndex: number;
  status: "processed" | "written" | "skipped" | "error";
  bbox: VermontTile;
  scanStats: Partial<PbfCopierV2ViewportPreviewStats>;
  filterSummary: Record<string, unknown>;
  destinationQualityCounters: PbfDestinationQualityCounters;
  rawItemCount: number;
  visibleCount: number;
  visibleSpotsCount?: number;
  visibleRoutesCount?: number;
  hiddenCount: number;
  writeReadyCount: number;
  writtenCount: number;
  skippedDuplicateCount: number;
  errorCount: number;
  sourceKeysSample: string[];
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
};

export type PbfV2FullRunChunkArtifact = {
  chunk: PbfV2FullRunChunkRecord;
  visibleItems: PbfCopierPreviewDoc[];
};

export function emptyPbfV2FullRunStats(): PbfV2FullRunStats {
  return {
    rawObjectsScanned: 0,
    nodesScanned: 0,
    waysScanned: 0,
    relationsScanned: 0,
    geometrySkipped: 0,
    outsideBboxSkipped: 0,
    classifierAcceptedSpots: 0,
    classifierAcceptedRoutes: 0,
    rejectedByClassifier: 0,
    residentialHomesFiltered: 0,
    hikingTrailGroupsMerged: 0,
    hikingTrailSegmentsCollapsed: 0,
    visibleItems: 0,
    hiddenItems: 0,
    chunksProcessed: 0,
    chunksWritten: 0,
    chunksFailed: 0,
    writeBatchesCommitted: 0,
    duplicateStableIdsSkipped: 0,
    claimedOrUserOwnedSkipped: 0,
    dbWriteRetries: 0,
    dbWriteErrors: 0,
    destinationQuality: {
      residentialNonDestinationsFiltered: 0,
      railWaterBridgesIncluded: 0,
      railBridgesForcedVisible: 0,
      railroadBridgesForcedVisible: 0,
      normalRailwaysStillHidden: 0,
      unnamedHikingTrailsIncluded: 0,
      unnamedPathsStillFiltered: 0,
      realUnmarkedHikingTrailsForcedVisible: 0,
      walkingPathsKeptHidden: 0,
      selfAttachedRoutesFixed: 0,
      selfAttachedRoutesUnhidden: 0,
      unnamedHikingRoutesForcedVisible: 0,
      supportAttachedRoutesSkippedBecausePrimaryRoute: 0,
      activitiesEnrichedWithEvidence: 0,
      activitiesSkippedNoEvidence: 0,
      finalRescuedTrainBridges: 0,
      finalRescuedUnmarkedHikingTrails: 0,
      finalPreventedSelfAttachedRoutes: 0,
      finalKeptWalkingPathsHidden: 0,
      finalNormalRailwaysStillHidden: 0,
      finalHiddenIndustrialBuildings: 0,
    },
  };
}
