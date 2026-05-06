import type { EncodedVideoAssetResult, VideoEncodeOnlySelection } from "./video-post-encoding.pipeline.js";
import { shouldGenerate1080Ladder } from "./video-source-policy.js";

export type VariantPlan = {
  /** Must be verified before post is "ready" / rebuilder can skip. */
  requiredForReady: Array<"startup540FaststartAvc" | "startup720FaststartAvc">;
  optionalForReady: Array<"posterHigh" | "preview360Avc" | "main720Avc">;
  /**
   * Post-readiness work: only `upgrade1080FaststartAvc` is encoded in the deferred job.
   * We do **not** enqueue separate encodes for startup1080, main1080, main1080Avc, HLS, or HEVC.
   */
  deferred1080UpgradeOnly: "upgrade1080FaststartAvc";
  forbiddenSeparate1080Encodes: ReadonlyArray<
    "startup1080FaststartAvc" | "main1080" | "main1080Avc" | "hls" | "hevc"
  >;
};

export const DEFAULT_NATIVE_POST_READY_VARIANT_PLAN: VariantPlan = {
  requiredForReady: ["startup540FaststartAvc", "startup720FaststartAvc"],
  optionalForReady: ["posterHigh", "preview360Avc", "main720Avc"],
  deferred1080UpgradeOnly: "upgrade1080FaststartAvc",
  forbiddenSeparate1080Encodes: ["startup1080FaststartAvc", "main1080", "main1080Avc", "hls", "hevc"]
};

