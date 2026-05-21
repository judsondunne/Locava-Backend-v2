import { describe, expect, it } from "vitest";
import {
  assertLikelyNotSwapped,
  bboxOfCoordinates,
  centerOfCoordinates,
  isLatLngValid,
  isLikelySwappedForUpperValley,
  isPointInsideBbox,
  parseBboxString,
  parseGeoJsonCoordinatePair,
  parseGeoJsonLineString,
  parseGeoJsonPoint,
  parseGeoJsonPolygonCenter,
  parseOsmNodeLatLng,
  parseOsmWayGeometry,
} from "./inventoryCoordinates.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "./inventoryBbox.js";

describe("inventoryCoordinates", () => {
  it("parses GeoJSON point [lng, lat] as { lat, lng }", () => {
    const point = parseGeoJsonPoint({
      geometry: { type: "Point", coordinates: [-72.394722, 43.543056] },
    });
    expect(point).toEqual({ lat: 43.543056, lng: -72.394722 });
  });

  it("parses OSM node { lat, lon } as { lat, lng }", () => {
    expect(parseOsmNodeLatLng({ lat: 43.54, lon: -72.39 })).toEqual({ lat: 43.54, lng: -72.39 });
  });

  it("accepts Hartland point inside default bbox", () => {
    const point = { lat: 43.54, lng: -72.39 };
    expect(isPointInsideBbox(point, INVENTORY_MVP_DEFAULT_VIEWPORT.bbox)).toBe(true);
    expect(isLatLngValid(point)).toBe(true);
  });

  it("detects swapped Hartland coordinates", () => {
    const swapped = { lat: -72.39, lng: 43.54 };
    expect(isLikelySwappedForUpperValley(swapped.lat, swapped.lng)).toBe(true);
    expect(assertLikelyNotSwapped(swapped, "test")).not.toBeNull();
  });

  it("computes polygon center from GeoJSON polygon", () => {
    const center = parseGeoJsonPolygonCenter({
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
    });
    expect(center?.lat).toBeCloseTo(43.5465, 3);
    expect(center?.lng).toBeCloseTo(-72.41, 3);
  });

  it("parses GeoJSON LineString coordinates in order", () => {
    const line = parseGeoJsonLineString({
      geometry: {
        type: "LineString",
        coordinates: [
          [-72.387778, 43.548611],
          [-72.384722, 43.550833],
        ],
      },
    });
    expect(line).toEqual([
      { lat: 43.548611, lng: -72.387778 },
      { lat: 43.550833, lng: -72.384722 },
    ]);
  });

  it("parses bbox strings in both common orders", () => {
    const lngLatOrder = parseBboxString("-72.55,43.45,-72.25,43.63");
    const latLngOrder = parseBboxString("43.45,-72.55,43.63,-72.25");
    expect(lngLatOrder).toEqual(INVENTORY_MVP_DEFAULT_VIEWPORT.bbox);
    expect(latLngOrder).toEqual(INVENTORY_MVP_DEFAULT_VIEWPORT.bbox);
  });

  it("parses OSM way geometry lat/lon pairs", () => {
    const coords = parseOsmWayGeometry({
      geometry: [
        { lat: 43.54, lon: -72.39 },
        { lat: 43.55, lon: -72.38 },
      ],
    });
    expect(coords).toHaveLength(2);
    expect(centerOfCoordinates(coords)?.lat).toBeCloseTo(43.545, 5);
    expect(centerOfCoordinates(coords)?.lng).toBeCloseTo(-72.385, 5);
    expect(bboxOfCoordinates(coords)).toEqual({
      minLat: 43.54,
      maxLat: 43.55,
      minLng: -72.39,
      maxLng: -72.38,
    });
  });

  it("parses coordinate pair helper directly", () => {
    expect(parseGeoJsonCoordinatePair([-72.4, 43.54])).toEqual({ lat: 43.54, lng: -72.4 });
  });
});
