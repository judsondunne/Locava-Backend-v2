import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChunkClassificationResult } from "../../openstreetmap.service.js";
import {
  cancelPbfCopierRun,
  buildPbfCopierConfig,
  dryRunPbfFirstAccepted,
  exportPbfCopierRun,
  getPbfCopierRunDetail,
  listPbfCopierEventsForRun,
  pausePbfCopierRun,
  pbfCopierHealth,
  planPbfCopierRun,
  resumePbfCopierRun,
  startDryRunPbfPreview,
  startPbfCopierRun,
} from "./pbfCopierService.js";
import {
  clearPbfCopierRunnerHooks,
  runPbfCopierLoop,
  setPbfCopierRunnerHooks,
} from "./pbfCopierRunner.js";
import {
  hasPbfDryRunProof,
  resetPbfCopierStoreForTests,
} from "./pbfCopierProgressStore.js";
import { buildPbfDryRunProofToken, PBF_UNDISCOVERED_SHAPE_CONFIRMATION } from "./pbfCopierGuards.js";
import type { PbfRawEntity } from "../../../../lib/openstreetmap/pbf/pbfElementAdapter.js";
import { buildSyntheticReaderFactory } from "../../../../lib/openstreetmap/pbf/pbfFeatureReader.js";
import type {
  LocavaInventoryRoute,
  LocavaInventorySpot,
} from "../../../../lib/inventory/inventoryLocavaTypes.js";
import { QUECHEE_VT_CENTER, resolveGeoFilterBbox } from "./pbfCopierGeoFilter.js";
import { isPointInBbox } from "../../../../lib/inventory/inventoryBbox.js";

const tmpRoot = path.join(os.tmpdir(), "locava-pbf-copier-tests");

async function makeFakePbfFile(name: string, size = 256): Promise<string> {
  await fs.mkdir(tmpRoot, { recursive: true });
  const fullPath = path.join(tmpRoot, name);
  await fs.writeFile(fullPath, Buffer.alloc(size));
  return fullPath;
}

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
  rawObjectCount?: number;
}): ChunkClassificationResult {
  return {
    bbox: { minLat: 43, minLng: -73, maxLat: 44, maxLng: -72 },
    stateCode: "US",
    runId: "x",
    source: "fixture",
    config: { foodMode: "local_only", trailMode: "recreation_only", natureMode: "named_or_recreational" },
    rawObjectCount: input.rawObjectCount ?? input.spots.length + input.routes.length,
    acceptedSpots: input.spots,
    acceptedRoutes: input.routes,
    rejected: (input.rejected ?? []) as never,
    duplicatesSuppressed: 0,
    diagnostics: {} as never,
    rawFeatures: [],
  };
}

function syntheticNodes(count: number): PbfRawEntity[] {
  return Array.from({ length: count }, (_, i) => ({
    type: "node" as const,
    id: 1000 + i,
    lat: 43.7 + i * 0.0001,
    lon: -72.3 + i * 0.0001,
    tags: { tourism: "viewpoint", name: `Viewpoint ${i}` },
  }));
}

function syntheticTrailWay(id: number): PbfRawEntity {
  return {
    type: "way" as const,
    id,
    refs: [9000 + id, 9001 + id, 9002 + id],
    geometry: [
      { lat: 43.71, lon: -72.31 },
      { lat: 43.711, lon: -72.311 },
      { lat: 43.712, lon: -72.312 },
    ],
    tags: { highway: "path", name: `Trail Way ${id}`, sac_scale: "hiking" },
  };
}

describe("PBF copier — health", () => {
  it("exposes the production confirmation phrase, env var, and forbids /posts", async () => {
    const h = await pbfCopierHealth();
    expect(h.productionConfirmationPhrase).toBe(
      "I_UNDERSTAND_THIS_WILL_WRITE_NATIONAL_UNEXPLORED_SPOTS"
    );
    expect(h.productionEnvVarName).toBe("OSM_NATIONAL_IMPORT_ALLOW_PROD_WRITE");
    expect(h.forbiddenCollections).toContain("posts");
    expect(h.allowedCollections).toContain("unexploredSpots");
    expect(h.allowedCollections).toContain("unexploredRoutes");
    expect(h.postsWriteForbidden).toBe(true);
    expect(typeof h.parserAvailable).toBe("boolean");
    expect(h.parserId).toBe("osm-pbf-parser-node");
    expect(h.parserMode).toBe("streaming");
    expect(h.pageUrl).toBe("/admin/openstreetmap/pbf-copier");
    expect(h.apiBase).toBe("/admin/openstreetmap/api/pbf-copier");
  });
});

