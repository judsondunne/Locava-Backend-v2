import { describe, expect, it } from "vitest";
import { FeedForYouService } from "./feed-for-you.service.js";
import type { ForYouCandidate, ForYouServedWriteRecord } from "../../repositories/surfaces/feed-for-you.repository.js";

class FakeRepo {
  constructor(
    private readonly reels: ForYouCandidate[],
    private readonly regular: ForYouCandidate[]
  ) {}
  servedByViewer = new Map<string, Set<string>>();
  writes = 0;
  async fetchReelWindow(input: { limit: number; cursorPostId: string | null }) {
    const start = input.cursorPostId ? Math.max(this.reels.findIndex((r) => r.postId === input.cursorPostId) + 1, 0) : 0;
    const candidates = this.reels.slice(start, start + input.limit);
    return { candidates, reads: candidates.length, queries: 1, hasMore: start + input.limit < this.reels.length };
  }
  async fetchRegularWindow(input: { limit: number; cursorPostId: string | null }) {
    const start = input.cursorPostId ? Math.max(this.regular.findIndex((r) => r.postId === input.cursorPostId) + 1, 0) : 0;
    const candidates = this.regular.slice(start, start + input.limit);
    return { candidates, reads: candidates.length, queries: 1, hasMore: start + input.limit < this.regular.length };
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
  it("favors reels, writes served records, and paginates without overlap", async () => {
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
    expect(first.debug.rankingVersion).toBe("fast-reel-first-v2");
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

  it("recycles real posts when viewer exhausted instead of empty page", async () => {
    const reels = Array.from({ length: 3 }, (_, i) => candidate(i + 1, { reel: true }));
    const regular = Array.from({ length: 4 }, (_, i) => candidate(100 + i, { reel: false, mediaType: "image" }));
    const repo = new FakeRepo(reels, regular);
    const service = new FeedForYouService(repo as never);

    const first = await service.getForYouPage({ viewerId: "viewer", limit: 6, cursor: null, debug: true });
    expect(first.items.length).toBe(6);
    await service.getForYouPage({ viewerId: "viewer", limit: 6, cursor: first.nextCursor, debug: true });
    const third = await service.getForYouPage({ viewerId: "viewer", limit: 6, cursor: null, debug: true });
    expect(third.items.length).toBeGreaterThan(0);
    expect(third.debug.recycledCount).toBeGreaterThanOrEqual(1);
  });

  it("keeps author diversity observable in returned ordering", async () => {
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
    await expect(service.getForYouPage({ viewerId: "v", limit: 8, cursor: "fy:v9:abc", debug: true })).rejects.toThrow(
      "unsupported_feed_for_you_cursor_version"
    );
  });

  it("accepts legacy fy:v1 cursor without crashing", async () => {
    const repo = new FakeRepo([candidate(1, { reel: true })], [candidate(100, { reel: false })]);
    const service = new FeedForYouService(repo as never);
    const page = await service.getForYouPage({ viewerId: "v", limit: 4, cursor: "fy:v1:eyJwYWdlIjoxfQ", debug: true });
    expect(page.items.length).toBeGreaterThan(0);
  });
});
