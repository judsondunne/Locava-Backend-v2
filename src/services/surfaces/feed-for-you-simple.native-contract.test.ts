import { describe, expect, it } from "vitest";
import { reduceForYouSimplePage, shouldShowAllOutCopy } from "./feed-for-you-simple.native-contract.js";

describe("for-you simple native contract (Test G)", () => {
  it("keeps prior posts when response is empty but not proven DB-empty", () => {
    const prev = { postIds: ["a", "b"], showTrueEmpty: false };
    const next = reduceForYouSimplePage(prev, {
      items: [],
      exhausted: false,
      emptyReason: null,
      requestedLimit: 5
    });
    expect(next.postIds).toEqual(["a", "b"]);
    expect(next.showTrueEmpty).toBe(false);
  });

  it("shows true-empty only when emptyReason is no_playable_posts", () => {
    const prev = { postIds: ["a"], showTrueEmpty: false };
    const next = reduceForYouSimplePage(prev, {
      items: [],
      exhausted: true,
      emptyReason: "no_playable_posts",
      requestedLimit: 5
    });
    expect(next.postIds).toEqual([]);
    expect(next.showTrueEmpty).toBe(true);
  });

  it("does not recommend all-out copy for short non-terminal pages", () => {
    expect(
      shouldShowAllOutCopy({
        items: [{ postId: "x" }],
        exhausted: false,
        emptyReason: null,
        requestedLimit: 5
      })
    ).toBe(false);
    expect(
      shouldShowAllOutCopy({
        items: [{ postId: "x" }, { postId: "y" }],
        exhausted: true,
        emptyReason: null,
        requestedLimit: 5
      })
    ).toBe(false);
  });
});
