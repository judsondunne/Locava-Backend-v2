import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChunkClassificationResult } from "../../openstreetmap.service.js";
import type { PbfRawEntity } from "../../../../lib/openstreetmap/pbf/pbfElementAdapter.js";
import { buildSyntheticReaderFactory } from "../../../../lib/openstreetmap/pbf/pbfFeatureReader.js";
import type {
  LocavaInventoryRoute,
  LocavaInventorySpot,
} from "../../../../lib/inventory/inventoryLocavaTypes.js";
import {
  clearPbfCopierV2ViewportPreviewHooks,
  collapseRoutePreviewDocsByTrailName,
  osmFeatureWithinViewportBbox,
  previewDocWithinViewportBbox,
  scanPbfViewportPreview,
  setPbfCopierV2ViewportPreviewHooks,
  validateViewportBbox,
  viewportBboxToInventoryBbox,
} from "./pbfCopierV2ViewportPreview.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

const tmpRoot = path.join(os.tmpdir(), "locava-pbf-copier-v2-tests");

async function makeFakePbfFile(name: string, size = 256): Promise<string> {
  await fs.mkdir(tmpRoot, { recursive: true });
  const fullPath = path.join(tmpRoot, name);
  await fs.writeFile(fullPath, Buffer.alloc(size));
  return fullPath;
}

const HARTLAND_BBOX = {
  westLng: -72.55,
  southLat: 43.45,
  eastLng: -72.25,
  northLat: 43.65,
};

function entity(overrides: Partial<PbfRawEntity> & Pick<PbfRawEntity, "type" | "id">): PbfRawEntity {
  return {
    tags: {},
    ...overrides,
  } as PbfRawEntity;
}

function mockSpot(overrides: Partial<LocavaInventorySpot> = {}): LocavaInventorySpot {
  return {
    id: "node/1",
    kind: "inventory_spot",
    name: "Quechee Lookout",
    displayName: "Quechee Lookout",
    normalizedName: "quechee lookout",
    category: "viewpoint",
    categories: ["viewpoint"],
    activities: ["hiking", "viewpoints"],
    primaryActivity: "viewpoints",
    lat: 43.54,
    lng: -72.4,
    bbox: { minLat: 43.53, minLng: -72.41, maxLat: 43.55, maxLng: -72.39 },
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
    tags: { tourism: "viewpoint", name: "Quechee Lookout" },
    attribution: { provider: "OSM", license: "ODbL", sourceDatasetName: "openstreetmap" } as never,
    mapReadiness: "ready",
    ...overrides,
  } as LocavaInventorySpot;
}

function mockRoute(overrides: Partial<LocavaInventoryRoute> = {}): LocavaInventoryRoute {
  return {
    id: "way/10",
    kind: "inventory_route",
    routeKind: "full_trail",
    name: "Hartland Path",
    normalizedName: "hartland path",
    activity: "hiking",
    primaryActivity: "hiking",
    categories: ["hiking"],
    activities: ["hiking"],
    center: { lat: 43.55, lng: -72.39 },
    bbox: { minLat: 43.54, minLng: -72.4, maxLat: 43.56, maxLng: -72.38 },
    distanceMeters: 1200,
    distanceMiles: 0.75,
    distanceLabel: "0.8 mi",
    geometryType: "LineString",
    source: "openstreetmap",
    sourceType: "way",
    sourceId: "10",
    sourceKey: "way/10",
    sourceKeys: ["way/10"],
    memberWayIds: ["10"],
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
    tags: { highway: "path", name: "Hartland Path" },
    attribution: { provider: "OSM", license: "ODbL", sourceDatasetName: "openstreetmap" } as never,
    mapReadiness: "ready",
    coordinates: [
      { lat: 43.54, lng: -72.4 },
      { lat: 43.55, lng: -72.39 },
      { lat: 43.56, lng: -72.38 },
    ],
    ...overrides,
  } as LocavaInventoryRoute;
}

function mockClassificationResult(input: {
  spots: LocavaInventorySpot[];
  routes: LocavaInventoryRoute[];
}): ChunkClassificationResult {
  return {
    bbox: viewportBboxToInventoryBbox(HARTLAND_BBOX),
    stateCode: "VT",
    runId: "v2-test",
    source: "fixture",
    config: { foodMode: "local_only", trailMode: "recreation_only", natureMode: "named_or_recreational" },
    rawObjectCount: input.spots.length + input.routes.length,
    acceptedSpots: input.spots,
    acceptedRoutes: input.routes,
    rejected: [],
    duplicatesSuppressed: 0,
    diagnostics: {} as never,
    rawFeatures: [],
  };
}

afterEach(() => {
  clearPbfCopierV2ViewportPreviewHooks();
});

