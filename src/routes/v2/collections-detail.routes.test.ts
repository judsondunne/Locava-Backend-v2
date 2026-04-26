import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 collections detail route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("returns canonical backend collection entity by id", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v2/collections",
      headers,
      payload: { name: "Detail Test", privacy: "private" }
    });
    if (created.statusCode !== 200) {
      expect(created.statusCode).toBe(503);
      expect(created.json().error.code).toBe("source_of_truth_required");
      return;
    }
    const collectionId = created.json().data.collectionId as string;
    const res = await app.inject({
      method: "GET",
      url: `/v2/collections/${encodeURIComponent(collectionId)}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("collections.detail.get");
    expect(body.data.item.id).toBe(collectionId);
    expect(body.data.item.ownerId).toBe("internal-viewer");
    expect(body.data.item.kind).toBe("backend");
  });

  it("returns 404 for missing collection", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/collections/internal-viewer-collection-missing",
      headers,
    });
    expect([404, 503]).toContain(res.statusCode);
  });
});
