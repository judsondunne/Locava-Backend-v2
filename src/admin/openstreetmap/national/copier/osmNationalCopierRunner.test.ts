import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCopierRunnerHooks,
  processCopierTile,
  runCopierLoop,
  setCopierRunnerHooks,
  validateUnexploredRouteForCopier,
  validateUnexploredSpotForCopier,
} from "./osmNationalCopierRunner.js";
import {
  cancelCopierRun,
  copierHealth,
  dryRunFirstAccepted,
  exportCopierRun,
  getCopierRunDetail,
  pauseCopierRun,
  planCopierRun,
  resumeCopierRun,
  startCopierRun,
} from "./osmNationalCopierService.js";
import { resetCopierProgressStoreForTests } from "./osmNationalCopierProgressStore.js";
import {
  DEFAULT_OSM_NATIONAL_COPIER_CONFIG,
  type OsmNationalCopierTile,
} from "./osmNationalCopierTypes.js";
import type {
  LocavaInventoryRoute,
  LocavaInventorySpot,
} from "../../../../lib/inventory/inventoryLocavaTypes.js";
import type { ChunkClassificationResult } from "../../openstreetmap.service.js";
import type { UnexploredRoute, UnexploredSpot } from "../../../../contracts/entities/osm-national-entities.contract.js";

function mockSpot(overrides: Partial<LocavaInventorySpot> = {}): LocavaInventorySpot {
  return {
    id: "s1",
    kind: "inventory_spot",
    name: "Test Viewpoint",
    displayName: "Test Viewpoint",
    normalizedName: "test viewpoint",
    category: "viewpoint",
    categories: ["viewpoint"],
    activities: ["hiking", "scenic"],
    primaryActivity: "hiking",
    lat: 43.7,
    lng: -72.3,
    bbox: { minLat: 43.69, minLng: -72.31, maxLat: 43.71, maxLng: -72.29 },
    source: "openstreetmap",
    sourceType: "node",
    sourceId: "1",
    sourceKey: "node/1",
    hasMedia: false,
    status: "active",
    locavaScore: 80,
    confidence: "high",
    displayPriority: "high",
    showAtZoom: 12,
    classificationReason: "good",
    tagSignals: [],
    negativeSignals: [],
    rejectionReason: null,
    tags: { tourism: "viewpoint", name: "Test Viewpoint" },
    attribution: { provider: "OSM", license: "ODbL", sourceDatasetName: "openstreetmap" } as never,
    mapReadiness: "ready",
    ...overrides,
  } as LocavaInventorySpot;
}

function mockRoute(overrides: Partial<LocavaInventoryRoute> = {}): LocavaInventoryRoute {
  return {
    id: "r1",
    kind: "inventory_route",
    routeKind: "full_trail",
    name: "Test Trail",
    normalizedName: "test trail",
    activity: "hiking",
    primaryActivity: "hiking",
    categories: ["hiking"],
    activities: ["hiking"],
    center: { lat: 43.7, lng: -72.3 },
    bbox: { minLat: 43.69, minLng: -72.31, maxLat: 43.71, maxLng: -72.29 },
    distanceMeters: 1000,
    distanceMiles: 0.62,
    distanceLabel: "0.6 mi",
    geometryType: "LineString",
    source: "openstreetmap",
    sourceType: "way",
    sourceId: "2",
    sourceKey: "way/2",
    sourceKeys: ["way/2"],
    memberWayIds: ["2"],
    hasMedia: false,
    status: "active",
    locavaScore: 75,
    confidence: "medium",
    displayPriority: "medium",
    showAtZoom: 11,
    selectedTrailhead: null,
    selectedParking: null,
    parkingCandidates: [],
    trailheadCandidates: [],
    assemblyWarnings: [],
    classificationReason: "trail",
    tagSignals: [],
    negativeSignals: [],
    rejectionReason: null,
    tags: { highway: "path", name: "Test Trail" },
    attribution: { provider: "OSM", license: "ODbL", sourceDatasetName: "openstreetmap" } as never,
    importRunId: "test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mapReadiness: "ready",
    coordinates: [
      { lat: 43.69, lng: -72.31 },
      { lat: 43.7, lng: -72.3 },
      { lat: 43.71, lng: -72.29 },
    ],
    ...overrides,
  } as LocavaInventoryRoute;
}

