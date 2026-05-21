import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 inventory tiles route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_TEST_MODE: "disabled" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("returns empty payload cleanly when no tile exists", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/inventory/tiles?bbox=-72.55,43.45,-72.25,43.63&zoom=13",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("inventory.tiles.get");
    expect(body.data.tiles).toEqual([]);
    expect(body.data.count).toBe(0);
  });
});
