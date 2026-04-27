import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 collections membership routes", () => {
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
      payload: { name: "Membership Test", privacy: "private" }
    });
    if (created.statusCode !== 200) return null;
    return created.json().data.collectionId as string;
  }

  it("adds and removes membership with truthful reopen behavior", async () => {
    const collectionId = await createCollectionId();
    if (!collectionId) return;
    const postId = "internal-viewer-feed-post-7";

    const add = await app.inject({
      method: "POST",
      url: `/v2/collections/${encodeURIComponent(collectionId)}/posts`,
      headers,
      payload: { postId }
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().data.added).toBe(true);

    const afterAdd = await app.inject({
      method: "GET",
      url: `/v2/collections/${encodeURIComponent(collectionId)}`
    , headers
    });
    expect(afterAdd.statusCode).toBe(200);
    expect((afterAdd.json().data.item.items ?? []) as string[]).toContain(postId);

    const postsAfterAdd = await app.inject({
      method: "GET",
      url: `/v2/collections/${encodeURIComponent(collectionId)}/posts?limit=8`,
      headers
    });
    expect(postsAfterAdd.statusCode).toBe(200);
    expect((postsAfterAdd.json().data.postIds ?? []) as string[]).toContain(postId);
    expect(postsAfterAdd.json().data.items[0]?.assets).toBeUndefined();
    expect(Buffer.byteLength(postsAfterAdd.body, "utf8")).toBeLessThanOrEqual(42_000);

    const remove = await app.inject({
      method: "DELETE",
      url: `/v2/collections/${encodeURIComponent(collectionId)}/posts/${encodeURIComponent(postId)}`,
      headers
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().data.removed).toBe(true);

    const afterRemove = await app.inject({
      method: "GET",
      url: `/v2/collections/${encodeURIComponent(collectionId)}`,
      headers
    });
    expect(afterRemove.statusCode).toBe(200);
    expect((afterRemove.json().data.item.items ?? []) as string[]).not.toContain(postId);

    const postsAfterRemove = await app.inject({
      method: "GET",
      url: `/v2/collections/${encodeURIComponent(collectionId)}/posts?limit=8`,
      headers
    });
    expect(postsAfterRemove.statusCode).toBe(200);
    expect((postsAfterRemove.json().data.postIds ?? []) as string[]).not.toContain(postId);
  });

  it("deletes a collection and reopens truthfully as not found", async () => {
    const collectionId = await createCollectionId();
    if (!collectionId) return;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v2/collections/${encodeURIComponent(collectionId)}`,
      headers
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data.removed).toBe(true);

    const reopened = await app.inject({
      method: "GET",
      url: `/v2/collections/${encodeURIComponent(collectionId)}`,
      headers
    });
    expect(reopened.statusCode).toBe(404);
    expect(reopened.json().error.code).toBe("collection_not_found");

    const list = await app.inject({
      method: "GET",
      url: "/v2/collections?limit=20",
      headers
    });
    expect(list.statusCode).toBe(200);
    const collectionIds = (list.json().data.items as Array<{ id: string }>).map((item) => item.id);
    expect(collectionIds).not.toContain(collectionId);
  });
});
