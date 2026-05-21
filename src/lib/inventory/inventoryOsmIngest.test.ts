import path from "node:path";
import { describe, expect, it } from "vitest";
import { ingestGeoJsonFeature } from "./inventoryOsmIngest.js";
import { OsmLikeGeojsonInventorySource } from "./sources/osmLikeGeojsonInventorySource.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "./inventoryBbox.js";
import { normalizeInventoryRawObjects } from "./inventoryNormalize.js";

describe("inventoryOsmIngest", () => {
  it("turns GeoJSON Point into spot with correct lat/lng", () => {
    const result = ingestGeoJsonFeature(
      {
        type: "Feature",
        id: "pt-1",
        properties: { name: "River Viewpoint", tourism: "viewpoint" },
        geometry: { type: "Point", coordinates: [-72.415278, 43.556944] },
      },
      0
    );
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]?.kind).toBe("spot");
    if (result.objects[0]?.kind === "spot") {
      expect(result.objects[0].lat).toBeCloseTo(43.556944, 5);
      expect(result.objects[0].lng).toBeCloseTo(-72.415278, 5);
    }
  });

  it("turns closed park polygon into spot center", () => {
    const result = ingestGeoJsonFeature(
      {
        type: "Feature",
        id: "poly-1",
        properties: { name: "Marsh", natural: "wetland" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-72.412, 43.548],
              [-72.408, 43.548],
              [-72.408, 43.545],
              [-72.412, 43.545],
              [-72.412, 43.548],
            ],
          ],
        },
      },
      1
    );
    expect(result.objects[0]?.kind).toBe("spot");
  });

  it("turns path LineString into route with full coordinates", () => {
    const result = ingestGeoJsonFeature(
      {
        type: "Feature",
        id: "line-1",
        properties: { name: "Town Forest Path", highway: "path", foot: "designated" },
        geometry: {
          type: "LineString",
          coordinates: [
            [-72.387778, 43.548611],
            [-72.384722, 43.550833],
            [-72.386389, 43.547778],
          ],
        },
      },
      2
    );
    expect(result.objects[0]?.kind).toBe("route");
    if (result.objects[0]?.kind === "route") {
      expect(result.objects[0].coordinates.length).toBe(3);
      expect(result.objects[0].coordinates[0]).toEqual({ lat: 43.548611, lng: -72.387778 });
    }
  });

  it("loads Hartland mirror sample geojson and normalizes with coordinate sanity", async () => {
    const source = new OsmLikeGeojsonInventorySource();
    const filePath = path.resolve("src/lib/inventory/sources/hartlandMirrorSample.geojson");
    const rawObjects = await source.loadRawObjects({
      source: "geojson",
      regionKey: INVENTORY_MVP_DEFAULT_VIEWPORT.regionKey,
      regionLabel: INVENTORY_MVP_DEFAULT_VIEWPORT.label,
      bbox: INVENTORY_MVP_DEFAULT_VIEWPORT.bbox,
      geojsonPath: filePath,
      limit: 100,
    });
    const normalized = normalizeInventoryRawObjects({
      rawObjects,
      regionKey: INVENTORY_MVP_DEFAULT_VIEWPORT.regionKey,
      regionBbox: INVENTORY_MVP_DEFAULT_VIEWPORT.bbox,
      importRunId: "test_run",
    });

    expect(normalized.spots.length).toBeGreaterThan(0);
    expect(normalized.routes.length).toBeGreaterThan(0);
    expect(rawObjects.length).toBeGreaterThan(0);
    expect(normalized.spots.every((s) => s.lat > 42 && s.lat < 46 && s.lng < -71 && s.lng > -74)).toBe(true);
  });
});
