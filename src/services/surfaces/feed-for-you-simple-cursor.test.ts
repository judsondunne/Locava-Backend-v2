import { describe, expect, it } from "vitest";
import {
  createFreshCursorV3,
  decodeForYouSimpleCursor,
  encodeForYouSimpleCursor,
  FOR_YOU_SIMPLE_CURSOR_PREFIX_V2,
  FOR_YOU_SIMPLE_CURSOR_PREFIX_V3,
  getEarliestAllowedPhase,
  repairForYouSimpleCursor
} from "./feed-for-you-simple-cursor.js";

describe("feed-for-you-simple cursor v3", () => {
  it("round-trips v3 cursors with phase state", () => {
    const cursor = createFreshCursorV3("randomKey");
    cursor.seen = ["a", "b"];
    cursor.phases.reel_tier_5.exhausted = true;
    cursor.activePhase = "reel_tier_4";
    const encoded = encodeForYouSimpleCursor(cursor);
    expect(encoded.startsWith(FOR_YOU_SIMPLE_CURSOR_PREFIX_V3)).toBe(true);
    const decoded = decodeForYouSimpleCursor(encoded);
    expect(decoded?.activePhase).toBe("reel_tier_4");
    expect(decoded?.seen).toEqual(["a", "b"]);
    expect(decoded?.phases.reel_tier_5.exhausted).toBe(true);
  });

  it("upgrades legacy v2 cursors safely", () => {
    const legacy = {
      v: 2,
      mode: "randomKey",
      reel: { anchor: 0.25, wrapped: false, lastValue: null, lastPostId: null },
      fallback: { anchor: 0.75, wrapped: false, lastValue: null, lastPostId: null },
      seen: ["seen_1"]
    };
    const encoded = `${FOR_YOU_SIMPLE_CURSOR_PREFIX_V2}${Buffer.from(JSON.stringify(legacy), "utf8").toString("base64url")}`;
    const decoded = decodeForYouSimpleCursor(encoded);
    expect(decoded?.v).toBe(3);
    expect(decoded?.activePhase).toBe("reel_tier_5");
    expect(decoded?.seen).toEqual(["seen_1"]);
  });

  it("repairs fallback active phase while reel phases remain open", () => {
    const cursor = createFreshCursorV3("randomKey");
    cursor.activePhase = "fallback_normal";
    const repaired = repairForYouSimpleCursor(cursor);
    expect(repaired.activePhase).toBe("reel_tier_5");
    expect(getEarliestAllowedPhase(repaired)).toBe("reel_tier_5");
  });
});
