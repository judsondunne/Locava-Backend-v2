import { describe, expect, it, vi } from "vitest";
import { FeedForYouService } from "./feed-for-you.service.js";
import type { ForYouCandidate } from "../../repositories/surfaces/feed-for-you.repository.js";

class FakeRepo {
  fetchRecentWindowCalls = 0;
  fetchFallbackWindowCalls = 0;
  private readonly recentLoader: (limit: number) => Promise<ForYouCandidate[]>;
  private readonly fallbackLoader: (limit: number) => Promise<ForYouCandidate[]>;

  constructor(input: {
    recent?: ForYouCandidate[];
    fallback?: ForYouCandidate[];
    recentLoader?: (limit: number) => Promise<ForYouCandidate[]>;
    fallbackLoader?: (limit: number) => Promise<ForYouCandidate[]>;
  }) {
    this.recentLoader =
      input.recentLoader ??
      (async (limit: number) => (input.recent ?? []).slice(0, limit));
    this.fallbackLoader =
      input.fallbackLoader ??
      (async (limit: number) => (input.fallback ?? input.recent ?? []).slice(0, limit));
  }

  async fetchRecentWindow(limit: number): Promise<ForYouCandidate[]> {
    this.fetchRecentWindowCalls += 1;
    return this.recentLoader(limit);
  }

  async fetchFallbackWindow(limit: number): Promise<ForYouCandidate[]> {
    this.fetchFallbackWindowCalls += 1;
    return this.fallbackLoader(limit);
  }
}

function candidate(idx: number, input: Partial<ForYouCandidate> = {}): ForYouCandidate {
  const createdAtMs = input.createdAtMs ?? 10_000_000 - idx * 1_000;
  return {
    postId: input.postId ?? `post-${idx}`,
    authorId: input.authorId ?? `author-${(idx % 5) + 1}`,
    reel: input.reel ?? false,
    createdAtMs,
    updatedAtMs: input.updatedAtMs ?? createdAtMs,
    mediaType: input.mediaType ?? "image",
    posterUrl: input.posterUrl ?? `https://cdn.locava.test/${idx}/poster.jpg`,
    firstAssetUrl: input.firstAssetUrl ?? `https://cdn.locava.test/${idx}/original.jpg`,
    title: input.title ?? `Title ${idx}`,
    captionPreview: input.captionPreview ?? `Caption preview ${idx}`,
    authorHandle: input.authorHandle ?? `author.${idx}`,
    authorName: input.authorName ?? `Author ${idx}`,
    authorPic: input.authorPic ?? `https://cdn.locava.test/u/${idx}.jpg`,
    activities: input.activities ?? ["waterfall", "hiking"],
    address: input.address ?? "Skamania County, Washington",
    geo:
      input.geo ?? {
        lat: 45.7261286,
        long: -121.6335058,
        city: "Skamania County",
        state: "Washington",
        country: "United States",
        geohash: "c21s0hjnj",
      },
    assets:
      input.assets ?? [
        {
          id: `asset-${idx}`,
          type: input.mediaType === "video" ? "video" : "image",
          previewUrl: `https://cdn.locava.test/${idx}/preview.jpg`,
          posterUrl: `https://cdn.locava.test/${idx}/poster.jpg`,
          originalUrl: `https://cdn.locava.test/${idx}/original.jpg`,
          streamUrl: input.mediaType === "video" ? `https://cdn.locava.test/${idx}/master.m3u8` : null,
          mp4Url: input.mediaType === "video" ? `https://cdn.locava.test/${idx}/main720.mp4` : null,
          blurhash: null,
          width: 720,
          height: 1280,
          aspectRatio: 9 / 16,
          orientation: "portrait",
        },
      ],
    carouselFitWidth: input.carouselFitWidth,
    layoutLetterbox: input.layoutLetterbox,
    letterboxGradientTop: input.letterboxGradientTop,
    letterboxGradientBottom: input.letterboxGradientBottom,
    letterboxGradients: input.letterboxGradients,
    likeCount: input.likeCount ?? 12,
    commentCount: input.commentCount ?? 3,
  };
}

