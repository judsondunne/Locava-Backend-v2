import { describe, expect, it } from "vitest";
import type { PlaceCandidate } from "../place-candidates/types.js";
import type { WikimediaAssetGroup, WikimediaGeneratedPost } from "../wikimediaMvp/WikimediaMvpTypes.js";
import { applyLocationTrustPolicy } from "./applyLocationTrustPolicy.js";
import { evaluateGeneratedPostQuality } from "./evaluateGeneratedPostQuality.js";
import { computeFactoryPostDisplay } from "./computeFactoryPostDisplay.js";

function vtCandidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    placeCandidateId: "vt_test",
    name: "Boulder Beach",
    state: "Vermont",
    stateCode: "VT",
    country: "US",
    lat: 44.2725,
    lng: -72.263333333,
    categories: ["beach"],
    primaryCategory: "beach",
    candidateTier: "A",
    sourceIds: {},
    sourceUrls: {},
    rawSources: [],
    sourceConfidence: 1,
    locavaScore: 80,
    signals: {
      hasCoordinates: true,
      hasWikipedia: false,
      hasWikidata: true,
      hasCommonsCategory: false,
      hasUsefulCategory: true,
      isOutdoorLikely: true,
      isLandmarkLikely: false,
      isTourismLikely: true,
      isTooGeneric: false,
    },
    debug: {
      matchedSourceCategories: [],
      normalizedFrom: [],
      scoreReasons: [],
      tierReasons: [],
      dedupeKey: "vt_test",
    },
    ...overrides,
  };
}

function basePost(overrides: Partial<WikimediaGeneratedPost> = {}): WikimediaGeneratedPost {
  return {
    postId: "g1",
    groupId: "g1",
    placeName: "Boulder Beach",
    generatedTitle: "Test",
    titleReasoning: [],
    titleConfidence: "high",
    activities: [],
    activityReasoning: [],
    status: "KEEP",
    rejectionReasons: [],
    reasoning: [],
    groupMethod: "exactDate",
    assetCount: 1,
    locatedAssetCount: 1,
    selectedLocation: {
      candidateId: "a1",
      latitude: -33.9,
      longitude: 18.4,
      reasoning: "place_candidate_fallback",
    },
    groupedCandidateIds: ["a1"],
    media: [
      {
        candidateId: "a1",
        sourceTitle: "File:Boulder Beach Simonstown 2018 01.jpg",
        sourceUrl: "https://commons.wikimedia.org/",
        thumbnailUrl: null,
        fullImageUrl: "https://upload.wikimedia.org/wikipedia/commons/1/1f/Boulder_Beach_Simonstown_2018_01.jpg",
        author: "A",
        license: "CC",
        credit: null,
        suppliesPostLocation: false,
        hasRealAssetLocation: true,
        assetLatitude: -33.9,
        assetLongitude: 18.4,
        hasAssetCoordinates: true,
        mediaPlaceMatchScore: 60,
        mediaPlaceMismatchReasons: [],
        sourceConfidenceRank: 2,
      },
    ],
    dryRunPostPreview: {},
    candidateReasoning: [],
    ...overrides,
  };
}

function groupFromPost(post: WikimediaGeneratedPost): WikimediaAssetGroup {
  return {
    groupId: post.groupId,
    placeName: post.placeName,
    groupKey: "k",
    groupMethod: "exactDate",
    hasLocatedAsset: true,
    locatedAssetCount: 1,
    assetCount: post.media.length,
    assets: post.media.map((m) => ({
      candidateId: m.candidateId,
      sourceTitle: m.sourceTitle,
      sourceUrl: m.sourceUrl,
      thumbnailUrl: m.thumbnailUrl,
      fullImageUrl: m.fullImageUrl,
      author: m.author,
      license: m.license,
      credit: m.credit,
      generatedTitle: m.sourceTitle,
      activities: [],
      activityReasoning: [],
      activityUncertainty: null,
      titleConfidence: "high" as const,
      placeMatchConfidence: 0.9,
      qualityScore: 70,
      relevanceScore: 60,
      coolnessScore: 50,
      duplicateScore: null,
      duplicateReason: null,
      status: "KEEP" as const,
      reasoning: [],
      scores: {},
      postPreview: null,
      dayKey: "2020-01-01",
      capturedAtMs: null,
      assetLatitude: m.assetLatitude ?? null,
      assetLongitude: m.assetLongitude ?? null,
      hasRealAssetLocation: Boolean(m.hasRealAssetLocation),
      width: 1000,
      height: 800,
      mediaPlaceMatchScore: m.mediaPlaceMatchScore ?? 50,
      mediaPlaceMismatchReasons: m.mediaPlaceMismatchReasons ?? [],
      sourceConfidenceRank: m.sourceConfidenceRank ?? 2,
      matchedQuery: "test",
      hygieneStatus: "PASS" as const,
      duplicateDecision: "UNIQUE" as const,
    })),
    representativeAssetId: post.media[0]!.candidateId,
    generatedTitle: post.generatedTitle,
    activities: [],
    status: "KEEP",
    rejectionReasons: [],
    reasoning: [],
  };
}

