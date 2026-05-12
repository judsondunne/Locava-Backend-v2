import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SimpleFeedCandidate } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { getForYouV5Page } from "./for-you-v5-get-page.js";
import * as readyDeck from "./for-you-v5-ready-deck.js";
import { resetForYouV5ReadyDeckForTests } from "./for-you-v5-ready-deck.js";

function mkCand(
  postId: string,
  opts: { authorId?: string; reel?: boolean; tier?: number; poster?: boolean; randomKey?: number } = {}
): SimpleFeedCandidate {
  const authorId = opts.authorId ?? `a_${postId.slice(-1)}`;
  const reel = opts.reel !== false;
  const tier = opts.tier ?? 5;
  const raw: Record<string, unknown> = {
    reel: reel === true,
    moderatorTier: tier,
    userId: authorId,
    privacy: "public",
    status: "active",
    assets: [{ type: "image", id: "1", originalUrl: "https://example.com/x.jpg", posterUrl: "https://example.com/p.jpg" }],
    userHandle: "h",
    likesCount: 0,
    commentCount: 0,
    time: Date.now(),
    randomKey: opts.randomKey ?? Math.random(),
  };
  return {
    postId,
    sortValue: (opts.randomKey ?? 0.5) as number,
    reel: reel === true,
    moderatorTier: tier,
    authorId,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    mediaType: "image",
    posterUrl: opts.poster === false ? "" : "https://example.com/p.jpg",
    firstAssetUrl: "https://example.com/x.jpg",
    title: null,
    captionPreview: null,
    authorHandle: "h",
    authorName: null,
    authorPic: null,
    activities: [],
    address: null,
    geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
    assets: [
      {
        id: "1",
        type: "image",
        previewUrl: null,
        posterUrl: null,
        originalUrl: "https://example.com/x.jpg",
        streamUrl: null,
        mp4Url: null,
        blurhash: null,
        width: null,
        height: null,
        aspectRatio: null,
        orientation: null,
      },
    ],
    likeCount: 0,
    commentCount: 0,
    rawFirestore: raw,
  };
}

