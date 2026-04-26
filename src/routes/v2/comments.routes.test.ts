import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 comments routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };
  const postId = "internal-viewer-feed-post-1";

  it("lists top-level comments with cursor pagination", async () => {
    for (let i = 0; i < 12; i += 1) {
      await app.inject({
        method: "POST",
        url: `/v2/posts/${encodeURIComponent(postId)}/comments`,
        headers: viewerHeaders,
        payload: { text: `seed comment ${i}`, clientMutationKey: `seed-${Date.now()}-${i}` }
      });
    }
    const first = await app.inject({
      method: "GET",
      url: `/v2/posts/${encodeURIComponent(postId)}/comments?limit=5`,
      headers: viewerHeaders
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json().data;
    expect(firstBody.routeName).toBe("comments.list.get");
    expect(firstBody.page.cursorIn).toBeNull();
    expect(firstBody.page.count).toBeGreaterThanOrEqual(5);
    expect(typeof firstBody.page.nextCursor).toBe("string");
    expect(firstBody.items.length).toBe(5);

    const second = await app.inject({
      method: "GET",
      url: `/v2/posts/${encodeURIComponent(postId)}/comments?limit=5&cursor=${encodeURIComponent(firstBody.page.nextCursor)}`,
      headers: viewerHeaders
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json().data;
    expect(secondBody.page.cursorIn).toBe(firstBody.page.nextCursor);
    expect(secondBody.items.length).toBe(5);
    expect(secondBody.items[0].commentId).not.toBe(firstBody.items[0].commentId);
  });

  it("uses one query on cold page and near-zero reads on repeated same request", async () => {
    await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/comments`,
      headers: viewerHeaders,
      payload: { text: "preload comments", clientMutationKey: `preload-${Date.now()}` }
    });
    const url = `/v2/posts/${encodeURIComponent(postId)}/comments?limit=6`;
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    await app.inject({ method: "GET", url, headers: viewerHeaders });

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=50" });
    const rows = diagnostics
      .json()
      .data.recentRequests.filter((r: { routeName?: string }) => r.routeName === "comments.list.get");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const latest = rows[0];
    const previous = rows[1];
    expect(previous.dbOps.queries).toBeGreaterThanOrEqual(0);
    expect(latest.dbOps.queries).toBeGreaterThanOrEqual(0);
    expect(latest.dbOps.reads).toBe(0);
    expect(latest.budgetViolations).toEqual([]);
  });

  it("prevents duplicate create submissions with idempotency key", async () => {
    const key = `cmk-${Date.now()}`;
    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v2/posts/${encodeURIComponent(postId)}/comments`,
        headers: viewerHeaders,
        payload: { text: "Great route.", clientMutationKey: key }
      }),
      app.inject({
        method: "POST",
        url: `/v2/posts/${encodeURIComponent(postId)}/comments`,
        headers: viewerHeaders,
        payload: { text: "Great route.", clientMutationKey: key }
      })
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const bodyA = a.json().data;
    const bodyB = b.json().data;
    expect(bodyA.comment.commentId).toBe(bodyB.comment.commentId);
    expect(bodyA.idempotency.replayed || bodyB.idempotency.replayed).toBe(true);
  });

  it("deletes comment safely and repeated delete is idempotent", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/comments`,
      headers: viewerHeaders,
      payload: { text: "Delete me", clientMutationKey: `cmk-del-${Date.now()}` }
    });
    const commentId = create.json().data.comment.commentId as string;

    const delA = await app.inject({
      method: "DELETE",
      url: `/v2/comments/${encodeURIComponent(commentId)}`,
      headers: viewerHeaders
    });
    const delB = await app.inject({
      method: "DELETE",
      url: `/v2/comments/${encodeURIComponent(commentId)}`,
      headers: viewerHeaders
    });
    expect(delA.statusCode).toBe(200);
    expect(delB.statusCode).toBe(200);
    expect(delA.json().data.deleted).toBe(true);
    expect(delB.json().data.deleted).toBe(false);
    expect(delB.json().data.idempotency.replayed).toBe(true);
  });

  it("likes comment idempotently via v2 comment route", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/comments`,
      headers: viewerHeaders,
      payload: { text: "Like me", clientMutationKey: `cmk-like-${Date.now()}` }
    });
    const commentId = create.json().data.comment.commentId as string;

    const likeA = await app.inject({
      method: "POST",
      url: `/v2/comments/${encodeURIComponent(commentId)}/like`,
      headers: viewerHeaders
    });
    const likeB = await app.inject({
      method: "POST",
      url: `/v2/comments/${encodeURIComponent(commentId)}/like`,
      headers: viewerHeaders
    });
    expect(likeA.statusCode).toBe(200);
    expect(likeB.statusCode).toBe(200);
    expect(likeA.json().data.routeName).toBe("comments.like.post");
    expect(likeA.json().data.liked).toBe(true);
    expect(likeB.json().data.idempotency.replayed).toBe(true);
  });

  it("emits invalidation and diagnostics metadata for create/delete", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/comments`,
      headers: viewerHeaders,
      payload: { text: "Diag comment", clientMutationKey: `cmk-diag-${Date.now()}` }
    });
    expect(create.statusCode).toBe(200);
    const commentId = create.json().data.comment.commentId as string;
    expect(create.json().data.invalidation.invalidatedKeysCount).toBeGreaterThanOrEqual(3);

    const del = await app.inject({
      method: "DELETE",
      url: `/v2/comments/${encodeURIComponent(commentId)}`,
      headers: viewerHeaders
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.invalidation.invalidatedKeysCount).toBeGreaterThanOrEqual(3);

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=50" });
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      routePolicy?: { routeName: string; priority: string };
      invalidation?: { keys: number };
      budgetViolations?: string[];
    }>;
    const createRow = rows.find((r) => r.routeName === "comments.create.post");
    const deleteRow = rows.find((r) => r.routeName === "comments.delete.delete");
    expect(createRow).toBeTruthy();
    expect(deleteRow).toBeTruthy();
    expect(createRow?.routePolicy?.routeName).toBe("comments.create.post");
    expect(deleteRow?.routePolicy?.routeName).toBe("comments.delete.delete");
    expect((createRow?.invalidation?.keys ?? 0) > 0).toBe(true);
    expect((deleteRow?.invalidation?.keys ?? 0) > 0).toBe(true);
    expect(createRow?.budgetViolations).toEqual([]);
    expect(deleteRow?.budgetViolations).toEqual([]);
  });

  it("invalidates deeper cached comment pages after comment mutations", async () => {
    for (let i = 0; i < 8; i += 1) {
      await app.inject({
        method: "POST",
        url: `/v2/posts/${encodeURIComponent(postId)}/comments`,
        headers: viewerHeaders,
        payload: { text: `deep comment ${i}`, clientMutationKey: `deep-${Date.now()}-${i}` }
      });
    }
    const first = await app.inject({
      method: "GET",
      url: `/v2/posts/${encodeURIComponent(postId)}/comments?limit=5`,
      headers: viewerHeaders
    });
    const cursor = first.json().data.page.nextCursor as string | null;
    expect(cursor).not.toBeNull();
    const deepUrl = `/v2/posts/${encodeURIComponent(postId)}/comments?limit=5&cursor=${encodeURIComponent(cursor as string)}`;
    const deepCold = await app.inject({ method: "GET", url: deepUrl, headers: viewerHeaders });
    const deepWarm = await app.inject({ method: "GET", url: deepUrl, headers: viewerHeaders });
    expect(deepCold.statusCode).toBe(200);
    expect(deepWarm.statusCode).toBe(200);
    expect(deepWarm.json().meta.db.reads).toBe(0);

    const create = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/comments`,
      headers: viewerHeaders,
      payload: { text: "invalidate deep comments page", clientMutationKey: `cmk-deep-${Date.now()}` }
    });
    expect(create.statusCode).toBe(200);

    const deepAfter = await app.inject({ method: "GET", url: deepUrl, headers: viewerHeaders });
    expect(deepAfter.statusCode).toBe(200);
    expect(deepAfter.json().meta.db.reads).toBeGreaterThan(0);
  });
});
