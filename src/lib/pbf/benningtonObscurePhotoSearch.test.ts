import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { PlaceImageResult } from "../../types/places.js";
import { buildOsmSpecificPhotoQuery } from "./buildOsmSpecificPhotoQuery.js";
import { scorePhotoSearchResultsForPlace } from "./scorePhotoSearchResultsForPlace.js";

function spotDoc(input: Partial<PbfCopierPreviewDoc> & { displayName: string }): PbfCopierPreviewDoc {
  return {
    id: input.id ?? "test-spot",
    kind: input.kind ?? "unexplored_spot",
    collection: input.collection ?? "unexploredSpots",
    displayName: input.displayName,
    primaryActivity: input.primaryActivity ?? "hiking",
    activities: input.activities ?? ["hiking"],
    primaryCategory: input.primaryCategory ?? "osm",
    lat: input.lat !== undefined ? input.lat : 42.88,
    lng: input.lng !== undefined ? input.lng : -73.2,
    sourceFamily: "osm",
    sourceKeys: [],
    sourceIds: [],
    osmType: "node",
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
    sourceTagSample: input.sourceTagSample ?? {},
    writePayload: input.writePayload ?? {},
    warnings: [],
  };
}

function img(input: {
  title: string;
  caption?: string;
  sourceUrl?: string;
  sourceName?: string;
  imageUrl?: string;
}): PlaceImageResult {
  return {
    imageUrl: input.imageUrl ?? "https://example.com/photo.jpg",
    caption: input.caption ?? input.title,
    title: input.title,
    sourceName: input.sourceName ?? "example.com",
    sourceUrl: input.sourceUrl ?? "https://example.com/page",
    sourceDomain: input.sourceName ?? "example.com",
    provider: "serper",
  };
}

