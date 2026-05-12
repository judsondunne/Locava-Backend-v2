import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SimpleFeedCandidate } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { decodeForYouSimpleCursor } from "./feed-for-you-simple-cursor.js";
import { resetForYouSimpleReelPoolForTests } from "./feed-for-you-simple-reel-pool.js";
import { FeedForYouSimpleService } from "./feed-for-you-simple.service.js";

function candidate(input: {
  postId: string;
  reel?: boolean;
  tier?: number | null;
  authorId?: string;
  rawFirestore?: Record<string, unknown>;
}): SimpleFeedCandidate {
  const reel = input.reel !== false;
  return {
    postId: input.postId,
    sortValue: 1,
    reel,
    moderatorTier: input.tier ?? null,
    authorId: input.authorId ?? "author_1",
    createdAtMs: 1,
    updatedAtMs: 1,
    mediaType: "video",
    posterUrl: "https://cdn.locava.test/poster.jpg",
    firstAssetUrl: null,
    title: null,
    captionPreview: null,
    authorHandle: "author",
    authorName: null,
    authorPic: null,
    activities: [],
    address: null,
    geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
    assets: [],
    likeCount: 0,
    commentCount: 0,
    rawFirestore: input.rawFirestore ?? { moderatorTier: input.tier ?? null, reel }
  };
}

function emptyBatch() {
  return {
    items: [] as SimpleFeedCandidate[],
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
    tailDocId: null,
    usedIndexedTierQuery: false,
    indexFallbackUsed: false
  };
}

function buildRepository(fetchServePhaseBatch: ReturnType<typeof vi.fn>) {
  return {
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
      ...emptyBatch(),
      items: [candidate({ postId: "fallback_1", reel: false })]
    }),
    probeGeohashPlayablePostsWithinRadius: async () => ({
      items: [],
      readCount: 0,
      geoNextCursor: null,
      prefixHasMore: false
    }),
    probeRecentPlayablePostsWithinRadius: async () => ({
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
    }),
    loadBlockedAuthorIdsForViewer: async () => ({ blocked: new Set<string>(), readCount: 0 }),
    fetchCandidatesByPostIds: async () => [],
    fetchBatch: async () => emptyBatch(),
    fetchReelPoolBootstrap: async () => []
  };
}

beforeEach(() => {
  resetForYouSimpleReelPoolForTests();
});

