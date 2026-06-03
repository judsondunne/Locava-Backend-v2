import { describe, expect, it } from "vitest";
import {
  filterRoutesToExplicitOffroadClasses,
  isExplicitOffroadClassRoute,
} from "./offroadExplicitClassFilter.js";
import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";

function stubRoute(partial: Partial<LocavaInventoryRoute> & { source: LocavaInventoryRoute["source"] }): LocavaInventoryRoute {
  return {
    id: "test",
    sourceKey: "test/1",
    sourceKeys: ["test/1"],
    name: "Test",
    activity: "offroading",
    distanceMeters: 1000,
    distanceMiles: 0.62,
    distanceLabel: "0.6 mi",
    bbox: { minLat: 43, minLng: -73, maxLat: 44, maxLng: -72 },
    center: { lat: 43.5, lng: -72.5 },
    coordinates: [{ lat: 43.5, lng: -72.5 }],
    geometryType: "LineString",
    tags: {},
    ...partial,
  } as LocavaInventoryRoute;
}

describe("offroadExplicitClassFilter", () => {
  it("keeps VTrans class 4 and legal trails", () => {
    expect(
      isExplicitOffroadClassRoute(
        stubRoute({
          source: "vtrans_public_highway_system",
          offroad: { offroadCategory: "class4_road", offroadConfidence: "explicit" },
        })
      )
    ).toBe(true);
    expect(
      isExplicitOffroadClassRoute(
        stubRoute({
          source: "vtrans_public_highway_system",
          offroad: { offroadCategory: "legal_trail", offroadConfidence: "explicit" },
        })
      )
    ).toBe(true);
  });

  it("drops generic OSM gravel track without official class tags", () => {
    expect(
      isExplicitOffroadClassRoute(
        stubRoute({
          source: "openstreetmap",
          tags: { _primarySource: "osm_offroad", highway: "track", surface: "gravel" },
          offroad: {
            offroadCategory: "dirt_road",
            offroadConfidence: "likely",
            roadClassSignals: {},
          },
        })
      )
    ).toBe(false);
  });

  it("keeps OSM routes with explicit vt_class4 signal", () => {
    expect(
      isExplicitOffroadClassRoute(
        stubRoute({
          source: "openstreetmap",
          tags: { _primarySource: "osm_offroad" },
          offroad: {
            offroadCategory: "class4_road",
            offroadConfidence: "explicit",
            roadClassSignals: { vtClass4: true },
          },
        })
      )
    ).toBe(true);
  });

  it("filterRoutesToExplicitOffroadClasses counts filtered routes", () => {
    const routes = [
      stubRoute({
        source: "vtrans_public_highway_system",
        offroad: { offroadCategory: "class4_road", offroadConfidence: "explicit" },
      }),
      stubRoute({
        source: "openstreetmap",
        tags: { _primarySource: "osm_offroad" },
        offroad: { offroadCategory: "dirt_road", offroadConfidence: "likely", roadClassSignals: {} },
      }),
    ];
    const { routes: kept, filteredOut } = filterRoutesToExplicitOffroadClasses(routes);
    expect(kept.length).toBe(1);
    expect(filteredOut).toBe(1);
  });
});
