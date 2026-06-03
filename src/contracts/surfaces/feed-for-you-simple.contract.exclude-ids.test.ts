/**
 * Schema tests for the new `excludeIds` query parameter on /v2/feed/for-you/simple.
 *
 * These tests do not need Fastify or Firestore — they only exercise the Zod transform
 * so we can prove parsing, dedupe and the hard cap before the value ever reaches the
 * service layer.
 */
import { describe, expect, it } from "vitest";

import {
  FOR_YOU_SIMPLE_EXCLUDE_IDS_MAX,
  FeedForYouSimpleQuerySchema,
} from "./feed-for-you-simple.contract.js";

describe("FeedForYouSimpleQuerySchema.excludeIds", () => {
  it("is optional and absent when not provided", () => {
    const parsed = FeedForYouSimpleQuerySchema.parse({});
    expect(parsed.excludeIds).toBeUndefined();
  });

  it("accepts a comma-separated string and produces an array", () => {
    const parsed = FeedForYouSimpleQuerySchema.parse({
      excludeIds: "post_a,post_b,post_c",
    });
    expect(parsed.excludeIds).toEqual(["post_a", "post_b", "post_c"]);
  });

  it("trims whitespace and drops empty tokens", () => {
    const parsed = FeedForYouSimpleQuerySchema.parse({
      excludeIds: " post_a , , post_b,  ",
    });
    expect(parsed.excludeIds).toEqual(["post_a", "post_b"]);
  });

  it("dedupes within the same request (first occurrence wins)", () => {
    const parsed = FeedForYouSimpleQuerySchema.parse({
      excludeIds: "x,y,x,y,z",
    });
    expect(parsed.excludeIds).toEqual(["x", "y", "z"]);
  });

  it("ignores tokens longer than 64 chars", () => {
    const longId = "x".repeat(65);
    const parsed = FeedForYouSimpleQuerySchema.parse({
      excludeIds: `${longId},ok_id`,
    });
    expect(parsed.excludeIds).toEqual(["ok_id"]);
  });

  it("hard-caps at FOR_YOU_SIMPLE_EXCLUDE_IDS_MAX entries", () => {
    const tokens = Array.from(
      { length: FOR_YOU_SIMPLE_EXCLUDE_IDS_MAX + 50 },
      (_, i) => `id_${i}`,
    );
    const parsed = FeedForYouSimpleQuerySchema.parse({
      excludeIds: tokens.join(","),
    });
    expect(parsed.excludeIds).toHaveLength(FOR_YOU_SIMPLE_EXCLUDE_IDS_MAX);
    expect(parsed.excludeIds?.[0]).toBe("id_0");
    expect(parsed.excludeIds?.[FOR_YOU_SIMPLE_EXCLUDE_IDS_MAX - 1]).toBe(
      `id_${FOR_YOU_SIMPLE_EXCLUDE_IDS_MAX - 1}`,
    );
  });

  it("accepts an array form (repeated query param)", () => {
    const parsed = FeedForYouSimpleQuerySchema.parse({
      excludeIds: ["aa", "bb", "aa"],
    });
    expect(parsed.excludeIds).toEqual(["aa", "bb"]);
  });

  it("does not affect other query fields", () => {
    const parsed = FeedForYouSimpleQuerySchema.parse({
      limit: 8,
      cursor: "fys:v5:abc",
      excludeIds: "id_1,id_2",
      debug: "true",
    });
    expect(parsed.limit).toBe(8);
    expect(parsed.cursor).toBe("fys:v5:abc");
    expect(parsed.debug).toBe(true);
    expect(parsed.excludeIds).toEqual(["id_1", "id_2"]);
  });
});
