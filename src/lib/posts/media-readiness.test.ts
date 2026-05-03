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

  it("does not mark playbackReady when only original-sized aliases exist", () => {
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
    expect(r.playbackUrlPresent).toBe(false);
    expect(r.playbackReady).toBe(false);
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
});
