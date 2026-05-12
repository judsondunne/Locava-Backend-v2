import type { WikimediaAssetGroup, WikimediaGeneratedPost } from "../wikimediaMvp/WikimediaMvpTypes.js";
import type { StateContentFactoryEvaluatedPost, StateContentPreviewSummary } from "./types.js";
import {
  buildAttributionFromMedia,
  buildPreviewDebugPayload,
  findGroupForPost,
  mapGeneratedPostMedia,
} from "./buildStateContentPreviewDtos.js";

function previewTitle(post: WikimediaGeneratedPost): string {
  const preview = post.dryRunPostPreview ?? {};
  return String(preview.title ?? post.generatedTitle ?? "").trim();
}

function previewDescription(post: WikimediaGeneratedPost): string {
  const preview = post.dryRunPostPreview ?? {};
  return String(
    preview.caption ?? preview.description ?? post.generatedTitle ?? post.placeName,
  ).trim();
}

function qualityScoreFromPost(post: WikimediaGeneratedPost): number {
  if (post.status === "KEEP") return 3;
  if (post.status === "REVIEW") return 2;
  return 1;
}

export function buildStateContentPlacePreviewSummaries(input: {
  evaluatedPosts: StateContentFactoryEvaluatedPost[];
  assetGroups: WikimediaAssetGroup[];
}): StateContentPreviewSummary[] {
  return input.evaluatedPosts.map((row) => {
    const post = row.generatedPost;
    let media = mapGeneratedPostMedia(post);
    const declaredCount = post.media.length > 0 ? post.media.length : post.assetCount ?? 0;
    if (declaredCount > 0 && media.length === 0) {
      media = [
        {
          title: "synthetic_missing_media_rows",
          attributionText: "mediaCount>0 but media[] empty — inspect dryRunPostPreview",
        },
      ];
    }
    const cover = media[0]
      ? {
          imageUrl: media[0].imageUrl,
          thumbUrl: media[0].thumbUrl,
          displayUrl: media[0].displayUrl,
          commonsUrl: media[0].commonsUrl,
          title: media[0].title,
        }
      : undefined;
    const group = findGroupForPost(input.assetGroups, post);
    const grouping = {
      assetCount: group?.assetCount ?? post.assetCount,
      geotaggedAssetCount: post.locationTrust?.locatedAssetCountInPreview ?? group?.locatedAssetCount ?? post.locatedAssetCount,
      startAt: group?.dateRange?.earliest,
      endAt: group?.dateRange?.latest,
    };
    const hygieneWarnings = post.media.flatMap((asset) => asset.hygieneWarnings ?? []);
    const reviewHygiene = post.reviewAssets?.flatMap((asset) => asset.hygieneReasons ?? []) ?? [];
    const factoryWarnings = row.factoryDisplay?.warnings ?? [];
    const warnings = [...factoryWarnings, ...hygieneWarnings, ...reviewHygiene, ...(post.reasoning ?? [])];
    const rejectReasons = Array.from(
      new Set([
        ...row.qualityReasons,
        ...(post.rejectionReasons ?? []).map((reason) => `wikimedia:${reason}`),
      ]),
    );
    const fd = row.factoryDisplay;
    const lt = post.locationTrust;
    const anchorTitle =
      lt?.locatedAnchorCandidateId != null
        ? post.media.find((m) => m.candidateId === lt.locatedAnchorCandidateId)?.sourceTitle
        : undefined;
    return {
      postId: post.postId,
      groupId: post.groupId,
      title: fd?.title ?? previewTitle(post),
      description: fd?.description ?? previewDescription(post),
      wikimediaSuggestedTitle: fd?.wikimediaSuggestedTitle ?? previewTitle(post),
      descriptionSource: fd?.descriptionSource,
      mediaCount: declaredCount,
      locationSource: fd?.locationSource ?? post.selectedLocation.reasoning,
      locationConfidence: fd?.locationConfidence,
      locationTrust: lt
        ? {
            stagingAllowed: lt.stagingAllowed,
            placeFallbackBlocked: lt.placeFallbackAttemptedBlocked,
            trustRejectionCodes: lt.trustRejectionCodes,
            anchorCandidateId: lt.locatedAnchorCandidateId,
            anchorAssetTitle: anchorTitle,
            postLat: lt.stagingPostLat,
            postLng: lt.stagingPostLng,
            locationSource: lt.locationSourceForStaging,
            locatedAssetCount: lt.locatedAssetCountInPreview,
            nonlocatedRidealongCount: lt.nonlocatedRidealongCount,
            excludedUnlocatedCount: lt.excludedUnlocatedCount,
            wrongLocationExcludedCount: lt.wrongLocationExcludedCount,
          }
        : undefined,
      factoryPreviewWarnings: factoryWarnings.length ? factoryWarnings : undefined,
      qualityStatus: row.qualityStatus,
      qualityScore: qualityScoreFromPost(post),
      warnings,
      rejectReasons,
      ruleFailures: row.qualityRuleFailures,
      primaryFailure: row.qualityPrimaryFailure,
      wikimediaStatus: String(post.status),
      wikimediaRejectionReasons: post.rejectionReasons ?? [],
      media,
      cover,
      attribution: buildAttributionFromMedia(media),
      grouping,
      debug: buildPreviewDebugPayload({ candidate: row.placeCandidate, evaluated: row }),
    };
  });
}