function trimUrl(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** True when poster URL looks like a real HTTPS image we can ship without lab posterHigh. */
export function hasConfidentPosterUrl(input: { poster?: unknown; variantPoster?: unknown }): boolean {
  const u = trimUrl(input.poster) || trimUrl(input.variantPoster);
  return u.length > 12 && /^https?:\/\//i.test(u) && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u);
}

export type NativePostReadyVariantInput = {
  includePreview360Avc?: boolean;
  includeMain720Avc?: boolean;
};

/** Fast-start readiness policy (540/720). 1080 is never required for `canSkipWrite`. */
export function getRequiredVariantsForPostReady(input: NativePostReadyVariantInput = {}): VariantPlan {
  void input;
  return {
    requiredForReady: [...DEFAULT_NATIVE_POST_READY_VARIANT_PLAN.requiredForReady],
    optionalForReady: [...DEFAULT_NATIVE_POST_READY_VARIANT_PLAN.optionalForReady],
    deferred1080UpgradeOnly: DEFAULT_NATIVE_POST_READY_VARIANT_PLAN.deferred1080UpgradeOnly,
    forbiddenSeparate1080Encodes: [...DEFAULT_NATIVE_POST_READY_VARIANT_PLAN.forbiddenSeparate1080Encodes]
  };
}

/** Single-variant encode selection for the deferred 1080 quality pass (non-blocking). */
export function buildDeferred1080UpgradeEncodeOnly(): VideoEncodeOnlySelection {
  return { upgrade1080FaststartAvc: true };
}

export type Deferred1080EligibilityInput = {
  width: number;
  height: number;
  durationSec: number;
  sizeBytes?: number | null;
  sourceBitrateKbps?: number | null;
};

/**
 * Whether we should enqueue the deferred **upgrade1080FaststartAvc** job (never blocks readiness).
 * Uses resolution gate + safe duration/size caps + optional bitrate floor to avoid fake upscale.
 */
export function evaluateDeferred1080UpgradeEligibility(
  input: Deferred1080EligibilityInput
): { eligible: boolean; skippedReason?: string } {
  if (!shouldGenerate1080Ladder(input.width, input.height)) {
    return { eligible: false, skippedReason: "source_below_1080_quality" };
  }
  const maxDur = Number(process.env.DEFERRED_1080_MAX_DURATION_SEC ?? 180);
  if (Number.isFinite(maxDur) && maxDur > 0 && input.durationSec > maxDur) {
    return { eligible: false, skippedReason: "source_duration_over_limit" };
  }
  const maxBytes = Number(process.env.DEFERRED_1080_MAX_SOURCE_BYTES ?? 500 * 1024 * 1024);
  if (
    input.sizeBytes != null &&
    Number.isFinite(maxBytes) &&
    maxBytes > 0 &&
    input.sizeBytes > maxBytes
  ) {
    return { eligible: false, skippedReason: "source_size_over_limit" };
  }
  const minBr = Number(process.env.DEFERRED_1080_MIN_VIDEO_BITRATE_KBPS ?? 2000);
  if (
    input.sourceBitrateKbps != null &&
    input.sourceBitrateKbps > 0 &&
    Number.isFinite(minBr) &&
    minBr > 0 &&
    input.sourceBitrateKbps < minBr
  ) {
    return { eligible: false, skippedReason: "source_bitrate_too_low_for_meaningful_1080" };
  }
  return { eligible: true };
}

export type Deferred1080UpgradePhase = "pending" | "encoding" | "complete" | "skipped" | "failed";

export type Deferred1080UpgradeDoc = {
  phase: Deferred1080UpgradePhase;
  /** Stable machine code for dashboards (maps to UI strings client-side). */
  uiStatus:
    | "1080_upgrade_pending"
    | "1080_upgrade_complete"
    | "1080_upgrade_skipped_source_too_low"
    | "1080_upgrade_failed";
  skippedReason?: string;
  lastError?: string;
  enqueuedAt?: string;
  completedAt?: string;
  taskName?: string;
  enqueueWarning?: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Admin-facing labels (point 7): faststart readiness vs deferred 1080 upgrade line. */
export function deferred1080AdminUiLabelsFromDoc(doc: Record<string, unknown> | null | undefined): {
  readyFaststart: string;
  upgrade1080: string;
} {
  const media = asRecord(doc?.media);
  const ms = String(media?.status ?? "").toLowerCase();
  const readyFaststart = ms === "ready" ? "READY FASTSTART" : "NOT READY FASTSTART";

  const meta = asRecord(doc?.deferred1080Upgrade);
  const ui = String(meta?.uiStatus ?? "").trim();
  const phase = String(meta?.phase ?? "").trim();
  const skipped = String(meta?.skippedReason ?? "").trim();

  let upgrade1080 = "1080 UPGRADE PENDING";
  if (!meta) upgrade1080 = "1080 UPGRADE PENDING";
  if (ui === "1080_upgrade_complete" || phase === "complete") upgrade1080 = "1080 UPGRADE COMPLETE";
  else if (ui === "1080_upgrade_skipped_source_too_low" || phase === "skipped") {
    upgrade1080 =
      skipped === "source_below_1080_quality"
        ? "1080 UPGRADE SKIPPED_SOURCE_TOO_LOW"
        : `1080 UPGRADE SKIPPED (${skipped || "policy"})`;
  } else if (ui === "1080_upgrade_failed" || phase === "failed") upgrade1080 = "1080 UPGRADE FAILED";

  return { readyFaststart, upgrade1080 };
}

/** Remove extra 1080 alias keys from encoder output so only `upgrade1080FaststartAvc` is promoted (same bytes on disk). */
export function strip1080AliasKeysFromEncodedResult(encoded: EncodedVideoAssetResult): EncodedVideoAssetResult {
  const variants = { ...encoded.variants } as Record<string, unknown>;
  delete variants.main1080;
  delete variants.main1080Avc;
  delete variants.startup1080FaststartAvc;
  const lab = { ...encoded.playbackLabGenerated } as Record<string, unknown>;
  delete lab.startup1080FaststartAvc;
  delete lab.startup1080Faststart;
  return {
    ...encoded,
    variants: variants as EncodedVideoAssetResult["variants"],
    playbackLabGenerated: lab as EncodedVideoAssetResult["playbackLabGenerated"]
  };
}

/**
 * Maps policy + per-asset gaps into `encodeAndUploadVideoAsset.encodeOnly` for the **faststart readiness** job only.
 */
export function buildNativeFastPathEncodeOnly(input: {
  plan: VariantPlan;
  needsPosterHigh: boolean;
  includePreview360Avc: boolean;
  includeMain720Avc: boolean;
  existingEncodedKeys: Set<string>;
}): VideoEncodeOnlySelection {
  const sel: VideoEncodeOnlySelection = {};
  for (const k of input.plan.requiredForReady) {
    if (!input.existingEncodedKeys.has(k)) {
      if (k === "startup540FaststartAvc") sel.startup540FaststartAvc = true;
      if (k === "startup720FaststartAvc") sel.startup720FaststartAvc = true;
    }
  }
  if (input.needsPosterHigh && !input.existingEncodedKeys.has("posterHigh")) {
    sel.posterHigh = true;
  }
  if (input.includePreview360Avc && !input.existingEncodedKeys.has("preview360Avc")) {
    sel.preview360Avc = true;
  }
  if (input.includeMain720Avc && !input.existingEncodedKeys.has("main720Avc")) {
    sel.main720Avc = true;
  }
  return sel;
}

/** Readiness validator does not require 1080 — always true for Master Post V2 contract. */
export function readyValidatorDoesNotRequire1080(): true {
  return true;
}

/**
 * Tracks deferred 1080 upgrade state for ops / UI (never blocks `evaluatePostRebuildReadiness.canSkipWrite`).
 */
export function evaluateDeferred1080QualityTracking(doc: Record<string, unknown> | null | undefined): {
  deferred1080: Deferred1080UpgradePhase | "none";
  uiStatus: Deferred1080UpgradeDoc["uiStatus"] | "none";
} {
  if (!doc) return { deferred1080: "none", uiStatus: "none" };
  const m = doc.deferred1080Upgrade;
  if (!m || typeof m !== "object") return { deferred1080: "none", uiStatus: "none" };
  const o = m as Record<string, unknown>;
  const phaseRaw = String(o.phase ?? "").trim();
  const uiStatus = String(o.uiStatus ?? "none") as Deferred1080UpgradeDoc["uiStatus"] | "none";
  if (!phaseRaw || phaseRaw === "none") return { deferred1080: "none", uiStatus: "none" };
  return { deferred1080: phaseRaw as Deferred1080UpgradePhase, uiStatus };
}
