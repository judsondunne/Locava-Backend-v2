import { describe, expect, it } from "vitest";
import {
  buildHartlandOverpassQuery,
  dedupeOsmFeatures,
  parseGeoJsonFeature,
  parseOverpassElement,
} from "./osmFeatureParse.js";

describe("osmFeatureParse", () => {
  it("builds a comprehensive Overpass query for Hartland bbox", () => {
    const query = buildHartlandOverpassQuery({
      minLat: 43.45,
      minLng: -72.55,
      maxLat: 43.63,
      maxLng: -72.25,
    });
    expect(query).toContain('node["natural"](43.45,-72.55,43.63,-72.25);');
    expect(query).toContain('way["highway"](43.45,-72.55,43.63,-72.25);');
    expect(query).toContain("out body geom;");
  });

  it("parses an OSM node with lat/lon", () => {
    const feature = parseOverpassElement({
      type: "node",
      id: 123,
      lat: 43.54063,
      lon: -72.39898,
      tags: { natural: "peak", name: "Test Peak", ele: "400" },
    });
    expect(feature).toMatchObject({
      id: "node/123",
      name: "Test Peak",
      hasRealName: true,
      featureType: "natural=peak",
      lat: 43.54063,
      lng: -72.39898,
      coordSource: "node",
    });
  });

  it("parses a way using geometry center", () => {
    const feature = parseOverpassElement({
      type: "way",
      id: 456,
      tags: { highway: "path", name: "Forest Trail" },
      geometry: [
        { lat: 43.54, lon: -72.4 },
        { lat: 43.55, lon: -72.39 },
      ],
    });
    expect(feature).toMatchObject({
      id: "way/456",
      name: "Forest Trail",
      featureType: "highway=path",
      coordSource: "line_center",
      geometryKind: "line",
    });
    expect(feature?.lat).toBeGreaterThan(43.54);
    expect(feature?.lng).toBeGreaterThan(-72.4);
  });

  it("open footway with many nodes is a line not a polygon", () => {
    const geometry = Array.from({ length: 12 }, (_, i) => ({
      lat: 43.64 + i * 0.0001,
      lon: -72.41 + i * 0.0001,
    }));
    const feature = parseOverpassElement({
      type: "way",
      id: 926028987,
      tags: { highway: "footway", name: "Laughlin Trail" },
      geometry,
    });
    expect(feature?.geometryKind).toBe("line");
    expect(feature?.closed).toBe(false);
    expect(feature?.coordinates.length).toBe(12);
  });

  it("parses geojson fixture features", () => {
    const feature = parseGeoJsonFeature({
      type: "Feature",
      id: "gj-view-1",
      properties: { name: "River Viewpoint", tourism: "viewpoint" },
      geometry: { type: "Point", coordinates: [-72.39898, 43.54063] },
    });
    expect(feature?.name).toBe("River Viewpoint");
    expect(feature?.featureType).toBe("tourism=viewpoint");
  });

  it("dedupes by osm id", () => {
    const one = parseOverpassElement({
      type: "node",
      id: 1,
      lat: 43.54,
      lon: -72.39,
      tags: { natural: "waterfall", name: "Falls" },
    })!;
    const dup = { ...one, name: "Duplicate" };
    const out = dedupeOsmFeatures([one, dup]);
    expect(out).toHaveLength(1);
  });
});