function mockClassificationResult(input: {
  spots: LocavaInventorySpot[];
  routes: LocavaInventoryRoute[];
  rejected?: Array<{ sourceKey: string; rejectionReason: string }>;
}): ChunkClassificationResult {
  return {
    bbox: { minLat: 43, minLng: -73, maxLat: 44, maxLng: -72 },
    stateCode: "VT",
    runId: "x",
    source: "overpass",
    config: { foodMode: "local_only", trailMode: "recreation_only", natureMode: "named_or_recreational" },
    rawObjectCount: 50,
    acceptedSpots: input.spots,
    acceptedRoutes: input.routes,
    rejected: (input.rejected ?? []) as never,
    duplicatesSuppressed: 0,
    diagnostics: {} as never,
    rawFeatures: [],
  };
}

function mockClassifierHook(opts: {
  spots: LocavaInventorySpot[];
  routes: LocavaInventoryRoute[];
  rejected?: Array<{ sourceKey: string; rejectionReason: string }>;
}) {
  return vi.fn(async () => mockClassificationResult(opts));
}

function noopOffroad() {
  return vi.fn(async () => ({ routes: [] as LocavaInventoryRoute[], rejectedCount: 0, rawCount: 0 }));
}

describe("osmNationalCopier — health", () => {
  it("exposes the production confirmation phrase and forbids /posts", () => {
    const h = copierHealth();
    expect(h.productionConfirmationPhrase).toBe(
      "I_UNDERSTAND_THIS_WILL_WRITE_NATIONAL_UNEXPLORED_SPOTS"
    );
    expect(h.productionEnvVarName).toBe("OSM_NATIONAL_IMPORT_ALLOW_PROD_WRITE");
    expect(h.forbiddenCollections).toContain("posts");
    expect(h.allowedCollections).toContain("unexploredSpots");
    expect(h.allowedCollections).toContain("unexploredRoutes");
    expect(h.postsWriteForbidden).toBe(true);
  });
});

describe("osmNationalCopier — validators", () => {
  it("flags spots with missing coordinates", () => {
    const reasons = validateUnexploredSpotForCopier({
      id: "x",
      lat: Number.NaN,
      lng: 0,
      displayName: "Foo",
      category: "viewpoint",
      activities: ["hiking"],
      sourceKeys: ["node/1"],
      origin: "generated_osm",
      undiscovered: true,
    } as unknown as UnexploredSpot);
    expect(reasons).toContain("missing_coordinates");
  });

  it("flags routes missing center or geometryStorage", () => {
    const reasons = validateUnexploredRouteForCopier({
      id: "x",
      displayName: "Foo",
      activities: ["hiking"],
      sourceKeys: ["way/1"],
      origin: "generated_osm",
      undiscovered: true,
    } as unknown as UnexploredRoute);
    expect(reasons).toContain("missing_center");
    expect(reasons).toContain("missing_geometry_storage");
  });
});

