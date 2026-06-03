import type { OsmNationalWriteTarget } from "../osmNationalWriteGuard.js";
import { pbfBuildRunId } from "./pbfCopierProgressStore.js";
import {
  emptyPbfCopierMetrics,
  type PbfCopierConfig,
  type PbfCopierMode,
  type PbfCopierRun,
} from "./pbfCopierTypes.js";

export function createPbfCopierRunRecord(input: {
  mode: PbfCopierMode;
  writeTarget: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  confirmUndiscoveredShape?: string;
  config: PbfCopierConfig;
}): PbfCopierRun {
  const now = new Date().toISOString();
  const writeMode = input.mode === "write";
  return {
    runId: pbfBuildRunId(),
    mode: input.mode,
    status: "created",
    phase: "idle",
    writeMode,
    writeTarget: writeMode ? input.writeTarget : "none",
    confirmProductionWrite: input.confirmProductionWrite,
    confirmUndiscoveredShape: input.confirmUndiscoveredShape,
    config: input.config,
    metrics: emptyPbfCopierMetrics(),
    currentActivity: {
      currentObjectType: null,
      currentOsmId: null,
      currentLabel: null,
      currentPhaseDetail: null,
    },
    previewDocs: [],
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    lastError: null,
    dryRunLimitReached: false,
    rawScanLimitReached: false,
    fileEnded: false,
    scanQualityBadge: null,
    scanQualityBadgeId: null,
    scanStopReason: null,
    scanWarnings: [],
    byteProgressUnavailable: false,
    rejectedReasonSamples: [],
    rejectionReasonCounts: {},
    rejectedSamples: [],
    rejectedSamplesTruncated: false,
    acceptedActivitySamples: [],
    missingMetadataWarnings: [],
    routeTrailDiagnostics: {
      wayCandidatesFound: 0,
      relationCandidatesFound: 0,
      trailCandidates: 0,
      offroadCandidates: 0,
      acceptedRoutes: 0,
      rejectedRouteReasons: {},
      geometryMissingCount: 0,
      relationGeometryUnsupportedCount: 0,
      rawRouteCandidatesSeen: 0,
      trailAssemblyRoutesBuilt: 0,
      builtPublicRouteDocsCount: 0,
      routeMapReadinessCounts: {},
      routesSkippedMissingGeometry: 0,
      acceptedRoutePreviewCount: 0,
      sampleAcceptedRoutes: [],
      sampleRejectedRoutes: [],
    },
    dryRunQuotaProgress: {},
    parserId: null,
    parserVersion: null,
    sourceProvider: null,
    sourceTimestamp: null,
    dryRunProofToken: null,
    previewQuality: null,
    previewWriteSourceRunId: null,
    previewWritePlannedSpots: null,
    previewWritePlannedRoutes: null,
    previewWriteSpotLimit: null,
  };
}
