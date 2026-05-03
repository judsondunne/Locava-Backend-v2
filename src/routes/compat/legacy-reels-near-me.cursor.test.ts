import { describe, expect, it } from "vitest";
import {
  encodeNearMeCursorV2,
  parseNearMeCursorAny,
  resolveNearMePaginationStart
} from "./legacy-reels-near-me.routes.js";

describe("legacy near-me cursor", () => {
  it("parses legacy cursor format", () => {
    const parsed = parseNearMeCursorAny("cursor:12");
    expect(parsed.kind).toBe("legacy");
    if (parsed.kind === "legacy") {
      expect(parsed.offset).toBe(12);
    }
  });

  it("round-trips v2 cursor", () => {
    const cursor = encodeNearMeCursorV2({
      offset: 8,
      radiusMiles: 25,
      latE5: 4068843,
      lngE5: -7522073,
      lastPostId: "post-008",
      poolLoadedAtMs: 1000
    });
    const parsed = parseNearMeCursorAny(cursor);
    expect(parsed.kind).toBe("v2");
    if (parsed.kind === "v2") {
      expect(parsed.value.mode).toBe("pool");
      expect(parsed.value.offset).toBe(8);
      expect(parsed.value.lastPostId).toBe("post-008");
      expect(parsed.value.radiusMiles).toBe(25);
    }
  });

  it("round-trips v2 exhaust snapshot cursor", () => {
    const cursor = encodeNearMeCursorV2({
      mode: "exhaust",
      offset: 40,
      radiusMiles: 10,
      latE5: 400000,
      lngE5: -750000,
      lastPostId: "post-z",
      poolLoadedAtMs: 2000,
      seen: ["a", "b"],
      exhaust: {
        phase: "geohash",
        prefixes: ["abc", "def"],
        prefixIdx: 1,
        ghCursor: { lastGeohash: "gk", lastTime: 99, lastId: "p1" },
        geoFinished: false,
        recentCursor: null,
        recentFinished: false
      }
    });
    const parsed = parseNearMeCursorAny(cursor);
    expect(parsed.kind).toBe("v2");
    if (parsed.kind === "v2") {
      expect(parsed.value.mode).toBe("exhaust");
      expect(parsed.value.seen?.length).toBe(2);
      expect(parsed.value.exhaust?.prefixIdx).toBe(1);
    }
  });

  it("resets offset on radius mismatch", () => {
    const parsed = parseNearMeCursorAny(
      encodeNearMeCursorV2({
        offset: 10,
        radiusMiles: 10,
        latE5: 1000,
        lngE5: 2000,
        lastPostId: "post-010",
        poolLoadedAtMs: 1000
      })
    );
    const resolved = resolveNearMePaginationStart({
      parsedCursor: parsed,
      radiusMiles: 25,
      latE5: 1000,
      lngE5: 2000,
      currentPoolLoadedAtMs: 1000,
      candidateIds: ["post-001", "post-002"],
      limit: 5
    });
    expect(resolved.offset).toBe(0);
    expect(resolved.cursorResetReason).toBe("radius_changed");
  });

  it("recovers from pool refresh using last post id", () => {
    const parsed = parseNearMeCursorAny(
      encodeNearMeCursorV2({
        offset: 20,
        radiusMiles: 25,
        latE5: 1000,
        lngE5: 2000,
        lastPostId: "post-003",
        poolLoadedAtMs: 10
      })
    );
    const resolved = resolveNearMePaginationStart({
      parsedCursor: parsed,
      radiusMiles: 25,
      latE5: 1000,
      lngE5: 2000,
      currentPoolLoadedAtMs: 11,
      candidateIds: ["post-001", "post-002", "post-003", "post-004", "post-005"],
      limit: 5
    });
    expect(resolved.offset).toBe(3);
    expect(resolved.recoveredByLastPost).toBe(true);
  });
});

