/**
 * Post Rebuilder / migration failure taxonomy — shared between debug routes and tests.
 * Does not loosen validators; only classifies outcomes for routing, exports, and UI.
 */

import { analyzeVideoFastStartNeeds } from "./videoFastStartRepair.js";

export type PostRebuildFailureClass =
  | "missing_source_video"
  | "source_video_unreachable"
  | "external_or_expiring_source_url"
  | "poster_and_video_source_unreachable"
  | "unresolved_video_variants"
  | "image_missing_display_url"
  | "deleted_or_unsupported_media"
  | "normalization_bug"
  | "unknown";

export type ClassifyPostRebuildFailureInput = {
  rawPost: Record<string, unknown> | null | undefined;
  /** Canonical-shaped post after normalize (optional). */
  normalizedPost?: Record<string, unknown> | null | undefined;
  validation: { blockingErrors?: Array<{ code?: string; message?: string; path?: string }> } | null;
  /** Result of `isCompactCanonicalPostV2` / `evaluatePostRebuildReadiness` on the **live** doc (precheck). */
  compactCheck: Record<string, unknown> | null | undefined;
  context: {
    lastStep?: string;
    status?: string;
    generationFailureDetail?: Record<string, unknown> | null;
    analyze?: { missingSourceCount?: number; needsGenerationCount?: number } | null;
  };
};

