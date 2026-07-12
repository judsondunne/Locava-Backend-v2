import { describe, expect, it, vi } from "vitest";
import { SearchHomeV1UsersRepository } from "./search-home-v1-users.repository.js";

describe("SearchHomeV1UsersRepository field mask", () => {
  it("passes a user-summary fieldMask to Firestore getAll", async () => {
    const getAll = vi.fn(async (...args: unknown[]) => {
      const maybeOpts = args[args.length - 1] as { fieldMask?: string[] };
      expect(maybeOpts.fieldMask).toEqual(
        expect.arrayContaining(["postCount", "handle", "profilePic", "followers"]),
      );
      const refs = args.slice(0, -1) as Array<{ id: string }>;
      return refs.map((ref) => ({
        id: ref.id,
        exists: true,
        data: () => ({
          name: "Ada",
          handle: "ada",
          postCount: 3,
          followerCount: 1,
          followingCount: 2,
        }),
      }));
    });

    const repo = new SearchHomeV1UsersRepository();
    (repo as unknown as { db: unknown }).db = {
      collection: () => ({
        doc: (id: string) => ({ id, path: `users/${id}` }),
      }),
      getAll,
    };

    const map = await repo.loadUserSummaries(["u1", "u2"]);
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(map.get("u1")?.postCount).toBe(3);
    expect(map.get("u1")?.name).toBe("Ada");
    expect(map.size).toBe(2);
  });
});
