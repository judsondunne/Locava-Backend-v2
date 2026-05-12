import { buildDryRunPostPreview } from "./buildDryRunPostPreview.js";
import { dedupeStableStrings } from "./dedupeStableStrings.js";
import { generateLocavaTitle } from "./generateLocavaTitle.js";
import { haversineMiles } from "./geoDistance.js";
import { inferCandidateActivities } from "./inferCandidateActivities.js";
import { computeMediaPlaceMatchScore } from "./mediaPlaceMatchScore.js";
import { scoreWikimediaCandidate } from "./scoreWikimediaCandidate.js";
import type {
  WikimediaMvpCandidateAnalysis,
  WikimediaMvpCandidateStatus,
  WikimediaMvpNormalizedAsset,
  WikimediaMvpSeedPlace,
} from "./WikimediaMvpTypes.js";

function placeMatchConfidence(place: WikimediaMvpSeedPlace, asset: WikimediaMvpNormalizedAsset): number {
  const text = `${asset.title} ${asset.categories.join(" ")}`.toLowerCase();
  const tokens = `${place.placeName} ${place.searchQuery}`
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 3);
  if (tokens.length === 0) return 0.2;
  const hits = tokens.filter((t) => text.includes(t)).length;
  return Math.min(1, hits / tokens.length);
}

function decideStatus(input: {
  rejected: boolean;
  relevanceScore: number;
  qualityScore: number;
  titleConfidence: "high" | "medium" | "low";
  placeMatchConfidence: number;
  mediaPlaceMatchScore: number;
  hasAssetGeotag: boolean;
  assetDistanceMilesFromPlace: number | null;
  /** Title contains full normalized place name (Commons exact-name signal). */
  exactPlaceNameInTitle: boolean;
}): WikimediaMvpCandidateStatus {
  if (input.rejected) return "REJECT";
  if (input.mediaPlaceMatchScore < 45 && !input.hasAssetGeotag) {
    if (input.exactPlaceNameInTitle && input.mediaPlaceMatchScore >= 28) {
      /* allow REVIEW path for strong title tie without geotag */
    } else {
      return "REJECT";
    }
  }
  if (input.mediaPlaceMatchScore < 70 && !input.hasAssetGeotag) return "REVIEW";
  if (input.titleConfidence === "low" || input.placeMatchConfidence < 0.25) return "REVIEW";
  if (input.relevanceScore < 2 || input.qualityScore < 4) return "REVIEW";
  if (
    input.hasAssetGeotag &&
    input.assetDistanceMilesFromPlace != null &&
    input.assetDistanceMilesFromPlace > 15 &&
    input.mediaPlaceMatchScore < 88
  ) {
    return "REVIEW";
  }
  return "KEEP";
}

