import { describe, expect, it } from "vitest";
import { FeedForYouService } from "./feed-for-you.service.js";
import type { FeedForYouState, ForYouCandidate } from "../../repositories/surfaces/feed-for-you.repository.js";

class FakeRepo {
  readonly states = new Map<string, FeedForYouState>();
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

  async fetchEligibleRegularIds(limit: number): Promise<string[]> {
    return this.sortedPosts()
      .filter((row) => row.reel !== true)
      .slice(0, limit)
      .map((row) => row.postId);
  }

  async fetchPostsByIds(postIds: string[]): Promise<ForYouCandidate[]> {
    this.fetchPostsByIdsReads.push(postIds.length);
    const byId = new Map(this.posts.map((row) => [row.postId, row]));
    return postIds.map((id) => byId.get(id)).filter((row): row is ForYouCandidate => Boolean(row));
  }

  private sortedPosts(): ForYouCandidate[] {
    return [...this.posts].sort((a, b) => (a.createdAtMs === b.createdAtMs ? b.postId.localeCompare(a.postId) : b.createdAtMs - a.createdAtMs));
  }
}

function cloneState(state: FeedForYouState): FeedForYouState {
  return {
    ...state,
    reelQueue: [...state.reelQueue],
    regularQueue: [...state.regularQueue]
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
  const payload = cursor.replace(/^fq:v2:/, "");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("feed for you service queue engine v2", () => {
  it("creates feedState if missing and builds reelQueue and regularQueue", async () => {
    const repo = new FakeRepo([
      candidate(1, { reel: true, postId: "reel-1" }),
      candidate(2, { reel: false, mediaType: "image", postId: "regular-1" }),
      candidate(3, { reel: true, postId: "reel-2" }),
      candidate(4, { reel: false, mediaType: "image", postId: "regular-2" })
    ]);
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-1", limit: 5, cursor: null, debug: true, requestId: "req-1" });
    const state = repo.states.get("viewer-1");

    expect(page.debug.feedStateCreated).toBe(true);
    expect(state).toBeTruthy();
    expect(state?.reelQueue.sort()).toEqual(["reel-1", "reel-2"]);
    expect(state?.regularQueue.sort()).toEqual(["regular-1", "regular-2"]);
    expect(state?.reelQueueCount).toBe(2);
    expect(state?.regularQueueCount).toBe(2);
  });

  it("first page serves reels while reels remain", async () => {
    const repo = new FakeRepo(Array.from({ length: 9 }, (_, idx) => candidate(idx + 1, { reel: true, postId: `reel-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-2", limit: 5, cursor: null, debug: true, requestId: "req-2" });
    const state = repo.states.get("viewer-2")!;

    expect(page.items.map((item) => item.postId)).toEqual(state.reelQueue.slice(0, 5));
    expect(page.debug.reelCount).toBe(5);
    expect(page.debug.regularCount).toBe(0);
    expect(page.exhausted).toBe(false);
    expect(page.feedState.remainingReels).toBeGreaterThan(0);
  });

  it("when reels are exhausted it serves regular posts from regularQueue", async () => {
    const repo = new FakeRepo([
      candidate(1, { reel: true, postId: "reel-1" }),
      candidate(2, { reel: false, mediaType: "image", postId: "regular-1" }),
      candidate(3, { reel: false, mediaType: "image", postId: "regular-2" }),
      candidate(4, { reel: false, mediaType: "image", postId: "regular-3" })
    ]);
    const now = Date.now();
    repo.states.set("viewer-3", {
      viewerId: "viewer-3",
      surface: "home_for_you",
      reelQueue: ["reel-1"],
      reelQueueGeneratedAtMs: now,
      reelQueueSourceVersion: "queue-reels-v1",
      reelQueueCount: 1,
      reelQueueIndex: 1,
      regularQueue: ["regular-1", "regular-2", "regular-3"],
      regularQueueGeneratedAtMs: now,
      regularQueueSourceVersion: "queue-reels-regular-v2",
      regularQueueCount: 3,
      regularQueueIndex: 0,
      randomSeed: "viewer-3:seed",
      updatedAtMs: now,
      createdAtMs: now
    });
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-3", limit: 2, cursor: null, debug: true });

    expect(page.items.map((item) => item.postId)).toEqual(["regular-1", "regular-2"]);
    expect(page.debug.reelCount).toBe(0);
    expect(page.debug.regularCount).toBe(2);
    expect(page.debug.recycledRegularCount).toBe(0);
    expect(page.feedState.mode).toBe("regular");
  });

  it("regularQueueIndex advances after serving regular posts", async () => {
    const repo = new FakeRepo([
      candidate(1, { reel: false, mediaType: "image", postId: "regular-1" }),
      candidate(2, { reel: false, mediaType: "image", postId: "regular-2" }),
      candidate(3, { reel: false, mediaType: "image", postId: "regular-3" })
    ]);
    const service = new FeedForYouService(repo as never);

    const first = await service.getForYouPage({ viewerId: "viewer-4", limit: 2, cursor: null, debug: true });

    expect(first.debug.regularQueueIndexAfter).toBeGreaterThan(first.debug.regularQueueIndexBefore);
    expect(repo.states.get("viewer-4")?.regularQueueIndex).toBe(2);
  });

  it("page 2 regular posts differ from page 1 and restart without cursor continues from saved regularQueueIndex", async () => {
    const repo = new FakeRepo(Array.from({ length: 8 }, (_, idx) => candidate(idx + 1, { reel: false, mediaType: "image", postId: `regular-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const first = await service.getForYouPage({ viewerId: "viewer-5", limit: 3, cursor: null, debug: true });
    const second = await service.getForYouPage({ viewerId: "viewer-5", limit: 3, cursor: first.nextCursor, debug: true });
    const restart = await service.getForYouPage({ viewerId: "viewer-5", limit: 2, cursor: null, debug: true });

    expect(second.items.some((item) => first.items.some((prev) => prev.postId === item.postId))).toBe(false);
    expect(restart.items.some((item) => [...first.items, ...second.items].some((prev) => prev.postId === item.postId))).toBe(false);
  });

  it("does not repeat the same 5 regular posts across consecutive pages while regularQueue has enough posts", async () => {
    const repo = new FakeRepo(Array.from({ length: 15 }, (_, idx) => candidate(idx + 1, { reel: false, mediaType: "image", postId: `regular-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const first = await service.getForYouPage({ viewerId: "viewer-6", limit: 5, cursor: null, debug: true });
    const second = await service.getForYouPage({ viewerId: "viewer-6", limit: 5, cursor: first.nextCursor, debug: true });
    const third = await service.getForYouPage({ viewerId: "viewer-6", limit: 5, cursor: second.nextCursor, debug: true });

    expect(first.items.map((item) => item.postId)).not.toEqual(second.items.map((item) => item.postId));
    expect(second.items.map((item) => item.postId)).not.toEqual(third.items.map((item) => item.postId));
    expect(second.debug.regularQueueIndexAfter).toBeGreaterThan(second.debug.regularQueueIndexBefore);
    expect(third.debug.regularQueueIndexAfter).toBeGreaterThan(third.debug.regularQueueIndexBefore);
  });

  it("recycledRegularCount is always 0 and exhausted stays false while regularQueue has remaining posts", async () => {
    const repo = new FakeRepo(Array.from({ length: 6 }, (_, idx) => candidate(idx + 1, { reel: false, mediaType: "image", postId: `regular-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-7", limit: 5, cursor: null, debug: true });

    expect(page.debug.recycledRegularCount).toBe(0);
    expect(page.feedState.remainingRegular).toBeGreaterThan(0);
    expect(page.exhausted).toBe(false);
  });

  it("exhausted becomes true only when both queues are empty and rebuild finds no posts", async () => {
    const repo = new FakeRepo([]);
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-8", limit: 5, cursor: null, debug: true });

    expect(page.items.length).toBe(0);
    expect(page.exhausted).toBe(true);
    expect(page.feedState.remainingReels).toBe(0);
    expect(page.feedState.remainingRegular).toBe(0);
    expect(page.debug.emptyReason).toBe("no_eligible_posts");
  });

  it("warm queue page keeps reads bounded and blocking writes at 1", async () => {
    const repo = new FakeRepo(Array.from({ length: 20 }, (_, idx) => candidate(idx + 1, { reel: false, mediaType: "image", postId: `regular-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    await service.getForYouPage({ viewerId: "viewer-9", limit: 5, cursor: null, debug: true });
    repo.fetchPostsByIdsReads.length = 0;
    repo.feedStateWrites = 0;
    const warm = await service.getForYouPage({ viewerId: "viewer-9", limit: 5, cursor: null, debug: true });

    expect(repo.fetchPostsByIdsReads.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(10);
    expect(repo.feedStateWrites).toBeLessThanOrEqual(1);
    expect(warm.debug.feedStateWriteOk).toBe(true);
    expect(warm.debug.servedWriteCount).toBe(0);
  });

  it("nextCursor exists when returnedCount equals the requested limit and carries regularQueueIndex", async () => {
    const repo = new FakeRepo(Array.from({ length: 12 }, (_, idx) => candidate(idx + 1, { reel: false, mediaType: "image", postId: `regular-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-10", limit: 5, cursor: null, debug: true });
    const decoded = decodeCursor(String(page.nextCursor));

    expect(page.debug.engineVersion).toBe("queue-reels-regular-v2");
    expect(page.items.length).toBe(5);
    expect(page.nextCursor).toMatch(/^fq:v2:/);
    expect(decoded.regularQueueIndex).toBe(page.debug.regularQueueIndexAfter);
  });
});
