import { describe, expect, it } from "vitest";
import { moovHintFromMp4Prefix } from "./mp4-moov-hint.js";

describe("moovHintFromMp4Prefix", () => {
  it("detects moov before mdat in prefix", () => {
    const buf = Buffer.alloc(2000, 0);
    buf.write("ftyp", 0);
    buf.write("moov", 100);
    buf.write("mdat", 500);
    expect(moovHintFromMp4Prefix(buf)).toBe("moov_before_mdat_in_prefix");
  });

  it("detects mdat before moov", () => {
    const buf = Buffer.alloc(2000, 0);
    buf.write("mdat", 100);
    buf.write("moov", 500);
    expect(moovHintFromMp4Prefix(buf)).toBe("moov_after_mdat_or_ambiguous");
  });
});
