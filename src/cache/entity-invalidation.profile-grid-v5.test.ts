import { describe, expect, it, vi } from "vitest";
import { buildCacheKey } from "./types.js";
import { invalidateEntitiesForMutation } from "./entity-invalidation.js";
import { globalCache } from "./global-cache.js";

describe("entity invalidation profile-grid-page-v5", () => {
  it("deletes profile-grid-page-v5 keys on post.delete", async () => {
    const deleted: string[] = [];
    const delSpy = vi.spyOn(globalCache, "del").mockImplementation(async (key: string) => {
      deleted.push(key);
    });

    try {
      const result = await invalidateEntitiesForMutation({
        mutationType: "post.delete",
        postId: "owner-1-post-abc",
        viewerId: "owner-1",
      });

      const expectedV5 = buildCacheKey("list", ["profile-grid-page-v5", "owner-1", "owner-1", "start", "12"]);
      expect(deleted).toContain(expectedV5);
      expect(result.invalidatedKeys).toContain(expectedV5);
      expect(result.invalidationTypes).toContain("profile.grid_page");
    } finally {
      delSpy.mockRestore();
    }
  });

  it("deletes profile-grid-page-v5 keys on posting.complete", async () => {
    const deleted: string[] = [];
    const delSpy = vi.spyOn(globalCache, "del").mockImplementation(async (key: string) => {
      deleted.push(key);
    });

    try {
      const result = await invalidateEntitiesForMutation({
        mutationType: "posting.complete",
        postId: "owner-2-post-xyz",
        viewerId: "owner-2",
      });

      const expectedV5 = buildCacheKey("list", ["profile-grid-page-v5", "owner-2", "owner-2", "start", "24"]);
      expect(deleted).toContain(expectedV5);
      expect(result.invalidatedKeys).toContain(expectedV5);
    } finally {
      delSpy.mockRestore();
    }
  });
});
