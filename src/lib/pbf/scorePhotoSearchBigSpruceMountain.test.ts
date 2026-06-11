import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { PlaceImageResult } from "../../types/places.js";
import { buildOsmSpecificPhotoQuery } from "./buildOsmSpecificPhotoQuery.js";
import { scorePhotoSearchResultsForPlace } from "./scorePhotoSearchResultsForPlace.js";

function bigSpruceDoc(): PbfCopierPreviewDoc {
  return {
    id: "unx_spot_big_spruce",
    displayName: "Big Spruce Mountain",
    kind: "unexplored_spot",
    primaryCategory: "peak",
    primaryActivity: "hiking",
    activities: ["hiking"],
    lat: 43.12,
    lng: -72.98,
    sourceTagSample: { natural: "peak" },
    writePayload: { location: { state: "Vermont" } },
  } as PbfCopierPreviewDoc;
}

function imageResult(input: {
  title: string;
  caption?: string;
  sourceUrl?: string;
}): PlaceImageResult {
  return {
    imageUrl: "https://example.com/photo.jpg",
    caption: input.caption ?? input.title,
    title: input.title,
    sourceName: "example.com",
    sourceUrl: input.sourceUrl ?? "https://example.com/page",
    sourceDomain: "example.com",
    provider: "serper",
  };
}

describe("Big Spruce Mountain photo search relevance", () => {
  it("builds a quoted specific query for the mountain name", () => {
    const query = buildOsmSpecificPhotoQuery(bigSpruceDoc());
    expect(query.skip).toBe(false);
    expect(query.query).toContain('"Big Spruce Mountain"');
    expect(query.query).toContain("Vermont");
  });

  it("rejects unrelated Stowe photos and keeps exact-place matches", () => {
    const doc = bigSpruceDoc();
    const query = buildOsmSpecificPhotoQuery(doc);
    const scored = scorePhotoSearchResultsForPlace(
      doc,
      query,
      [
        imageResult({
          title: "Stowe Vermont fall foliage mountain view",
          sourceUrl: "https://stowe.com/trails",
        }),
        imageResult({
          title: "Hiking Big Spruce Mountain in Vermont",
          sourceUrl: "https://alltrails.com/big-spruce",
        }),
      ],
      { scoringProfile: "undiscovered_app", strictTitleSourceMatch: true },
    );

    expect(scored.acceptedAssets.length).toBeGreaterThan(0);
    expect(
      scored.acceptedAssets.every((asset) =>
        `${asset.title ?? ""} ${asset.caption}`.toLowerCase().includes("big spruce"),
      ),
    ).toBe(true);
    expect(
      scored.rejectedAssets.some((asset) =>
        (asset.title + asset.caption).toLowerCase().includes("stowe"),
      ),
    ).toBe(true);
  });
});
