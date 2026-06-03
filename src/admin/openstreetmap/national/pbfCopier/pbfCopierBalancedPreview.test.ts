import { describe, expect, it } from "vitest";
import {
  canCollectRoutePreview,
  canCollectSpotPreview,
  emptyBalancedPreviewState,
  maxAcceptedRouteReserve,
  maxAcceptedSpotBudget,
  shouldStopDryRunScan,
} from "./pbfCopierBalancedPreview.js";
import { DEFAULT_PBF_COPIER_CONFIG, emptyPbfCopierMetrics, type PbfCopierRun } from "./pbfCopierTypes.js";

function mockRun(overrides: Partial<PbfCopierRun> = {}): PbfCopierRun {
  return {
    runId: "test",
    mode: "dry_run_preview",
    status: "running",
    phase: "scanning_raw_osm",
    writeMode: false,
    writeTarget: "none",
    config: { ...DEFAULT_PBF_COPIER_CONFIG, dryRunLimit: 50 },
    metrics: emptyPbfCopierMetrics(),
    currentActivity: { currentObjectType: null, currentOsmId: null, currentLabel: null, currentPhaseDetail: null },
    previewDocs: [],
    startedAt: null,
    finishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    parserId: null,
    parserVersion: null,
    sourceProvider: null,
    sourceTimestamp: null,
    dryRunProofToken: null,
    ...overrides,
  } as PbfCopierRun;
}

describe("pbfCopierBalancedPreview", () => {
  it("does not stop before ways are scanned in balanced mode", () => {
    const run = mockRun({
      config: { ...DEFAULT_PBF_COPIER_CONFIG, dryRunLimit: 50, maxAcceptedMode: false, balancedPreview: true },
    });
    run.metrics.docsPreviewed = 100;
    run.previewDocs = Array.from({ length: 50 }, (_, i) => ({ id: String(i) } as never));
    const state = emptyBalancedPreviewState();
    expect(shouldStopDryRunScan(run, state)).toBe(false);
  });

  it("stops after ways and preview quota in balanced mode", () => {
    const run = mockRun({
      config: { ...DEFAULT_PBF_COPIER_CONFIG, dryRunLimit: 50, maxAcceptedMode: false, balancedPreview: true },
    });
    run.metrics.waysScanned = 10;
    run.metrics.wayCandidatesFound = 8;
    run.previewDocs = Array.from({ length: 50 }, (_, i) => ({ id: String(i) } as never));
    const state = emptyBalancedPreviewState();
    state.wayCandidatesFound = 8;
    expect(shouldStopDryRunScan(run, state)).toBe(true);
  });

  it("caps node previews during node-only phase", () => {
    const run = mockRun({
      config: { ...DEFAULT_PBF_COPIER_CONFIG, dryRunLimit: 50, maxAcceptedMode: false, balancedPreview: true },
    });
    const state = emptyBalancedPreviewState();
    state.nodeSpotPreviews = 15;
    expect(
      canCollectSpotPreview({
        config: run.config,
        mode: run.mode,
        metrics: run.metrics,
        previewState: state,
        osmType: "node",
        totalPreviewDocs: 10,
      })
    ).toBe(false);
  });

  it("keeps scanning until file end in max accepted mode so routes can be discovered", () => {
    const run = mockRun({
      config: { ...DEFAULT_PBF_COPIER_CONFIG, dryRunLimit: 5, maxAcceptedMode: true, includeRoutes: true },
      metrics: { ...emptyPbfCopierMetrics(), docsPreviewed: 10 },
    });
    expect(shouldStopDryRunScan(run, emptyBalancedPreviewState(), false)).toBe(false);
    expect(shouldStopDryRunScan(run, emptyBalancedPreviewState(), true)).toBe(true);
  });

  it("stops when max accepted mode reaches the limit after file end", () => {
    const run = mockRun({
      config: {
        ...DEFAULT_PBF_COPIER_CONFIG,
        dryRunLimit: 100,
        maxAcceptedMode: true,
        dryRunStopMode: "max_accepted",
        includeRoutes: false,
      },
    });
    run.metrics.docsPreviewed = 100;
    expect(shouldStopDryRunScan(run, emptyBalancedPreviewState(), true)).toBe(true);
    run.metrics.docsPreviewed = 99;
    expect(shouldStopDryRunScan(run, emptyBalancedPreviewState(), true)).toBe(false);
  });

  it("reserves route preview slots in max accepted mode after spots fill", () => {
    const config = {
      ...DEFAULT_PBF_COPIER_CONFIG,
      dryRunLimit: 100,
      maxAcceptedMode: true,
      includeRoutes: true,
    };
    const state = emptyBalancedPreviewState();
    state.nodeSpotPreviews = 75;
    state.waySpotPreviews = 0;
    state.routePreviews = 0;
    expect(maxAcceptedSpotBudget(config)).toBe(75);
    expect(maxAcceptedRouteReserve(config)).toBe(25);
    expect(
      canCollectSpotPreview({
        config,
        mode: "dry_run_preview",
        metrics: { ...emptyPbfCopierMetrics(), waysScanned: 1000 },
        previewState: state,
        osmType: "node",
        totalPreviewDocs: 75,
      })
    ).toBe(false);
    expect(
      canCollectRoutePreview({
        config,
        mode: "dry_run_preview",
        previewState: state,
        totalPreviewDocs: 75,
      })
    ).toBe(true);
  });

  it("caps node previews during node phase in max accepted mode", () => {
    const config = {
      ...DEFAULT_PBF_COPIER_CONFIG,
      dryRunLimit: 100,
      maxAcceptedMode: true,
      includeRoutes: true,
    };
    const state = emptyBalancedPreviewState();
    state.nodeSpotPreviews = 15;
    expect(
      canCollectSpotPreview({
        config,
        mode: "dry_run_preview",
        metrics: emptyPbfCopierMetrics(),
        previewState: state,
        osmType: "node",
        totalPreviewDocs: 15,
      })
    ).toBe(false);
  });

  it("stops when activity quotas are filled", () => {
    const run = mockRun({
      config: {
        ...DEFAULT_PBF_COPIER_CONFIG,
        dryRunStopMode: "quotas",
        maxAcceptedMode: false,
        dryRunQuotas: { beach: 2, hiking_route: 1 },
      },
    });
    expect(shouldStopDryRunScan(run, emptyBalancedPreviewState(), false, { beach: 1, hiking_route: 0 })).toBe(false);
    expect(shouldStopDryRunScan(run, emptyBalancedPreviewState(), false, { beach: 2, hiking_route: 1 })).toBe(true);
  });
});
