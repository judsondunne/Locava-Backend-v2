import type { WikimediaMvpNormalizedAsset, WikimediaMvpSeedPlace } from "./WikimediaMvpTypes.js";

export type MediaPlaceMatchResult = {
  score: number;
  reasons: string[];
  mismatchReasons: string[];
};

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/file:/gi, "")
    .replace(/\.(jpg|jpeg|png|gif|webp)$/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalizeForMatch(s)
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

const GENERIC_TITLE_PATTERNS =
  /^(flickr|untitled|image|img_\d+|dsc\d+|photo|picture|mountain walk|granite quarry)$/i;
const BOOK_SCAN =
  /manuscript|archive\.org|page \d+ of \d+|volume \d+|chapter \d+|scan of|library of congress|gutenberg/i;
const WRONG_REGION_HINTS: Array<{ re: RegExp; label: string }> = [
  { re: /\bwhite mountains\b/i, label: "white_mountains_region" },
  { re: /\bthe flume\b/i, label: "flume_white_mountains" },
  { re: /\bblue ridge\b/i, label: "blue_ridge_region" },
  { re: /\bappalachian trail\b(?![^.]*\bvt\b)/i, label: "appalachian_trail_generic" },
];

function stateTokens(place: WikimediaMvpSeedPlace): string[] {
  const out: string[] = [];
  const sc = String(place.stateCode || "").toLowerCase();
  const sn = String(place.stateName || "").toLowerCase();
  if (sc) out.push(sc);
  if (sn) {
    out.push(sn);
    const first = sn.split(/\s+/)[0];
    if (first && first.length > 2) out.push(first);
  }
  return [...new Set(out)];
}

function placeCategoryTerms(place: WikimediaMvpSeedPlace): string[] {
  const raw = [...(place.placeCategoryKeywords ?? []), ...(place.themes ?? [])].join(" ").toLowerCase();
  const terms = ["waterfall", "falls", "gorge", "notch", "gap", "pass", "quarry", "castle", "beach", "lake", "mountain"];
  return terms.filter((t) => raw.includes(t) || String(place.placeName || "").toLowerCase().includes(t));
}

/**
 * 0–100 media ↔ place match score for Commons assets (title/categories/query provenance).
 */
export function computeMediaPlaceMatchScore(
  place: WikimediaMvpSeedPlace,
  asset: WikimediaMvpNormalizedAsset,
  opts?: {
    matchedQuery?: string;
    queryVariantType?: string;
    sourceConfidenceRank?: number;
    /** Distance from asset geotag to seed place (miles), when both exist. */
    distanceMiles?: number;
  },
): MediaPlaceMatchResult {
  const reasons: string[] = [];
  const mismatchReasons: string[] = [];
  let score = 0;

  const placeName = String(place.placeName || "").trim();
  const placeNorm = normalizeForMatch(placeName);
  const titleNorm = normalizeForMatch(asset.title);
  const catBlob = asset.categories.map((c) => normalizeForMatch(c)).join(" | ");
  const descNorm = normalizeForMatch(asset.descriptionText || "");
  const fullText = `${titleNorm} ${catBlob} ${descNorm}`;

  if (typeof opts?.distanceMiles === "number" && Number.isFinite(opts.distanceMiles)) {
    if (opts.distanceMiles > 40) {
      score -= 50;
      mismatchReasons.push("asset_geotag_far_from_place");
    } else if (opts.distanceMiles > 15) {
      score -= 22;
      mismatchReasons.push("asset_geotag_moderate_distance");
    }
  }

  if (placeNorm.length >= 4 && titleNorm.includes(placeNorm)) {
    score += 35;
    reasons.push("title_contains_full_place_name");
  } else {
    const placeTokens = tokenize(placeName).filter((t) => t.length > 3);
    const important = placeTokens.filter((t) => !/^(the|and|of|state)$/i.test(t));
    const hits = important.filter((t) => titleNorm.includes(t));
    if (hits.length >= 2) {
      score += 22;
      reasons.push("title_contains_key_place_tokens");
    } else if (hits.length === 1) {
      score += 12;
      reasons.push("title_contains_one_key_place_token");
    }
  }

  for (const c of asset.categories) {
    const cn = normalizeForMatch(c);
    if (placeNorm.length >= 4 && cn === placeNorm) {
      score += 25;
      reasons.push("commons_category_equals_place_name");
      break;
    }
    if (placeNorm.length >= 4 && cn.includes(placeNorm)) {
      score += 15;
      reasons.push("commons_category_contains_place_name");
      break;
    }
  }

  const st = stateTokens(place);
  const stateInTitle = st.some((s) => s.length > 1 && titleNorm.includes(s));
  if (stateInTitle) {
    score += 10;
    reasons.push("title_contains_state_or_region");
  }

  const pTerms = placeCategoryTerms(place);
  for (const t of pTerms) {
    if (fullText.includes(t)) {
      score += 6;
      reasons.push(`category_type_term_${t}`);
      break;
    }
  }

  const vType = String(opts?.queryVariantType || asset.queryVariantType || "");
  if (vType === "exact_place_name" || vType === "quoted_exact_name") {
    score += 8;
    reasons.push("high_precision_query_variant");
  } else if (vType.startsWith("place_plus_state") || vType === "commons_category_from_wikidata") {
    score += 5;
    reasons.push("state_or_wikidata_backed_query");
  } else if (vType.startsWith("synonym_")) {
    score += 4;
    reasons.push("synonym_query_variant");
  } else if (vType === "legacy_full_label" || vType === "broad_fallback") {
    score -= 6;
    mismatchReasons.push("broad_or_legacy_query_variant");
  }

  const srcRank = opts?.sourceConfidenceRank ?? asset.sourceConfidenceRank;
  if (typeof srcRank === "number") {
    if (srcRank <= 1) score += 12;
    else if (srcRank <= 3) score += 8;
    else if (srcRank <= 4) score += 4;
    else score -= 4;
  }

  if (placeNorm.length >= 4 && descNorm.includes(placeNorm)) {
    score += 8;
    reasons.push("description_contains_place_name");
  }

  const expectedState = String(place.stateCode || "").toUpperCase();
  const usStates =
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
      /\s+/,
    );
  if (expectedState) {
    /** Title + categories only — descriptions often cite other states or contain false \bST\b matches. */
    const stateScanText = `${titleNorm} ${catBlob}`;
    for (const st of usStates) {
      if (st === expectedState) continue;
      if (st === "MA" && /\b\d+\s*ma\b/i.test(stateScanText)) {
        continue;
      }
      const re = new RegExp(`\\b${st}\\b`, "i");
      if (re.test(stateScanText)) {
        score -= 25;
        mismatchReasons.push("title_or_meta_suggests_different_us_state");
        break;
      }
    }
  }

  for (const { re, label } of WRONG_REGION_HINTS) {
    if (re.test(titleNorm) || re.test(catBlob)) {
      const vtOk = expectedState && (titleNorm.includes(expectedState.toLowerCase()) || titleNorm.includes("vermont"));
      if (!vtOk) {
        score -= 30;
        mismatchReasons.push(`wrong_place_region_${label}`);
      }
    }
  }

  if (/\bflickr\b/i.test(asset.title) || /\bflickr\b/i.test(titleNorm)) {
    score -= 35;
    mismatchReasons.push("generic_flickr_title");
  } else if (GENERIC_TITLE_PATTERNS.test(titleNorm.split(" ").slice(0, 3).join(" "))) {
    const strongCat = reasons.includes("commons_category_equals_place_name");
    if (!strongCat) {
      score -= 18;
      mismatchReasons.push("generic_title");
    }
  }

  if (BOOK_SCAN.test(titleNorm)) {
    score -= 25;
    mismatchReasons.push("book_or_archive_scan_title");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons, mismatchReasons };
}
