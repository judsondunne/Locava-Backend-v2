import { describe, expect, it } from "vitest";
import { FeedForYouService } from "./feed-for-you.service.js";
import type { ForYouCandidate, ForYouCursorState, ForYouServedWriteRecord } from "../../repositories/surfaces/feed-for-you.repository.js";

class FakeRepo {
  constructor(
    private readonly reels: ForYouCandidate[],
    private readonly regular: ForYouCandidate[]
  ) {}
  servedByViewer = new Map<string, Set<string>>();
  writes = 0;
  async fetchUnservedReelCandidates(_viewerId: string, _limit: number, cursor: ForYouCursorState) {
    const candidates = this.reels.slice(cursor.reelOffset, cursor.reelOffset + 40);
    return { candidates, reads: 10, queries: 1, hasMore: cursor.reelOffset + 40 < this.reels.length };
  }
  async fetchUnservedRegularCandidates(_viewerId: string, _limit: number, cursor: ForYouCursorState) {
    const candidates = this.regular.slice(cursor.regularOffset, cursor.regularOffset + 40);
    return { candidates, reads: 10, queries: 1, hasMore: cursor.regularOffset + 40 < this.regular.length };
  }
  async fetchServedPostIds(viewerId: string, candidatePostIds: string[]) {
    const seen = this.servedByViewer.get(viewerId) ?? new Set<string>();
    return new Set(candidatePostIds.filter((id) => seen.has(id)));
  }
  async writeServedPosts(viewerId: string, servedRecords: ForYouServedWriteRecord[]) {
    const seen = this.servedByViewer.get(viewerId) ?? new Set<string>();
    for (const row of servedRecords) seen.add(row.postId);
    this.servedByViewer.set(viewerId, seen);
    this.writes += servedRecords.length;
    return servedRecords.length;
  }
}

function candidate(idx: number, input: Partial<ForYouCandidate> = {}): ForYouCandidate {
  const id = input.postId ?? `post-${idx}`;
  return {
    postId: id,
    authorId: input.authorId ?? `author-${(idx % 4) + 1}`,
    reel: input.reel ?? idx % 2 === 0,
    createdAtMs: input.createdAtMs ?? Date.now() - idx * 1000,
    updatedAtMs: input.updatedAtMs ?? Date.now() - idx * 1000,
    mediaType: input.mediaType ?? "video",
    posterUrl: input.posterUrl ?? "https://cdn.locava.test/poster.jpg",
    firstAssetUrl: input.firstAssetUrl ?? "https://cdn.locava.test/original.jpg",
    title: input.title ?? `title-${idx}`,
    captionPreview: input.captionPreview ?? `caption-${idx}`,
    authorHandle: input.authorHandle ?? `a${idx}`,
    authorName: input.authorName ?? null,
    authorPic: input.authorPic ?? null,
    activities: input.activities ?? [],
    address: input.address ?? null,
    geo: input.geo ?? { lat: null, long: null, city: null, state: null, country: null, geohash: null },
    assets: input.assets ?? [],
    likeCount: input.likeCount ?? 0,
    commentCount: input.commentCount ?? 0
  };
}

describe("feed for you service", () => {
  it("favors reels, avoids duplicates, persists served, and paginates deterministically", async () => {
    const reels = Array.from({ length: 30 }, (_, i) => candidate(i + 1, { reel: true }));
    const regular = Array.from({ length: 30 }, (_, i) => candidate(200 + i, { reel: false, mediaType: "image" }));
    const repo = new FakeRepo(reels, regular);
    const service = new FeedForYouService(repo as never);

    const first = await service.getForYouPage({ viewerId: "viewer-1", limit: 10, cursor: null, debug: true, requestId: "req-1" });
    expect(first.items.length).toBe(10);
    expect(new Set(first.items.map((item) => item.postId)).size).toBe(10);
    const reelCount = first.items.filter((item) => item.media.type === "video").length;
    expect(reelCount).toBeGreaterThanOrEqual(8);
    expect(first.debug.servedWriteCount).toBe(10);
    expect(first.debug.servedWriteOk).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const second = await service.getForYouPage({
      viewerId: "viewer-1",
      limit: 10,
      cursor: first.nextCursor,
      debug: true,
      requestId: "req-2"
    });
    const overlap = second.items.filter((item) => first.items.some((p) => p.postId === item.postId));
    expect(overlap.length).toBe(0);
    expect(second.debug.cursorInfo.page).toBe(2);
  });

  it("keeps served scope per viewer", async () => {
    const reels = Array.from({ length: 12 }, (_, i) => candidate(i + 1, { reel: true }));
    const regular = Array.from({ length: 12 }, (_, i) => candidate(100 + i, { reel: false }));
    const repo = new FakeRepo(reels, regular);
    const service = new FeedForYouService(repo as never);

    const a = await service.getForYouPage({ viewerId: "viewer-a", limit: 8, cursor: null, debug: true });
    const b = await service.getForYouPage({ viewerId: "viewer-b", limit: 8, cursor: null, debug: true });
    expect(a.items.length).toBeGreaterThan(0);
    expect(b.items.length).toBeGreaterThan(0);
    const overlap = a.items.filter((row) => b.items.some((other) => other.postId === row.postId));
    expect(overlap.length).toBeGreaterThan(0);
  });

  it("falls back to regular then empty state when exhausted", async () => {
    const reels = Array.from({ length: 3 }, (_, i) => candidate(i + 1, { reel: true }));
    const regular = Array.from({ length: 4 }, (_, i) => candidate(100 + i, { reel: false, mediaType: "image" }));
    const repo = new FakeRepo(reels, regular);
    const service = new FeedForYouService(repo as never);

    const first = await service.getForYouPage({ viewerId: "viewer", limit: 6, cursor: null, debug: true });
    expect(first.items.length).toBe(6);
    const second = await service.getForYouPage({ viewerId: "viewer", limit: 6, cursor: first.nextCursor, debug: true });
    expect(second.items.length).toBeGreaterThanOrEqual(0);
    if (second.items.length === 0) {
      expect(second.exhausted).toBe(true);
      expect(second.nextCursor).toBeNull();
    }
  });

  it("keeps author diversity observable in debug metadata", async () => {
    const reels = [
      candidate(1, { authorId: "same", reel: true }),
      candidate(2, { authorId: "same", reel: true }),
      candidate(3, { authorId: "same", reel: true }),
      candidate(4, { authorId: "other-1", reel: true }),
      candidate(5, { authorId: "other-2", reel: true })
    ];
    const repo = new FakeRepo(reels, []);
    const service = new FeedForYouService(repo as never);
    const page = await service.getForYouPage({ viewerId: "viewer", limit: 5, cursor: null, debug: true });
    const uniqueAuthors = new Set(page.items.map((item) => item.author.userId));
    expect(uniqueAuthors.size).toBeGreaterThanOrEqual(3);
    expect(page.debug.returnedCount).toBe(page.items.length);
  });

  it("rejects malformed cursor", async () => {
    const repo = new FakeRepo([], []);
    const service = new FeedForYouService(repo as never);
    await expect(service.getForYouPage({ viewerId: "v", limit: 8, cursor: "bad", debug: true })).rejects.toThrow(
      "invalid_feed_for_you_cursor"
    );
    await expect(service.getForYouPage({ viewerId: "v", limit: 8, cursor: "fy:v2:abc", debug: true })).rejects.toThrow(
      "unsupported_feed_for_you_cursor_version"
    );
  });
});
