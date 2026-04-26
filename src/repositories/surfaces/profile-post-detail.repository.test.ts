import { describe, expect, it } from "vitest";
import { type RequestContext, getRequestContext, runWithRequestContext } from "../../observability/request-context.js";
import { ProfilePostDetailRepository } from "./profile-post-detail.repository.js";

function withRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  const ctx: RequestContext = {
    requestId: "test-request",
    route: "/test",
    method: "GET",
    startNs: 0n,
    payloadBytes: 0,
    dbOps: { reads: 0, writes: 0, queries: 0 },
    cache: { hits: 0, misses: 0 },
    dedupe: { hits: 0, misses: 0 },
    concurrency: { waits: 0 },
    entityCache: { hits: 0, misses: 0 },
    entityConstruction: { total: 0, types: {} },
    idempotency: { hits: 0, misses: 0 },
    invalidation: { keys: 0, entityKeys: 0, routeKeys: 0, types: {} },
    fallbacks: [],
    timeouts: [],
    surfaceTimings: {}
  };
  return runWithRequestContext(ctx, fn);
}

describe("profile post detail repository", () => {
  it("uses firestore adapter when available", async () => {
    const repository = new ProfilePostDetailRepository({
      isEnabled: () => true,
      getPostDetail: async () => ({
        data: {
          postId: "u-1-post-1",
          userId: "u-1",
          createdAtMs: Date.now(),
          mediaType: "image",
          thumbUrl: "https://thumb",
          assets: [{ id: "a1", type: "image" }],
          author: { userId: "u-1", handle: "user_1", name: "User One", profilePic: "https://pic" },
          social: { likeCount: 10, commentCount: 2, viewerHasLiked: false }
        },
        queryCount: 3,
        readCount: 3
      })
    } as never);

    await withRequestContext(async () => {
      const detail = await repository.getPostDetail("u-1", "u-1-post-1", "viewer-1");
      expect(detail.postId).toBe("u-1-post-1");
      const ctx = getRequestContext();
      expect(ctx?.dbOps.queries).toBe(3);
      expect(ctx?.dbOps.reads).toBe(3);
    });
  });

  it("falls back on timeout", async () => {
    const repository = new ProfilePostDetailRepository({
      isEnabled: () => true,
      getPostDetail: async () => {
        throw new Error("profile-post-detail-firestore_timeout");
      },
      markUnavailableBriefly: () => undefined
    } as never);

    await withRequestContext(async () => {
      const detail = await repository.getPostDetail("u-1", "u-1-post-2", "viewer-1");
      expect(detail.postId).toBe("u-1-post-2");
      const ctx = getRequestContext();
      expect(ctx?.fallbacks).toContain("profile_post_detail_firestore_fallback");
      expect(ctx?.timeouts).toContain("profile_post_detail_firestore");
    });
  });
});
