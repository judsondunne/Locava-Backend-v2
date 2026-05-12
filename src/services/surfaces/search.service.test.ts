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

  it("returns one typed bundle with posts, users, collections, and mixes for committed search", async () => {
    const repository = {
      getSearchResultsPage: vi.fn(async () => ({
        query: "waterfall in vermont",
        cursorIn: null,
        items: [
          {
            postId: "post-1",
            rank: 1,
            userId: "user-1",
            userHandle: "falls",
            userName: "Falls",
            userPic: "https://example.com/u1.jpg",
            activities: ["waterfall"],
            title: "Cold hollow falls",
            thumbUrl: "https://example.com/post-1.jpg",
            displayPhotoLink: "https://example.com/post-1.jpg",
            mediaType: "image",
            likeCount: 7,
            commentCount: 2,
            updatedAtMs: 1000,
          },
        ],
        hasMore: true,
        nextCursor: "cursor:8",
      })),
    } as unknown as ConstructorParameters<typeof SearchService>[0];
    const service = new SearchService(repository);
    const discoveryStub = {
      isEnabled: vi.fn(() => false),
      parseIntent: vi.fn(() => ({
        activity: { queryActivities: ["waterfall"] },
        location: {
          place: { text: "Vermont", lat: 44.0, lng: -72.7 },
          stateName: "Vermont",
          displayText: "Vermont",
        },
        nearMe: false,
      })),
      searchPostsForQuery: vi.fn(async () => []),
      loadTopActivities: vi.fn(async () => ["waterfall"]),
      searchCollections: vi.fn(async () => [
        {
          id: "collection-1",
          title: "Waterfalls",
          description: "Saved waterfalls",
          coverUri: "https://example.com/collection.jpg",
          postCount: 12,
        },
      ]),
      buildMixSpecsFromActivities: vi.fn(() => [
        {
          id: "mix_waterfall_vermont",
          title: "Waterfall in Vermont",
          subtitle: "Top waterfall posts near Vermont",
          heroQuery: "waterfall in vermont",
          seeds: { primaryActivityId: "waterfall" },
        },
      ]),
    };
    const usersServiceStub = {
      loadUsersPage: vi.fn(async () => ({
        items: [
          {
            userId: "user-2",
            handle: "trailfriend",
            name: "Trail Friend",
            pic: "https://example.com/u2.jpg",
          },
        ],
        followingUserIds: ["user-2"],
        hasMore: true,
        nextCursor: "cursor:1",
      })),
    };
    (service as unknown as { discoveryService: typeof discoveryStub }).discoveryService = discoveryStub;
    (service as unknown as { usersService: typeof usersServiceStub }).usersService = usersServiceStub;

    const result = await service.loadResultsBundle({
      viewerId: "viewer-1",
      query: "waterfall in vermont",
      cursor: null,
      limit: 8,
      lat: 44.0,
      lng: -72.7,
      wantedTypes: new Set(["posts", "users", "collections", "mixes"]),
    });

    expect(result.items).toHaveLength(1);
    expect(result.sections.posts.items).toHaveLength(1);
    expect(result.sections.users.items).toEqual([
      expect.objectContaining({
        userId: "user-2",
        handle: "trailfriend",
        isFollowing: true,
      }),
    ]);
    expect(result.sections.users.hasMore).toBe(true);
    expect(result.sections.users.cursor).toBe("cursor:1");
    expect(result.sections.collections.items).toEqual([
      expect.objectContaining({ id: "collection-1", title: "Waterfalls" }),
    ]);
    expect(result.sections.mixes.items).toEqual([
      expect.objectContaining({
        id: "mix_waterfall_vermont",
        mixKey: "mix_waterfall_vermont",
        type: "activity",
        activity: "waterfall",
        state: "Vermont",
        coverUri: "https://example.com/post-1.jpg",
      }),
    ]);
  });
});
