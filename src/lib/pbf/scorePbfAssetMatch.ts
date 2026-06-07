import type { PlaceImageResult } from "../../types/places.js";
import type { PbfAssetMatchConfidence, PbfAssetPreviewExternalAsset } from "../../types/pbfAssetPreview.js";
import { MIN_QUERY_SPECIFICITY_SCORE, type OsmPhotoQueryResult } from "./buildOsmSpecificPhotoQuery.js";

const STOCK_HOST_PATTERNS = [
  /shutterstock/i,
  /gettyimages/i,
  /istockphoto/i,
  /dreamstime/i,
  /alamy/i,
  /depositphotos/i,
  /123rf/i,
  /stock\.adobe/i,
];

const TRUSTED_DOMAINS = [
  /wikimedia|wikipedia/i,
  /stateparks|nps\.gov/i,
  /vermont/i,
  /\.gov\b/i,
  /alltrails/i,
  /atlasobscura/i,
  /tripadvisor/i,
  /uvlt/i,
  /vlt\.org/i,
];

const FOREIGN_LOCATION_SIGNALS = [
  "iceland",
  "norway",
  "new zealand",
  "scotland",
  "california",
  "oregon",
  "colorado",
  "utah",
  "montana",
  "tennessee",
  "north carolina",
  "wyoming",
  "hawaii",
  "maine",
  "new hampshire",
];

function haystack(result: PlaceImageResult): string {
  return `${result.caption} ${result.title ?? ""} ${result.sourceName} ${result.sourceUrl} ${result.sourceDomain ?? ""}`.toLowerCase();
}

