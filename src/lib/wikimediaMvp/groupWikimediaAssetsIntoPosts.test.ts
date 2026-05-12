import { describe, expect, it } from "vitest";
import { buildWikimediaDryRunPosts } from "./buildWikimediaDryRunPosts.js";
import { groupWikimediaAssetsIntoPosts, toAnalyzedCandidate } from "./groupWikimediaAssetsIntoPosts.js";
import type { WikimediaMvpCandidateAnalysis } from "./WikimediaMvpTypes.js";

function baseAnalysis(overrides: Partial<WikimediaMvpCandidateAnalysis> = {}): WikimediaMvpCandidateAnalysis {
  return {
    sourceTitle: "File:Example.jpg",
    generatedTitle: "Example",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    thumbnailUrl: "https://example.com/thumb.jpg",
    fullImageUrl: "https://example.com/full.jpg",
    author: null,
    license: null,
    credit: null,
    activities: ["view"],
    activityReasoning: [],
    activityUncertainty: null,
    titleConfidence: "high",
    placeMatchConfidence: 0.8,
    qualityScore: 8,
    relevanceScore: 6,
    coolnessScore: 3,
    duplicateScore: null,
    duplicateReason: null,
    status: "KEEP",
    reasoning: [],
    scores: {},
    postPreview: null,
    ...overrides,
  };
}

describe("groupWikimediaAssetsIntoPosts", () => {
  it("groups assets with the same exact date", () => {
    const place = { placeName: "Test Place", searchQuery: "Test Place" };
    const candidates = [
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "A", fullImageUrl: "https://a" }), {
        dayKey: "2020-05-01",
        capturedAtMs: Date.parse("2020-05-01T10:00:00Z"),
        lat: 40.1,
        lon: -75.1,
        width: 1000,
        height: 800,
      }),
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "B", fullImageUrl: "https://b" }), {
        dayKey: "2020-05-01",
        capturedAtMs: Date.parse("2020-05-01T12:00:00Z"),
        lat: null,
        lon: null,
        width: 1000,
        height: 800,
      }),
    ];
    const groups = groupWikimediaAssetsIntoPosts({ place, candidates });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.groupMethod).toBe("exactDate");
    expect(groups[0]?.assetCount).toBe(2);
  });

  it("groups assets by month when exact date is missing", () => {
    const place = { placeName: "Test Place", searchQuery: "Test Place" };
    const candidates = [
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "A", fullImageUrl: "https://a" }), {
        dayKey: "2020-05",
        capturedAtMs: Date.parse("2020-05-10T10:00:00Z"),
        lat: 40.1,
        lon: -75.1,
        width: 1000,
        height: 800,
      }),
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "B", fullImageUrl: "https://b" }), {
        dayKey: "2020-05",
        capturedAtMs: Date.parse("2020-05-20T10:00:00Z"),
        lat: 40.2,
        lon: -75.2,
        width: 1000,
        height: 800,
      }),
    ];
    const groups = groupWikimediaAssetsIntoPosts({ place, candidates });
    expect(groups[0]?.groupMethod).toBe("month");
    expect(groups[0]?.assetCount).toBe(2);
  });

  it("groups assets by year when only year is available", () => {
    const place = { placeName: "Test Place", searchQuery: "Test Place" };
    const candidates = [
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "A", fullImageUrl: "https://a" }), {
        dayKey: "2020",
        capturedAtMs: null,
        lat: 40.1,
        lon: -75.1,
        width: 1000,
        height: 800,
      }),
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "B", fullImageUrl: "https://b" }), {
        dayKey: "2020",
        capturedAtMs: null,
        lat: 40.2,
        lon: -75.2,
        width: 1000,
        height: 800,
      }),
    ];
    const groups = groupWikimediaAssetsIntoPosts({ place, candidates });
    expect(groups[0]?.groupMethod).toBe("year");
  });

  it("allows locationless assets to join a located group", () => {
    const place = { placeName: "Test Place", searchQuery: "Test Place" };
    const candidates = [
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "Located", fullImageUrl: "https://located" }), {
        dayKey: "2021-01-01",
        capturedAtMs: null,
        lat: 48.8584,
        lon: 2.2945,
        width: 1000,
        height: 800,
      }),
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "NoGps", fullImageUrl: "https://nogps" }), {
        dayKey: "2021-01-01",
        capturedAtMs: null,
        lat: null,
        lon: null,
        width: 1000,
        height: 800,
      }),
    ];
    const groups = groupWikimediaAssetsIntoPosts({ place, candidates });
    expect(groups[0]?.status).toBe("KEEP");
    expect(groups[0]?.locatedAssetCount).toBe(1);
    expect(groups[0]?.assetCount).toBe(2);
  });

  it("uses place_candidate fallback when no geotags but place has coordinates and match scores", () => {
    const place = {
      placeName: "Moss Glen Falls",
      searchQuery: "Moss Glen Falls",
      latitude: 44.01,
      longitude: -72.85,
    };
    const candidates = [
      toAnalyzedCandidate(
        baseAnalysis({
          sourceTitle: "File:Moss Glen Falls VT.jpg",
          fullImageUrl: "https://a",
          mediaPlaceMatchScore: 75,
        }),
        {
          dayKey: "unknown",
          capturedAtMs: null,
          lat: null,
          lon: null,
          width: 1000,
          height: 800,
        },
      ),
    ];
    const groups = groupWikimediaAssetsIntoPosts({ place, candidates });
    expect(groups[0]?.rejectionReasons).not.toContain("group_has_no_located_assets");
    expect(groups[0]?.locationFallback).toBe("place_candidate");
  });

  it("rejects groups with zero located assets", () => {
    const place = { placeName: "Test Place", searchQuery: "Test Place" };
    const candidates = [
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "A", fullImageUrl: "https://a" }), {
        dayKey: "2021-01-01",
        capturedAtMs: null,
        lat: null,
        lon: null,
        width: 1000,
        height: 800,
      }),
    ];
    const groups = groupWikimediaAssetsIntoPosts({ place, candidates });
    expect(groups[0]?.status).toBe("REJECT");
    expect(groups[0]?.rejectionReasons).toContain("group_has_no_located_assets");
  });

  it("builds dry-run previews with one representative location", () => {
    const place = { placeName: "Test Place", searchQuery: "Test Place" };
    const candidates = [
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "A", fullImageUrl: "https://a", qualityScore: 5 }), {
        dayKey: "2021-01-01",
        capturedAtMs: null,
        lat: 48.1,
        lon: 2.1,
        width: 1000,
        height: 800,
      }),
      toAnalyzedCandidate(baseAnalysis({ sourceTitle: "B", fullImageUrl: "https://b", qualityScore: 9 }), {
        dayKey: "2021-01-01",
        capturedAtMs: null,
        lat: 48.2,
        lon: 2.2,
        width: 1000,
        height: 800,
      }),
    ];
    const groups = groupWikimediaAssetsIntoPosts({ place, candidates });
    const posts = buildWikimediaDryRunPosts({ place, groups, dryRun: true, allowWrites: false });
    expect(posts[0]?.assetCount).toBe(2);
    expect(posts[0]?.dryRunPostPreview.dryRun).toBe(true);
    expect(posts[0]?.selectedLocation.latitude).toBe(48.2);
  });
});