describe("applyLocationTrustPolicy", () => {
  it("rejects South Africa Boulder Beach geotag for Vermont (wrong state)", () => {
    const post = basePost();
    const group = groupFromPost(post);
    const out = applyLocationTrustPolicy({
      candidate: vtCandidate(),
      generatedPost: post,
      group,
      mode: "asset_geotag_required",
    });
    expect(out.locationTrust?.stagingAllowed).toBe(false);
    expect(out.status).toBe("REJECT");
    expect(out.rejectionReasons?.join(" ")).toMatch(/wrong_state|no_asset_geotag/);
  });

  it("keeps one in-state located anchor within distance", () => {
    const post = basePost({
      selectedLocation: { candidateId: "a1", latitude: 44.27, longitude: -72.26, reasoning: "asset" },
      media: [
        {
          ...basePost().media[0]!,
          assetLatitude: 44.27,
          assetLongitude: -72.26,
          hasRealAssetLocation: true,
          hasAssetCoordinates: true,
          mediaPlaceMatchScore: 70,
          sourceConfidenceRank: 1,
        },
      ],
    });
    const group = groupFromPost(post);
    const out = applyLocationTrustPolicy({
      candidate: vtCandidate(),
      generatedPost: post,
      group,
      mode: "asset_geotag_required",
    });
    expect(out.locationTrust?.stagingAllowed).toBe(true);
    expect(out.media.length).toBe(1);
    expect(out.selectedLocation.latitude).toBeCloseTo(44.27, 4);
  });

  it("includes strong unlocated ridealong when anchor exists", () => {
    const post = basePost({
      selectedLocation: { candidateId: "a1", latitude: 44.27, longitude: -72.26, reasoning: "asset" },
      media: [
        {
          ...basePost().media[0]!,
          candidateId: "a1",
          assetLatitude: 44.27,
          assetLongitude: -72.26,
          hasRealAssetLocation: true,
          hasAssetCoordinates: true,
          mediaPlaceMatchScore: 70,
          sourceConfidenceRank: 1,
        },
        {
          candidateId: "a2",
          sourceTitle: "File:Moss Glen Falls close.jpg",
          sourceUrl: "https://commons.wikimedia.org/",
          thumbnailUrl: null,
          fullImageUrl: "https://upload.wikimedia.org/test2.jpg",
          author: "B",
          license: "CC",
          credit: null,
          suppliesPostLocation: false,
          hasRealAssetLocation: false,
          assetLatitude: null,
          assetLongitude: null,
          hasAssetCoordinates: false,
          mediaPlaceMatchScore: 80,
          mediaPlaceMismatchReasons: [],
          sourceConfidenceRank: 1,
        },
      ],
      assetCount: 2,
    });
    const group = groupFromPost(post);
    const out = applyLocationTrustPolicy({
      candidate: vtCandidate({
        name: "Moss Glen Falls",
        lat: 44.27,
        lng: -72.26,
        categories: ["waterfall"],
      }),
      generatedPost: post,
      group,
      mode: "asset_geotag_required",
    });
    expect(out.locationTrust?.stagingAllowed).toBe(true);
    expect(out.media.some((m) => m.candidateId === "a2")).toBe(true);
    expect(out.locationTrust?.nonlocatedRidealongCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects group with only unlocated assets", () => {
    const post = basePost({
      status: "KEEP",
      locatedAssetCount: 0,
      selectedLocation: {
        candidateId: "a2",
        latitude: 44.27,
        longitude: -72.26,
        reasoning: "place_candidate_fallback",
      },
      media: [
        {
          candidateId: "a2",
          sourceTitle: "File:Some falls.jpg",
          sourceUrl: "https://commons.wikimedia.org/",
          thumbnailUrl: null,
          fullImageUrl: "https://upload.wikimedia.org/x.jpg",
          author: "B",
          license: "CC",
          credit: null,
          suppliesPostLocation: false,
          hasRealAssetLocation: false,
          assetLatitude: null,
          assetLongitude: null,
          hasAssetCoordinates: false,
          mediaPlaceMatchScore: 90,
          mediaPlaceMismatchReasons: [],
          sourceConfidenceRank: 1,
        },
      ],
      assetCount: 1,
    });
    const group = groupFromPost(post);
    const out = applyLocationTrustPolicy({
      candidate: vtCandidate({ name: "Wilson Castle" }),
      generatedPost: post,
      group,
      mode: "asset_geotag_required",
    });
    expect(out.locationTrust?.stagingAllowed).toBe(false);
  });
});

describe("evaluateGeneratedPostQuality + wouldStage semantics", () => {
  it("wouldStage requires stageable under asset_geotag_required (rejects needs_review path)", () => {
    const candidate = vtCandidate();
    const post = applyLocationTrustPolicy({
      candidate,
      generatedPost: basePost({
        selectedLocation: { candidateId: "a1", latitude: 44.27, longitude: -72.26, reasoning: "asset" },
        media: [
          {
            ...basePost().media[0]!,
            assetLatitude: 44.27,
            assetLongitude: -72.26,
            hasRealAssetLocation: true,
            hasAssetCoordinates: true,
          },
        ],
        status: "REVIEW",
        reviewAssetCount: 1,
      }),
      group: groupFromPost(
        basePost({
          selectedLocation: { candidateId: "a1", latitude: 44.27, longitude: -72.26, reasoning: "asset" },
          media: [
            {
              ...basePost().media[0]!,
              assetLatitude: 44.27,
              assetLongitude: -72.26,
              hasRealAssetLocation: true,
              hasAssetCoordinates: true,
            },
          ],
        }),
      ),
      mode: "asset_geotag_required",
    });
    const fd = computeFactoryPostDisplay({ candidate, generatedPost: post });
    const q = evaluateGeneratedPostQuality({
      candidate,
      generatedPost: post,
      locationTrustMode: "asset_geotag_required",
      effectiveTitle: fd.title,
      effectiveDescription: fd.description,
      effectiveLat: fd.lat,
      effectiveLng: fd.lng,
    });
    expect(q.status).toBe("rejected");
  });
});
