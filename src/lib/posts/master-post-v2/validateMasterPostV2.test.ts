import { describe, expect, it } from "vitest";
import type { MasterPostV2, PostEngagementSourceAuditV2 } from "../../../contracts/master-post-v2.types.js";
import { normalizeMasterPostV2 } from "./normalizeMasterPostV2.js";
import { validateMasterPostV2 } from "./validateMasterPostV2.js";

describe("validateMasterPostV2", () => {
  it("passes for a valid normalized post", () => {
    const normalized = normalizeMasterPostV2({
      id: "p1",
      userId: "u1",
      createdAt: "2026-05-04T00:00:00.000Z",
      assets: [{ id: "i1", type: "image", original: "https://img/1.jpg", variants: { md: { webp: "https://img/1-md.webp" } } }]
    });
    const validation = validateMasterPostV2(normalized.canonical);
    expect(validation.blockingErrors.length).toBe(0);
  });

  it("catches invalid post cases", () => {
    const normalized = normalizeMasterPostV2({
      id: "bad",
      userId: "u1",
      createdAt: "2026-05-04T00:00:00.000Z",
      assets: [{ id: "v1", type: "video", original: "https://v/o.mp4", preview360Avc: "https://v/preview.mp4", startup720FaststartAvc: "https://v/better.mp4" }]
    });
    normalized.canonical.id = "";
    normalized.canonical.lifecycle.createdAt = null;
    normalized.canonical.location.coordinates.lat = 120;
    normalized.canonical.media.assetCount = 999;
    normalized.canonical.schema.version = 1 as 2;
    normalized.canonical.schema.name = "master_post_v2" as "locava.post";
    normalized.canonical.classification.visibility = "Public Spot" as "public";
    normalized.canonical.media.assets[0]!.id = "dup";
    if (normalized.canonical.media.assets[0]?.type === "video") {
      normalized.canonical.media.assets[0].video!.variants.diagnosticsJson = { noisy: true };
    }
    normalized.canonical.media.assets.push({ ...normalized.canonical.media.assets[0]!, index: 1 });
    const validation = validateMasterPostV2(normalized.canonical);
    expect(validation.status).toBe("invalid");
    expect(validation.blockingErrors.length).toBeGreaterThan(2);
  });

  it("surfaces engagement audit mismatches as validation warnings", () => {
    const normalized = normalizeMasterPostV2({
      id: "p_audit",
      userId: "u1",
      createdAt: "2026-05-04T00:00:00.000Z",
      assets: [{ id: "i1", type: "image", original: "https://img/1.jpg", variants: { md: { webp: "https://img/1-md.webp" } } }]
    });
    const audit: PostEngagementSourceAuditV2 = {
      postDoc: {
        likeCount: 0,
        likesArrayCount: 1,
        commentsCount: 0,
        commentsArrayCount: 0,
        likesVersion: 0,
        commentsVersion: 0
      },
      subcollections: {
        likesPath: "posts/p_audit/likes",
        likesCount: 0,
        recentLikers: [{ userId: "a", displayName: null, handle: null, profilePicUrl: "https://p.jpg", likedAt: "2026-01-01T00:00:00.000Z" }],
        likesQueryError: null,
        commentsPath: "posts/p_audit/comments",
        commentsCount: 0,
        recentComments: [],
        commentsQueryError: null
      },
      recommendedCanonical: { likeCount: 1, commentCount: 0, likesVersion: 0, commentsVersion: 0 },
      selectedSource: { likes: "postDocArray", comments: "subcollection" },
      mismatches: ["unit_test_likes_embedded_vs_subcollection"],
      warnings: ["likes_selected_legacy_post_doc_array_empty_subcollection"]
    };
    const merged: MasterPostV2 = {
      ...normalized.canonical,
      engagement: {
        ...normalized.canonical.engagement,
        likeCount: audit.recommendedCanonical.likeCount
      },
      audit: {
        ...normalized.canonical.audit,
        engagementSourceAuditSummary: audit
      }
    };
    const validation = validateMasterPostV2(merged, { engagementSourceAudit: audit });
    expect(validation.warnings.some((w) => w.code === "engagement_count_mismatch")).toBe(true);
    expect(validation.warnings.some((w) => w.code === "likes_selected_legacy_embedded_post_array")).toBe(true);
  });

  it("warns when audit recommends comments but canonical commentCount is still zero", () => {
    const normalized = normalizeMasterPostV2({
      id: "p_cc",
      userId: "u1",
      createdAt: "2026-05-04T00:00:00.000Z",
      assets: [{ id: "i1", type: "image", original: "https://img/1.jpg", variants: { md: { webp: "https://img/1-md.webp" } } }]
    });
    expect(normalized.canonical.engagement.commentCount).toBe(0);
    const audit: PostEngagementSourceAuditV2 = {
      postDoc: {
        likeCount: 0,
        likesArrayCount: 0,
        commentsCount: 0,
        commentsArrayCount: 0,
        likesVersion: 0,
        commentsVersion: 0
      },
      subcollections: {
        likesPath: "posts/p_cc/likes",
        likesCount: 0,
        recentLikers: [],
        likesQueryError: null,
        commentsPath: "posts/p_cc/comments",
        commentsCount: 2,
        recentComments: [],
        commentsQueryError: null
      },
      recommendedCanonical: { likeCount: 0, commentCount: 2, likesVersion: 0, commentsVersion: 2 },
      selectedSource: { likes: "none", comments: "subcollection" },
      mismatches: [],
      warnings: []
    };
    const validation = validateMasterPostV2(normalized.canonical, { engagementSourceAudit: audit });
    expect(validation.warnings.some((w) => w.code === "engagement_comment_count_zero_but_sources_nonzero")).toBe(true);
    expect(validation.warnings.some((w) => w.code === "canonical_comment_count_mismatch_vs_engagement_audit")).toBe(true);
    expect(validation.warnings.some((w) => w.code === "engagement_recent_comments_empty_despite_nonzero_count")).toBe(true);
  });

  it("warns when lifecycle.createdAt is present but createdAtMs was cleared", () => {
    const normalized = normalizeMasterPostV2({
      id: "p_ms_warn",
      userId: "u",
      createdAt: "2026-05-04T00:00:00.000Z",
      assets: [{ id: "i1", type: "image", original: "https://img/1.jpg", variants: { md: { webp: "https://img/1-md.webp" } } }]
    });
    normalized.canonical.lifecycle.createdAtMs = null;
    const validation = validateMasterPostV2(normalized.canonical);
    expect(validation.warnings.some((w) => w.code === "lifecycle_created_at_iso_without_ms")).toBe(true);
  });

  it("warns when normalization flagged timestamp fields that did not yield createdAtMs", () => {
    const normalized = normalizeMasterPostV2({
      id: "p_ok",
      userId: "u",
      createdAt: "2026-05-04T00:00:00.000Z",
      assets: [{ id: "i1", type: "image", original: "https://img/1.jpg", variants: { md: { webp: "https://img/1-md.webp" } } }]
    });
    normalized.canonical.audit.normalizationDebug = {
      ...normalized.canonical.audit.normalizationDebug!,
      lifecycleCreatedAtMsMissingDespiteRawFields: true
    };
    const validation = validateMasterPostV2(normalized.canonical);
    expect(validation.warnings.some((w) => w.code === "lifecycle_created_at_ms_not_derived_from_raw")).toBe(true);
  });
});
