import { describe, expect, it } from "vitest";
import { getPostCoordinates } from "./postFieldSelectors.js";

describe("getPostCoordinates (radius / canonical parity)", () => {
  it("reads top-level lat + long", () => {
    const c = getPostCoordinates({
      lat: 40.7,
      long: -75.2
    });
    expect(c.lat).toBeCloseTo(40.7, 5);
    expect(c.lng).toBeCloseTo(-75.2, 5);
  });

  it("reads top-level lat + lng", () => {
    const c = getPostCoordinates({
      lat: 40.7,
      lng: -75.2
    });
    expect(c.lat).toBeCloseTo(40.7, 5);
    expect(c.lng).toBeCloseTo(-75.2, 5);
  });

  it("reads location.coordinates.lat / lng when top-level coords missing", () => {
    const c = getPostCoordinates({
      location: {
        coordinates: { lat: 40.688, lng: -75.221, geohash: "dr4e3x" }
      }
    });
    expect(c.lat).toBeCloseTo(40.688, 5);
    expect(c.lng).toBeCloseTo(-75.221, 5);
  });

  it("reads location.coordinates.lat / long", () => {
    const c = getPostCoordinates({
      location: {
        coordinates: { lat: 40.688, long: -75.221 }
      }
    });
    expect(c.lat).toBeCloseTo(40.688, 5);
    expect(c.lng).toBeCloseTo(-75.221, 5);
  });

  it("prefers canonical nested coordinates over missing top-level", () => {
    const c = getPostCoordinates({
      lat: 0,
      lng: 0,
      location: {
        coordinates: { lat: 41.0, lng: -75.0 }
      }
    });
    expect(c.lat).toBeCloseTo(41.0, 5);
    expect(c.lng).toBeCloseTo(-75.0, 5);
  });

  it("reads Firestore-style GeoPoint on location.coordinates (latitude/longitude)", () => {
    const c = getPostCoordinates({
      location: {
        coordinates: { latitude: 40.7128, longitude: -74.006 }
      }
    });
    expect(c.lat).toBeCloseTo(40.7128, 5);
    expect(c.lng).toBeCloseTo(-74.006, 5);
  });

  it("reads lat/lng from geo.geopoint when top-level coords missing", () => {
    const c = getPostCoordinates({
      geo: {
        geopoint: { latitude: 40.65, longitude: -75.28 }
      }
    });
    expect(c.lat).toBeCloseTo(40.65, 5);
    expect(c.lng).toBeCloseTo(-75.28, 5);
  });

  it("reads lat/lng from geoData when present", () => {
    const c = getPostCoordinates({
      geoData: { lat: 40.7, lng: -75.2 }
    });
    expect(c.lat).toBeCloseTo(40.7, 5);
    expect(c.lng).toBeCloseTo(-75.2, 5);
  });
});
