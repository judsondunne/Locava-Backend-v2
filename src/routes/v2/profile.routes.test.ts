import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

const HEAVY_USER_ID = "aXngoh9jeqW35FNM3fq1w9aXdEh1";

describe("v2 profile bootstrap route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("allows non-internal viewer for profile bootstrap", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/bootstrap`,
      headers: { "x-viewer-id": "viewer-1" }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("returns lean profile bootstrap for heavy user", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/bootstrap?gridLimit=12`,
      headers: {
        "x-viewer-id": "viewer-1",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.routeName).toBe("profile.bootstrap.get");
    expect(body.data.firstRender.counts.posts).toBeGreaterThanOrEqual(0);
    expect(body.data.firstRender.gridPreview.items.length).toBeLessThanOrEqual(12);
    expect(body.data.firstRender.gridPreview.nextCursor).not.toBeNull();
  });

  it("collapses repeated identical bootstrap to warm near-zero db ops", async () => {
    const url = `/v2/profiles/${HEAVY_USER_ID}/bootstrap?gridLimit=12`;
    const headers = {
      "x-viewer-id": "viewer-warm",
      "x-viewer-roles": "internal"
    };
    const first = await app.inject({ method: "GET", url, headers });
    const second = await app.inject({ method: "GET", url, headers });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().meta.db.reads).toBe(0);
    expect(second.json().meta.db.queries).toBe(0);
  });

  it("keeps header follower/following counts consistent with followers/following surfaces", async () => {
    const viewerHeaders = {
      "x-viewer-id": "viewer-parity",
      "x-viewer-roles": "internal"
    };
    const bootstrap = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/bootstrap?gridLimit=12`,
      headers: viewerHeaders
    });
    expect(bootstrap.statusCode).toBe(200);
    const b = bootstrap.json().data.firstRender;

    const followers = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/followers?limit=10`,
      headers: viewerHeaders
    });
    expect(followers.statusCode).toBe(200);
    const f = followers.json().data;

    const following = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/following?limit=10`,
      headers: viewerHeaders
    });
    expect(following.statusCode).toBe(200);
    const g = following.json().data;

    expect(b.counts.followers).toBe(f.totalCount);
    expect(b.counts.following).toBe(g.totalCount);
  });

  it("returns base payload when deferred debug hint is set but no deferred enrichment is pending", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/bootstrap?debugSlowDeferredMs=300`,
      headers: {
        "x-viewer-id": "viewer-1",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.degraded).toBe(false);
    expect(body.data.fallbacks).toEqual([]);
    expect(Array.isArray(body.data.firstRender.gridPreview.items)).toBe(true);
  });

  it("shows observability fields in diagnostics", async () => {
    await app.inject({
      method: "GET",
      url: `/v2/profiles/${HEAVY_USER_ID}/bootstrap`,
      headers: {
        "x-viewer-id": "viewer-2",
        "x-viewer-roles": "internal"
      }
    });

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=10" });
    expect(diagnostics.statusCode).toBe(200);
    const body = diagnostics.json();
    const profileEntry = body.data.recentRequests.find((row: { routeName?: string }) => row.routeName === "profile.bootstrap.get");

    expect(profileEntry).toBeTruthy();
    expect(profileEntry.dbOps.reads).toBeGreaterThan(0);
    expect(typeof profileEntry.cache.hits).toBe("number");
    expect(Array.isArray(profileEntry.fallbacks)).toBe(true);
  });

  it("serves truthful fresh facts immediately after follow/unfollow", async () => {
    const viewerId = "internal-viewer";
    const targetUserId = "user-2";
    const headers = {
      "x-viewer-id": viewerId,
      "x-viewer-roles": "internal"
    };

    const targetBootstrapUrl = `/v2/profiles/${encodeURIComponent(targetUserId)}/bootstrap?gridLimit=12`;
    const viewerBootstrapUrl = `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap?gridLimit=12`;

    const before = await app.inject({ method: "GET", url: targetBootstrapUrl, headers });
    const warm = await app.inject({ method: "GET", url: targetBootstrapUrl, headers });
    expect(before.statusCode).toBe(200);
    expect(warm.statusCode).toBe(200);
    expect(warm.json().meta.db.reads).toBe(0);
    const beforeFollowers = before.json().data.firstRender.counts.followers as number;
    const beforeViewerFollowing = (await app.inject({ method: "GET", url: viewerBootstrapUrl, headers })).json().data.firstRender
      .counts.following as number;

    const follow = await app.inject({
      method: "POST",
      url: `/v2/users/${encodeURIComponent(targetUserId)}/follow`,
      headers
    });
    expect(follow.statusCode).toBe(200);
    expect(follow.json().data.following).toBe(true);

    const afterFollow = await app.inject({ method: "GET", url: targetBootstrapUrl, headers });
    expect(afterFollow.statusCode).toBe(200);
    expect(afterFollow.json().meta.db.reads).toBeGreaterThan(0);
    expect(afterFollow.json().data.firstRender.relationship.following).toBe(true);
    expect(afterFollow.json().data.firstRender.counts.followers).toBe(beforeFollowers + 1);

    const viewerAfterFollow = await app.inject({ method: "GET", url: viewerBootstrapUrl, headers });
    expect(viewerAfterFollow.statusCode).toBe(200);
    expect(viewerAfterFollow.json().data.firstRender.counts.following).toBe(beforeViewerFollowing + 1);

    const unfollow = await app.inject({
      method: "POST",
      url: `/v2/users/${encodeURIComponent(targetUserId)}/unfollow`,
      headers
    });
    expect(unfollow.statusCode).toBe(200);
    expect(unfollow.json().data.following).toBe(false);

    const afterUnfollow = await app.inject({ method: "GET", url: targetBootstrapUrl, headers });
    expect(afterUnfollow.statusCode).toBe(200);
    expect(afterUnfollow.json().meta.db.reads).toBeGreaterThan(0);
    expect(afterUnfollow.json().data.firstRender.relationship.following).toBe(false);
    expect(afterUnfollow.json().data.firstRender.counts.followers).toBe(beforeFollowers);

    const viewerAfterUnfollow = await app.inject({ method: "GET", url: viewerBootstrapUrl, headers });
    expect(viewerAfterUnfollow.statusCode).toBe(200);
    expect(viewerAfterUnfollow.json().data.firstRender.counts.following).toBe(beforeViewerFollowing);
  });
});
