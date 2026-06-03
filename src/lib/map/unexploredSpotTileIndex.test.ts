import { describe, expect, it } from "vitest";
import { computeSpotMapTileKeys } from "../../lib/map/unexploredSpotTileIndex.js";
import { unexploredSpotTileZoomForMapZoom, maxUnexploredSpotsPerTile } from "../../lib/map/unexploredSpotTileZoom.js";

describe("unexploredSpotTileIndex", () => {
  it("computes stable tile keys for a spot", () => {
    const index = computeSpotMapTileKeys(43.54, -72.39);
    expect(index.mapTileKeys.length).toBe(6);
    expect(index.primaryTileKey).toMatch(/^14\//);
    expect(index.geohash.length).toBeGreaterThan(4);
  });
});

describe("unexploredSpotTileZoom", () => {
  it("returns null below threshold", () => {
    expect(unexploredSpotTileZoomForMapZoom(10)).toBeNull();
  });
  it("caps per tile at lower zoom", () => {
    expect(maxUnexploredSpotsPerTile(11)).toBeLessThan(maxUnexploredSpotsPerTile(15));
  });
});
