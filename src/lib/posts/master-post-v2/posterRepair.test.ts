import { describe, expect, it } from "vitest";
import { evaluatePosterRepairNeed } from "./posterRepair.js";

describe("evaluatePosterRepairNeed", () => {
  it("flags external instagram poster as repair-required", () => {
    const doc = {
      classification: { mediaKind: "video" },
      media: {
        cover: {
          url: "https://scontent.cdninstagram.com/v/t51/poster.jpg"
        },
        assets: []
      },
      compatibility: {}
    };
    const r = evaluatePosterRepairNeed(doc);
    expect(r.needsPosterRepair).toBe(true);
    expect(r.reason).toBe("external_expiring_poster");
  });

  it("accepts durable wasabi poster as poster_ok", () => {
    const doc = {
      classification: { mediaKind: "video" },
      media: {
        cover: {
          url: "https://s3.wasabisys.com/locava.app/videos-lab/post_x/v1/poster_high.jpg"
        },
        assets: []
      }
    };
    const r = evaluatePosterRepairNeed(doc);
    expect(r.needsPosterRepair).toBe(false);
    expect(r.reason).toBe("poster_ok");
    expect(r.durablePosterUrl).toContain("wasabisys.com");
  });

  it("ignores image-kind posts for video poster gate", () => {
    const doc = {
      classification: { mediaKind: "image" },
      media: {
        cover: {
          url: "https://cdninstagram.com/image.jpg"
        },
        assets: []
      }
    };
    const r = evaluatePosterRepairNeed(doc);
    expect(r.needsPosterRepair).toBe(false);
    expect(r.reason).toBe("poster_ok");
  });
});
