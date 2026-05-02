import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 places reverse geocode route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("returns a stable address for known seeded coordinates", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/places/reverse-geocode?lat=44.4759&lng=-73.2121",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("places.reverse_geocode.get");
    expect(body.data.success).toBe(true);
    expect(String(body.data.address ?? "").toLowerCase()).toContain("burlington");
    expect(body.data.address).not.toBe("Location");
    expect(body.data.locationDisplayName).not.toBe("Location");
  });

  it("falls back to rounded coordinates when reverse geocode misses", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/places/reverse-geocode?lat=39.210011806706646&lng=-114.58612068508377",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.address).toBe("39.2100, -114.5861");
    expect(body.data.fallbackPrecision).toBe("coordinates");
    expect(body.data.reverseGeocodeStatus).toBe("fallback");
  });
});
