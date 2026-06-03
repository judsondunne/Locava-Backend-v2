import { describe, expect, it } from "vitest";
import { classifyOsmFeatureForLocava } from "./inventoryLocavaClassifier.js";
import { buildDisplayName, isWeakGenericName } from "./inventoryDisplayNames.js";
import { findChildHighlightsForParent, selectPrimaryAnchor } from "./inventoryDestinationAnchors.js";
import { findParentContext, buildParentAreaIndex } from "./inventoryParentContext.js";
import { polishAcceptedSpots } from "./inventorySpotPolish.js";
import { buildFinalPolishDiagnostics } from "./inventoryFinalPolishDiagnostics.js";
import { buildLocavaDiagnosticsJson, diagnosticsJsonString } from "./inventoryLocavaDiagnostics.js";
import { buildLocavaInventorySpot } from "./inventoryLocavaDedupe.js";
import { DEFAULT_LOCAVA_CLASSIFIER_CONFIG } from "./inventoryLocavaTypes.js";
import type { LocavaInventorySpot } from "./inventoryLocavaTypes.js";
import type { OsmFeatureListItem } from "../openstreetmap/osmFeatureParse.js";

const cfg = DEFAULT_LOCAVA_CLASSIFIER_CONFIG;

function classify(tags: Record<string, string>, extra: Partial<Parameters<typeof classifyOsmFeatureForLocava>[0]> = {}) {
  return classifyOsmFeatureForLocava(
    {
      sourceKey: extra.sourceKey ?? "node/1",
      sourceType: extra.sourceType ?? "node",
      sourceId: extra.sourceId ?? "1",
      name: extra.name ?? tags.name ?? null,
      tags,
      geometryKind: extra.geometryKind ?? "point",
      lat: extra.lat ?? 43.54,
      lng: extra.lng ?? -72.39,
      coordinates: extra.coordinates,
      closed: extra.closed,
      rawTypeLabel: extra.rawTypeLabel,
    },
    cfg
  );
}

function spotFromClassification(
  c: ReturnType<typeof classify>,
  lat = 43.54,
  lng = -72.39,
  tags: Record<string, string> = {}
): LocavaInventorySpot {
  return buildLocavaInventorySpot(c, { lat, lng, tags, sourceType: "node", sourceId: "1" });
}