function decodeCursor(cursor: string): Record<string, unknown> {
  const payload = cursor.replace(/^fq:v2:/, "");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("feed for you service compact random-feed engine", () => {
  it("does not block the first request on recent-pool warmup and uses a bounded fallback window", async () => {
    let resolveRecent: ((rows: ForYouCandidate[]) => void) | null = null;
    let recentResolved = false;
    const repo = new FakeRepo({
      recentLoader: (limit) =>
        new Promise<ForYouCandidate[]>((resolve) => {
          resolveRecent = (rows) => {
            recentResolved = true;
            resolve(rows.slice(0, limit));
          };
        }),
      fallback: Array.from({ length: 6 }, (_, idx) => candidate(idx + 1)),
    });
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({
      viewerId: "viewer-cold",
      limit: 5,
      cursor: null,
      debug: true,
      requestId: "req-cold",
    });

    expect(page.items).toHaveLength(5);
    expect(page.debug.poolState).toBe("cold_fallback");
    expect(page.debug.regularQueueReadCount).toBeLessThanOrEqual(12);
    expect(repo.fetchRecentWindowCalls).toBe(1);
    expect(repo.fetchFallbackWindowCalls).toBe(1);
    expect(recentResolved).toBe(false);

    const releaseRecent = resolveRecent as ((rows: ForYouCandidate[]) => void) | null;
    if (releaseRecent) {
      releaseRecent(Array.from({ length: 10 }, (_, idx) => candidate(idx + 11)));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recentResolved).toBe(true);
  });

  it("serves warm pages from the in-memory pool with zero request-time reads", async () => {
    const repo = new FakeRepo({
      recent: Array.from({ length: 10 }, (_, idx) => candidate(idx + 1)),
      fallback: Array.from({ length: 10 }, (_, idx) => candidate(idx + 1)),
    });
    const service = new FeedForYouService(repo as never);

    await service.getForYouPage({ viewerId: "viewer-warmup", limit: 5, cursor: null, debug: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const warm = await service.getForYouPage({ viewerId: "viewer-warmup", limit: 5, cursor: null, debug: true });

    expect(repo.fetchRecentWindowCalls).toBe(1);
    expect(repo.fetchFallbackWindowCalls).toBe(1);
    expect(warm.debug.poolState).toBe("warm");
    expect(warm.debug.queueRebuilt).toBe(false);
    expect(warm.debug.regularQueueReadCount).toBe(0);
    expect(Buffer.byteLength(JSON.stringify(warm), "utf8")).toBeLessThan(35_000);
    expect(Buffer.byteLength(JSON.stringify(warm.items), "utf8")).toBeLessThan(28_000);
  });

  it("keeps cursor pagination payloads under budget and avoids duplicate items", async () => {
    const repo = new FakeRepo({
      recent: Array.from({ length: 12 }, (_, idx) =>
        candidate(idx + 1, {
          postId: `post-${idx + 1}`,
          captionPreview: `Compact caption ${idx + 1}`.repeat(3),
        }),
      ),
      fallback: Array.from({ length: 12 }, (_, idx) => candidate(idx + 1, { postId: `post-${idx + 1}` })),
    });
    const service = new FeedForYouService(repo as never);

    await service.getForYouPage({ viewerId: "viewer-pages", limit: 5, cursor: null, debug: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const first = await service.getForYouPage({ viewerId: "viewer-pages", limit: 5, cursor: null, debug: true });
    const second = await service.getForYouPage({
      viewerId: "viewer-pages",
      limit: 5,
      cursor: first.nextCursor,
      debug: true,
    });

    expect(second.items.some((item) => first.items.some((prev) => prev.postId === item.postId))).toBe(false);
    expect(second.debug.regularQueueIndexBefore).toBe(5);
    expect(second.debug.regularQueueIndexAfter).toBe(10);
    expect(Buffer.byteLength(JSON.stringify(second), "utf8")).toBeLessThan(35_000);

    const decoded = decodeCursor(String(first.nextCursor));
    expect(decoded.regularQueueIndex).toBe(5);
    expect(decoded.reelQueueIndex).toBe(0);
  });

  it("filters malformed rows and stays JSON-safe when no renderable posts remain", async () => {
    const repo = new FakeRepo({
      recent: [],
      fallback: [
        candidate(1, { postId: "bad-1", posterUrl: "" }),
        candidate(2, { postId: "bad-2", authorId: "" }),
      ],
    });
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-empty", limit: 5, cursor: null, debug: true });

    expect(page.items).toHaveLength(0);
    expect(page.exhausted).toBe(true);
    expect(page.debug.emptyReason).toBe("no_eligible_posts");
    expect(() => JSON.parse(JSON.stringify(page))).not.toThrow();
  });
});
