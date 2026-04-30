import { describe, expect, it } from "vitest";
import { FeedForYouService } from "./feed-for-you.service.js";
import type {
  FeedForYouState,
  ForYouCandidate,
  ForYouServedWriteRecord
} from "../../repositories/surfaces/feed-for-you.repository.js";

class FakeRepo {
  readonly states = new Map<string, FeedForYouState>();
  readonly servedByViewer = new Map<string, Map<string, ForYouServedWriteRecord>>();
  readonly fetchPostsByIdsReads: number[] = [];
  feedStateWrites = 0;

  constructor(private readonly posts: ForYouCandidate[]) {}

  async getFeedState(viewerId: string): Promise<FeedForYouState | null> {
    const state = this.states.get(viewerId);
    return state ? cloneState(state) : null;
  }

  async saveFeedState(viewerId: string, state: FeedForYouState): Promise<void> {
    this.feedStateWrites += 1;
    this.states.set(viewerId, cloneState(state));
  }

  async fetchEligibleReelIds(limit: number): Promise<string[]> {
    return this.sortedPosts()
      .filter((row) => row.reel === true)
      .slice(0, limit)
      .map((row) => row.postId);
  }

  async fetchPostsByIds(postIds: string[]): Promise<ForYouCandidate[]> {
    this.fetchPostsByIdsReads.push(postIds.length);
    const byId = new Map(this.posts.map((row) => [row.postId, row]));
    return postIds.map((id) => byId.get(id)).filter((row): row is ForYouCandidate => Boolean(row));
  }

  async fetchRecentWindow(limit: number): Promise<ForYouCandidate[]> {
    return this.sortedPosts().slice(0, limit);
  }

  async writeServedPosts(viewerId: string, servedRecords: ForYouServedWriteRecord[]): Promise<number> {
    const served = this.servedByViewer.get(viewerId) ?? new Map<string, ForYouServedWriteRecord>();
    for (const row of servedRecords) served.set(row.postId, row);
    this.servedByViewer.set(viewerId, served);
    return servedRecords.length;
  }

  private sortedPosts(): ForYouCandidate[] {
    return [...this.posts].sort((a, b) => (a.createdAtMs === b.createdAtMs ? b.postId.localeCompare(a.postId) : b.createdAtMs - a.createdAtMs));
  }
}

function cloneState(state: FeedForYouState): FeedForYouState {
  return {
    ...state,
    reelQueue: [...state.reelQueue],
    regularServedRecent: [...state.regularServedRecent]
  };
}

function candidate(idx: number, input: Partial<ForYouCandidate> = {}): ForYouCandidate {
  const createdAtMs = input.createdAtMs ?? 10_000_000 - idx * 1_000;
  return {
    postId: input.postId ?? `post-${idx}`,
    authorId: input.authorId ?? `author-${(idx % 5) + 1}`,
    reel: input.reel ?? true,
    createdAtMs,
    updatedAtMs: input.updatedAtMs ?? createdAtMs,
    mediaType: input.mediaType ?? (input.reel === false ? "image" : "video"),
    posterUrl: input.posterUrl ?? "https://cdn.locava.test/poster.jpg",
    firstAssetUrl: input.firstAssetUrl ?? "https://cdn.locava.test/original.jpg",
    title: input.title ?? `title-${idx}`,
    captionPreview: input.captionPreview ?? `caption-${idx}`,
    authorHandle: input.authorHandle ?? `author.${idx}`,
    authorName: input.authorName ?? null,
    authorPic: input.authorPic ?? null,
    activities: input.activities ?? [],
    address: input.address ?? null,
    geo: input.geo ?? { lat: null, long: null, city: null, state: null, country: null, geohash: null },
    assets: input.assets ?? [],
    comments: input.comments ?? [],
    commentsPreview: input.commentsPreview ?? [],
    carouselFitWidth: input.carouselFitWidth,
    layoutLetterbox: input.layoutLetterbox,
    letterboxGradientTop: input.letterboxGradientTop,
    letterboxGradientBottom: input.letterboxGradientBottom,
    letterboxGradients: input.letterboxGradients,
    likeCount: input.likeCount ?? 0,
    commentCount: input.commentCount ?? 0
  };
}

