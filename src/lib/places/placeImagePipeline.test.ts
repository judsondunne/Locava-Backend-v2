import { describe, expect, it } from "vitest";
import { isBlockedEmbedHost } from "./placeImageEmbedPolicy.js";
import {
  resolveRegionAndFeature,
  scoreLocationRelevance,
} from "./placeImageRanking.js";
import { buildPlaceQuery } from "./searchPlaceImages.service.js";
import type { PlaceImageResult } from "../../types/places.js";

function mkResult(partial: Partial<PlaceImageResult>): PlaceImageResult {
  return {
    id: "test",
    imageUrl: "https://example.com/photo.jpg",
    caption: "Sample",
    sourceName: "Example",
    sourceUrl: "https://example.com/page",
    ...partial,
  };
}

describe("placeImageRanking", () => {
  it("detects feature vs region regardless of comma order", () => {
    expect(resolveRegionAndFeature("Cascade Falls", "Mt. Ascutney")).toEqual({
      region: "Mt. Ascutney",
      feature: "Cascade Falls",
    });
    expect(resolveRegionAndFeature("Ascutney VT", "Hidden Falls")).toEqual({
      region: "Ascutney VT",
      feature: "Hidden Falls",
    });
  });

  it("buildPlaceQuery scopes Cascade Falls at Mt. Ascutney", () => {
    const query = buildPlaceQuery("Cascade Falls, Mt. Ascutney");
    expect(query.scoped).toBe(true);
    expect(query.feature).toBe("Cascade Falls");
    expect(query.region).toBe("Mt. Ascutney");
    expect(query.searchQuery).toContain("Cascade Falls");
    expect(query.searchQuery).toContain("Ascutney");
  });

  it("scores local waterfall captions above unrelated regions", () => {
    const query = buildPlaceQuery("Cascade Falls, Mt. Ascutney");
    const local = mkResult({
      caption: "Cascade Falls - Vermont",
      sourceName: "New England Waterfalls",
      sourceUrl: "https://www.newenglandwaterfalls.com/vt-cascadefalls.html",
      imageWidth: 600,
      imageHeight: 400,
    });
    const foreign = mkResult({
      caption: "Hidden Falls Regional Park | Placer County, CA",
      sourceName: "Visit California",
    });
    expect(scoreLocationRelevance(local, query)).toBeGreaterThan(
      scoreLocationRelevance(foreign, query),
    );
  });
});

describe("placeImageEmbedPolicy", () => {
  it("blocks facebook crawler urls", () => {
    expect(
      isBlockedEmbedHost(
        "https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=123",
      ),
    ).toBe(true);
  });
});
