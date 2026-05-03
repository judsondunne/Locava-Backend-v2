import { describe, expect, it } from "vitest";
import { shouldGenerate1080Ladder } from "./video-source-policy.js";

describe("shouldGenerate1080Ladder", () => {
  it("enables 1080 ladder for 1920x1080 and 4K landscape", () => {
    expect(shouldGenerate1080Ladder(1920, 1080)).toBe(true);
    expect(shouldGenerate1080Ladder(3840, 2160)).toBe(true);
  });

  it("enables 1080 ladder for 1080x1920 portrait", () => {
    expect(shouldGenerate1080Ladder(1080, 1920)).toBe(true);
  });

  it("skips 1080 ladder for 720p landscape and portrait", () => {
    expect(shouldGenerate1080Ladder(1280, 720)).toBe(false);
    expect(shouldGenerate1080Ladder(720, 1280)).toBe(false);
  });

  it("skips ultrawide 1920x800", () => {
    expect(shouldGenerate1080Ladder(1920, 800)).toBe(false);
  });
});
