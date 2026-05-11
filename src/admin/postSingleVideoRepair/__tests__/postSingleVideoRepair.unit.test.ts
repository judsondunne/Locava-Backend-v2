import { describe, expect, it } from "vitest";
import { assertTrustedOriginalVideoUrl, buildPostSingleVideoRepairPlan } from "../postSingleVideoRepair.service.js";

describe("assertTrustedOriginalVideoUrl", () => {
  it("accepts wasabisys and locava.app and amazonaws", () => {
    expect(() =>
      assertTrustedOriginalVideoUrl("https://s3.us-east-1.wasabisys.com/bucket/key.mp4")
    ).not.toThrow();
    expect(() => assertTrustedOriginalVideoUrl("https://cdn.locava.app/v/x.mp4")).not.toThrow();
    expect(() => assertTrustedOriginalVideoUrl("https://my-bucket.s3.amazonaws.com/o.mp4")).not.toThrow();
  });
  it("rejects http, staging path, and bad hosts", () => {
    expect(() => assertTrustedOriginalVideoUrl("http://s3.us-east-1.wasabisys.com/x.mp4")).toThrow();
    expect(() =>
      assertTrustedOriginalVideoUrl("https://s3.us-east-1.wasabisys.com/b/postSessionStaging/x.mp4")
    ).toThrow();
    expect(() => assertTrustedOriginalVideoUrl("https://evil.example/x.mp4")).toThrow();
  });
});

describe("buildPostSingleVideoRepairPlan", () => {
  const postId = "0123456789abcdef";
  const url = "https://s3.us-east-1.wasabisys.com/b/good.mp4";

  it("builds plan for compact-like single video", () => {
    const raw = {
      id: postId,
      postId,
      userId: "u1",
      title: "Trail",
      activities: ["hike"],
      lat: 40.1,
      lng: -74.2,
      reel: true,
      media: {
        assets: [
          {
            id: "0123456789abcdef_asset_0",
            type: "video",
            video: { posterUrl: "https://cdn.locava.app/p.jpg" },
            original: url
          }
        ]
      }
    };
    const r = buildPostSingleVideoRepairPlan(raw, postId, url);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.postId).toBe(postId);
      expect(r.plan.assetId).toBe("0123456789abcdef_asset_0");
      expect(r.plan.posterUrl).toContain("locava.app");
    }
  });

  it("accepts legacy post_ prefix in request and normalizes to Firestore doc id", () => {
    const raw = {
      id: postId,
      postId,
      userId: "u1",
      title: "Trail",
      activities: ["hike"],
      lat: 40.1,
      lng: -74.2,
      reel: true,
      media: {
        assets: [
          {
            id: "0123456789abcdef_asset_0",
            type: "video",
            video: { posterUrl: "https://cdn.locava.app/p.jpg" },
            original: url
          }
        ]
      }
    };
    const r = buildPostSingleVideoRepairPlan(raw, "post_" + postId, url);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.postId).toBe(postId);
  });

  it("fails when not exactly one video row", () => {
    const raw = {
      id: postId,
      userId: "u1",
      title: "T",
      activities: ["a"],
      lat: 1,
      lng: 2,
      reel: true,
      media: { assets: [] }
    };
    const r = buildPostSingleVideoRepairPlan(raw, postId, url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("expected_exactly_one_asset_row");
  });
});
