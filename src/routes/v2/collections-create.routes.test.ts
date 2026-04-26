import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 collections create route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("creates collection and returns canonical payload", async () => {
    const headers = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };
    const res = await app.inject({
      method: "POST",
      url: "/v2/collections",
      headers,
      payload: {
        name: "Weekend Spots",
        description: "Places to try",
        privacy: "private",
        collaborators: ["friend-1"],
        items: ["internal-viewer-feed-post-1"]
      }
    });
    if (res.statusCode === 503) {
      expect(res.json().error.code).toBe("source_of_truth_required");
      return;
    }
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("collections.create.post");
    expect(typeof body.data.collectionId).toBe("string");
    expect(body.data.collection.id).toBe(body.data.collectionId);
    expect(body.data.collection.name).toBe("Weekend Spots");
    expect(body.data.collection.privacy).toBe("private");
    expect(body.data.collection.collaborators).toContain("internal-viewer");
  });

  it("publishes diagnostics row with create route policy", async () => {
    const headers = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };
    await app.inject({
      method: "POST",
      url: "/v2/collections",
      headers,
      payload: {
        name: "Roadtrip",
        privacy: "public"
      }
    });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=20" });
    const row = diagnostics
      .json()
      .data.recentRequests.find((r: { routeName?: string }) => r.routeName === "collections.create.post");
    expect(row).toBeTruthy();
    expect(row.routePolicy.routeName).toBe("collections.create.post");
    expect([200, 503]).toContain(row.statusCode);
  });
});
