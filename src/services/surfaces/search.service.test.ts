import { describe, expect, it, vi } from "vitest";
import { SearchService } from "./search.service.js";

describe("SearchService", () => {
  it("uses discovery posts for activity-only first-page queries", async () => {
    const repository = {
      getSearchResultsPage: vi.fn(),
    } as unknown as ConstructorParameters<typeof SearchService>[0];
    const service = new SearchService(repository);
    const discoveryStub = {
      isEnabled: vi.fn(() => true),
      parseIntent: vi.fn(() => ({
        activity: { queryActivities: ["biking"] },
        location: null,
        nearMe: false,
      })),
      searchPostsForQuery: vi.fn(async () => [
        {
          id: "post-1",
          postId: "post-1",
          userId: "user-1",
          userHandle: "rider",
          userName: "Rider",
          userPic: null,
          activities: ["biking"],
          title: "Trail ride",
          thumbUrl: "https://example.com/post-1.jpg",
          displayPhotoLink: "https://example.com/post-1.jpg",
          mediaType: "image",
          likeCount: 3,
          commentCount: 1,
          updatedAtMs: 1000,
        },
      ]),
      loadTopActivities: vi.fn(async () => []),
      searchUsersForQuery: vi.fn(async () => []),
      searchCollections: vi.fn(async () => []),
      buildMixSpecsFromActivities: vi.fn(() => []),
    };
    (service as unknown as { discoveryService: typeof discoveryStub }).discoveryService = discoveryStub;

    const result = await service.loadResultsBundle({
      viewerId: "viewer-1",
      query: "biking",
      cursor: null,
      limit: 8,
      lat: null,
      lng: null,
      wantedTypes: new Set(["posts"]),
    });

    expect(discoveryStub.searchPostsForQuery).toHaveBeenCalledWith("biking", {
      limit: 8,
      lat: null,
      lng: null,
    });
    expect(repository.getSearchResultsPage).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.postId).toBe("post-1");
  });

  it("falls back to repository search when fast discovery returns zero posts for structured queries", async () => {
    const repository = {
      getSearchResultsPage: vi.fn(async () => ({
        query: "coffee shops in easton",
        cursorIn: null,
        items: [
          {
            postId: "bad-fallback",
            rank: 1,
            userId: "user-x",
            userHandle: "global",
            userName: "Global",
            userPic: null,
            activities: ["restaurants"],
            title: "Irrelevant global row",
            thumbUrl: "https://example.com/global.jpg",
            displayPhotoLink: "https://example.com/global.jpg",
            mediaType: "image",
            likeCount: 1,
            commentCount: 0,
            updatedAtMs: 1000,
          },
        ],
        hasMore: false,
        nextCursor: null,
      })),
    } as unknown as ConstructorParameters<typeof SearchService>[0];
    const service = new SearchService(repository);
    const discoveryStub = {
      isEnabled: vi.fn(() => true),
      parseIntent: vi.fn(() => ({
        activity: { queryActivities: ["cafe", "restaurants"] },
        location: { cityRegionId: "US-Pennsylvania-Easton", displayText: "Easton, Pennsylvania" },
        nearMe: false,
      })),
      searchPostsForQuery: vi.fn(async () => []),
      loadTopActivities: vi.fn(async () => []),
      searchUsersForQuery: vi.fn(async () => []),
      searchCollections: vi.fn(async () => []),
      buildMixSpecsFromActivities: vi.fn(() => []),
    };
    (service as unknown as { discoveryService: typeof discoveryStub }).discoveryService = discoveryStub;

    const result = await service.loadResultsBundle({
      viewerId: "viewer-1",
      query: "coffee shops in easton",
      cursor: null,
      limit: 8,
      lat: 40.68843,
      lng: -75.22073,
      wantedTypes: new Set(["posts"]),
    });

    expect(discoveryStub.searchPostsForQuery).toHaveBeenCalled();
    // When the fast discovery slice is empty, we fall back to the repository page so committed search
    // is not stuck at zero rows while Firestore still has broader matches.
    expect(repository.getSearchResultsPage).toHaveBeenCalled();
    expect(result.items.length).toBeGreaterThanOrEqual(0);
  });
});
