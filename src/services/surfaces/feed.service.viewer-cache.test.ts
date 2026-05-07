import { describe, expect, it, vi } from "vitest";
import { FeedService } from "./feed.service.js";

describe("FeedService post detail cache safety", () => {
  it("does not share viewer-specific detail cache entries across viewers", async () => {
    const getPostDetail = vi.fn(async (postId: string, viewerId: string) => ({
      postId,
      viewerIdEcho: viewerId,
      userId: "author-1",
      caption: "hello",
      createdAtMs: 1,
      mediaType: "video",
      thumbUrl: "https://cdn.example.com/p.jpg",
      assets: [],
    }));
    const service = new FeedService({ getPostDetail } as unknown as any);

    const a = await service.loadPostDetail("post-cache-safe-1", "viewer-a");
    const b = await service.loadPostDetail("post-cache-safe-1", "viewer-b");

    expect(getPostDetail).toHaveBeenCalledTimes(2);
    expect((a as { viewerIdEcho?: string }).viewerIdEcho).toBe("viewer-a");
    expect((b as { viewerIdEcho?: string }).viewerIdEcho).toBe("viewer-b");
  });
});
