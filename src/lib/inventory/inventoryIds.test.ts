import { describe, expect, it } from "vitest";
import { buildInventoryRouteId, buildInventorySpotId } from "./inventoryIds.js";

describe("inventoryIds", () => {
  it("generates stable spot ids", () => {
    const input = {
      source: "fixture" as const,
      sourceType: "fixture" as const,
      sourceId: "fx-001",
      normalizedName: "moss glen falls",
      lat: 44.0181,
      lng: -72.8504,
    };
    const a = buildInventorySpotId(input);
    const b = buildInventorySpotId(input);
    expect(a).toBe(b);
    expect(a.startsWith("inv_spot_")).toBe(true);
  });

  it("generates stable route ids", () => {
    const input = {
      source: "fixture" as const,
      sourceType: "fixture" as const,
      sourceId: "fx-r001",
      normalizedName: "hartland nature loop",
      bbox: { minLat: 43.54, minLng: -72.4, maxLat: 43.55, maxLng: -72.39 },
    };
    const a = buildInventoryRouteId(input);
    const b = buildInventoryRouteId(input);
    expect(a).toBe(b);
    expect(a.startsWith("inv_route_")).toBe(true);
  });
});
