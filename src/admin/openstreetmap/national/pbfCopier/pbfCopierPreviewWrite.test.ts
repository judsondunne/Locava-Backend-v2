import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UnexploredRoute, UnexploredSpot } from "../../../../contracts/entities/osm-national-entities.contract.js";
import { VERMONT_OFFROAD_PRODUCTION_PASSWORD } from "../osmNationalWriteGuard.js";
import { PBF_UNDISCOVERED_SHAPE_CONFIRMATION } from "./pbfCopierGuards.js";
import { putPbfRun, rememberPbfDryRunProof, getPbfRun } from "./pbfCopierProgressStore.js";
import { createPbfCopierRunRecord } from "./pbfCopierRunRecord.js";
import {
  extractPreviewDocsForWrite,
  extractSpotsFromPreviewDocs,
  startWritePreviewDocs,
} from "./pbfCopierPreviewWrite.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { buildPbfDryRunProofToken } from "./pbfCopierGuards.js";

vi.mock("../../../../repositories/source-of-truth/unexplored-spots-firestore.adapter.js", () => ({
  bulkWriteUnexploredSpots: vi.fn(async (spots: unknown[]) => spots.length),
}));

vi.mock("../../../../repositories/source-of-truth/unexplored-routes-firestore.adapter.js", () => ({
  bulkWriteUnexploredRoutes: vi.fn(async (routes: unknown[]) => routes.length),
}));

vi.mock("../copier/osmNationalCopierExistsBatch.js", () => ({
  findExistingUnexploredIds: vi.fn(async () => new Set<string>()),
}));

function spotPayload(id: string): UnexploredSpot {
  return {
    id,
    kind: "unexplored_spot",
    itemType: "undiscovered_spot",
    sourceCollection: "unexploredSpots",
    displayName: "Test Spot " + id,
    title: "Test Spot " + id,
    category: "viewpoint",
    primaryActivity: "hiking",
    activities: ["hiking"],
    lat: 43.54,
    lng: -72.39,
    center: { lat: 43.54, lng: -72.39 },
    location: { lat: 43.54, lng: -72.39 },
    origin: "generated_osm",
    sourceFamily: "openstreetmap",
    sourceIds: ["1"],
    sourceKeys: ["node/1"],
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    publicMapEligible: true,
    mapReadiness: "ready",
    import: { runId: "test", chunkId: "c", pipelineVersion: "1" },
  } as unknown as UnexploredSpot;
}

function routePayload(id: string): UnexploredRoute {
  return {
    id,
    kind: "unexplored_route",
    itemType: "undiscovered_route",
    sourceCollection: "unexploredRoutes",
    displayName: "Test Route " + id,
    title: "Test Route " + id,
    category: "hiking",
    primaryActivity: "hiking",
    activities: ["hiking"],
    center: { lat: 43.54, lng: -72.39 },
    origin: "generated_osm",
    sourceFamily: "openstreetmap",
    sourceIds: ["2"],
    sourceKeys: ["way/2"],
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    publicMapEligible: true,
    mapReadiness: "ready",
    encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
    geometryStorage: { mode: "inline" },
    import: { runId: "test", chunkId: "c", pipelineVersion: "1" },
  } as UnexploredRoute;
}

function spotPreviewDoc(id: string): PbfCopierPreviewDoc {
  const payload = spotPayload(id);
  return {
    id,
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName: payload.displayName,
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "hiking",
    lat: 43.54,
    lng: -72.39,
    sourceFamily: "openstreetmap",
    sourceKeys: ["node/1"],
    sourceIds: ["1"],
    osmType: "node",
    osmId: 1,
    origin: "generated_osm",
    mapReadiness: "ready",
    publicMapEligible: true,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "test",
    importPipelineVersion: "1",
    pbfFilePath: "./data/osm/test.pbf",
    sourceProvider: "geofabrik",
    sourceTagSample: { tourism: "viewpoint" },
    writePayload: payload as unknown as Record<string, unknown>,
    warnings: [],
  };
}

function routePreviewDoc(id: string): PbfCopierPreviewDoc {
  const payload = routePayload(id);
  return {
    id,
    kind: "unexplored_route",
    collection: "unexploredRoutes",
    displayName: payload.displayName,
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "hiking",
    lat: 43.54,
    lng: -72.39,
    sourceFamily: "openstreetmap",
    sourceKeys: ["way/2"],
    sourceIds: ["2"],
    osmType: "way",
    osmId: 2,
    origin: "generated_osm",
    mapReadiness: "ready",
    publicMapEligible: true,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "test",
    importPipelineVersion: "1",
    pbfFilePath: "./data/osm/test.pbf",
    sourceProvider: "geofabrik",
    sourceTagSample: { highway: "path" },
    writePayload: payload as unknown as Record<string, unknown>,
    warnings: [],
    routeLineCoordinates: [
      { lat: 43.54, lng: -72.39 },
      { lat: 43.55, lng: -72.38 },
    ],
    hasRouteGeometry: true,
  };
}

describe("pbfCopierPreviewWrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts spot and route payloads from preview docs", () => {
    const plan = extractPreviewDocsForWrite([
      spotPreviewDoc("spot:a"),
      routePreviewDoc("route:b"),
      spotPreviewDoc("spot:c"),
    ], { limit: 2 });
    expect(plan.spots.map((s) => s.id)).toEqual(["spot:a"]);
    expect(plan.routes.map((r) => r.id)).toEqual(["route:b"]);
  });

  it("extracts spot payloads only when routes disabled", () => {
    const spots = extractSpotsFromPreviewDocs(
      [spotPreviewDoc("spot:a"), routePreviewDoc("route:b"), spotPreviewDoc("spot:c")],
      2
    );
    expect(spots.map((s) => s.id)).toEqual(["spot:a", "spot:c"]);
  });

  it("writes preview spots and routes to production with Cooper password", async () => {
    const config = {
      filePath: "./data/osm/vermont-latest.osm.pbf",
      includeSpots: true,
      includeRoutes: true,
      includePublicOnly: false,
      includeReviewDocs: true,
      stateCode: "VT",
    } as const;
    const proof = buildPbfDryRunProofToken({ filePath: config.filePath, config: config as never });
    const dryRun = createPbfCopierRunRecord({
      mode: "dry_run_preview",
      writeTarget: "none",
      config: config as never,
    });
    dryRun.status = "completed";
    dryRun.dryRunProofToken = proof;
    dryRun.previewDocs = [spotPreviewDoc("spot:1"), routePreviewDoc("route:1")];
    putPbfRun(dryRun);
    rememberPbfDryRunProof(proof, dryRun.runId);

    const writeRun = startWritePreviewDocs({
      dryRunRunId: dryRun.runId,
      writeTarget: "production",
      confirmProductionWrite: VERMONT_OFFROAD_PRODUCTION_PASSWORD,
      confirmUndiscoveredShape: PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
      skipExisting: false,
    });

    expect(writeRun.previewWritePlannedSpots).toBe(1);
    expect(writeRun.previewWritePlannedRoutes).toBe(1);

    await vi.waitFor(
      () => {
        const finished = getPbfRun(writeRun.runId);
        expect(finished?.status).toBe("completed");
        expect(finished?.metrics.docsWritten).toBe(2);
        expect(finished?.metrics.acceptedSpots).toBe(1);
        expect(finished?.metrics.acceptedRoutes).toBe(1);
      },
      { timeout: 3000 }
    );
  });
});