describe("pbfCopierV2ViewportPreview", () => {
  it("validates viewport bbox", () => {
    expect(() =>
      validateViewportBbox({ westLng: -72, southLat: 44, eastLng: -71, northLat: 43 })
    ).toThrow(/southLat/);
  });

  it("maps west/south/east/north to inventory bbox", () => {
    const inv = viewportBboxToInventoryBbox(HARTLAND_BBOX);
    expect(inv).toEqual({
      minLat: 43.45,
      minLng: -72.55,
      maxLat: 43.65,
      maxLng: -72.25,
    });
  });

  it("osmFeatureWithinViewportBbox intersects line geometry", () => {
    const bbox = viewportBboxToInventoryBbox(HARTLAND_BBOX);
    expect(
      osmFeatureWithinViewportBbox(
        {
          lat: 43.5,
          lng: -72.4,
          coordinates: [
            { lat: 43.48, lng: -72.6 },
            { lat: 43.52, lng: -72.35 },
          ],
        },
        bbox
      )
    ).toBe(true);
  });

  it("collapseRoutePreviewDocsByTrailName keeps one route per trail name", () => {
    const mkRoute = (name: string, points: number, tagOnly: boolean): PbfCopierPreviewDoc =>
      ({
        id: `r-${name}-${points}`,
        kind: "unexplored_route",
        displayName: name,
        routeLineCoordinates: Array.from({ length: points }, (_, i) => ({
          lat: 43.5 + i * 0.001,
          lng: -72.4,
        })),
        warnings: tagOnly ? ["v2_tag_coverage_only"] : [],
      }) as PbfCopierPreviewDoc;

    const collapsed = collapseRoutePreviewDocsByTrailName([
      { id: "s1", kind: "unexplored_spot", displayName: "Parking" } as PbfCopierPreviewDoc,
      mkRoute("North Ridge Trail", 5, true),
      mkRoute("North Ridge Trail", 50, false),
      mkRoute("Other Trail", 10, false),
    ]);

    const routes = collapsed.filter((d) => d.kind === "unexplored_route");
    expect(routes).toHaveLength(2);
    const north = routes.find((d) => d.displayName === "North Ridge Trail");
    expect(north?.routeLineCoordinates?.length).toBe(50);
    expect(north?.warnings?.includes("v2_tag_coverage_only")).toBe(false);
  });

  it("previewDocWithinViewportBbox keeps routes whose line crosses the box", () => {
    const bbox = viewportBboxToInventoryBbox(HARTLAND_BBOX);
    expect(
      previewDocWithinViewportBbox(
        {
          kind: "unexplored_route",
          lat: 43.5,
          lng: -72.4,
          routeLineCoordinates: [
            { lat: 43.48, lng: -72.6 },
            { lat: 43.52, lng: -72.35 },
          ],
        } as never,
        bbox
      )
    ).toBe(true);
  });

  it("raw mode returns every in-bbox OSM object without classifier", async () => {
    const file = await makeFakePbfFile(`v2-raw-${Date.now()}.osm.pbf`);
    const insideLat = 43.54;
    const insideLng = -72.4;

    const entities: PbfRawEntity[] = [
      entity({
        type: "node",
        id: 1,
        lat: insideLat,
        lon: insideLng,
        tags: { shop: "bakery", name: "Village Bakery" },
      }),
      entity({
        type: "way",
        id: 20,
        geometry: [
          { lat: insideLat, lon: insideLng },
          { lat: insideLat + 0.01, lon: insideLng + 0.01 },
        ],
        tags: { highway: "residential" },
      }),
      entity({
        type: "node",
        id: 99,
        lat: 44.9,
        lon: -71.2,
        tags: { shop: "far" },
      }),
    ];

    setPbfCopierV2ViewportPreviewHooks({
      readerFactory: buildSyntheticReaderFactory({ entities, filePath: file }),
    });

    const result = await scanPbfViewportPreview({ pbfPath: file, bbox: HARTLAND_BBOX, mode: "raw_osm" });

    expect(result.stats.previewMode).toBe("raw_osm");
    expect(result.items.length).toBe(2);
    expect(result.items.some((d) => d.displayName === "Village Bakery")).toBe(true);
    expect(result.items.some((d) => d.kind === "unexplored_route" && d.displayName.includes("highway=residential"))).toBe(
      true
    );
  });

  it("scan uses classifier and returns trail geometry in preview docs", async () => {
    const file = await makeFakePbfFile(`v2-classifier-${Date.now()}.osm.pbf`);
    const insideLat = 43.54;
    const insideLng = -72.4;

    const entities: PbfRawEntity[] = [
      entity({
        type: "node",
        id: 1,
        lat: insideLat,
        lon: insideLng,
        tags: { tourism: "viewpoint", name: "Quechee Lookout" },
      }),
      entity({
        type: "node",
        id: 2,
        lat: 44.9,
        lon: -71.2,
        tags: { tourism: "viewpoint", name: "Far Away" },
      }),
      entity({
        type: "way",
        id: 10,
        geometry: [
          { lat: insideLat, lon: insideLng },
          { lat: insideLat + 0.02, lon: insideLng + 0.02 },
        ],
        tags: { highway: "path", name: "Hartland Path", sac_scale: "hiking" },
      }),
    ];

    setPbfCopierV2ViewportPreviewHooks({
      readerFactory: buildSyntheticReaderFactory({ entities, filePath: file }),
      classify: vi.fn(async () =>
        mockClassificationResult({
          spots: [mockSpot()],
          routes: [mockRoute()],
        })
      ),
    });

    const result = await scanPbfViewportPreview({ pbfPath: file, bbox: HARTLAND_BBOX, mode: "locava_filtered" });

    expect(result.ok).toBe(true);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.stats.candidatesSentToClassifier).toBeGreaterThan(0);
    expect(result.stats.classifierAcceptedRoutes).toBeGreaterThanOrEqual(1);

    const routeDoc = result.items.find((d) => d.kind === "unexplored_route");
    expect(routeDoc).toBeTruthy();
    expect(routeDoc!.routeLineCoordinates?.length).toBeGreaterThanOrEqual(2);
    expect(routeDoc!.hasRouteGeometry).toBe(true);

    const spotDoc = result.items.find((d) => d.kind === "unexplored_spot");
    expect(spotDoc?.displayName).toContain("Quechee");
  });
});
