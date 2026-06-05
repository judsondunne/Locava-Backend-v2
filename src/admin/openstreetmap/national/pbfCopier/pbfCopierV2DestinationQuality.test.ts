import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import {
  applyPbfQualityFilters,
  DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
} from "./pbfCopierV2QualityFilters.js";
import {
  isResidentialNonDestination,
  isUnnamedRealHikingTrail,
  buildUnnamedHikingTrailContext,
} from "./pbfCopierV2DestinationQuality.js";
import { postProcessRawOsmPreviewDocs } from "./pbfCopierV2RawDisplay.js";

function mkDoc(input: {
  displayName: string;
  tags?: Record<string, string>;
  kind?: PbfCopierPreviewDoc["kind"];
  warnings?: string[];
  osmId?: number;
  osmType?: PbfCopierPreviewDoc["osmType"];
  lat?: number;
  lng?: number;
  routeLineCoordinates?: Array<{ lat: number; lng: number }>;
  primaryActivity?: string | null;
  geometryPointCount?: number;
  filteredOut?: boolean;
}): PbfCopierPreviewDoc {
  return {
    id: `test:${input.osmId ?? input.displayName}`,
    kind: input.kind ?? "unexplored_spot",
    collection: input.kind === "unexplored_route" ? "unexploredRoutes" : "unexploredSpots",
    displayName: input.displayName,
    primaryActivity: input.primaryActivity ?? null,
    activities: [],
    primaryCategory: "osm",
    lat: input.lat ?? 43.7,
    lng: input.lng ?? -72.3,
    sourceFamily: "test",
    sourceKeys: [`${input.osmType ?? "way"}/${input.osmId ?? 1}`],
    sourceIds: [String(input.osmId ?? 1)],
    osmType: input.osmType ?? "way",
    osmId: input.osmId ?? 1,
    origin: "generated_osm",
    mapReadiness: "review",
    publicMapEligible: false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "test",
    importPipelineVersion: "test",
    pbfFilePath: "/tmp/test.pbf",
    sourceProvider: "test",
    sourceTagSample: input.tags ?? {},
    warnings: input.warnings ?? [],
    routeLineCoordinates: input.routeLineCoordinates,
    geometryPointCount: input.geometryPointCount,
    filteredOut: input.filteredOut,
  };
}

