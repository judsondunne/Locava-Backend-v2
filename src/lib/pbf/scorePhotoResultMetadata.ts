import type { PlaceImageResult } from "../../types/places.js";
import type { PbfAssetMatchConfidence } from "../../types/pbfAssetPreview.js";
import type { TargetPlaceIdentity } from "./deriveTargetPlaceIdentity.js";

export type PhotoResultMetadataScore = {
  score: number;
  confidence: PbfAssetMatchConfidence;
  hardReject: boolean;
  rejectReasons: string[];
  positiveReasons: string[];
  matchedTokens: string[];
  missingRequiredTokens: string[];
  identityGroupKey: string;
};

const GRAPHIC_URL_TOKENS = [
  "flyer",
  "poster",
  "event",
  "calendar",
  "newsletter",
  "logo",
  "icon",
  "map",
  ".pdf",
  ".svg",
  "banner",
  "placeholder",
  "thumb",
  "thumbnail",
  "sprite",
  "avatar",
  "badge",
  "clipart",
  "graphic",
  "infographic",
];

const ADMIN_PAGE_TOKENS = [
  "menu",
  "hours",
  "agenda",
  "meeting",
  "minutes",
  "program",
  "event",
  "fundraiser",
  "registration",
  "volunteer",
  "newsletter",
  "brochure",
  "calendar",
];

const BROAD_LISTING_PATTERNS = [
  /\bnearby\b/i,
  /\bthings to do\b/i,
  /\bbest trails in vermont\b/i,
  /\bbest hikes in vermont\b/i,
  /\btop \d+ (trails|hikes|bridges|waterfalls)\b/i,
  /\bvermont (trails|bridges|waterfalls|parks) guide\b/i,
];

const STOCK_HOST_PATTERNS = [
  /shutterstock/i,
  /gettyimages/i,
  /istockphoto/i,
  /dreamstime/i,
  /alamy/i,
  /depositphotos/i,
  /123rf/i,
  /stock\.adobe/i,
  /unsplash\.com/i,
  /pexels\.com/i,
];

const TRUSTED_DOMAINS = [
  /\.gov\b/i,
  /vermont\.edu/i,
  /state\.vt\.us/i,
  /vlt\.org/i,
  /uvlt/i,
  /alltrails/i,
  /tripadvisor/i,
  /atlasobscura/i,
  /wikimedia|wikipedia/i,
  /nps\.gov/i,
  /historicalsociety/i,
  /conservation/i,
  /landtrust/i,
  /townof/i,
  /trailfinder/i,
  /vtstateparks/i,
  /vermontvacation/i,
];

const OTHER_VT_TOWNS = [
  "burlington",
  "montpelier",
  "rutland",
  "stowe",
  "bennington",
  "manchester",
  "middlebury",
  "brattleboro",
  "shelburne",
  "waterbury",
  "warren",
  "granville",
  "hartland",
  "shaftsbury",
  "ludlow",
  "killington",
  "newfane",
  "ascutney",
  "hartford",
  "arlington",
  "norwich",
  "woodstock",
  "quechee",
  "taftsville",
];

const OTHER_STATES = [
  "california",
  "oregon",
  "maine",
  "new hampshire",
  "massachusetts",
  "new york",
  "colorado",
  "utah",
  "montana",
  "tennessee",
  "hawaii",
];

function resultHaystack(result: PlaceImageResult): string {
  return `${result.caption} ${result.title ?? ""} ${result.sourceName} ${result.sourceUrl} ${result.imageUrl} ${result.sourceDomain ?? ""}`.toLowerCase();
}

