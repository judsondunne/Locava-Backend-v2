import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { ParsedPlaceQuery } from "../../types/places.js";
import type { PlaceImageResult } from "../../types/places.js";
import type {
  PbfAssetMatchConfidence,
  PbfAssetPreviewExternalAsset,
  PbfAssetPreviewStatus,
} from "../../types/pbfAssetPreview.js";
import { MIN_QUERY_SPECIFICITY_SCORE, type OsmPhotoQueryResult } from "./buildOsmSpecificPhotoQuery.js";
import {
  deriveTargetPlaceIdentityFromDoc,
  deriveTargetPlaceIdentityFromParsedQuery,
  type TargetPlaceIdentity,
} from "./deriveTargetPlaceIdentity.js";
import { scorePhotoResultMetadata } from "./scorePhotoResultMetadata.js";

export type PbfPhotoVisionMode = "off" | "borderline_only" | "top_only" | "all_candidates";

export type PbfAssetRejectedAsset = {
  imageUrl: string;
  title: string;
  caption: string;
  sourceDomain: string;
  sourceUrl: string;
  score: number;
  confidence: PbfAssetMatchConfidence;
  rejectReasons: string[];
  metadataScore: number;
};

export type PhotoSearchResultSetScore = {
  assetStatus: PbfAssetPreviewStatus;
  assetsReady: boolean;
  resultSetScore: number;
  acceptedAssets: PbfAssetPreviewExternalAsset[];
  rejectedAssets: PbfAssetRejectedAsset[];
  warnings: string[];
  shouldRunGemini: boolean;
  rejectedCount: number;
  topRejectionReasons: string[];
  matchedTokens: string[];
  missingRequiredTokens: string[];
  identity: TargetPlaceIdentity;
};

const DISPLAY_MAX = 8;
const UNDISCOVERED_APP_DISPLAY_MAX = 8;
export type PhotoSearchScoringProfile = "admin_strict" | "undiscovered_app";

export type PhotoSearchScoreOptions = {
  visionMode?: PbfPhotoVisionMode;
  strictTitleSourceMatch?: boolean;
  /** Admin tools stay strict; undiscovered app uses relaxed metadata + fallback ranking. */
  scoringProfile?: PhotoSearchScoringProfile;
};

const ADMIN_RESULT_SET_ACCEPT_THRESHOLD = 12;
const APP_RESULT_SET_ACCEPT_THRESHOLD = 8;
const APP_FALLBACK_MIN_SCORE = 8;

const APP_HARD_JUNK_REJECTS = new Set([
  "graphic_asset",
  "admin_or_event_page",
  "vector_or_gif",
  "generic_listing_page",
  "wrong_state",
  "stock_or_content_farm",
  "wrong_town",
  "different_specific_feature",
  "generic_category_only",
  "generic_name_mismatch",
  "missing_town_context",
  "forum_or_discussion_page",
  "thumbnail_too_small",
]);

function toExternalAsset(
  result: PlaceImageResult,
  meta: ReturnType<typeof scorePhotoResultMetadata>,
  rank: number,
): PbfAssetPreviewExternalAsset {
  const domain = result.sourceDomain || result.sourceName;
  return {
    ...result,
    rank,
    assetMatchScore: meta.score,
    assetMatchConfidence: meta.confidence,
    assetMatchReasons: [...meta.positiveReasons, ...meta.rejectReasons.map((r) => `reject:${r}`)],
    sourceDomain: domain,
    backlinkUrl: result.backlinkUrl ?? result.sourceUrl,
    title: result.title ?? result.caption,
  };
}

function deriveShouldRunGemini(
  visionMode: PbfPhotoVisionMode,
  accepted: PbfAssetPreviewExternalAsset[],
): boolean {
  if (visionMode === "off") return false;
  if (accepted.length === 0) return false;
  return accepted.some((a) => a.assetMatchConfidence === "medium" || a.assetMatchConfidence === "high");
}

type ScoredPhotoRow = {
  result: PlaceImageResult;
  meta: ReturnType<typeof scorePhotoResultMetadata>;
  serperIndex: number;
};

