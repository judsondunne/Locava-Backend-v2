import { createHash } from "node:crypto";
import type { PlaceCandidate } from "../place-candidates/types.js";
import type { WikimediaGeneratedPost } from "../wikimediaMvp/WikimediaMvpTypes.js";
import type { StateContentLocationTrustMode } from "../wikimediaMvp/WikimediaMvpTypes.js";
import type {
  StateContentFactoryPostQualityStatus,
  StateContentFactoryQualityPreviewMode,
  StateContentFactoryQualityThreshold,
} from "./types.js";
import { dedupeStableStrings } from "../wikimediaMvp/dedupeStableStrings.js";

function previewRecord(post: WikimediaGeneratedPost): Record<string, unknown> {
  return post.dryRunPostPreview ?? {};
}

export type GeneratedPostQualityResult = {
  status: StateContentFactoryPostQualityStatus;
  reasons: string[];
  ruleFailures: string[];
  primaryFailure?: string;
  duplicateHash: string;
};

const UPGRADABLE_WIKIMEDIA_REJECT_REASONS = new Set(["group_has_no_located_assets"]);

function mediaHasDirectImage(post: WikimediaGeneratedPost): boolean {
  return post.media.some((asset) => Boolean(asset.fullImageUrl?.trim() || asset.thumbnailUrl?.trim()));
}

function isWikimediaRejectUpgradableForFactoryPreview(input: {
  generatedPost: WikimediaGeneratedPost;
  hasMedia: boolean;
  hasAttribution: boolean;
  hasCoordinates: boolean;
  qualityPreviewMode: StateContentFactoryQualityPreviewMode;
  qualityThreshold: StateContentFactoryQualityThreshold;
}): boolean {
  if (input.generatedPost.status !== "REJECT") return false;
  if (input.qualityThreshold === "strict") return false;
  if (input.qualityPreviewMode === "strict") return false;
  const rs = input.generatedPost.rejectionReasons ?? [];
  if (rs.length === 0) return false;
  if (!rs.every((r) => UPGRADABLE_WIKIMEDIA_REJECT_REASONS.has(r))) return false;
  return input.hasMedia && input.hasAttribution && input.hasCoordinates && mediaHasDirectImage(input.generatedPost);
}

