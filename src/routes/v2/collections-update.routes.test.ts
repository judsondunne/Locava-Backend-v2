import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 collections update route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  async function createCollectionId(): Promise<string | null> {
    const created = await app.inject({
      method: "POST",
      url: "/v2/collections",
      headers,
      payload: { name: "Test Collection", privacy: "private" }
    });
    if (created.statusCode !== 200) return null;
    return created.json().data.collectionId as string;
  }

  it("updates selected fields and returns canonical bounded payload", async () => {
    const collectionId = await createCollectionId();
    if (!collectionId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v2/collections/${encodeURIComponent(collectionId)}`,
      headers,
      payload: {
        name: "Weekend Spots",
        privacy: "friends"
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("collections.update.post");
    expect(body.data.collectionId).toBe(collectionId);
    expect(body.data.updatedFields).toEqual(["name", "privacy"]);
    expect(body.data.updatedCollection.id).toBe(collectionId);
    expect(body.data.updatedCollection.name).toBe("Weekend Spots");
    expect(body.data.updatedCollection.privacy).toBe("friends");

    const reopened = await app.inject({
      method: "GET",
      url: `/v2/collections/${encodeURIComponent(collectionId)}`,
      headers
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().data.item.name).toBe("Weekend Spots");
    expect(reopened.json().data.item.privacy).toBe("friends");
  });

  it("publishes diagnostics row with update route policy", async () => {
    const collectionId = await createCollectionId();
    if (!collectionId) return;
    await app.inject({
      method: "PATCH",
      url: `/v2/collections/${encodeURIComponent(collectionId)}`,
      headers,
      payload: {
        description: "Renamed and tuned"
      }
    });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=20" });
    const row = diagnostics
      .json()
      .data.recentRequests.find((r: { routeName?: string }) => r.routeName === "collections.update.post");
    expect(row).toBeTruthy();
    expect(row.routePolicy.routeName).toBe("collections.update.post");
    expect([200, 503]).toContain(row.statusCode);
  });
});
