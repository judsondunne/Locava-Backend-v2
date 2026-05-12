import { describe, expect, it } from "vitest";
import { computeMediaPlaceMatchScore } from "./mediaPlaceMatchScore.js";
import type { WikimediaMvpNormalizedAsset, WikimediaMvpSeedPlace } from "./WikimediaMvpTypes.js";

const place: WikimediaMvpSeedPlace = {
  placeName: "Moss Glen Falls",
  searchQuery: "Moss Glen Falls, Vermont, VT",
  stateName: "Vermont",
  stateCode: "VT",
};

function asset(overrides: Partial<WikimediaMvpNormalizedAsset>): WikimediaMvpNormalizedAsset {
  return {
    title: "File:Example.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    imageUrl: "https://example.com/x.jpg",
    thumbnailUrl: null,
    width: 2000,
    height: 1500,
    mime: "image/jpeg",
    categories: [],
    titleLower: "file:example.jpg",
    lat: null,
    lon: null,
    dayKey: "unknown",
    dateSource: "unknown",
    capturedAtMs: null,
    descriptionText: null,
    ...overrides,
  };
}

describe("computeMediaPlaceMatchScore", () => {
  it("rejects White Mountains / Flume style titles for a Vermont Moss Glen Falls candidate", () => {
    const s = computeMediaPlaceMatchScore(
      place,
      asset({ title: "File:The Flume, White Mountains, NH.jpg" }),
    );
    expect(s.mismatchReasons.some((r) => r.includes("wrong_place_region") || r.includes("different_us_state"))).toBe(
      true,
    );
    expect(s.score).toBeLessThan(50);
  });

  it("scores high for exact place name in title", () => {
    const s = computeMediaPlaceMatchScore(
      place,
      asset({ title: "File:Moss Glen Falls, VT.jpg", categories: ["Moss Glen Falls"] }),
    );
    expect(s.score).toBeGreaterThanOrEqual(70);
  });

  it("penalizes generic Flickr-only titles", () => {
    const s = computeMediaPlaceMatchScore(place, asset({ title: "File:Flickr.jpg" }));
    expect(s.mismatchReasons).toContain("generic_flickr_title");
  });
});
