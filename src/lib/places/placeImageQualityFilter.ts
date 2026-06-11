import type { PlaceImageResult } from "../../types/places.js";
import { classifyDiscussionOrForumResult } from "../pbf/detectDiscussionOrForumResult.js";

export type PlaceImageRejectReason =
  | "map_like"
  | "diagram_like"
  | "logo_or_icon"
  | "document_or_vector"
  | "ui_or_screenshot"
  | "forum_or_discussion_page"
  | "thumbnail_too_small";

type QualityRule = {
  reason: PlaceImageRejectReason;
  pattern: RegExp;
};

/** Strong metadata signals that the asset is not a place photo. */
const REJECT_RULES: QualityRule[] = [
  { reason: "map_like", pattern: /\b(hiking|walking|ski|area|park|outdoors?|recreation)\s+map\b/i },
  { reason: "map_like", pattern: /\bgps\s+trail\s+map\b/i },
  { reason: "map_like", pattern: /\btrail\s+map\b/i },
  { reason: "map_like", pattern: /\boverview\s+map\b/i },
  { reason: "map_like", pattern: /\btopo(graphic)?\s+map\b/i },
  { reason: "map_like", pattern: /\bstreet\s+map\b/i },
  { reason: "map_like", pattern: /\bsatellite\s+map\b/i },
  { reason: "map_like", pattern: /\bmap\s+of\b/i },
  { reason: "map_like", pattern: /\btrail\s+guide\s+map\b/i },
  { reason: "diagram_like", pattern: /\bdiagram\b/i },
  { reason: "diagram_like", pattern: /\bschematic\b/i },
  { reason: "diagram_like", pattern: /\bfloor\s+plan\b/i },
  { reason: "diagram_like", pattern: /\bblueprint\b/i },
  { reason: "diagram_like", pattern: /\binfographic\b/i },
  { reason: "diagram_like", pattern: /\bchart\b/i },
  { reason: "logo_or_icon", pattern: /\blogo\b/i },
  { reason: "logo_or_icon", pattern: /\bfavicon\b/i },
  { reason: "logo_or_icon", pattern: /\bapp\s+icon\b/i },
  { reason: "logo_or_icon", pattern: /\bclip\s*art\b/i },
  { reason: "document_or_vector", pattern: /\.svg(?:[?#]|$)/i },
  { reason: "document_or_vector", pattern: /\.pdf(?:[?#]|$)/i },
  { reason: "ui_or_screenshot", pattern: /\bscreenshot\b/i },
  { reason: "ui_or_screenshot", pattern: /\bscreen\s+capture\b/i },
  { reason: "ui_or_screenshot", pattern: /\bqr\s*code\b/i },
  { reason: "ui_or_screenshot", pattern: /\bweather\s+radar\b/i },
  { reason: "ui_or_screenshot", pattern: /\bfacebook\b/i },
  { reason: "ui_or_screenshot", pattern: /\binstagram\b/i },
  { reason: "ui_or_screenshot", pattern: /\bpinterest\b/i },
];

const URL_REJECT_RULES: QualityRule[] = [
  { reason: "map_like", pattern: /static[_-]?map/i },
  { reason: "map_like", pattern: /\/maps?(?:\/|[_-]|$)/i },
  { reason: "map_like", pattern: /[/_-]map[/_-]/i },
  { reason: "map_like", pattern: /map(?:[_-]?box|quest|tiler)/i },
  { reason: "logo_or_icon", pattern: /\/(?:icons?|logos?|favicons?)\//i },
  { reason: "logo_or_icon", pattern: /(?:^|[/_-])(?:icon|logo|favicon)(?:[._-]|$)/i },
  { reason: "document_or_vector", pattern: /\.svg(?:[?#]|$)/i },
  { reason: "document_or_vector", pattern: /\.pdf(?:[?#]|$)/i },
  { reason: "ui_or_screenshot", pattern: /facebook\.com|fbcdn\.net|fbsbx\.com|instagram\.com|pinterest\.com|pinimg\.com/i },
  { reason: "ui_or_screenshot", pattern: /lookaside\.fbsbx\.com|encrypted-tbn0\.gstatic\.com/i },
];

function metadataHaystack(result: PlaceImageResult): string {
  return `${result.caption} ${result.sourceName} ${result.sourceUrl} ${result.imageUrl}`.toLowerCase();
}

export function classifyPlaceImageQuality(result: PlaceImageResult): {
  acceptable: boolean;
  reason?: PlaceImageRejectReason;
} {
  const forum = classifyDiscussionOrForumResult(result);
  if (forum.isForum) {
    return { acceptable: false, reason: forum.reason ?? "forum_or_discussion_page" };
  }

  const haystack = metadataHaystack(result);

  for (const rule of REJECT_RULES) {
    if (rule.pattern.test(haystack)) {
      return { acceptable: false, reason: rule.reason };
    }
  }

  for (const rule of URL_REJECT_RULES) {
    if (rule.pattern.test(`${result.imageUrl} ${result.sourceUrl}`.toLowerCase())) {
      return { acceptable: false, reason: rule.reason };
    }
  }

  return { acceptable: true };
}

export function isAcceptablePlaceImage(result: PlaceImageResult): boolean {
  return classifyPlaceImageQuality(result).acceptable;
}

export function filterAcceptablePlaceImages(results: PlaceImageResult[]): PlaceImageResult[] {
  return results.filter(isAcceptablePlaceImage);
}
