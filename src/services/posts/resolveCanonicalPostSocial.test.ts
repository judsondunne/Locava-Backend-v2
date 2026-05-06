import { describe, expect, it } from "vitest";
import { resolveCanonicalPostSocial } from "./resolveCanonicalPostSocial.js";

describe("resolveCanonicalPostSocial", () => {
  it("prefers canonical engagement and engagementPreview fields", () => {
    const post = {
      id: "p1",
      engagement: { likeCount: 12, commentCount: 7 },
      viewerState: { liked: false },
      engagementPreview: {
        recentComments: [{ commentId: "c1" }],
        recentLikers: [{ userId: "u1" }],
      },
    } as any;
    const social = resolveCanonicalPostSocial(post, { viewerHasLiked: true });
    expect(social.likeCount).toBe(12);
    expect(social.commentCount).toBe(7);
    expect(social.viewerHasLiked).toBe(true);
    expect(social.commentsPreview).toHaveLength(1);
    expect(social.recentLikers).toHaveLength(1);
  });
});
