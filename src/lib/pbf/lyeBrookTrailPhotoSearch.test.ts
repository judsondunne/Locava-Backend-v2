import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { PlaceImageResult } from "../../types/places.js";
import { buildOsmSpecificPhotoQuery } from "./buildOsmSpecificPhotoQuery.js";
import { scorePhotoSearchResultsForPlace } from "./scorePhotoSearchResultsForPlace.js";

function routeDoc(): PbfCopierPreviewDoc {
  return {
    id: "unx_route_lye_brook",
    kind: "unexplored_route",
    collection: "unexploredRoutes",
    displayName: "Lye Brook Trail",
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "hiking_trail",
    lat: 43.07,
    lng: -73.15,
    sourceFamily: "osm",
    sourceKeys: [],
    sourceIds: [],
    osmType: "way",
    osmId: 1,
    origin: "generated_osm",
    mapReadiness: "ready",
    publicMapEligible: true,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "test",
    importPipelineVersion: "v1",
    pbfFilePath: "",
    sourceProvider: "osm",
    sourceTagSample: {
      "addr:city": "Arlington",
      "addr:state": "Vermont",
      "addr:country": "United States",
    },
    writePayload: { location: { city: "Arlington", state: "Vermont" } },
    warnings: [],
  };
}

function img(input: {
  title: string;
  sourceUrl?: string;
  sourceName?: string;
}): PlaceImageResult {
  return {
    imageUrl: "https://example.com/photo.jpg",
    caption: input.title,
    title: input.title,
    sourceName: input.sourceName ?? "example.com",
    sourceUrl: input.sourceUrl ?? "https://example.com/page",
    sourceDomain: input.sourceName ?? "example.com",
    provider: "serper",
  };
}

describe("Lye Brook Trail photo search (Arlington VT route)", () => {
  it("query includes trail name, Arlington, Vermont, and United States", () => {
    const query = buildOsmSpecificPhotoQuery(routeDoc());
    expect(query.skip).toBe(false);
    expect(query.query).toContain("Lye Brook Trail");
    expect(query.query).toContain("Arlington");
    expect(query.query).toContain("Vermont");
    expect(query.query).toContain("United States");
  });

  it("accepts Lye Brook Falls trail photos and rejects unrelated Vermont listings", () => {
    const doc = routeDoc();
    const query = buildOsmSpecificPhotoQuery(doc);
    const scored = scorePhotoSearchResultsForPlace(
      doc,
      query,
      [
        img({
          title: "Lye Brook Falls Trail Arlington Vermont waterfall",
          sourceUrl: "https://www.alltrails.com/trail/us/vermont/lye-brook-falls-trail",
          sourceName: "alltrails.com",
        }),
        img({
          title: "Lye Brook Falls Vermont Green Mountain National Forest",
          sourceUrl: "https://newenglandwaterfalls.com/lye-brook-falls",
          sourceName: "newenglandwaterfalls.com",
        }),
        img({
          title: "Best hikes in Vermont",
          sourceUrl: "https://example.com/vt-trails",
        }),
        img({
          title: "Stratton Pond trail Vermont",
          sourceUrl: "https://example.com/stratton-pond",
        }),
      ],
      { scoringProfile: "undiscovered_app", strictTitleSourceMatch: false },
    );

    expect(scored.acceptedAssets.length).toBeGreaterThanOrEqual(2);
    expect(
      scored.acceptedAssets.every((asset) => {
        const hay = `${asset.title ?? ""} ${asset.caption}`.toLowerCase();
        return hay.includes("lye") && hay.includes("brook");
      }),
    ).toBe(true);
    expect(
      scored.acceptedAssets.some((asset) =>
        `${asset.title ?? ""} ${asset.caption}`.toLowerCase().includes("stratton"),
      ),
    ).toBe(false);
    expect(scored.assetsReady).toBe(true);
  });
});
