import { describe, expect, it } from "vitest";
import type { UnexploredRoute, UnexploredSpot } from "../../../../contracts/entities/osm-national-entities.contract.js";
import {
  buildPbfV2WritePayload,
  computePbfV2SourceKey,
  validatePbfV2PreviewDocForWrite,
} from "./pbfCopierV2WritePayload.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

function spotPayload(id: string): UnexploredSpot {
  return {
    id,
    kind: "unexplored_spot",
    itemType: "undiscovered_spot",
    sourceCollection: "unexploredSpots",
    displayName: "Mount Tom Viewpoint",
    title: "Mount Tom Viewpoint",
    category: "viewpoint",
    primaryActivity: "hiking",
    activities: ["hiking"],
    lat: 43.54,
    lng: -72.39,
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
  } as UnexploredSpot;
}

function routePayload(id: string): UnexploredRoute {
  return {
    id,
    kind: "unexplored_route",
    itemType: "undiscovered_route",
    sourceCollection: "unexploredRoutes",
    displayName: "Howland Trail",
    title: "Howland Trail",
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

function spotDoc(overrides: Partial<PbfCopierPreviewDoc> = {}): PbfCopierPreviewDoc {
  const payload = spotPayload("spot:a");
  return {
    id: "spot:a",
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName: "Mount Tom Viewpoint",
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "viewpoint",
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
    sourceTagSample: { tourism: "viewpoint", name: "Mount Tom Viewpoint" },
    writePayload: payload as unknown as Record<string, unknown>,
    warnings: [],
    ...overrides,
  };
}

function routeDoc(overrides: Partial<PbfCopierPreviewDoc> = {}): PbfCopierPreviewDoc {
  const payload = routePayload("route:b");
  return {
    id: "route:b",
    kind: "unexplored_route",
    collection: "unexploredRoutes",
    displayName: "Howland Trail",
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
    sourceTagSample: { highway: "path", name: "Howland Trail" },
    writePayload: payload as unknown as Record<string, unknown>,
    warnings: [],
    routeLineCoordinates: [
      { lat: 43.54, lng: -72.39 },
      { lat: 43.55, lng: -72.38 },
    ],
    destinationGroupId: "grp-howland",
    ...overrides,
  };
}

const bbox = { westLng: -72.5, southLat: 43.4, eastLng: -72.3, northLat: 43.6 };

describe("pbfCopierV2WritePayload", () => {
  it("computes deterministic source keys", () => {
    expect(computePbfV2SourceKey(spotDoc())).toBe("osm-v2:node:1");
    expect(computePbfV2SourceKey(routeDoc())).toBe("osm-v2-route-group:grp-howland");
  });

  it("builds payloads for all visible filtered items", () => {
    const visible = [spotDoc(), routeDoc()];
    const raw = [...visible, spotDoc({ id: "junk", osmId: 99, filteredOut: true, filterReason: "infrastructure" })];
    const plan = buildPbfV2WritePayload({
      visibleItems: visible,
      rawItems: raw,
      bbox,
      scanCacheId: "cache-1",
      selectedWriteScope: "all_visible",
    });
    expect(plan.spotsPlanned).toBe(1);
    expect(plan.routesPlanned).toBe(1);
    expect(plan.skippedFilteredOut).toBe(0);
    expect((plan.spots[0] as unknown as { osmV2?: { sourceKey: string } }).osmV2?.sourceKey).toBe(
      "osm-v2:node:1"
    );
  });

  it("excludes hidden junk unless includeHidden", () => {
    const hidden = spotDoc({ id: "hidden", osmId: 5, filteredOut: true, filterReason: "railway" });
    const plan = buildPbfV2WritePayload({
      visibleItems: [hidden],
      rawItems: [hidden],
      bbox,
      scanCacheId: null,
      selectedWriteScope: "all_visible",
    });
    expect(plan.spotsPlanned).toBe(0);
    expect(plan.skippedFilteredOut).toBe(1);
  });

  it("skips attached support objects by default", () => {
    const parking = spotDoc({
      id: "parking",
      osmId: 10,
      displayName: "Trail Parking",
      attachedTo: { osmType: "way", osmId: 2, displayName: "Howland Trail" },
      sourceTagSample: { amenity: "parking" },
    });
    expect(validatePbfV2PreviewDocForWrite(parking)).toContain("support_attached_to_parent");
    const plan = buildPbfV2WritePayload({
      visibleItems: [parking, spotDoc()],
      rawItems: [parking, spotDoc()],
      bbox,
      scanCacheId: null,
      selectedWriteScope: "all_visible",
    });
    expect(plan.spotsPlanned).toBe(1);
    expect(plan.skippedSupportOnly).toBe(1);
  });

  it("nests support metadata on parent route", () => {
    const route = routeDoc({
      supportMetadata: {
        parking: [
          {
            displayName: "Lot A",
            lat: 43.541,
            lng: -72.391,
            osmType: "node",
            osmId: 20,
            distanceMeters: 40,
            tags: { amenity: "parking" },
            attachReason: "near_trail",
          },
        ],
      },
    });
    const plan = buildPbfV2WritePayload({
      visibleItems: [route],
      rawItems: [route],
      bbox,
      scanCacheId: null,
      selectedWriteScope: "all_visible",
    });
    expect(plan.routesPlanned).toBe(1);
    expect(plan.supportObjectsNested).toBe(1);
    const written = plan.routes[0] as unknown as { osmV2?: { supportMetadata?: unknown } };
    expect(written.osmV2?.supportMetadata).toBeTruthy();
  });

  it("rejects generic tag labels", () => {
    const junk = spotDoc({
      displayName: "highway=footway",
      sourceTagSample: { highway: "footway" },
    });
    expect(validatePbfV2PreviewDocForWrite(junk)).toContain("generic_or_missing_display_name");
  });

  it("respects viewport_rendered scope", () => {
    const a = spotDoc({ id: "a" });
    const b = spotDoc({ id: "b", osmId: 3, displayName: "Other Spot" });
    const plan = buildPbfV2WritePayload({
      visibleItems: [a, b],
      rawItems: [a, b],
      bbox,
      scanCacheId: null,
      selectedWriteScope: "viewport_rendered",
      viewportRenderedIds: ["a"],
    });
    expect(plan.spotsPlanned).toBe(1);
    expect(plan.spots[0]?.id).toBe("spot:a");
  });

  it("builds write payloads for raw V2 preview docs without writePayload", () => {
    const rawSpot = spotDoc({
      id: "raw:node/99",
      writePayload: undefined,
      displayName: "Ascutney State Park",
      primaryActivity: "hiking",
      activities: ["hiking"],
      primaryCategory: "park",
      sourceTagSample: { tourism: "attraction", name: "Ascutney State Park", leisure: "park" },
    });
    const plan = buildPbfV2WritePayload({
      visibleItems: [rawSpot],
      rawItems: [rawSpot],
      bbox,
      scanCacheId: "cache-1",
      selectedWriteScope: "all_visible",
      writeRunId: "test-run",
    });
    expect(plan.spotsPlanned).toBe(1);
    expect(plan.skippedInvalid).toBe(0);
    expect(plan.spots[0]?.displayName).toBe("Ascutney State Park");
    expect(plan.spots[0]?.sourceCollection).toBe("unexploredSpots");
  });
});
