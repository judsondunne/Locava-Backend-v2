import { evaluateBadAssetHygiene, mergeHygieneStatus } from "./filterBadWikimediaAssets.js";
import {
  compareCandidateKeepPriority,
  dedupeExactGroupAssets,
  dedupeNearGroupAssets,
  type HygieneCandidate,
} from "./dedupeWikimediaGroupAssets.js";
import type { WikimediaAnalyzedCandidate } from "./groupWikimediaAssetsIntoPosts.js";
import type {
  WikimediaAssetHygieneSummary,
  WikimediaRemovedAssetSummary,
} from "./WikimediaMvpHygieneTypes.js";
import type { WikimediaAssetGroup } from "./WikimediaMvpTypes.js";
import { computeDHashFromImageUrl, type ImageColorStats } from "./visualHashFromImageUrl.js";

export const WIKIMEDIA_MVP_MAX_KEPT_ASSETS_PER_POST = 8;

export type WikimediaHygieneLogEvent = {
  level?: "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
};

function defaultHygieneCandidate(candidate: WikimediaAnalyzedCandidate): HygieneCandidate {
  return {
    ...candidate,
    hygieneStatus: "PASS",
    hygieneReasons: [],
    hygieneWarnings: [],
    duplicateDecision: "UNIQUE",
    qualityFlags: {},
  };
}

function toRemovedSummary(candidate: HygieneCandidate): WikimediaRemovedAssetSummary {
  return {
    candidateId: candidate.candidateId,
    generatedTitle: candidate.generatedTitle,
    thumbnailUrl: candidate.thumbnailUrl,
    fullImageUrl: candidate.fullImageUrl,
    sourceTitle: candidate.sourceTitle,
    hygieneStatus: candidate.hygieneStatus,
    hygieneReasons: candidate.hygieneReasons,
    hygieneWarnings: candidate.hygieneWarnings,
    duplicateClusterId: candidate.duplicateClusterId,
    duplicateDecision: candidate.duplicateDecision,
    visualHash: candidate.visualHash,
    visualHashDistanceToPrimary: candidate.visualHashDistanceToPrimary,
    qualityFlags: candidate.qualityFlags,
  };
}

function isHygieneRejectReason(reason: string): boolean {
  return (
    reason.startsWith("rejected_") &&
    !reason.includes("duplicate") &&
    reason !== "all_assets_failed_hygiene"
  );
}

function isDuplicateRejectReason(reason: string): boolean {
  return reason.includes("duplicate");
}

function buildHygieneSummary(input: {
  originalAssetCount: number;
  kept: HygieneCandidate[];
  removed: HygieneCandidate[];
  review: HygieneCandidate[];
}): WikimediaAssetHygieneSummary {
  const rejectedAssets = input.removed.filter((a) => a.hygieneStatus === "REJECT");
  const rejectedDuplicateCount = rejectedAssets.filter((a) =>
    a.hygieneReasons.some(isDuplicateRejectReason),
  ).length;
  const rejectedHygieneCount = rejectedAssets.filter((a) =>
    a.hygieneReasons.some(isHygieneRejectReason),
  ).length;
  return {
    originalAssetCount: input.originalAssetCount,
    keptAssetCount: input.kept.length,
    rejectedAssetCount: rejectedAssets.length,
    reviewAssetCount: input.review.length,
    rejectedDuplicateCount,
    rejectedHygieneCount,
    rejectedPanoramaCount: rejectedAssets.filter((a) =>
      a.hygieneReasons.some((r) => r.includes("panorama")),
    ).length,
    rejectedLowQualityCount: rejectedAssets.filter((a) =>
      a.hygieneReasons.some((r) => r.includes("low_resolution") || r.includes("missing_usable_image_url") || r.includes("unreadable") || r.includes("non_photo")),
    ).length,
    rejectedBlackAndWhiteOrFilterCount: rejectedAssets.filter((a) =>
      a.hygieneReasons.some((r) => r.includes("black_and_white") || r.includes("filtered")),
    ).length,
    possibleDuplicateReviewCount: input.review.filter((a) =>
      a.hygieneReasons.includes("possible_duplicate_kept_conservative"),
    ).length,
  };
}

function rankForPostCap(candidate: HygieneCandidate): number {
  const duplicatePenalty =
    candidate.duplicateDecision === "POSSIBLE_DUPLICATE_REVIEW" ? -1 : 0;
  return (
    (candidate.hasRealAssetLocation ? 1000 : 0) +
    duplicatePenalty +
    candidate.qualityScore * 10 +
    candidate.relevanceScore * 5 +
    metadataCompleteness(candidate)
  );
}

function metadataCompleteness(candidate: HygieneCandidate): number {
  let score = 0;
  if (candidate.license) score += 1;
  if (candidate.author) score += 1;
  if (candidate.credit) score += 1;
  if (candidate.sourceTitle) score += 1;
  if (candidate.dayKey) score += 1;
  return score;
}