function applyUndiscoveredAppFallback(
  identity: TargetPlaceIdentity,
  allScored: ScoredPhotoRow[],
): ScoredPhotoRow[] {
  const rows = allScored
    .filter((row) => {
      if (!row.meta.hardReject) return row.meta.score >= APP_FALLBACK_MIN_SCORE;
      return !row.meta.rejectReasons.some((reason) => APP_HARD_JUNK_REJECTS.has(reason));
    })
    .filter((row) => {
      const hay = `${row.result.title ?? ""} ${row.result.caption ?? ""} ${row.result.sourceUrl ?? ""}`.toLowerCase();
      const canonical = identity.canonicalName.toLowerCase();
      const hasCanonical = canonical.length > 0 && hay.includes(canonical);
      const requiredHits = identity.requiredNameTokens.filter((token) =>
        hay.includes(token.toLowerCase()),
      );
      const compactCanonical = identity.canonicalName.toLowerCase().replace(/[^a-z0-9]/g, "");
      const compactHay = hay.replace(/[^a-z0-9]/g, "");
      const hasName =
        hasCanonical ||
        (compactCanonical.length >= 6 && compactHay.includes(compactCanonical)) ||
        (identity.requiredNameTokens.length >= 2
          ? requiredHits.length >= Math.min(2, identity.requiredNameTokens.length)
          : requiredHits.length >= 1);
      const hasTown =
        identity.townTokens.length > 0 &&
        identity.townTokens.some((token) => hay.includes(token.toLowerCase()));
      const canonicalWords = identity.canonicalName
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3);
      const requiresTown = identity.forbiddenGenericOnly || canonicalWords.length <= 1;
      const hasPlace = identity.townTokens.length > 0
        ? requiresTown
          ? hasTown
          : hasTown || identity.stateTokens.some((token) => hay.includes(token.toLowerCase()))
        : identity.stateTokens.some((token) => hay.includes(token.toLowerCase()));
      return hasName && hasPlace;
    })
    .sort((a, b) => a.serperIndex - b.serperIndex);

  return rows.slice(0, DISPLAY_MAX);
}

function pickUndiscoveredAppRows(
  rows: ScoredPhotoRow[],
  displayMax: number,
): ScoredPhotoRow[] {
  const seenImageUrls = new Set<string>();
  const seenSourceUrls = new Set<string>();
  const picked: ScoredPhotoRow[] = [];
  const ordered = [...rows].sort((a, b) => a.serperIndex - b.serperIndex);

  for (const row of ordered) {
    if (row.meta.hardReject || row.meta.confidence === "low") continue;
    const imageKey = row.result.imageUrl.trim().toLowerCase();
    const sourceKey = row.result.sourceUrl.trim().toLowerCase();
    if (!imageKey || seenImageUrls.has(imageKey) || seenSourceUrls.has(sourceKey)) continue;
    seenImageUrls.add(imageKey);
    seenSourceUrls.add(sourceKey);
    picked.push(row);
    if (picked.length >= displayMax) break;
  }

  return picked;
}

