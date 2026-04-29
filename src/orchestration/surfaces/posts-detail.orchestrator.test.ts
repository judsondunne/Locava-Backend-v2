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
      hydrationMode: "playback"
    });
    expect(out.found.map((f) => f.postId)).toEqual(["ok"]);
    expect(out.debugMissingIds).toContain("bad");
  });
});

