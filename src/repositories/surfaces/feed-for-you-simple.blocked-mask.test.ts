import { describe, expect, it, vi } from "vitest";
import { FeedForYouSimpleRepository } from "./feed-for-you-simple.repository.js";

describe("FeedForYouSimpleRepository blockedUsers field mask", () => {
  it("reads blockedUsers via field-masked getAll", async () => {
    const getAll = vi.fn(async (...args: unknown[]) => {
      const maybeOpts = args[args.length - 1] as { fieldMask?: string[] };
      expect(maybeOpts.fieldMask).toEqual(["blockedUsers"]);
      return [
        {
          id: "viewer-1",
          exists: true,
          data: () => ({ blockedUsers: ["blocked-a", "blocked-b"] }),
        },
      ];
    });

    const repo = new FeedForYouSimpleRepository();
    (repo as unknown as { db: unknown }).db = {
      collection: () => ({
        doc: (id: string) => ({ id, path: `users/${id}` }),
      }),
      getAll,
    };

    const result = await repo.loadBlockedAuthorIdsForViewer("viewer-1");
    expect(getAll).toHaveBeenCalledTimes(1);
    expect([...result.blocked].sort()).toEqual(["blocked-a", "blocked-b"]);
    expect(result.readCount).toBe(1);
  });
});
