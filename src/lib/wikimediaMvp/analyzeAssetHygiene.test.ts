import { describe, expect, it, vi } from "vitest";
import { applyWikimediaAssetHygieneToGroup } from "./analyzeAssetHygiene.js";
import { dedupeExactGroupAssets, dedupeNearGroupAssets, type HygieneCandidate } from "./dedupeWikimediaGroupAssets.js";
import { evaluateBadAssetHygiene } from "./filterBadWikimediaAssets.js";
import { buildWikimediaDryRunPosts } from "./buildWikimediaDryRunPosts.js";
import { groupWikimediaAssetsIntoPosts, toAnalyzedCandidate } from "./groupWikimediaAssetsIntoPosts.js";
import type { WikimediaAssetGroup, WikimediaMvpCandidateAnalysis } from "./WikimediaMvpTypes.js";
import * as visualHashModule from "./visualHashFromImageUrl.js";

function baseAnalysis(overrides: Partial<WikimediaMvpCandidateAnalysis> = {}): WikimediaMvpCandidateAnalysis {
  return {
    sourceTitle: "File:Example.jpg",
    generatedTitle: "Example",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    thumbnailUrl: "https://example.com/thumb.jpg",
    fullImageUrl: "https://example.com/full.jpg",
    author: "Author",
    license: "CC",
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

function hygieneCandidate(overrides: Partial<HygieneCandidate> = {}): HygieneCandidate {
  const analyzed = toAnalyzedCandidate(
    baseAnalysis({
      sourceTitle: overrides.sourceTitle ?? "File:Example.jpg",
      fullImageUrl: overrides.fullImageUrl ?? "https://example.com/full.jpg",
      thumbnailUrl: overrides.thumbnailUrl ?? "https://example.com/thumb.jpg",
      sourceUrl: overrides.sourceUrl ?? "https://commons.wikimedia.org/wiki/File:Example.jpg",
      author: overrides.author ?? "Author",
      qualityScore: overrides.qualityScore ?? 8,
      relevanceScore: overrides.relevanceScore ?? 6,
    }),
    {
      dayKey: overrides.dayKey ?? "2020-05-01",
      capturedAtMs: overrides.capturedAtMs ?? Date.parse("2020-05-01T10:00:00Z"),
      lat: overrides.assetLatitude ?? 40.1,
      lon: overrides.assetLongitude ?? -75.1,
      width: overrides.width ?? 1200,
      height: overrides.height ?? 900,
    },
  );
  return {
    ...analyzed,
    hygieneStatus: overrides.hygieneStatus ?? "PASS",
    hygieneReasons: overrides.hygieneReasons ?? [],
    hygieneWarnings: overrides.hygieneWarnings ?? [],
    duplicateDecision: overrides.duplicateDecision ?? "UNIQUE",
    qualityFlags: overrides.qualityFlags ?? {},
    visualHash: overrides.visualHash,
    visualHashDistanceToPrimary: overrides.visualHashDistanceToPrimary,
    duplicateClusterId: overrides.duplicateClusterId,
  };
}

function baseGroup(assets: HygieneCandidate[]): WikimediaAssetGroup {
  return {
    groupId: "group-1",
    placeName: "Test Place",
    groupKey: "2020-05-01",
    groupMethod: "exactDate",
    hasLocatedAsset: assets.some((a) => a.hasRealAssetLocation),
    locatedAssetCount: assets.filter((a) => a.hasRealAssetLocation).length,
    assetCount: assets.length,
    assets,
    representativeAssetId: assets[0]!.candidateId,
    generatedTitle: assets[0]!.generatedTitle,
    activities: ["view"],
    status: "KEEP",
    rejectionReasons: [],
    reasoning: [],
  };
}

describe("wikimedia asset hygiene", () => {
  it("removes exact duplicate by same source URL", () => {
    const weaker = hygieneCandidate({ fullImageUrl: "https://example.com/shared.jpg", qualityScore: 4, relevanceScore: 2 });
    const stronger = hygieneCandidate({
      candidateId: "stronger",
      sourceTitle: "File:Better.jpg",
      fullImageUrl: "https://example.com/shared.jpg",
      qualityScore: 9,
      relevanceScore: 8,
    });
    const result = dedupeExactGroupAssets([weaker, stronger]);
    expect(result.kept).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.hygieneReasons).toContain("exact_duplicate_same_source");
  });

  it("removes weaker duplicate when timestamp and visual hash match", () => {
    const primary = hygieneCandidate({
      visualHash: "0000000000000000",
      capturedAtMs: Date.parse("2020-05-01T10:00:00Z"),
      qualityScore: 9,
    });
    const duplicate = hygieneCandidate({
      sourceTitle: "File:Dup.jpg",
      fullImageUrl: "https://example.com/dup.jpg",
      visualHash: "0000000000000000",
      capturedAtMs: Date.parse("2020-05-01T10:00:10Z"),
      qualityScore: 4,
    });
    const result = dedupeNearGroupAssets([primary, duplicate]);
    expect(result.kept).toHaveLength(1);
    expect(result.removed[0]?.hygieneReasons).toContain("near_duplicate_visual_hash_and_close_timestamp");
  });

  it("keeps both assets when timestamps are close but visual hashes differ", () => {
    const a = hygieneCandidate({ visualHash: "0000000000000000", capturedAtMs: Date.parse("2020-05-01T10:00:00Z") });
    const b = hygieneCandidate({
      sourceTitle: "File:Other.jpg",
      fullImageUrl: "https://example.com/other.jpg",
      visualHash: "ffffffffffffffff",
      capturedAtMs: Date.parse("2020-05-01T10:00:30Z"),
    });
    const result = dedupeNearGroupAssets([a, b]);
    expect(result.kept).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it("keeps assets with same date and location but different visual hashes", () => {
    const a = hygieneCandidate({ visualHash: "0000000000000000", assetLatitude: 40.1, assetLongitude: -75.1 });
    const b = hygieneCandidate({
      sourceTitle: "File:Other.jpg",
      fullImageUrl: "https://example.com/other.jpg",
      visualHash: "ffffffffffffffff",
      assetLatitude: 40.10001,
      assetLongitude: -75.10001,
    });
    const result = dedupeNearGroupAssets([a, b]);
    expect(result.kept).toHaveLength(2);
  });

  it("rejects panorama aspect ratio", () => {
    const candidate = toAnalyzedCandidate(baseAnalysis(), {
      dayKey: "2020-05-01",
      capturedAtMs: null,
      lat: 40.1,
      lon: -75.1,
      width: 3000,
      height: 1000,
    });
    const hygiene = evaluateBadAssetHygiene(candidate);
    expect(hygiene.hygieneStatus).toBe("REJECT");
    expect(hygiene.hygieneReasons).toContain("rejected_panorama_aspect_ratio");
  });

  it("keeps normal vertical phone ratio", () => {
    const candidate = toAnalyzedCandidate(baseAnalysis(), {
      dayKey: "2020-05-01",
      capturedAtMs: null,
      lat: 40.1,
      lon: -75.1,
      width: 1080,
      height: 1920,
    });
    const hygiene = evaluateBadAssetHygiene(candidate);
    expect(hygiene.hygieneStatus).toBe("PASS");
  });

  it("rejects low-resolution image", () => {
    const candidate = toAnalyzedCandidate(baseAnalysis(), {
      dayKey: "2020-05-01",
      capturedAtMs: null,
      lat: 40.1,
      lon: -75.1,
      width: 600,
      height: 600,
    });
    const hygiene = evaluateBadAssetHygiene(candidate);
    expect(hygiene.hygieneReasons).toContain("rejected_low_resolution");
  });

  it("rejects missing image URL", () => {
    const candidate = toAnalyzedCandidate(baseAnalysis({ fullImageUrl: "" }), {
      dayKey: "2020-05-01",
      capturedAtMs: null,
      lat: 40.1,
      lon: -75.1,
      width: 1200,
      height: 900,
    });
    const hygiene = evaluateBadAssetHygiene(candidate);
    expect(hygiene.hygieneReasons).toContain("rejected_missing_usable_image_url");
  });

  it("rejects black-and-white metadata", () => {
    const candidate = toAnalyzedCandidate(baseAnalysis({ sourceTitle: "File:Black and white falls.jpg" }), {
      dayKey: "2020-05-01",
      capturedAtMs: null,
      lat: 40.1,
      lon: -75.1,
      width: 1200,
      height: 900,
    });
    const hygiene = evaluateBadAssetHygiene(candidate);
    expect(hygiene.hygieneReasons).toContain("rejected_black_and_white_metadata");
  });

  it("keeps possible duplicate as REVIEW instead of rejecting", () => {
    const primary = hygieneCandidate({
      visualHash: "0000000000000000",
      capturedAtMs: Date.parse("2020-05-01T10:00:00Z"),
      assetLatitude: 40.1,
      assetLongitude: -75.1,
    });
    const possible = hygieneCandidate({
      sourceTitle: "File:Maybe.jpg",
      fullImageUrl: "https://example.com/maybe.jpg",
      visualHash: "00000000000000ff",
      capturedAtMs: Date.parse("2020-05-02T10:00:00Z"),
      assetLatitude: 41.2,
      assetLongitude: -76.2,
    });
    const result = dedupeNearGroupAssets([primary, possible]);
    expect(result.removed).toHaveLength(0);
    expect(result.kept[1]?.duplicateDecision).toBe("POSSIBLE_DUPLICATE_REVIEW");
    expect(result.kept[1]?.hygieneStatus).toBe("REVIEW");
  });

  it("keeps asset conservatively when visual hash fails", async () => {
    vi.spyOn(visualHashModule, "computeDHashFromImageUrl").mockResolvedValue(null);
    const group = baseGroup([hygieneCandidate()]);
    const result = await applyWikimediaAssetHygieneToGroup({ group, computeVisualHashes: true });
    expect(result.keptAssetCount).toBe(1);
    expect(result.assets[0]?.hygieneWarnings).toContain("visual_hash_failed_kept_conservative");
    vi.restoreAllMocks();
  });

  it("still requires at least one real located asset after hygiene", async () => {
    vi.spyOn(visualHashModule, "computeDHashFromImageUrl").mockResolvedValue(null);
    const locatedPanorama = hygieneCandidate({ width: 3000, height: 1000 });
    const group = baseGroup([locatedPanorama]);
    const result = await applyWikimediaAssetHygieneToGroup({ group, computeVisualHashes: false });
    expect(result.status).toBe("REJECT");
    expect(result.rejectionReasons).toContain("all_assets_failed_hygiene");
    vi.restoreAllMocks();
  });

  it("builds dry-run posts without Firestore writes", () => {
    const place = { placeName: "Test Place", searchQuery: "Test Place" };
    const candidates = [
      toAnalyzedCandidate(baseAnalysis(), {
        dayKey: "2020-05-01",
        capturedAtMs: Date.parse("2020-05-01T10:00:00Z"),
        lat: 40.1,
        lon: -75.1,
        width: 1200,
        height: 900,
      }),
    ];
    const groups = groupWikimediaAssetsIntoPosts({ place, candidates });
    const posts = buildWikimediaDryRunPosts({ place, groups, dryRun: true, allowWrites: false });
    expect(posts[0]?.dryRunPostPreview.dryRun).toBe(true);
  });
});
