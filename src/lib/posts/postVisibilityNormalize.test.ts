import { describe, expect, it } from "vitest";
import { StandardizedPostDocSchema } from "../../contracts/standardized-post-doc.contract.js";
import {
  coerceStandardizedVisibility,
  ensureStandardizedClassificationVisibility,
  normalizeClassificationVisibility,
  normalizePostVisibilityForWrite,
} from "./postVisibilityNormalize.js";
import { standardizePostDocForRender } from "../../services/posts/standardize-post-doc-for-render.js";

describe("postVisibilityNormalize", () => {
  it("normalizePostVisibilityForWrite maps unknown and Public Route to public", () => {
    expect(normalizePostVisibilityForWrite("Public Route")).toBe("public");
    expect(normalizePostVisibilityForWrite("unknown")).toBe("public");
    expect(normalizePostVisibilityForWrite("unknown", "Public Route", "Public Route")).toBe(
      "public",
    );
    expect(normalizePostVisibilityForWrite("friends")).toBe("friends");
    expect(normalizePostVisibilityForWrite("group")).toBe("friends");
  });

  it("normalizeClassificationVisibility respects private labels", () => {
    expect(normalizeClassificationVisibility("unknown", "Private Spot", "Private Spot")).toBe(
      "private",
    );
  });

  it("coerceStandardizedVisibility maps master enum to standardized enum", () => {
    expect(coerceStandardizedVisibility("friends")).toBe("group");
    expect(coerceStandardizedVisibility("unknown")).toBe("public");
    expect(
      coerceStandardizedVisibility("unknown", {
        privacyLabel: "Public Route",
        logCoercion: false,
      }),
    ).toBe("public");
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
    expect(result.sanitizedFields).toContain("classification.visibility.invalid_coerced");
  });

  it("mixed image+video post_5bb691f7e9eb392e shape survives standardize + zod on profile_own", () => {
    const IMAGE = "https://cdn.example.com/image_fe39a53c0c_ca4d0e4de3_0.jpg";
    const VIDEO =
      "https://s3.wasabisys.com/locava.app/videos-lab/post_5bb691f7e9eb392e/video_5b380e8f09_992649f161_1/startup720_faststart_avc.mp4";
    const POSTER = "https://cdn.example.com/poster.jpg";
    const raw = {
      id: "post_5bb691f7e9eb392e",
      postId: "post_5bb691f7e9eb392e",
      privacy: "Public Route",
      isRoute: true,
      postType: "route",
      routeSource: "undiscovered_claim",
      mediaType: "mixed",
      classification: {
        visibility: "unknown",
        privacyLabel: "Public Route",
        mediaKind: "mixed",
      },
      media: {
        assetCount: 2,
        rawAssetCount: 2,
        hasMultipleAssets: true,
        assets: [
          {
            id: "image_fe39a53c0c_ca4d0e4de3_0",
            index: 0,
            type: "image",
            image: {
              displayUrl: IMAGE,
              originalUrl: IMAGE,
              thumbnailUrl: IMAGE,
              width: 1080,
              height: 1080,
              aspectRatio: 1,
              orientation: "square",
            },
          },
          {
            id: "video_5b380e8f09_992649f161_1",
            index: 1,
            type: "video",
            video: {
              originalUrl: VIDEO,
              posterUrl: POSTER,
              thumbnailUrl: POSTER,
              playback: {
                primaryUrl: VIDEO,
                startupUrl: VIDEO,
                defaultUrl: VIDEO,
                selectedReason: "canonical",
              },
              readiness: {
                processingStatus: "ready",
                assetsReady: true,
                instantPlaybackReady: true,
              },
              technical: { width: 720, height: 1280 },
            },
          },
        ],
      },
    };
    const result = standardizePostDocForRender(raw, "post_5bb691f7e9eb392e");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    ensureStandardizedClassificationVisibility(result.doc.classification, {
      postId: "post_5bb691f7e9eb392e",
      surface: "profile_own",
      privacy: raw.privacy,
    });
    const parsed = StandardizedPostDocSchema.safeParse(result.doc);
    expect(parsed.success).toBe(true);
    expect(result.doc.classification.visibility).toBe("public");
    expect(result.doc.media.assets).toHaveLength(2);
  });
});