function applyPostAssetCap(
  candidates: HygieneCandidate[],
  maxKept: number,
): { kept: HygieneCandidate[]; removed: HygieneCandidate[] } {
  if (candidates.length <= maxKept) return { kept: candidates, removed: [] };
  const sorted = [...candidates].sort((a, b) => rankForPostCap(b) - rankForPostCap(a));
  const kept = sorted.slice(0, maxKept);
  const keptIds = new Set(kept.map((c) => c.candidateId));
  const removed = sorted
    .filter((c) => !keptIds.has(c.candidateId))
    .map((candidate) => ({
      ...candidate,
      hygieneStatus: "REJECT" as const,
      hygieneReasons: [...candidate.hygieneReasons, "post_asset_cap_exceeded"],
    }));
  return { kept, removed };
}

async function enrichVisualHash(
  candidate: HygieneCandidate,
  hashCache: Map<string, { hash: string; colorStats: ImageColorStats } | null>,
  onLog?: (event: WikimediaHygieneLogEvent) => void,
): Promise<HygieneCandidate> {
  const imageUrl = candidate.thumbnailUrl || candidate.fullImageUrl;
  if (!imageUrl) return candidate;
  const cached = hashCache.get(imageUrl);
  const result = cached === undefined ? await computeDHashFromImageUrl(imageUrl) : cached;
  if (cached === undefined) hashCache.set(imageUrl, result);
  if (!result) {
    onLog?.({
      level: "warn",
      message: "visual hash failed but asset kept",
      data: { candidateId: candidate.candidateId, imageUrl },
    });
    return {
      ...candidate,
      hygieneWarnings: [...candidate.hygieneWarnings, "visual_hash_failed_kept_conservative"],
    };
  }
  onLog?.({
    message: "visual hash computed",
    data: { candidateId: candidate.candidateId, visualHash: result.hash },
  });
  return {
    ...candidate,
    visualHash: result.hash,
    qualityFlags: candidate.qualityFlags,
  };
}

