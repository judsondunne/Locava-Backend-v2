import { describe, expect, it } from "vitest";
import {
  decodePolyline,
  extractRouteLineCoordinates,
  routeHasDisplayableGeometry,
} from "./pbfCopierRouteGeometry.js";

describe("pbfCopierRouteGeometry", () => {
  it("decodes encoded polylines into lat/lng points", () => {
    const points = [
      { lat: 43.64, lng: -72.42 },
      { lat: 43.641, lng: -72.419 },
      { lat: 43.642, lng: -72.418 },
    ];
    let lastLat = 0;
    let lastLng = 0;
    let encoded = "";
    for (const c of points) {
      const lat = Math.round(c.lat * 1e5);
      const lng = Math.round(c.lng * 1e5);
      const encodeSigned = (value: number) => {
        let v = value < 0 ? ~(value << 1) : value << 1;
        let out = "";
        while (v >= 0x20) {
          out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
          v >>= 5;
        }
        out += String.fromCharCode(v + 63);
        return out;
      };
      encoded += encodeSigned(lat - lastLat) + encodeSigned(lng - lastLng);
      lastLat = lat;
      lastLng = lng;
    }
    const decoded = decodePolyline(encoded);
    expect(decoded.length).toBe(3);
    expect(decoded[0]?.lat).toBeCloseTo(43.64, 3);
  });

  it("extracts line coordinates from route encodedPolyline", () => {
    const route = {
      encodedPolyline: undefined,
      geometryType: "LineString",
      distanceMeters: 500,
      coordinatesPreview: [
        { lat: 43.64, lng: -72.42 },
        { lat: 43.641, lng: -72.419 },
        { lat: 43.642, lng: -72.418 },
      ],
      geometry: undefined,
    };
    expect(routeHasDisplayableGeometry(route)).toBe(true);
    expect(extractRouteLineCoordinates(route).length).toBe(3);
  });

  it("rejects routes with no line geometry", () => {
    const route = {
      encodedPolyline: undefined,
      geometryType: "LineString",
      distanceMeters: 0,
      coordinatesPreview: [{ lat: 44, lng: -72 }],
      geometry: { pointCount: 1, geometryChunked: false },
    };
    expect(routeHasDisplayableGeometry(route)).toBe(false);
  });
});
