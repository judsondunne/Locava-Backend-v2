import type { WikimediaAnalyzedCandidate } from "./groupWikimediaAssetsIntoPosts.js";
import type { WikimediaAssetHygieneFields, WikimediaHygieneStatus } from "./WikimediaMvpHygieneTypes.js";
import type { ImageColorStats } from "./visualHashFromImageUrl.js";

const PANORAMA_META =
  /\b(panorama|panoramic|pano|360|spherical|equirectangular|gigapixel|wide view|wide-angle panorama)\b/i;
const BW_META = /\b(black and white|black-and-white|b\/w|b&w|bw photo|monochrome|grayscale|greyscale|sepia)\b/i;
const FILTER_META =
  /\b(hdr tone mapped|infrared|false color|thermal|sepia|monochrome|heavily edited|artistic filter|posterized)\b/i;
const NON_PHOTO_META =
  /\b(map\b|diagram|schematic|flag|logo|seal|coat of arms|painting|illustration|drawing|sketch|engraving|woodcut|postcard|currency|coin\b|manuscript|newspaper|svg\b|vector)\b/i;

function defaultHygiene(): WikimediaAssetHygieneFields {
  return {
    hygieneStatus: "PASS",
    hygieneReasons: [],
    hygieneWarnings: [],
    duplicateDecision: "UNIQUE",
    qualityFlags: {},
  };
}

function reject(
  base: WikimediaAssetHygieneFields,
  reason: string,
  flag?: Partial<NonNullable<WikimediaAssetHygieneFields["qualityFlags"]>>,
): WikimediaAssetHygieneFields {
  return {
    ...base,
    hygieneStatus: "REJECT",
    hygieneReasons: [...base.hygieneReasons, reason],
    qualityFlags: { ...base.qualityFlags, ...flag },
  };
}

export function evaluateBadAssetHygiene(
  candidate: WikimediaAnalyzedCandidate,
  colorStats?: ImageColorStats | null,
): WikimediaAssetHygieneFields {
  let hygiene = defaultHygiene();
  const text = `${candidate.sourceTitle} ${candidate.sourceUrl}`.toLowerCase();
  const width = candidate.width;
  const height = candidate.height;
  const pixels = width * height;
  const aspect = width > 0 && height > 0 ? width / height : 1;

  if (!candidate.fullImageUrl || !candidate.fullImageUrl.trim()) {
    return reject(hygiene, "rejected_missing_usable_image_url");
  }

  if (NON_PHOTO_META.test(text)) {
    return reject(hygiene, "rejected_non_photo_asset");
  }

  if (width < 700 || height < 700 || pixels < 500_000) {
    hygiene = reject(hygiene, "rejected_low_resolution", { isLowResolution: true });
    return hygiene;
  }

  if (aspect > 2.25 || (aspect < 1 / 2.25 && aspect > 0)) {
    if (PANORAMA_META.test(text)) {
      return reject(hygiene, "rejected_panorama_metadata", { isPanorama: true, isBadAspectRatio: true });
    }
    if (aspect > 2.25 || aspect < 0.44) {
      return reject(hygiene, "rejected_panorama_aspect_ratio", { isPanorama: true, isBadAspectRatio: true });
    }
  } else if (PANORAMA_META.test(text)) {
    return reject(hygiene, "rejected_panorama_metadata", { isPanorama: true });
  }

  if (BW_META.test(text) || /\((bw|b\/w|b&w)\)/i.test(candidate.sourceTitle)) {
    return reject(hygiene, "rejected_black_and_white_metadata", { isProbablyBlackAndWhite: true });
  }

  if (FILTER_META.test(text)) {
    return reject(hygiene, "rejected_filtered_metadata", { isProbablyFiltered: true });
  }

  if (colorStats && colorStats.averageSaturation < 0.04 && colorStats.averageLuma > 0.08) {
    hygiene = reject(hygiene, "rejected_probably_black_and_white", { isProbablyBlackAndWhite: true });
    return hygiene;
  }

  if (colorStats && colorStats.averageSaturation > 0.9 && colorStats.averageLuma > 0.85) {
    hygiene = {
      ...hygiene,
      hygieneWarnings: [...hygiene.hygieneWarnings, "possibly_filtered_image_stats"],
      qualityFlags: { ...hygiene.qualityFlags, isProbablyFiltered: true },
    };
  }

  return hygiene;
}

export function mergeHygieneStatus(current: WikimediaHygieneStatus, next: WikimediaHygieneStatus): WikimediaHygieneStatus {
  if (current === "REJECT" || next === "REJECT") return "REJECT";
  if (current === "REVIEW" || next === "REVIEW") return "REVIEW";
  return "PASS";
}
