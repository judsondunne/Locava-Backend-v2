import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";
import { CollectionsFirestoreAdapter } from "../../repositories/source-of-truth/collections-firestore.adapter.js";
import { FeedFirestoreAdapter } from "../../repositories/source-of-truth/feed-firestore.adapter.js";
import { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import { SearchRepository } from "../../repositories/surfaces/search.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("v2 collections detail route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("returns canonical backend collection entity by id", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v2/collections",
      headers,
      payload: { name: "Detail Test", privacy: "private" }
    });
    if (created.statusCode !== 200) {
      expect(created.statusCode).toBe(503);
      expect(created.json().error.code).toBe("source_of_truth_required");
      return;
    }
    const collectionId = created.json().data.collectionId as string;
    const res = await app.inject({
      method: "GET",
      url: `/v2/collections/${encodeURIComponent(collectionId)}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("collections.detail.get");
    expect(body.data.item.id).toBe(collectionId);
    expect(body.data.item.ownerId).toBe("internal-viewer");
    expect(body.data.item.kind).toBe("backend");
  });

  it("returns 404 for missing collection", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/collections/internal-viewer-collection-missing",
      headers,
    });
    expect([404, 503]).toContain(res.statusCode);
  });

  it("returns hydrated canonical posts and recommended cards without existing collection items", async () => {
    vi.spyOn(CollectionsFirestoreAdapter.prototype, "getCollection").mockResolvedValue({
      id: "collection-1",
      ownerId: "internal-viewer",
      userId: "internal-viewer",
      name: "Hydrated Detail",
      description: "Rich detail payload",
      privacy: "private",
      collaborators: ["collab-1"],
      collaboratorInfo: [
        {
          id: "internal-viewer",
          name: "Owner Name",
          handle: "owner_handle",
          profilePic: "https://cdn.locava.test/users/owner.jpg",
        },
        {
          id: "collab-1",
          name: "Collab Name",
          handle: "collab_handle",
          profilePic: "https://cdn.locava.test/users/collab.jpg",
        },
      ],
      items: ["post-1"],
      itemsCount: 1,
      mediaCount: 1,
      tags: [],
      openedAtByUserId: {},
      displayPhotoUrl: "https://cdn.locava.test/collections/cover.jpg",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      lastContentActivityAtMs: 1_777_000_000_000,
      lastContentActivityByUserId: "internal-viewer",
      isPublic: false,
      permissions: {
        isOwner: true,
        isCollaborator: false,
        canEdit: true,
        canDelete: true,
        canManageCollaborators: true,
      },
      kind: "backend",
    });
    vi.spyOn(CollectionsFirestoreAdapter.prototype, "listCollectionPostIds").mockResolvedValue({
      items: [{ postId: "post-1", addedAt: "2026-05-01T00:00:00.000Z" }],
      nextCursor: null,
      hasMore: false,
    });
    vi.spyOn(FeedFirestoreAdapter.prototype, "isEnabled").mockReturnValue(true);
    vi.spyOn(FeedFirestoreAdapter.prototype, "getCandidatesByPostIds").mockImplementation(async (postIds) => {
      const makeRow = (postId: string, posterUrl: string) => ({
        postId,
        authorId: `author-${postId}`,
        slot: 1,
        updatedAtMs: 1_777_000_000_000,
        createdAtMs: 1_776_999_000_000,
        mediaType: "image" as const,
        posterUrl,
        firstAssetUrl: posterUrl,
        title: `Title ${postId}`,
        description: `Description ${postId}`,
        captionPreview: `Caption ${postId}`,
        tags: [],
        authorHandle: `handle_${postId}`,
        authorName: `Name ${postId}`,
        authorPic: `https://cdn.locava.test/users/${postId}.jpg`,
        activities: ["hiking"],
        address: "123 Trail Rd",
        geo: { lat: 1, long: 2, city: "Boulder", state: "CO", country: "US", geohash: null },
        assets: [
          {
            id: `${postId}-asset-1`,
            type: "image" as const,
            previewUrl: posterUrl,
            posterUrl,
            originalUrl: posterUrl,
            blurhash: null,
            width: 1080,
            height: 1350,
            aspectRatio: 1080 / 1350,
            orientation: "portrait",
          },
        ],
        likeCount: 7,
        commentCount: 3,
        likedByUserIds: [],
        sourcePost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl, userId: `author-${postId}` },
        rawPost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl, userId: `author-${postId}` },
      });
      return {
        items: postIds.map((postId) => makeRow(postId, `https://cdn.locava.test/posts/${postId}.jpg`)),
        queryCount: 1,
        readCount: postIds.length,
      };
    });
    vi.spyOn(SearchRepository.prototype, "getSearchResultsPage").mockResolvedValue({
      items: [{ postId: "post-1" }, { postId: "post-2" }, { postId: "post-3" }],
      hasMore: false,
      nextCursor: null,
    } as never);
    vi.spyOn(FeedService.prototype, "loadFeedPage").mockResolvedValue({
      items: [],
      hasMore: false,
      nextCursor: null,
    } as never);

    const res = await app.inject({
      method: "GET",
      url: "/v2/collections/collection-1",
      headers,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.item.collaboratorInfo).toEqual([
      {
        id: "internal-viewer",
        name: "Owner Name",
        handle: "owner_handle",
        profilePic: "https://cdn.locava.test/users/owner.jpg",
      },
      {
        id: "collab-1",
        name: "Collab Name",
        handle: "collab_handle",
        profilePic: "https://cdn.locava.test/users/collab.jpg",
      },
    ]);
    expect(body.data.posts.items).toHaveLength(1);
    expect(body.data.posts.items[0].postId).toBe("post-1");
    expect(body.data.posts.items[0].author.handle).toBe("handle_post-1");
    expect(body.data.posts.items[0].media.posterUrl).toBe("https://cdn.locava.test/posts/post-1.jpg");
    expect(body.data.posts.items[0].assets[0].originalUrl).toBe("https://cdn.locava.test/posts/post-1.jpg");
    expect(body.data.recommended.items.map((item: { postId: string }) => item.postId)).toEqual(["post-2", "post-3"]);
    expect(body.data.recommended.items.every((item: { media: { posterUrl: string } }) => item.media.posterUrl.startsWith("https://"))).toBe(true);
  });

  it("recommended route skips broken candidates and fills from fallback feed", async () => {
    vi.spyOn(CollectionsFirestoreAdapter.prototype, "getCollection").mockResolvedValue({
      id: "collection-2",
      ownerId: "internal-viewer",
      userId: "internal-viewer",
      name: "Recommended Fill",
      privacy: "private",
      collaborators: [],
      collaboratorInfo: [],
      items: ["post-1"],
      itemsCount: 1,
      mediaCount: 1,
      tags: [],
      openedAtByUserId: {},
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      lastContentActivityAtMs: 1_777_000_000_000,
      lastContentActivityByUserId: "internal-viewer",
      isPublic: false,
      permissions: {
        isOwner: true,
        isCollaborator: false,
        canEdit: true,
        canDelete: true,
        canManageCollaborators: true,
      },
      kind: "backend",
    });
    vi.spyOn(FeedFirestoreAdapter.prototype, "isEnabled").mockReturnValue(true);
    vi.spyOn(FeedFirestoreAdapter.prototype, "getCandidatesByPostIds").mockImplementation(async (postIds) => {
      const rows = postIds.map((postId) => {
        const posterUrl = postId === "post-bad" ? "" : `https://cdn.locava.test/posts/${postId}.jpg`;
        return {
          postId,
          authorId: `author-${postId}`,
          slot: 1,
          updatedAtMs: 1_777_000_000_000,
          createdAtMs: 1_776_999_000_000,
          mediaType: "image" as const,
          posterUrl,
          firstAssetUrl: posterUrl || null,
          title: `Title ${postId}`,
          description: null,
          captionPreview: `Caption ${postId}`,
          tags: [],
          authorHandle: `handle_${postId}`,
          authorName: `Name ${postId}`,
          authorPic: `https://cdn.locava.test/users/${postId}.jpg`,
          activities: ["hiking"],
          address: "123 Trail Rd",
          geo: { lat: 1, long: 2, city: "Boulder", state: "CO", country: "US", geohash: null },
          assets: posterUrl
            ? [
                {
                  id: `${postId}-asset-1`,
                  type: "image" as const,
                  previewUrl: posterUrl,
                  posterUrl,
                  originalUrl: posterUrl,
                  blurhash: null,
                  width: 1080,
                  height: 1350,
                  aspectRatio: 1080 / 1350,
                  orientation: "portrait",
                },
              ]
            : [],
          likeCount: 0,
          commentCount: 0,
          likedByUserIds: [],
          sourcePost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl },
          rawPost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl },
        };
      });
      return { items: rows, queryCount: 1, readCount: rows.length };
    });
    vi.spyOn(SearchRepository.prototype, "getSearchResultsPage").mockResolvedValue({
      items: [{ postId: "post-1" }, { postId: "post-bad" }],
      hasMore: false,
      nextCursor: null,
    } as never);
    vi.spyOn(FeedService.prototype, "loadFeedPage").mockResolvedValue({
      items: [
        {
          postId: "post-4",
          author: { userId: "author-post-4", handle: "handle_post-4", name: "Name post-4", pic: "https://cdn.locava.test/users/post-4.jpg" },
          media: { type: "image", posterUrl: "https://cdn.locava.test/posts/post-4.jpg", aspectRatio: 1, startupHint: "poster_only" },
          social: { likeCount: 0, commentCount: 0 },
          viewer: { liked: false, saved: false },
          updatedAtMs: 1_777_000_000_100,
        },
      ],
      hasMore: false,
      nextCursor: null,
    } as never);

    const res = await app.inject({
      method: "GET",
      url: "/v2/collections/collection-2/recommended?limit=2",
      headers,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.collectionId).toBe("collection-2");
    expect(body.data.items.map((item: { postId: string }) => item.postId)).toEqual(["post-4"]);
    expect(body.data.items[0].media.posterUrl).toBe("https://cdn.locava.test/posts/post-4.jpg");
  });

  it("recommended route primes post-card cache for immediate detail prefetch follow-ups", async () => {
    vi.spyOn(CollectionsFirestoreAdapter.prototype, "getCollection").mockResolvedValue({
      id: "collection-cache-prime",
      ownerId: "internal-viewer",
      userId: "internal-viewer",
      name: "Recommended Cache Prime",
      privacy: "private",
      collaborators: [],
      collaboratorInfo: [],
      items: ["post-seed-1"],
      itemsCount: 1,
      mediaCount: 1,
      tags: [],
      openedAtByUserId: {},
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      lastContentActivityAtMs: 1_777_000_000_000,
      lastContentActivityByUserId: "internal-viewer",
      isPublic: false,
      permissions: {
        isOwner: true,
        isCollaborator: false,
        canEdit: true,
        canDelete: true,
        canManageCollaborators: true,
      },
      kind: "backend",
    });
    vi.spyOn(FeedFirestoreAdapter.prototype, "isEnabled").mockReturnValue(true);
    vi.spyOn(FeedFirestoreAdapter.prototype, "getCandidatesByPostIds").mockImplementation(async (postIds) => ({
      items: postIds.map((postId) => ({
        postId,
        authorId: `author-${postId}`,
        slot: 1,
        updatedAtMs: 1_777_000_000_000,
        createdAtMs: 1_776_999_000_000,
        mediaType: "image" as const,
        posterUrl: `https://cdn.locava.test/posts/${postId}.jpg`,
        firstAssetUrl: `https://cdn.locava.test/posts/${postId}.jpg`,
        title: `Title ${postId}`,
        description: `Description ${postId}`,
        captionPreview: `Caption ${postId}`,
        tags: [],
        authorHandle: `handle_${postId}`,
        authorName: `Name ${postId}`,
        authorPic: `https://cdn.locava.test/users/${postId}.jpg`,
        activities: ["beach"],
        address: "123 Ocean Ave",
        geo: { lat: 1, long: 2, city: "Miami", state: "FL", country: "US", geohash: null },
        assets: [
          {
            id: `${postId}-asset-1`,
            type: "image" as const,
            previewUrl: `https://cdn.locava.test/posts/${postId}.jpg`,
            posterUrl: `https://cdn.locava.test/posts/${postId}.jpg`,
            originalUrl: `https://cdn.locava.test/posts/${postId}.jpg`,
            blurhash: null,
            width: 1080,
            height: 1350,
            aspectRatio: 1080 / 1350,
            orientation: "portrait",
          },
        ],
        likeCount: 0,
        commentCount: 0,
        likedByUserIds: [],
        sourcePost: { postId, thumbUrl: `https://cdn.locava.test/posts/${postId}.jpg`, displayPhotoLink: `https://cdn.locava.test/posts/${postId}.jpg` },
        rawPost: { postId, thumbUrl: `https://cdn.locava.test/posts/${postId}.jpg`, displayPhotoLink: `https://cdn.locava.test/posts/${postId}.jpg` },
      })),
      queryCount: 1,
      readCount: postIds.length,
    }));
    vi.spyOn(SearchRepository.prototype, "getSearchResultsPage").mockResolvedValue({
      items: [{ postId: "post-seed-1" }, { postId: "post-cache-2" }, { postId: "post-cache-3" }],
      hasMore: false,
      nextCursor: null,
    } as never);
    vi.spyOn(FeedService.prototype, "loadFeedPage").mockResolvedValue({
      items: [],
      hasMore: false,
      nextCursor: null,
    } as never);

    const res = await app.inject({
      method: "GET",
      url: "/v2/collections/collection-cache-prime/recommended?limit=2",
      headers,
    });

    expect(res.statusCode).toBe(200);
    const repoFetch = vi.spyOn(FeedRepository.prototype, "getPostCardSummariesByPostIds");
    const cacheReader = new FeedService(new FeedRepository());
    const cards = await cacheReader.loadPostCardSummaryBatchLightweight("internal-viewer", [
      "post-cache-2",
      "post-cache-3",
    ]);

    expect(cards.map((card) => card.postId)).toEqual(["post-cache-2", "post-cache-3"]);
    expect(repoFetch).not.toHaveBeenCalled();
  });
});
