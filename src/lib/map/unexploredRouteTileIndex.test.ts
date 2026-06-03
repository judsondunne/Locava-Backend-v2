import { describe, expect, it } from "vitest";
import { computeRouteMapTileKeys } from "./unexploredRouteTileIndex.js";

describe("unexploredRouteTileIndex", () => {
  it("computes tile keys from route bbox", () => {
    const index = computeRouteMapTileKeys({
      center: { lat: 43.44, lng: -72.46 },
      bbox: { minLat: 43.43, minLng: -72.47, maxLat: 43.45, maxLng: -72.45 },
    });
    expect(index.mapTileKeys.length).toBeGreaterThan(6);
    expect(index.primaryTileKey).toMatch(/^14\//);
    expect(index.geohash.length).toBeGreaterThan(4);
  });
});