export function evaluateGeneratedPostQuality(input: {
  candidate: PlaceCandidate;
  generatedPost: WikimediaGeneratedPost;
  qualityPreviewMode?: StateContentFactoryQualityPreviewMode;
  qualityThreshold?: StateContentFactoryQualityThreshold;
  locationTrustMode?: StateContentLocationTrustMode;
  /** When set (State Content Factory path), quality uses these instead of raw dry-run preview text/coords. */
  effectiveTitle?: string;
  effectiveDescription?: string;
  effectiveLat?: number;
  effectiveLng?: number;
}): GeneratedPostQualityResult {
  const previewMode = input.qualityPreviewMode ?? "normal";
  const threshold = input.qualityThreshold ?? "normal";
  const trustMode = input.locationTrustMode ?? "asset_geotag_required";
  const trustStrict = trustMode === "asset_geotag_required";
  const reasons: string[] = [];
  const ruleFailures: string[] = [];
  const preview = previewRecord(input.generatedPost);
  const title = String(
    input.effectiveTitle ?? preview.title ?? input.generatedPost.generatedTitle ?? "",
  ).trim();
  const description = String(
    input.effectiveDescription ??
      preview.caption ??
      (preview as { description?: unknown }).description ??
      input.generatedPost.generatedTitle ??
      input.candidate.name,
  ).trim();
  const lat = Number(
    input.effectiveLat ?? preview.lat ?? input.generatedPost.selectedLocation.latitude ?? input.candidate.lat,
  );
  const lng = Number(
    input.effectiveLng ?? preview.lng ?? input.generatedPost.selectedLocation.longitude ?? input.candidate.lng,
  );
  const hasMedia = (input.generatedPost.media?.length ?? 0) > 0 || (input.generatedPost.assetCount ?? 0) > 0;
  const hasAttribution = input.generatedPost.media.some(
    (asset) => Boolean(asset.author || asset.license || asset.credit || asset.sourceUrl),
  );
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);

  const pushRule = (code: string) => {
    ruleFailures.push(code);
    reasons.push(code);
  };

  if (input.candidate.blocked) pushRule("place_blocked");
  if (!title) pushRule("missing_title");

  if (trustStrict && (input.generatedPost.assetHygieneSummary?.possibleDuplicateReviewCount ?? 0) > 0) {
    pushRule("hygiene_possible_duplicate_review");
  }

  if (trustStrict && input.generatedPost.status === "REVIEW") {
    pushRule("wikimedia_review_status_blocked");
  }
  if (trustStrict && (input.generatedPost.reviewAssetCount ?? 0) > 0) {
    pushRule("wikimedia_review_assets_pending");
  }

  const descriptionMissing = !description;
  if (descriptionMissing) pushRule("missing_description");

  if (!hasCoordinates) pushRule("missing_coordinates");
  if (!hasMedia) pushRule("missing_media");
  if (!hasAttribution) pushRule("missing_attribution");
  if (input.generatedPost.status === "REJECT") {
    pushRule("wikimedia_rejected");
    for (const reason of input.generatedPost.rejectionReasons ?? []) {
      const code = `wikimedia:${reason}`;
      if (!reasons.includes(code)) {
        ruleFailures.push(code);
        reasons.push(code);
      }
    }
  }
  const duplicateHash = createHash("sha1")
    .update(
      [
        input.candidate.placeCandidateId,
        title,
        String(lat),
        String(lng),
        input.generatedPost.groupId,
        input.generatedPost.media.map((asset) => asset.fullImageUrl).join("|"),
      ].join("::"),
    )
    .digest("hex");

  const fatal = new Set([
    "place_blocked",
    "missing_title",
    "missing_description",
    "missing_coordinates",
    "missing_media",
    "missing_attribution",
    "wikimedia_rejected",
    "hygiene_possible_duplicate_review",
    "wikimedia_review_status_blocked",
    "wikimedia_review_assets_pending",
  ]);

  const coreFatalsPresent = ruleFailures.some((c) =>
    ["place_blocked", "missing_title", "missing_coordinates", "missing_media", "missing_attribution"].includes(c),
  );
  const relaxMissingDescription =
    descriptionMissing &&
    !coreFatalsPresent &&
    !ruleFailures.some((c) => c.startsWith("wikimedia:")) &&
    hasMedia &&
    hasAttribution &&
    hasCoordinates &&
    previewMode === "preview_all" &&
    threshold !== "strict";

  const wikimediaUpgradable =
    !trustStrict &&
    isWikimediaRejectUpgradableForFactoryPreview({
      generatedPost: input.generatedPost,
      hasMedia,
      hasAttribution,
      hasCoordinates,
      qualityPreviewMode: previewMode,
      qualityThreshold: threshold,
    });

  const fatalOrder = [
    "place_blocked",
    "missing_title",
    "missing_description",
    "missing_coordinates",
    "missing_media",
    "missing_attribution",
    "hygiene_possible_duplicate_review",
    "wikimedia_review_status_blocked",
    "wikimedia_review_assets_pending",
    "wikimedia_rejected",
  ];

  const fatalHitRaw = reasons.find((reason) => fatal.has(reason));
  let fatalHit = fatalHitRaw;
  if (fatalHit === "missing_description" && relaxMissingDescription) {
    fatalHit = undefined;
  }
  if (fatalHit === "wikimedia_rejected" && wikimediaUpgradable) {
    fatalHit = undefined;
  }

  if (fatalHit) {
    const primaryFailure = fatalOrder.find((code) => ruleFailures.includes(code)) ?? fatalHit;
    return {
      status: "rejected",
      reasons: dedupeStableStrings(reasons),
      ruleFailures: dedupeStableStrings(ruleFailures),
      primaryFailure,
      duplicateHash,
    };
  }

  const needsReviewFromWikimedia =
    !trustStrict &&
    (input.generatedPost.status === "REVIEW" ||
      (input.generatedPost.reviewAssetCount ?? 0) > 0 ||
      (input.generatedPost.assetHygieneSummary?.possibleDuplicateReviewCount ?? 0) > 0);

  if (wikimediaUpgradable || needsReviewFromWikimedia || relaxMissingDescription) {
    return {
      status: "needs_review",
      reasons: dedupeStableStrings(reasons),
      ruleFailures: dedupeStableStrings(ruleFailures),
      duplicateHash,
    };
  }
  return {
    status: "stageable",
    reasons: dedupeStableStrings(reasons),
    ruleFailures: dedupeStableStrings(ruleFailures),
    duplicateHash,
  };
}