function applyConsensus(
  identity: TargetPlaceIdentity,
  candidates: ScoredPhotoRow[],
  options?: { scoringProfile?: PhotoSearchScoringProfile; allScored?: ScoredPhotoRow[] },
): {
  accepted: PbfAssetPreviewExternalAsset[];
  rejected: PbfAssetRejectedAsset[];
  warnings: string[];
  assetStatus: PbfAssetPreviewStatus;
  assetsReady: boolean;
  resultSetScore: number;
  matchedTokens: string[];
  missingRequiredTokens: string[];
  shouldRunGemini: boolean;
} {
  const rejected: PbfAssetRejectedAsset[] = [];
  const viable: Array<{ result: PlaceImageResult; meta: ReturnType<typeof scorePhotoResultMetadata> }> = [];

  for (const row of candidates) {
    const title = row.result.title || row.result.caption || "";
    if (row.meta.hardReject || row.meta.confidence === "low") {
      rejected.push({
        imageUrl: row.result.imageUrl,
        title,
        caption: row.result.caption,
        sourceDomain: row.result.sourceDomain || row.result.sourceName,
        sourceUrl: row.result.sourceUrl,
        score: row.meta.score,
        confidence: row.meta.confidence,
        rejectReasons: row.meta.rejectReasons.length ? row.meta.rejectReasons : ["low_metadata_score"],
        metadataScore: row.meta.score,
      });
      continue;
    }
    viable.push(row);
  }

  const groupCounts = new Map<string, number>();
  for (const row of viable) {
    const key = row.meta.identityGroupKey;
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const sortedGroups = [...groupCounts.entries()].sort((a, b) => b[1] - a[1]);
  const dominantKey = sortedGroups[0]?.[0] ?? "none";

  function groupRequiredOverlap(key: string): string[] {
    if (!key || key === "none") return [];
    return key.split("|").filter((t) => identity.requiredNameTokens.includes(t));
  }

  const identityDisagreement =
    sortedGroups.length > 1 &&
    sortedGroups[0]![1] > 0 &&
    sortedGroups[1]![1] > 0 &&
    (() => {
      const a = groupRequiredOverlap(sortedGroups[0]![0]);
      const b = groupRequiredOverlap(sortedGroups[1]![0]);
      if (a.length === 0 || b.length === 0) return false;
      return !a.some((t) => b.includes(t));
    })();

  const targetKey = [...identity.requiredNameTokens].sort().join("|");
  const dominantMatchesTarget =
    dominantKey === targetKey ||
    (dominantKey !== "none" &&
      identity.requiredNameTokens.length > 0 &&
      identity.requiredNameTokens.every((t) => dominantKey.includes(t)));

  const high = viable.filter((v) => v.meta.confidence === "high");
  const medium = viable.filter((v) => v.meta.confidence === "medium");

  const pickFrom = (rows: typeof viable) =>
    rows
      .filter((v) => !identityDisagreement || v.meta.identityGroupKey === dominantKey)
      .sort((a, b) => b.meta.score - a.meta.score);

  const profile = options?.scoringProfile ?? "admin_strict";
  const displayMax = profile === "undiscovered_app" ? UNDISCOVERED_APP_DISPLAY_MAX : DISPLAY_MAX;
  const acceptThreshold =
    profile === "undiscovered_app" ? APP_RESULT_SET_ACCEPT_THRESHOLD : ADMIN_RESULT_SET_ACCEPT_THRESHOLD;

  let acceptedRows: typeof viable = [];
  if (profile === "undiscovered_app") {
    acceptedRows = pickUndiscoveredAppRows(candidates, displayMax);
    if (acceptedRows.length === 0) {
      acceptedRows = applyUndiscoveredAppFallback(identity, options?.allScored ?? candidates);
    }
  } else if (high.length >= 1 && dominantMatchesTarget && !identityDisagreement) {
    acceptedRows = pickFrom(high).slice(0, displayMax);
  } else if (medium.length >= 2 && dominantMatchesTarget && !identityDisagreement) {
    const domains = new Set<string>();
    for (const row of pickFrom(medium)) {
      const d = row.result.sourceDomain || row.result.sourceName;
      if (domains.has(d)) continue;
      domains.add(d);
      acceptedRows.push(row);
      if (acceptedRows.length >= displayMax) break;
    }
    if (acceptedRows.length < 2) acceptedRows = [];
  }

  const accepted = acceptedRows.map((row, index) => toExternalAsset(row.result, row.meta, index + 1));
  const resultSetScore =
    accepted.length > 0
      ? Math.round((accepted.reduce((s, a) => s + a.assetMatchScore, 0) / accepted.length) * 10) / 10
      : 0;

  const matchedTokens = [...new Set(accepted.flatMap((a) => a.assetMatchReasons.filter((r) => !r.startsWith("reject:"))))];
  const missingRequiredTokens = identity.requiredNameTokens.filter(
    (t) => !accepted.some((a) => `${a.caption} ${a.title} ${a.sourceUrl}`.toLowerCase().includes(t)),
  );

  const warnings: string[] = [];
  let assetStatus: PbfAssetPreviewStatus = "no_good_match";
  let assetsReady = false;

  if (accepted.length > 0 && resultSetScore >= acceptThreshold) {
    assetStatus = "found";
    assetsReady = true;
  } else if (identityDisagreement || !dominantMatchesTarget) {
    assetStatus = "low_confidence";
    warnings.push("Top results disagree on place identity — safer to leave blank.");
  } else if (rejected.length > 0 && rejected.some((r) => r.rejectReasons.includes("similar_named_place"))) {
    assetStatus = "no_good_match";
    warnings.push("Rejected similar-named place results — no exact-place photo match.");
  } else if (rejected.some((r) => r.rejectReasons.includes("generic_category_only"))) {
    assetStatus = "no_good_match";
    warnings.push("Rejected generic category-only Vermont results.");
  } else if (viable.length > 0) {
    assetStatus = "low_confidence";
    warnings.push("No good photos found — metadata confidence below threshold.");
  } else {
    assetStatus = "no_good_match";
    warnings.push("No good photos found — no result passed strict title/source match.");
  }

  if (!assetsReady) {
    warnings.push("No good photos found — safer to leave blank.");
  }

  return {
    accepted: assetsReady ? accepted : [],
    rejected,
    warnings,
    assetStatus,
    assetsReady,
    resultSetScore,
    matchedTokens,
    missingRequiredTokens,
    shouldRunGemini: false,
  };
}

function buildRejectedSummary(rejected: PbfAssetRejectedAsset[]): string[] {
  const reasonCounts = new Map<string, number>();
  for (const r of rejected) {
    for (const reason of r.rejectReasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  return [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([reason, count]) => `${reason} (${count})`);
}

export function scorePhotoSearchResultsForIdentity(
  identity: TargetPlaceIdentity,
  serperResults: PlaceImageResult[],
  options?: PhotoSearchScoreOptions,
): PhotoSearchResultSetScore {
  const visionMode = options?.visionMode ?? "off";
  const profile = options?.scoringProfile ?? "admin_strict";
  const strict =
    profile === "undiscovered_app" ? false : options?.strictTitleSourceMatch !== false;

  if (identity.skipImageLookup) {
    return {
      assetStatus: "skipped",
      assetsReady: false,
      resultSetScore: 0,
      acceptedAssets: [],
      rejectedAssets: [],
      warnings: [identity.skipReason ?? "Place identity too generic for safe image lookup."],
      shouldRunGemini: false,
      rejectedCount: 0,
      topRejectionReasons: [],
      matchedTokens: [],
      missingRequiredTokens: identity.requiredNameTokens,
      identity,
    };
  }

  if (serperResults.length === 0) {
    return {
      assetStatus: "no_good_match",
      assetsReady: false,
      resultSetScore: 0,
      acceptedAssets: [],
      rejectedAssets: [],
      warnings: ["No image search results returned."],
      shouldRunGemini: false,
      rejectedCount: 0,
      topRejectionReasons: [],
      matchedTokens: [],
      missingRequiredTokens: identity.requiredNameTokens,
      identity,
    };
  }

  const scored: ScoredPhotoRow[] = serperResults.map((result, serperIndex) => {
    const meta = scorePhotoResultMetadata(identity, result, { scoringProfile: profile });
    if (!strict && meta.rejectReasons.includes("missing_distinctive_name") && meta.confidence === "medium") {
      return { result, meta: { ...meta, hardReject: false }, serperIndex };
    }
    return { result, meta, serperIndex };
  });

  const consensus = applyConsensus(identity, scored, { scoringProfile: profile, allScored: scored });
  const shouldRunGemini = deriveShouldRunGemini(visionMode, consensus.accepted);

  return {
    assetStatus: consensus.assetStatus,
    assetsReady: consensus.assetsReady,
    resultSetScore: consensus.resultSetScore,
    acceptedAssets: consensus.accepted,
    rejectedAssets: consensus.rejected,
    warnings: consensus.warnings,
    shouldRunGemini,
    rejectedCount: consensus.rejected.length,
    topRejectionReasons: buildRejectedSummary(consensus.rejected),
    matchedTokens: consensus.matchedTokens,
    missingRequiredTokens: consensus.missingRequiredTokens,
    identity,
  };
}

export function scorePhotoSearchResultsForPlace(
  item: PbfCopierPreviewDoc,
  query: OsmPhotoQueryResult,
  serperResults: PlaceImageResult[],
  options?: PhotoSearchScoreOptions,
): PhotoSearchResultSetScore {
  const identity = deriveTargetPlaceIdentityFromDoc(item, query);

  if (query.skip || query.querySpecificityScore < MIN_QUERY_SPECIFICITY_SCORE) {
    return {
      assetStatus: "skipped",
      assetsReady: false,
      resultSetScore: 0,
      acceptedAssets: [],
      rejectedAssets: [],
      warnings: [query.skipReason ?? "Query too generic for safe photo lookup."],
      shouldRunGemini: false,
      rejectedCount: 0,
      topRejectionReasons: [],
      matchedTokens: [],
      missingRequiredTokens: identity.requiredNameTokens,
      identity,
    };
  }

  return scorePhotoSearchResultsForIdentity(identity, serperResults, options);
}

export function scorePhotoSearchResultsForParsedQuery(
  parsed: ParsedPlaceQuery,
  serperResults: PlaceImageResult[],
  options?: PhotoSearchScoreOptions,
): PhotoSearchResultSetScore {
  const identity = deriveTargetPlaceIdentityFromParsedQuery(parsed);
  return scorePhotoSearchResultsForIdentity(identity, serperResults, options);
}
