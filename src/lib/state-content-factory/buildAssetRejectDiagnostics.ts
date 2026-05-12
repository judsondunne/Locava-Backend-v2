import type { WikimediaRemovedAssetSummary } from "../wikimediaMvp/WikimediaMvpHygieneTypes.js";
import type { WikimediaAssetGroup, WikimediaMvpCandidateAnalysis } from "../wikimediaMvp/WikimediaMvpTypes.js";
import { dedupeStableStrings } from "../wikimediaMvp/dedupeStableStrings.js";

export type AssetRejectReasonCount = { reason: string; count: number };

export type SampleRejectedAsset = {
  title: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  matchedQuery?: string;
  matchedQueryRank?: number;
  mediaPlaceMatchScore?: number;
  assetDistanceMilesFromPlace?: number | null;
  reasons: string[];
};

function isRejectedRow(row: WikimediaMvpCandidateAnalysis): boolean {
  if (row.status === "REJECT") return true;
  if (row.hygieneStatus === "REJECT") return true;
  return false;
}

function normalizeReasonToken(raw: string): string {
  const t = String(raw).trim();
  if (!t) return "reject_unknown";
  const lower = t.toLowerCase();
  if (lower.includes("metadata too weak")) return "metadata_too_weak";
  if (lower.includes("low resolution")) return "low_resolution";
  if (lower.includes("unsupported format")) return "unsupported_format";
  if (lower.includes("duplicate")) return "duplicate_asset";
  if (lower.includes("media_place_match_reject")) return "weak_media_place_match";
  if (lower.includes("wrong_place_region") || lower.startsWith("wrong_place_region_")) return "wrong_place_region";
  if (lower.includes("generic_flickr")) return "generic_title";
  if (lower.includes("asset_geotag_far")) return "asset_geotag_far_from_place";
  if (lower.includes("asset_geotag_moderate")) return "asset_geotag_moderate_distance";
  if (lower.includes("title_or_meta_suggests_different_us_state")) return "wrong_state_or_region";
  if (lower.includes("no_asset_geotag") || lower === "no_asset_geotag") return "no_asset_geotag";
  if (lower.includes("missing_image") || lower.includes("missing url")) return "missing_image_url";
  if (lower.includes("missing_attribution") || lower.includes("attribution")) return "missing_attribution";
  if (lower.includes("visual_hash")) return "visual_hash_failed";
  if (lower.includes("hydration")) return "hydration_failed";
  if (lower.includes("blocked_title")) return "blocked_title_pattern";
  if (lower.includes("broad") && lower.includes("query")) return "source_query_too_broad";
  if (lower.includes("all_assets_failed_hygiene")) return "all_assets_failed_hygiene";
  if (lower.includes("book_or_archive")) return "generic_title";
  if (lower.includes("no_asset_geotag") || lower === "no_asset_geotag") return "no_asset_coordinates";
  if (lower.includes("no located") || lower.includes("no_located")) return "no_location_anchor";
  if (lower.includes("wrong_state") || lower.includes("different_us_state")) return "wrong_state";
  if (lower.includes("too_far") || lower.includes("far_from_place")) return "too_far_from_place";
  if (lower.includes("hygiene") && lower.includes("reject")) return "hygiene_failed";
  return t.replace(/\s+/g, "_").slice(0, 120);
}

function collectReasons(row: WikimediaMvpCandidateAnalysis): string[] {
  const out: string[] = [];
  const hygiene = row.hygieneReasons?.filter(Boolean) ?? [];
  out.push(...hygiene.map(normalizeReasonToken));
  if (row.duplicateReason) out.push("duplicate_asset");
  if (row.mediaPlaceMismatchReasons?.length) {
    out.push(...row.mediaPlaceMismatchReasons.map(normalizeReasonToken));
  }
  for (const r of row.reasoning ?? []) {
    if (typeof r === "string" && r.length > 0) out.push(normalizeReasonToken(r));
  }
  return dedupeStableStrings(out);
}

function primarySlug(row: WikimediaMvpCandidateAnalysis): string {
  const reasons = collectReasons(row);
  return reasons[0] ?? "reject_unknown";
}

function removedToPseudoAnalysis(row: WikimediaRemovedAssetSummary): WikimediaMvpCandidateAnalysis {
  return {
    sourceTitle: row.sourceTitle,
    generatedTitle: row.generatedTitle,
    sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(row.sourceTitle)}`,
    thumbnailUrl: row.thumbnailUrl,
    fullImageUrl: row.fullImageUrl,
    author: null,
    license: null,
    credit: null,
    activities: [],
    activityReasoning: [],
    activityUncertainty: null,
    titleConfidence: "low",
    placeMatchConfidence: 0,
    qualityScore: 0,
    relevanceScore: 0,
    coolnessScore: 0,
    duplicateScore: null,
    duplicateReason: null,
    status: "REJECT",
    reasoning: row.hygieneReasons ?? [],
    scores: {},
    postPreview: null,
    candidateId: row.candidateId,
    hygieneStatus: row.hygieneStatus ?? "REJECT",
    hygieneReasons: row.hygieneReasons ?? [],
    hygieneWarnings: row.hygieneWarnings ?? [],
    duplicateDecision: row.duplicateDecision,
  };
}

/**
 * Primary asset-level diagnostics from `candidateAnalysis`, plus hygiene-removed rows
 * so dashboards are not blank when rejects happen only at the hygiene layer.
 */
export function buildAssetRejectDiagnosticsMerged(
  candidateAnalysis: WikimediaMvpCandidateAnalysis[],
  assetGroups: WikimediaAssetGroup[] | undefined,
): {
  topAssetRejectReasons: AssetRejectReasonCount[];
  sampleRejectedAssets: SampleRejectedAsset[];
} {
  const removed = (assetGroups ?? []).flatMap((g) => [...(g.removedAssets ?? [])]);
  const pseudo = removed.map(removedToPseudoAnalysis);
  const merged = [...candidateAnalysis, ...pseudo];
  return buildAssetRejectDiagnostics(merged);
}

export function buildAssetRejectDiagnostics(candidateAnalysis: WikimediaMvpCandidateAnalysis[]): {
  topAssetRejectReasons: AssetRejectReasonCount[];
  sampleRejectedAssets: SampleRejectedAsset[];
} {
  const counts = new Map<string, number>();
  const samples: SampleRejectedAsset[] = [];

  for (const row of candidateAnalysis) {
    if (!isRejectedRow(row)) continue;
    const reasons = collectReasons(row);
    const primary = primarySlug(row);
    counts.set(primary, (counts.get(primary) ?? 0) + 1);
    if (samples.length < 12) {
      samples.push({
        title: row.sourceTitle,
        sourceUrl: row.sourceUrl,
        thumbnailUrl: row.thumbnailUrl ?? undefined,
        matchedQuery: row.matchedQuery,
        matchedQueryRank: row.matchedQueryRank,
        mediaPlaceMatchScore: row.mediaPlaceMatchScore,
        assetDistanceMilesFromPlace: row.assetDistanceMilesFromPlace ?? null,
        reasons,
      });
    }
  }

  const topAssetRejectReasons = [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return { topAssetRejectReasons, sampleRejectedAssets: samples };
}