describe("final polish — swimming and beach", () => {
  it("leisure=swimming_area accepted high/hero", () => {
    const r = classify({ leisure: "swimming_area", name: "Swim Cove" }, { name: "Swim Cove" });
    expect(r.decision).toBe("spot");
    expect(["hero", "high"]).toContain(r.displayPriority);
    expect(r.primaryCategory).toBe("swimming");
  });

  it("natural=beach accepted", () => {
    const r = classify({ natural: "beach", name: "Sandy Beach" }, { name: "Sandy Beach" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("beach");
  });

  it("beach=yes accepted", () => {
    const r = classify({ beach: "yes", name: "River Beach" }, { name: "River Beach" });
    expect(r.decision).toBe("spot");
  });

  it("swimming=yes accepted", () => {
    const r = classify({ swimming: "yes", natural: "water", name: "Hole" }, { name: "Hole" });
    expect(r.decision).toBe("spot");
  });

  it("bathing=yes accepted", () => {
    const r = classify({ bathing: "yes", name: "Bathing Rock" }, { name: "Bathing Rock" });
    expect(r.decision).toBe("spot");
  });

  it("private beach rejected", () => {
    const r = classify({ natural: "beach", access: "private", name: "Private Beach" }, { name: "Private Beach" });
    expect(r.decision).toBe("reject");
  });

  it("private swimming_pool rejected", () => {
    const r = classify({ amenity: "swimming_pool", access: "private", name: "Hotel Pool" }, { name: "Hotel Pool" });
    expect(r.decision).toBe("reject");
  });

  it("swimming/beach not rejected below_threshold", () => {
    const r = classify({ leisure: "swimming_area" }, { name: null, lat: 43.54, lng: -72.39 });
    expect(r.decision).toBe("spot");
    expect(r.rejectionReason).not.toBe("below_threshold");
  });
});

describe("final polish — names", () => {
  it("raw beach becomes generated displayName with parent", () => {
    const out = buildDisplayName({
      rawName: "beach",
      category: "beach",
      parentContext: {
        parentName: "North Hartland Dam Recreation Area",
        parentCategory: "park",
        parentSourceKey: "way/1",
        relation: "inside_area",
      },
    });
    expect(out.displayName).toContain("North Hartland Dam Recreation Area");
    expect(out.displayNameGenerated).toBe(true);
    expect(isWeakGenericName(out.displayName)).toBe(false);
  });

  it("viewpoint gets parent-based name", () => {
    const out = buildDisplayName({
      rawName: "viewpoint",
      category: "viewpoint",
      parentContext: { parentName: "French's Ledges", parentCategory: "nature_reserve", relation: "inside_area" },
    });
    expect(out.displayName).toBe("French's Ledges Viewpoint");
  });

  it("name-only object rejected", () => {
    const r = classify({ name: "Photography Studio" }, { name: "Photography Studio", rawTypeLabel: "name" });
    expect(r.decision).toBe("reject");
    expect(r.rejectionReason).toBe("name_only_no_locava_signal");
  });

  it("office/shop does not become natural_feature", () => {
    const r = classify({ office: "company", name: "OPCO" }, { name: "OPCO" });
    expect(r.decision).toBe("reject");
    expect(r.primaryCategory).not.toBe("natural_feature");
  });
});

describe("final polish — bridges", () => {
  it("man_made=bridge accepted as spot", () => {
    const r = classify({ man_made: "bridge", name: "Footbridge" }, { name: "Footbridge" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("bridge");
  });

  it("railroad bridge accepted with railroad_bridge category", () => {
    const r = classify({ man_made: "bridge", railway: "rail", name: "RR Bridge" }, { name: "RR Bridge" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("railroad_bridge");
    expect(r.activities).toContain("railroad_bridge");
  });
});

describe("final polish — anchors", () => {
  it("park with internal viewpoint uses viewpoint anchor", () => {
    const park: LocavaInventorySpot = {
      ...spotFromClassification(classify({ leisure: "nature_reserve", name: "French's Ledges" }, { name: "French's Ledges" })),
      category: "nature_reserve",
      name: "French's Ledges",
      bbox: { minLat: 43.53, minLng: -72.4, maxLat: 43.55, maxLng: -72.38 },
      areaCenter: { lat: 43.54, lng: -72.39 },
    };
    const viewpoint = spotFromClassification(
      classify({ tourism: "viewpoint", name: "Ledge Lookout" }, { name: "Ledge Lookout", lat: 43.541, lng: -72.391, sourceKey: "node/2" }),
      43.541,
      -72.391,
      { tourism: "viewpoint" }
    );
    viewpoint.sourceKey = "node/2";
    viewpoint.category = "viewpoint";
    viewpoint.displayName = "Ledge Lookout";
    const highlights = findChildHighlightsForParent(park, [viewpoint]);
    expect(highlights.length).toBeGreaterThan(0);
    const anchor = selectPrimaryAnchor(park, highlights);
    expect(anchor.primaryAnchor.anchorType).toBe("viewpoint");
    expect(anchor.displayCenter.lat).toBe(43.541);
    expect(park.name).toBe("French's Ledges");
  });
});

describe("final polish — access", () => {
  it("access=permissive boosts public access signal", () => {
    const r = classify({ natural: "beach", access: "permissive", name: "Public Beach" }, { name: "Public Beach" });
    expect(r.decision).toBe("spot");
    expect(r.tagSignals.some((s) => s.includes("public_access"))).toBe(true);
  });
});

describe("final polish — diagnostics", () => {
  it("finalPolishDiagnostics exists in diagnostics JSON", () => {
    const spot = spotFromClassification(classify({ natural: "beach", name: "beach" }, { name: "beach" }), 43.54, -72.39, {
      natural: "beach",
    });
    const polished = polishAcceptedSpots({ spots: [spot], rawFeatures: [] });
    const diag = buildFinalPolishDiagnostics({ spots: polished.spots, rejected: [] });
    const json = buildLocavaDiagnosticsJson({
      runId: "test",
      source: "fixture",
      region: { regionKey: "x", label: "x", bbox: { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 } },
      config: cfg,
      rawObjects: 1,
      spots: polished.spots,
      routes: [],
      rejected: [],
      classifications: [],
      duplicatesSuppressed: 0,
      duplicateDiagnostics: [],
      finalPolishDiagnostics: diag,
    });
    expect(() => JSON.parse(diagnosticsJsonString(json))).not.toThrow();
    expect(json.finalPolishDiagnostics).toBeDefined();
  });
});

describe("final polish — parent context for river picnic", () => {
  it("picnic near named river gets nearby_water parent", () => {
    const areas = buildParentAreaIndex([
      {
        id: "way/river",
        osmType: "way",
        osmId: 1,
        name: "Connecticut River",
        hasRealName: true,
        featureType: "waterway=river",
        lat: 43.54,
        lng: -72.39,
        coordSource: "line_center",
        geometryKind: "line",
        coordinates: [
          { lat: 43.54, lng: -72.39 },
          { lat: 43.55, lng: -72.38 },
        ],
        closed: false,
        tags: { waterway: "river", name: "Connecticut River" },
      } as OsmFeatureListItem,
    ]);
    const ctx = findParentContext(43.5405, -72.3895, areas, { preferWater: true, maxNearbyMeters: 800 });
    expect(ctx.relation).toMatch(/nearby_water|inside_area/);
    expect(ctx.parentName).toContain("Connecticut River");
  });
});