export type PostRebuildFailureClassification = {
  failureClass: PostRebuildFailureClass;
  isRepairable: boolean;
  shouldAttemptFaststartRepair: boolean;
  shouldFallbackToOriginalIfVerifiedFaststart: boolean;
  shouldQuarantine: boolean;
  reasons: string[];
  sourceUrls: string[];
  assetIds: string[];
  suggestedNextAction: string;
  /** True when live precheck said no media repair but strict generation/validation still failed (should never happen after readiness fix). */
  precheckValidationContradiction: boolean;
  /** Optimize-and-write terminal status (for exports). */
  optimizeStatus?: string | null;
  /** Last pipeline stage label when classification was built. */
  lastStep?: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const EXTERNAL_SOURCE_HOST_RE =
  /instagram\.com|cdninstagram\.com|fbcdn\.net|facebook\.com|tiktokcdn\.com|twimg\.com/i;

function isExternalOrExpiringHost(url: string): boolean {
  try {
    const u = new URL(url);
    return EXTERNAL_SOURCE_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

/** Blocking errors that imply strict video ladder / playback work still required after repair. */
function blockingLooksLikeStrictVideoGap(
  blocking: Array<{ code?: string; message?: string; path?: string }>
): boolean {
  return blocking.some((e) => {
    const t = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.path ?? ""}`;
    return /strict_mode_blocked_unresolved_video_variants|unresolved_video_variants_after_repair|startup540|startup720|faststart|video_variant|playback|primary_url|poster|cover|instantPlayback|fallback_original_or_main|original_unverified_fallback|no_valid_video/i.test(
      t
    );
  });
}

function collectUrlsFromGenerationDetail(detail: Record<string, unknown> | null | undefined): string[] {
  if (!detail) return [];
  const per = Array.isArray(detail.perAsset) ? (detail.perAsset as unknown[]) : [];
  const urls: string[] = [];
  for (const row of per) {
    const o = asRecord(row);
    const u = trimStr(o?.sourceUrl);
    if (u) urls.push(u);
  }
  return [...new Set(urls)];
}

function collectAssetIdsFromGenerationDetail(detail: Record<string, unknown> | null | undefined): string[] {
  if (!detail) return [];
  const per = Array.isArray(detail.perAsset) ? (detail.perAsset as unknown[]) : [];
  const ids: string[] = [];
  for (const row of per) {
    const o = asRecord(row);
    const id = trimStr(o?.assetId);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

function isLifecycleDeleted(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw) return false;
  const lc = asRecord(raw.lifecycle) ?? {};
  if (raw.deleted === true || raw.isDeleted === true) return true;
  if (lc.isDeleted === true) return true;
  return String(lc.status ?? "").toLowerCase() === "deleted";
}

/**
 * Classify a failed optimize/write or validation outcome for dashboards, exports, and retry routing.
 */
export function classifyPostRebuildFailure(input: ClassifyPostRebuildFailureInput): PostRebuildFailureClassification {
  const reasons: string[] = [];
  const raw = input.rawPost ?? null;
  const validation = input.validation;
  const compact = input.compactCheck ?? null;
  const ctx = input.context ?? {};
  const detail = asRecord(ctx.generationFailureDetail);
  const blocking = validation?.blockingErrors ?? [];

  const mediaNeedsRepair = compact?.mediaNeedsRepair === true;
  const videoNeedsFaststart = compact?.videoNeedsFaststart === true;
  const strictGen =
    String(detail?.reason ?? "") === "strict_mode_blocked_unresolved_video_variants_after_repair" ||
    String(detail?.reason ?? "") === "unresolved_video_variants_after_repair" ||
    ctx.status === "generation_failed";
  const precheckValidationContradiction =
    !mediaNeedsRepair &&
    !videoNeedsFaststart &&
    (strictGen || (blocking.length > 0 && blockingLooksLikeStrictVideoGap(blocking)));

  if (precheckValidationContradiction) {
    reasons.push("precheck_validation_contradiction:compact_ok_without_media_repair_but_strict_generation_failed");
  }

  if (isLifecycleDeleted(raw ?? undefined)) {
    return {
      failureClass: "deleted_or_unsupported_media",
      isRepairable: false,
      shouldAttemptFaststartRepair: false,
      shouldFallbackToOriginalIfVerifiedFaststart: false,
      shouldQuarantine: false,
      reasons: [...reasons, "lifecycle_deleted"],
      sourceUrls: [],
      assetIds: [],
      suggestedNextAction: "Preserve deleted lifecycle; do not run video repair unless explicitly overriding in a dedicated repair mode.",
      precheckValidationContradiction
    };
  }

  for (const err of blocking) {
    const code = String(err?.code ?? "");
    const msg = String(err?.message ?? "");
    if (code || msg) reasons.push(`validation:${code || "unknown"}:${msg.slice(0, 200)}`);
  }

  const postId = trimStr(raw?.id ?? raw?.postId) || "unknown";
  const analyzeResult =
    ctx.analyze ??
    (raw ? analyzeVideoFastStartNeeds(raw as Record<string, unknown>, { postId }) : null);

  const sourceUrlsFromDetail = collectUrlsFromGenerationDetail(detail);
  const assetIdsFromDetail = collectAssetIdsFromGenerationDetail(detail);

  const missingSourceCount = analyzeResult?.missingSourceCount ?? 0;
  const missingSource = missingSourceCount > 0;
  const detailMissing =
    Array.isArray(detail?.perAsset) &&
    (detail.perAsset as unknown[]).some((row) => asRecord(row)?.sourceUrlState === "missing");

  if (
    strictGen ||
    blocking.some((e) =>
      /video_variant|video_missing|playback|startup|faststart|primary_url|preview_missing/i.test(
        String(e?.code ?? e?.message ?? "")
      )
    )
  ) {
    const externalHit = sourceUrlsFromDetail.some((u) => isExternalOrExpiringHost(u));
    if (externalHit && !process.env.POST_REBUILDER_DURABLE_SOURCE_COPY?.trim()) {
      return {
        failureClass: "external_or_expiring_source_url",
        isRepairable: Boolean(process.env.POST_REBUILDER_ALLOW_EXTERNAL_SOURCE_REPAIR?.trim()),
        shouldAttemptFaststartRepair: false,
        shouldFallbackToOriginalIfVerifiedFaststart: false,
        shouldQuarantine: true,
        reasons: [...reasons, "source_host_not_durable_wasabi"],
        sourceUrls: sourceUrlsFromDetail,
        assetIds: assetIdsFromDetail,
        suggestedNextAction:
          "Ingest or replace with durable Wasabi-hosted media, or set POST_REBUILDER_DURABLE_SOURCE_COPY with a safe copy pipeline. Do not count as migrated while source is external-only.",
        precheckValidationContradiction
      };
    }
    if (missingSource || detailMissing) {
      return {
        failureClass: "missing_source_video",
        isRepairable: false,
        shouldAttemptFaststartRepair: false,
        shouldFallbackToOriginalIfVerifiedFaststart: false,
        shouldQuarantine: true,
        reasons: [...reasons, "missing_original_or_source_url"],
        sourceUrls: sourceUrlsFromDetail,
        assetIds: assetIdsFromDetail,
        suggestedNextAction:
          "Restore original video URL from backup or client re-upload; encoder cannot run without a reachable source.",
        precheckValidationContradiction
      };
    }

    const unreachable =
      blocking.some((e) => /unreachable|download_failed|403|404|410/i.test(String(e?.message ?? e?.code ?? ""))) ||
      (Array.isArray(detail?.generationErrorsDistinct) &&
        (detail.generationErrorsDistinct as string[]).some((s) => /download_failed|403|404|410/i.test(String(s))));

    if (unreachable) {
      return {
        failureClass: "source_video_unreachable",
        isRepairable: false,
        shouldAttemptFaststartRepair: false,
        shouldFallbackToOriginalIfVerifiedFaststart: false,
        shouldQuarantine: true,
        reasons: [...reasons, "source_url_not_fetchable"],
        sourceUrls: sourceUrlsFromDetail,
        assetIds: assetIdsFromDetail,
        suggestedNextAction: "Fix CDN permissions, restore URL from backup, or replace asset; do not re-encode until HEAD/GET succeeds.",
        precheckValidationContradiction
      };
    }

    return {
      failureClass: "unresolved_video_variants",
      isRepairable: true,
      shouldAttemptFaststartRepair: true,
      shouldFallbackToOriginalIfVerifiedFaststart: false,
      shouldQuarantine: false,
      reasons: [...reasons, "strict_or_validation_blocked_video_ladder"],
      sourceUrls: sourceUrlsFromDetail,
      assetIds: assetIdsFromDetail,
      suggestedNextAction:
        "Retry Optimize + Write with fast-start repair (540/720 + poster if needed). If this repeats, inspect generationFailureDetail per-asset needs.",
      precheckValidationContradiction
    };
  }

  if (blocking.some((e) => /image|displayUrl|thumbnail/i.test(String(e?.code ?? e?.message ?? "")))) {
    return {
      failureClass: "image_missing_display_url",
      isRepairable: true,
      shouldAttemptFaststartRepair: false,
      shouldFallbackToOriginalIfVerifiedFaststart: false,
      shouldQuarantine: false,
      reasons: [...reasons, "image_validation"],
      sourceUrls: [],
      assetIds: [],
      suggestedNextAction: "Repair image displayUrl/thumbnail from canonical rules or raw legacy image fields, then re-preview.",
      precheckValidationContradiction
    };
  }

  if (blocking.some((e) => /normalize|normalization/i.test(String(e?.message ?? e?.code ?? "")))) {
    return {
      failureClass: "normalization_bug",
      isRepairable: false,
      shouldAttemptFaststartRepair: false,
      shouldFallbackToOriginalIfVerifiedFaststart: false,
      shouldQuarantine: true,
      reasons: [...reasons, "normalization_errors"],
      sourceUrls: [],
      assetIds: [],
      suggestedNextAction: "Inspect normalizeMasterPostV2 warnings/errors; likely schema or legacy merge bug — escalate before bulk migration.",
      precheckValidationContradiction
    };
  }

  return {
    failureClass: "unknown",
    isRepairable: false,
    shouldAttemptFaststartRepair: false,
    shouldFallbackToOriginalIfVerifiedFaststart: false,
    shouldQuarantine: false,
    reasons: reasons.length ? reasons : ["unclassified_failure"],
    sourceUrls: sourceUrlsFromDetail,
    assetIds: assetIdsFromDetail,
    suggestedNextAction: "Inspect lastStep, validation.blockingErrors, and generationFailureDetail in diagnostics export.",
    precheckValidationContradiction
  };
}