describe("FeedForYouSimpleService phase serving", () => {
  it("serves tier 5 reels before advancing to tier 4 across pages", async () => {
    let tier5Calls = 0;
    const fetchServePhaseBatch = vi.fn(async (input) => {
      const items =
        input.phase === "reel_tier_5"
          ? (() => {
              tier5Calls += 1;
              if (tier5Calls > 1) return [];
              return [candidate({ postId: "t5_a", tier: 5 }), candidate({ postId: "t5_b", tier: 5 })];
            })()
          : input.phase === "reel_tier_4"
            ? [candidate({ postId: "t4_a", tier: 4 }), candidate({ postId: "t4_b", tier: 4 })]
            : [];
      return {
        items,
        rawCount: items.length,
        segmentExhausted: items.length === 0,
        readCount: Math.max(1, items.length),
        stats: {
          rawDocCount: items.length,
          filteredInvisible: 0,
          filteredMissingAuthor: 0,
          filteredMissingMedia: 0,
          filteredInvalidContract: 0,
          filteredInvalidSort: 0,
          playableMapped: items.length
        },
        tailRandomKey: 1,
        tailDocId: items[items.length - 1]?.postId ?? null,
        usedIndexedTierQuery: false,
        indexFallbackUsed: false
      };
    });
    const service = new FeedForYouSimpleService(buildRepository(fetchServePhaseBatch));
    const first = await service.getPage({ viewerId: "viewer_phase_sequence", limit: 2, cursor: null });
    expect(first.items.map((row) => row.postId)).toEqual(["t5_a", "t5_b"]);
    expect(first.exhausted).toBe(false);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.getPage({
      viewerId: "viewer_phase_sequence",
      limit: 5,
      cursor: first.nextCursor
    });
    expect(second.items.map((row) => row.postId)).toEqual(["t4_a", "t4_b"]);
    expect(second.debug.fallbackUsed).not.toBe(true);
  });

  it("does not return fallback posts while reel phases remain open", async () => {
    const fetchServePhaseBatch = vi.fn(async (input) => {
      if (input.phase === "fallback_normal") {
        return {
          ...emptyBatch(),
          items: [candidate({ postId: "fallback_1", reel: false })],
          rawCount: 1,
          segmentExhausted: false,
          readCount: 1,
          stats: { ...emptyBatch().stats, rawDocCount: 1, playableMapped: 1 }
        };
      }
      return {
        ...emptyBatch(),
        items: [candidate({ postId: "t5_a", tier: 5 })],
        rawCount: 1,
        segmentExhausted: false,
        readCount: 1,
        stats: { ...emptyBatch().stats, rawDocCount: 1, playableMapped: 1 }
      };
    });
    const service = new FeedForYouSimpleService(buildRepository(fetchServePhaseBatch));
    const page = await service.getPage({ viewerId: "viewer_no_fallback", limit: 5, cursor: null });
    expect(page.debug.reelReturnedCount).toBe(page.items.length);
    expect(page.debug.fallbackUsed).not.toBe(true);
  });

  it("returns a short reel page with nextCursor and exhausted false", async () => {
    const fetchServePhaseBatch = vi.fn(async (input) => {
      if (input.phase !== "reel_tier_5") return emptyBatch();
      return {
        ...emptyBatch(),
        items: [
          candidate({ postId: "t5_a", tier: 5, authorId: "author_a" }),
          candidate({ postId: "t5_b", tier: 5, authorId: "author_b" }),
          candidate({ postId: "t5_c", tier: 5, authorId: "author_c" })
        ],
        rawCount: 3,
        segmentExhausted: false,
        readCount: 3,
        stats: { ...emptyBatch().stats, rawDocCount: 3, playableMapped: 3 }
      };
    });
    const service = new FeedForYouSimpleService(buildRepository(fetchServePhaseBatch));
    const page = await service.getPage({ viewerId: "viewer_short_page", limit: 5, cursor: null });
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeTruthy();
    expect(page.exhausted).toBe(false);
  });

  it("does not repeat cold first-page ids on in-process reload", async () => {
    const fetchServePhaseBatch = vi.fn(async (input) => {
      if (input.phase !== "reel_tier_5") return emptyBatch();
      return {
        ...emptyBatch(),
        items: [
          candidate({ postId: "t5_a", tier: 5, authorId: "author_a" }),
          candidate({ postId: "t5_b", tier: 5, authorId: "author_b" }),
          candidate({ postId: "t5_c", tier: 5, authorId: "author_c" })
        ],
        rawCount: 3,
        segmentExhausted: false,
        readCount: 3,
        stats: { ...emptyBatch().stats, rawDocCount: 3, playableMapped: 3 }
      };
    });
    const service = new FeedForYouSimpleService(buildRepository(fetchServePhaseBatch));
    const first = await service.getPage({ viewerId: "viewer_served_recent_cold", limit: 2, cursor: null });
    const reload = await service.getPage({ viewerId: "viewer_served_recent_cold", limit: 2, cursor: null });
    const firstIds = first.items.map((row) => row.postId);
    const reloadIds = reload.items.map((row) => row.postId);
    expect(reloadIds.some((id) => firstIds.includes(id))).toBe(false);
    expect(reload.debug.fallbackUsed).not.toBe(true);
  });

  it("does not repeat page1 ids on page2 and increments continuationSeq", async () => {
    const fetchServePhaseBatch = vi.fn(async () => ({
      ...emptyBatch(),
      items: [
        candidate({ postId: "t5_a", tier: 5 }),
        candidate({ postId: "t5_b", tier: 5 }),
        candidate({ postId: "t5_c", tier: 5 })
      ],
      rawCount: 3,
      segmentExhausted: false,
      readCount: 3,
      stats: { ...emptyBatch().stats, rawDocCount: 3, playableMapped: 3 }
    }));
    const service = new FeedForYouSimpleService(buildRepository(fetchServePhaseBatch));
    const first = await service.getPage({ viewerId: "viewer_seen_chain", limit: 2, cursor: null });
    expect(first.nextCursor).toBeTruthy();
    expect(first.debug.continuationSeq).toBe(1);
    const second = await service.getPage({ viewerId: "viewer_seen_chain", limit: 2, cursor: first.nextCursor });
    const firstIds = first.items.map((row) => row.postId);
    const secondIds = second.items.map((row) => row.postId);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    expect(second.debug.continuationSeq).toBeGreaterThanOrEqual(1);
  });

  it("repairs invalid fallback active phase from incoming cursor", async () => {
    const fetchServePhaseBatch = vi.fn(async () => ({
      ...emptyBatch(),
      items: [candidate({ postId: "t5_a", tier: 5 })],
      rawCount: 1,
      segmentExhausted: false,
      readCount: 1,
      stats: { ...emptyBatch().stats, rawDocCount: 1, playableMapped: 1 }
    }));
    const service = new FeedForYouSimpleService(buildRepository(fetchServePhaseBatch));
    const first = await service.getPage({ viewerId: "viewer_cursor_repair", limit: 1, cursor: null });
    const decoded = decodeForYouSimpleCursor(first.nextCursor);
    if (!decoded) throw new Error("missing cursor");
    decoded.activePhase = "fallback_normal";
    const repairedCursor = `${"fys:v3:"}${Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")}`;
    const page = await service.getPage({ viewerId: "viewer_cursor_repair", limit: 1, cursor: repairedCursor });
    expect(page.debug.activePhase).toBe("reel_tier_5");
    expect(page.debug.earliestAllowedPhase).toBe("reel_tier_5");
  });
});
