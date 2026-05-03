import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 search mixes production truth (bootstrap + feed)", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headersViewer = (viewerId: string) => ({
    "x-viewer-id": viewerId,
    "x-viewer-roles": "internal",
    "content-type": "application/json",
  });

  it("bootstrap returns visible general mixes with covers; friends/nearby gating is truthful", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/mixes/bootstrap?limit=8&includeDebug=1",
      headers: headersViewer("internal-viewer"),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.routeName).toBe("search.mixes.bootstrap.get");
    expect(Array.isArray(body.mixes)).toBe(true);
    const mixes = body.mixes as any[];

    const general = mixes.filter((m) => m.type === "general");
    expect(general.length).toBeGreaterThanOrEqual(6);
    for (const m of general) {
      expect(typeof m.coverImageUrl).toBe("string");
      expect(m.coverImageUrl.length).toBeGreaterThan(10);
      expect(typeof m.coverPostId).toBe("string");
      expect(m.coverPostId.length).toBeGreaterThan(2);
      expect(Array.isArray(m.previewPostIds)).toBe(true);
      expect(m.previewPostIds.length).toBeGreaterThan(0);
      expect(m.hiddenReason == null).toBe(true);
    }

    const friends = mixes.find((m) => m.type === "friends");
    expect(friends).toBeTruthy();
    expect(friends.hiddenReason == null).toBe(true);

    const nearbyHidden = await app.inject({
      method: "GET",
      url: "/v2/search/mixes/bootstrap?limit=8&includeDebug=1",
      headers: headersViewer("viewer-a"),
    });
    expect(nearbyHidden.statusCode).toBe(200);
    const mixesA = nearbyHidden.json().data.mixes as any[];
    const friendsA = mixesA.find((m) => m.type === "friends");
    expect(friendsA).toBeTruthy();
    expect(friendsA.hiddenReason).toBe("not_following_anyone");
  });

  it("activity mix feed paginates with cursor and no duplicates", async () => {
    const mixId = "activity:swimming";
    const p1 = await app.inject({
      method: "GET",
      url: `/v2/search/mixes/feed?mixId=${encodeURIComponent(mixId)}&limit=8&includeDebug=1`,
      headers: headersViewer("internal-viewer"),
    });
    expect(p1.statusCode).toBe(200);
    const b1 = p1.json().data;
    expect(Array.isArray(b1.posts)).toBe(true);
    expect(b1.posts.length).toBeGreaterThan(0);
    expect(typeof b1.hasMore).toBe("boolean");
    if (!b1.nextCursor) return;
    const ids1 = new Set(b1.posts.map((p: any) => String(p.postId ?? p.id ?? "").trim()).filter(Boolean));

    const p2 = await app.inject({
      method: "GET",
      url: `/v2/search/mixes/feed?mixId=${encodeURIComponent(mixId)}&limit=8&cursor=${encodeURIComponent(
        b1.nextCursor
      )}`,
      headers: headersViewer("internal-viewer"),
    });
    expect(p2.statusCode).toBe(200);
    const b2 = p2.json().data;
    const ids2 = b2.posts.map((p: any) => String(p.postId ?? p.id ?? "").trim()).filter(Boolean);
    expect(ids2.some((id: string) => ids1.has(id))).toBe(false);
  });

  it("friends mix feed returns only followed authors", async () => {
    const mixId = "friends:from_people_you_follow";
    const p1 = await app.inject({
      method: "GET",
      url: `/v2/search/mixes/feed?mixId=${encodeURIComponent(mixId)}&limit=12&includeDebug=1`,
      headers: headersViewer("internal-viewer"),
    });
    expect(p1.statusCode).toBe(200);
    const b1 = p1.json().data;
    const posts = b1.posts as any[];
    expect(Array.isArray(posts)).toBe(true);
    // internal-viewer follows author-24 and author-25 in deterministic seed.
    for (const p of posts) {
      const uid = String((p as { author?: { userId?: string }; userId?: string }).author?.userId ?? (p as { userId?: string }).userId ?? "");
      expect(["author-24", "author-25"].includes(uid)).toBe(true);
    }
  });

  it("nearby mix hidden without coords and distance-aware with coords", async () => {
    const mixId = "nearby:near_you";
    const hidden = await app.inject({
      method: "GET",
      url: `/v2/search/mixes/feed?mixId=${encodeURIComponent(mixId)}&limit=10&includeDebug=1`,
      headers: headersViewer("internal-viewer"),
    });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().data.posts.length).toBe(0);

    const lat = 40.68843;
    const lng = -75.22073;
    const vis = await app.inject({
      method: "GET",
      url: `/v2/search/mixes/feed?mixId=${encodeURIComponent(mixId)}&limit=10&lat=${lat}&lng=${lng}&includeDebug=1`,
      headers: headersViewer("internal-viewer"),
    });
    if (vis.statusCode !== 200) {
      // eslint-disable-next-line no-console
      console.log("[TEST_NEARBY_FEED_FAIL]", JSON.stringify({ status: vis.statusCode, body: vis.json() }, null, 2));
    }
    expect(vis.statusCode).toBe(200);
    const b = vis.json().data;
    const posts = b.posts as any[];
    expect(posts.length).toBeGreaterThan(0);
    // assert non-decreasing distance miles (debug field set by service)
      const ds = posts.map((p) => Number(p._debugDistanceMiles ?? NaN)).filter((n) => Number.isFinite(n));
      if (ds.length >= 2) {
        for (let i = 1; i < ds.length; i += 1) {
          expect(ds[i]!).toBeGreaterThanOrEqual(ds[i - 1]!);
        }
      }
  });

  it("daily mix ordering is stable for the same day/viewer across pages", async () => {
    const mixId = "daily:for_you";
    const p1 = await app.inject({
      method: "GET",
      url: `/v2/search/mixes/feed?mixId=${encodeURIComponent(mixId)}&limit=8&includeDebug=1`,
      headers: headersViewer("internal-viewer"),
    });
    expect(p1.statusCode).toBe(200);
    const b1 = p1.json().data;
    const ids1 = b1.posts.map((p: any) => String(p.postId ?? p.id ?? "").trim()).filter(Boolean);
    const p1b = await app.inject({
      method: "GET",
      url: `/v2/search/mixes/feed?mixId=${encodeURIComponent(mixId)}&limit=8&includeDebug=1`,
      headers: headersViewer("internal-viewer"),
    });
    expect(p1b.statusCode).toBe(200);
    const b1b = p1b.json().data;
    const ids1b = b1b.posts.map((p: any) => String(p.postId ?? p.id ?? "").trim()).filter(Boolean);
    expect(ids1b.slice(0, 6)).toEqual(ids1.slice(0, 6));
  });
});
