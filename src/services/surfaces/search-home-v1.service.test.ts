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
});
