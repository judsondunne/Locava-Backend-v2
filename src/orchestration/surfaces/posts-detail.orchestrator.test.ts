import { describe, expect, it, vi } from "vitest";
import { PostsDetailOrchestrator } from "./posts-detail.orchestrator.js";

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
    const service = buildService({ loadPostDetail });
    const orchestrator = new PostsDetailOrchestrator(service);
    const out = await orchestrator.runBatch({
      viewerId: "viewer-1",
      postIds: ["post-1"],
      reason: "prefetch",
      hydrationMode: "playback",
    });
    expect(loadPostDetail).not.toHaveBeenCalled();
    const detail = out.found[0]?.detail.firstRender.post as Record<string, unknown>;
    expect(detail.address).toBeUndefined();
    expect(detail.playbackLab).toBeUndefined();
    expect(Array.isArray(detail.assets)).toBe(true);
    expect((detail.assets as Array<Record<string, unknown>>)[0]?.poster).toBe("https://cdn/p.jpg");
    expect(out.debugPayloadCategory).toBe("small");
    expect((detail.cardSummary as Record<string, unknown> | undefined)?.postId).toBe("post-1");
  });
});
