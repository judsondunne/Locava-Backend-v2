import { describe, expect, it } from "vitest";
import {
  PROFILE_BOOTSTRAP_CACHE_SEGMENT,
  allProfileBootstrapCacheKeys,
  profileBootstrapCacheKey,
} from "./profile-follow-graph-cache.js";
import { buildCacheKey } from "./types.js";

describe("profile-follow-graph-cache keys", () => {
  it("uses v2 as the canonical bootstrap segment for reads", () => {
    expect(profileBootstrapCacheKey("v", "u", 12)).toBe(
      buildCacheKey("bootstrap", [PROFILE_BOOTSTRAP_CACHE_SEGMENT, "v", "u", 12])
    );
  });

  it("evicts legacy v2 bootstrap keys alongside v1 so stale snapshots cannot survive follow/unfollow", () => {
    const keys = allProfileBootstrapCacheKeys("viewerA", "profileB");
    expect(keys).toContain(buildCacheKey("bootstrap", ["profile-bootstrap-v1", "viewerA", "profileB", 6]));
    expect(keys).toContain(buildCacheKey("bootstrap", ["profile-bootstrap-v2", "viewerA", "profileB", 6]));
    expect(keys.length).toBe(6);
  });
});
