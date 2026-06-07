import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { PlaceImageResult } from "../../types/places.js";
import { buildOsmSpecificPhotoQuery } from "./buildOsmSpecificPhotoQuery.js";
import { scorePhotoSearchResultsForPlace } from "./scorePhotoSearchResultsForPlace.js";

function baseDoc(overrides: Partial<PbfCopierPreviewDoc> = {}): PbfCopierPreviewDoc {
  return {
    id: "way/614144559",
    kind: "unexplored_spot",
    displayName: "Martha Canfield Library",
    primaryActivity: "library",
    primaryCategory: "library",
    activities: ["library"],
    osmType: "way",
    osmId: 614144559,
    lat: 43.08,
    lng: -73.24,
    sourceTagSample: { "addr:city": "Arlington" },
    publicMapEligible: true,
    mapReadiness: "ready",
    ...overrides,
  } as PbfCopierPreviewDoc;
}

function img(partial: Partial<PlaceImageResult>): PlaceImageResult {
  return {
    id: "x",
    imageUrl: "https://example.com/photo.jpg",
    caption: "",
    sourceName: "example.com",
    sourceUrl: "https://example.com",
    ...partial,
  };
}

describe("scorePhotoResultMetadata word boundaries", () => {
  it("does not treat Ottauquechee as wrong-town Quechee", () => {
    const d = {
      id: "w/1",
      kind: "unexplored_spot" as const,
      displayName: "Taftsville Covered Bridge",
      primaryCategory: "bridge",
      sourceTagSample: { "addr:city": "Woodstock" },
      osmType: "way" as const,
      osmId: 1,
      lat: 43.7,
      lng: -72.3,
      publicMapEligible: true,
      mapReadiness: "ready" as const,
    };
    const query = buildOsmSpecificPhotoQuery(d);
    const scored = scorePhotoSearchResultsForPlace(d, query, [
      {
        id: "1",
        imageUrl: "https://example.com/a.jpg",
        caption: "Taftsville Covered Bridge Woodstock Vermont Ottauquechee River",
        sourceUrl: "https://www.vermontvacation.com/taftsville-covered-bridge",
        sourceName: "vermontvacation.com",
      },
      {
        id: "2",
        imageUrl: "https://example.com/b.jpg",
        caption: "Taftsville bridge Woodstock VT historic photo",
        sourceUrl: "https://commons.wikimedia.org/wiki/Taftsville_Covered_Bridge",
        sourceName: "wikimedia.org",
      },
    ]);
    expect(scored.assetStatus).toBe("found");
    expect(scored.assetsReady).toBe(true);
  });
});

describe("scorePhotoSearchResultsForPlace", () => {
  it("accepts place-specific building photo metadata", () => {
    const doc = baseDoc();
    const query = buildOsmSpecificPhotoQuery(doc);
    const scored = scorePhotoSearchResultsForPlace(doc, query, [
      img({
        imageUrl: "https://benningtonbanner.com/mcl.jpg",
        caption: "Martha Canfield Library exterior Arlington Vermont",
        sourceName: "benningtonbanner.com",
        sourceUrl: "https://benningtonbanner.com/article",
      }),
      img({
        imageUrl: "https://library.org/building.jpg",
        caption: "Martha Canfield Library Arlington VT",
        sourceName: "marthacanfieldlibrary.org",
        sourceUrl: "https://marthacanfieldlibrary.org/about",
      }),
    ]);
    expect(scored.assetStatus).toBe("found");
    expect(scored.assetsReady).toBe(true);
    expect(scored.acceptedAssets.length).toBeGreaterThan(0);
    expect(scored.shouldRunGemini).toBe(false);
  });

  it("rejects flyer-heavy results and leaves spot blank", () => {
    const doc = baseDoc();
    const query = buildOsmSpecificPhotoQuery(doc);
    const scored = scorePhotoSearchResultsForPlace(doc, query, [
      img({
        imageUrl: "https://marthacanfieldlibrary.org/wp-content/uploads/flyer.png",
        caption: "Summer reading program deadlines Martha Canfield Library",
        sourceName: "marthacanfieldlibrary.org",
        sourceUrl: "https://marthacanfieldlibrary.org/events/summer",
      }),
      img({
        imageUrl: "https://marthacanfieldlibrary.org/newsletter.pdf",
        caption: "Library newsletter agenda meeting minutes",
        sourceName: "marthacanfieldlibrary.org",
        sourceUrl: "https://marthacanfieldlibrary.org/calendar",
      }),
    ]);
    expect(scored.assetStatus).toBe("low_confidence");
    expect(scored.assetsReady).toBe(false);
    expect(scored.acceptedAssets).toHaveLength(0);
    expect(scored.rejectedCount).toBeGreaterThan(0);
    expect(scored.warnings.some((w) => w.includes("safer to leave blank"))).toBe(true);
  });

  it("returns no_good_match for generic Vermont-only hits", () => {
    const doc = baseDoc({ displayName: "Random Local Bridge" });
    const query = buildOsmSpecificPhotoQuery(doc);
    const scored = scorePhotoSearchResultsForPlace(doc, query, [
      img({
        caption: "Beautiful covered bridge in Vermont scenic autumn",
        sourceUrl: "https://stock.example.com/vermont-bridge",
        imageUrl: "https://stock.example.com/bridge.jpg",
      }),
    ]);
    expect(["no_good_match", "low_confidence", "skipped"]).toContain(scored.assetStatus);
    expect(scored.assetsReady).toBe(false);
    expect(scored.acceptedAssets).toHaveLength(0);
  });
});