function decodeCursor(cursor: string): Record<string, unknown> {
  const payload = cursor.replace(/^fq:v1:/, "");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("feed for you service queue engine", () => {
  it("creates feedState if missing and builds reelQueue from reel posts", async () => {
    const repo = new FakeRepo([
      candidate(1, { reel: true, postId: "reel-1" }),
      candidate(2, { reel: false, postId: "regular-1" }),
      candidate(3, { reel: true, postId: "reel-2" })
    ]);
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-1", limit: 5, cursor: null, debug: true, requestId: "req-1" });
    const state = repo.states.get("viewer-1");

    expect(page.debug.feedStateCreated).toBe(true);
    expect(state).toBeTruthy();
    expect(state?.reelQueue.sort()).toEqual(["reel-1", "reel-2"]);
    expect(state?.reelQueueCount).toBe(2);
  });

  it("returns the first page from the saved reelQueue and does not mark exhausted while reels remain", async () => {
    const repo = new FakeRepo(Array.from({ length: 9 }, (_, idx) => candidate(idx + 1, { reel: true, postId: `reel-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-2", limit: 5, cursor: null, debug: true, requestId: "req-2" });
    const state = repo.states.get("viewer-2")!;

    expect(page.items.map((item) => item.postId)).toEqual(state.reelQueue.slice(0, 5));
    expect(page.exhausted).toBe(false);
    expect(page.feedState.remainingReels).toBeGreaterThan(0);
  });

  it("returns the next reel page without repeating posts", async () => {
    const repo = new FakeRepo(Array.from({ length: 12 }, (_, idx) => candidate(idx + 1, { reel: true, postId: `reel-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const first = await service.getForYouPage({ viewerId: "viewer-3", limit: 5, cursor: null, debug: true });
    const second = await service.getForYouPage({ viewerId: "viewer-3", limit: 5, cursor: first.nextCursor, debug: true });

    expect(second.items.map((item) => item.postId)).toEqual(repo.states.get("viewer-3")!.reelQueue.slice(5, 10));
    expect(second.items.some((item) => first.items.some((prev) => prev.postId === item.postId))).toBe(false);
  });

  it("continues from saved reelQueueIndex after restart with no cursor", async () => {
    const repo = new FakeRepo(Array.from({ length: 12 }, (_, idx) => candidate(idx + 1, { reel: true, postId: `reel-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const first = await service.getForYouPage({ viewerId: "viewer-4", limit: 5, cursor: null, debug: true });
    const restart = await service.getForYouPage({ viewerId: "viewer-4", limit: 5, cursor: null, debug: true });

    expect(restart.items.some((item) => first.items.some((prev) => prev.postId === item.postId))).toBe(false);
    expect(repo.states.get("viewer-4")?.reelQueueIndex).toBe(10);
  });

  it("gives different viewers independent reel queues", async () => {
    const repo = new FakeRepo(Array.from({ length: 20 }, (_, idx) => candidate(idx + 1, { reel: true, postId: `reel-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    await service.getForYouPage({ viewerId: "viewer-a", limit: 5, cursor: null, debug: true });
    await service.getForYouPage({ viewerId: "viewer-b", limit: 5, cursor: null, debug: true });

    expect(repo.states.get("viewer-a")?.reelQueue).not.toEqual(repo.states.get("viewer-b")?.reelQueue);
  });

  it("fills with regular posts when reels are exhausted and does not return empty while regulars exist", async () => {
    const repo = new FakeRepo([
      candidate(1, { reel: true, postId: "reel-1" }),
      candidate(2, { reel: true, postId: "reel-2" }),
      candidate(3, { reel: false, mediaType: "image", postId: "regular-1" }),
      candidate(4, { reel: false, mediaType: "image", postId: "regular-2" }),
      candidate(5, { reel: false, mediaType: "image", postId: "regular-3" })
    ]);
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-5", limit: 5, cursor: null, debug: true });

    expect(page.items.length).toBe(5);
    expect(page.debug.reelCount).toBe(2);
    expect(page.debug.regularCount).toBe(3);
    expect(page.feedState.mode).toBe("mixed");
  });

  it("regularServedRecent prevents immediate regular repeats after reels", async () => {
    const repo = new FakeRepo([
      candidate(1, { reel: true, postId: "reel-1" }),
      candidate(2, { reel: true, postId: "reel-2" }),
      candidate(3, { reel: false, mediaType: "image", postId: "regular-1" }),
      candidate(4, { reel: false, mediaType: "image", postId: "regular-2" }),
      candidate(5, { reel: false, mediaType: "image", postId: "regular-3" }),
      candidate(6, { reel: false, mediaType: "image", postId: "regular-4" })
    ]);
    const service = new FeedForYouService(repo as never);

    await service.getForYouPage({ viewerId: "viewer-6", limit: 2, cursor: null, debug: true });
    const regularFirst = await service.getForYouPage({ viewerId: "viewer-6", limit: 2, cursor: null, debug: true });
    const regularSecond = await service.getForYouPage({ viewerId: "viewer-6", limit: 2, cursor: null, debug: true });

    expect(regularSecond.items.some((item) => regularFirst.items.some((prev) => prev.postId === item.postId))).toBe(false);
  });

  it("allows recycled real regular posts when recent regulars were already served", async () => {
    const repo = new FakeRepo([
      candidate(1, { reel: false, mediaType: "image", postId: "regular-1" }),
      candidate(2, { reel: false, mediaType: "image", postId: "regular-2" })
    ]);
    const service = new FeedForYouService(repo as never);

    const first = await service.getForYouPage({ viewerId: "viewer-7", limit: 2, cursor: null, debug: true });
    const second = await service.getForYouPage({ viewerId: "viewer-7", limit: 2, cursor: null, debug: true });

    expect(first.items.length).toBe(2);
    expect(second.items.length).toBe(2);
    expect(second.debug.recycledRegularCount).toBe(2);
  });

  it("always reports queue-reels-v1 and never includes ranking or recycle cursor modes", async () => {
    const repo = new FakeRepo(Array.from({ length: 8 }, (_, idx) => candidate(idx + 1, { reel: true, postId: `reel-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-8", limit: 5, cursor: null, debug: true });
    const decoded = decodeCursor(String(page.nextCursor));

    expect(page.debug.engineVersion).toBe("queue-reels-v1");
    expect((page.debug as Record<string, unknown>).rankingVersion).toBeUndefined();
    expect(String(page.nextCursor ?? "")).toMatch(/^fq:v1:/);
    expect(decoded.mode).toBe("reels");
    expect(JSON.stringify(decoded)).not.toContain("recycleMode");
  });

  it("keeps reel reads bounded for limit 5", async () => {
    const repo = new FakeRepo(Array.from({ length: 30 }, (_, idx) => candidate(idx + 1, { reel: true, postId: `reel-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-9", limit: 5, cursor: null, debug: true });

    expect(page.debug.reelQueueReadCount).toBeLessThanOrEqual(15);
    expect(repo.fetchPostsByIdsReads.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(15);
  });

  it("writes feedState progress and served docs for returned items", async () => {
    const repo = new FakeRepo(Array.from({ length: 6 }, (_, idx) => candidate(idx + 1, { reel: true, postId: `reel-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-10", limit: 5, cursor: null, debug: true, requestId: "req-10" });
    const state = repo.states.get("viewer-10");
    const served = repo.servedByViewer.get("viewer-10");

    expect(repo.feedStateWrites).toBeGreaterThan(0);
    expect(state?.reelQueueIndex).toBe(5);
    expect(page.debug.feedStateWriteOk).toBe(true);
    expect(page.debug.servedWriteCount).toBe(5);
    expect(served?.size).toBe(5);
  });
});
