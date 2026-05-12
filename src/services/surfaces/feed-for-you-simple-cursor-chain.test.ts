import { describe, expect, it } from "vitest";
import { appendCursorChainState, createFreshCursorV3, decodeForYouSimpleCursor, encodeForYouSimpleCursor } from "./feed-for-you-simple-cursor.js";

describe("feed-for-you-simple cursor chain", () => {
  it("appends returned ids, increments continuationSeq, and round-trips author metadata", () => {
    const cursor = createFreshCursorV3("randomKey");
    const next = appendCursorChainState(cursor, {
      returnedIds: ["a", "b", "c", "d", "e"],
      authorIds: ["author_1", "author_2"],
      recycleMode: false
    });
    expect(next.seen).toEqual(["a", "b", "c", "d", "e"]);
    expect(next.continuationSeq).toBe(1);
    expect(next.recentAuthorIds).toEqual(["author_1", "author_2"]);
    const encoded = encodeForYouSimpleCursor(next);
    const decoded = decodeForYouSimpleCursor(encoded);
    expect(decoded?.seen).toEqual(["a", "b", "c", "d", "e"]);
    expect(decoded?.continuationSeq).toBe(1);
  });
});
