import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 mutation routes + invalidation", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("rejects non-internal mutation requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v2/posts/internal-viewer-feed-post-1/like"
    });
    expect(res.statusCode).toBe(403);
  });

  it("likes post and emits scoped invalidation", async () => {
    const viewerHeaders = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };
    const postId = "internal-viewer-feed-post-1";

    await app.inject({
      method: "GET",
      url: "/v2/search/results?q=hiking&limit=8",
      headers: viewerHeaders
    });

    const mutation = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/like`,
      headers: viewerHeaders
    });
    expect(mutation.statusCode).toBe(200);
    const body = mutation.json();
    expect(body.data.routeName).toBe("posts.like.post");
    expect(body.data.postId).toBe(postId);
    expect(body.data.liked).toBe(true);
    expect(typeof body.data.likeCount).toBe("number");
    expect(Number.isFinite(body.data.likeCount)).toBe(true);
    expect(body.data.viewerState?.liked).toBe(true);
    expect(body.data.invalidation.invalidatedKeysCount).toBeGreaterThanOrEqual(4);
    expect(body.data.invalidation.invalidationTypes).toContain("post.social");
    expect(body.data.invalidation.invalidationTypes).toContain("post.viewer_state");

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=20" });
    const row = diagnostics
      .json()
      .data.recentRequests.find((r: { routeName?: string }) => r.routeName === "posts.like.post");
    expect(row).toBeTruthy();
    expect(row.routePolicy.routeName).toBe("posts.like.post");
    expect(typeof row.dbOps.writes).toBe("number");
    expect(row.dbOps.writes).toBeGreaterThanOrEqual(1);
    expect(typeof row.invalidation.keys).toBe("number");
    expect(row.invalidation.keys).toBeGreaterThanOrEqual(4);
    expect(row.invalidation.entityKeys).toBeGreaterThanOrEqual(4);
    expect(row.invalidation.routeKeys).toBeGreaterThanOrEqual(0);
    expect(typeof row.invalidation.types["post.like"]).toBe("number");
    expect(typeof row.idempotency.hits).toBe("number");
    expect(typeof row.idempotency.misses).toBe("number");
    expect(row.budgetViolations).toEqual([]);
  });

  it("unlikes post and emits symmetric invalidation", async () => {
    const viewerHeaders = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };
    const postId = "internal-viewer-feed-post-1";
    const mutation = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/unlike`,
      headers: viewerHeaders
    });
    expect(mutation.statusCode).toBe(200);
    const body = mutation.json();
    expect(body.data.routeName).toBe("posts.unlike.post");
    expect(body.data.postId).toBe(postId);
    expect(body.data.liked).toBe(false);
    expect(body.data.invalidation.invalidationTypes).toContain("post.social");
  });

  it("follows user and avoids over-invalidation storms", async () => {
    const viewerHeaders = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };
    const userId = "author-24";
    const mutation = await app.inject({
      method: "POST",
      url: `/v2/users/${encodeURIComponent(userId)}/follow`,
      headers: viewerHeaders
    });
    expect(mutation.statusCode).toBe(200);
    const body = mutation.json();
    expect(body.data.routeName).toBe("users.follow.post");
    expect(body.data.following).toBe(true);
    expect(body.data.invalidation.invalidatedKeysCount).toBeGreaterThanOrEqual(1);
    expect(body.data.invalidation.invalidatedKeysCount).toBeLessThanOrEqual(49);
    expect(body.data.invalidation.invalidationTypes).toContain("user.summary");

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=20" });
    const row = diagnostics
      .json()
      .data.recentRequests.find((r: { routeName?: string }) => r.routeName === "users.follow.post");
    expect(row).toBeTruthy();
    expect(row.routePolicy.routeName).toBe("users.follow.post");
    expect(row.dbOps.writes).toBeGreaterThanOrEqual(1);
    expect(typeof row.invalidation.keys).toBe("number");
    expect(row.invalidation.keys).toBeGreaterThanOrEqual(1);
    expect(row.invalidation.keys).toBeLessThanOrEqual(49);
    expect(typeof row.invalidation.types["user.follow"]).toBe("number");
    expect(typeof row.idempotency.hits).toBe("number");
    expect(typeof row.idempotency.misses).toBe("number");
    expect(row.budgetViolations).toEqual([]);
  });

  it("unfollows user and mirrors follow semantics", async () => {
    const viewerHeaders = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };
    const userId = "author-24";
    const mutation = await app.inject({
      method: "POST",
      url: `/v2/users/${encodeURIComponent(userId)}/unfollow`,
      headers: viewerHeaders
    });
    expect(mutation.statusCode).toBe(200);
    const body = mutation.json();
    expect(body.data.routeName).toBe("users.unfollow.post");
    expect(body.data.following).toBe(false);
    expect(body.data.invalidation.invalidationTypes).toContain("user.summary");
  });

  it("repeated like/unlike and follow/unfollow are idempotent", async () => {
    const viewerHeaders = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };
    const postId = "internal-viewer-feed-post-2";
    const userId = "author-25";
    const likeA = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/like`,
      headers: viewerHeaders
    });
    const likeB = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/like`,
      headers: viewerHeaders
    });
    expect(likeA.statusCode).toBe(200);
    expect(likeB.statusCode).toBe(200);
    expect(likeB.json().data.invalidation.invalidationTypes).toContain("no_op_idempotent");

    const unlikeA = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/unlike`,
      headers: viewerHeaders
    });
    const unlikeB = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/unlike`,
      headers: viewerHeaders
    });
    expect(unlikeA.statusCode).toBe(200);
    expect(unlikeB.statusCode).toBe(200);
    expect(unlikeB.json().data.invalidation.invalidationTypes).toContain("no_op_idempotent");

    const followA = await app.inject({
      method: "POST",
      url: `/v2/users/${encodeURIComponent(userId)}/follow`,
      headers: viewerHeaders
    });
    const followB = await app.inject({
      method: "POST",
      url: `/v2/users/${encodeURIComponent(userId)}/follow`,
      headers: viewerHeaders
    });
    expect(followA.statusCode).toBe(200);
    expect(followB.statusCode).toBe(200);
    expect(followB.json().data.invalidation.invalidationTypes).toContain("no_op_idempotent");

    const unfollowA = await app.inject({
      method: "POST",
      url: `/v2/users/${encodeURIComponent(userId)}/unfollow`,
      headers: viewerHeaders
    });
    const unfollowB = await app.inject({
      method: "POST",
      url: `/v2/users/${encodeURIComponent(userId)}/unfollow`,
      headers: viewerHeaders
    });
    expect(unfollowA.statusCode).toBe(200);
    expect(unfollowB.statusCode).toBe(200);
    expect(unfollowB.json().data.invalidation.invalidationTypes).toContain("no_op_idempotent");
  });

  it("overlapping opposite mutations converge without over-invalidation", async () => {
    const viewerHeaders = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };
    const postId = "internal-viewer-feed-post-3";
    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v2/posts/${encodeURIComponent(postId)}/like`,
        headers: viewerHeaders
      }),
      app.inject({
        method: "POST",
        url: `/v2/posts/${encodeURIComponent(postId)}/unlike`,
        headers: viewerHeaders
      })
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    const detail = await app.inject({
      method: "GET",
      url: `/v2/feed/items/${encodeURIComponent(postId)}/detail`,
      headers: viewerHeaders
    });
    expect(detail.statusCode).toBe(200);
    const liked = detail.json().data.firstRender.viewer.liked;
    expect(typeof liked).toBe("boolean");

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=30" });
    const rows = diagnostics
      .json()
      .data.recentRequests.filter((r: { routeName?: string }) =>
        ["posts.like.post", "posts.unlike.post"].includes(r.routeName ?? "")
      );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.invalidation.keys).toBeLessThanOrEqual(8);
      expect(row.budgetViolations).toEqual([]);
    }
  });

  it("invalidates non-self profile post detail cache keys correctly", async () => {
    const viewerHeaders = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };
    const userId = "author-24";
    const postId = `${userId}-post-1`;
    const detailUrl = `/v2/profiles/${encodeURIComponent(userId)}/posts/${encodeURIComponent(postId)}/detail`;

    const first = await app.inject({ method: "GET", url: detailUrl, headers: viewerHeaders });
    const warm = await app.inject({ method: "GET", url: detailUrl, headers: viewerHeaders });
    expect(first.statusCode).toBe(200);
    expect(warm.statusCode).toBe(200);
    expect(warm.json().meta.db.reads).toBe(0);

    const like = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/like`,
      headers: viewerHeaders
    });
    expect(like.statusCode).toBe(200);

    const afterInvalidation = await app.inject({ method: "GET", url: detailUrl, headers: viewerHeaders });
    expect(afterInvalidation.statusCode).toBe(200);
    expect(afterInvalidation.json().meta.db.reads).toBeGreaterThan(0);
  });
});