export async function applyWikimediaAssetHygieneToGroup(input: {
  group: WikimediaAssetGroup;
  maxKeptAssetsPerPost?: number;
  computeVisualHashes?: boolean;
  hashCache?: Map<string, { hash: string; colorStats: ImageColorStats } | null>;
  onLog?: (event: WikimediaHygieneLogEvent) => void;
}): Promise<WikimediaAssetGroup> {
  const maxKept = input.maxKeptAssetsPerPost ?? WIKIMEDIA_MVP_MAX_KEPT_ASSETS_PER_POST;
  const hashCache = input.hashCache ?? new Map<string, { hash: string; colorStats: ImageColorStats } | null>();
  const originalAssetCount = input.group.assets.length;
  input.onLog?.({
    message: "asset hygiene started",
    data: { groupId: input.group.groupId, originalAssetCount },
  });

  let working = input.group.assets.map((asset) => defaultHygieneCandidate(asset));
  const removed: HygieneCandidate[] = [];
  const review: HygieneCandidate[] = [];

  if (input.computeVisualHashes !== false) {
    const enriched: HygieneCandidate[] = [];
    for (const candidate of working) {
      enriched.push(await enrichVisualHash(candidate, hashCache, input.onLog));
    }
    working = enriched;
  }

  const afterBadFilter: HygieneCandidate[] = [];
  for (const candidate of working) {
    const imageUrl = candidate.thumbnailUrl || candidate.fullImageUrl;
    const cached = imageUrl ? hashCache.get(imageUrl) : null;
    const colorStats = cached?.colorStats ?? null;
    const hygiene = evaluateBadAssetHygiene(candidate, colorStats);
    const merged: HygieneCandidate = {
      ...candidate,
      hygieneStatus: mergeHygieneStatus(candidate.hygieneStatus, hygiene.hygieneStatus),
      hygieneReasons: [...new Set([...candidate.hygieneReasons, ...hygiene.hygieneReasons])],
      hygieneWarnings: [...new Set([...candidate.hygieneWarnings, ...hygiene.hygieneWarnings])],
      qualityFlags: { ...candidate.qualityFlags, ...hygiene.qualityFlags },
    };
    if (merged.hygieneStatus === "REJECT") {
      removed.push(merged);
      for (const reason of merged.hygieneReasons) {
        if (reason.includes("panorama")) {
          input.onLog?.({ message: "panorama rejected", data: { groupId: input.group.groupId, candidateId: merged.candidateId, reason } });
        } else if (reason.includes("low_resolution") || reason.includes("missing_usable_image_url") || reason.includes("unreadable") || reason.includes("non_photo")) {
          input.onLog?.({ message: "low quality rejected", data: { groupId: input.group.groupId, candidateId: merged.candidateId, reason } });
        } else if (reason.includes("black_and_white") || reason.includes("filtered")) {
          input.onLog?.({ message: "black-and-white/filter rejected", data: { groupId: input.group.groupId, candidateId: merged.candidateId, reason } });
        }
      }
      continue;
    }
    if (merged.hygieneStatus === "REVIEW") review.push(merged);
    afterBadFilter.push(merged);
  }

  const exact = dedupeExactGroupAssets(afterBadFilter);
  for (const rejected of exact.removed) {
    removed.push(rejected);
    input.onLog?.({
      message: "exact duplicate removed",
      data: {
        groupId: input.group.groupId,
        rejectedCandidateId: rejected.candidateId,
        keptCandidateId: rejected.duplicateClusterId,
        reason: "exact_duplicate_same_source",
      },
    });
  }

  const near = dedupeNearGroupAssets(exact.kept);
  for (const rejected of near.removed) {
    removed.push(rejected);
    input.onLog?.({
      message: "near duplicate removed",
      data: {
        groupId: input.group.groupId,
        rejectedCandidateId: rejected.candidateId,
        keptCandidateId: rejected.duplicateClusterId,
        visualHashDistance: rejected.visualHashDistanceToPrimary,
        reason: rejected.hygieneReasons.find((r) => r.includes("near_duplicate")) ?? null,
      },
    });
  }
  for (const kept of near.kept) {
    if (kept.hygieneReasons.includes("possible_duplicate_kept_conservative")) {
      input.onLog?.({
        message: "possible duplicate kept conservatively",
        data: {
          groupId: input.group.groupId,
          candidateId: kept.candidateId,
          visualHashDistance: kept.visualHashDistanceToPrimary,
        },
      });
    }
  }

  const capped = applyPostAssetCap(near.kept, maxKept);
  removed.push(...capped.removed);

  let kept = capped.kept;
  const locatedKept = kept.filter((c) => c.hasRealAssetLocation);
  if (kept.length === 0 || (input.group.hasLocatedAsset && locatedKept.length === 0)) {
    input.onLog?.({
      message: "group asset counts before/after hygiene",
      data: {
        groupId: input.group.groupId,
        before: originalAssetCount,
        after: 0,
      },
    });
    return {
      ...input.group,
      assets: [],
      assetCount: 0,
      locatedAssetCount: 0,
      hasLocatedAsset: false,
      status: "REJECT",
      rejectionReasons: [...input.group.rejectionReasons, "all_assets_failed_hygiene"],
      reasoning: [...input.group.reasoning, "all_assets_failed_hygiene"],
      originalAssetCount,
      keptAssetCount: 0,
      rejectedAssetCount: removed.length,
      reviewAssetCount: review.length,
      rejectedDuplicateCount: removed.filter((a) => a.hygieneReasons.some(isDuplicateRejectReason)).length,
      rejectedHygieneCount: removed.filter((a) => a.hygieneReasons.some(isHygieneRejectReason)).length,
      removedAssets: removed.map(toRemovedSummary),
      reviewAssets: review.map(toRemovedSummary),
      assetHygieneSummary: buildHygieneSummary({ originalAssetCount, kept: [], removed, review }),
    };
  }

  kept = [...kept].sort(compareCandidateKeepPriority);
  const representative = kept.find((c) => c.candidateId === input.group.representativeAssetId) ?? kept[0]!;
  input.onLog?.({
    message: "group asset counts before/after hygiene",
    data: {
      groupId: input.group.groupId,
      before: originalAssetCount,
      after: kept.length,
    },
  });

  return {
    ...input.group,
    assets: kept,
    assetCount: kept.length,
    locatedAssetCount: kept.filter((c) => c.hasRealAssetLocation).length,
    hasLocatedAsset: kept.some((c) => c.hasRealAssetLocation),
    representativeAssetId: representative.candidateId,
    generatedTitle: representative.generatedTitle,
    status: kept.some((c) => c.hygieneStatus === "REVIEW") ? "REVIEW" : input.group.status,
    originalAssetCount,
    keptAssetCount: kept.length,
    rejectedAssetCount: removed.length,
    reviewAssetCount: review.length,
    rejectedDuplicateCount: removed.filter((a) => a.hygieneReasons.some(isDuplicateRejectReason)).length,
    rejectedHygieneCount: removed.filter((a) => a.hygieneReasons.some(isHygieneRejectReason)).length,
    removedAssets: removed.map(toRemovedSummary),
    reviewAssets: review.map(toRemovedSummary),
    assetHygieneSummary: buildHygieneSummary({ originalAssetCount, kept, removed, review }),
  };
}

export async function applyWikimediaAssetHygieneToGroups(input: {
  groups: WikimediaAssetGroup[];
  maxKeptAssetsPerPost?: number;
  computeVisualHashes?: boolean;
  onLog?: (event: WikimediaHygieneLogEvent) => void;
}): Promise<WikimediaAssetGroup[]> {
  const hashCache = new Map<string, { hash: string; colorStats: ImageColorStats } | null>();
  const out: WikimediaAssetGroup[] = [];
  for (const group of input.groups) {
    out.push(
      await applyWikimediaAssetHygieneToGroup({
        group,
        maxKeptAssetsPerPost: input.maxKeptAssetsPerPost,
        computeVisualHashes: input.computeVisualHashes,
        hashCache,
        onLog: input.onLog,
      }),
    );
  }
  return out;
}
