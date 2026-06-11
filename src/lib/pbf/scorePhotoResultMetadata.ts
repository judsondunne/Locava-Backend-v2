import type { PlaceImageResult } from "../../types/places.js";
import type { PbfAssetMatchConfidence } from "../../types/pbfAssetPreview.js";
import type { TargetPlaceIdentity } from "./deriveTargetPlaceIdentity.js";
import { classifyDiscussionOrForumResult } from "./detectDiscussionOrForumResult.js";

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
  ".pdf",
  ".svg",
  "banner",
  "placeholder",
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

/** Title/caption location beats misleading SEO URLs (e.g. thedyrt listing tagged VT but titled MA). */
function detectConflictingStateInTitleText(
  titleText: string,
  identity: TargetPlaceIdentity,
): boolean {
  const hay = titleText.toLowerCase().trim();
  if (!hay) return false;
  const targetVt = identity.stateTokens.some((token) => token === "vermont" || token === "vt");
  if (!targetVt) return false;

  const mentionsVt = /\bvermont\b/.test(hay) || /\bvt\b/.test(hay);
  const otherStatePatterns = [
    /\bmassachusetts\b/,
    /\b,\s*ma\b/,
    /\bnew hampshire\b/,
    /\b,\s*nh\b/,
    /\bnew york\b/,
    /\b,\s*ny\b/,
    /\bconnecticut\b/,
    /\b,\s*ct\b/,
    /\bmaine\b/,
    /\b,\s*me\b/,
  ];
  if (otherStatePatterns.some((pattern) => pattern.test(hay)) && !mentionsVt) {
    return true;
  }

  if (
    /\bclarksburg\b/.test(hay) &&
    /\bmassachusetts\b/.test(hay) &&
    !identity.townTokens.some((town) => hay.includes(town.toLowerCase()))
  ) {
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

function compactPlaceName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function placeFeatureName(canonicalName: string): string {
  return (canonicalName.split("·")[0] ?? canonicalName).trim();
}

function tokenizePlaceName(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function matchesDistinctivePlaceName(hay: string, identity: TargetPlaceIdentity): boolean {
  const canonical = placeFeatureName(identity.canonicalName).toLowerCase().trim();
  if (canonical && phraseInHaystack(hay, canonical)) return true;

  const compactCanonical = compactPlaceName(canonical);
  const compactHay = compactPlaceName(hay);
  if (compactCanonical.length >= 6 && compactHay.includes(compactCanonical)) return true;

  const requiredHits = countTokenHits(hay, identity.requiredNameTokens);
  if (identity.requiredNameTokens.length >= 2) {
    return requiredHits.length >= Math.min(2, identity.requiredNameTokens.length);
  }
  if (identity.requiredNameTokens.length === 1) {
    return requiredHits.length >= 1;
  }
  return false;
}

function detectSimilarNamedPlace(hay: string, identity: TargetPlaceIdentity): boolean {
  if (matchesDistinctivePlaceName(hay, identity)) return false;
  return identity.requiredNameTokens.length > 0;
}

function needsExplicitTownInResult(identity: TargetPlaceIdentity): boolean {
  if (identity.forbiddenGenericOnly) return true;
  const canonicalWords = placeFeatureName(identity.canonicalName)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  return canonicalWords.length <= 1;
}

function isCategoryOnlyMatch(hay: string, identity: TargetPlaceIdentity): boolean {
  if (phraseInHaystack(hay, identity.canonicalName)) return false;
  if (matchesDistinctivePlaceName(hay, identity)) return false;
  const requiredHits = countTokenHits(hay, identity.requiredNameTokens);
  if (requiredHits.length > 0) return false;
  const categoryHits = countTokenHits(hay, identity.categoryTokens);
  const stateHits = countTokenHits(hay, identity.stateTokens);
  return categoryHits.length > 0 && stateHits.length > 0;
}

export function scorePhotoResultMetadata(
  identity: TargetPlaceIdentity,
  result: PlaceImageResult,
  options?: { scoringProfile?: "admin_strict" | "undiscovered_app" },
): PhotoResultMetadataScore {
  const metaHay = `${result.caption} ${result.title ?? ""} ${result.sourceName} ${result.sourceUrl} ${result.sourceDomain ?? ""}`.toLowerCase();
  const imageHay = result.imageUrl.toLowerCase();
  const hay = resultHaystack(result);
  const domain = domainOf(result);
  const rejectReasons: string[] = [];
  const positiveReasons: string[] = [];
  let score = 0;
  let hardReject = false;

  const title = (result.title || result.caption || "").trim();

  if (detectConflictingStateInTitleText(title, identity)) {
    rejectReasons.push("wrong_state");
    hardReject = true;
  }

  const forum = classifyDiscussionOrForumResult(result);
  if (forum.isForum) {
    rejectReasons.push(forum.reason ?? "forum_or_discussion_page");
    hardReject = true;
  }

  for (const token of GRAPHIC_URL_TOKENS) {
    if (metaHay.includes(token)) {
      rejectReasons.push("graphic_asset");
      hardReject = true;
      break;
    }
  }
  if (!hardReject) {
    const imageGraphicTokens = [
      "placeholder",
      "sprite",
      "avatar",
      "clipart",
      "favicon",
      ".pdf",
      ".svg",
      "/logo/",
      "/logos/",
      "/icons/",
      "/icon/",
      "newsletter",
      "flyer",
      "static_map",
      "static-map",
    ];
    for (const token of imageGraphicTokens) {
      if (imageHay.includes(token)) {
        rejectReasons.push("graphic_asset");
        hardReject = true;
        break;
      }
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

  const canonicalHit =
    phraseInHaystack(hay, identity.canonicalName) ||
    phraseInHaystack(hay, placeFeatureName(identity.canonicalName));
  const distinctiveNameMatch = matchesDistinctivePlaceName(hay, identity);
  const townHitsEarly = countTokenHits(hay, identity.townTokens);

  const requiresResolvedTownContext = needsExplicitTownInResult(identity);
  if (
    options?.scoringProfile === "undiscovered_app" &&
    identity.townTokens.length > 0 &&
    townHitsEarly.length === 0 &&
    requiresResolvedTownContext
  ) {
    rejectReasons.push("missing_town_context");
    hardReject = true;
  }

  if (
    options?.scoringProfile === "undiscovered_app" &&
    identity.forbiddenGenericOnly &&
    identity.townTokens.length > 0
  ) {
    const phraseWords = identity.canonicalName
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3);
    const allPhraseWordsOk =
      phraseWords.length > 0 && phraseWords.every((word) => tokenInHaystack(hay, word));
    if (!canonicalHit && !allPhraseWordsOk) {
      rejectReasons.push("generic_name_mismatch");
      hardReject = true;
    }
  }
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

  if (
    identity.requiredNameTokens.length > 0 &&
    !matchesDistinctivePlaceName(hay, identity)
  ) {
    rejectReasons.push("missing_distinctive_name");
    hardReject = true;
  }

  if (canonicalHit) {
    score += 14;
    positiveReasons.push("canonical_name_phrase");
  } else if (distinctiveNameMatch) {
    score += 14;
    positiveReasons.push("distinctive_name_match");
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

  const requiresTownForContext = needsExplicitTownInResult(identity);
  const strongDistinctiveMatch = distinctiveNameMatch;
  const placeContextOk =
    options?.scoringProfile === "undiscovered_app" && identity.townTokens.length > 0
      ? requiresTownForContext
        ? townHits.length > 0
        : townHits.length > 0 ||
          stateHits.length > 0 ||
          (strongDistinctiveMatch && !detectWrongTown(hay, identity.townTokens))
      : townHits.length > 0 || stateHits.length > 0;

  let confidence: PbfAssetMatchConfidence = "low";
  if (
    !hardReject &&
    (canonicalHit || distinctiveNameMatch || requiredHits.length >= 2) &&
    placeContextOk &&
    score >= 18
  ) {
    confidence = "high";
  } else if (
    !hardReject &&
    (canonicalHit || distinctiveNameMatch || requiredHits.length >= 1) &&
    placeContextOk &&
    score >= 10
  ) {
    confidence = "medium";
  }

  const neverSoftenRejects = new Set([
    "wrong_town",
    "wrong_state",
    "missing_town_context",
    "generic_name_mismatch",
    "different_specific_feature",
  ]);

  if (options?.scoringProfile === "undiscovered_app" && hardReject) {
    const softStockOnly =
      rejectReasons.length === 1 &&
      rejectReasons[0] === "stock_or_content_farm" &&
      requiredHits.length >= 1 &&
      (townHits.length > 0 || stateHits.length > 0);
    const softSimilarOnly =
      rejectReasons.includes("similar_named_place") &&
      !rejectReasons.some((reason) => neverSoftenRejects.has(reason)) &&
      (canonicalHit || requiredHits.length >= 2);
    const minRequiredHitsToSoften = Math.min(2, identity.requiredNameTokens.length);
    const softMissingNameOnly =
      rejectReasons.includes("missing_distinctive_name") &&
      !rejectReasons.some((reason) => neverSoftenRejects.has(reason)) &&
      (distinctiveNameMatch || requiredHits.length >= minRequiredHitsToSoften) &&
      (townHits.length > 0 || stateHits.length > 0);
    if (softStockOnly || softSimilarOnly || softMissingNameOnly) {
      hardReject = false;
      if (confidence === "low" && score >= 8) {
        confidence = "medium";
      }
    }
  }

  const identityGroupKey =
    requiredHits.length > 0
      ? requiredHits.sort().join("|")
      : distinctiveNameMatch
        ? tokenizePlaceName(placeFeatureName(identity.canonicalName))
            .filter((token) => token.length >= 3)
            .sort()
            .join("|")
        : "none";

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
