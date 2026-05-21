import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";
import * as spotAdapter from "../../repositories/source-of-truth/inventory-spots-firestore.adapter.js";

describe("v2 inventory spot detail route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_TEST_MODE: "disabled" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("returns 404 when spot missing and never calls post repo", async () => {
    const getSpotSpy = vi.spyOn(spotAdapter, "getInventorySpotById").mockResolvedValue(null);
    const res = await app.inject({
      method: "GET",
      url: "/v2/inventory/spots/inv_spot_missing",
      headers,
    });
    expect(res.statusCode).toBe(404);
    expect(getSpotSpy).toHaveBeenCalledWith("inv_spot_missing");
  });
});