describe("PBF copier — file validation", () => {
  it("returns clear errors for missing files", async () => {
    const { validatePbfFile } = await import("./pbfCopierService.js");
    const result = await validatePbfFile("/tmp/nonexistent-file-xyz.osm.pbf");
    expect(result.exists).toBe(false);
    expect(result.warnings.some((w) => w.startsWith("stat_failed"))).toBe(true);
  });

  it("accepts a real readable file with .osm.pbf extension", async () => {
    const file = await makeFakePbfFile("validate-ok.osm.pbf", 1024);
    const { validatePbfFile } = await import("./pbfCopierService.js");
    const result = await validatePbfFile(file);
    expect(result.exists).toBe(true);
    expect(result.readable).toBe(true);
    expect(result.isPbfExtension).toBe(true);
    expect(result.fileSizeBytes).toBe(1024);
  });

  it("warns when extension is not .pbf but does not error", async () => {
    const file = await makeFakePbfFile("not-pbf.txt", 64);
    const { validatePbfFile } = await import("./pbfCopierService.js");
    const result = await validatePbfFile(file);
    expect(result.exists).toBe(true);
    expect(result.isPbfExtension).toBe(false);
    expect(result.warnings).toContain("file_extension_is_not_pbf");
  });
});

describe("PBF copier — runner", () => {
  beforeEach(() => {
    resetPbfCopierStoreForTests();
    clearPbfCopierRunnerHooks();
  });
  afterEach(() => {
    clearPbfCopierRunnerHooks();
  });

  it("dry-run defaults to limit 20 (config-level)", async () => {
    const { DEFAULT_PBF_COPIER_CONFIG } = await import("./pbfCopierTypes.js");
    expect(DEFAULT_PBF_COPIER_CONFIG.dryRunLimit).toBe(20);
    expect(DEFAULT_PBF_COPIER_CONFIG.maxRawObjectsToScan).toBeNull();
  });

  it("geo filter dry-run only previews spots inside Quechee bbox", async () => {
    const file = await makeFakePbfFile("geo-filter-quechee.osm.pbf");
    const insideNode: PbfRawEntity = {
      type: "node",
      id: 5001,
      lat: QUECHEE_VT_CENTER.lat,
      lon: QUECHEE_VT_CENTER.lng,
      tags: { tourism: "viewpoint", name: "Quechee Gorge View" },
    };
    const outsideNode: PbfRawEntity = {
      type: "node",
      id: 5002,
      lat: 44.5,
      lon: -71.5,
      tags: { tourism: "viewpoint", name: "Far North View" },
    };
    const classify = vi.fn(async () =>
      mockClassificationResult({
        spots: [
          mockSpot({
            id: "inside",
            sourceKey: "node/5001",
            name: "Quechee Gorge View",
            displayName: "Quechee Gorge View",
            lat: QUECHEE_VT_CENTER.lat,
            lng: QUECHEE_VT_CENTER.lng,
          }),
        ],
        routes: [],
      })
    );
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: [insideNode, outsideNode], chunkSize: 1 }),
      classify,
    });
    const config = buildPbfCopierConfig({
      filePath: file,
      geoFilterEnabled: true,
      geoFilterCenterLat: QUECHEE_VT_CENTER.lat,
      geoFilterCenterLng: QUECHEE_VT_CENTER.lng,
      geoFilterRadiusKm: 12,
      includeRoutes: false,
    });
    const run = await dryRunPbfFirstAccepted({
      filePath: file,
      maxRawObjectsToScan: null,
      config,
    });
    expect(run.config.geoFilterEnabled).toBe(true);
    expect(run.metrics.geoFilterSkippedCandidates).toBeGreaterThanOrEqual(1);
    expect(run.dryRunLimitReached).toBe(false);
    expect(run.fileEnded).toBe(true);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(run.previewDocs.length).toBe(1);
    const bbox = resolveGeoFilterBbox(run.config)!;
    for (const doc of run.previewDocs) {
      expect(isPointInBbox(doc.lat, doc.lng, bbox)).toBe(true);
    }
    expect(run.previewDocs[0]?.displayName).toBe("Quechee Gorge View");
  });

  it("dry-run with no raw cap continues past nodes into ways until file ends", async () => {
    const file = await makeFakePbfFile("nodes-then-ways-dryrun.osm.pbf");
    const junkNodes = Array.from({ length: 150 }, (_, i) => ({
      type: "node" as const,
      id: i + 1,
      lat: 43.7,
      lon: -72.3,
      tags: { note: `junk-${i}` },
    }));
    const ways = [
      {
        type: "way" as const,
        id: 8001,
        tags: { tourism: "viewpoint", name: "Late Viewpoint Way" },
        geometry: [
          { lat: 43.71, lon: -72.31 },
          { lat: 43.711, lon: -72.309 },
        ],
      },
    ];
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({
        entities: [...junkNodes, ...ways],
        chunkSize: 25,
      }),
      classify: vi.fn(async () => mockClassificationResult({ spots: [], routes: [] })),
    });
    const run = await dryRunPbfFirstAccepted({
      filePath: file,
      acceptedLimit: 1000,
      maxRawObjectsToScan: null,
    });
    expect(run.metrics.nodesScanned).toBeGreaterThan(100);
    expect(run.metrics.waysScanned).toBeGreaterThan(0);
    expect(run.rawScanLimitReached).toBe(false);
    expect(run.fileEnded).toBe(true);
    expect(run.scanQualityBadgeId).not.toBe("shallow_node_only_scan");
  });

  it("sets scan quality warnings when raw cap stops before ways", async () => {
    const file = await makeFakePbfFile("raw-cap-before-ways.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({
        entities: syntheticNodes(300),
        chunkSize: 50,
      }),
      classify: vi.fn(async () => mockClassificationResult({ spots: [], routes: [] })),
    });
    const run = await dryRunPbfFirstAccepted({
      filePath: file,
      acceptedLimit: 1000,
      maxRawObjectsToScan: 250,
    });
    expect(run.rawScanLimitReached).toBe(true);
    expect(run.metrics.waysScanned).toBe(0);
    expect(run.scanWarnings?.some((w) => /before ways were reached/i.test(w))).toBe(true);
    expect(run.scanQualityBadgeId).toBe("shallow_node_only_scan");
  });

  it("preserves OSM displayName on accepted preview docs", async () => {
    const file = await makeFakePbfFile("preserve-name.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(1), chunkSize: 1 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [
            mockSpot({
              id: "cedar",
              sourceKey: "node/1000",
              name: "Cedar Beach",
              displayName: "Cedar Beach",
              category: "beach",
              activities: ["swimming", "beach"],
            }),
          ],
          routes: [],
        })
      ),
    });
    const run = await dryRunPbfFirstAccepted({
      filePath: file,
      acceptedLimit: 5,
      maxRawObjectsToScan: null,
      config: { includeRoutes: false },
    });
    expect(run.previewDocs[0]?.displayName).toBe("Cedar Beach");
  });

  it("dry-run returns N accepted preview docs and writes ZERO Firebase docs", async () => {
    const file = await makeFakePbfFile("dry-zero.osm.pbf");
    const writeSpots = vi.fn(async () => 999);
    const writeRoutes = vi.fn(async () => 999);
    const classify = vi.fn(async () =>
      mockClassificationResult({
        spots: [
          mockSpot({ id: "sa", sourceKey: "node/1000" }),
          mockSpot({ id: "sb", sourceKey: "node/1001" }),
        ],
        routes: [],
        rejected: [{ sourceKey: "node/1002", rejectionReason: "low_score" }],
      })
    );
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(3), chunkSize: 3 }),
      classify,
      writeSpots,
      writeRoutes,
    });

    const result = await dryRunPbfFirstAccepted({
      filePath: file,
      acceptedLimit: 2,
      maxRawObjectsToScan: 5000,
    });

    expect(result.mode).toBe("dry_run_preview");
    expect(result.writeMode).toBe(false);
    expect(result.writeTarget).toBe("none");
    expect(result.previewDocs.length).toBeLessThanOrEqual(2);
    expect(result.previewDocs.every((d) => d.origin === "generated_osm")).toBe(true);
    expect(result.previewDocs.every((d) => d.collection === "unexploredSpots" || d.collection === "unexploredRoutes")).toBe(true);
    expect(writeSpots).not.toHaveBeenCalled();
    expect(writeRoutes).not.toHaveBeenCalled();
    expect(result.metrics.docsWritten).toBe(0);
    expect(result.metrics.batchesWritten).toBe(0);
    expect(result.dryRunProofToken).toBeTruthy();
  });

  it("dry-run emits phase events and a real-time event console (not just 'running…')", async () => {
    const file = await makeFakePbfFile("phases.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(3), chunkSize: 3 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [mockSpot({ id: "sx", sourceKey: "node/1000" })],
          routes: [],
        })
      ),
    });
    const run = await dryRunPbfFirstAccepted({ filePath: file, acceptedLimit: 5, maxRawObjectsToScan: 1000 });
    const events = listPbfCopierEventsForRun(run.runId, 500);
    expect(events.length).toBeGreaterThan(2);
    const phases = new Set(events.map((e) => e.phase));
    expect(phases.has("validating_file")).toBe(true);
    expect(phases.has("opening_pbf")).toBe(true);
    expect(phases.has("scanning_raw_osm")).toBe(true);
    // Final phase is dry_run_preview_ready (or complete) — not 'running'.
    expect(["dry_run_preview_ready", "complete"]).toContain(run.phase);
  });

  it("dry-run progress includes the full counter surface (not a string)", async () => {
    const file = await makeFakePbfFile("counters.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(5), chunkSize: 2 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })],
          routes: [mockRoute({ id: "rb", sourceKey: "way/2000", sourceKeys: ["way/2000"], memberWayIds: ["2000"] })],
          rejected: [{ sourceKey: "node/1001", rejectionReason: "below_threshold" }],
        })
      ),
    });
    const run = await dryRunPbfFirstAccepted({ filePath: file, acceptedLimit: 10, maxRawObjectsToScan: 1000 });
    expect(run.metrics.rawObjectsScanned).toBeGreaterThan(0);
    expect(run.metrics.candidateObjectsFound).toBeGreaterThan(0);
    expect(run.metrics.docsPreviewed).toBeGreaterThan(0);
    expect(run.metrics.rejectedByClassifier).toBeGreaterThanOrEqual(1);
    expect(typeof run.metrics.elapsedMs).toBe("number");
  });

  it("dry-run does not hang on a tiny fixture (returns under 5s)", async () => {
    const file = await makeFakePbfFile("noh-hang.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(20), chunkSize: 5 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })],
          routes: [],
        })
      ),
    });
    const start = Date.now();
    const run = await dryRunPbfFirstAccepted({ filePath: file, acceptedLimit: 5, maxRawObjectsToScan: 1000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    expect(["completed", "failed"]).toContain(run.status);
  });

  it("dry-run stops at acceptedLimit", async () => {
    const file = await makeFakePbfFile("stop-at-limit.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(50), chunkSize: 5 }),
      classify: vi.fn(async (input: { rawFeatures: Array<{ id: string; lat: number; lng: number }> }) =>
        mockClassificationResult({
          spots: input.rawFeatures.map((f, i) =>
            mockSpot({
              id: `s_${i}`,
              sourceKey: f.id,
              name: `Viewpoint ${i}`,
              displayName: `Viewpoint ${i}`,
              normalizedName: `viewpoint ${i}`,
              lat: f.lat,
              lng: f.lng,
            })
          ),
          routes: [],
        })
      ),
    });
    const run = await dryRunPbfFirstAccepted({
      filePath: file,
      acceptedLimit: 3,
      maxRawObjectsToScan: 10000,
      config: { maxAcceptedMode: true, balancedPreview: false, includeRoutes: false },
    });
    expect(run.previewDocs.length).toBe(3);
    expect(run.previewQuality?.maxAcceptedApplied).toBe(3);
  });

  it("maxRawObjectsToScan skips excess node evaluation but still reaches ways", async () => {
    const file = await makeFakePbfFile("raw-limit.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({
        entities: [...syntheticNodes(500), syntheticTrailWay(5000)],
        chunkSize: 50,
      }),
      classify: vi.fn(async () => mockClassificationResult({ spots: [], routes: [] })),
    });
    const run = await dryRunPbfFirstAccepted({
      filePath: file,
      acceptedLimit: 1000,
      maxRawObjectsToScan: 50,
    });
    expect(run.rawScanLimitReached).toBe(true);
    expect(run.metrics.nodesScanned).toBe(500);
    expect(run.metrics.waysScanned).toBe(1);
  });

  it("rejected classifier outputs are skipped from previewDocs forever", async () => {
    const file = await makeFakePbfFile("skip-rejected.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(3), chunkSize: 3 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })],
          routes: [],
          rejected: [
            { sourceKey: "node/1001", rejectionReason: "low_score" },
            { sourceKey: "node/1002", rejectionReason: "name_blacklisted" },
          ],
        })
      ),
    });
    const run = await dryRunPbfFirstAccepted({ filePath: file, acceptedLimit: 10, maxRawObjectsToScan: 1000 });
    expect(run.previewDocs.every((d) => d.id !== "node/1001" && d.id !== "node/1002")).toBe(true);
    expect(run.metrics.rejectedByClassifier).toBeGreaterThanOrEqual(2);
    expect(run.rejectedReasonSamples).toEqual(
      expect.arrayContaining(["low_score", "name_blacklisted"])
    );
    expect(run.rejectionReasonCounts.low_score).toBeGreaterThanOrEqual(1);
    expect(run.rejectionReasonCounts.name_blacklisted).toBeGreaterThanOrEqual(1);
    expect(run.rejectedSamples.length).toBeGreaterThanOrEqual(2);
    expect(run.rejectedSamples.every((s) => s.rejectionReason && s.sourceKey)).toBe(true);
  });

  it("preserves activities through the preview pipeline", async () => {
    const file = await makeFakePbfFile("activities.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(1), chunkSize: 1 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [
            mockSpot({
              id: "sa",
              sourceKey: "node/1000",
              activities: ["hiking"],
              primaryActivity: "hiking",
            }),
          ],
          routes: [],
        })
      ),
    });
    const run = await dryRunPbfFirstAccepted({
      filePath: file,
      acceptedLimit: 5,
      maxRawObjectsToScan: 100,
      config: { includeRoutes: false },
    });
    const spotDoc = run.previewDocs.find((d) => d.kind === "unexplored_spot");
    expect(spotDoc).toBeTruthy();
    expect(spotDoc?.activities).toEqual(expect.arrayContaining(["hiking"]));
    expect(spotDoc?.primaryActivity).toBe("hiking");
    expect(run.acceptedActivitySamples).toEqual(expect.arrayContaining(["hiking"]));
  });

  it("doc builder targets unexploredSpots and unexploredRoutes only — /posts impossible", async () => {
    const file = await makeFakePbfFile("collections.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(2), chunkSize: 2 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })],
          routes: [mockRoute({ id: "rb", sourceKey: "way/2000", sourceKeys: ["way/2000"], memberWayIds: ["2000"] })],
        })
      ),
    });
    const run = await dryRunPbfFirstAccepted({ filePath: file, acceptedLimit: 5, maxRawObjectsToScan: 100 });
    for (const doc of run.previewDocs) {
      expect(doc.collection === "unexploredSpots" || doc.collection === "unexploredRoutes").toBe(true);
      expect(doc.id.startsWith("post_")).toBe(false);
    }
  });

  it("write run blocked without a prior successful dry-run proof token", async () => {
    const file = await makeFakePbfFile("write-needs-proof.osm.pbf");
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    try {
      expect(() =>
        planPbfCopierRun({
          mode: "write",
          writeTarget: "emulator",
          config: { filePath: file },
        })
      ).toThrow(/dry_run_proof_required/);
    } finally {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    }
  });

  it("production write blocked without env var + exact phrase", async () => {
    delete process.env.OSM_NATIONAL_IMPORT_ALLOW_PROD_WRITE;
    const file = await makeFakePbfFile("prod-blocked.osm.pbf");
    expect(() =>
      planPbfCopierRun({
        mode: "write",
        writeTarget: "production",
        confirmProductionWrite: "WRONG",
        dryRunProofToken: "irrelevant",
        config: { filePath: file },
      })
    ).toThrow(/production_write_blocked/);
  });

  it("emulator write path goes through guarded writers with writeTarget=emulator", async () => {
    const file = await makeFakePbfFile("emu-write.osm.pbf");
    const writeSpots = vi.fn(async () => 1);
    const writeRoutes = vi.fn(async () => 1);
    const findExisting = vi.fn(async () => new Set<string>());
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(2), chunkSize: 2 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })],
          routes: [mockRoute({ id: "rb", sourceKey: "way/2000", sourceKeys: ["way/2000"], memberWayIds: ["2000"] })],
        })
      ),
      writeSpots,
      writeRoutes,
      findExisting,
    });

    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    try {
      // Step 1: dry-run to get a proof token.
      const dryRun = await dryRunPbfFirstAccepted({
        filePath: file,
        acceptedLimit: 10,
        maxRawObjectsToScan: 100,
      });
      expect(dryRun.dryRunProofToken).toBeTruthy();
      expect(hasPbfDryRunProof(dryRun.dryRunProofToken!)).toBe(true);
      const expectedToken = buildPbfDryRunProofToken({
        filePath: file,
        config: dryRun.config,
      });
      expect(dryRun.dryRunProofToken).toBe(expectedToken);

      // Step 2: plan + start the write run.
      const planned = planPbfCopierRun({
        mode: "write",
        writeTarget: "emulator",
        confirmUndiscoveredShape: PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
        dryRunProofToken: dryRun.dryRunProofToken!,
        config: {
          filePath: file,
          // Same flags as default so the proof token matches.
          includeSpots: true,
          includeRoutes: true,
          includePublicOnly: true,
          includeReviewDocs: false,
          stateCode: "US",
          skipExisting: false,
        },
      });
      expect(planned.writeMode).toBe(true);
      expect(planned.writeTarget).toBe("emulator");

      const finished = await startPbfCopierRun(planned.runId);
      expect(finished.status).toBe("completed");
      expect(writeSpots).toHaveBeenCalled();
      expect(writeRoutes).toHaveBeenCalled();
      const spotArgs = writeSpots.mock.calls[0] as unknown as [unknown, { writeTarget: string }];
      const routeArgs = writeRoutes.mock.calls[0] as unknown as [unknown, { writeTarget: string }];
      expect(spotArgs[1]).toMatchObject({ writeTarget: "emulator" });
      expect(routeArgs[1]).toMatchObject({ writeTarget: "emulator" });
    } finally {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    }
  });

  it("skipExisting prevents writes for existing IDs", async () => {
    const file = await makeFakePbfFile("skip-existing.osm.pbf");
    const writeSpots = vi.fn(async () => 0);
    const writeRoutes = vi.fn(async () => 0);
    const findExisting = vi.fn(async (_col: string, ids: string[]) => new Set(ids));
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(2), chunkSize: 2 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })],
          routes: [],
        })
      ),
      writeSpots,
      writeRoutes,
      findExisting,
    });
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    try {
      const dryRun = await dryRunPbfFirstAccepted({
        filePath: file,
        acceptedLimit: 10,
        maxRawObjectsToScan: 100,
      });
      const planned = planPbfCopierRun({
        mode: "write",
        writeTarget: "emulator",
        confirmUndiscoveredShape: PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
        dryRunProofToken: dryRun.dryRunProofToken!,
        config: {
          filePath: file,
          includeSpots: true,
          includeRoutes: true,
          includePublicOnly: true,
          includeReviewDocs: false,
          stateCode: "US",
          skipExisting: true,
        },
      });
      const finished = await startPbfCopierRun(planned.runId);
      expect(finished.metrics.skippedExisting).toBeGreaterThan(0);
      expect(writeSpots).not.toHaveBeenCalled();
    } finally {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    }
  });

  it("pause stops the run loop cleanly", async () => {
    const file = await makeFakePbfFile("pause.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(3), chunkSize: 3 }),
      classify: vi.fn(async () =>
        mockClassificationResult({ spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })], routes: [] })
      ),
    });
    const run = planPbfCopierRun({
      mode: "dry_run_preview",
      config: { filePath: file },
    });
    pausePbfCopierRun(run.runId);
    // Run the loop directly so the start path does not overwrite paused
    // status before the loop runs.
    const finished = await runPbfCopierLoop(run.runId);
    expect(finished.status).toBe("paused");
    expect(finished.phase).toBe("paused");
  });

  it("cancel ends the run and records cancelled status", async () => {
    const file = await makeFakePbfFile("cancel.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(3), chunkSize: 3 }),
      classify: vi.fn(async () =>
        mockClassificationResult({ spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })], routes: [] })
      ),
    });
    const run = planPbfCopierRun({
      mode: "dry_run_preview",
      config: { filePath: file },
    });
    cancelPbfCopierRun(run.runId);
    const latest = getPbfCopierRunDetail(run.runId);
    expect(latest?.status).toBe("cancelled");
  });

  it("export bundles preview docs + metrics + file metadata", async () => {
    const file = await makeFakePbfFile("export.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(1), chunkSize: 1 }),
      classify: vi.fn(async () =>
        mockClassificationResult({ spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })], routes: [] })
      ),
    });
    const run = await dryRunPbfFirstAccepted({
      filePath: file,
      acceptedLimit: 5,
      maxRawObjectsToScan: 100,
      config: { includeRoutes: false },
    });
    const exported = exportPbfCopierRun(run.runId);
    expect(exported).not.toBeNull();
    expect(exported?.previewDocs.length).toBeGreaterThanOrEqual(1);
    expect(exported?.metrics.docsPreviewed).toBeGreaterThanOrEqual(1);
    expect(exported?.file.path).toBe(file);
  });

  it("does not write on a failed PBF file open", async () => {
    const writeSpots = vi.fn(async () => 5);
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: [] }),
      classify: vi.fn(async () => mockClassificationResult({ spots: [], routes: [] })),
      writeSpots,
    });
    const result = await dryRunPbfFirstAccepted({
      filePath: "/tmp/does-not-exist-osmpbf-9999.osm.pbf",
      acceptedLimit: 5,
      maxRawObjectsToScan: 100,
    });
    expect(result.status).toBe("failed");
    expect(result.metrics.docsWritten).toBe(0);
    expect(writeSpots).not.toHaveBeenCalled();
  });

  it("invalid coordinate docs are skipped (skippedMissingCoordinates increments)", async () => {
    const file = await makeFakePbfFile("invalid-coords.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(2), chunkSize: 2 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [
            mockSpot({ id: "ok", sourceKey: "node/1000" }),
            mockSpot({ id: "bad", sourceKey: "node/1001", lat: Number.NaN }),
          ],
          routes: [],
        })
      ),
    });
    const run = await dryRunPbfFirstAccepted({ filePath: file, acceptedLimit: 10, maxRawObjectsToScan: 100 });
    expect(run.metrics.skippedInvalid + run.metrics.skippedMissingCoordinates).toBeGreaterThanOrEqual(1);
  });

  it("startDryRunPbfPreview returns immediately while the run continues in background", async () => {
    const file = await makeFakePbfFile("async-dry-run.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(20), chunkSize: 5 }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })],
          routes: [],
        })
      ),
    });
    const started = startDryRunPbfPreview({ filePath: file, acceptedLimit: 5, maxRawObjectsToScan: 1000 });
    expect(started.status).toBe("running");
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const latest = getPbfCopierRunDetail(started.runId);
        if (!latest) return reject(new Error("run_missing"));
        if (latest.status === "completed") return resolve();
        if (latest.status === "failed") return reject(new Error(latest.lastError || "failed"));
        if (Date.now() > deadline) return reject(new Error("timeout_waiting_for_completion"));
        setTimeout(check, 25);
      };
      check();
    });
    const finished = getPbfCopierRunDetail(started.runId);
    expect(finished?.status).toBe("completed");
  });

  it("resume re-enters the run loop after pause", async () => {
    const file = await makeFakePbfFile("resume.osm.pbf");
    setPbfCopierRunnerHooks({
      readerFactory: buildSyntheticReaderFactory({ entities: syntheticNodes(2), chunkSize: 2 }),
      classify: vi.fn(async () =>
        mockClassificationResult({ spots: [mockSpot({ id: "sa", sourceKey: "node/1000" })], routes: [] })
      ),
    });
    const run = planPbfCopierRun({
      mode: "dry_run_preview",
      config: { filePath: file, dryRunLimit: 50 },
    });
    pausePbfCopierRun(run.runId);
    resumePbfCopierRun(run.runId);
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const latest = getPbfCopierRunDetail(run.runId);
        if (!latest) return reject(new Error("run_missing"));
        if (latest.status === "completed") return resolve();
        if (latest.status === "failed") return reject(new Error(latest.lastError || "failed"));
        if (Date.now() > deadline) return reject(new Error("timeout_waiting_for_completion"));
        setTimeout(check, 25);
      };
      check();
    });
    const finished = getPbfCopierRunDetail(run.runId);
    expect(finished?.status).toBe("completed");
  });
});
