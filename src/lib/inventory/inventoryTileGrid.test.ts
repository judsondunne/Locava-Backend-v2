import { describe, expect, it } from "vitest";
import {
  bboxToTileRange,
  formatTileKey,
  latLngToTileXY,
  tilesForBboxAtZoom,
} from "./inventoryTileGrid.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "./inventoryBbox.js";

describe("inventoryTileGrid", () => {
  it("converts lat/lng to tile xy", () => {
    const { x, y } = latLngToTileXY(INVENTORY_MVP_DEFAULT_VIEWPORT.center.lat, INVENTORY_MVP_DEFAULT_VIEWPORT.center.lng, 13);
    expect(Number.isInteger(x)).toBe(true);
    expect(Number.isInteger(y)).toBe(true);
    expect(formatTileKey(13, x, y)).toBe(`13/${x}/${y}`);
  });

  it("computes bbox tile range", () => {
    const range = bboxToTileRange(INVENTORY_MVP_DEFAULT_VIEWPORT.bbox, 12);
    expect(range.maxX).toBeGreaterThanOrEqual(range.minX);
    expect(range.maxY).toBeGreaterThanOrEqual(range.minY);
  });

  it("includes multiple tiles for route bbox spanning area", () => {
    const tiles = tilesForBboxAtZoom(INVENTORY_MVP_DEFAULT_VIEWPORT.bbox, 11);
    expect(tiles.length).toBeGreaterThan(1);
  });

  it("places Hartland spot and route bbox into reasonable tile keys", () => {
    const spot = latLngToTileXY(43.543056, -72.394722, 13);
    const routeBbox = {
      minLat: 43.539444,
      minLng: -72.397222,
      maxLat: 43.548611,
      maxLng: -72.387778,
    };
    const routeTiles = tilesForBboxAtZoom(routeBbox, 13);
    expect(spot.x).toBeGreaterThan(0);
    expect(spot.y).toBeGreaterThan(0);
    expect(routeTiles.length).toBeGreaterThanOrEqual(1);
  });
});
