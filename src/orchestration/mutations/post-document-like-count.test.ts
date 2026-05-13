import { describe, expect, it } from "vitest";
import { readPostLikeCountFromFirestoreData } from "./post-document-like-count.js";

describe("readPostLikeCountFromFirestoreData", () => {
  it("prefers likesCount (primary denormalized field) when both likesCount and likeCount exist", () => {
    expect(readPostLikeCountFromFirestoreData({ likeCount: 1, likesCount: 17 })).toBe(17);
  });

  it("reads nested stats when top-level is missing", () => {
    expect(readPostLikeCountFromFirestoreData({ stats: { likeCount: 12 } })).toBe(12);
  });

  it("returns 0 when no numeric fields", () => {
    expect(readPostLikeCountFromFirestoreData({})).toBe(0);
  });
});
