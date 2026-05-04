import { describe, expect, it } from "vitest";
import { deriveEngagementSourceSelection } from "./auditPostEngagementSourcesV2.js";

describe("deriveEngagementSourceSelection", () => {
  it("prefers likes subcollection count when it is non-zero", () => {
    const r = deriveEngagementSourceSelection({
      rawPost: { likesCount: 10, likeCount: 10, likes: new Array(10).fill({}) },
      likesSubCount: 12,
      likesQueryError: null,
      commentsSubCount: 4,
      commentsQueryError: null
    });
    expect(r.selectedSource.likes).toBe("subcollection");
    expect(r.recommendedCanonical.likeCount).toBe(12);
    expect(r.mismatches.some((m) => m.includes("likes_count_post_doc_10_vs_subcollection_12"))).toBe(true);
  });

  it("falls back to embedded likes[] when subcollection is empty and array exists", () => {
    const r = deriveEngagementSourceSelection({
      rawPost: {
        likesCount: 12,
        likes: [{ userId: "a", userName: "A", createdAt: "2026-05-01T00:00:00.000Z" }]
      },
      likesSubCount: 0,
      likesQueryError: null,
      commentsSubCount: 0,
      commentsQueryError: null
    });
    expect(r.selectedSource.likes).toBe("postDocArray");
    expect(r.recommendedCanonical.likeCount).toBe(1);
    expect(r.warnings.some((w) => w.includes("likes_selected_legacy_post_doc_array_empty_subcollection"))).toBe(true);
  });

  it("uses comments subcollection when empty and no embedded comments[]", () => {
    const r = deriveEngagementSourceSelection({
      rawPost: { commentsCount: 3 },
      likesSubCount: 0,
      likesQueryError: null,
      commentsSubCount: 0,
      commentsQueryError: null
    });
    expect(r.selectedSource.comments).toBe("subcollection");
    expect(r.recommendedCanonical.commentCount).toBe(0);
    expect(r.mismatches.some((m) => m.includes("comments_count_post_doc_3_vs_subcollection_0"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("comments_subcollection_empty_using_post_doc_array"))).toBe(false);
  });

  it("uses embedded comments when subcollection succeeds with 0 but post.comments[] has items", () => {
    const r = deriveEngagementSourceSelection({
      rawPost: { commentsCount: 0, comments: [{ id: "c1" }] },
      likesSubCount: 0,
      likesQueryError: null,
      commentsSubCount: 0,
      commentsQueryError: null
    });
    expect(r.selectedSource.comments).toBe("postDocArray");
    expect(r.recommendedCanonical.commentCount).toBe(1);
    expect(r.warnings).toContain("comments_subcollection_empty_using_post_doc_array");
    expect(r.mismatches.some((m) => m.includes("comments_array_len_1_vs_subcollection_0"))).toBe(true);
  });

  it("falls back when comments subcollection count query fails", () => {
    const r = deriveEngagementSourceSelection({
      rawPost: { commentsCount: 2, comments: [{}] },
      likesSubCount: 0,
      likesQueryError: null,
      commentsSubCount: null,
      commentsQueryError: "permission_denied"
    });
    expect(r.selectedSource.comments).toBe("postDocArray");
    expect(r.recommendedCanonical.commentCount).toBe(1);
    expect(r.warnings.some((w) => w.startsWith("comments_subcollection_query_error:"))).toBe(true);
  });

  it("prefers comments subcollection when present", () => {
    const r = deriveEngagementSourceSelection({
      rawPost: { commentsCount: 4, comments: [{}] },
      likesSubCount: 0,
      likesQueryError: null,
      commentsSubCount: 7,
      commentsQueryError: null
    });
    expect(r.selectedSource.comments).toBe("subcollection");
    expect(r.recommendedCanonical.commentCount).toBe(7);
    expect(r.mismatches.some((m) => m.includes("comments_count_post_doc_4_vs_subcollection_7"))).toBe(true);
  });
});
