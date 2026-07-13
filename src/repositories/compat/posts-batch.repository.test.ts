import { describe, expect, it, vi } from "vitest";
import { CompatPostsBatchRepository } from "./posts-batch.repository.js";

describe("CompatPostsBatchRepository.loadPostsByIds", () => {
  it("uses field-masked getAll in chunks of 30 (45 ids → 2 calls; was 5 where-in)", async () => {
    const getAll = vi.fn(async (...args: unknown[]) => {
      const maybeOpts = args[args.length - 1] as { fieldMask?: string[] };
      expect(maybeOpts.fieldMask).toEqual(expect.arrayContaining(["commentCount", "likeCount", "userId"]));
      const refs = args.slice(0, -1) as Array<{ id: string }>;
      return refs.map((ref) => ({
        id: ref.id,
        exists: true,
        data: () => ({
          userId: "u1",
          privacy: "public",
          likeCount: 2,
          commentCount: 1,
        }),
      }));
    });
    const where = vi.fn();

    const repo = new CompatPostsBatchRepository();
    (repo as unknown as { db: unknown }).db = {
      collection: () => ({
        doc: (id: string) => ({ id, path: `posts/${id}` }),
        where,
      }),
      getAll,
    };

    const ids = Array.from({ length: 45 }, (_, i) => `p${i}`);
    const rows = await repo.loadPostsByIds({ postIds: ids });
    expect(getAll).toHaveBeenCalledTimes(2);
    expect(where).not.toHaveBeenCalled();
    expect(rows).toHaveLength(45);
  });
});
