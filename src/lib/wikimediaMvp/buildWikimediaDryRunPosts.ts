import { generateLocavaTitle } from "./generateLocavaTitle.js";
import type { WikimediaAnalyzedCandidate } from "./groupWikimediaAssetsIntoPosts.js";
import type {
  WikimediaAssetGroup,
  WikimediaGeneratedPost,
  WikimediaMvpSeedPlace,
} from "./WikimediaMvpTypes.js";

function pickLocatedAsset(assets: WikimediaAnalyzedCandidate[]): WikimediaAnalyzedCandidate {
  const located = assets.filter((a) => a.hasRealAssetLocation);
  const pool = located.length > 0 ? located : assets;
  return [...pool].sort((a, b) => b.qualityScore + b.relevanceScore - (a.qualityScore + a.relevanceScore))[0]!;
}

function mergeActivities(assets: WikimediaAnalyzedCandidate[]): { activities: string[]; reasoning: string[] } {
  const activities = [...new Set(assets.flatMap((a) => a.activities))].slice(0, 8);
  const reasoning = [...new Set(assets.flatMap((a) => a.activityReasoning))].slice(0, 12);
  return { activities, reasoning };
}

function buildGroupTitle(place: WikimediaMvpSeedPlace, group: WikimediaAssetGroup): {
  generatedTitle: string;
  titleReasoning: string[];
  titleConfidence: "high" | "medium" | "low";
} {
  const representative = group.assets.find((a) => a.candidateId === group.representativeAssetId) ?? group.assets[0];
  if (!representative) {
    return { generatedTitle: place.placeName, titleReasoning: ["fallback place title"], titleConfidence: "low" };
  }
  const title = generateLocavaTitle({
    sourceTitle: representative.sourceTitle,
    placeName: place.placeName,
    dayKey: group.dateRange?.earliest ?? representative.dayKey,
  });
  return {
    generatedTitle: title.generatedTitle,
    titleReasoning: title.reasoning,
    titleConfidence: title.confidence,
  };
}

