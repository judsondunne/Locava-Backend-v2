import { describe, expect, it, vi } from "vitest";
import { mixesRepository } from "../../repositories/mixes/mixes.repository.js";
import { SearchHomeV1Service } from "./search-home-v1.service.js";

describe("search home v1 service", () => {
  it("serves mix previews from snapshot-backed rows while the mix pool is warming", async () => {
    const service = new SearchHomeV1Service() as any;
    service.suggested = {
      getSuggestionsForUser: vi.fn(async () => ({
        users: [],
        sourceBreakdown: {},
        generatedAt: Date.now(),
        sourceDiagnostics: [],
      })),
    };
    service.usersRepo = {
      loadUserSummaries: vi.fn(async () => new Map()),
    };
    service.postsRepo = {
      listRecentPostsByUserId: vi.fn(async () => []),
    };
    service.searchMixes = {
      bootstrap: vi.fn(async () => ({
        mixes: [
          {
            mixId: "activity:hiking",
            title: "Hiking",
            coverMedia: "https://cdn.example.com/cover.jpg",
            previewPostIds: ["p1", "p2"],
            definition: { kind: "activity", activity: "hiking" },
            poolState: "warming",
          },
        ],
      })),
    };
    const poolPosts = [
      {
        postId: "p1",
        mediaType: "video",
        activities: ["hiking"],
        title: "Morning Trail",
        address: "Bend",
        time: 1_700_000_000_000,
        thumbUrl: "https://cdn.example.com/p1.jpg",
      },
      {
        postId: "p2",
        mediaType: "photo",
        activities: ["hiking"],
        title: "Summit",
        address: "Hood River",
        time: 1_700_000_000_100,
        thumbUrl: "https://cdn.example.com/p2.jpg",
      },
    ];
    const warmWaitSpy = vi.spyOn(mixesRepository, "listFromPoolWithWarmWait").mockResolvedValue({
      posts: poolPosts as never,
      readCount: 0,
      source: "test",
      poolLimit: 600,
      poolState: "warming",
      poolBuiltAt: null,
      poolBuildLatencyMs: 0,
      poolBuildReadCount: 0,
      servedStale: false,
      servedEmptyWarming: true,
    });

    let result: Awaited<ReturnType<SearchHomeV1Service["build"]>>;
    try {
      result = await service.build("viewer-a");
    } finally {
      warmWaitSpy.mockRestore();
    }

    expect(result.activityMixes).toHaveLength(1);
    expect(result.activityMixes[0]?.activityKey).toBe("hiking");
    expect(result.activityMixes[0]?.posts).toHaveLength(2);
    expect(result.activityMixes[0]?.posts[0]?.id).toBe("p1");
    expect(result.diagnostics.activityMixCount).toBe(1);
    expect(result.diagnostics.postsPerMix).toEqual([2]);
  });

  it("skips firstPost Firestore probes when suggested user postCount is 0", async () => {
    const listRecentPostsByUserId = vi.fn(async () => [{ postId: "should-not-load" }]);
    const service = new SearchHomeV1Service() as any;
    service.suggested = {
      getSuggestionsForUser: vi.fn(async () => ({
        users: [
          { userId: "u-empty", isFollowing: false, reason: "suggested" },
          { userId: "u-with-posts", isFollowing: false, reason: "suggested" },
        ],
        sourceBreakdown: {},
        generatedAt: Date.now(),
        sourceDiagnostics: [],
      })),
    };
    service.usersRepo = {
      loadUserSummaries: vi.fn(async () =>
        new Map([
          [
            "u-empty",
            {
              userId: "u-empty",
              handle: "empty",
              name: "Empty",
              profilePic: null,
              bio: null,
              followerCount: 0,
              followingCount: 0,
              postCount: 0,
            },
          ],
          [
            "u-with-posts",
            {
              userId: "u-with-posts",
              handle: "poster",
              name: "Poster",
              profilePic: null,
              bio: null,
              followerCount: 1,
              followingCount: 1,
              postCount: 3,
            },
          ],
        ]),
      ),
    };
    service.postsRepo = { listRecentPostsByUserId };
    service.searchMixes = {
      bootstrap: vi.fn(async () => ({ mixes: [] })),
    };
    const warmWaitSpy = vi.spyOn(mixesRepository, "listFromPoolWithWarmWait").mockResolvedValue({
      posts: [] as never,
      readCount: 0,
      source: "test",
      poolLimit: 600,
      poolState: "warm",
      poolBuiltAt: new Date().toISOString(),
      poolBuildLatencyMs: 0,
      poolBuildReadCount: 0,
      servedStale: false,
      servedEmptyWarming: false,
    });

    try {
      const result = await service.build("viewer-a");
      expect(listRecentPostsByUserId).toHaveBeenCalledTimes(1);
      expect(listRecentPostsByUserId).toHaveBeenCalledWith("u-with-posts", 1);
      expect(result.suggestedUsers.find((u: { user: { userId: string } }) => u.user.userId === "u-empty")?.firstPost).toBeNull();
    } finally {
      warmWaitSpy.mockRestore();
    }
  });

  it("starts mix bootstrap in parallel with suggested friends (does not wait for suggestions first)", async () => {
    let suggestionsStarted = false;
    let mixStartedBeforeSuggestionsResolved = false;
    let resolveSuggestions: ((value: unknown) => void) | null = null;

    const service = new SearchHomeV1Service() as any;
    service.suggested = {
      getSuggestionsForUser: vi.fn(
        () =>
          new Promise((resolve) => {
            suggestionsStarted = true;
            resolveSuggestions = resolve;
          }),
      ),
    };
    service.usersRepo = {
      loadUserSummaries: vi.fn(async () => new Map()),
    };
    service.postsRepo = {
      listRecentPostsByUserId: vi.fn(async () => []),
    };
    service.searchMixes = {
      bootstrap: vi.fn(async () => {
        if (suggestionsStarted && resolveSuggestions) {
          mixStartedBeforeSuggestionsResolved = true;
        }
        return { mixes: [] };
      }),
    };
    const warmWaitSpy = vi.spyOn(mixesRepository, "listFromPoolWithWarmWait").mockResolvedValue({
      posts: [] as never,
      readCount: 0,
      source: "test",
      poolLimit: 600,
      poolState: "warm",
      poolBuiltAt: new Date().toISOString(),
      poolBuildLatencyMs: 0,
      poolBuildReadCount: 0,
      servedStale: false,
      servedEmptyWarming: false,
    });

    try {
      const pending = service.build("viewer-parallel");
      // Allow microtasks so Promise.all kicks off all branches.
      await Promise.resolve();
      await Promise.resolve();
      expect(service.searchMixes.bootstrap).toHaveBeenCalled();
      expect(mixStartedBeforeSuggestionsResolved).toBe(true);
      resolveSuggestions?.({
        users: [],
        sourceBreakdown: {},
        generatedAt: Date.now(),
        sourceDiagnostics: [],
      });
      const result = await pending;
      expect(result.activityMixes).toEqual([]);
      expect(result.suggestedUsers).toEqual([]);
    } finally {
      warmWaitSpy.mockRestore();
    }
  });
});
