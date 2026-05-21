import { describe, expect, it } from "vitest";
import { normalizeInventoryRawObjects } from "./inventoryNormalize.js";
import { FIXTURE_INVENTORY_RAW_OBJECTS } from "./sources/fixtureInventorySource.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "./inventoryBbox.js";
import { isPointInsideBbox } from "./inventoryCoordinates.js";

describe("inventoryNormalize", () => {
  it("accepts spots/routes, rejects out-of-bbox, swapped coords, and duplicates", () => {
    const result = normalizeInventoryRawObjects({
      rawObjects: FIXTURE_INVENTORY_RAW_OBJECTS,
      regionKey: INVENTORY_MVP_DEFAULT_VIEWPORT.regionKey,
      regionBbox: INVENTORY_MVP_DEFAULT_VIEWPORT.bbox,
      importRunId: "inv_run_test",
    });

    expect(result.spots.length).toBeGreaterThan(0);
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.duplicates).toBeGreaterThan(0);
    expect(result.rejected.some((r) => r.code === "outside_bbox")).toBe(true);
    expect(result.rejected.some((r) => r.code === "invalid_coordinates")).toBe(true);
    expect(result.rejected.some((r) => r.code === "likely_swapped_coordinates")).toBe(true);
    expect(result.rejected.some((r) => r.code === "building_polygon")).toBe(true);
    expect(result.rejected.some((r) => r.code === "generic_road")).toBe(true);
    expect(result.coordinateWarnings.length).toBeGreaterThan(0);

    for (const spot of result.spots) {
      expect(isPointInsideBbox({ lat: spot.lat, lng: spot.lng }, INVENTORY_MVP_DEFAULT_VIEWPORT.bbox)).toBe(true);
      expect(spot.lat).toBeGreaterThan(42);
      expect(spot.lng).toBeLessThan(-71);
    }

    for (const route of result.routes) {
      expect((route.coordinates ?? []).length).toBeGreaterThanOrEqual(2);
      expect(route.bbox.minLat).toBeLessThanOrEqual(route.center.lat);
      expect(route.bbox.maxLat).toBeGreaterThanOrEqual(route.center.lat);
    }
  });
});