describe("pbfCopierV2DestinationQuality", () => {
  it("isResidentialNonDestination hides Woodhaven but keeps real destinations", () => {
    expect(
      isResidentialNonDestination({
        landuse: "residential",
        name: "Woodhaven",
        residential: "condominium",
      })
    ).toBe(true);

    expect(isResidentialNonDestination({ landuse: "residential", name: "Woodhaven" })).toBe(true);
    expect(isResidentialNonDestination({ building: "house", name: "355 Main" })).toBe(true);
    expect(isResidentialNonDestination({ place: "neighbourhood", name: "Old North End" })).toBe(true);

    expect(
      isResidentialNonDestination({ landuse: "residential", amenity: "restaurant", name: "Worthy Burger" })
    ).toBe(false);
    expect(isResidentialNonDestination({ leisure: "park", name: "Billings Park" })).toBe(false);
    expect(isResidentialNonDestination({ tourism: "viewpoint", name: "Scenic Overlook" })).toBe(false);
    expect(isResidentialNonDestination({ shop: "bakery", building: "commercial", name: "Local Bakery" })).toBe(
      false
    );
  });

  it("filters Woodhaven with residential_land in quality pipeline", () => {
    const woodhaven = mkDoc({
      displayName: "Woodhaven",
      osmId: 926414372,
      osmType: "way",
      tags: {
        landuse: "residential",
        name: "Woodhaven",
        residential: "condominium",
      },
      primaryActivity: "landuse=residential",
    });
    const restaurant = mkDoc({
      displayName: "Worthy Burger",
      osmId: 10,
      tags: { amenity: "restaurant", name: "Worthy Burger" },
    });

    const result = applyPbfQualityFilters([woodhaven, restaurant], DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    const hidden = result.items.find((d) => d.osmId === 926414372);
    expect(hidden?.filteredOut).toBe(true);
    expect(hidden?.filteredBy).toEqual(expect.arrayContaining(["residential_land"]));
    expect(result.destinationQualityCounters?.residentialNonDestinationsFiltered).toBe(1);
    expect(result.items.find((d) => d.osmId === 10)?.filteredOut).toBe(false);
  });

  it("shows rail bridge without water requirement and keeps normal railway hidden", () => {
    const railBridge = mkDoc({
      displayName: "Lyndonville Subdivision",
      kind: "unexplored_route",
      osmId: 464233635,
      tags: {
        railway: "rail",
        bridge: "yes",
        layer: "1",
        operator: "Washington County Railroad",
      },
      lat: 44.52,
      lng: -72.45,
      routeLineCoordinates: [
        { lat: 44.5199, lng: -72.4501 },
        { lat: 44.5201, lng: -72.4499 },
      ],
      geometryPointCount: 2,
    });
    const normalRail = mkDoc({
      displayName: "CSX main",
      kind: "unexplored_route",
      osmId: 201,
      tags: { railway: "rail" },
      routeLineCoordinates: [
        { lat: 43.7, lng: -72.3 },
        { lat: 43.71, lng: -72.29 },
      ],
    });

    const result = applyPbfQualityFilters([railBridge, normalRail], DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    const bridge = result.items.find((d) => d.osmId === 464233635);
    expect(bridge?.primaryActivity).toBe("train_bridge");
    expect(bridge?.filteredOut).toBe(false);
    expect(bridge?.filteredBy ?? []).not.toContain("railway");
    expect(bridge?.routeLineColor).toBeTruthy();
    expect(bridge?.routeMarkerCoordinate).toBeTruthy();
    expect(result.destinationQualityCounters?.railroadBridgesForcedVisible).toBeGreaterThanOrEqual(1);
    expect(result.destinationQualityCounters?.railBridgesForcedVisible).toBeGreaterThanOrEqual(1);

    const rail = result.items.find((d) => d.osmId === 201);
    expect(rail?.filteredOut).toBe(true);
    expect(rail?.filteredBy).toContain("railway");
  });

  it("keeps self-matched hiking connector visible (osmId 473612997 regression)", () => {
    const connector = mkDoc({
      displayName: "highway=footway Connector Trail",
      kind: "unexplored_route",
      osmId: 473612997,
      tags: { highway: "footway", surface: "ground" },
      primaryActivity: "hiking",
      warnings: ["v2_hiking_trail_merged"],
      lat: 44.53,
      lng: -72.44,
      routeLineCoordinates: [
        { lat: 44.5299, lng: -72.4401 },
        { lat: 44.5301, lng: -72.4399 },
      ],
    });

    const result = applyPbfQualityFilters([connector], DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    const item = result.items.find((d) => d.osmId === 473612997);
    expect(item?.filteredOut).toBe(false);
    expect(item?.filteredBy ?? []).not.toContain("support_attached");
    expect(item?.primaryActivity).toBe("hiking");
    expect(item?.displayName).not.toMatch(/^highway=/i);
    expect(result.destinationQualityCounters?.selfAttachedRoutesUnhidden).toBeGreaterThanOrEqual(0);
  });

  it("accepts unnamed hiking trails with strong trail evidence and rejects sidewalks", () => {
    const namedTrail = mkDoc({
      displayName: "McKnight Trail",
      kind: "unexplored_route",
      osmId: 300,
      tags: { highway: "path", name: "McKnight Trail" },
      warnings: ["v2_hiking_trail_merged"],
      lat: 43.64,
      lng: -72.4,
      routeLineCoordinates: [
        { lat: 43.64, lng: -72.4 },
        { lat: 43.641, lng: -72.399 },
        { lat: 43.642, lng: -72.398 },
      ],
    });
    const unnamedTrail = mkDoc({
      displayName: "highway=path",
      kind: "unexplored_route",
      osmId: 301,
      tags: { highway: "path", foot: "designated", surface: "dirt", sac_scale: "hiking" },
      lat: 43.6405,
      lng: -72.3995,
      routeLineCoordinates: [
        { lat: 43.6405, lng: -72.3995 },
        { lat: 43.6408, lng: -72.3992 },
        { lat: 43.6411, lng: -72.3989 },
        { lat: 43.6414, lng: -72.3986 },
      ],
    });
    const sidewalk = mkDoc({
      displayName: "highway=footway",
      kind: "unexplored_route",
      osmId: 302,
      tags: { highway: "footway", footway: "sidewalk", surface: "concrete" },
      routeLineCoordinates: [
        { lat: 43.64, lng: -72.4 },
        { lat: 43.6402, lng: -72.3998 },
      ],
    });
    const junkPath = mkDoc({
      displayName: "highway=path",
      kind: "unexplored_route",
      osmId: 303,
      tags: { highway: "path", surface: "asphalt" },
      routeLineCoordinates: [
        { lat: 43.5, lng: -72.5 },
        { lat: 43.5002, lng: -72.4998 },
      ],
    });

    const context = buildUnnamedHikingTrailContext([namedTrail, unnamedTrail, sidewalk, junkPath]);
    expect(
      isUnnamedRealHikingTrail(
        unnamedTrail.sourceTagSample,
        { coordinates: unnamedTrail.routeLineCoordinates },
        context,
        { lat: 43.6408, lng: -72.3992 }
      )
    ).toBe(true);
    expect(
      isUnnamedRealHikingTrail(
        sidewalk.sourceTagSample,
        { coordinates: sidewalk.routeLineCoordinates },
        context,
        { lat: 43.64, lng: -72.4 }
      )
    ).toBe(false);

    const processed = postProcessRawOsmPreviewDocs([namedTrail, unnamedTrail, sidewalk, junkPath]);
    expect(processed.unnamedHikingTrailsIncluded).toBe(1);
    const promoted = processed.items.find((d) => d.osmId === 301);
    expect(promoted?.warnings).toContain("v2_unnamed_hiking_trail");
    expect(promoted?.derivedName).toBe(true);

    const filtered = applyPbfQualityFilters(processed.items, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    expect(filtered.items.find((d) => d.osmId === 301)?.filteredOut).toBe(false);
    expect(filtered.items.find((d) => d.osmId === 302)?.filteredOut).toBe(true);
    expect(filtered.items.find((d) => d.osmId === 303)?.filteredOut).toBe(true);
    expect(filtered.destinationQualityCounters?.unnamedHikingTrailsIncluded).toBe(1);
    expect(filtered.destinationQualityCounters?.unnamedPathsStillFiltered).toBeGreaterThanOrEqual(1);
  });

  it("final rescue keeps rail bridge visible and level_crossing hidden", () => {
    const railBridge = mkDoc({
      displayName: "Lyndonville Subdivision",
      kind: "unexplored_route",
      osmId: 464233635,
      tags: { railway: "rail", bridge: "yes", name: "Lyndonville Subdivision" },
      routeLineCoordinates: [
        { lat: 44.5199, lng: -72.4501 },
        { lat: 44.5201, lng: -72.4499 },
      ],
      filteredOut: true,
      primaryActivity: "railway=rail",
    });
    (railBridge as { filteredBy?: string[] }).filteredBy = ["railway"];

    const crossing = mkDoc({
      displayName: "Crossing",
      osmId: 502,
      tags: { railway: "level_crossing" },
    });

    const result = applyPbfQualityFilters([railBridge, crossing], DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    const bridge = result.items.find((d) => d.osmId === 464233635);
    expect(bridge?.filteredOut).toBe(false);
    expect(bridge?.primaryActivity).toBe("train_bridge");
    expect(bridge?.warnings).toContain("v2_final_rescue_train_bridge");
    expect(bridge?.routeMarkerCoordinate).toBeTruthy();
    expect(result.destinationQualityCounters?.finalRescuedTrainBridges).toBeGreaterThanOrEqual(1);

    const lc = result.items.find((d) => d.osmId === 502);
    expect(lc?.filteredOut).toBe(true);
    expect(lc?.filteredBy).toContain("railway");
  });

  it("final pass hides warehouse buildings and rescues ground hiking trail", () => {
    const warehouse = mkDoc({
      displayName: "building=warehouse",
      osmId: 500,
      tags: { building: "warehouse" },
    });
    const hiking = mkDoc({
      displayName: "highway=footway Connector Trail",
      kind: "unexplored_route",
      osmId: 473612997,
      tags: { highway: "footway", surface: "ground" },
      primaryActivity: "hiking",
      routeLineCoordinates: [
        { lat: 44.5299, lng: -72.4401 },
        { lat: 44.5301, lng: -72.4399 },
      ],
      filteredOut: true,
    });
    (hiking as { filteredBy?: string[] }).filteredBy = ["support_attached"];

    const result = applyPbfQualityFilters([warehouse, hiking], DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    const wh = result.items.find((d) => d.osmId === 500);
    expect(wh?.filteredOut).toBe(true);

    const trail = result.items.find((d) => d.osmId === 473612997);
    expect(trail?.filteredOut).toBe(false);
    expect(trail?.displayName).not.toMatch(/^highway=/i);
    expect(trail?.routeMarkerCoordinate).toBeTruthy();
    expect(trail?.routeLineColor).toBeTruthy();
    expect(trail?.warnings).toContain("v2_final_rescue_unmarked_hiking_trail");
  });
});