function domainOf(result: PlaceImageResult): string {
  if (result.sourceDomain) return result.sourceDomain.toLowerCase();
  try {
    return new URL(result.sourceUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function significantTokens(tokens: string[]): string[] {
  return tokens.filter((t) => t.length >= 3 && !["the", "and", "vermont", "trail", "park"].includes(t));
}

function mentionsDifferentTown(hay: string, townTokens: string[]): boolean {
  if (townTokens.length === 0) return false;
  const vtTowns = [
    "burlington",
    "montpelier",
    "rutland",
    "stowe",
    "woodstock",
    "quechee",
    "norwich",
    "middlebury",
    "bennington",
    "manchester",
    "newport",
    "brattleboro",
    "shelburne",
    "waterbury",
  ];
  for (const other of vtTowns) {
    if (!hay.includes(other)) continue;
    const expected = townTokens.some((t) => hay.includes(t) || other.includes(t));
    if (!expected) return true;
  }
  return false;
}

export function scorePbfAssetResult(
  result: PlaceImageResult,
  query: OsmPhotoQueryResult,
  rank: number,
): PbfAssetPreviewExternalAsset {
  const reasons: string[] = [];
  let score = 0;
  const hay = haystack(result);
  const domain = domainOf(result);
  const nameTokens = significantTokens(
    query.tokens.filter((t) => !["vermont", "trail", "bridge", "area", "peak"].includes(t)),
  );
  const townTokens = query.confidenceHints
    .filter((h) => h.startsWith("town:"))
    .map((h) => h.slice(5).toLowerCase())
    .flatMap((t) => t.split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
  const categoryHints = query.confidenceHints
    .filter((h) => h.startsWith("category:"))
    .map((h) => h.slice(9).toLowerCase());

  const nameHits = nameTokens.filter((t) => hay.includes(t));
  if (nameHits.length > 0) {
    score += nameHits.length * 4;
    reasons.push(`name_match:${nameHits.join(",")}`);
  } else if (nameTokens.length > 0) {
    score -= 6;
    reasons.push("missing_name_tokens");
  }

  const townHits = townTokens.filter((t) => hay.includes(t));
  if (townHits.length > 0) {
    score += townHits.length * 3;
    reasons.push(`town_match:${townHits.join(",")}`);
  }

  if (hay.includes("vermont") || hay.includes(" vt ")) {
    score += 2;
    reasons.push("state_match");
  }

  for (const category of categoryHints) {
    if (hay.includes(category)) {
      score += 2;
      reasons.push(`category_match:${category}`);
    }
  }

  if (TRUSTED_DOMAINS.some((p) => p.test(domain) || p.test(hay))) {
    score += 4;
    reasons.push("trusted_domain");
  }

  if (STOCK_HOST_PATTERNS.some((p) => p.test(domain))) {
    score -= 8;
    reasons.push("stock_photo_host");
  }

  if (/\/events(?:\/|$)|events from|page \d+/i.test(hay)) {
    score -= 10;
    reasons.push("event_page_signal");
  }
  if (/deadlines?|decaf|raffle|summer reading|puzzle exchange|reading program/i.test(hay)) {
    score -= 12;
    reasons.push("promo_graphic_signal");
  }
  if (/\.(png|gif)(?:[?#]|$)/i.test(result.imageUrl) && /wp-content\/uploads/i.test(result.imageUrl)) {
    score -= 6;
    reasons.push("cms_upload_graphic_risk");
  }
  if (/librarytechnology\.org|benningtonbanner\.com|happyvermont\.com/i.test(domain)) {
    score += 5;
    reasons.push("editorial_photo_source");
  }

  for (const foreign of FOREIGN_LOCATION_SIGNALS) {
    if (!hay.includes(foreign)) continue;
    if (!hay.includes("vermont") && townHits.length === 0) {
      score -= 10;
      reasons.push(`foreign_location:${foreign}`);
    }
  }

  if (mentionsDifferentTown(hay, townTokens)) {
    score -= 8;
    reasons.push("wrong_town_signal");
  }

  if (nameTokens.length > 0 && nameHits.length === 0 && townHits.length === 0 && hay.includes("vermont")) {
    score -= 4;
    reasons.push("generic_vermont_only");
  }

  let assetMatchConfidence: PbfAssetMatchConfidence = "low";
  const promoPenalty = reasons.some((r) =>
    ["event_page_signal", "promo_graphic_signal", "cms_upload_graphic_risk"].includes(r),
  );
  if (
    !promoPenalty &&
    score >= 12 &&
    nameHits.length > 0 &&
    (townHits.length > 0 || query.confidenceHints.some((h) => h.startsWith("state:")))
  ) {
    assetMatchConfidence = "high";
  } else if (!promoPenalty && score >= 6 && (nameHits.length > 0 || townHits.length > 0)) {
    assetMatchConfidence = "medium";
  }

  return {
    ...result,
    rank,
    assetMatchScore: score,
    assetMatchConfidence,
    assetMatchReasons: reasons,
    sourceDomain: domain || result.sourceName,
    backlinkUrl: result.backlinkUrl ?? result.sourceUrl,
  };
}

export function summarizeAssetPreviewWarnings(
  assets: PbfAssetPreviewExternalAsset[],
  query: OsmPhotoQueryResult,
): string[] {
  const warnings: string[] = [];
  if (query.querySpecificityScore < MIN_QUERY_SPECIFICITY_SCORE + 4) {
    warnings.push("Query specificity is borderline — verify place identity manually.");
  }
  const best = assets[0];
  if (!best) {
    warnings.push("No photo results returned.");
    return warnings;
  }
  if (best.assetMatchReasons.includes("wrong_town_signal")) {
    warnings.push("Wrong place? Result title/snippet mentions a different town.");
  }
  if (best.assetMatchReasons.includes("foreign_location")) {
    warnings.push("Wrong place? Result may be outside Vermont.");
  }
  if (best.assetMatchReasons.includes("generic_vermont_only")) {
    warnings.push("Results look broad — generic Vermont/category match only.");
  }
  if (assets.every((a) => a.assetMatchConfidence === "low")) {
    warnings.push("All returned images are low confidence.");
  }
  return warnings;
}

export function pickPreviewAssets(
  results: PlaceImageResult[],
  query: OsmPhotoQueryResult,
  limit = 8,
): PbfAssetPreviewExternalAsset[] {
  return results
    .slice(0, limit)
    .map((result, index) => scorePbfAssetResult(result, query, index + 1))
    .sort((a, b) => b.assetMatchScore - a.assetMatchScore)
    .map((asset, index) => ({ ...asset, rank: index + 1 }));
}

function hasStrongVisionAsset(assets: PbfAssetPreviewExternalAsset[]): boolean {
  return assets.some((a) => {
    const v = a.visionJudgment;
    if (!v?.automated) return false;
    return (
      v.isRealPlacePhoto &&
      v.assetType === "photo" &&
      v.placeMatchScore >= 3 &&
      v.visualQualityScore >= 3 &&
      v.wrongPlaceRisk !== "high"
    );
  });
}

export function deriveAssetPreviewStatus(
  assets: PbfAssetPreviewExternalAsset[],
  query: OsmPhotoQueryResult,
): {
  assetStatus: "ready" | "low_confidence" | "not_found";
  assetsReady: boolean;
} {
  if (assets.length === 0) {
    return { assetStatus: "not_found", assetsReady: false };
  }
  const hasStrong =
    hasStrongVisionAsset(assets) ||
    assets.some((a) => a.assetMatchConfidence === "high" || a.assetMatchConfidence === "medium");
  const warnings = summarizeAssetPreviewWarnings(assets, query);
  const wrongPlace = warnings.some((w) => w.startsWith("Wrong place?"));
  if (hasStrong && query.querySpecificityScore >= MIN_QUERY_SPECIFICITY_SCORE && !wrongPlace) {
    return { assetStatus: "ready", assetsReady: true };
  }
  return { assetStatus: "low_confidence", assetsReady: false };
}
