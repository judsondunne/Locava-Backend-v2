import { describe, expect, it } from "vitest";
import { buildPostMediaReadiness } from "./media-readiness.js";

describe("buildPostMediaReadiness (video playbackReady)", () => {
  it("marks playbackReady when startup lab URL exists and differs from original", () => {
    const r = buildPostMediaReadiness({
      assetsReady: false,
      videoProcessingStatus: "processing",
      assets: [
        {
          type: "video",
          id: "video_a",
          original: "https://cdn.example.com/original.mp4",
          variants: {},
          playbackLab: {
            generated: {
              startup720FaststartAvc: "https://cdn.example.com/startup720.mp4"
            }
          }
        }
      ]
    });
    expect(r.playbackReady).toBe(true);
    expect(r.playbackUrlPresent).toBe(true);
    expect(r.mediaStatus).toBe("processing");
  });

  it("still exposes playable original bytes when ladder keys only alias the uploaded file", () => {
    const orig = "https://cdn.example.com/original.mp4";
    const r = buildPostMediaReadiness({
      assetsReady: true,
      videoProcessingStatus: "completed",
      assets: [
        {
          type: "video",
          id: "video_a",
          original: orig,
          variants: {
            preview360Avc: orig,
            main720: orig,
            main720Avc: orig
          }
        }
      ]
    });
    expect(r.playbackUrlPresent).toBe(true);
    expect(r.playbackReady).toBe(true);
    expect(r.selectedVideoVariant).toBe("original");
  });

  it("marks media ready when processing completed and assets ready", () => {
    const r = buildPostMediaReadiness({
      assetsReady: true,
      videoProcessingStatus: "completed",
      assets: [
        {
          type: "video",
          id: "video_a",
          original: "https://cdn.example.com/original.mp4",
          variants: {
            preview360Avc: "https://cdn.example.com/p360.mp4",
            main720Avc: "https://cdn.example.com/m720.mp4",
            main720: "https://cdn.example.com/m720.mp4"
          }
        }
      ]
    });
    expect(r.mediaStatus).toBe("ready");
    expect(r.playbackReady).toBe(true);
  });

  it("treats failed encode as playable processing when originals still resolve", () => {
    const r = buildPostMediaReadiness({
      assetsReady: false,
      videoProcessingStatus: "failed",
      assets: [
        {
          type: "video",
          id: "video_a",
          original: "https://cdn.example.com/original.mp4",
          variants: {}
        }
      ]
    });
    expect(r.mediaStatus).toBe("processing");
    expect(r.playbackUrlPresent).toBe(true);
    expect(r.playbackReady).toBe(true);
    expect(r.processingButPlayable).toBe(true);
  });

  it("marks failure when ladder failed with no selectable playback url", () => {
    const r = buildPostMediaReadiness({
      assetsReady: false,
      videoProcessingStatus: "failed",
      assets: [{ type: "video", variants: {}, original: "" }]
    });
    expect(r.mediaStatus).toBe("failed");
    expect(r.playbackUrlPresent).toBe(false);
    expect(r.processingButPlayable).not.toBe(true);
  });
});
