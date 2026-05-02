import { describe, expect, it } from "vitest";
import { normalizeCanonicalPostLocation } from "./post-location-normalizer.js";

describe("post location normalizer", () => {
  it("keeps a valid manual city/address", () => {
    const normalized = normalizeCanonicalPostLocation({
      latitude: 40.68843,
      longitude: -75.22073,
      addressDisplayName: "Easton, Pennsylvania",
      city: "Easton",
      region: "Pennsylvania",
      country: "US",
      source: "manual",
      reverseGeocodeMatched: true
    });
    expect(normalized.addressDisplayName).toBe("Easton, Pennsylvania");
    expect(normalized.reverseGeocodeStatus).toBe("resolved");
  });

  it("falls back to rounded coordinates in middle-of-nowhere", () => {
    const normalized = normalizeCanonicalPostLocation({
      latitude: 39.210011806706646,
      longitude: -114.58612068508377,
      addressDisplayName: "Location",
      source: "manual",
      reverseGeocodeMatched: false
    });
    expect(normalized.addressDisplayName).toBe("39.2100, -114.5861");
    expect(normalized.fallbackPrecision).toBe("coordinates");
  });

  it("marks failed when coordinates are missing", () => {
    const normalized = normalizeCanonicalPostLocation({
      addressDisplayName: null,
      source: "unknown"
    });
    expect(normalized.reverseGeocodeStatus).toBe("failed");
  });
});

