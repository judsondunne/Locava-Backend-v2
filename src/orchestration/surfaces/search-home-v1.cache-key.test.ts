import { describe, expect, it } from "vitest";
import { searchHomeV1CacheKeys } from "../../services/surfaces/search-home-v1.service.js";

describe("search home cache key alignment", () => {
  it("homeFull key matches entity-invalidation convention search:home:v1:{viewerId}", () => {
    expect(searchHomeV1CacheKeys.homeFull("viewer-abc")).toBe("search:home:v1:viewer-abc");
    // Guard against regressing to the old unused orchestrator key.
    expect(searchHomeV1CacheKeys.homeFull("viewer-abc")).not.toContain("home-bootstrap");
  });
});
