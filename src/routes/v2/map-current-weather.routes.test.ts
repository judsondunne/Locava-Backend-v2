import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 map current-weather route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  it("returns 400 for invalid coordinates", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/map/current-weather?lat=999&lon=0",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().ok).toBe(false);
  });

  it("returns 403 without map surface access", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/map/current-weather?lat=40.7&lon=-74.0",
      headers: {
        "x-viewer-id": "public-user",
        "x-viewer-roles": "user"
      }
    });
    expect(response.statusCode).toBe(403);
  });

  it("returns current weather from Open-Meteo for NYC", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/map/current-weather?lat=40.7128&lon=-74.006",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const envelope = response.json();
    expect(envelope.ok).toBe(true);
    const data = envelope.data;
    expect(data.routeName).toBe("map.current_weather.get");
    expect(["open_meteo", "openweathermap"]).toContain(data.source);
    expect(typeof data.temp).toBe("number");
    expect(Number.isFinite(data.temp)).toBe(true);
    expect(typeof data.condition).toBe("string");
    expect(data.condition.length).toBeGreaterThan(0);
  });
});
