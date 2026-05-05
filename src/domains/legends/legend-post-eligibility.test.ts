import { describe, expect, it } from "vitest";
import { isEligiblePostForLegends } from "./legend-post-eligibility.js";

describe("isEligiblePostForLegends", () => {
  it("accepts finalized public visible posts", () => {
    const out = isEligiblePostForLegends({
      postId: "p1",
      userId: "u1",
      privacy: "Public Spot",
      finalized: true,
      isHidden: false,
      isDeleted: false
    });
    expect(out.eligible).toBe(true);
  });

  it("rejects private posts", () => {
    const out = isEligiblePostForLegends({
      postId: "p1",
      userId: "u1",
      privacy: "Friends Spot",
      finalized: true
    });
    expect(out.eligible).toBe(false);
    expect(out.reason).toBe("not_public");
  });

  it("rejects hidden/deleted/non-finalized posts", () => {
    expect(isEligiblePostForLegends({ postId: "p2", userId: "u1", privacy: "Public Spot", isHidden: true }).eligible).toBe(false);
    expect(isEligiblePostForLegends({ postId: "p3", userId: "u1", privacy: "Public Spot", isDeleted: true }).eligible).toBe(false);
    expect(isEligiblePostForLegends({ postId: "p4", userId: "u1", privacy: "Public Spot", finalized: false }).eligible).toBe(false);
  });
});

