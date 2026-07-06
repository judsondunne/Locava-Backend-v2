import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { applyPbfQualityFilters, DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "./pbfCopierV2QualityFilters.js";
import {
  isQualifiedTerrainDestination,
  UNQUALIFIED_TERRAIN_FILTER_REASON,
} from "./pbfCopierV2TerrainQualification.js";
import type { NamedTrailLine } from "./pbfCopierV2TrailProximity.js";

function mkDoc(input: {
  displayName: string;
  tags?: Record<string, string>;
  kind?: PbfCopierPreviewDoc["kind"];
  warnings?: string[];
  osmId?: number;
  lat?: number;
  lng?: number;
  routeLineCoordinates?: Array<{ lat: number; lng: number }>;
}): PbfCopierPreviewDoc {
  return {
    id: `test:${input.osmId ?? input.displayName}`,
    kind: input.kind ?? "unexplored_spot",
    collection: input.kind === "unexplored_route" ? "unexploredRoutes" : "unexploredSpots",
    displayName: input.displayName,
    primaryActivity: null,
    activities: [],
    primaryCategory: "osm",
    lat: input.lat ?? 43.61,
    lng: input.lng ?? -72.97,
    sourceFamily: "test",
    sourceKeys: [`node/${input.osmId ?? 1}`],
    sourceIds: [String(input.osmId ?? 1)],
    osmType: "node",
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
  };
}

const appalachianTrail: NamedTrailLine = {
  osmType: "way",
  osmId: 9001,
  displayName: "Appalachian Trail",
  coordinates: [
    { lat: 43.609, lng: -72.971 },
    { lat: 43.612, lng: -72.968 },
  ],
};

const deerLeapOverlookTrail = mkDoc({
  displayName: "Deer Leap Overlook Trail",
  kind: "unexplored_route",
  osmId: 100,
  tags: { highway: "path", name: "Deer Leap Overlook Trail" },
  warnings: ["v2_hiking_trail_merged"],
  lat: 43.6095,
  lng: -72.9705,
  routeLineCoordinates: appalachianTrail.coordinates,
});

describe("pbfCopierV2UndiscoveredQualityRegression", () => {
  const mustHide = [
    mkDoc({
      displayName: "Teago Hill",
      osmId: 1,
      tags: { natural: "peak", name: "Teago Hill", ele: "1042", "gnis:feature_id": "1461234", wikidata: "Q999" },
    }),
    mkDoc({
      displayName: "High Mountain Road",
      kind: "unexplored_route",
      osmId: 2,
      tags: { highway: "residential", name: "High Mountain Road" },
      routeLineCoordinates: [
        { lat: 43.61, lng: -72.97 },
        { lat: 43.615, lng: -72.965 },
      ],
    }),
    mkDoc({
      displayName: "East Mountain Road",
      kind: "unexplored_route",
      osmId: 3,
      tags: { highway: "unclassified", name: "East Mountain Road" },
      routeLineCoordinates: [
        { lat: 43.61, lng: -72.97 },
        { lat: 43.615, lng: -72.965 },
      ],
    }),
    mkDoc({
      displayName: "Bear Mountain Road",
      kind: "unexplored_route",
      osmId: 4,
      tags: { highway: "service", name: "Bear Mountain Road" },
      routeLineCoordinates: [
        { lat: 43.61, lng: -72.97 },
        { lat: 43.615, lng: -72.965 },
      ],
    }),
    mkDoc({
      displayName: "Summit Road",
      kind: "unexplored_route",
      osmId: 5,
      tags: { highway: "track", name: "Summit Road" },
      routeLineCoordinates: [
        { lat: 43.61, lng: -72.97 },
        { lat: 43.615, lng: -72.965 },
      ],
    }),
    mkDoc({
      displayName: "Quartz Mountain Road",
      kind: "unexplored_route",
      osmId: 6,
      tags: { highway: "track", name: "Quartz Mountain Road", access: "private" },
      routeLineCoordinates: [
        { lat: 43.61, lng: -72.97 },
        { lat: 43.615, lng: -72.965 },
      ],
    }),
    mkDoc({
      displayName: "Sykes Mountain Avenue",
      kind: "unexplored_route",
      osmId: 7,
      tags: { highway: "residential", name: "Sykes Mountain Avenue" },
      routeLineCoordinates: [
        { lat: 43.61, lng: -72.97 },
        { lat: 43.615, lng: -72.965 },
      ],
    }),
    mkDoc({ displayName: "Tennis Court", osmId: 8, tags: { leisure: "pitch", sport: "tennis", name: "Tennis Court" } }),
    mkDoc({
      displayName: "Basketball Court",
      osmId: 9,
      tags: { leisure: "pitch", sport: "basketball", name: "Basketball Court" },
    }),
    mkDoc({ displayName: "Sports Field", osmId: 10, tags: { leisure: "pitch", sport: "soccer", name: "Sports Field" } }),
    mkDoc({ displayName: "area=yes", osmId: 11, tags: { area: "yes" } }),
    mkDoc({ displayName: "barrier=retaining_wall", osmId: 12, tags: { barrier: "retaining_wall" } }),
    mkDoc({ displayName: "barrier=hedge", osmId: 13, tags: { barrier: "hedge" } }),
    mkDoc({ displayName: "natural=tree_row", osmId: 14, tags: { natural: "tree_row" } }),
    mkDoc({ displayName: "natural=rock", osmId: 15, tags: { natural: "rock" } }),
    mkDoc({ displayName: "Vanessa's Salon", osmId: 16, tags: { shop: "hairdresser", name: "Vanessa's Salon" } }),
    mkDoc({ displayName: "Supercuts", osmId: 17, tags: { shop: "hairdresser", name: "Supercuts" } }),
    mkDoc({ displayName: "Hannaford", osmId: 18, tags: { shop: "supermarket", name: "Hannaford" } }),
    mkDoc({ displayName: "Target", osmId: 19, tags: { shop: "department_store", name: "Target" } }),
    mkDoc({ displayName: "PetSmart", osmId: 20, tags: { shop: "pet", name: "PetSmart" } }),
    mkDoc({ displayName: "Mobil", osmId: 21, tags: { amenity: "fuel", name: "Mobil" } }),
    mkDoc({ displayName: "bus stop", osmId: 22, tags: { highway: "bus_stop" } }),
    mkDoc({ displayName: "stop position", osmId: 23, tags: { public_transport: "stop_position" } }),
    mkDoc({
      displayName: "Lower Hurricane Reservoir Dam",
      osmId: 24,
      tags: { "demolished:waterway": "dam", name: "Lower Hurricane Reservoir Dam" },
    }),
    mkDoc({
      displayName: "Beaver Pond Dam",
      osmId: 25,
      tags: { "demolished:waterway": "dam", name: "Beaver Pond Dam" },
    }),
    mkDoc({
      displayName: "Piecemeal Pies",
      osmId: 26,
      tags: { "closed:amenity": "restaurant", name: "Piecemeal Pies" },
    }),
    mkDoc({
      displayName: "Crystal Pond",
      osmId: 27,
      tags: { natural: "water", name: "Crystal Pond", access: "private" },
    }),
    mkDoc({
      displayName: "Bald Hill",
      osmId: 28,
      tags: { natural: "peak", name: "Bald Hill", ele: "420", gnis: "1456789", wikidata: "Q123" },
    }),
    mkDoc({
      displayName: "Pleasant View Cemetery",
      osmId: 29,
      tags: { landuse: "cemetery", name: "Pleasant View Cemetery" },
    }),
  ];

  const mustKeep = [
    mkDoc({
      displayName: "Deer Leap Rock",
      osmId: 101,
      lat: 43.61,
      lng: -72.9702,
      tags: { natural: "peak", name: "Deer Leap Rock" },
    }),
    mkDoc({
      displayName: "Deer Leap Mountain",
      osmId: 102,
      lat: 43.6105,
      lng: -72.9703,
      tags: { natural: "peak", name: "Deer Leap Mountain", wikipedia: "en:Deer Leap Mountain" },
    }),
    deerLeapOverlookTrail,
    mkDoc({
      displayName: "Round Pinnacle",
      osmId: 104,
      lat: 43.6108,
      lng: -72.9701,
      tags: { natural: "peak", name: "Round Pinnacle" },
    }),
    mkDoc({
      displayName: "Mount Tom",
      osmId: 105,
      lat: 43.626,
      lng: -72.52,
      tags: { natural: "peak", name: "Mount Tom", wikipedia: "en:Mount Tom (Vermont)" },
    }),
    mkDoc({
      displayName: "Mount Peg",
      osmId: 106,
      lat: 43.611,
      lng: -72.9704,
      tags: { natural: "peak", name: "Mount Peg", wikipedia: "en:Mount Peg" },
    }),
    mkDoc({
      displayName: "Killington Peak",
      osmId: 107,
      lat: 43.6115,
      lng: -72.9706,
      tags: { natural: "peak", name: "Killington Peak", ele: "1293", wikipedia: "en:Killington Peak" },
    }),
    mkDoc({
      displayName: "Pico Peak",
      osmId: 108,
      lat: 43.612,
      lng: -72.9708,
      tags: { natural: "peak", name: "Pico Peak", wikipedia: "en:Pico Peak" },
    }),
    mkDoc({
      displayName: "The Lookout",
      osmId: 109,
      tags: { tourism: "viewpoint", name: "The Lookout" },
    }),
    mkDoc({
      displayName: "Appalachian Trail",
      kind: "unexplored_route",
      osmId: 110,
      tags: { highway: "path", name: "Appalachian Trail", route: "hiking" },
      warnings: ["v2_hiking_trail_merged"],
      routeLineCoordinates: appalachianTrail.coordinates,
    }),
    mkDoc({
      displayName: "Moss Glen Falls",
      osmId: 111,
      tags: { waterway: "waterfall", name: "Moss Glen Falls" },
    }),
    mkDoc({
      displayName: "North Beach",
      osmId: 112,
      tags: { natural: "beach", name: "North Beach" },
    }),
    mkDoc({
      displayName: "Lake Rescue Beach",
      osmId: 113,
      tags: { leisure: "swimming_area", name: "Lake Rescue Beach" },
    }),
    mkDoc({
      displayName: "Town Dock",
      osmId: 114,
      tags: { amenity: "slipway", name: "Town Dock", boat: "yes" },
    }),
    mkDoc({
      displayName: "Worthy Burger",
      osmId: 115,
      tags: { amenity: "restaurant", name: "Worthy Burger" },
    }),
    mkDoc({
      displayName: "Middlebury College Museum",
      osmId: 116,
      tags: { tourism: "museum", name: "Middlebury College Museum" },
    }),
    mkDoc({
      displayName: "The Pogue",
      osmId: 117,
      lat: 43.624,
      lng: -72.53,
      tags: { natural: "water", name: "The Pogue" },
    }),
    mkDoc({
      displayName: "West Woodstock Bridge",
      osmId: 118,
      lat: 43.612,
      lng: -72.54,
      tags: { man_made: "bridge", bridge: "yes", name: "West Woodstock Bridge" },
    }),
    mkDoc({
      displayName: "Middle Covered Bridge",
      osmId: 119,
      lat: 43.625,
      lng: -72.52,
      tags: { man_made: "bridge", name: "Middle Covered Bridge" },
    }),
  ];

  it("isQualifiedTerrainDestination rejects GNIS-only hills and accepts destination peaks", () => {
    const teago = mkDoc({
      displayName: "Teago Hill",
      tags: { natural: "peak", name: "Teago Hill", ele: "1042", "gnis:feature_id": "1", wikidata: "Q1" },
    });
    expect(isQualifiedTerrainDestination(teago, { trails: [] })).toBe(false);

    const deerLeap = mkDoc({
      displayName: "Deer Leap Rock",
      lat: 43.61,
      lng: -72.9702,
      tags: { natural: "peak", name: "Deer Leap Rock" },
    });
    expect(isQualifiedTerrainDestination(deerLeap, { trails: [appalachianTrail] })).toBe(true);

    const mountTom = mkDoc({
      displayName: "Mount Tom",
      tags: { natural: "peak", name: "Mount Tom", wikipedia: "en:Mount Tom" },
    });
    expect(isQualifiedTerrainDestination(mountTom, { trails: [] })).toBe(true);
  });

  it("hides junk retail, roads, terrain labels, and private objects", () => {
    const sample = [...mustKeep, ...mustHide];
    const result = applyPbfQualityFilters(sample, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);

    for (const doc of mustHide) {
      const found = result.items.find((d) => d.osmId === doc.osmId);
      expect(found?.filteredOut, `${doc.displayName} should be hidden`).toBe(true);
    }

    const teago = result.items.find((d) => d.osmId === 1);
    expect(teago?.filteredBy).toEqual(expect.arrayContaining(["unqualified_terrain_peak"]));
    expect(teago?.filterReason).toContain(UNQUALIFIED_TERRAIN_FILTER_REASON);

    const summitRoad = result.items.find((d) => d.osmId === 5);
    expect(summitRoad?.filteredBy).toEqual(expect.arrayContaining(["generic_road_route"]));

    const crystalPond = result.items.find((d) => d.osmId === 27);
    expect(crystalPond?.filteredBy).toEqual(expect.arrayContaining(["private_or_restricted_access"]));
  });

  it("keeps real trails, viewpoints, peaks, water, food, and culture destinations", () => {
    const sample = [...mustKeep, ...mustHide];
    const result = applyPbfQualityFilters(sample, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);

    for (const doc of mustKeep) {
      const found = result.items.find((d) => d.osmId === doc.osmId);
      expect(found?.filteredOut, `${doc.displayName} should stay visible`).toBe(false);
    }
  });
});
