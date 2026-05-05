import { describe, expect, it } from "vitest";
import { normalizeMasterPostV2 } from "./normalizeMasterPostV2.js";
import { diffMasterPostPreview } from "./diffMasterPostPreview.js";

describe("diffMasterPostPreview", () => {
  it("reports additive summary fields", () => {
    const raw = {
      id: "post1",
      userId: "u1",
      createdAt: "2026-05-04T00:00:00.000Z",
      likes: [{ userId: "a" }, { userId: "b" }],
      photoLink: "https://legacy/x.jpg"
    };
    const normalized = normalizeMasterPostV2(raw, { postId: "post1" });
    const diff = diffMasterPostPreview({
      raw,
      canonical: normalized.canonical,
      recoveredLegacyAssets: normalized.recoveredLegacyAssets,
      dedupedAssets: normalized.dedupedAssets,
      warnings: normalized.warnings,
      errors: normalized.errors,
      processingDebugExtracted: false
    });
    expect(diff.fieldsAdded).toContain("schema");
    expect(diff.mediaAssetCountBefore).toBe(0);
    expect(diff.mediaAssetCountAfter).toBeGreaterThan(0);
    expect(diff.compatibilityFieldsGenerated).toContain("photoLink");
  });

  it("regression: exziw1QFyoigUnlDFcCk-style preview reports normalized selectedVideoUrls", () => {
    const raw = {
      id: "exziw1QFyoigUnlDFcCk",
      userId: "u1",
      createdAt: "2026-05-04T00:00:00.000Z",
      mediaType: "video",
      title: "Legacy Reel",
      assets: [
        {
          id: "v1",
          type: "video",
          original: "https://cdn/original.mp4",
          main1080Avc: "https://cdn/main1080.mp4",
          main720Avc: "https://cdn/main720.mp4",
          preview360Avc: "https://cdn/preview360.mp4",
          poster: "https://cdn/poster.jpg"
        }
      ],
      playbackLab: {
        lastVerifyResults: [
          { url: "https://cdn/main1080.mp4", ok: true, moovHint: "moov_before_mdat_in_prefix" },
          { url: "https://cdn/main720.mp4", ok: true, moovHint: "moov_before_mdat_in_prefix" }
        ]
      }
    };
    const normalized = normalizeMasterPostV2(raw, { postId: "exziw1QFyoigUnlDFcCk" });
    const diff = diffMasterPostPreview({
      raw,
      canonical: normalized.canonical,
      recoveredLegacyAssets: normalized.recoveredLegacyAssets,
      dedupedAssets: normalized.dedupedAssets,
      warnings: normalized.warnings,
      errors: normalized.errors,
      processingDebugExtracted: false
    });
    expect(diff.selectedVideoUrls[0]).toMatchObject({
      defaultUrl: "https://cdn/main1080.mp4",
      primaryUrl: "https://cdn/main1080.mp4",
      startupUrl: "https://cdn/main1080.mp4",
      fallbackUrl: "https://cdn/original.mp4",
      faststartVerified: true,
      instantPlaybackReady: true,
      selectedReason: "verified_avc_faststart_1080"
    });
    expect(normalized.canonical.author.userId).toBe("u1");
    expect(normalized.canonical.text.title).toBe("Legacy Reel");
    expect(normalized.canonical.classification.mediaKind).toBe("video");
  });
});