function domainOf(result: PlaceImageResult): string {
  if (result.sourceDomain) return result.sourceDomain.toLowerCase();
  try {
    return new URL(result.sourceUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return (result.sourceName || "").toLowerCase();
  }
}

function phraseInHaystack(hay: string, phrase: string): boolean {
  const p = phrase.toLowerCase().trim();
  if (!p) return false;
  return hay.includes(p);
}

function tokenWordPattern(token: string): RegExp {
  const escaped = token.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

function tokenInHaystack(hay: string, token: string): boolean {
  if (token.length < 2) return false;
  return tokenWordPattern(token).test(hay);
}

function countTokenHits(hay: string, tokens: string[]): string[] {
  return tokens.filter((t) => t.length >= 3 && tokenInHaystack(hay, t));
}

function detectWrongTown(hay: string, targetTowns: string[]): boolean {
  for (const other of OTHER_VT_TOWNS) {
    if (!tokenInHaystack(hay, other)) continue;
    if (targetTowns.some((t) => t.toLowerCase() === other)) continue;
    return true;
  }
  return false;
}

function mentionsDifferentSpecificFeature(hay: string, identity: TargetPlaceIdentity): boolean {
  const canonical = identity.canonicalName.toLowerCase();
  const genericOnly = ["covered bridge", "bridge", "trail", "viewpoint", "shelter", "waterfall", "falls", "park"];
  const isGenericTarget =
    identity.forbiddenGenericOnly ||
    identity.requiredNameTokens.length === 0 ||
    genericOnly.some((g) => canonical === g || canonical.startsWith(g + " "));
  if (!isGenericTarget) return false;

  const otherNamedFeatures = [
    "middle covered bridge",
    "taftsville covered",
    "warren covered",
    "moss glen",
    "texas falls",
    "gold brook",
    "hazen trail",
    "mink brook",
    "sample's jump",
    "samples jump",
    "quechee gorge",
    "quechee covered",
    "billings farm",
    "marsh-billings",
  ];
  for (const feature of otherNamedFeatures) {
    if (hay.includes(feature) && !canonical.includes(feature.split(" ")[0]!)) {
      return true;
    }
  }
  return false;
}

function detectSimilarNamedPlace(hay: string, identity: TargetPlaceIdentity): boolean {
  const required = identity.requiredNameTokens;
  if (required.length === 0) return false;
  const hits = countTokenHits(hay, required);
  if (hits.length === 0) return true;
  if (required.length >= 2 && hits.length < Math.min(2, required.length)) {
    const canonical = identity.canonicalName.toLowerCase();
    if (!phraseInHaystack(hay, canonical) && canonical.split(" ").length >= 2) {
      return true;
    }
  }
  return false;
}

function isCategoryOnlyMatch(hay: string, identity: TargetPlaceIdentity): boolean {
  const requiredHits = countTokenHits(hay, identity.requiredNameTokens);
  if (requiredHits.length > 0) return false;
  const categoryHits = countTokenHits(hay, identity.categoryTokens);
  const stateHits = countTokenHits(hay, identity.stateTokens);
  return categoryHits.length > 0 && stateHits.length > 0;
}

export function scorePhotoResultMetadata(
  identity: TargetPlaceIdentity,
  result: PlaceImageResult,
): PhotoResultMetadataScore {
  const hay = resultHaystack(result);
  const domain = domainOf(result);
  const rejectReasons: string[] = [];
  const positiveReasons: string[] = [];
  let score = 0;
  let hardReject = false;

  const title = (result.title || result.caption || "").trim();

  for (const token of GRAPHIC_URL_TOKENS) {
    if (hay.includes(token)) {
      rejectReasons.push("graphic_asset");
      hardReject = true;
      break;
    }
  }
  for (const token of ADMIN_PAGE_TOKENS) {
    if (hay.includes(token)) {
      rejectReasons.push("admin_or_event_page");
      hardReject = true;
      break;
    }
  }
  if (/\.(svg|gif)(?:[?#]|$)/i.test(result.imageUrl)) {
    rejectReasons.push("vector_or_gif");
    hardReject = true;
  }

  for (const pattern of BROAD_LISTING_PATTERNS) {
    if (pattern.test(hay) && countTokenHits(hay, identity.requiredNameTokens).length === 0) {
      rejectReasons.push("generic_listing_page");
      hardReject = true;
    }
  }

  if (STOCK_HOST_PATTERNS.some((p) => p.test(domain) || p.test(hay))) {
    rejectReasons.push("stock_or_content_farm");
    hardReject = true;
  }

  for (const state of OTHER_STATES) {
    if (hay.includes(state) && !hay.includes("vermont") && !hay.includes(" vt ")) {
      rejectReasons.push("wrong_state");
      hardReject = true;
    }
  }

  if (detectWrongTown(hay, identity.townTokens)) {
    rejectReasons.push("wrong_town");
    hardReject = true;
  }

  if (mentionsDifferentSpecificFeature(hay, identity)) {
    rejectReasons.push("different_specific_feature");
    hardReject = true;
  }
  if (detectSimilarNamedPlace(hay, identity)) {
    rejectReasons.push("similar_named_place");
    hardReject = true;
  }

  if (isCategoryOnlyMatch(hay, identity)) {
    rejectReasons.push("generic_category_only");
    hardReject = true;
  }

  const canonicalHit = phraseInHaystack(hay, identity.canonicalName);
  const requiredHits = countTokenHits(hay, identity.requiredNameTokens);
  const townHits = countTokenHits(hay, identity.townTokens);
  const stateHits = countTokenHits(hay, identity.stateTokens);
  const categoryHits = countTokenHits(hay, identity.categoryTokens);
  const matchedTokens = [
    ...(canonicalHit ? [identity.canonicalName.toLowerCase()] : []),
    ...requiredHits,
    ...townHits,
    ...stateHits,
    ...categoryHits,
  ];

  const missingRequired = identity.requiredNameTokens.filter((t) => !hay.includes(t.toLowerCase()));

  if (identity.requiredNameTokens.length > 0 && requiredHits.length === 0 && !canonicalHit) {
    rejectReasons.push("missing_distinctive_name");
    hardReject = true;
  }

  if (canonicalHit) {
    score += 14;
    positiveReasons.push("canonical_name_phrase");
  }
  if (requiredHits.length > 0) {
    score += requiredHits.length * 5;
    positiveReasons.push(`distinctive_tokens:${requiredHits.join(",")}`);
  }
  if (townHits.length > 0) {
    score += townHits.length * 4;
    positiveReasons.push(`town:${townHits.join(",")}`);
  }
  if (stateHits.length > 0) {
    score += 3;
    positiveReasons.push("state_match");
  }
  if (categoryHits.length > 0 && (requiredHits.length > 0 || canonicalHit)) {
    score += categoryHits.length * 2;
    positiveReasons.push(`category:${categoryHits.join(",")}`);
  }
  if (TRUSTED_DOMAINS.some((p) => p.test(domain))) {
    score += 4;
    positiveReasons.push("trusted_domain");
  }
  if (requiredHits.length > 0 && townHits.length > 0) {
    score += 4;
    positiveReasons.push("name_and_town");
  }

  let confidence: PbfAssetMatchConfidence = "low";
  if (
    !hardReject &&
    (canonicalHit || requiredHits.length >= 2) &&
    (townHits.length > 0 || stateHits.length > 0) &&
    score >= 18
  ) {
    confidence = "high";
  } else if (
    !hardReject &&
    (canonicalHit || requiredHits.length >= 1) &&
    (townHits.length > 0 || categoryHits.length > 0 || stateHits.length > 0) &&
    score >= 10
  ) {
    confidence = "medium";
  }

  const identityGroupKey = requiredHits.length > 0 ? requiredHits.sort().join("|") : "none";

  return {
    score,
    confidence,
    hardReject,
    rejectReasons: [...new Set(rejectReasons)],
    positiveReasons,
    matchedTokens: [...new Set(matchedTokens)],
    missingRequiredTokens: missingRequired,
    identityGroupKey,
  };
}
