import { describe, expect, it, vi } from "vitest";
import { PostingFinalizeOrchestrator } from "./posting-finalize.orchestrator.js";

describe("PostingFinalizeOrchestrator", () => {
  it("includes explicit media readiness fields in finalize responses", async () => {
    const service = {
      finalizePosting: vi.fn(async () => ({
        session: {} as never,
        operation: {
          postId: "post_123",
          operationId: "op_123",
          state: "processing",
          pollAfterMs: 1500,
        },
        idempotent: false,
        canonicalCreated: true,
        mediaReadiness: {
          mediaStatus: "processing" as const,
          assetsReady: false,
          videoProcessingStatus: "processing",
          posterReady: true,
          posterPresent: true,
          posterUrl: "https://cdn.example.com/poster.jpg",
          playbackReady: false,
          playbackUrlPresent: false,
          fallbackVideoUrl: "https://cdn.example.com/original.mp4",
          instantPlaybackReady: false,
          hasVideo: true,
          aspectRatio: 9 / 16,
          width: 720,
          height: 1280,
          resizeMode: "contain" as const,
          gradientTop: "#111111",
          gradientBottom: "#222222",
        },
      })),
    };
    const orchestrator = new PostingFinalizeOrchestrator(service as never);
    const out = await orchestrator.run({
      viewerId: "viewer-1",
      sessionId: "session-1",
      idempotencyKey: "idem-1",
      mediaCount: 1,
    });
    expect(out.mediaReadiness).toMatchObject({
      mediaStatus: "processing",
      assetsReady: false,
      playbackReady: false,
      playbackUrlPresent: false,
      posterReady: true,
      fallbackVideoUrl: "https://cdn.example.com/original.mp4",
      resizeMode: "contain",
    });
    expect(out.playbackReady).toBe(false);
    expect(out.playbackUrlPresent).toBe(false);
    expect(out.posterReady).toBe(true);
  });
});
