import { describe, expect, it } from "vitest";
import {
  PROFILE_HEADER_CACHE_SCHEMA_VERSION,
  isCompleteProfileHeaderEntityCache,
  withProfileHeaderCacheMetadata,
} from "./profile-header-cache.js";

describe("profile-header-cache completeness", () => {
  it("rejects chat-style userSummary shapes stored under the wrong cache family", () => {
    expect(
      isCompleteProfileHeaderEntityCache({
        userId: "u1",
        handle: "h",
        name: null,
        pic: "https://x/y.jpg",
      })
    ).toBe(false);
  });

  it("accepts canonical profile header entity payloads", () => {
    const raw = withProfileHeaderCacheMetadata({
      userId: "u1",
      handle: "h",
      name: "N",
      profilePic: "https://cdn.example.com/a.jpg",
      counts: { posts: 3, followers: 2, following: 1 },
    });
    expect(raw._cacheSchemaVersion).toBe(PROFILE_HEADER_CACHE_SCHEMA_VERSION);
    expect(isCompleteProfileHeaderEntityCache(raw)).toBe(true);
  });

  it("rejects summaries missing schema version", () => {
    expect(
      isCompleteProfileHeaderEntityCache({
        userId: "u1",
        handle: "h",
        name: "N",
        profilePic: null,
        counts: { posts: 0, followers: 0, following: 0 },
      })
    ).toBe(false);
  });
});
