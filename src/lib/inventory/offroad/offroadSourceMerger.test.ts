import { describe, expect, it } from "vitest";
import { mergeOffroadRoutesFromSources } from "./offroadSourceMerger.js";
import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";

function route(partial: Partial<LocavaInventoryRoute> & { sourceKey: string; name: string }): LocavaInventoryRoute {
  return {
    id: partial.id ?? "r1",
    kind: "inventory_route",
    routeKind: "offroad_unmaintained_road",
    name: partial.name,
    normalizedName: partial.name.toLowerCase(),
    activity: "offroading",
    categories: ["offroading"],
    activities: ["offroading"],
    center: partial.center ?? { lat: 43.54, lng: -72.39 },
    bbox: partial.bbox ?? { minLat: 43.53, minLng: -72.4, maxLat: 43.55, maxLng: -72.38 },
    distanceMeters: 500,
    distanceMiles: 0.3,
    distanceLabel: "0.3 mi",
    geometryType: "LineString",
    coordinates: partial.coordinates ?? [
      { lat: 43.54, lng: -72.39 },
      { lat: 43.541, lng: -72.388 },
    ],
    segments: partial.segments,
    source: partial.source ?? "openstreetmap",
    sourceType: "way",
    sourceId: "1",
    sourceKey: partial.sourceKey,
    sourceKeys: [partial.sourceKey],
    sourceDatasetName: partial.sourceDatasetName ?? "test",
    memberWayIds: [],
    hasMedia: false,
    status: "active",
    locavaScore: 50,
    confidence: "medium",
    displayPriority: "high",
    showAtZoom: 12,
    selectedTrailhead: null,
    selectedParking: null,
    parkingCandidates: [],
    trailheadCandidates: [],
    offroad: partial.offroad ?? {
      legalDisplayLabel: "Unmaintained road",
      offroadCategory: "class4_road",
      offroadConfidence: "explicit",
      accessStatus: "unknown",
      accessWarnings: [],
      seasonalWarnings: [],
      sourceSignals: [],
      vehicleSignals: {},
      roadClassSignals: {},
    },
    assemblyWarnings: [],
    classificationReason: "test",
    tagSignals: [],
    negativeSignals: [],
    rejectionReason: null,
    tags: {},
    attribution: { provider: "test", license: "test" },
    importRunId: "t",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("offroadSourceMerger", () => {
  it("state official source wins over OSM duplicate", () => {
    const osm = route({ sourceKey: "osm/1", name: "Pent Road", source: "openstreetmap" });
    const vtrans = route({
      sourceKey: "vtrans/1",
      name: "Pent Road",
      source: "vtrans_public_highway_system",
      offroad: { ...osm.offroad!, offroadConfidence: "explicit" },
    });
    const merged = mergeOffroadRoutesFromSources({
      routes: [
        { route: osm, sourceId: "osm_offroad" },
        { route: vtrans, sourceId: "vt_vtrans_public_highway_system" },
      ],
    });
    expect(merged.routes.length).toBe(1);
    expect(merged.routes[0]?.source).toBe("vtrans_public_highway_system");
  });

  it("USFS wins over OSM candidate", () => {
    const osm = route({
      sourceKey: "osm/2",
      name: "Forest Road",
      source: "openstreetmap",
      offroad: {
        legalDisplayLabel: "Offroad candidate",
        offroadCategory: "4wd_track",
        offroadConfidence: "candidate",
        accessStatus: "unknown",
        accessWarnings: [],
        seasonalWarnings: [],
        sourceSignals: [],
        vehicleSignals: {},
        roadClassSignals: {},
      },
    });
    const usfs = route({
      sourceKey: "usfs/2",
      name: "Forest Road",
      source: "usfs_mvum",
      offroad: {
        legalDisplayLabel: "Motorized route",
        offroadCategory: "mvum_road",
        offroadConfidence: "explicit",
        accessStatus: "designated",
        accessWarnings: [],
        seasonalWarnings: [],
        sourceSignals: ["usfs_mvum"],
        vehicleSignals: {},
        roadClassSignals: {},
      },
    });
    const merged = mergeOffroadRoutesFromSources({
      routes: [
        { route: osm, sourceId: "osm_offroad" },
        { route: usfs, sourceId: "usfs_mvum" },
      ],
    });
    expect(merged.routes[0]?.source).toBe("usfs_mvum");
  });

  it("distinct named trails are not merged", () => {
    const a = route({ sourceKey: "a", name: "North Trail", source: "usfs_mvum" });
    const b = route({
      sourceKey: "b",
      name: "South Ridge Route",
      source: "blm_gtlf",
      coordinates: [
        { lat: 44.0, lng: -110.0 },
        { lat: 44.01, lng: -109.99 },
      ],
    });
    const merged = mergeOffroadRoutesFromSources({
      routes: [
        { route: a, sourceId: "usfs_mvum" },
        { route: b, sourceId: "blm_gtlf" },
      ],
    });
    expect(merged.routes.length).toBe(2);
  });

  it("merged sourceSignals include both sources", () => {
    const osm = route({ sourceKey: "osm/3", name: "Town Highway 12", source: "openstreetmap" });
    const vtrans = route({
      sourceKey: "vtrans/3",
      name: "Town Highway 12",
      source: "vtrans_public_highway_system",
      offroad: { ...osm.offroad!, sourceSignals: ["vtrans"] },
    });
    const merged = mergeOffroadRoutesFromSources({
      routes: [
        { route: osm, sourceId: "osm_offroad" },
        { route: vtrans, sourceId: "vt_vtrans_public_highway_system" },
      ],
    });
    const signals = merged.routes[0]?.offroad?.sourceSignals ?? [];
    expect(signals.length).toBeGreaterThan(0);
    expect(merged.mergedCount).toBeGreaterThan(0);
  });
});
