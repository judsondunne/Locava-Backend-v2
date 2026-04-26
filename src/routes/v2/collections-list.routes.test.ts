import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 collections list route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("returns canonical backend collection entities for viewer", async () => {
    const headers = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal",
    };
    const res = await app.inject({
      method: "GET",
      url: "/v2/collections?limit=20",
      headers,
    });
    if (res.statusCode === 503) {
      expect(res.json().error.code).toBe("source_of_truth_required");
      return;
    }
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("collections.list.get");
    expect(Array.isArray(body.data.items)).toBe(true);
  });
});
