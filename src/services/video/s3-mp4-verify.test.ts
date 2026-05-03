import { describe, expect, it } from "vitest";
import { parseTotalLengthFromContentRangeHeader } from "./s3-mp4-verify.js";

describe("parseTotalLengthFromContentRangeHeader", () => {
  it("parses totals from RFC 7233 ranges", () => {
    expect(parseTotalLengthFromContentRangeHeader("bytes 0-524287/120000")).toBe(120000);
  });

  it("returns 0 for missing total", () => {
    expect(parseTotalLengthFromContentRangeHeader(undefined)).toBe(0);
    expect(parseTotalLengthFromContentRangeHeader("bytes 0-9/*")).toBe(0);
  });
});
