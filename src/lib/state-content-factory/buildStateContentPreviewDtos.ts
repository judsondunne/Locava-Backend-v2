import type { PlaceCandidate } from "../place-candidates/types.js";
import type { WikimediaAssetGroup, WikimediaGeneratedPost } from "../wikimediaMvp/WikimediaMvpTypes.js";
import type { StateContentFactoryEvaluatedPost, StateContentPreviewAttribution, StateContentPreviewMedia } from "./types.js";

function commonsFileUrlFromSourceTitle(sourceTitle: string): string | undefined {
  const title = sourceTitle.replace(/^File:/i, "");
  if (!title) return undefined;
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`;
}

export function mapGeneratedPostMedia(post: WikimediaGeneratedPost): StateContentPreviewMedia[] {
  return post.media.map((asset) => ({
    title: asset.sourceTitle,
    fullImageUrl: asset.fullImageUrl,
    thumbnailUrl: asset.thumbnailUrl ?? undefined,
    imageUrl: asset.fullImageUrl,
    thumbUrl: asset.thumbnailUrl ?? undefined,
    displayUrl: asset.thumbnailUrl || asset.fullImageUrl,
    commonsUrl: commonsFileUrlFromSourceTitle(asset.sourceTitle),
    sourceUrl: asset.sourceUrl,
    width: asset.width,
    height: asset.height,
    license: asset.license ?? undefined,
    creator: asset.author ?? asset.credit ?? undefined,
    attributionText: [asset.credit, asset.author, asset.license].filter(Boolean).join(" · ") || undefined,
    hasAssetCoordinates: asset.hasAssetCoordinates ?? asset.hasRealAssetLocation,
    assetLat: asset.assetLatitude ?? undefined,
    assetLng: asset.assetLongitude ?? undefined,
    assetDistanceMilesFromPlace: asset.assetDistanceMilesFromPlace ?? undefined,
    includedInStageablePreview: asset.includedInStageablePreview,
    locationRole: asset.locationRole,
  }));
}

export function buildAttributionFromMedia(media: StateContentPreviewMedia[]): StateContentPreviewAttribution[] {
  return media.map((row) => ({
    title: row.title,
    creator: row.creator,
    license: row.license,
    sourceUrl: row.sourceUrl,
    commonsUrl: row.commonsUrl,
  }));
}

export function findGroupForPost(
  groups: WikimediaAssetGroup[],
  post: WikimediaGeneratedPost,
): WikimediaAssetGroup | undefined {
  return groups.find((group) => group.groupId === post.groupId);
}

export function buildPreviewDebugPayload(input: {
  candidate: PlaceCandidate;
  evaluated: StateContentFactoryEvaluatedPost;
}): Record<string, unknown> {
  const post = input.evaluated.generatedPost;
  return {
    qualityGateInput: {
      candidateId: input.candidate.placeCandidateId,
      candidateBlocked: input.candidate.blocked,
      postStatus: post.status,
      postRejectionReasons: post.rejectionReasons,
      postReasoning: post.reasoning,
      assetCount: post.assetCount,
      locatedAssetCount: post.locatedAssetCount,
      mediaRowCount: post.media.length,
      dryRunPostPreviewKeys: post.dryRunPostPreview ? Object.keys(post.dryRunPostPreview) : [],
    },
    qualityGateOutput: {
      qualityStatus: input.evaluated.qualityStatus,
      qualityReasons: input.evaluated.qualityReasons,
      ruleFailures: input.evaluated.qualityRuleFailures,
      primaryFailure: input.evaluated.qualityPrimaryFailure,
    },
    factoryDisplay: input.evaluated.factoryDisplay ?? null,
    rawDryRunPostPreview: post.dryRunPostPreview,
    rawMedia: post.media,
  };
}
