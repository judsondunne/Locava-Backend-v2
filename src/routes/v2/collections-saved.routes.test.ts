import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 collections saved routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  it("lists saved posts with cursor pagination and lean card payload", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v2/collections/saved?limit=12",
      headers: viewerHeaders
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json().data;
    expect(firstBody.routeName).toBe("collections.saved.get");
    expect(firstBody.page.cursorIn).toBeNull();
    expect(firstBody.page.count).toBe(12);
    expect(firstBody.page.sort).toBe("saved_at_desc");
    expect(firstBody.items[0].postId).toBeTypeOf("string");
    expect(firstBody.items[0].author).toBeTruthy();
    expect(firstBody.items[0].assets).toBeUndefined();

    const second = await app.inject({
      method: "GET",
      url: `/v2/collections/saved?limit=12&cursor=${encodeURIComponent(firstBody.page.nextCursor)}`,
      headers: viewerHeaders
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json().data;
    expect(secondBody.page.cursorIn).toBe(firstBody.page.nextCursor);
    expect(secondBody.items.length).toBeGreaterThan(0);
    expect(secondBody.items[0].postId).not.toBe(firstBody.items[0].postId);
  });

  it("uses one bounded page query path and collapses repeated request", async () => {
    const url = "/v2/collections/saved?limit=12";
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=80" });
    const rows = diagnostics
      .json()
      .data.recentRequests.filter((r: { routeName?: string }) => r.routeName === "collections.saved.get");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const latest = rows[0];
    const previous = rows[1];
    expect(previous.dbOps.queries).toBeLessThanOrEqual(2);
    expect(latest.dbOps.queries).toBe(0);
    expect(latest.dbOps.reads).toBe(0);
    expect(previous.budgetViolations).toEqual([]);
    expect(latest.budgetViolations).toEqual([]);
  });

  it("saves and unsaves idempotently with scoped invalidation", async () => {
    const postId = "internal-viewer-feed-post-7";
    const saveFirst = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/save`,
      headers: viewerHeaders
    });
    const saveSecond = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/save`,
      headers: viewerHeaders
    });
    expect(saveFirst.statusCode).toBe(200);
    expect(saveSecond.statusCode).toBe(200);
    expect(saveFirst.json().data.saved).toBe(true);
    expect(saveSecond.json().data.saved).toBe(true);
    expect(saveFirst.json().data.invalidation.invalidatedKeysCount).toBeGreaterThan(0);
    expect(saveSecond.json().data.invalidation.invalidationTypes).toContain("no_op_idempotent");

    const unsaveFirst = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/unsave`,
      headers: viewerHeaders
    });
    const unsaveSecond = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/unsave`,
      headers: viewerHeaders
    });
    expect(unsaveFirst.statusCode).toBe(200);
    expect(unsaveSecond.statusCode).toBe(200);
    expect(unsaveFirst.json().data.saved).toBe(false);
    expect(unsaveSecond.json().data.saved).toBe(false);
    expect(unsaveFirst.json().data.invalidation.invalidatedKeysCount).toBeGreaterThan(0);
    expect(unsaveSecond.json().data.invalidation.invalidationTypes).toContain("no_op_idempotent");
  });

  it("keeps saved list and diagnostics coherent after save/unsave mutations", async () => {
    const postId = "internal-viewer-feed-post-11";
    await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/save`,
      headers: viewerHeaders
    });
    const afterSave = await app.inject({
      method: "GET",
      url: "/v2/collections/saved?limit=12",
      headers: viewerHeaders
    });
    expect(afterSave.statusCode).toBe(200);
    const postIdsAfterSave = (afterSave.json().data.items as Array<{ postId: string }>).map((item) => item.postId);
    expect(postIdsAfterSave).toContain(postId);

    await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/unsave`,
      headers: viewerHeaders
    });
    const afterUnsave = await app.inject({
      method: "GET",
      url: "/v2/collections/saved?limit=12",
      headers: viewerHeaders
    });
    expect(afterUnsave.statusCode).toBe(200);
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=140" });
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      routePolicy?: { routeName: string };
      dedupe?: { hits: number; misses: number };
      concurrency?: { waits: number };
      invalidation?: { keys: number };
      budgetViolations?: string[];
    }>;
    const readRow = rows.find((r) => r.routeName === "collections.saved.get");
    const saveRow = rows.find((r) => r.routeName === "posts.save.post");
    const unsaveRow = rows.find((r) => r.routeName === "posts.unsave.post");
    expect(readRow?.routePolicy?.routeName).toBe("collections.saved.get");
    expect(saveRow?.routePolicy?.routeName).toBe("posts.save.post");
    expect(unsaveRow?.routePolicy?.routeName).toBe("posts.unsave.post");
    expect(typeof readRow?.dedupe?.hits).toBe("number");
    expect(typeof readRow?.dedupe?.misses).toBe("number");
    expect(typeof readRow?.concurrency?.waits).toBe("number");
    expect((saveRow?.invalidation?.keys ?? 0) > 0).toBe(true);
    expect((unsaveRow?.invalidation?.keys ?? 0) > 0).toBe(true);
    expect(readRow?.budgetViolations).toEqual([]);
    expect(saveRow?.budgetViolations).toEqual([]);
    expect(unsaveRow?.budgetViolations).toEqual([]);
  });

  it("invalidates deeper cached saved pages on save/unsave", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v2/collections/saved?limit=12",
      headers: viewerHeaders
    });
    const cursor = first.json().data.page.nextCursor as string;
    const deepUrl = `/v2/collections/saved?limit=12&cursor=${encodeURIComponent(cursor)}`;
    const deepCold = await app.inject({ method: "GET", url: deepUrl, headers: viewerHeaders });
    const deepWarm = await app.inject({ method: "GET", url: deepUrl, headers: viewerHeaders });
    expect(deepCold.statusCode).toBe(200);
    expect(deepWarm.statusCode).toBe(200);
    expect(deepWarm.json().meta.db.reads).toBe(0);

    const postId = "internal-viewer-feed-post-19";
    const save = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/save`,
      headers: viewerHeaders
    });
    expect(save.statusCode).toBe(200);

    const deepAfterSave = await app.inject({ method: "GET", url: deepUrl, headers: viewerHeaders });
    expect(deepAfterSave.statusCode).toBe(200);
    expect(deepAfterSave.json().meta.db.reads).toBeGreaterThan(0);
  });
});
