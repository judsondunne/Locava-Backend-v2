import { describe, expect, it, vi } from "vitest";
import { PostsDetailOrchestrator } from "./posts-detail.orchestrator.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";

function buildService(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    loadPostCardSummary: vi.fn(async (_viewerId: string, postId: string) => ({
      postId,
      rankToken: "rank",
      author: { userId: "", handle: "", name: null, pic: null },
      captionPreview: "caption",
      media: { type: "video" as const, posterUrl: "https://cdn/p.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },
      social: { likeCount: 1, commentCount: 2 },
      viewer: { liked: false, saved: false },
      createdAtMs: 1,
      updatedAtMs: 1
    })),
    loadPostDetail: vi.fn(async (postId: string) => ({
      postId,
      userId: "u1",
      caption: "caption",
      createdAtMs: 1,
      mediaType: "video" as const,
      thumbUrl: "https://cdn/p.jpg",
      assets: [{ id: "a1", type: "video" as const, poster: "https://cdn/p.jpg", thumbnail: "https://cdn/p.jpg", variants: {} }]
    })),
    loadCommentsPreview: vi.fn(async () => null),
    loadPostDetailCachedProjection: vi.fn(async () => null),
    ...overrides
  };
  return base as any;
}

describe("posts detail orchestrator missing author hardening", () => {
  it("playback mode survives missing author fields", async () => {
    const service = buildService({
      loadPostCardSummary: vi.fn(async (_viewerId: string, postId: string) => ({
        postId,
        rankToken: "rank",
        author: undefined,
        captionPreview: "caption",
        media: { type: "video", posterUrl: "https://cdn/p.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" },
        social: undefined,
        viewer: undefined,
        createdAtMs: 1,
        updatedAtMs: 1
      }))
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "v1",
      postIds: ["p1"],
      reason: "prefetch",
      hydrationMode: "playback"
    });
    expect(out.found.length).toBe(1);
    expect(String(out.found[0]?.detail.firstRender.author.userId ?? "").length).toBeGreaterThan(0);
    expect(String(out.found[0]?.detail.firstRender.author.handle ?? "").length).toBeGreaterThan(0);
  });

  it("batch keeps good posts when one post throws unexpected error", async () => {
    const service = buildService({
      loadPostDetail: vi.fn(async (postId: string) => {
        if (postId === "bad") throw new TypeError("cannot read author");
        return {
          postId,
          userId: "u1",
          caption: "caption",
          createdAtMs: 1,
          mediaType: "image",
          thumbUrl: "https://cdn/p.jpg",
          assets: []
        };
      })
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "v1",
      postIds: ["ok", "bad"],
      reason: "prefetch",
      hydrationMode: "open"
    });
    expect(out.found.map((f) => f.postId)).toEqual(["ok"]);
    expect(out.debugMissingIds).toContain("bad");
  });

  it("reuses card summary and comments preview from hydrated detail for open route", async () => {
    const loadPostCardSummary = vi.fn(async (_viewerId: string, postId: string) => ({
      postId,
      rankToken: "rank",
      author: { userId: "summary-user", handle: "summary", name: "Summary User", pic: null },
      captionPreview: "summary caption",
      media: { type: "video" as const, posterUrl: "https://cdn/p.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },
      social: { likeCount: 1, commentCount: 2 },
      viewer: { liked: false, saved: false },
      createdAtMs: 1,
      updatedAtMs: 1
    }));
    const loadCommentsPreview = vi.fn(async () => [
      {
        commentId: "fallback-comment",
        userId: "fallback-user",
        text: "fallback text",
        createdAtMs: 1,
      },
    ]);
    const service = buildService({
      loadPostCardSummary,
      loadCommentsPreview,
      loadPostDetail: vi.fn(async (postId: string) => ({
        postId,
        userId: "detail-user",
        caption: "caption",
        createdAtMs: 1,
        mediaType: "video" as const,
        thumbUrl: "https://cdn/p.jpg",
        assets: [{ id: "a1", type: "video" as const, poster: "https://cdn/p.jpg", thumbnail: "https://cdn/p.jpg", variants: {} }],
        commentsPreview: [
          {
            commentId: "detail-comment",
            userId: "detail-user",
            text: "detail text",
            createdAtMs: 1,
          },
        ],
        cardSummary: {
          postId,
          rankToken: "detail-rank",
          author: { userId: "detail-user", handle: "detail", name: "Detail User", pic: null },
          captionPreview: "detail caption",
          media: { type: "video" as const, posterUrl: "https://cdn/p.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },
          social: { likeCount: 3, commentCount: 4 },
          viewer: { liked: true, saved: false },
          createdAtMs: 1,
          updatedAtMs: 1
        }
      }))
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.run({
      viewerId: "viewer-1",
      postId: "post-1"
    });
    expect(loadPostCardSummary).not.toHaveBeenCalled();
    expect(loadCommentsPreview).not.toHaveBeenCalled();
    expect(out.firstRender.author.userId).toBe("detail-user");
    expect(out.deferred.commentsPreview).toEqual([
      {
        commentId: "detail-comment",
        userId: "detail-user",
        text: "detail text",
        createdAtMs: 1,
        userName: null,
        userHandle: null,
        userPic: null,
      },
    ]);
  });

  it("playback mode stays on the lightweight card path and skips heavy detail hydration", async () => {
    const loadPostDetail = vi.fn(async (postId: string) => ({
      postId,
      userId: "detail-user",
      caption: "caption",
      activities: ["waterfall"],
      address: "Spirit Falls, Washington",
      lat: 45.7261286,
      lng: -121.6335058,
      geoData: {
        city: "Skamania County",
        state: "Washington",
        country: "United States",
        geohash: "c21s0hjnj",
      },
      playbackLab: {
        assets: {
          video_1: {
            generated: {
              startup720FaststartAvc: "https://cdn/startup720.mp4",
            },
          },
        },
      },
      createdAtMs: 1,
      updatedAtMs: 2,
      mediaType: "video" as const,
      thumbUrl: "https://cdn/p.jpg",
      assetsReady: true,
      assets: [
        {
          id: "video_1",
          type: "video" as const,
          original: "https://cdn/original.mp4",
          poster: "https://cdn/p.jpg",
          thumbnail: "https://cdn/p.jpg",
          variants: {
            main720Avc: "https://cdn/main720.mp4",
            startup720FaststartAvc: "https://cdn/startup720.mp4",
          },
        },
      ],
    }));
    const loadPostCardSummary = vi.fn(async (_viewerId: string, postId: string) => ({
      postId,
      rankToken: "rank",
      author: { userId: "", handle: "", name: null, pic: null },
      captionPreview: "caption",
      media: { type: "video" as const, posterUrl: "https://cdn/p.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },
      social: { likeCount: 1, commentCount: 2 },
      viewer: { liked: false, saved: false },
      createdAtMs: 1,
      updatedAtMs: 1,
      assets: [
        {
          id: "video_1",
          type: "video" as const,
          posterUrl: "https://cdn/p.jpg",
          previewUrl: "https://cdn/preview-low.mp4",
          mp4Url: "https://cdn/main720.mp4",
          originalUrl: "https://cdn/original.mp4",
          streamUrl: "https://cdn/master.m3u8",
          blurhash: null,
          width: null,
          height: null,
          aspectRatio: null,
          orientation: null,
        },
      ],
      assetsReady: true,
    }));
    const service = buildService({ loadPostDetail, loadPostCardSummary });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "viewer-1",
      postIds: ["post-1"],
      reason: "prefetch",
      hydrationMode: "playback",
    });
    expect(loadPostDetail).not.toHaveBeenCalled();
    const detail = out.found[0]?.detail.firstRender.post as Record<string, unknown>;
    expect(detail.address).toBeNull();
    expect(detail.playbackLab).toBeUndefined();
    expect(Array.isArray(detail.assets)).toBe(true);
    expect((detail.assets as Array<Record<string, unknown>>)[0]?.poster).toBe("https://cdn/p.jpg");
    expect(out.debugPayloadCategory).toBe("small");
    expect((detail.cardSummary as Record<string, unknown> | undefined)?.postId).toBe("post-1");
  });

  it("playback batch dedupes, caps to five posts, and stays under payload budget", async () => {
    const service = buildService();
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "viewer-1",
      postIds: ["p1", "p2", "p3", "p3", "p4", "p5", "p6", "p7"],
      reason: "prefetch",
      hydrationMode: "playback",
    });

    expect(out.found).toHaveLength(5);
    expect(out.missing).toEqual(["p6", "p7"]);
    expect(out.debugPayloadBytes).toBeLessThan(35_000);
    expect(
      out.found.every((row) => {
        const post = row.detail.firstRender.post as Record<string, unknown>;
        return post.comments === undefined && post.commentsPreview === undefined && post.playbackLab === undefined;
      }),
    ).toBe(true);
  });

  it("playback batch upgrades incomplete post_card_cache via source-of-truth when media is missing", async () => {
    const loadPostDetail = vi.fn(async (postId: string) => ({
      postId,
      userId: "u1",
      caption: "caption",
      createdAtMs: 1,
      updatedAtMs: 2,
      mediaType: "video" as const,
      thumbUrl: "https://cdn/from-truth.jpg",
      assetsReady: true,
      assets: [
        {
          id: "a1",
          type: "video" as const,
          poster: "https://cdn/from-truth.jpg",
          thumbnail: "https://cdn/from-truth.jpg",
          variants: { main720Avc: "https://cdn/from-truth.mp4" },
        },
      ],
    }));
    const loadPostCardSummary = vi.fn(async (_viewerId: string, postId: string) => ({
      postId,
      rankToken: "rank",
      author: { userId: "u1", handle: "u1", name: null, pic: null },
      captionPreview: "c",
      media: { type: "video" as const, posterUrl: "", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },
      social: { likeCount: 0, commentCount: 0 },
      viewer: { liked: false, saved: false },
      createdAtMs: 1,
      updatedAtMs: 1,
    }));
    const service = buildService({
      loadPostCardSummaryBatchLightweight: vi.fn(async () => [
        {
          postId: "p1",
          rankToken: "rank-1",
          author: { userId: "u1", handle: "u1", name: null, pic: null },
          captionPreview: "caption 1",
          media: { type: "video" as const, posterUrl: "", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },
          social: { likeCount: 1, commentCount: 0 },
          viewer: { liked: false, saved: false },
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ]),
      loadPostDetail,
      loadPostCardSummary,
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "viewer-1",
      postIds: ["p1"],
      reason: "prefetch",
      hydrationMode: "playback",
    });
    expect(loadPostDetail).toHaveBeenCalledTimes(1);
    const post = out.found[0]?.detail.firstRender.post as Record<string, unknown>;
    expect(post.posterPresent === true || Boolean(post.thumbUrl)).toBe(true);
    expect(out.itemStatuses?.[0]?.selectedSource).toBe("post_card_cache_upgraded");
    expect(post.playbackUrl).toBe("https://cdn/from-truth.mp4");
  });

  it("playback batch pulls full multi-image assets from Firestore when card cache carries one row", async () => {
    const loadPostDetail = vi.fn(async (postId: string) => ({
      postId,
      userId: "u1",
      caption: "caption",
      createdAtMs: 1,
      updatedAtMs: 2,
      mediaType: "image" as const,
      thumbUrl: "https://cdn/one.jpg",
      assets: Array.from({ length: 4 }).map((_, i) => ({
        id: `img-${i + 1}`,
        type: "image" as const,
        original: `https://cdn/${i}.jpg`,
        poster: `https://cdn/${i}.jpg`,
        thumbnail: `https://cdn/${i}.jpg`,
      })),
    }));
    const service = buildService({
      loadPostDetail,
      loadPostCardSummary: vi.fn(async (_viewerId: string, postId: string) => ({
        postId,
        rankToken: "rank-img",
        author: { userId: "u1", handle: "u1", name: null, pic: null },
        captionPreview: "caption",
        media: { type: "image" as const, posterUrl: "https://cdn/one.jpg", aspectRatio: 3 / 4, startupHint: "poster_only" as const },
        social: { likeCount: 0, commentCount: 0 },
        viewer: { liked: false, saved: false },
        createdAtMs: 1,
        updatedAtMs: 1,
        activities: [],
        address: null,
        geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
        title: null,
        firstAssetUrl: "https://cdn/one.jpg",
        assetCount: 4,
        assets: [
          {
            id: "img-1",
            type: "image" as const,
            previewUrl: null,
            posterUrl: "https://cdn/one.jpg",
            originalUrl: "https://cdn/one.jpg",
            blurhash: null,
            width: null,
            height: null,
            aspectRatio: null,
            orientation: null,
          },
        ],
      })),
      loadPostCardSummaryBatchLightweight: vi.fn(async (_viewerId: string, ids: string[]) =>
        ids.map((postId) => ({
          postId,
          rankToken: `rank-${postId}`,
          author: { userId: "u1", handle: "u1", name: null, pic: null },
          captionPreview: "caption",
          media: { type: "image" as const, posterUrl: "https://cdn/one.jpg", aspectRatio: 3 / 4, startupHint: "poster_only" as const },
          social: { likeCount: 0, commentCount: 0 },
          viewer: { liked: false, saved: false },
          createdAtMs: 1,
          updatedAtMs: 1,
          activities: [],
          address: null,
          geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
          title: null,
          firstAssetUrl: "https://cdn/one.jpg",
          assetCount: 4,
          assets: [
            {
              id: "img-1",
              type: "image" as const,
              previewUrl: null,
              posterUrl: "https://cdn/one.jpg",
              originalUrl: "https://cdn/one.jpg",
              blurhash: null,
              width: null,
              height: null,
              aspectRatio: null,
              orientation: null,
            },
          ],
        })),
      ),
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "viewer-1",
      postIds: ["gallery-1"],
      reason: "prefetch",
      hydrationMode: "playback",
    });
    expect(loadPostDetail).toHaveBeenCalledTimes(1);
    const post = out.found[0]?.detail.firstRender.post as Record<string, unknown>;
    expect(Array.isArray(post.assets)).toBe(true);
    expect((post.assets as unknown[]).length).toBe(4);
  });

  it("playback batch upgrades slim carousel shells past index two when Firestore read cap allows", async () => {
    const prevCap = process.env.LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP;
    process.env.LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP = "3";
    try {
      const loadPostDetail = vi.fn(async (postId: string) => ({
        postId,
        userId: "u1",
        caption: "caption",
        createdAtMs: 1,
        updatedAtMs: 2,
        mediaType: "image" as const,
        thumbUrl: "https://cdn/0.jpg",
        assets: [0, 1, 2, 3].map((i) => ({
          id: `img-${i}`,
          type: "image" as const,
          original: `https://cdn/${i}.jpg`,
          poster: `https://cdn/${i}.jpg`,
          thumbnail: `https://cdn/${i}.jpg`,
        })),
      }));
      const oneRowCard = (postId: string) => ({
        postId,
        rankToken: `rank-${postId}`,
        author: { userId: "u1", handle: "u1", name: null, pic: null },
        captionPreview: "caption",
        media: { type: "image" as const, posterUrl: "https://cdn/0.jpg", aspectRatio: 3 / 4, startupHint: "poster_only" as const },
        social: { likeCount: 0, commentCount: 0 },
        viewer: { liked: false, saved: false },
        createdAtMs: 1,
        updatedAtMs: 1,
        activities: [],
        address: null,
        geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
        title: null,
        firstAssetUrl: "https://cdn/0.jpg",
        assetCount: 4,
        assets: [
          {
            id: "img-0",
            type: "image" as const,
            previewUrl: null,
            posterUrl: "https://cdn/0.jpg",
            originalUrl: "https://cdn/0.jpg",
            blurhash: null,
            width: null,
            height: null,
            aspectRatio: null,
            orientation: null,
          },
        ],
      });
      const ids = ["g0", "g1", "g2", "g3", "g4"];
      const loadPostCardSummaryBatchLightweight = vi.fn(async (_v: string, batch: string[]) => batch.map((postId) => oneRowCard(postId)));
      const service = buildService({
        loadPostDetail,
        loadPostCardSummary: vi.fn(async (_v: string, postId: string) => oneRowCard(postId)),
        loadPostCardSummaryBatchLightweight,
      });
      const orchestrator = new PostsDetailOrchestrator(service);
      const out = await orchestrator.runBatch({
        viewerId: "viewer-1",
        postIds: ids,
        reason: "prefetch",
        hydrationMode: "playback",
      });
      expect(loadPostDetail).toHaveBeenCalledTimes(3);
      const byPost = new Map(out.found.map((row) => [row.postId, row.detail.firstRender.post as { assets: unknown[] }]));
      expect(byPost.get("g0")?.assets.length).toBe(4);
      expect(byPost.get("g1")?.assets.length).toBe(4);
      expect(byPost.get("g2")?.assets.length).toBe(4);
      expect(byPost.get("g3")?.assets.length).toBe(1);
      expect(byPost.get("g4")?.assets.length).toBe(1);
      expect((byPost.get("g3") as Record<string, unknown>).requiresAssetHydration).toBe(true);
      expect((byPost.get("g3") as Record<string, unknown>).mediaCompleteness).toBe("cover_only");
    } finally {
      if (prevCap === undefined) delete process.env.LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP;
      else process.env.LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP = prevCap;
    }
  });

  it("playback batch spends read cap on visible carousel gaps before prefetch tail", async () => {
    const prevCap = process.env.LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP;
    const prevHead = process.env.LOCAVA_BATCH_VISIBLE_HEAD_SLOTS;
    process.env.LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP = "1";
    process.env.LOCAVA_BATCH_VISIBLE_HEAD_SLOTS = "3";
    try {
      const bundle = (postId: string) => ({
        postId,
        userId: "u1",
        caption: "caption",
        createdAtMs: 1,
        updatedAtMs: 2,
        mediaType: "image" as const,
        thumbUrl: "https://cdn/0.jpg",
        assets: ["a", "b", "c", "d"].map((l, idx) => ({
          id: `img-${idx}`,
          type: "image" as const,
          original: `https://cdn/${l}.jpg`,
          poster: `https://cdn/${l}.jpg`,
          thumbnail: `https://cdn/${l}.jpg`,
        })),
      });
      const slimCard = (postId: string) => ({
        postId,
        rankToken: `rank-${postId}`,
        author: { userId: "u1", handle: "u1", name: null, pic: null },
        captionPreview: "caption",
        media: { type: "image" as const, posterUrl: "https://cdn/a.jpg", aspectRatio: 3 / 4, startupHint: "poster_only" as const },
        social: { likeCount: 0, commentCount: 0 },
        viewer: { liked: false, saved: false },
        createdAtMs: 1,
        updatedAtMs: 1,
        activities: [],
        address: null,
        geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
        title: null,
        firstAssetUrl: "https://cdn/a.jpg",
        assetCount: 4,
        rawFirestoreAssetCount: 4,
        assets: [
          {
            id: "img-0",
            type: "image" as const,
            previewUrl: null,
            posterUrl: "https://cdn/a.jpg",
            originalUrl: "https://cdn/a.jpg",
            blurhash: null,
            width: null,
            height: null,
            aspectRatio: null,
            orientation: null,
          },
        ],
      });
      const loadPostDetail = vi.fn(async (pid: string) => bundle(pid));
      const ids = ["vis-a", "vis-b", "vis-c", "pre-d"];
      const loadPostCardSummaryBatchLightweight = vi.fn(async (_viewerId: string, batch: string[]) =>
        batch.map((postId) => slimCard(postId)),
      );
      const service = buildService({
        loadPostDetail,
        loadPostCardSummaryBatchLightweight,
      });
      const orchestrator = new PostsDetailOrchestrator(service);
      const svcOut = await orchestrator.runBatch({
        viewerId: "viewer-1",
        postIds: ids,
        reason: "prefetch",
        hydrationMode: "playback",
      });
      expect(loadPostDetail).toHaveBeenCalledTimes(1);
      expect(loadPostDetail.mock.calls[0]?.[0]).toBe("vis-a");
      const upgraded = svcOut.found.find((row) => row.postId === "vis-a")?.detail.firstRender.post as Record<string, unknown>;
      const cappedPref = svcOut.found.find((row) => row.postId === "pre-d")?.detail.firstRender.post as Record<string, unknown>;
      expect(Array.isArray(upgraded?.assets) && (upgraded?.assets as unknown[]).length === 4).toBe(true);
      expect(Boolean(cappedPref?.requiresAssetHydration)).toBe(true);
      expect(cappedPref?.mediaCompleteness).toBe("cover_only");
    } finally {
      if (prevCap === undefined) delete process.env.LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP;
      else process.env.LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP = prevCap;
      if (prevHead === undefined) delete process.env.LOCAVA_BATCH_VISIBLE_HEAD_SLOTS;
      else process.env.LOCAVA_BATCH_VISIBLE_HEAD_SLOTS = prevHead;
    }
  });

  it("playback batch skips Firestore reads when carousel assets already match canonical count", async () => {
    const loadPostDetail = vi.fn(async (_postId: string) => {
      throw new Error("should_skip_detail");
    });
    const service = buildService({
      loadPostDetail,
      loadPostCardSummaryBatchLightweight: vi.fn(async () => [
        {
          postId: "full-gallery",
          rankToken: "rank-full",
          author: { userId: "u1", handle: "u1", name: null, pic: null },
          captionPreview: "caption",
          media: { type: "image" as const, posterUrl: "https://cdn/0.jpg", aspectRatio: 1, startupHint: "poster_only" as const },
          social: { likeCount: 0, commentCount: 0 },
          viewer: { liked: false, saved: false },
          createdAtMs: 1,
          updatedAtMs: 1,
          activities: [],
          address: null,
          geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
          title: null,
          firstAssetUrl: "https://cdn/0.jpg",
          assetCount: 3,
          rawFirestoreAssetCount: 3,
          assets: ["https://cdn/0.jpg", "https://cdn/1.jpg", "https://cdn/2.jpg"].map((url, i) => ({
            id: `img-${i}`,
            type: "image" as const,
            previewUrl: null,
            posterUrl: url,
            originalUrl: url,
            blurhash: null,
            width: null,
            height: null,
            aspectRatio: null,
            orientation: null,
          })),
        },
      ]),
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "viewer-1",
      postIds: ["full-gallery"],
      reason: "prefetch",
      hydrationMode: "playback",
    });
    expect(loadPostDetail).not.toHaveBeenCalled();
    const post = out.found[0]?.detail.firstRender.post as Record<string, unknown>;
    expect((post.assets as unknown[]).length).toBe(3);
    const originals = (post.assets as Array<{ original?: string | null; id?: string }>).map((a) =>
      String(a.original ?? a.id ?? ""),
    );
    expect(new Set(originals).size).toBe(3);
  });

  it("playback batch upgrades preview-only card cache using Firestore detail assets", async () => {
    const loadPostDetail = vi.fn(async (postId: string) => ({
      postId,
      userId: "u1",
      caption: "caption",
      createdAtMs: 1,
      updatedAtMs: 2,
      mediaType: "video" as const,
      thumbUrl: "https://cdn/poster.jpg",
      assetsReady: true,
      assets: [
        {
          id: "a1",
          type: "video" as const,
          poster: "https://cdn/poster.jpg",
          thumbnail: "https://cdn/poster.jpg",
          original: "https://cdn/original.mp4",
          variants: {
            preview360: "https://cdn/preview360.mp4",
            main720Avc: "https://cdn/main720.mp4",
            main1080Avc: "https://cdn/main1080.mp4",
          },
        },
      ],
    }));
    const loadPostCardSummaryBatchLightweight = vi.fn(async () => [
      {
        postId: "pv1",
        rankToken: "rank-1",
        author: { userId: "u1", handle: "u1", name: null, pic: null },
        captionPreview: "c",
        media: { type: "video" as const, posterUrl: "https://cdn/poster.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },
        social: { likeCount: 0, commentCount: 0 },
        viewer: { liked: false, saved: false },
        createdAtMs: 1,
        updatedAtMs: 1,
        assets: [
          {
            id: "a1",
            type: "video" as const,
            posterUrl: "https://cdn/poster.jpg",
            previewUrl: "https://cdn/preview360.mp4",
            mp4Url: null,
            originalUrl: null,
            streamUrl: null,
            blurhash: null,
            width: null,
            height: null,
            aspectRatio: null,
            orientation: null,
          },
        ],
        assetsReady: true,
      },
    ]);
    const service = buildService({
      loadPostDetail,
      loadPostCardSummaryBatchLightweight,
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "viewer-1",
      postIds: ["pv1"],
      reason: "prefetch",
      hydrationMode: "playback",
    });
    expect(loadPostDetail).toHaveBeenCalledTimes(1);
    const post = out.found[0]?.detail.firstRender.post as Record<string, unknown>;
    expect(post.playbackUrl).toBe("https://cdn/main1080.mp4");
  });

  it("playback cold fallback can return partial cached shells without blocking on misses", async () => {
    const productionAsset = {
      id: "a1",
      type: "video" as const,
      posterUrl: "https://cdn/poster.jpg",
      previewUrl: "https://cdn/preview.mp4",
      mp4Url: "https://cdn/main720.mp4",
      originalUrl: "https://cdn/original.mp4",
      blurhash: null,
      width: null,
      height: null,
      aspectRatio: null,
      orientation: null,
    };
    const service = buildService({
      loadPostCardSummaryBatchLightweight: vi.fn(async () => [
        {
          postId: "p1",
          rankToken: "rank-1",
          author: { userId: "u1", handle: "u1", name: "User 1", pic: null },
          captionPreview: "caption 1",
          media: { type: "video" as const, posterUrl: "https://cdn/p1.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },
          social: { likeCount: 1, commentCount: 0 },
          viewer: { liked: false, saved: false },
          createdAtMs: 1,
          updatedAtMs: 1,
          assets: [{ ...productionAsset, posterUrl: "https://cdn/p1.jpg" }],
          assetsReady: true,
        },
        {
          postId: "p3",
          rankToken: "rank-3",
          author: { userId: "u3", handle: "u3", name: "User 3", pic: null },
          captionPreview: "caption 3",
          media: { type: "video" as const, posterUrl: "https://cdn/p3.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },
          social: { likeCount: 3, commentCount: 0 },
          viewer: { liked: false, saved: false },
          createdAtMs: 3,
          updatedAtMs: 3,
          assets: [{ ...productionAsset, posterUrl: "https://cdn/p3.jpg" }],
          assetsReady: true,
        },
      ]),
      loadPostDetail: vi.fn(async () => {
        throw new Error("should stay on lightweight path");
      }),
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "viewer-1",
      postIds: ["p1", "p2", "p3"],
      reason: "prefetch",
      hydrationMode: "playback",
    });

    expect(out.found.map((row) => row.postId)).toEqual(["p1", "p3"]);
    expect(out.missing).toEqual(["p2"]);
    expect(service.loadPostDetail).not.toHaveBeenCalled();
  });

  it("detail DTO keeps mediaStatus processing but still surfaces HTTPS playback while assets churn", async () => {
    const service = buildService({
      loadPostDetail: vi.fn(async (postId: string) => ({
        postId,
        userId: "creator-1",
        caption: "fresh video",
        createdAtMs: 1,
        updatedAtMs: 2,
        mediaType: "video" as const,
        thumbUrl: "https://cdn/poster.jpg",
        assetsReady: false,
        videoProcessingStatus: "processing",
        instantPlaybackReady: false,
        carouselFitWidth: true,
        letterboxGradients: [{ top: "#111111", bottom: "#222222" }],
        fallbackVideoUrl: "https://cdn/original.mp4",
        assets: [
          {
            id: "video_1",
            type: "video" as const,
            original: "https://cdn/original.mp4",
            poster: "https://cdn/poster.jpg",
            thumbnail: "https://cdn/poster.jpg",
            variants: {
              poster: "https://cdn/poster.jpg",
            },
          },
        ],
      })),
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.run({
      viewerId: "viewer-1",
      postId: "post-fresh-video",
    });
    expect(out.firstRender.post.mediaReadiness).toMatchObject({
      mediaStatus: "processing",
      assetsReady: false,
      playbackReady: true,
      playbackUrlPresent: true,
      posterReady: true,
      fallbackVideoUrl: "https://cdn/original.mp4",
      resizeMode: "contain",
      processingButPlayable: true,
      selectedVideoVariant: "original",
    });
    expect(out.firstRender.post.playbackReady).toBe(true);
    expect(out.firstRender.post.playbackUrlPresent).toBe(true);
    expect(out.firstRender.post.playbackUrl).toBe("https://cdn/original.mp4");
  });

  it("returns degraded 200 fallback detail when source-of-truth fails but card cache exists", async () => {
    const service = buildService({
      loadPostDetail: vi.fn(async () => {
        throw new SourceOfTruthRequiredError("feed_detail_firestore");
      }),
      loadPostDetailCachedProjection: vi.fn(async () => ({
        source: "post_card_cache",
        card: {
          postId: "post-cached-1",
          rankToken: "rank-cached",
          author: { userId: "u1", handle: "u1", name: "User 1", pic: null },
          captionPreview: "cached caption",
          media: { type: "video", posterUrl: "https://cdn/poster.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" },
          assets: [
            {
              id: "asset-1",
              type: "video",
              previewUrl: null,
              posterUrl: "https://cdn/poster.jpg",
              originalUrl: "https://cdn/original.mp4",
              mp4Url: null,
              streamUrl: null,
              blurhash: null,
              width: null,
              height: null,
              aspectRatio: null,
              orientation: null,
            },
          ],
          fallbackVideoUrl: "https://cdn/original.mp4",
          social: { likeCount: 0, commentCount: 0 },
          viewer: { liked: false, saved: false },
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      })),
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.run({
      viewerId: "viewer-1",
      postId: "post-cached-1",
    });
    expect(out.degraded).toBe(true);
    expect(out.fallbacks).toContain("fallback_cached_projection");
    expect(out.firstRender.post.mediaType).toBe("video");
    expect(String((out.firstRender.post as { playbackUrl?: string }).playbackUrl ?? "")).toContain("https://cdn/original.mp4");
    expect(
      Boolean(out.firstRender.post.playbackUrl) || Boolean(out.firstRender.post.fallbackVideoUrl),
    ).toBe(true);
  });

  it("batch playback returns partial_cached status on source-of-truth timeout with cache projection", async () => {
    const service = buildService({
      loadPostCardSummaryBatchLightweight: vi.fn(async () => []),
      loadPostDetail: vi.fn(async () => {
        throw new SourceOfTruthRequiredError("feed_detail_firestore");
      }),
      loadPostDetailCachedProjection: vi.fn(async (postId: string) => ({
        source: "post_card_cache",
        card: {
          postId,
          rankToken: "rank-cached",
          author: { userId: "u1", handle: "u1", name: "User 1", pic: null },
          captionPreview: "cached caption",
          media: { type: "video", posterUrl: "https://cdn/poster.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" },
          assets: [
            {
              id: "asset-1",
              type: "video",
              previewUrl: null,
              posterUrl: "https://cdn/poster.jpg",
              originalUrl: "https://cdn/original.mp4",
              mp4Url: "https://cdn/main720.mp4",
              streamUrl: null,
              blurhash: null,
              width: null,
              height: null,
              aspectRatio: null,
              orientation: null,
            },
          ],
          social: { likeCount: 0, commentCount: 0 },
          viewer: { liked: false, saved: false },
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      })),
    });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "viewer-1",
      postIds: ["post-cached-1"],
      reason: "prefetch",
      hydrationMode: "open",
    });
    expect(out.found).toHaveLength(1);
    expect(out.itemStatuses?.[0]).toMatchObject({
      postId: "post-cached-1",
      status: "partial_cached",
    });
    const post = out.found[0]?.detail.firstRender.post as Record<string, unknown>;
    expect(Boolean(post.playbackUrl) || Boolean(post.fallbackVideoUrl)).toBe(true);
  });
});
