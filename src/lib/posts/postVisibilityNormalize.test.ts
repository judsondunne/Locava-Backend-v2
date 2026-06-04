import { describe, expect, it } from "vitest";
import { StandardizedPostDocSchema } from "../../contracts/standardized-post-doc.contract.js";
import {
  coerceStandardizedVisibility,
  normalizePostVisibilityForWrite,
} from "./postVisibilityNormalize.js";
import { standardizePostDocForRender } from "../../services/posts/standardize-post-doc-for-render.js";

describe("postVisibilityNormalize", () => {
  it("normalizePostVisibilityForWrite maps legacy strings to master enum", () => {
    expect(normalizePostVisibilityForWrite("Public Route")).toBe("public");
    expect(normalizePostVisibilityForWrite("unknown")).toBe("unknown");
    expect(normalizePostVisibilityForWrite("friends")).toBe("friends");
    expect(normalizePostVisibilityForWrite("group")).toBe("friends");
  });

  it("coerceStandardizedVisibility maps master enum to standardized enum", () => {
    expect(coerceStandardizedVisibility("friends")).toBe("group");
    expect(coerceStandardizedVisibility("unknown")).toBe("public");
    expect(coerceStandardizedVisibility("public")).toBe("public");
  });

  it("route claim unknown visibility survives standardize + zod", () => {
    const PLAYABLE =
      "https://s3.wasabisys.com/locava.app/videos-lab/post_profile_video_post_1/video_af884066e4_0/startup720_faststart_avc.mp4";
    const POSTER =
      "https://s3.us-east-1.wasabisys.com/locava.app/videos/video_af884066e4_0_poster.jpg";
    const raw = {
      id: "post_test_visibility",
      postId: "post_test_visibility",
      isRoute: true,
      postType: "route",
      routeSource: "undiscovered_claim",
      privacy: "Public Route",
      classification: {
        visibility: "unknown",
        privacyLabel: "Public Route",
      },
      media: {
        assets: [
          {
            id: "v0",
            index: 0,
            type: "video",
            video: {
              originalUrl: PLAYABLE,
              posterUrl: POSTER,
              thumbnailUrl: POSTER,
              playback: {
                primaryUrl: PLAYABLE,
                startupUrl: PLAYABLE,
                defaultUrl: PLAYABLE,
                selectedReason: "canonical",
              },
              readiness: { processingStatus: "ready", assetsReady: true, instantPlaybackReady: true },
              technical: { width: 720, height: 1280 },
            },
          },
        ],
      },
    };
    const result = standardizePostDocForRender(raw, "post_test_visibility");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = StandardizedPostDocSchema.safeParse(result.doc);
    expect(parsed.success).toBe(true);
    expect(result.doc.classification.visibility).toBe("public");
  });
});