export function buildWikimediaDryRunPosts(input: {
  place: WikimediaMvpSeedPlace;
  groups: WikimediaAssetGroup[];
  dryRun: boolean;
  allowWrites: boolean;
}): WikimediaGeneratedPost[] {
  return input.groups.map((group) => {
    const title = buildGroupTitle(input.place, group);
    const activity = mergeActivities(group.assets);
    const locatedAsset =
      group.assets.length > 0
        ? pickLocatedAsset(group.assets)
        : ({
            candidateId: group.representativeAssetId,
            assetLatitude: null,
            assetLongitude: null,
            hasRealAssetLocation: false,
            thumbnailUrl: null,
            fullImageUrl: "",
            qualityScore: 0,
            relevanceScore: 0,
          } as WikimediaAnalyzedCandidate);
    const usePlaceCoords = group.locationFallback === "place_candidate" && !locatedAsset.hasRealAssetLocation;
    const resolvedLat = usePlaceCoords ? (input.place.latitude ?? null) : locatedAsset.assetLatitude;
    const resolvedLng = usePlaceCoords ? (input.place.longitude ?? null) : locatedAsset.assetLongitude;
    const status =
      group.status === "REJECT"
        ? "REJECT"
        : group.assets.some((a) => a.status === "REVIEW") || title.titleConfidence === "low"
          ? "REVIEW"
          : "KEEP";
    const reasoning = [...group.reasoning];
    if (status === "REVIEW") reasoning.push("group or title confidence needs review");
    const media = group.assets.map((asset) => ({
      candidateId: asset.candidateId,
      sourceTitle: asset.sourceTitle,
      sourceUrl: asset.sourceUrl,
      thumbnailUrl: asset.thumbnailUrl,
      fullImageUrl: asset.fullImageUrl,
      author: asset.author,
      license: asset.license,
      credit: asset.credit,
      width: asset.width,
      height: asset.height,
      suppliesPostLocation: asset.candidateId === locatedAsset.candidateId && asset.hasRealAssetLocation,
      hasRealAssetLocation: asset.hasRealAssetLocation,
      hygieneStatus: asset.hygieneStatus,
      duplicateDecision: asset.duplicateDecision,
      hygieneReasons: asset.hygieneReasons,
      hygieneWarnings: asset.hygieneWarnings,
      visualHashDistanceToPrimary: asset.visualHashDistanceToPrimary,
      mediaPlaceMatchScore: asset.mediaPlaceMatchScore,
      mediaPlaceMismatchReasons: asset.mediaPlaceMismatchReasons,
      sourceConfidenceRank: asset.sourceConfidenceRank,
      matchedQuery: asset.matchedQuery,
      assetLatitude: asset.assetLatitude,
      assetLongitude: asset.assetLongitude,
      hasAssetCoordinates:
        Boolean(asset.hasRealAssetLocation) &&
        asset.assetLatitude != null &&
        asset.assetLongitude != null &&
        Number.isFinite(asset.assetLatitude) &&
        Number.isFinite(asset.assetLongitude),
      assetDistanceMilesFromPlace: asset.assetDistanceMilesFromPlace ?? null,
    }));
    const dryRunPostPreview = {
      dryRun: input.dryRun || !input.allowWrites,
      source: "wikimedia_mvp_dev",
      placeName: input.place.placeName,
      title: title.generatedTitle,
      displayTitle: title.generatedTitle,
      content: "",
      caption: "",
      activities: activity.activities,
      activityReasoning: activity.reasoning,
      lat: resolvedLat,
      long: resolvedLng,
      lng: resolvedLng,
      address: input.place.placeName,
      locationLabel: input.place.placeName,
      locationSelection: {
        candidateId: locatedAsset.candidateId,
        latitude: locatedAsset.assetLatitude,
        longitude: locatedAsset.assetLongitude,
        reasoning: locatedAsset.hasRealAssetLocation
          ? "selected highest-scoring located asset in group"
          : "no located asset available",
      },
      mediaType: "image",
      thumbUrl: locatedAsset.thumbnailUrl || locatedAsset.fullImageUrl,
      displayPhotoLink: locatedAsset.thumbnailUrl || locatedAsset.fullImageUrl,
      photoLink: locatedAsset.fullImageUrl,
      assets: media.map((m) => ({
        type: "image",
        url: m.fullImageUrl,
        thumbUrl: m.thumbnailUrl || m.fullImageUrl,
        sourceTitle: m.sourceTitle,
        sourceUrl: m.sourceUrl,
        author: m.author,
        license: m.license,
        credit: m.credit,
        suppliesPostLocation: m.suppliesPostLocation,
      })),
      assetsReady: true,
      mediaStatus: "ready",
      groupedCandidateIds: group.assets.map((a) => a.candidateId),
      groupId: group.groupId,
      groupMethod: group.groupMethod,
      groupReasoning: group.reasoning,
      candidateReasoning: group.assets.map((a) => ({ candidateId: a.candidateId, reasoning: a.reasoning })),
      status,
      rejectionReasons: group.rejectionReasons,
      classification: {
        activities: activity.activities,
        primaryActivity: activity.activities[0] ?? null,
        mediaKind: group.assetCount > 1 ? "image_set" : "image",
        source: "wikimedia_commons",
      },
    };
    return {
      postId: group.groupId,
      groupId: group.groupId,
      placeName: input.place.placeName,
      generatedTitle: title.generatedTitle,
      titleReasoning: title.titleReasoning,
      titleConfidence: title.titleConfidence,
      activities: activity.activities,
      activityReasoning: activity.reasoning,
      status,
      rejectionReasons: group.rejectionReasons,
      reasoning,
      groupMethod: group.groupMethod,
      dateRange: group.dateRange,
      assetCount: group.keptAssetCount ?? group.assetCount,
      locatedAssetCount: group.locatedAssetCount,
      originalAssetCount: group.originalAssetCount ?? group.assetCount,
      keptAssetCount: group.keptAssetCount ?? group.assetCount,
      rejectedAssetCount: group.rejectedAssetCount ?? 0,
      reviewAssetCount: group.reviewAssetCount ?? 0,
      rejectedDuplicateCount: group.rejectedDuplicateCount ?? 0,
      rejectedHygieneCount: group.rejectedHygieneCount ?? 0,
      removedAssets: group.removedAssets ?? [],
      reviewAssets: group.reviewAssets ?? [],
      assetHygieneSummary: group.assetHygieneSummary,
      selectedLocation: {
        candidateId: locatedAsset.candidateId,
        latitude: resolvedLat,
        longitude: resolvedLng,
        reasoning: locatedAsset.hasRealAssetLocation
          ? "best located asset by quality/relevance"
          : usePlaceCoords
            ? "place_candidate_fallback"
            : "group_has_no_located_assets",
      },
      groupedCandidateIds: group.assets.map((a) => a.candidateId),
      media,
      dryRunPostPreview,
      candidateReasoning: group.assets.map((a) => ({ candidateId: a.candidateId, reasoning: a.reasoning })),
    };
  });
}
