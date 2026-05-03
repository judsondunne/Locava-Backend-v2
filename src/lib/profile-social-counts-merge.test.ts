import { describe, expect, it } from "vitest";
import { mergeProfileSocialCount } from "./profile-social-counts-merge.js";

describe("mergeProfileSocialCount", () => {
  it("prefers a positive incoming count over a stale positive previous value when incoming is newer truth", () => {
    expect(mergeProfileSocialCount(5, 3)).toBe(3);
  });

  it("does not overwrite a known positive count with a bare zero when incoming omits truth", () => {
    expect(mergeProfileSocialCount(3, 0)).toBe(3);
  });

  it("does not overwrite a known positive count with undefined incoming", () => {
    expect(mergeProfileSocialCount(2, undefined)).toBe(2);
  });

  it("accepts zero when there was no prior positive count", () => {
    expect(mergeProfileSocialCount(0, 0)).toBe(0);
    expect(mergeProfileSocialCount(undefined, 0)).toBe(0);
  });

  it("accepts first positive from incoming when previous was empty", () => {
    expect(mergeProfileSocialCount(undefined, 1)).toBe(1);
  });
});
