import { describe, expect, it, vi } from "vitest";
import { FeedForYouSimpleRepository } from "./feed-for-you-simple.repository.js";

describe("FeedForYouSimpleRepository.fetchCandidatesByPostIds field mask", () => {
  it("uses SIMPLE_FEED fieldMask and chunks getAll at 30 (numerical: 45 ids → 2 getAll)", async () => {
    const getAll = vi.fn(async (...args: unknown[]) => {
      const maybeOpts = args[args.length - 1] as { fieldMask?: string[] };
      expect(maybeOpts.fieldMask).toEqual(expect.arrayContaining(["userId", "thumbUrl", "mediaType", "likeCount"]));
      const refs = args.slice(0, -1) as Array<{ id: string }>;
      return refs.map((ref) => ({
        id: ref.id,
        exists: true,
        data: () => ({
          userId: "author-1",
          thumbUrl: "https://cdn.example.com/t.jpg",
          displayPhotoLink: "https://cdn.example.com/t.jpg",
          mediaType: "image",
          likeCount: 1,
          visibility: "public",
          time: Date.now(),
        }),
      }));
    });

    const repo = new FeedForYouSimpleRepository();
    (repo as unknown as { db: unknown }).db = {
      collection: () => ({
        doc: (id: string) => ({ id, path: `posts/${id}` }),
      }),
      getAll,
    };
    (repo as unknown as { hydrateCandidateLikeCountsFromLikesSubcollection: (items: unknown[]) => Promise<void> })
      .hydrateCandidateLikeCountsFromLikesSubcollection = async () => undefined;

    const ids = Array.from({ length: 45 }, (_, i) => `p${i}`);
    const list = await repo.fetchCandidatesByPostIds(ids);
    expect(getAll).toHaveBeenCalledTimes(2);
    expect(list.length).toBeGreaterThan(0);
  });
});
