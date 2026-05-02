import { describe, expect, it, vi } from "vitest";
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
    service.mixPoolRepo = {
      listFromPool: vi.fn(async () => ({
        posts: [
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
        ],
      })),
    };

    const result = await service.build("viewer-a");

    expect(result.activityMixes).toHaveLength(1);
    expect(result.activityMixes[0]?.activityKey).toBe("hiking");
    expect(result.activityMixes[0]?.posts).toHaveLength(2);
    expect(result.activityMixes[0]?.posts[0]?.id).toBe("p1");
    expect(result.diagnostics.activityMixCount).toBe(1);
    expect(result.diagnostics.postsPerMix).toEqual([2]);
  });
});
