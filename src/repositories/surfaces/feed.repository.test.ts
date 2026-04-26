import { describe, expect, it } from "vitest";
import { type RequestContext, getRequestContext, runWithRequestContext } from "../../observability/request-context.js";
import { FeedRepository } from "./feed.repository.js";

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

describe("feed repository", () => {
  it("uses firestore adapter candidates for bootstrap/page when available", async () => {
    const repository = new FeedRepository({
      isEnabled: () => true,
      getFeedCandidatesPage: async ({ cursorOffset, limit }: { cursorOffset: number; limit: number }) => ({
        items: Array.from({ length: limit }).map((_, idx) => {
          const slot = cursorOffset + idx + 3;
          return {
            postId: `firestore-post-${slot}`,
            authorId: `firestore-author-${slot}`,
            slot,
            updatedAtMs: 1_700_000_000_000 + idx
          };
        }),
        hasMore: true,
        nextCursor: `cursor:${cursorOffset + limit}`,
        queryCount: 1,
        readCount: 12
      })
    } as never);

    await withRequestContext(async () => {
      const bootstrap = await repository.getBootstrapCandidates("internal-viewer", 5);
      const page = await repository.getFeedPage("internal-viewer", "cursor:5", 5);
      expect(bootstrap[0]?.postId).toBe("firestore-post-3");
      expect(page.items[0]?.postId).toBe("firestore-post-8");
      expect(page.nextCursor).toMatch(/^fc:v1:/);
      const ctx = getRequestContext();
      expect(ctx?.dbOps.queries).toBe(2);
      expect(ctx?.dbOps.reads).toBe(24);
    });
  });

  it("falls back to deterministic feed candidates on firestore timeout/failure", async () => {
    const repository = new FeedRepository({
      isEnabled: () => true,
      getFeedCandidatesPage: async () => {
        throw new Error("feed-firestore-candidates-query_timeout");
      }
    } as never);

    await withRequestContext(async () => {
      const bootstrap = await repository.getBootstrapCandidates("internal-viewer", 5);
      const page = await repository.getFeedPage("internal-viewer", null, 5);
      expect(bootstrap.length).toBeGreaterThan(0);
      expect(page.items.length).toBeGreaterThan(0);
      const ctx = getRequestContext();
      expect(ctx?.fallbacks).toContain("feed_candidates_firestore_fallback");
      expect(ctx?.fallbacks).toContain("feed_page_firestore_fallback");
      expect(ctx?.timeouts).toContain("feed_candidates_firestore");
      expect(ctx?.timeouts).toContain("feed_page_firestore");
      expect(ctx?.dbOps.queries).toBe(2);
    });
  });

  it("uses feed detail firestore adapter for post detail/social/viewer/author bundle", async () => {
    const repository = new FeedRepository(
      {
        isEnabled: () => false
      } as never,
      {
        isEnabled: () => true,
        getFeedDetailBundle: async () => ({
          post: {
            postId: "internal-viewer-feed-post-6",
            userId: "source-user-1",
            caption: "Real caption",
            createdAtMs: 1_700_000_000_111,
            updatedAtMs: 1_700_000_000_222,
            mediaType: "image",
            thumbUrl: "https://example.com/thumb.jpg",
            assets: [
              {
                id: "a1",
                type: "image",
                poster: "https://example.com/thumb.jpg",
                thumbnail: "https://example.com/thumb.jpg"
              }
            ]
          },
          author: {
            userId: "source-user-1",
            handle: "source_user",
            name: "Source User",
            pic: "https://example.com/u.jpg"
          },
          social: {
            likeCount: 11,
            commentCount: 4
          },
          viewer: {
            liked: true,
            saved: true
          },
          queryCount: 4,
          readCount: 4
        })
      } as never
    );

    await withRequestContext(async () => {
      const detail = await repository.getPostDetail("internal-viewer-feed-post-6", "internal-viewer");
      const author = await repository.getAuthorSummary("source-user-1", "internal-viewer-feed-post-6");
      const social = await repository.getSocialSummary("internal-viewer-feed-post-6");
      const viewer = await repository.getViewerPostState("internal-viewer", "internal-viewer-feed-post-6");
      expect(detail.userId).toBe("source-user-1");
      expect(author.handle).toBe("source_user");
      expect(social.commentCount).toBe(4);
      expect(viewer.liked).toBe(true);
      const ctx = getRequestContext();
      expect((ctx?.dbOps.queries ?? 0) >= 4).toBe(true);
      expect((ctx?.dbOps.reads ?? 0) >= 4).toBe(true);
    });
  });

  it("falls back on feed detail firestore timeout", async () => {
    const repository = new FeedRepository(
      {
        isEnabled: () => false
      } as never,
      {
        isEnabled: () => true,
        markUnavailableBriefly: () => undefined,
        getFeedDetailBundle: async () => {
          throw new Error("feed-detail-firestore-post_timeout");
        }
      } as never
    );

    await withRequestContext(async () => {
      const detail = await repository.getPostDetail("internal-viewer-feed-post-6", "internal-viewer");
      expect(detail.postId).toBe("internal-viewer-feed-post-6");
      const ctx = getRequestContext();
      expect(ctx?.fallbacks).toContain("feed_detail_firestore_fallback");
      expect(ctx?.timeouts).toContain("feed_detail_firestore");
    });
  });

  it("supports non-feed post ids in degraded post detail", async () => {
    const repository = new FeedRepository({
      isEnabled: () => false
    } as never);

    await withRequestContext(async () => {
      const summary = await repository.getPostCardSummary("internal-viewer", "aXngoh9jeqW35FNM3fq1w9aXdEh1-post-7");
      const detail = await repository.getPostDetail("aXngoh9jeqW35FNM3fq1w9aXdEh1-post-7", "internal-viewer");
      expect(summary.postId).toBe("aXngoh9jeqW35FNM3fq1w9aXdEh1-post-7");
      expect(detail.postId).toBe("aXngoh9jeqW35FNM3fq1w9aXdEh1-post-7");
      expect(detail.assets.length).toBeGreaterThan(0);
    });
  });
});
