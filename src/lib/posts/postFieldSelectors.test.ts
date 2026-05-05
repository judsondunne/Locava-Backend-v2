import { describe, expect, it } from "vitest";
import {
  getPostActivities,
  getPostCoordinates,
  getPostCreatedAtMs,
  getPostEngagementCounts,
  getPostMediaAssetCount,
  getPostSearchableText,
  getPostUpdatedAtMs,
  getPostVisibility,
  isMasterPostV2,
  postActivitiesCanonicalLegacyMismatch,
} from "./postFieldSelectors.js";

describe("postFieldSelectors", () => {
  it("getPostActivities prefers canonical classification", () => {
    const legacy = { activities: ["hike"], classification: { activities: ["swim"] } };
    expect(getPostActivities(legacy)).toEqual(["swim"]);
  });

  it("getPostActivities falls back to legacy top-level", () => {
    expect(getPostActivities({ activities: ["run"] })).toEqual(["run"]);
  });

  it("getPostCoordinates reads canonical location", () => {
    const row = {
      lat: 1,
      lng: 2,
      location: { coordinates: { lat: 40.1, lng: -75.2, geohash: "abc" } },
    };
    expect(getPostCoordinates(row)).toEqual({ lat: 40.1, lng: -75.2 });
  });

  it("getPostCoordinates falls back to top-level lat/long", () => {
    expect(getPostCoordinates({ lat: 3, long: 4 })).toEqual({ lat: 3, lng: 4 });
  });

  it("getPostMediaAssetCount prefers canonical media.assetCount", () => {
    expect(getPostMediaAssetCount({ assets: [{ id: "a" }], media: { assetCount: 2, assets: [] } })).toBe(2);
  });

  it("getPostMediaAssetCount falls back to assets.length", () => {
    expect(getPostMediaAssetCount({ assets: [{}, {}] })).toBe(2);
  });

  it("getPostCreatedAtMs handles lifecycle, createdAtMs, time, createdAt", () => {
    expect(getPostCreatedAtMs({ lifecycle: { createdAtMs: 5000 } })).toBe(5000);
    expect(getPostCreatedAtMs({ createdAtMs: 7000 })).toBe(7000);
    expect(getPostCreatedAtMs({ time: 8000 })).toBe(8000);
    expect(getPostCreatedAtMs({ createdAt: "2020-01-02T00:00:00.000Z" })).toBe(Date.parse("2020-01-02T00:00:00.000Z"));
  });

  it("getPostVisibility reads canonical classification.visibility", () => {
    expect(getPostVisibility({ classification: { visibility: "friends" } })).toBe("friends");
    expect(getPostVisibility({ privacy: "private" })).toBe("private");
  });

  it("isMasterPostV2 detects schema", () => {
    expect(isMasterPostV2({ schema: { name: "locava.post", version: 2 } })).toBe(true);
    expect(isMasterPostV2({ schema: { name: "locava.post", version: 1 } })).toBe(false);
  });

  it("postActivitiesCanonicalLegacyMismatch when sets differ on v2", () => {
    const row = {
      schema: { name: "locava.post", version: 2 },
      activities: ["a", "b"],
      classification: { activities: ["a", "c"] },
    };
    expect(postActivitiesCanonicalLegacyMismatch(row)).toBe(true);
  });

  it("getPostEngagementCounts merges canonical and legacy", () => {
    const row = { engagement: { likeCount: 3, commentCount: 4 }, likesCount: 99 };
    expect(getPostEngagementCounts(row)).toEqual({ likeCount: 3, commentCount: 4, saveCount: undefined, shareCount: undefined, viewCount: undefined });
  });

  it("getPostSearchableText prefers text.searchableText", () => {
    expect(getPostSearchableText({ text: { searchableText: "hello world" }, title: "x" })).toContain("hello");
  });

  it("getPostUpdatedAtMs falls back to time", () => {
    expect(getPostUpdatedAtMs({ time: 12_000 })).toBe(12_000);
  });
});
