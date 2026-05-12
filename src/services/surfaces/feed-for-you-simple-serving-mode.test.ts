import { beforeEach, describe, expect, it } from "vitest";
import type { SimpleFeedCandidate } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { resetForYouSimpleReelPoolForTests } from "./feed-for-you-simple-reel-pool.js";
import { decodeForYouSimpleCursor } from "./feed-for-you-simple-cursor.js";
import {
  deckKeyForServingMode,
  resolveForYouSimpleServingMode
} from "./feed-for-you-simple-serving-mode.js";
import { FeedForYouSimpleService } from "./feed-for-you-simple.service.js";

function candidate(input: {
  postId: string;
  reel?: boolean;
  tier?: number | null;
  authorId?: string;
  lat?: number;
  lng?: number;
}): SimpleFeedCandidate {
  return {
    postId: input.postId,
    sortValue: 1,
    reel: input.reel ?? false,
    moderatorTier: input.tier ?? null,
    authorId: input.authorId ?? "author_1",
    createdAtMs: 1,
    updatedAtMs: 1,
    mediaType: "image",
    posterUrl: "https://cdn.locava.test/poster.jpg",
    firstAssetUrl: null,
    title: null,
    captionPreview: null,
    authorHandle: "author",
    authorName: null,
    authorPic: null,
    activities: [],
    address: null,
    geo: {
      lat: input.lat ?? null,
      long: input.lng ?? null,
      city: null,
      state: null,
      country: null,
      geohash: null
    },
    assets: [],
    likeCount: 0,
    commentCount: 0,
    rawFirestore: { reel: input.reel ?? false, moderatorTier: input.tier ?? null }
  };
}

describe("for-you simple serving mode", () => {
  it("resolves radius requests to radius_all_posts", () => {
    expect(
      resolveForYouSimpleServingMode({
        radiusFilter: {
          mode: "nearMe",
          centerLat: 40.69835407448919,
          centerLng: -75.21050655501325,
          radiusMiles: 10
        }
      })
    ).toBe("radius_all_posts");
  });

  it("isolates deck keys between home and radius", () => {
    const radiusFilter = {
      mode: "nearMe" as const,
      centerLat: 40.69835407448919,
      centerLng: -75.21050655501325,
      radiusMiles: 10
    };
    const homeKey = deckKeyForServingMode("viewer_a", "home_reel_first", {
      mode: "global",
      centerLat: null,
      centerLng: null,
      radiusMiles: null
    });
    const radiusKey = deckKeyForServingMode("viewer_a", "radius_all_posts", radiusFilter);
    expect(homeKey).not.toBe(radiusKey);
    expect(radiusKey).toContain("radius_all_posts");
  });
});

