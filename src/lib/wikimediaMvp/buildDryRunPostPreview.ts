import type { WikimediaMvpCandidateAnalysis, WikimediaMvpNormalizedAsset, WikimediaMvpSeedPlace } from "./WikimediaMvpTypes.js";

export function buildDryRunPostPreview(input: {
  place: WikimediaMvpSeedPlace;
  asset: WikimediaMvpNormalizedAsset;
  analysis: Pick<
    WikimediaMvpCandidateAnalysis,
    "generatedTitle" | "activities" | "status" | "sourceTitle" | "sourceUrl" | "fullImageUrl" | "thumbnailUrl"
  >;
  dryRun: boolean;
  allowWrites: boolean;
}): Record<string, unknown> {
  const nowMs = Date.now();
  const lat = input.asset.lat ?? input.place.latitude ?? null;
  const lng = input.asset.lon ?? input.place.longitude ?? null;
  return {
    dryRun: input.dryRun || !input.allowWrites,
    source: "wikimedia_mvp_dev",
    title: input.analysis.generatedTitle,
    displayTitle: input.analysis.generatedTitle,
    content: "",
    caption: "",
    activities: input.analysis.activities,
    placeName: input.place.placeName,
    lat,
    long: lng,
    lng,
    address: input.place.placeName,
    locationLabel: input.place.placeName,
    mediaType: "image",
    thumbUrl: input.analysis.thumbnailUrl || input.analysis.fullImageUrl,
    displayPhotoLink: input.analysis.thumbnailUrl || input.analysis.fullImageUrl,
    photoLink: input.analysis.fullImageUrl,
    assets: [
      {
        type: "image",
        url: input.analysis.fullImageUrl,
        thumbUrl: input.analysis.thumbnailUrl || input.analysis.fullImageUrl,
        width: input.asset.width,
        height: input.asset.height,
        sourceTitle: input.analysis.sourceTitle,
        sourceUrl: input.analysis.sourceUrl,
        mime: input.asset.mime,
      },
    ],
    assetsReady: true,
    mediaStatus: "ready",
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    likesCount: 0,
    commentsCount: 0,
    classification: {
      activities: input.analysis.activities,
      primaryActivity: input.analysis.activities[0] ?? null,
      mediaKind: "image",
      source: "wikimedia_commons",
    },
    provenance: {
      commonsFileTitle: input.analysis.sourceTitle,
      commonsPageUrl: input.analysis.sourceUrl,
      candidateStatus: input.analysis.status,
    },
  };
}
