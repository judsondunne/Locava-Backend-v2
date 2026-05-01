import { describe, expect, it } from "vitest";
import { FeedForYouService } from "./feed-for-you.service.js";
import type { ForYouCandidate } from "../../repositories/surfaces/feed-for-you.repository.js";

class FakeRepo {
  fetchRecentWindowCalls = 0;

  constructor(private readonly posts: ForYouCandidate[]) {}

  async fetchRecentWindow(limit: number): Promise<ForYouCandidate[]> {
    this.fetchRecentWindowCalls += 1;
    return this.posts.slice(0, limit);
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

describe("feed for you service simplified recent-post engine", () => {
  it("serves a page of recent posts with regular-only feedState metadata", async () => {
    const repo = new FakeRepo(
      Array.from({ length: 8 }, (_, idx) =>
        candidate(idx + 1, {
          assets: [
            {
              id: `asset-${idx + 1}`,
              type: idx === 0 ? "video" : "image",
              previewUrl: `https://cdn.locava.test/${idx + 1}/preview.jpg`,
              posterUrl: `https://cdn.locava.test/${idx + 1}/poster.jpg`,
              originalUrl: `https://cdn.locava.test/${idx + 1}/original.jpg`,
              streamUrl: idx === 0 ? `https://cdn.locava.test/${idx + 1}/master.m3u8` : null,
              mp4Url: idx === 0 ? `https://cdn.locava.test/${idx + 1}/main720.mp4` : null,
              blurhash: null,
              width: 720,
              height: 1280,
              aspectRatio: 9 / 16,
              orientation: "portrait",
            },
          ],
          comments: idx === 0 ? [{ commentId: "c1", content: "hi", userName: "Commenter", userPic: "https://cdn.locava.test/u2.jpg" }] : [],
          commentsPreview: idx === 0 ? [{ commentId: "c1", content: "hi", userName: "Commenter", userPic: "https://cdn.locava.test/u2.jpg" }] : [],
          rawPost: { foo: "bar" },
          sourcePost: { foo: "bar" },
        }),
      ),
    );
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-1", limit: 5, cursor: null, debug: true, requestId: "req-1" });

    expect(page.items).toHaveLength(5);
    expect(page.feedState.mode).toBe("regular");
    expect(page.feedState.reelQueueCount).toBe(0);
    expect(page.debug.reelCount).toBe(0);
    expect(page.debug.regularCount).toBe(5);
    expect(page.debug.feedStateWriteOk).toBe(true);
    expect(page.nextCursor).toMatch(/^fq:v2:/);
    const firstItem = page.items[0] as Record<string, unknown>;
    expect(Array.isArray(firstItem.assets)).toBe(true);
    expect(firstItem.hasPlayableVideo).toBe(true);
    expect(firstItem.rawPost).toBeTruthy();
    expect(((firstItem.commentsPreview as Array<Record<string, unknown>>)[0] ?? {}).userName).toBe("Commenter");
  });

  it("uses the cursor offset for the next page without repeating items", async () => {
    const repo = new FakeRepo(Array.from({ length: 12 }, (_, idx) => candidate(idx + 1, { postId: `post-${idx + 1}` })));
    const service = new FeedForYouService(repo as never);

    const first = await service.getForYouPage({ viewerId: "viewer-2", limit: 5, cursor: null, debug: true });
    const second = await service.getForYouPage({ viewerId: "viewer-2", limit: 5, cursor: first.nextCursor, debug: true });

    expect(second.items.some((item) => first.items.some((prev) => prev.postId === item.postId))).toBe(false);
    expect(second.debug.regularQueueIndexBefore).toBe(5);
    expect(second.debug.regularQueueIndexAfter).toBe(10);
  });

  it("caches the recent pool so warm requests do not hit the repository again", async () => {
    const repo = new FakeRepo(Array.from({ length: 10 }, (_, idx) => candidate(idx + 1)));
    const service = new FeedForYouService(repo as never);

    await service.getForYouPage({ viewerId: "viewer-3", limit: 5, cursor: null, debug: true });
    const warm = await service.getForYouPage({ viewerId: "viewer-3", limit: 5, cursor: null, debug: true });

    expect(repo.fetchRecentWindowCalls).toBe(1);
    expect(warm.debug.queueRebuilt).toBe(false);
    expect(warm.debug.regularQueueReadCount).toBe(0);
  });

  it("filters malformed rows and becomes exhausted when no renderable posts remain", async () => {
    const repo = new FakeRepo([
      candidate(1, { postId: "bad-1", posterUrl: "" }),
      candidate(2, { postId: "bad-2", authorId: "" }),
    ]);
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-4", limit: 5, cursor: null, debug: true });

    expect(page.items).toHaveLength(0);
    expect(page.exhausted).toBe(true);
    expect(page.debug.emptyReason).toBe("no_eligible_posts");
  });

  it("encodes the next offset in the cursor", async () => {
    const repo = new FakeRepo(Array.from({ length: 12 }, (_, idx) => candidate(idx + 1)));
    const service = new FeedForYouService(repo as never);

    const page = await service.getForYouPage({ viewerId: "viewer-5", limit: 5, cursor: null, debug: true });
    const decoded = decodeCursor(String(page.nextCursor));

    expect(decoded.regularQueueIndex).toBe(5);
    expect(decoded.reelQueueIndex).toBe(0);
    expect(page.debug.engineVersion).toBe("queue-reels-regular-v2");
  });
});