describe("FeedForYouSimpleService radius mode", () => {
  beforeEach(() => {
    resetForYouSimpleReelPoolForTests();
  });

  it("returns mixed image and video posts within radius without reel phase reads", async () => {
    const fetchServePhaseBatch = async () => {
      throw new Error("reel_phase_should_not_run");
    };
    const probeGeohashPlayablePostsWithinRadius = async () => ({
      items: [],
      readCount: 0,
      geoNextCursor: null,
      prefixHasMore: false
    });
    const probeRecentPlayablePostsWithinRadius = async () => ({
      items: [
        candidate({ postId: "img_near", reel: false, lat: 40.68843, lng: -75.22073 }),
        candidate({ postId: "vid_near", reel: true, tier: 2, lat: 40.6885, lng: -75.2208 }),
        candidate({ postId: "far_post", reel: true, tier: 5, lat: 40.25, lng: -75.21 })
      ],
      readCount: 3,
      tailTimeMs: 1,
      tailPostId: "far_post",
      segmentExhausted: false,
      shapeCounts: {
        totalDocs: 3,
        topLevelLatLong: 0,
        nestedLocationCoordinates: 3,
        invalidCoords: 0,
        outsideRadius: 1,
        playableMapped: 3
      }
    });
    const repository = {
      isEnabled: () => true,
      resolveSortMode: async () => "randomKey" as const,
      fetchServePhaseBatch,
      listRecentSeenPostIdsForViewer: async () => ({ postIds: new Set<string>(), readCount: 0 }),
      markPostsServedForViewer: async () => undefined,
      readServedRecentForViewer: async () => ({ postIds: new Set<string>(), readCount: 0 }),
      markPostsServedRecentForViewer: async () => ({ ok: true, writes: 0 }),
      readReadyDeck: async () => null,
      writeReadyDeck: async () => undefined,
      fetchEmergencyPlayableSlice: async () => ({
        items: [],
        rawCount: 0,
        segmentExhausted: true,
        readCount: 0,
        stats: {
          rawDocCount: 0,
          filteredInvisible: 0,
          filteredMissingAuthor: 0,
          filteredMissingMedia: 0,
          filteredInvalidContract: 0,
          filteredInvalidSort: 0,
          playableMapped: 0
        },
        tailRandomKey: null,
        tailDocId: null
      }),
      probeGeohashPlayablePostsWithinRadius,
      probeRecentPlayablePostsWithinRadius,
      loadBlockedAuthorIdsForViewer: async () => ({ blocked: new Set<string>(), readCount: 0 }),
      fetchCandidatesByPostIds: async () => [],
      fetchBatch: async () => ({
        items: [],
        rawCount: 0,
        segmentExhausted: true,
        readCount: 0,
        stats: {
          rawDocCount: 0,
          filteredInvisible: 0,
          filteredMissingAuthor: 0,
          filteredMissingMedia: 0,
          filteredInvalidContract: 0,
          filteredInvalidSort: 0,
          playableMapped: 0
        },
        tailRandomKey: null,
        tailDocId: null
      }),
      fetchReelPoolBootstrap: async () => []
    };
    const service = new FeedForYouSimpleService(repository);
    const page = await service.getPage({
      viewerId: "viewer_radius_mode",
      limit: 5,
      cursor: null,
      radiusFilter: {
        mode: "nearMe",
        centerLat: 40.69842189738677,
        centerLng: -75.21062607164923,
        radiusMiles: 10
      }
    });
    const ids = page.items.map((row) => row.postId);
    expect(ids).toContain("img_near");
    expect(ids).toContain("vid_near");
    expect(ids).not.toContain("far_post");
    expect(page.nextCursor).toBeTruthy();
    const decoded = decodeForYouSimpleCursor(page.nextCursor);
    expect(decoded?.servingMode).toBe("radius_all_posts");
    expect(decoded?.filter?.radiusMiles).toBe(10);
  });

  it("continues radius pagination across geohash and recent scans", async () => {
    let recentCalls = 0;
    let pageIndex = 0;
    const probeGeohashPlayablePostsWithinRadius = async () => {
      if (pageIndex === 0) {
        return { items: [], readCount: 0, geoNextCursor: null, prefixHasMore: false };
      }
      return {
        items: [candidate({ postId: "geo_near", reel: false, lat: 40.68843, lng: -75.22073 })],
        readCount: 1,
        geoNextCursor: null,
        prefixHasMore: false
      };
    };
    const probeRecentPlayablePostsWithinRadius = async () => {
      recentCalls += 1;
      if (recentCalls === 1) {
        return {
          items: [
            candidate({ postId: "img_near", reel: false, lat: 40.68843, lng: -75.22073 }),
            candidate({ postId: "vid_near", reel: true, tier: 2, lat: 40.6885, lng: -75.2208 })
          ],
          readCount: 2,
          tailTimeMs: 1,
          tailPostId: "vid_near",
          segmentExhausted: false,
          shapeCounts: {
            totalDocs: 2,
            topLevelLatLong: 0,
            nestedLocationCoordinates: 2,
            invalidCoords: 0,
            outsideRadius: 0,
            playableMapped: 2
          }
        };
      }
      return {
        items: [],
        readCount: 0,
        tailTimeMs: null,
        tailPostId: null,
        segmentExhausted: true,
        shapeCounts: {
          totalDocs: 0,
          topLevelLatLong: 0,
          nestedLocationCoordinates: 0,
          invalidCoords: 0,
          outsideRadius: 0,
          playableMapped: 0
        }
      };
    };
    const repository = {
      isEnabled: () => true,
      resolveSortMode: async () => "randomKey" as const,
      fetchServePhaseBatch: async () => {
        throw new Error("reel_phase_should_not_run");
      },
      listRecentSeenPostIdsForViewer: async () => ({ postIds: new Set<string>(), readCount: 0 }),
      markPostsServedForViewer: async () => undefined,
      readServedRecentForViewer: async () => ({ postIds: new Set<string>(), readCount: 0 }),
      markPostsServedRecentForViewer: async () => ({ ok: true, writes: 0 }),
      readReadyDeck: async () => null,
      writeReadyDeck: async () => undefined,
      fetchEmergencyPlayableSlice: async () => ({
        items: [],
        rawCount: 0,
        segmentExhausted: true,
        readCount: 0,
        stats: {
          rawDocCount: 0,
          filteredInvisible: 0,
          filteredMissingAuthor: 0,
          filteredMissingMedia: 0,
          filteredInvalidContract: 0,
          filteredInvalidSort: 0,
          playableMapped: 0
        },
        tailRandomKey: null,
        tailDocId: null
      }),
      probeGeohashPlayablePostsWithinRadius,
      probeRecentPlayablePostsWithinRadius,
      loadBlockedAuthorIdsForViewer: async () => ({ blocked: new Set<string>(), readCount: 0 }),
      fetchCandidatesByPostIds: async () => [],
      fetchBatch: async () => ({
        items: [],
        rawCount: 0,
        segmentExhausted: true,
        readCount: 0,
        stats: {
          rawDocCount: 0,
          filteredInvisible: 0,
          filteredMissingAuthor: 0,
          filteredMissingMedia: 0,
          filteredInvalidContract: 0,
          filteredInvalidSort: 0,
          playableMapped: 0
        },
        tailRandomKey: null,
        tailDocId: null
      }),
      fetchReelPoolBootstrap: async () => []
    };
    const service = new FeedForYouSimpleService(repository);
    const first = await service.getPage({
      viewerId: "viewer_radius_mode",
      limit: 2,
      cursor: null,
      radiusFilter: {
        mode: "nearMe",
        centerLat: 40.69842189738677,
        centerLng: -75.21062607164923,
        radiusMiles: 10
      }
    });
    expect(first.items.map((row) => row.postId)).toEqual(expect.arrayContaining(["img_near", "vid_near"]));
    expect(first.items).toHaveLength(2);
    pageIndex = 1;
    const second = await service.getPage({
      viewerId: "viewer_radius_mode",
      limit: 2,
      cursor: first.nextCursor,
      radiusFilter: {
        mode: "nearMe",
        centerLat: 40.69842189738677,
        centerLng: -75.21062607164923,
        radiusMiles: 10
      }
    });
    expect(second.items.map((row) => row.postId)).toEqual(["geo_near"]);
  });
});
