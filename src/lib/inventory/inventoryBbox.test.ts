import { describe, expect, it } from "vitest";
import {
  INVENTORY_MVP_DEFAULT_RADIUS_KM,
  INVENTORY_MVP_DEFAULT_VIEWPORT,
  bboxFromCenterRadiusKm,
  resolveAdminViewport,
} from "./inventoryBbox.js";

describe("inventoryBbox", () => {
  it("resolveAdminViewport defaults to Hartland MVP", () => {
    const v = resolveAdminViewport();
    expect(v.center.lat).toBe(INVENTORY_MVP_DEFAULT_VIEWPORT.center.lat);
    expect(v.center.lng).toBe(INVENTORY_MVP_DEFAULT_VIEWPORT.center.lng);
    expect(v.bbox.minLat).toBeLessThan(v.center.lat);
    expect(v.bbox.maxLat).toBeGreaterThan(v.center.lat);
  });

  it("resolveAdminViewport uses custom center and radius", () => {
    const v = resolveAdminViewport({ centerLat: 44.0, centerLng: -72.0, radiusKm: 20 });
    expect(v.center.lat).toBe(44.0);
    expect(v.center.lng).toBe(-72.0);
    const expected = bboxFromCenterRadiusKm({ lat: 44.0, lng: -72.0 }, 20);
    expect(v.bbox.minLat).toBeCloseTo(expected.minLat, 4);
    expect(v.bbox.maxLng).toBeCloseTo(expected.maxLng, 4);
  });

  it("clamps radius to 2–80 km", () => {
    const small = resolveAdminViewport({ radiusKm: 1 });
    const large = resolveAdminViewport({ radiusKm: 200 });
    const base = bboxFromCenterRadiusKm(INVENTORY_MVP_DEFAULT_VIEWPORT.center, INVENTORY_MVP_DEFAULT_RADIUS_KM);
    const min = bboxFromCenterRadiusKm(INVENTORY_MVP_DEFAULT_VIEWPORT.center, 2);
    const max = bboxFromCenterRadiusKm(INVENTORY_MVP_DEFAULT_VIEWPORT.center, 80);
    expect(small.bbox.minLat).toBeCloseTo(min.minLat, 4);
    expect(large.bbox.minLat).toBeCloseTo(max.minLat, 4);
    expect(base.minLat).toBeLessThan(small.bbox.minLat);
  });
});
