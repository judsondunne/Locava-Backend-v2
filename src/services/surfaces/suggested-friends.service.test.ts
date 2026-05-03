import { afterEach, describe, expect, it, vi } from "vitest";
import { globalCache } from "../../cache/global-cache.js";
import { resetInFlightDedupeForTests } from "../../cache/in-flight-dedupe.js";
import { SuggestedFriendsService } from "./suggested-friends.service.js";
import type { SuggestedFriendsRepository } from "../../repositories/surfaces/suggested-friends.repository.js";

describe("SuggestedFriendsService", () => {
  afterEach(async () => {
    resetInFlightDedupeForTests();
    await globalCache.clear?.();
    vi.restoreAllMocks();
  });

  it("singleflights duplicate concurrent requests and serves cached result", async () => {
    let calls = 0;
    const repository = {
      async getSuggestionsForUser() {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          users: [
            {
              userId: "user-1",
              handle: "user1",
              name: "User 1",
              profilePic: null,
              reason: "popular" as const,
              isFollowing: false,
              score: 100,
            },
          ],
          sourceBreakdown: { popular: 1 },
          generatedAt: Date.now(),
          etag: "etag-1",
          sourceDiagnostics: [],
        };
      },
    } as Pick<SuggestedFriendsRepository, "getSuggestionsForUser"> as SuggestedFriendsRepository;

    const service = new SuggestedFriendsService(repository);
    const options = {
      limit: 20,
      surface: "generic" as const,
      includeContacts: true,
      includeMutuals: true,
      includePopular: true,
      includeGroups: true,
      includeReferral: true,
      includeAllUsersFallback: true,
      excludeAlreadyFollowing: true,
      excludeBlocked: true,
    };

    const [first, second] = await Promise.all([
      service.getSuggestionsForUser("viewer-1", options),
      service.getSuggestionsForUser("viewer-1", options),
    ]);
    const third = await service.getSuggestionsForUser("viewer-1", options);

    expect(first.users).toHaveLength(1);
    expect(second.users).toHaveLength(1);
    expect(third.users).toHaveLength(1);
    expect(calls).toBe(1);
  });
});
