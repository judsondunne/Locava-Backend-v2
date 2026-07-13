import { describe, expect, it, vi } from "vitest";
import { FeedRepository } from "./feed.repository.js";

describe("FeedRepository author summary batching", () => {
  it("loads multiple authors with one field-masked getAll", async () => {
    const getAll = vi.fn(async (...args: unknown[]) => {
      const maybeOpts = args[args.length - 1] as { fieldMask?: string[] };
      expect(maybeOpts.fieldMask).toEqual(
        expect.arrayContaining(["handle", "name", "profilePic", "displayName", "photo"]),
      );
      const refs = args.slice(0, -1) as Array<{ id: string }>;
      return refs.map((ref) => ({
        id: ref.id,
        exists: true,
        data: () => ({
          handle: `@${ref.id}`,
          name: `Name ${ref.id}`,
          profilePic: `https://cdn.example.com/${ref.id}.jpg`,
        }),
      }));
    });

    const repo = new FeedRepository({} as never);
    (repo as unknown as { db: unknown }).db = {
      collection: () => ({
        doc: (id: string) => ({ id, path: `users/${id}` }),
      }),
      getAll,
    };

    const summaries = await repo.getAuthorSummariesByUserIds(["a1", "a2", "a1"]);
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ userId: "a1", handle: "a1", name: "Name a1" });
    expect(summaries[1]).toMatchObject({ userId: "a2", handle: "a2" });
  });

  it("parallelizes field-masked getAll across chunks of 30", async () => {
    const getAll = vi.fn(async (...args: unknown[]) => {
      const refs = args.slice(0, -1) as Array<{ id: string }>;
      return refs.map((ref) => ({
        id: ref.id,
        exists: true,
        data: () => ({ handle: ref.id, name: ref.id }),
      }));
    });

    const repo = new FeedRepository({} as never);
    (repo as unknown as { db: unknown }).db = {
      collection: () => ({
        doc: (id: string) => ({ id, path: `users/${id}` }),
      }),
      getAll,
    };

    const ids = Array.from({ length: 35 }, (_, i) => `u${i}`);
    const summaries = await repo.getAuthorSummariesByUserIds(ids);
    expect(getAll).toHaveBeenCalledTimes(2);
    expect(summaries).toHaveLength(35);
  });
});