describe("getForYouV5Page", () => {
  beforeEach(() => {
    resetForYouV5ReadyDeckForTests();
    vi.restoreAllMocks();
  });

  it("serves reels before regular and skips durable seen", async () => {
    const reels = [
      mkCand("r1", { tier: 5, authorId: "u1" }),
      mkCand("r2", { tier: 4, authorId: "u2" }),
      mkCand("r3", { tier: 3, authorId: "u3" }),
    ];
    const regulars = [mkCand("n1", { reel: false, authorId: "u4" }), mkCand("n2", { reel: false, authorId: "u5" })];
    const r1 = reels[0]!;
    const r2 = reels[1]!;
    const r3 = reels[2]!;
    const snapshot = {
      deckVersion: 1,
      loadedAtMs: Date.now(),
      randomMode: "randomKey" as const,
      regularAnchor: 0.5,
      reelTier5: [r1],
      reelTier4: [r2],
      reelOther: [r3],
      regular: regulars,
    };
    vi.spyOn(readyDeck, "ensureForYouV5ReadyDeck").mockResolvedValue({
      snapshot,
      cacheStatus: "memory_hit",
      dbReadEstimate: 0,
    });

    const repo = {
      isEnabled: () => true,
      resolveSortMode: async () => "randomKey" as const,
      fetchReelCandidatesForYouV5Deck: async () => [],
      fetchRegularReservoirForYouV5Deck: async () => ({ items: [], readCount: 0 }),
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
          playableMapped: 0,
        },
        tailRandomKey: null,
        tailDocId: null,
      }),
      readForYouV5CompactFeedState: async () => ({
        reelSeenPostIds: new Set<string>(["r1"]),
        regularSeenPostIds: new Set<string>(),
        readCount: 1,
      }),
      writeForYouV5CompactFeedState: async () => undefined,
      loadBlockedAuthorIdsForViewer: async () => ({ blocked: new Set<string>(), readCount: 0 }),
    };

    const first = await getForYouV5Page({
      repository: repo as never,
      viewerId: "user_test_v5",
      limit: 2,
      cursor: null,
      refresh: false,
      radiusFilter: { mode: "global", centerLat: null, centerLng: null, radiusMiles: null },
      dryRunSeen: true,
    });
    expect(first.items.map((x) => (x as { postId?: string }).postId)).toEqual(["r2", "r3"]);
    expect(first.debug.fallbackAllPostsUsed).toBe(false);
    const cursor = first.nextCursor;
    expect(cursor).toBeTruthy();
    const second = await getForYouV5Page({
      repository: repo as never,
      viewerId: "user_test_v5",
      limit: 5,
      cursor,
      refresh: false,
      radiusFilter: { mode: "global", centerLat: null, centerLng: null, radiusMiles: null },
      dryRunSeen: true,
    });
    expect(second.items.some((x) => (x as { postId?: string }).postId === "r2")).toBe(false);
    expect(second.items.map((x) => (x as { postId?: string }).postId)).toContain("n1");
  });

  it("read-only skips seen writes", async () => {
    const snapshot = {
      deckVersion: 2,
      loadedAtMs: Date.now(),
      randomMode: "randomKey" as const,
      regularAnchor: 0.2,
      reelTier5: [mkCand("a1", { tier: 5 })],
      reelTier4: [],
      reelOther: [],
      regular: [],
    };
    vi.spyOn(readyDeck, "ensureForYouV5ReadyDeck").mockResolvedValue({
      snapshot,
      cacheStatus: "memory_hit",
      dbReadEstimate: 0,
    });
    const write = vi.fn();
    const repo = {
      isEnabled: () => true,
      resolveSortMode: async () => "randomKey" as const,
      fetchReelCandidatesForYouV5Deck: async () => [],
      fetchRegularReservoirForYouV5Deck: async () => ({ items: [], readCount: 0 }),
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
          playableMapped: 0,
        },
        tailRandomKey: null,
        tailDocId: null,
      }),
      readForYouV5CompactFeedState: async () => ({
        reelSeenPostIds: new Set(),
        regularSeenPostIds: new Set(),
        readCount: 1,
      }),
      writeForYouV5CompactFeedState: write,
      loadBlockedAuthorIdsForViewer: async () => ({ blocked: new Set<string>(), readCount: 0 }),
    };
    await getForYouV5Page({
      repository: repo as never,
      viewerId: "user_write_test",
      limit: 1,
      cursor: null,
      refresh: false,
      radiusFilter: { mode: "global", centerLat: null, centerLng: null, radiusMiles: null },
      dryRunSeen: true,
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("throws invalid_simple_feed_cursor for malformed fys:v5 cursor", async () => {
    vi.spyOn(readyDeck, "ensureForYouV5ReadyDeck").mockResolvedValue({
      snapshot: {
        deckVersion: 1,
        loadedAtMs: Date.now(),
        randomMode: "randomKey",
        regularAnchor: 0,
        reelTier5: [mkCand("x1")],
        reelTier4: [],
        reelOther: [],
        regular: [],
      },
      cacheStatus: "memory_hit",
      dbReadEstimate: 0,
    });
    const repo = {
      isEnabled: () => true,
      resolveSortMode: async () => "randomKey" as const,
      fetchReelCandidatesForYouV5Deck: async () => [],
      fetchRegularReservoirForYouV5Deck: async () => ({ items: [], readCount: 0 }),
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
          playableMapped: 0,
        },
        tailRandomKey: null,
        tailDocId: null,
      }),
      readForYouV5CompactFeedState: async () => ({
        reelSeenPostIds: new Set<string>(),
        regularSeenPostIds: new Set<string>(),
        readCount: 0,
      }),
      writeForYouV5CompactFeedState: async () => undefined,
      loadBlockedAuthorIdsForViewer: async () => ({ blocked: new Set<string>(), readCount: 0 }),
    };
    await expect(
      getForYouV5Page({
        repository: repo as never,
        viewerId: "user_test_v5",
        limit: 5,
        cursor: "fys:v5:!!!",
        refresh: false,
        radiusFilter: { mode: "global", centerLat: null, centerLng: null, radiusMiles: null },
      })
    ).rejects.toThrow("invalid_simple_feed_cursor");
  });

  it("second authenticated no-cursor skips posts after compact seen write (fake timers)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const storedReel = new Set<string>();
    const snapshot = {
      deckVersion: 7,
      loadedAtMs: Date.now(),
      randomMode: "randomKey" as const,
      regularAnchor: 0.3,
      reelTier5: Array.from({ length: 24 }, (_, i) => mkCand(`seen_${i}`, { tier: 5, authorId: `u${i}` })),
      reelTier4: [],
      reelOther: [],
      regular: [],
    };
    vi.spyOn(readyDeck, "ensureForYouV5ReadyDeck").mockResolvedValue({
      snapshot,
      cacheStatus: "memory_hit",
      dbReadEstimate: 0,
    });
    const write = vi.fn(async (input: { reelSeenPostIds: string[] }) => {
      for (const id of input.reelSeenPostIds) storedReel.add(id);
    });
    const repo = {
      isEnabled: () => true,
      resolveSortMode: async () => "randomKey" as const,
      fetchReelCandidatesForYouV5Deck: async () => [],
      fetchRegularReservoirForYouV5Deck: async () => ({ items: [], readCount: 0 }),
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
          playableMapped: 0,
        },
        tailRandomKey: null,
        tailDocId: null,
      }),
      readForYouV5CompactFeedState: async () => ({
        reelSeenPostIds: new Set(storedReel),
        regularSeenPostIds: new Set<string>(),
        readCount: 1,
      }),
      writeForYouV5CompactFeedState: write,
      loadBlockedAuthorIdsForViewer: async () => ({ blocked: new Set<string>(), readCount: 0 }),
    };
    const prevSeen = process.env.FOR_YOU_SEEN_WRITES_ENABLED;
    const prevRo = process.env.FOR_YOU_VERIFY_READONLY;
    process.env.FOR_YOU_SEEN_WRITES_ENABLED = "true";
    process.env.FOR_YOU_VERIFY_READONLY = "0";
    const first = await getForYouV5Page({
      repository: repo as never,
      viewerId: "seen_chain_uid",
      limit: 5,
      cursor: null,
      refresh: false,
      radiusFilter: { mode: "global", centerLat: null, centerLng: null, radiusMiles: null },
    });
    await vi.runAllTimersAsync();
    const firstIds = first.items.map((x) => (x as { postId?: string }).postId).filter(Boolean) as string[];
    expect(firstIds.length).toBeGreaterThan(0);
    const second = await getForYouV5Page({
      repository: repo as never,
      viewerId: "seen_chain_uid",
      limit: 5,
      cursor: null,
      refresh: false,
      radiusFilter: { mode: "global", centerLat: null, centerLng: null, radiusMiles: null },
    });
    await vi.runAllTimersAsync();
    process.env.FOR_YOU_SEEN_WRITES_ENABLED = prevSeen;
    process.env.FOR_YOU_VERIFY_READONLY = prevRo;
    vi.useRealTimers();
    const secondIds = second.items.map((x) => (x as { postId?: string }).postId).filter(Boolean) as string[];
    for (const id of firstIds) {
      expect(secondIds.includes(id)).toBe(false);
    }
    expect(write).toHaveBeenCalled();
  });

  it("sets repeatRisk on authed no-cursor when verifyReadOnly blocks writes", async () => {
    vi.spyOn(readyDeck, "ensureForYouV5ReadyDeck").mockResolvedValue({
      snapshot: {
        deckVersion: 3,
        loadedAtMs: Date.now(),
        randomMode: "randomKey",
        regularAnchor: 0,
        reelTier5: [mkCand("r_only", { tier: 5 })],
        reelTier4: [],
        reelOther: [],
        regular: [],
      },
      cacheStatus: "memory_hit",
      dbReadEstimate: 0,
    });
    const repo = {
      isEnabled: () => true,
      resolveSortMode: async () => "randomKey" as const,
      fetchReelCandidatesForYouV5Deck: async () => [],
      fetchRegularReservoirForYouV5Deck: async () => ({ items: [], readCount: 0 }),
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
          playableMapped: 0,
        },
        tailRandomKey: null,
        tailDocId: null,
      }),
      readForYouV5CompactFeedState: async () => ({
        reelSeenPostIds: new Set<string>(),
        regularSeenPostIds: new Set<string>(),
        readCount: 0,
      }),
      writeForYouV5CompactFeedState: async () => undefined,
      loadBlockedAuthorIdsForViewer: async () => ({ blocked: new Set<string>(), readCount: 0 }),
    };
    const prev = process.env.FOR_YOU_SEEN_WRITES_ENABLED;
    process.env.FOR_YOU_SEEN_WRITES_ENABLED = "true";
    const res = await getForYouV5Page({
      repository: repo as never,
      viewerId: "repeat_risk_user",
      limit: 1,
      cursor: null,
      refresh: false,
      radiusFilter: { mode: "global", centerLat: null, centerLng: null, radiusMiles: null },
      verifyReadOnly: true,
    });
    process.env.FOR_YOU_SEEN_WRITES_ENABLED = prev;
    expect(res.debug.repeatRisk).toBe("fresh_no_cursor_requests_can_repeat_when_readonly");
    expect(res.debug.seenWriteSkippedReason).toBe("readonly");
  });

  it("has no duplicate post IDs across 40 V5 cursor pages (synthetic deck)", async () => {
    const reels: SimpleFeedCandidate[] = [];
    for (let i = 0; i < 900; i += 1) {
      reels.push(mkCand(`p_${i}`, { tier: 5, authorId: `author_${i % 40}` }));
    }
    const snapshot = {
      deckVersion: 99,
      loadedAtMs: Date.now(),
      randomMode: "randomKey" as const,
      regularAnchor: 0.1,
      reelTier5: reels,
      reelTier4: [],
      reelOther: [],
      regular: [],
    };
    vi.spyOn(readyDeck, "ensureForYouV5ReadyDeck").mockResolvedValue({
      snapshot,
      cacheStatus: "memory_hit",
      dbReadEstimate: 0,
    });
    const repo = {
      isEnabled: () => true,
      resolveSortMode: async () => "randomKey" as const,
      fetchReelCandidatesForYouV5Deck: async () => [],
      fetchRegularReservoirForYouV5Deck: async () => ({ items: [], readCount: 0 }),
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
          playableMapped: 0,
        },
        tailRandomKey: null,
        tailDocId: null,
      }),
      readForYouV5CompactFeedState: async () => ({
        reelSeenPostIds: new Set<string>(),
        regularSeenPostIds: new Set<string>(),
        readCount: 0,
      }),
      writeForYouV5CompactFeedState: async () => undefined,
      loadBlockedAuthorIdsForViewer: async () => ({ blocked: new Set<string>(), readCount: 0 }),
    };
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let p = 0; p < 40; p += 1) {
      const page = await getForYouV5Page({
        repository: repo as never,
        viewerId: "chain_user",
        limit: 5,
        cursor,
        refresh: false,
        radiusFilter: { mode: "global", centerLat: null, centerLng: null, radiusMiles: null },
        dryRunSeen: true,
      });
      const ids = page.items.map((x) => (x as { postId?: string }).postId).filter(Boolean) as string[];
      for (const id of ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      cursor = page.nextCursor;
      expect(cursor).toBeTruthy();
    }
    expect(seen.size).toBe(200);
  });
});
