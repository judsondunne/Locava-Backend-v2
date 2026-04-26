import { describe, expect, it } from "vitest";
import { type RequestContext, getRequestContext, runWithRequestContext } from "../../observability/request-context.js";
import { ProfileRepository } from "./profile.repository.js";

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

describe("profile repository", () => {
  it("uses firestore adapter when available", async () => {
    const repository = new ProfileRepository({
      isEnabled: () => true,
      getProfileHeader: async () => ({
        data: {
          userId: "u-1",
          handle: "user_1",
          name: "User One",
          profilePic: "https://pic",
          counts: { posts: 10, followers: 20, following: 5 }
        },
        queryCount: 1,
        readCount: 1
      }),
      getRelationship: async () => ({
        data: { isSelf: false, following: true, followedBy: false, canMessage: true },
        queryCount: 2,
        readCount: 2
      }),
      getGridPreview: async () => ({
        items: [{ postId: "u-1-post-1", thumbUrl: "https://thumb", mediaType: "image", updatedAtMs: Date.now() }],
        nextCursor: "cursor:1",
        queryCount: 1,
        readCount: 1
      })
    } as never);

    await withRequestContext(async () => {
      const header = await repository.getProfileHeader("u-1");
      const relationship = await repository.getRelationship("viewer-1", "u-1");
      const preview = await repository.getGridPreview("u-1", 12);
      expect(header.userId).toBe("u-1");
      expect(relationship.following).toBe(true);
      expect(preview.items.length).toBe(1);
      const ctx = getRequestContext();
      expect(ctx?.dbOps.queries).toBe(4);
      expect(ctx?.dbOps.reads).toBe(4);
    });
  });

  it("falls back on timeout/failure", async () => {
    const repository = new ProfileRepository({
      isEnabled: () => true,
      getProfileHeader: async () => {
        throw new Error("profile-firestore-header_timeout");
      },
      getRelationship: async () => {
        throw new Error("profile-firestore-relationship_timeout");
      },
      getGridPreview: async () => {
        throw new Error("profile-firestore-grid-preview_timeout");
      },
      markUnavailableBriefly: () => undefined
    } as never);

    await withRequestContext(async () => {
      const header = await repository.getProfileHeader("u-2");
      const preview = await repository.getGridPreview("u-2", 6);
      expect(header.userId).toBe("u-2");
      expect(preview.items.length).toBeGreaterThan(0);
      const ctx = getRequestContext();
      expect(ctx?.fallbacks).toContain("profile_header_firestore_fallback");
      expect(ctx?.fallbacks).toContain("profile_grid_preview_firestore_fallback");
      expect(ctx?.timeouts).toContain("profile_header_firestore");
    });
  });
});