export function analyzeWikimediaCandidate(input: {
  place: WikimediaMvpSeedPlace;
  asset: WikimediaMvpNormalizedAsset;
  duplicateReason: string | null;
  dryRun: boolean;
  allowWrites: boolean;
}): WikimediaMvpCandidateAnalysis {
  const reasoning: string[] = [];
  const hasAssetGeotag = input.asset.lat != null && input.asset.lon != null;

  let assetDistanceMilesFromPlace: number | null = null;
  if (
    hasAssetGeotag &&
    input.place.latitude != null &&
    input.place.longitude != null &&
    Number.isFinite(Number(input.place.latitude)) &&
    Number.isFinite(Number(input.place.longitude))
  ) {
    assetDistanceMilesFromPlace = haversineMiles(
      { lat: input.asset.lat!, lng: input.asset.lon! },
      { lat: Number(input.place.latitude), lng: Number(input.place.longitude) },
    );
    if (assetDistanceMilesFromPlace > 50) {
      reasoning.push(`asset_geotag_far_from_place: ${assetDistanceMilesFromPlace.toFixed(0)}mi`);
      return {
        sourceTitle: input.asset.title,
        generatedTitle: input.asset.title,
        sourceUrl: input.asset.pageUrl,
        thumbnailUrl: input.asset.thumbnailUrl,
        fullImageUrl: input.asset.imageUrl,
        author: input.asset.author ?? null,
        license: input.asset.license ?? null,
        credit: input.asset.credit ?? null,
        activities: [],
        activityReasoning: [],
        activityUncertainty: null,
        titleConfidence: "low",
        placeMatchConfidence: 0,
        mediaPlaceMatchScore: 0,
        mediaPlaceMatchReasons: [],
        mediaPlaceMismatchReasons: dedupeStableStrings(["asset_geotag_far_from_place", "wrong_state_or_region"]),
        matchedQuery: input.asset.matchedQuery,
        matchedQueryRank: input.asset.matchedQueryRank,
        queryVariantType: input.asset.queryVariantType,
        sourceLabel: input.asset.sourceLabel,
        sourceConfidenceRank: input.asset.sourceConfidenceRank,
        assetDistanceMilesFromPlace,
        qualityScore: 0,
        relevanceScore: 0,
        coolnessScore: 0,
        duplicateScore: null,
        duplicateReason: null,
        status: "REJECT",
        reasoning: dedupeStableStrings(reasoning),
        scores: {},
        postPreview: null,
      };
    }
  }

  const pn = String(input.place.placeName || "").toLowerCase();
  const titleLower = input.asset.title.toLowerCase();
  if (
    String(input.place.stateCode || "").toUpperCase() === "VT" &&
    pn.includes("appalachian gap") &&
    (/\bdelaware water gap\b/i.test(titleLower) ||
      /\bpennsylvania\b.*\bappalachian trail\b/i.test(titleLower) ||
      /\bappalachian trail\b.*\bpennsylvania\b/i.test(titleLower)) &&
    !titleLower.includes("vermont") &&
    !/\bvt\b/i.test(titleLower)
  ) {
    reasoning.push("wrong_state_or_region:pennsylvania_delaware_water_gap_for_vt_appalachian_gap");
    return {
      sourceTitle: input.asset.title,
      generatedTitle: input.asset.title,
      sourceUrl: input.asset.pageUrl,
      thumbnailUrl: input.asset.thumbnailUrl,
      fullImageUrl: input.asset.imageUrl,
      author: input.asset.author ?? null,
      license: input.asset.license ?? null,
      credit: input.asset.credit ?? null,
      activities: [],
      activityReasoning: [],
      activityUncertainty: null,
      titleConfidence: "low",
      placeMatchConfidence: 0,
      mediaPlaceMatchScore: 0,
      mediaPlaceMatchReasons: [],
      mediaPlaceMismatchReasons: ["wrong_state_or_region"],
      matchedQuery: input.asset.matchedQuery,
      matchedQueryRank: input.asset.matchedQueryRank,
      queryVariantType: input.asset.queryVariantType,
      sourceLabel: input.asset.sourceLabel,
      sourceConfidenceRank: input.asset.sourceConfidenceRank,
      assetDistanceMilesFromPlace,
      qualityScore: 0,
      relevanceScore: 0,
      coolnessScore: 0,
      duplicateScore: null,
      duplicateReason: null,
      status: "REJECT",
      reasoning: dedupeStableStrings(reasoning),
      scores: {},
      postPreview: null,
    };
  }

  const placeMatch = computeMediaPlaceMatchScore(input.place, input.asset, {
    matchedQuery: input.asset.matchedQuery,
    queryVariantType: input.asset.queryVariantType,
    sourceConfidenceRank: input.asset.sourceConfidenceRank,
    distanceMiles: assetDistanceMilesFromPlace ?? undefined,
  });

  const wrongRegion = placeMatch.mismatchReasons.some((r) => r.startsWith("wrong_place_region_"));
  const genericFlickr = placeMatch.mismatchReasons.includes("generic_flickr_title");
  const wrongState = placeMatch.mismatchReasons.includes("title_or_meta_suggests_different_us_state");

  if (wrongState || genericFlickr || (wrongRegion && placeMatch.score < 55)) {
    const detail = dedupeStableStrings([
      ...placeMatch.mismatchReasons,
      ...(wrongRegion ? ["wrong_place_region"] : []),
    ]).join("; ");
    reasoning.push(`media_place_match_reject: score=${placeMatch.score}`, detail);
    return {
      sourceTitle: input.asset.title,
      generatedTitle: input.asset.title,
      sourceUrl: input.asset.pageUrl,
      thumbnailUrl: input.asset.thumbnailUrl,
      fullImageUrl: input.asset.imageUrl,
      author: input.asset.author ?? null,
      license: input.asset.license ?? null,
      credit: input.asset.credit ?? null,
      activities: [],
      activityReasoning: [],
      activityUncertainty: null,
      titleConfidence: "low",
      placeMatchConfidence: 0,
      mediaPlaceMatchScore: placeMatch.score,
      mediaPlaceMatchReasons: dedupeStableStrings(placeMatch.reasons),
      mediaPlaceMismatchReasons: dedupeStableStrings(placeMatch.mismatchReasons),
      matchedQuery: input.asset.matchedQuery,
      matchedQueryRank: input.asset.matchedQueryRank,
      queryVariantType: input.asset.queryVariantType,
      sourceLabel: input.asset.sourceLabel,
      sourceConfidenceRank: input.asset.sourceConfidenceRank,
      assetDistanceMilesFromPlace,
      qualityScore: 0,
      relevanceScore: 0,
      coolnessScore: 0,
      duplicateScore: null,
      duplicateReason: null,
      status: "REJECT",
      reasoning: dedupeStableStrings(reasoning),
      scores: {},
      postPreview: null,
    };
  }

  const title = generateLocavaTitle({
    sourceTitle: input.asset.title,
    placeName: input.place.placeName,
    dayKey: input.asset.dayKey,
  });
  reasoning.push(...title.reasoning);
  const activity = inferCandidateActivities({ place: input.place, asset: input.asset });
  reasoning.push(...activity.reasoning);
  const scored = scoreWikimediaCandidate(input.place, input.asset, { mediaPlaceMatchScore: placeMatch.score });
  const legacyPlaceMatch = placeMatchConfidence(input.place, input.asset);

  if (input.duplicateReason) {
    reasoning.push(input.duplicateReason);
    return {
      sourceTitle: input.asset.title,
      generatedTitle: title.generatedTitle,
      sourceUrl: input.asset.pageUrl,
      thumbnailUrl: input.asset.thumbnailUrl,
      fullImageUrl: input.asset.imageUrl,
      author: input.asset.author ?? null,
      license: input.asset.license ?? null,
      credit: input.asset.credit ?? null,
      activities: activity.activities,
      activityReasoning: activity.reasoning,
      activityUncertainty: activity.uncertainty,
      titleConfidence: title.confidence,
      placeMatchConfidence: legacyPlaceMatch,
      mediaPlaceMatchScore: placeMatch.score,
      mediaPlaceMatchReasons: dedupeStableStrings(placeMatch.reasons),
      mediaPlaceMismatchReasons: dedupeStableStrings(placeMatch.mismatchReasons),
      matchedQuery: input.asset.matchedQuery,
      matchedQueryRank: input.asset.matchedQueryRank,
      queryVariantType: input.asset.queryVariantType,
      sourceLabel: input.asset.sourceLabel,
      sourceConfidenceRank: input.asset.sourceConfidenceRank,
      assetDistanceMilesFromPlace,
      qualityScore: 0,
      relevanceScore: 0,
      coolnessScore: 0,
      duplicateScore: 1,
      duplicateReason: input.duplicateReason,
      status: "REJECT",
      reasoning: dedupeStableStrings(reasoning),
      scores: {},
      postPreview: null,
    };
  }

  if (!scored.ok) {
    reasoning.push(scored.detail ? `${scored.reason}: ${scored.detail}` : scored.reason);
    return {
      sourceTitle: input.asset.title,
      generatedTitle: title.generatedTitle,
      sourceUrl: input.asset.pageUrl,
      thumbnailUrl: input.asset.thumbnailUrl,
      fullImageUrl: input.asset.imageUrl,
      author: input.asset.author ?? null,
      license: input.asset.license ?? null,
      credit: input.asset.credit ?? null,
      activities: activity.activities,
      activityReasoning: activity.reasoning,
      activityUncertainty: activity.uncertainty,
      titleConfidence: title.confidence,
      placeMatchConfidence: legacyPlaceMatch,
      mediaPlaceMatchScore: placeMatch.score,
      mediaPlaceMatchReasons: dedupeStableStrings(placeMatch.reasons),
      mediaPlaceMismatchReasons: dedupeStableStrings(placeMatch.mismatchReasons),
      matchedQuery: input.asset.matchedQuery,
      matchedQueryRank: input.asset.matchedQueryRank,
      queryVariantType: input.asset.queryVariantType,
      sourceLabel: input.asset.sourceLabel,
      sourceConfidenceRank: input.asset.sourceConfidenceRank,
      assetDistanceMilesFromPlace,
      qualityScore: 0,
      relevanceScore: 0,
      coolnessScore: 0,
      duplicateScore: null,
      duplicateReason: null,
      status: "REJECT",
      reasoning: dedupeStableStrings(reasoning),
      scores: {},
      postPreview: null,
    };
  }

  const exactPlaceNameInTitle = placeMatch.reasons.includes("title_contains_full_place_name");
  const status = decideStatus({
    rejected: false,
    relevanceScore: scored.relevanceScore,
    qualityScore: scored.qualityScore,
    titleConfidence: title.confidence,
    placeMatchConfidence: legacyPlaceMatch,
    mediaPlaceMatchScore: placeMatch.score,
    hasAssetGeotag,
    assetDistanceMilesFromPlace,
    exactPlaceNameInTitle,
  });
  reasoning.push(
    `relevance=${scored.relevanceScore.toFixed(1)} quality=${scored.qualityScore.toFixed(1)} coolness=${scored.coolnessScore.toFixed(1)}`,
    `mediaPlaceMatchScore=${placeMatch.score}`,
  );
  const base: Omit<WikimediaMvpCandidateAnalysis, "postPreview"> = {
    sourceTitle: input.asset.title,
    generatedTitle: title.generatedTitle,
    sourceUrl: input.asset.pageUrl,
    thumbnailUrl: input.asset.thumbnailUrl,
    fullImageUrl: input.asset.imageUrl,
    author: input.asset.author ?? null,
    license: input.asset.license ?? null,
    credit: input.asset.credit ?? null,
    activities: activity.activities,
    activityReasoning: activity.reasoning,
    activityUncertainty: activity.uncertainty,
    titleConfidence: title.confidence,
    placeMatchConfidence: legacyPlaceMatch,
    mediaPlaceMatchScore: placeMatch.score,
    mediaPlaceMatchReasons: dedupeStableStrings(placeMatch.reasons),
    mediaPlaceMismatchReasons: dedupeStableStrings(placeMatch.mismatchReasons),
    matchedQuery: input.asset.matchedQuery,
    matchedQueryRank: input.asset.matchedQueryRank,
    queryVariantType: input.asset.queryVariantType,
    sourceLabel: input.asset.sourceLabel,
    sourceConfidenceRank: input.asset.sourceConfidenceRank,
    assetDistanceMilesFromPlace,
    qualityScore: scored.qualityScore,
    relevanceScore: scored.relevanceScore,
    coolnessScore: scored.coolnessScore,
    duplicateScore: null,
    duplicateReason: null,
    status,
    reasoning: dedupeStableStrings(reasoning),
    scores: scored.scores,
  };
  const postPreview =
    status === "REJECT"
      ? null
      : buildDryRunPostPreview({
          place: input.place,
          asset: input.asset,
          analysis: base,
          dryRun: input.dryRun,
          allowWrites: input.allowWrites,
        });
  return { ...base, postPreview };
}
