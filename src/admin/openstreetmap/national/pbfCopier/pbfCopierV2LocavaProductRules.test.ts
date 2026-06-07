import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { applyPbfQualityFilters, DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "./pbfCopierV2QualityFilters.js";
import {
  enrichLocavaProductClassification,
  isLocavaFoodDrinkDestination,
  matchLocavaProductRules,
} from "./pbfCopierV2LocavaProductRules.js";

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
    lat: input.lat ?? 44.5,
    lng: input.lng ?? -72.5,
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

describe("pbfCopierV2LocavaProductRules", () => {
  it("hides place labels, lifts, schools, and generic lodging", () => {
    const items = [
      mkDoc({ displayName: "Rutland", tags: { place: "city", name: "Rutland" }, osmId: 1 }),
      mkDoc({ displayName: "Killington Village", tags: { place: "village", name: "Killington Village" }, osmId: 2 }),
      mkDoc({ displayName: "Sensation Quad", tags: { aerialway: "chair_lift", name: "Sensation Quad" }, osmId: 3 }),
      mkDoc({ displayName: "Rutland High School", tags: { amenity: "school", name: "Rutland High School" }, osmId: 4 }),
      mkDoc({ displayName: "Hampton Inn", tags: { tourism: "hotel", name: "Hampton Inn" }, osmId: 5 }),
      mkDoc({ displayName: "St Mary Church", tags: { amenity: "place_of_worship", name: "St Mary Church" }, osmId: 6 }),
      mkDoc({ displayName: "Middlebury College", tags: { amenity: "university", name: "Middlebury College" }, osmId: 7 }),
      mkDoc({ displayName: "Woodstock Inn", tags: { tourism: "hotel", name: "Woodstock Inn" }, osmId: 8 }),
    ];
    const result = applyPbfQualityFilters(items, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    for (const osmId of [1, 2, 3, 4, 6]) {
      expect(result.items.find((d) => d.osmId === osmId)?.filteredOut).toBe(true);
    }
    expect(result.items.find((d) => d.osmId === 5)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 7)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 8)?.filteredOut).toBe(false);
    expect(result.locavaProductSummary?.hiddenPlaceLabels).toBeGreaterThanOrEqual(2);
    expect(result.locavaProductSummary?.hiddenLiftInfrastructure).toBeGreaterThanOrEqual(1);
    expect(result.locavaProductSummary?.hiddenSchools).toBeGreaterThanOrEqual(1);
    expect(result.locavaProductSummary?.hiddenChurches).toBeGreaterThanOrEqual(1);
  });

  it("hides healthcare, golf micro-features, banks, and address-only leaks", () => {
    const items = [
      mkDoc({ displayName: "White River Junction VA Medical Center", tags: { amenity: "hospital", name: "White River Junction VA Medical Center" }, osmId: 20 }),
      mkDoc({ displayName: "Hannaford Pharmacy", tags: { amenity: "pharmacy", name: "Hannaford Pharmacy" }, osmId: 21 }),
      mkDoc({ displayName: "Green 7", tags: { golf: "green", leisure: "golf_course" }, osmId: 22 }),
      mkDoc({ displayName: "TD Bank", tags: { amenity: "bank", name: "TD Bank" }, osmId: 23 }),
      mkDoc({ displayName: "35A", tags: { "addr:housenumber": "35", "addr:street": "Main St" }, osmId: 24 }),
      mkDoc({ displayName: "5 1/2", tags: { "addr:housenumber": "5", "addr:street": "Oak Ave" }, osmId: 25 }),
      mkDoc({ displayName: "EV Charger", tags: { amenity: "charging_station" }, osmId: 26 }),
      mkDoc({ displayName: "Fire Station 1", tags: { amenity: "fire_station", name: "Fire Station 1" }, osmId: 27 }),
    ];
    const result = applyPbfQualityFilters(items, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    for (const osmId of [20, 21, 22, 23, 24, 25, 26, 27]) {
      expect(result.items.find((d) => d.osmId === osmId)?.filteredOut).toBe(true);
    }
    expect(result.locavaProductSummary?.hiddenHealthcare).toBeGreaterThanOrEqual(2);
    expect(result.locavaProductSummary?.hiddenGolfMicroFeatures).toBeGreaterThanOrEqual(1);
    expect(result.locavaProductSummary?.hiddenBanksAtms).toBeGreaterThanOrEqual(1);
    expect(result.locavaProductSummary?.hiddenAddressOnlyLeaks).toBeGreaterThanOrEqual(2);
    expect(result.locavaProductSummary?.hiddenSupportInfrastructure).toBeGreaterThanOrEqual(1);
    expect(result.locavaProductSummary?.hiddenPublicServiceBuildings).toBeGreaterThanOrEqual(1);
  });

  it("keeps food, ski runs, cemeteries, and local retail", () => {
    const items = [
      mkDoc({ displayName: "The Scale", tags: { amenity: "restaurant", name: "The Scale" }, osmId: 10 }),
      mkDoc({
        displayName: "Upper Perry Merrill",
        kind: "unexplored_route",
        tags: { name: "Upper Perry Merrill", "piste:type": "downhill" },
        osmId: 11,
      }),
      mkDoc({ displayName: "Pleasant View Cemetery", tags: { landuse: "cemetery", name: "Pleasant View Cemetery" }, osmId: 12 }),
      mkDoc({ displayName: "Skirack", tags: { shop: "ski", name: "Skirack" }, osmId: 13 }),
      mkDoc({ displayName: "Shell", tags: { amenity: "fuel", name: "Shell" }, osmId: 14 }),
    ];
    const result = applyPbfQualityFilters(items, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    expect(result.items.find((d) => d.osmId === 10)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 11)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 11)?.primaryCategory).toBe("ski_run");
    expect(result.items.find((d) => d.osmId === 12)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 12)?.primaryCategory).toBe("cemetery");
    expect(result.items.find((d) => d.osmId === 13)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 14)?.filteredOut).toBe(true);
    expect(result.locavaProductSummary?.keptFoodDrink).toBeGreaterThanOrEqual(1);
    expect(result.locavaProductSummary?.keptSkiRuns).toBeGreaterThanOrEqual(1);
    expect(result.locavaProductSummary?.keptCemeteries).toBeGreaterThanOrEqual(1);
    expect(result.locavaProductSummary?.keptLocalRetail).toBeGreaterThanOrEqual(1);
  });

  it("keeps named peaks with elevation; hides utility leaks and private pools", () => {
    const items = [
      mkDoc({
        displayName: "Bald Hill",
        tags: { natural: "peak", name: "Bald Hill", ele: "420", gnis: "1456789", wikidata: "Q123" },
        osmId: 30,
      }),
      mkDoc({
        displayName: "Mount Mansfield",
        tags: { natural: "peak", name: "Mount Mansfield", ele: "1339" },
        osmId: 31,
        lat: 44.54,
        lng: -72.81,
      }),
      mkDoc({
        displayName: "Unnamed Bump",
        tags: { natural: "peak" },
        osmId: 36,
      }),
      mkDoc({
        displayName: "Hydrant",
        tags: { emergency: "fire_hydrant" },
        osmId: 32,
      }),
      mkDoc({
        displayName: "WRUV-FM (Burlington)",
        tags: { man_made: "tower", name: "WRUV-FM (Burlington)" },
        osmId: 37,
      }),
      mkDoc({
        displayName: "Backyard Pool",
        tags: { leisure: "swimming_pool", access: "private" },
        osmId: 33,
      }),
      mkDoc({
        displayName: "Town Pool",
        tags: { leisure: "swimming_pool", name: "Town Pool", access: "public" },
        osmId: 34,
      }),
      mkDoc({
        displayName: "Fanny Allen Hospital Library",
        tags: { amenity: "library", name: "Fanny Allen Hospital Library" },
        osmId: 38,
      }),
      mkDoc({
        displayName: "Norman Williams Public Library",
        tags: { amenity: "library", name: "Norman Williams Public Library" },
        osmId: 39,
      }),
    ];
    const result = applyPbfQualityFilters(items, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    expect(result.items.find((d) => d.osmId === 30)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 31)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 36)?.filteredOut).toBe(true);
    expect(result.items.find((d) => d.osmId === 32)?.filteredOut).toBe(true);
    expect(result.items.find((d) => d.osmId === 37)?.filteredOut).toBe(true);
    expect(result.items.find((d) => d.osmId === 33)?.filteredOut).toBe(true);
    expect(result.items.find((d) => d.osmId === 34)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 38)?.filteredOut).toBe(true);
    expect(result.items.find((d) => d.osmId === 39)?.filteredOut).toBe(false);
    expect(result.locavaProductSummary?.hiddenGeologicalLabels).toBeGreaterThanOrEqual(1);
    expect(result.locavaProductSummary?.hiddenUtilityLeaks).toBeGreaterThanOrEqual(2);
    expect(result.locavaProductSummary?.hiddenPrivatePools).toBeGreaterThanOrEqual(1);
  });

  it("hides civic institutional noise but keeps public libraries and businesses", () => {
    const items = [
      mkDoc({
        displayName: "Champlain Senior Center",
        tags: { amenity: "community_centre", name: "Champlain Senior Center" },
        osmId: 50,
      }),
      mkDoc({
        displayName: "Essex Community Justice Center",
        tags: { amenity: "community_centre", name: "Essex Community Justice Center" },
        osmId: 51,
      }),
      mkDoc({
        displayName: "Lake Champlain at Burlington",
        tags: {
          name: "Lake Champlain at Burlington",
          man_made: "monitoring_station",
          "monitoring:water_level": "yes",
          "operator:type": "government",
        },
        osmId: 52,
      }),
      mkDoc({
        displayName: "The UPS Store",
        tags: { amenity: "post_office", shop: "copyshop", name: "The UPS Store" },
        osmId: 53,
      }),
      mkDoc({
        displayName: "Little Free Library",
        tags: { amenity: "library", name: "Little Free Library" },
        osmId: 54,
      }),
      mkDoc({
        displayName: "Norman Williams Public Library",
        tags: { amenity: "library", name: "Norman Williams Public Library", "library:type": "public" },
        osmId: 55,
      }),
      mkDoc({
        displayName: "Worthy Burger",
        tags: { amenity: "restaurant", name: "Worthy Burger" },
        osmId: 56,
      }),
    ];
    const result = applyPbfQualityFilters(items, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    for (const osmId of [50, 51, 52, 53, 54]) {
      expect(result.items.find((d) => d.osmId === osmId)?.filteredOut).toBe(true);
    }
    expect(result.items.find((d) => d.osmId === 55)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 56)?.filteredOut).toBe(false);
  });

  it("classifies named restaurants as food", () => {
    const doc = mkDoc({ displayName: "Worthy Burger", tags: { amenity: "restaurant", name: "Worthy Burger" } });
    expect(isLocavaFoodDrinkDestination(doc)).toBe(true);
    const enriched = enrichLocavaProductClassification(doc);
    expect(enriched.primaryActivity).toBe("food");
    expect(matchLocavaProductRules(enriched)).toBeNull();
  });
});
