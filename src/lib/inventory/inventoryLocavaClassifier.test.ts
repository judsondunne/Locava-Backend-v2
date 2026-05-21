import { describe, expect, it } from "vitest";
import { classifyOsmFeatureForLocava } from "./inventoryLocavaClassifier.js";
import { buildLocavaDiagnosticsJson, diagnosticsJsonString } from "./inventoryLocavaDiagnostics.js";
import { DEFAULT_LOCAVA_CLASSIFIER_CONFIG } from "./inventoryLocavaTypes.js";

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

describe("inventoryLocavaClassifier v1", () => {
  it("accepts Sweet & Salty ice cream as high spot", () => {
    const r = classify({ name: "Sweet & Salty", amenity: "ice_cream" }, { name: "Sweet & Salty" });
    expect(r.decision).toBe("spot");
    expect(r.locavaScore).toBeGreaterThanOrEqual(60);
    expect(r.primaryCategory).toBe("ice_cream");
  });

  it("accepts Mon Vert Cafe", () => {
    const r = classify({ name: "Mon Vert Cafe", amenity: "cafe" }, { name: "Mon Vert Cafe" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("cafe");
  });

  it("accepts White Cottage Snack Bar fast_food with local cuisine in local_only", () => {
    const r = classify(
      { name: "White Cottage Snack Bar", amenity: "fast_food", cuisine: "ice_cream;burger" },
      { name: "White Cottage Snack Bar" }
    );
    expect(r.decision).toBe("spot");
  });

  it("rejects McDonald's chain fast food in local_only", () => {
    const r = classify(
      { name: "McDonald's", amenity: "fast_food", brand: "McDonald's" },
      { name: "McDonald's" }
    );
    expect(r.decision).toBe("reject");
    expect(r.rejectionReason).toMatch(/chain|below|fast_food/i);
  });

  it("rejects highway=service", () => {
    const r = classify({ highway: "service" }, { geometryKind: "line", coordinates: [{ lat: 43.54, lng: -72.39 }, { lat: 43.55, lng: -72.38 }] });
    expect(r.decision).toBe("reject");
  });

  it("rejects highway=residential", () => {
    const r = classify({ highway: "residential" }, { geometryKind: "line", coordinates: [{ lat: 43.54, lng: -72.39 }, { lat: 43.55, lng: -72.38 }] });
    expect(r.decision).toBe("reject");
  });

  it("rejects building=residential", () => {
    const r = classify({ building: "residential" });
    expect(r.decision).toBe("reject");
  });

  it("rejects building=yes alone", () => {
    const r = classify({ building: "yes" });
    expect(r.decision).toBe("reject");
  });

  it("accepts building=yes + amenity=restaurant", () => {
    const r = classify({ building: "yes", amenity: "restaurant", name: "Local Bistro" }, { name: "Local Bistro" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("restaurant");
  });

  it("rejects aeroway=holding_position and taxiway", () => {
    expect(classify({ aeroway: "holding_position" }).decision).toBe("reject");
    expect(classify({ aeroway: "taxiway" }).decision).toBe("reject");
  });

  it("rejects amenity=bank and dentist", () => {
    expect(classify({ amenity: "bank", name: "Bank" }, { name: "Bank" }).decision).toBe("reject");
    expect(classify({ amenity: "dentist", name: "Dentist" }, { name: "Dentist" }).decision).toBe("reject");
  });

  it("accepts natural=waterfall and tourism=viewpoint as hero", () => {
    const wf = classify({ natural: "waterfall", name: "Test Falls" }, { name: "Test Falls" });
    expect(wf.decision).toBe("spot");
    expect(wf.displayPriority).toBe("hero");
    const vp = classify({ tourism: "viewpoint", name: "Lookout" }, { name: "Lookout" });
    expect(vp.decision).toBe("spot");
  });

  it("accepts natural=peak", () => {
    expect(classify({ natural: "peak", name: "Summit" }, { name: "Summit" }).decision).toBe("spot");
  });

  it("accepts named leisure=park polygon", () => {
    const r = classify(
      { leisure: "park", name: "Town Park" },
      { name: "Town Park", geometryKind: "polygon", closed: true, coordinates: [{ lat: 43.54, lng: -72.39 }, { lat: 43.55, lng: -72.38 }, { lat: 43.54, lng: -72.37 }, { lat: 43.54, lng: -72.39 }] }
    );
    expect(r.decision).toBe("spot");
  });

  it("accepts named natural=wetland polygon", () => {
    const r = classify(
      { natural: "wetland", name: "Ottauquechee Marsh" },
      { name: "Ottauquechee Marsh", geometryKind: "polygon", closed: true }
    );
    expect(r.decision).toBe("spot");
  });

  it("rejects unnamed tiny wetland in named_or_recreational mode", () => {
    const r = classify({ natural: "wetland" }, { name: null });
    expect(r.decision).toBe("reject");
  });

  it("accepts route=hiking with line geometry", () => {
    const r = classify(
      { route: "hiking", name: "App Trail", type: "route" },
      {
        name: "App Trail",
        sourceType: "relation",
        geometryKind: "line",
        coordinates: [
          { lat: 43.54, lng: -72.39 },
          { lat: 43.55, lng: -72.38 },
          { lat: 43.56, lng: -72.37 },
        ],
      }
    );
    expect(r.decision).toBe("route");
  });

  it("accepts highway=path with trail_visibility", () => {
    const r = classify(
      { highway: "path", trail_visibility: "good", name: "Forest Path" },
      {
        name: "Forest Path",
        geometryKind: "line",
        coordinates: [
          { lat: 43.54, lng: -72.39 },
          { lat: 43.55, lng: -72.38 },
        ],
      }
    );
    expect(r.decision).toBe("route");
  });

  it("rejects footway=sidewalk", () => {
    const r = classify(
      { highway: "footway", footway: "sidewalk" },
      { geometryKind: "line", coordinates: [{ lat: 43.54, lng: -72.39 }, { lat: 43.55, lng: -72.38 }] }
    );
    expect(r.decision).toBe("reject");
  });

  it("rejects highway=track access=private", () => {
    const r = classify(
      { highway: "track", access: "private" },
      { geometryKind: "line", coordinates: [{ lat: 43.54, lng: -72.39 }, { lat: 43.55, lng: -72.38 }] }
    );
    expect(r.decision).toBe("reject");
  });

  it("rejects route missing geometry", () => {
    const r = classify({ route: "hiking", name: "Ghost Trail" }, { name: "Ghost Trail", geometryKind: "line", coordinates: [] });
    expect(r.decision).toBe("reject");
    expect(r.rejectionReason).toBe("route_missing_geometry");
  });

  it("highway=path line does not become InventorySpot", () => {
    const r = classify(
      { highway: "path", name: "Some Path" },
      {
        name: "Some Path",
        geometryKind: "line",
        coordinates: [
          { lat: 43.54, lng: -72.39 },
          { lat: 43.55, lng: -72.38 },
        ],
      }
    );
    expect(r.decision).not.toBe("spot");
  });

  it("highway=track line does not become InventorySpot", () => {
    const r = classify(
      { highway: "track" },
      { geometryKind: "line", coordinates: [{ lat: 43.54, lng: -72.39 }, { lat: 43.55, lng: -72.38 }] }
    );
    expect(r.decision).not.toBe("spot");
  });

  it("highway=tertiary named road does not become InventorySpot", () => {
    const r = classify(
      { highway: "tertiary", name: "Main Road" },
      { name: "Main Road", geometryKind: "line", coordinates: [{ lat: 43.54, lng: -72.39 }, { lat: 43.55, lng: -72.38 }] }
    );
    expect(r.decision).toBe("reject");
  });

  it("fire_station rejected", () => {
    expect(classify({ amenity: "fire_station", name: "Fire Dept" }, { name: "Fire Dept" }).decision).toBe("reject");
  });

  it("pharmacy rejected", () => {
    expect(classify({ amenity: "pharmacy", name: "Pharmacy" }, { name: "Pharmacy" }).decision).toBe("reject");
  });

  it("post_office rejected", () => {
    expect(classify({ amenity: "post_office", name: "Post Office" }, { name: "Post Office" }).decision).toBe("reject");
  });

  it("school rejected", () => {
    expect(classify({ amenity: "school", name: "School" }, { name: "School" }).decision).toBe("reject");
  });

  it("generic grave_yard rejected", () => {
    expect(classify({ landuse: "grave_yard", name: "Cemetery" }, { name: "Cemetery" }).decision).toBe("reject");
  });

  it("waterway=waterfall accepted hero spot", () => {
    const r = classify({ waterway: "waterfall", name: "Falls" }, { name: "Falls" });
    expect(r.decision).toBe("spot");
    expect(r.displayPriority).toBe("hero");
  });

  it("diagnostics JSON includes filterAudit", () => {
    const diagnostics = buildLocavaDiagnosticsJson({
      runId: "test-run",
      source: "fixture",
      region: { regionKey: "hartland_vt_mvp", label: "Hartland", bbox: { minLat: 43.45, minLng: -72.55, maxLat: 43.63, maxLng: -72.25 } },
      config: cfg,
      rawObjects: 10,
      spots: [],
      routes: [],
      rejected: [{ sourceKey: "n/1", sourceId: "1", name: "Svc", sourceType: "way", coordinatesSummary: null, rawTypeLabel: "highway=service", topTags: {}, locavaScore: 5, decision: "reject", rejectionReason: "highway_service", tagSignals: [], negativeSignals: ["highway_service:-75"], warnings: [] }],
      classifications: [],
      duplicatesSuppressed: 0,
      duplicateDiagnostics: [],
    });
    const json = diagnosticsJsonString(diagnostics);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as { quality: { highestRejected: unknown[]; lowestAccepted: unknown[]; possibleFalsePositives: unknown[]; possibleFalseNegatives: unknown[] }; filterAudit?: unknown };
    expect(parsed.quality.highestRejected).toBeDefined();
    expect(parsed.quality.lowestAccepted).toBeDefined();
    expect(parsed.quality.possibleFalsePositives).toBeDefined();
    expect(parsed.quality.possibleFalseNegatives).toBeDefined();
    expect(parsed.filterAudit).toBeDefined();
  });
});
