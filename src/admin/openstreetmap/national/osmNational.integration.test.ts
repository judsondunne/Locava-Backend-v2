import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetOsmNationalMemoryStore } from "./osmNationalMemoryStore.js";
import { resetOsmNationalEventThrottleForTests } from "./osmNationalEventLogger.js";
import { resetWriteBudgetStateForTests } from "./osmNationalWriter.service.js";
import { planNationalRun } from "./osmNationalPlanner.service.js";
import { startNationalRun, pauseNationalRun, resumeNationalRun, cancelNationalRun } from "./osmNationalRun.service.js";
import { processChunk } from "./osmNationalChunkWorker.service.js";
import * as osmService from "../openstreetmap.service.js";
import * as offroadImport from "../offroadNationalImport.service.js";
import * as spotsAdapter from "../../../repositories/source-of-truth/unexplored-spots-firestore.adapter.js";
import type { LocavaInventoryRoute, LocavaInventorySpot } from "../../../lib/inventory/inventoryLocavaTypes.js";

function mockSpot(): LocavaInventorySpot {
  return {
    id: "s1",
    kind: "inventory_spot",
    name: "Test Spot",
    displayName: "Test Spot",
    normalizedName: "test spot",
    category: "viewpoint",
    categories: ["viewpoint"],
    activities: ["hiking"],
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
    tags: { tourism: "viewpoint" },
    attribution: { provider: "OSM", license: "ODbL" },
    mapReadiness: "ready",
  } as LocavaInventorySpot;
}

function mockRoute(): LocavaInventoryRoute {
  return {
    id: "r1",
    kind: "inventory_route",
    routeKind: "full_trail",
    name: "Test Trail",
    normalizedName: "test trail",
    activity: "hiking",
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
    tags: { highway: "path" },
    attribution: { provider: "OSM", license: "ODbL" },
    importRunId: "test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mapReadiness: "ready",
  } as LocavaInventoryRoute;
}

describe("osm national import integration", () => {
  beforeEach(() => {
    resetOsmNationalMemoryStore();
    resetOsmNationalEventThrottleForTests();
    resetWriteBudgetStateForTests();
    vi.restoreAllMocks();
  });

  it("plan creates national/state/chunk docs", async () => {
    const run = await planNationalRun({ states: ["VT"], chunkSizeKm: 80 });
    expect(run.runId).toMatch(/^osm_nat_/);
    expect(run.progress.totalStates).toBe(1);
    expect(run.progress.totalChunks).toBeGreaterThan(0);
    expect(run.writeMode).toBe(false);
  });

  it("start/pause/resume/cancel lifecycle works", async () => {
    const run = await planNationalRun({ states: ["VT"], chunkSizeKm: 120 });
    let started = await startNationalRun(run.runId);
    expect(started.status).toBe("running");
    let paused = await pauseNationalRun(run.runId);
    expect(paused.status).toBe("paused");
    let resumed = await resumeNationalRun(run.runId);
    expect(resumed.status).toBe("running");
    let cancelled = await cancelNationalRun(run.runId);
    expect(cancelled.status).toBe("cancelled");
  });

  it("processChunk dry run does not write unexplored docs", async () => {
    vi.spyOn(osmService, "classifyOpenStreetMapForBbox").mockResolvedValue({
      bbox: { minLat: 43, minLng: -73, maxLat: 44, maxLng: -72 },
      stateCode: "VT",
      runId: "x",
      source: "overpass",
      config: { foodMode: "local_only", trailMode: "recreation_only", natureMode: "named_or_recreational" },
      rawObjectCount: 10,
      acceptedSpots: [mockSpot()],
      acceptedRoutes: [mockRoute()],
      rejected: [{ sourceKey: "n1", rejectionReason: "low_score" } as never],
      duplicatesSuppressed: 0,
      diagnostics: {} as never,
      rawFeatures: [],
    });
    vi.spyOn(offroadImport, "fetchOffroadRoutesForBbox").mockResolvedValue({
      routes: [],
      rejectedCount: 0,
      rawCount: 0,
    });
    const spotSpy = vi.spyOn(spotsAdapter, "bulkWriteUnexploredSpots");

    const run = await planNationalRun({ states: ["VT"], chunkSizeKm: 200 });
    await startNationalRun(run.runId);

    const { listOsmChunkRuns } = await import(
      "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js"
    );
    const chunks = await listOsmChunkRuns(run.runId, "VT", { limit: 1 });
    const chunk = chunks[0]!;
    const result = await processChunk({ runId: run.runId, stateCode: "VT", chunkId: chunk.chunkId });
    expect(result.ok).toBe(true);
    expect(spotSpy).not.toHaveBeenCalled();
    expect(result.chunk?.counts.acceptedSpots).toBeGreaterThanOrEqual(0);
  });

  it("paused run stops chunk processing", async () => {
    const run = await planNationalRun({ states: ["VT"], chunkSizeKm: 200 });
    await startNationalRun(run.runId);
    await pauseNationalRun(run.runId);
    const { listOsmChunkRuns } = await import(
      "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js"
    );
    const chunk = (await listOsmChunkRuns(run.runId, "VT", { limit: 1 }))[0]!;
    const result = await processChunk({ runId: run.runId, stateCode: "VT", chunkId: chunk.chunkId });
    expect(result.skipped).toBe(true);
  });
});
