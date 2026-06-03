import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import {
  applyPbfQualityFilters,
  DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
  hasMeaningfulPreviewName,
  isProtectedFromQualityFilter,
} from "./pbfCopierV2QualityFilters.js";

function mkDoc(input: {
  displayName: string;
  tags?: Record<string, string>;
  kind?: PbfCopierPreviewDoc["kind"];
  warnings?: string[];
  geometryPointCount?: number;
}): PbfCopierPreviewDoc {
  return {
    id: `test:${input.displayName}`,
    kind: input.kind ?? "unexplored_spot",
    collection: input.kind === "unexplored_route" ? "unexploredRoutes" : "unexploredSpots",
    displayName: input.displayName,
    primaryActivity: null,
    activities: [],
    primaryCategory: "osm",
    lat: 43.7,
    lng: -72.3,
    sourceFamily: "test",
    sourceKeys: ["way/1"],
    sourceIds: ["1"],
    osmType: "way",
    osmId: 1,
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
    geometryPointCount: input.geometryPointCount,
  };
}

describe("pbfCopierV2QualityFilters", () => {
  const goodItems = [
    mkDoc({ displayName: "South Esker Natural Area", tags: { leisure: "nature_reserve", name: "South Esker Natural Area" } }),
    mkDoc({ displayName: "Titcomb Cabin", tags: { tourism: "wilderness_hut", name: "Titcomb Cabin" } }),
    mkDoc({
      displayName: "Hazen Trail",
      kind: "unexplored_route",
      tags: { highway: "path", name: "Hazen Trail" },
      warnings: ["v2_hiking_trail_merged"],
    }),
    mkDoc({
      displayName: "Mink Brook Trail",
      kind: "unexplored_route",
      tags: { highway: "footway", name: "Mink Brook Trail" },
      warnings: ["v2_hiking_trail_merged"],
    }),
    mkDoc({
      displayName: "Ridge Trail",
      kind: "unexplored_route",
      tags: { highway: "path", name: "Ridge Trail", sac_scale: "hiking" },
      warnings: ["v2_hiking_trail_merged"],
    }),
    mkDoc({ displayName: "Trailhead Parking", tags: { highway: "trailhead", amenity: "parking" } }),
    mkDoc({ displayName: "Saturn", tags: { tourism: "information", board_type: "planet_walk", name: "Saturn" } }),
    mkDoc({ displayName: "Gilman Island", tags: { place: "island", name: "Gilman Island" } }),
  ];

  const badItems = [
    mkDoc({ displayName: "power tower", tags: { power: "tower" } }),
    mkDoc({ displayName: "power line", kind: "unexplored_route", tags: { power: "line" } }),
    mkDoc({ displayName: "Fuel tank", tags: { man_made: "storage_tank" } }),
    mkDoc({ displayName: "Sewage plant", tags: { man_made: "wastewater_plant" } }),
    mkDoc({ displayName: "I-91", kind: "unexplored_route", tags: { highway: "motorway", name: "Interstate 91", ref: "I 91" } }),
    mkDoc({ displayName: "Driveway", kind: "unexplored_route", tags: { highway: "service", service: "driveway" } }),
    mkDoc({ displayName: "Town line", tags: { boundary: "administrative", admin_level: "8" } }),
    mkDoc({ displayName: "CSX main", kind: "unexplored_route", tags: { railway: "rail" } }),
    mkDoc({
      displayName: "Connecticut River",
      kind: "unexplored_route",
      tags: { waterway: "river", name: "Connecticut River" },
      geometryPointCount: 120,
    }),
    mkDoc({ displayName: "highway=path", kind: "unexplored_route", tags: { highway: "path" }, warnings: ["v2_line_no_marker"] }),
    mkDoc({ displayName: "natural=wood", tags: { natural: "wood" } }),
    mkDoc({ displayName: "information=route_marker", tags: { tourism: "information", information: "route_marker" } }),
  ];

  it("hasMeaningfulPreviewName rejects generic highway labels", () => {
    expect(hasMeaningfulPreviewName(mkDoc({ displayName: "highway=path", tags: { highway: "path" } }))).toBe(false);
    expect(hasMeaningfulPreviewName(mkDoc({ displayName: "Hazen Trail", tags: { name: "Hazen Trail" } }))).toBe(true);
  });

  it("protects named trails, cabins, reserves, planet walk", () => {
    for (const doc of goodItems) {
      expect(isProtectedFromQualityFilter(doc)).toBe(true);
    }
  });

  it("with default filters ON keeps good items visible and hides junk", () => {
    const sample = [...goodItems, ...badItems];
    const result = applyPbfQualityFilters(sample, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);

    expect(result.summary.rawItems).toBe(sample.length);
    expect(result.summary.hiddenItems).toBeGreaterThanOrEqual(badItems.length);
    expect(result.groupingSummary?.routeGroupsBuilt).toBeGreaterThanOrEqual(3);

    const alwaysVisible = goodItems.filter((d) => d.displayName !== "Trailhead Parking");
    for (const doc of alwaysVisible) {
      const found = result.items.find((d) => d.displayName === doc.displayName);
      expect(found?.filteredOut, `${doc.displayName} should stay visible`).toBe(false);
    }

    const trailheadParking = result.items.find((d) => d.displayName === "Trailhead Parking");
    expect(trailheadParking?.filteredOut).toBe(true);
    expect(trailheadParking?.attachedTo?.displayName).toBeTruthy();

    for (const doc of badItems) {
      const found = result.items.find((d) => d.id === doc.id);
      expect(found?.filteredOut, `${doc.displayName} should be hidden`).toBe(true);
      expect(found?.filteredBy.length).toBeGreaterThan(0);
      expect(found?.filterReason.length).toBeGreaterThan(0);
    }
  });

  it("respects disabled filter toggles", () => {
    const onlyInfraOff = applyPbfQualityFilters(badItems, {
      ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
      hideInfrastructure: false,
    });
    const powerTower = onlyInfraOff.items.find((d) => d.displayName === "power tower");
    expect(powerTower?.filteredOut).toBe(true);
    expect(powerTower?.filterReason).toMatch(/power/i);
    expect(onlyInfraOff.items.find((d) => d.displayName === "I-91")?.filteredOut).toBe(true);

    const productOff = applyPbfQualityFilters(badItems, {
      ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
      hideInfrastructure: false,
      hideNonDestinationAmenities: false,
    });
    expect(productOff.items.find((d) => d.displayName === "power tower")?.filteredOut).toBe(false);
  });

  it("does not mutate route geometry fields", () => {
    const trail = mkDoc({
      displayName: "Hazen Trail",
      kind: "unexplored_route",
      tags: { highway: "path", name: "Hazen Trail" },
      warnings: ["v2_hiking_trail_merged"],
    });
    trail.routeLineCoordinates = [
      { lat: 43.1, lng: -72.1 },
      { lat: 43.2, lng: -72.2 },
    ];
    trail.geometryPointCount = 2;
    const before = trail.routeLineCoordinates.length;
    const result = applyPbfQualityFilters([trail]);
    expect(result.items[0]!.routeLineCoordinates?.length).toBe(before);
    expect(result.items[0]!.filteredOut).toBe(false);
  });
});
