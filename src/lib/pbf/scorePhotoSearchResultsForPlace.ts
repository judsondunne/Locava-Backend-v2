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
const RESULT_SET_ACCEPT_THRESHOLD = 12;

export type PhotoSearchScoreOptions = {
  visionMode?: PbfPhotoVisionMode;
  strictTitleSourceMatch?: boolean;
};

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

function applyConsensus(
  identity: TargetPlaceIdentity,
  candidates: Array<{
    result: PlaceImageResult;
    meta: ReturnType<typeof scorePhotoResultMetadata>;
  }>,
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

  let acceptedRows: typeof viable = [];
  if (high.length >= 1 && dominantMatchesTarget && !identityDisagreement) {
    acceptedRows = pickFrom(high).slice(0, DISPLAY_MAX);
  } else if (medium.length >= 2 && dominantMatchesTarget && !identityDisagreement) {
    const domains = new Set<string>();
    for (const row of pickFrom(medium)) {
      const d = row.result.sourceDomain || row.result.sourceName;
      if (domains.has(d)) continue;
      domains.add(d);
      acceptedRows.push(row);
      if (acceptedRows.length >= DISPLAY_MAX) break;
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

  if (accepted.length > 0 && resultSetScore >= RESULT_SET_ACCEPT_THRESHOLD) {
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
  const strict = options?.strictTitleSourceMatch !== false;

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

  const scored = serperResults.map((result) => {
    const meta = scorePhotoResultMetadata(identity, result);
    if (!strict && meta.rejectReasons.includes("missing_distinctive_name") && meta.confidence === "medium") {
      return { result, meta: { ...meta, hardReject: false } };
    }
    return { result, meta };
  });

  const consensus = applyConsensus(identity, scored);
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
