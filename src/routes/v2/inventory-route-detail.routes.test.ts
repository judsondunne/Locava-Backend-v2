import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";
import * as routeAdapter from "../../repositories/source-of-truth/inventory-routes-firestore.adapter.js";

describe("v2 inventory route detail route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_TEST_MODE: "disabled" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("returns 404 when route missing and never calls post repo", async () => {
    const getRouteSpy = vi.spyOn(routeAdapter, "getInventoryRouteById").mockResolvedValue(null);
    const res = await app.inject({
      method: "GET",
      url: "/v2/inventory/routes/inv_route_missing",
      headers,
    });
    expect(res.statusCode).toBe(404);
    expect(getRouteSpy).toHaveBeenCalledWith("inv_route_missing");
  });
});