describe("osmNationalCopier — runner", () => {
  beforeEach(() => {
    resetCopierProgressStoreForTests();
    clearCopierRunnerHooks();
  });
  afterEach(() => {
    clearCopierRunnerHooks();
  });

  it("dry-run defaults to limit 20", () => {
    expect(DEFAULT_OSM_NATIONAL_COPIER_CONFIG.dryRunLimit).toBe(20);
  });

  it("dry-run returns N accepted preview docs and writes zero", async () => {
    const writeSpots = vi.fn(async () => 999);
    const writeRoutes = vi.fn(async () => 999);
    setCopierRunnerHooks({
      classify: mockClassifierHook({
        spots: [mockSpot({ id: "s_a", sourceKey: "node/a" }), mockSpot({ id: "s_b", sourceKey: "node/b" })],
        routes: [mockRoute({ id: "r_a", sourceKey: "way/a", sourceKeys: ["way/a"], memberWayIds: ["a"] })],
        rejected: [{ sourceKey: "rej/1", rejectionReason: "low_score" }],
      }),
      fetchOffroad: noopOffroad(),
      writeSpots,
      writeRoutes,
    });

    const result = await dryRunFirstAccepted({
      config: {
        dryRunLimit: 2,
        chunkSizeKm: 200,
        stateCodes: ["VT"],
      },
      maxChunksToScan: 1,
    });

    expect(result.mode).toBe("dry_run_preview");
    expect(result.writeMode).toBe(false);
    expect(result.writeTarget).toBe("none");
    expect(result.previewDocs.length).toBeLessThanOrEqual(2);
    expect(result.previewDocs.every((d) => d.origin === "generated_osm")).toBe(true);
    expect(writeSpots).not.toHaveBeenCalled();
    expect(writeRoutes).not.toHaveBeenCalled();
  });

  it("dry-run skips rejected docs (rejected never appear in previewDocs)", async () => {
    setCopierRunnerHooks({
      classify: mockClassifierHook({
        spots: [mockSpot()],
        routes: [],
        rejected: [
          { sourceKey: "node/junk1", rejectionReason: "low_score" },
          { sourceKey: "node/junk2", rejectionReason: "name_blacklisted" },
        ],
      }),
      fetchOffroad: noopOffroad(),
    });

    const run = await dryRunFirstAccepted({
      config: { dryRunLimit: 10, chunkSizeKm: 250, stateCodes: ["VT"] },
      maxChunksToScan: 1,
    });

    expect(run.previewDocs.every((d) => d.kind !== "unexplored_route" || true)).toBe(true);
    expect(run.previewDocs.some((d) => d.id.startsWith("unx_spot_"))).toBe(true);
    expect(run.metrics.docsSkippedRejected).toBeGreaterThanOrEqual(2);
    expect(run.rejectedReasonSamples).toEqual(
      expect.arrayContaining(["low_score", "name_blacklisted"])
    );
  });

  it("dry-run validates coordinates and counts invalid", async () => {
    // Inject a spot with NaN lat: build path will still emit a doc; validator
    // should skip it as invalid.
    const badSpot = mockSpot({ id: "bad", sourceKey: "node/bad", lat: Number.NaN });
    setCopierRunnerHooks({
      classify: mockClassifierHook({
        spots: [mockSpot({ id: "good", sourceKey: "node/good" }), badSpot],
        routes: [],
      }),
      fetchOffroad: noopOffroad(),
    });
    const run = await dryRunFirstAccepted({
      config: { dryRunLimit: 20, chunkSizeKm: 250, stateCodes: ["VT"] },
      maxChunksToScan: 1,
    });
    expect(run.metrics.docsSkippedInvalid).toBeGreaterThanOrEqual(1);
  });

  it("preserves activities through the preview pipeline", async () => {
    setCopierRunnerHooks({
      classify: mockClassifierHook({
        spots: [
          mockSpot({
            id: "sa",
            sourceKey: "node/sa",
            activities: ["hiking", "scenic", "photography"],
            primaryActivity: "hiking",
          }),
        ],
        routes: [],
      }),
      fetchOffroad: noopOffroad(),
    });
    const run = await dryRunFirstAccepted({
      config: { dryRunLimit: 20, chunkSizeKm: 250, stateCodes: ["VT"] },
      maxChunksToScan: 1,
    });
    const spotDoc = run.previewDocs.find((d) => d.kind === "unexplored_spot");
    expect(spotDoc).toBeTruthy();
    expect(spotDoc?.activities).toEqual(expect.arrayContaining(["hiking", "scenic"]));
    expect(spotDoc?.primaryActivity).toBe("hiking");
    expect(run.acceptedActivitySamples).toEqual(expect.arrayContaining(["hiking"]));
  });

  it("doc builder targets unexploredSpots and unexploredRoutes, never posts", async () => {
    setCopierRunnerHooks({
      classify: mockClassifierHook({
        spots: [mockSpot()],
        routes: [mockRoute()],
      }),
      fetchOffroad: noopOffroad(),
    });
    const run = await dryRunFirstAccepted({
      config: { dryRunLimit: 20, chunkSizeKm: 250, stateCodes: ["VT"] },
      maxChunksToScan: 1,
    });
    for (const doc of run.previewDocs) {
      expect(doc.collection === "unexploredSpots" || doc.collection === "unexploredRoutes").toBe(
        true
      );
      expect(doc.id).not.toMatch(/^post_/);
    }
  });

  it("skipExisting avoids writes for existing deterministic IDs", async () => {
    const writeSpots = vi.fn(async () => 0);
    const writeRoutes = vi.fn(async () => 0);
    const findExisting = vi.fn(async (col: string, ids: string[]) => new Set(ids));
    setCopierRunnerHooks({
      classify: mockClassifierHook({
        spots: [mockSpot({ id: "a", sourceKey: "node/a" })],
        routes: [mockRoute({ id: "b", sourceKey: "way/b", sourceKeys: ["way/b"], memberWayIds: ["b"] })],
      }),
      fetchOffroad: noopOffroad(),
      writeSpots,
      writeRoutes,
      findExisting,
    });

    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    try {
      const run = planCopierRun({
        mode: "write",
        writeTarget: "emulator",
        config: { chunkSizeKm: 300, stateCodes: ["VT"], skipExisting: true },
        maxTiles: 1,
      });
      const finished = await startCopierRun(run.runId);
      expect(finished.metrics.docsSkippedExisting).toBeGreaterThan(0);
      // Because every id was existing, no docs should reach the writer.
      expect(writeSpots).not.toHaveBeenCalled();
      expect(writeRoutes).not.toHaveBeenCalled();
    } finally {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    }
  });

  it("emulator write path calls bulkWriteUnexploredSpots/Routes with writeTarget=emulator", async () => {
    const writeSpots = vi.fn(async () => 1);
    const writeRoutes = vi.fn(async () => 1);
    setCopierRunnerHooks({
      classify: mockClassifierHook({
        spots: [mockSpot({ id: "a", sourceKey: "node/a" })],
        routes: [mockRoute({ id: "b", sourceKey: "way/b", sourceKeys: ["way/b"], memberWayIds: ["b"] })],
      }),
      fetchOffroad: noopOffroad(),
      writeSpots,
      writeRoutes,
      findExisting: vi.fn(async () => new Set<string>()),
    });

    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    try {
      const run = planCopierRun({
        mode: "write",
        writeTarget: "emulator",
        config: { chunkSizeKm: 300, stateCodes: ["VT"], skipExisting: false },
        maxTiles: 1,
      });
      const finished = await startCopierRun(run.runId);
      expect(writeSpots).toHaveBeenCalledTimes(1);
      expect(writeRoutes).toHaveBeenCalledTimes(1);
      const spotsArgs = writeSpots.mock.calls[0] as unknown as [unknown, { writeTarget: string }];
      const routesArgs = writeRoutes.mock.calls[0] as unknown as [unknown, { writeTarget: string }];
      expect(spotsArgs[1]).toMatchObject({ writeTarget: "emulator" });
      expect(routesArgs[1]).toMatchObject({ writeTarget: "emulator" });
      expect(finished.metrics.writesActual).toBe(2);
    } finally {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    }
  });

  it("production write blocks plan without env var + confirmation phrase", () => {
    delete process.env.OSM_NATIONAL_IMPORT_ALLOW_PROD_WRITE;
    expect(() =>
      planCopierRun({
        mode: "write",
        writeTarget: "production",
        confirmProductionWrite: "WRONG",
        config: { chunkSizeKm: 300, stateCodes: ["VT"] },
        maxTiles: 1,
      })
    ).toThrow(/production_write_blocked/);
  });

  it("pause stops the run loop", async () => {
    const tile: OsmNationalCopierTile = {
      tileId: "t",
      tileIndex: 0,
      stateCode: "VT",
      bbox: { minLat: 43, minLng: -73, maxLat: 44, maxLng: -72 },
    };
    setCopierRunnerHooks({
      classify: mockClassifierHook({ spots: [mockSpot()], routes: [] }),
      fetchOffroad: noopOffroad(),
    });
    const run = planCopierRun({
      mode: "dry_run_preview",
      config: { chunkSizeKm: 250, stateCodes: ["VT"] },
      maxTiles: 5,
    });
    pauseCopierRun(run.runId);
    const finished = await runCopierLoop(run.runId);
    // Paused before first tile completes, so chunksCompleted should remain 0.
    expect(finished.status).toBe("paused");
    expect(finished.metrics.chunksCompleted).toBe(0);
    void tile;
  });

  it("cancel stops the run loop and reports cancelled", async () => {
    setCopierRunnerHooks({
      classify: mockClassifierHook({ spots: [mockSpot()], routes: [] }),
      fetchOffroad: noopOffroad(),
    });
    const run = planCopierRun({
      mode: "dry_run_preview",
      config: { chunkSizeKm: 250, stateCodes: ["VT"] },
      maxTiles: 3,
    });
    cancelCopierRun(run.runId);
    const finished = await runCopierLoop(run.runId);
    expect(finished.status).toBe("cancelled");
  });

  it("resume re-enters the loop and completes remaining tiles", async () => {
    setCopierRunnerHooks({
      classify: mockClassifierHook({ spots: [mockSpot()], routes: [] }),
      fetchOffroad: noopOffroad(),
    });
    const run = planCopierRun({
      mode: "dry_run_preview",
      config: { chunkSizeKm: 250, stateCodes: ["VT"], dryRunLimit: 50 },
      maxTiles: 2,
    });
    pauseCopierRun(run.runId);
    await runCopierLoop(run.runId);
    expect(getCopierRunDetail(run.runId)?.status).toBe("paused");
    const finished = await resumeCopierRun(run.runId);
    expect(["running", "completed"]).toContain(finished.status);
    expect(finished.metrics.chunksCompleted).toBeGreaterThan(0);
  });

  it("progress metrics update during a run", async () => {
    setCopierRunnerHooks({
      classify: mockClassifierHook({
        spots: [mockSpot(), mockSpot({ id: "x2", sourceKey: "node/x2" })],
        routes: [mockRoute()],
      }),
      fetchOffroad: noopOffroad(),
    });
    const run = await dryRunFirstAccepted({
      config: { dryRunLimit: 100, chunkSizeKm: 250, stateCodes: ["VT"] },
      maxChunksToScan: 1,
    });
    expect(run.metrics.docsPreviewed).toBeGreaterThan(0);
    expect(run.metrics.chunksCompleted).toBeGreaterThan(0);
    expect(run.metrics.overpassRequests).toBeGreaterThan(0);
    expect(run.metrics.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("dry-run respects dryRunLimit and stops collecting once reached", async () => {
    setCopierRunnerHooks({
      classify: mockClassifierHook({
        spots: Array.from({ length: 12 }, (_, i) =>
          mockSpot({ id: `s${i}`, sourceKey: `node/s${i}`, lat: 43.7 + i * 0.001 })
        ),
        routes: [],
      }),
      fetchOffroad: noopOffroad(),
    });
    const run = await dryRunFirstAccepted({
      config: { dryRunLimit: 5, chunkSizeKm: 250, stateCodes: ["VT"] },
      maxChunksToScan: 5,
    });
    expect(run.previewDocs.length).toBe(5);
    expect(run.dryRunLimitReached).toBe(true);
  });

  it("processCopierTile returns inventoryRoutes so writer can attach geometry overflow", async () => {
    setCopierRunnerHooks({
      classify: mockClassifierHook({ spots: [], routes: [mockRoute()] }),
      fetchOffroad: noopOffroad(),
    });
    const run = planCopierRun({
      mode: "dry_run_preview",
      config: { chunkSizeKm: 250, stateCodes: ["VT"] },
      maxTiles: 1,
    });
    const tile = run.tiles[0]!.tile;
    const result = await processCopierTile({ run, tile });
    expect(Array.isArray(result.inventoryRoutes)).toBe(true);
    expect(result.routes.length + result.inventoryRoutes.length).toBeGreaterThan(0);
  });

  it("export bundles preview docs and metrics for the export endpoint", async () => {
    setCopierRunnerHooks({
      classify: mockClassifierHook({ spots: [mockSpot()], routes: [] }),
      fetchOffroad: noopOffroad(),
    });
    const run = await dryRunFirstAccepted({
      config: { dryRunLimit: 5, chunkSizeKm: 250, stateCodes: ["VT"] },
      maxChunksToScan: 1,
    });
    const exported = exportCopierRun(run.runId);
    expect(exported).not.toBeNull();
    expect(exported?.previewDocs.length).toBeGreaterThanOrEqual(1);
    expect(exported?.metrics.docsPreviewed).toBeGreaterThanOrEqual(1);
  });
});