describe("Bennington obscure place photo search", () => {
  it("Sucker Pond query includes town, state, and country", () => {
    const doc = spotDoc({
      displayName: "Sucker Pond",
      sourceTagSample: { "addr:city": "Bennington", "addr:state": "Vermont", "addr:country": "United States" },
    });
    const query = buildOsmSpecificPhotoQuery(doc);
    expect(query.skip).toBe(false);
    expect(query.query).toContain("Sucker Pond");
    expect(query.query).toContain("Bennington");
    expect(query.query).toContain("Vermont");
    expect(query.query).toContain("United States");
  });

  it("Sucker Pond accepts compact-title geocities-style photos without town in metadata", () => {
    const doc = spotDoc({
      displayName: "Sucker Pond",
      sourceTagSample: { "addr:city": "Bennington", "addr:state": "Vermont" },
    });
    const query = buildOsmSpecificPhotoQuery(doc);
    const scored = scorePhotoSearchResultsForPlace(
      doc,
      query,
      [
        img({
          title: "SUCKERPOND",
          sourceUrl: "http://www.geocities.ws/kbeliveau_13/Suckerpond6.JPG",
          sourceName: "geocities.ws",
        }),
        img({
          title: "Stowe Vermont mountain trail scenic photo",
          sourceUrl: "https://stowe.com/trails",
        }),
      ],
      { scoringProfile: "undiscovered_app", strictTitleSourceMatch: true },
    );

    expect(scored.acceptedAssets.length).toBeGreaterThanOrEqual(1);
    expect(
      scored.acceptedAssets.some((asset) =>
        `${asset.title ?? ""} ${asset.caption}`.toLowerCase().includes("sucker"),
      ),
    ).toBe(true);
    expect(
      scored.acceptedAssets.every((asset) =>
        `${asset.title ?? ""} ${asset.caption}`.toLowerCase().includes("stowe"),
      ),
    ).toBe(false);
  });

  it("Sucker Pond accepts on-place results and rejects Stowe or generic Vermont-only hits", () => {
    const doc = spotDoc({
      displayName: "Sucker Pond",
      sourceTagSample: { "addr:city": "Bennington", "addr:state": "Vermont" },
    });
    const query = buildOsmSpecificPhotoQuery(doc);
    const scored = scorePhotoSearchResultsForPlace(
      doc,
      query,
      [
        img({
          title: "Stowe Vermont mountain trail scenic photo",
          sourceUrl: "https://stowe.com/trails",
        }),
        img({
          title: "Best hiking trails in Vermont",
          sourceUrl: "https://blog.example.com/vt-trails",
        }),
        img({
          title: "Sucker Pond trail Bennington Vermont",
          sourceUrl: "https://www.alltrails.com/trail/us/vermont/sucker-pond",
        }),
        img({
          title: "Sucker Pond scenic view Bennington VT",
          sourceUrl: "https://www.benningtonbanner.com/local-news/sucker-pond",
          sourceName: "benningtonbanner.com",
        }),
      ],
      { scoringProfile: "undiscovered_app", strictTitleSourceMatch: true },
    );

    expect(scored.acceptedAssets.length).toBeGreaterThanOrEqual(1);
    expect(
      scored.acceptedAssets.every((asset) => {
        const hay = `${asset.title ?? ""} ${asset.caption}`.toLowerCase();
        return hay.includes("sucker") && hay.includes("bennington");
      }),
    ).toBe(true);
    expect(
      scored.rejectedAssets.some((asset) =>
        `${asset.title} ${asset.caption}`.toLowerCase().includes("stowe"),
      ),
    ).toBe(true);
  });

  it("Connector Trail with Bennington requires town + full generic trail name", () => {
    const doc = spotDoc({
      displayName: "Connector Trail",
      primaryCategory: "hiking_trail",
      sourceTagSample: { "addr:city": "Bennington", "addr:state": "Vermont", "addr:country": "United States" },
    });
    const query = buildOsmSpecificPhotoQuery(doc);
    expect(query.skip).toBe(false);
    expect(query.query).toContain("Bennington");
    expect(query.query).toContain("United States");

    const scored = scorePhotoSearchResultsForPlace(
      doc,
      query,
      [
        img({
          title: "Connector trail Vermont woods hiking",
          sourceUrl: "https://example.com/generic-trail",
        }),
        img({
          title: "Norwich Vermont connector trail forest",
          sourceUrl: "https://example.com/norwich",
        }),
        img({
          title: "Connector Trail Bennington Vermont hiking",
          sourceUrl: "https://example.com/bennington-connector",
        }),
      ],
      { scoringProfile: "undiscovered_app", strictTitleSourceMatch: true },
    );

    expect(scored.acceptedAssets.length).toBeGreaterThanOrEqual(1);
    expect(
      scored.acceptedAssets.every((asset) =>
        `${asset.title ?? ""} ${asset.caption}`.toLowerCase().includes("bennington"),
      ),
    ).toBe(true);
    expect(
      scored.acceptedAssets.some((asset) =>
        `${asset.title ?? ""} ${asset.caption}`.toLowerCase().includes("norwich"),
      ),
    ).toBe(false);
    expect(scored.assetsReady).toBe(true);
  });

  it("Connector Trail without town is skipped — no safe lookup", () => {
    const doc = spotDoc({
      displayName: "Connector Trail",
      primaryCategory: "hiking_trail",
      lat: 0,
      lng: 0,
    });
    const query = buildOsmSpecificPhotoQuery(doc);
    expect(query.skip).toBe(true);
    expect(query.skipReason).toBe("query_too_generic_no_town");
  });

  it("named Bennington restaurant keeps multiple matching Google-style results", () => {
    const doc = spotDoc({
      displayName: "Topping Tavern",
      primaryCategory: "restaurant",
      sourceTagSample: { "addr:city": "Bennington", "addr:state": "Vermont", "addr:country": "United States" },
    });
    const query = buildOsmSpecificPhotoQuery(doc);
    expect(query.query).toContain("Topping Tavern");
    expect(query.query).toContain("Bennington");

    const results = Array.from({ length: 6 }, (_, index) =>
      img({
        title: `Topping Tavern Bennington Vermont photo ${index + 1}`,
        sourceUrl: `https://maps.google.com/place/topping-tavern-${index + 1}`,
        sourceName: "google.com",
        imageUrl: `https://example.com/topping-tavern-${index + 1}.jpg`,
      }),
    );

    const scored = scorePhotoSearchResultsForPlace(doc, query, results, {
      scoringProfile: "undiscovered_app",
      strictTitleSourceMatch: true,
    });

    expect(scored.acceptedAssets.length).toBeGreaterThanOrEqual(3);
    expect(
      scored.acceptedAssets.every((asset) =>
        `${asset.title ?? ""} ${asset.caption}`.toLowerCase().includes("topping"),
      ),
    ).toBe(true);
  });

  it("Old Seth Warner Shelter Site does not require geocoded town tokens in metadata", () => {
    const doc = spotDoc({
      displayName: "Old Seth Warner Shelter Site",
      primaryCategory: "camp_site",
      sourceTagSample: {
        "addr:city": "Bennington",
        "addr:state": "Vermont",
        tourism: "camp_site",
        operator: "Green Mountain Club",
      },
    });
    const query = buildOsmSpecificPhotoQuery(doc);
    expect(query.skip).toBe(false);
    expect(query.query).toContain("Bennington");

    const scored = scorePhotoSearchResultsForPlace(
      doc,
      query,
      [
        img({
          title: "Fishing near Old Seth Warner Shelter Site Campground on Stamford Pond Vermont",
          sourceUrl: "https://onwaterapp.com/fishing/vermont/seth-warner",
        }),
        img({
          title: "Seth Warner Shelter Camping | Clarksburg, Massachusetts",
          sourceUrl: "https://example.com/clarksburg-shelter",
        }),
      ],
      { scoringProfile: "undiscovered_app", strictTitleSourceMatch: false },
    );

    expect(scored.acceptedAssets.length).toBeGreaterThanOrEqual(1);
    expect(scored.identity.requiredNameTokens).not.toContain("bennington");
    expect(scored.identity.townTokens).toContain("bennington");
    expect(
      scored.acceptedAssets.every((asset) => {
        const hay = `${asset.title ?? ""} ${asset.caption}`.toLowerCase();
        return !hay.includes("clarksburg") || !hay.includes("massachusetts");
      }),
    ).toBe(true);
    expect(
      scored.rejectedAssets.some((asset) =>
        `${asset.title} ${asset.caption}`.toLowerCase().includes("clarksburg"),
      ),
    ).toBe(true);
  });

  it("Big Spruce Mountain still rejects unrelated mountain towns", () => {
    const doc = spotDoc({
      displayName: "Big Spruce Mountain",
      primaryCategory: "peak",
      lat: 43.12,
      lng: -72.98,
      sourceTagSample: { "addr:state": "Vermont", "addr:country": "United States" },
    });
    const query = buildOsmSpecificPhotoQuery(doc);
    const scored = scorePhotoSearchResultsForPlace(
      doc,
      query,
      [
        img({ title: "Stowe Vermont mountain view", sourceUrl: "https://stowe.com" }),
        img({ title: "Big Spruce Mountain Vermont hiking", sourceUrl: "https://alltrails.com/big-spruce" }),
      ],
      { scoringProfile: "undiscovered_app", strictTitleSourceMatch: true },
    );

    expect(scored.acceptedAssets).toHaveLength(1);
    expect(scored.acceptedAssets[0]?.title?.toLowerCase()).toContain("big spruce");
  });
});
