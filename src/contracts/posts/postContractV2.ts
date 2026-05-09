/**
 * Canonical Locava post contract V2 — single source of truth for what /posts/{postId} must look like
 * at every stage of the lifecycle (instant create -> async media processing -> live ready).
 *
 * Two distinct validation modes are exposed:
 *   - "instantPending" : the document allowed immediately after instant native finalize, BEFORE the
 *                        async video worker runs. Media may be processing, variants may be null,
 *                        readiness flags may be false, selectedReason may be original_unverified_*,
 *                        but the canonical block layout must already match v2 (schema, author, text,
 *                        classification, location, media, engagement, engagementPreview, compatibility,
 *                        lifecycle).
 *   - "completedReady" : the document required after a successful video processor / rebuild run.
 *                        media.status === "ready", assetsReady === true, faststartVerified === true,
 *                        playback fields point at verified fast-start AVC URLs, compatibility.photoLinks2/3
 *                        mirror the canonical playable startup URL (NOT the poster), poster fields are
 *                        image-only.
 *
 * The validator is intentionally additive — `validateMasterPostV2()` (the strict ready-only validator)
 * is still used inside the live writer; this contract is what the audit script and tests exercise.
 *
 * No reads/writes to Firestore happen from this file. It is pure.
 */

import type {
  MasterPostAssetV2,
  MasterPostV2,
} from "../master-post-v2.types.js";
import { classifyMediaUrl } from "../../lib/posts/master-post-v2/mediaUrlClassifier.js";
import { validateMasterPostV2 } from "../../lib/posts/master-post-v2/validateMasterPostV2.js";

export type PostContractMode = "instantPending" | "completedReady";

export type PostContractIssueSeverity = "error" | "warning";

export type PostContractIssue = {
  code: string;
  message: string;
  path?: string;
  severity: PostContractIssueSeverity;
  /** True when the issue blocks the requested mode. Warnings never block. */
  blocking: boolean;
};

export type PostContractCheckResult = {
  mode: PostContractMode;
  ok: boolean;
  errors: PostContractIssue[];
  warnings: PostContractIssue[];
  /** Quick sanity counts so callers / scripts can render summaries without re-walking the issues array. */
  summary: {
    requiredBlocksMissing: number;
    mediaErrors: number;
    compatibilityErrors: number;
    posterPlaybackMixupErrors: number;
  };
};

/** Required top-level blocks per the v2 contract — missing any of these is always an error. */
export const REQUIRED_TOP_LEVEL_BLOCKS = [
  "schema",
  "author",
  "text",
  "classification",
  "location",
  "media",
  "engagement",
  "engagementPreview",
  "compatibility",
  "lifecycle",
] as const;

export type RequiredTopLevelBlock = (typeof REQUIRED_TOP_LEVEL_BLOCKS)[number];

/** Allowed values of `lifecycle.status` for the instant/pending phase. */
const ALLOWED_PENDING_LIFECYCLE_STATUS = new Set(["processing", "active"]);

/**
 * `selectedReason` values that are allowed during the pending phase even though they indicate the
 * post is not yet using a verified fast-start AVC URL. These must NEVER appear in completedReady mode.
 */
const ALLOWED_PENDING_SELECTED_REASONS = new Set([
  "original_unverified_fallback",
  "fallback_original_or_main",
  "processing_fallback",
  "processing_pending",
]);

/** Verified `selectedReason` values that prove a canonical fast-start variant is selected. */
const VERIFIED_STARTUP_SELECTED_REASONS = new Set([
  "verified_startup_avc_faststart_720",
  "verified_startup_avc_faststart_540",
  "verified_startup_avc_faststart_1080",
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function isNonEmptyHttpString(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length > 0 && /^https?:\/\//i.test(t);
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Run the V2 post contract for either the instant-pending or completed-ready phase.
 * Pure / synchronous — safe to call inside hot paths and tests.
 */
export function checkPostContractV2(
  raw: unknown,
  mode: PostContractMode,
): PostContractCheckResult {
  const errors: PostContractIssue[] = [];
  const warnings: PostContractIssue[] = [];
  const post = asRecord(raw);
  if (!post) {
    errors.push({
      code: "post_not_object",
      message: "Post payload is not an object",
      severity: "error",
      blocking: true,
    });
    return finalize(mode, errors, warnings);
  }

  for (const block of REQUIRED_TOP_LEVEL_BLOCKS) {
    if (!asRecord((post as Record<string, unknown>)[block])) {
      errors.push({
        code: "missing_required_block",
        message: `Top-level block "${block}" is required by canonical post contract v2`,
        path: block,
        severity: "error",
        blocking: true,
      });
    }
  }

  const schema = asRecord(post.schema);
  if (schema) {
    if (schema.name !== "locava.post" || schema.version !== 2) {
      errors.push({
        code: "invalid_schema",
        message: 'schema must be { name: "locava.post", version: 2 }',
        path: "schema",
        severity: "error",
        blocking: true,
      });
    }
  }

  const lifecycle = asRecord(post.lifecycle);
  const lifecycleStatus = String(lifecycle?.status ?? "").toLowerCase();
  if (mode === "instantPending") {
    if (lifecycleStatus && !ALLOWED_PENDING_LIFECYCLE_STATUS.has(lifecycleStatus)) {
      // "failed" is allowed but produces a warning to surface processor regressions.
      if (lifecycleStatus === "failed") {
        warnings.push({
          code: "lifecycle_failed_in_pending",
          message:
            "lifecycle.status is failed during instant/pending phase — processor likely failed after instant publish",
          path: "lifecycle.status",
          severity: "warning",
          blocking: false,
        });
      } else {
        errors.push({
          code: "invalid_lifecycle_status_for_pending",
          message: `lifecycle.status="${lifecycleStatus}" not allowed in instant/pending mode`,
          path: "lifecycle.status",
          severity: "error",
          blocking: true,
        });
      }
    }
  } else if (mode === "completedReady") {
    if (lifecycleStatus !== "active") {
      errors.push({
        code: "completed_lifecycle_not_active",
        message: `lifecycle.status must be "active" for a completed-ready post (got "${lifecycleStatus}")`,
        path: "lifecycle.status",
        severity: "error",
        blocking: true,
      });
    }
  }

  const media = asRecord(post.media);
  const compatibility = asRecord(post.compatibility);
  const mediaStatus = String(media?.status ?? "").toLowerCase();

  if (media) {
    const assets = Array.isArray(media.assets)
      ? (media.assets as Array<Record<string, unknown>>)
      : [];

    if (mode === "completedReady") {
      if (mediaStatus !== "ready") {
        errors.push({
          code: "completed_media_status_not_ready",
          message: `media.status must be "ready" for a completed post (got "${mediaStatus}")`,
          path: "media.status",
          severity: "error",
          blocking: true,
        });
      }
      if (media.assetsReady !== true) {
        errors.push({
          code: "completed_assets_not_ready",
          message: "media.assetsReady must be true for a completed post",
          path: "media.assetsReady",
          severity: "error",
          blocking: true,
        });
      }
      if (media.instantPlaybackReady !== true) {
        errors.push({
          code: "completed_instant_playback_not_ready",
          message: "media.instantPlaybackReady must be true for a completed post",
          path: "media.instantPlaybackReady",
          severity: "error",
          blocking: true,
        });
      }
    }

    for (let i = 0; i < assets.length; i += 1) {
      const asset = assets[i] ?? {};
      const type = String(asset.type ?? "").toLowerCase();
      if (type === "video") {
        const v = asRecord(asset.video) ?? {};
        const playback = asRecord(v.playback) ?? {};
        const readiness = asRecord(v.readiness) ?? {};
        const variants = asRecord(v.variants);
        const path = `media.assets[${i}].video`;

        if (!isNonEmptyHttpString(v.originalUrl)) {
          errors.push({
            code: "video_missing_original_url",
            message: `${path}.originalUrl is required (HTTPS URL)`,
            path: `${path}.originalUrl`,
            severity: "error",
            blocking: true,
          });
        }
        const cover = asRecord(media.cover);
        const posterCandidate =
          trimStr(v.posterUrl) ||
          trimStr(v.posterHighUrl) ||
          trimStr(playback.posterUrl) ||
          trimStr(cover?.posterUrl) ||
          trimStr(cover?.thumbUrl);
        if (!isNonEmptyHttpString(posterCandidate)) {
          errors.push({
            code: "video_missing_poster_url",
            message: `${path}.posterUrl or media.cover poster equivalent must be set`,
            path: `${path}.posterUrl`,
            severity: "error",
            blocking: true,
          });
        } else if (classifyMediaUrl(posterCandidate) === "video") {
          errors.push({
            code: "poster_is_video_url",
            message: `${path}.posterUrl resolves to a video URL — posters must be images`,
            path: `${path}.posterUrl`,
            severity: "error",
            blocking: true,
          });
        }
        if (!playback || Object.keys(playback).length === 0) {
          errors.push({
            code: "video_missing_playback_block",
            message: `${path}.playback is required`,
            path: `${path}.playback`,
            severity: "error",
            blocking: true,
          });
        } else {
          if (!isNonEmptyHttpString(playback.fallbackUrl)) {
            errors.push({
              code: "video_missing_fallback_url",
              message: `${path}.playback.fallbackUrl is required (HTTPS URL)`,
              path: `${path}.playback.fallbackUrl`,
              severity: "error",
              blocking: true,
            });
          }
          if (!isNonEmptyHttpString(playback.posterUrl)) {
            errors.push({
              code: "video_playback_missing_poster_url",
              message: `${path}.playback.posterUrl is required (HTTPS image URL)`,
              path: `${path}.playback.posterUrl`,
              severity: "error",
              blocking: true,
            });
          } else if (classifyMediaUrl(String(playback.posterUrl)) === "video") {
            errors.push({
              code: "playback_poster_is_video",
              message: `${path}.playback.posterUrl resolves to a video URL — must be image`,
              path: `${path}.playback.posterUrl`,
              severity: "error",
              blocking: true,
            });
          }
        }
        if (variants === null) {
          // null is acceptable in pending mode but must exist (key present) per contract.
          if (!("variants" in v)) {
            errors.push({
              code: "video_variants_key_missing",
              message: `${path}.variants key must exist (may be null in pending phase)`,
              path: `${path}.variants`,
              severity: "error",
              blocking: true,
            });
          }
        }
        if (!readiness || Object.keys(readiness).length === 0) {
          errors.push({
            code: "video_missing_readiness_block",
            message: `${path}.readiness is required`,
            path: `${path}.readiness`,
            severity: "error",
            blocking: true,
          });
        }

        const selectedReason = trimStr(playback.selectedReason);
        const startupUrl = trimStr(playback.startupUrl);
        const primaryUrl = trimStr(playback.primaryUrl);
        const defaultUrl = trimStr(playback.defaultUrl);
        const fallbackUrl = trimStr(playback.fallbackUrl);

        if (mode === "instantPending") {
          if (
            selectedReason &&
            !ALLOWED_PENDING_SELECTED_REASONS.has(selectedReason) &&
            !VERIFIED_STARTUP_SELECTED_REASONS.has(selectedReason)
          ) {
            warnings.push({
              code: "unexpected_pending_selected_reason",
              message: `${path}.playback.selectedReason "${selectedReason}" not in allowed pending or verified set`,
              path: `${path}.playback.selectedReason`,
              severity: "warning",
              blocking: false,
            });
          }
        } else if (mode === "completedReady") {
          if (!VERIFIED_STARTUP_SELECTED_REASONS.has(selectedReason)) {
            errors.push({
              code: "completed_selected_reason_not_verified",
              message: `${path}.playback.selectedReason="${selectedReason || "<missing>"}" — completed posts must use a verified startup AVC selection`,
              path: `${path}.playback.selectedReason`,
              severity: "error",
              blocking: true,
            });
          }
          if (readiness.assetsReady !== true) {
            errors.push({
              code: "completed_video_assets_ready_false",
              message: `${path}.readiness.assetsReady must be true for a completed post`,
              path: `${path}.readiness.assetsReady`,
              severity: "error",
              blocking: true,
            });
          }
          if (readiness.faststartVerified !== true) {
            errors.push({
              code: "completed_faststart_not_verified",
              message: `${path}.readiness.faststartVerified must be true for a completed post (verified fast-start AVC)`,
              path: `${path}.readiness.faststartVerified`,
              severity: "error",
              blocking: true,
            });
          }
          if (readiness.instantPlaybackReady !== true) {
            errors.push({
              code: "completed_instant_playback_not_ready_video",
              message: `${path}.readiness.instantPlaybackReady must be true for a completed post`,
              path: `${path}.readiness.instantPlaybackReady`,
              severity: "error",
              blocking: true,
            });
          }
          for (const k of [
            "defaultUrl",
            "primaryUrl",
            "startupUrl",
          ] as const) {
            if (!isNonEmptyHttpString(playback[k])) {
              errors.push({
                code: "completed_playback_url_missing",
                message: `${path}.playback.${k} must be an HTTPS URL`,
                path: `${path}.playback.${k}`,
                severity: "error",
                blocking: true,
              });
            }
          }
          // Verified completed posts must select a fast-start AVC URL for default/primary/startup.
          const looksLikeFaststartAvc = (u: string): boolean =>
            /startup(540|720|1080)faststartavc/i.test(u.replace(/[^a-zA-Z0-9]/g, ""));
          if (defaultUrl && !looksLikeFaststartAvc(defaultUrl)) {
            warnings.push({
              code: "completed_default_url_not_faststart_avc",
              message: `${path}.playback.defaultUrl does not look like a startup/upgrade fast-start AVC URL`,
              path: `${path}.playback.defaultUrl`,
              severity: "warning",
              blocking: false,
            });
          }
          if (primaryUrl && !looksLikeFaststartAvc(primaryUrl)) {
            warnings.push({
              code: "completed_primary_url_not_faststart_avc",
              message: `${path}.playback.primaryUrl does not look like a startup/upgrade fast-start AVC URL`,
              path: `${path}.playback.primaryUrl`,
              severity: "warning",
              blocking: false,
            });
          }
          if (startupUrl && !looksLikeFaststartAvc(startupUrl)) {
            warnings.push({
              code: "completed_startup_url_not_faststart_avc",
              message: `${path}.playback.startupUrl does not look like a startup fast-start AVC URL`,
              path: `${path}.playback.startupUrl`,
              severity: "warning",
              blocking: false,
            });
          }
          if (fallbackUrl && !isNonEmptyHttpString(fallbackUrl)) {
            errors.push({
              code: "fallback_not_https",
              message: `${path}.playback.fallbackUrl must be HTTPS`,
              path: `${path}.playback.fallbackUrl`,
              severity: "error",
              blocking: true,
            });
          }
        }
      } else if (type === "image") {
        const img = asRecord(asset.image) ?? {};
        const primary =
          trimStr(img.displayUrl) ||
          trimStr(img.originalUrl) ||
          trimStr(img.thumbnailUrl);
        const path = `media.assets[${i}].image`;
        if (!isNonEmptyHttpString(primary)) {
          errors.push({
            code: "image_missing_display_url",
            message: `${path} must have at least one of displayUrl/originalUrl/thumbnailUrl as HTTPS`,
            path,
            severity: "error",
            blocking: true,
          });
        } else if (classifyMediaUrl(primary) === "video") {
          errors.push({
            code: "image_asset_is_video_url",
            message: `${path} display URL resolves to a video — image assets must be images`,
            path,
            severity: "error",
            blocking: true,
          });
        }
      }
    }

    // media.cover should never be a playable video.
    const cover = asRecord(media.cover);
    if (cover && isNonEmptyHttpString(cover.url) && classifyMediaUrl(String(cover.url)) === "video") {
      errors.push({
        code: "cover_url_is_video",
        message: "media.cover.url is a video URL — cover must point to image/poster",
        path: "media.cover.url",
        severity: "error",
        blocking: true,
      });
    }
  }

  if (compatibility) {
    const photoLink = trimStr(compatibility.photoLink);
    const displayPhoto = trimStr(compatibility.displayPhotoLink);
    const thumbUrl = trimStr(compatibility.thumbUrl);
    const posterUrl = trimStr(compatibility.posterUrl);
    const fallbackVideoUrl = trimStr(compatibility.fallbackVideoUrl);
    const photoLinks2 = trimStr(compatibility.photoLinks2);
    const photoLinks3 = trimStr(compatibility.photoLinks3);

    // Compatibility poster/thumb fields must be image-like (or empty).
    for (const [field, value] of [
      ["photoLink", photoLink],
      ["displayPhotoLink", displayPhoto],
      ["thumbUrl", thumbUrl],
      ["posterUrl", posterUrl],
    ] as const) {
      if (value && classifyMediaUrl(value) === "video") {
        errors.push({
          code: "compatibility_poster_field_is_video",
          message: `compatibility.${field} resolves to a video URL — poster fields must be image URLs`,
          path: `compatibility.${field}`,
          severity: "error",
          blocking: true,
        });
      }
    }

    // compatibility.fallbackVideoUrl is the legacy playable video. Should not be an image.
    if (
      fallbackVideoUrl &&
      classifyMediaUrl(fallbackVideoUrl) === "image"
    ) {
      errors.push({
        code: "compatibility_fallback_is_image",
        message: "compatibility.fallbackVideoUrl resolves to an image URL",
        path: "compatibility.fallbackVideoUrl",
        severity: "error",
        blocking: true,
      });
    }

    // photoLinks2 / photoLinks3 are dual-purpose legacy mirrors:
    //   - In instant/pending mode they may mirror the poster image (legacy posting behavior).
    //   - In completed mode they MUST mirror the canonical fast-start playable URL (NOT the poster).
    if (mode === "completedReady") {
      for (const [field, value] of [
        ["photoLinks2", photoLinks2],
        ["photoLinks3", photoLinks3],
      ] as const) {
        if (!value) {
          warnings.push({
            code: "compatibility_photo_links_missing_completed",
            message: `compatibility.${field} is empty — completed posts should mirror the canonical fast-start playable URL for legacy readers`,
            path: `compatibility.${field}`,
            severity: "warning",
            blocking: false,
          });
        } else if (classifyMediaUrl(value) === "image") {
          errors.push({
            code: "compatibility_photo_links_points_to_image",
            message: `compatibility.${field} resolves to an image URL on a completed post — must mirror the canonical fast-start playable URL`,
            path: `compatibility.${field}`,
            severity: "error",
            blocking: true,
          });
        }
      }
    }
  }

  return finalize(mode, errors, warnings);
}

function finalize(
  mode: PostContractMode,
  errors: PostContractIssue[],
  warnings: PostContractIssue[],
): PostContractCheckResult {
  const summary = {
    requiredBlocksMissing: errors.filter((e) => e.code === "missing_required_block").length,
    mediaErrors: errors.filter((e) => e.path?.startsWith("media")).length,
    compatibilityErrors: errors.filter((e) => e.path?.startsWith("compatibility")).length,
    posterPlaybackMixupErrors: errors.filter((e) =>
      [
        "poster_is_video_url",
        "image_asset_is_video_url",
        "cover_url_is_video",
        "compatibility_poster_field_is_video",
        "compatibility_fallback_is_image",
        "compatibility_photo_links_points_to_image",
        "playback_poster_is_video",
      ].includes(e.code),
    ).length,
  };
  return {
    mode,
    ok: errors.every((e) => !e.blocking),
    errors,
    warnings,
    summary,
  };
}

/**
 * Convenience: classifies a post's CURRENT structural state across both modes for the audit script.
 * Returns a stable label per the audit doc spec.
 */
export type PostContractClassification =
  | "valid_pending"
  | "valid_ready"
  | "invalid_contract"
  | "invalid_media_sync"
  | "invalid_compatibility_sync"
  | "processor_failed_after_generation"
  | "poster_playback_mismatch_risk"
  | "possible_hdr_poster_mismatch";

export function classifyPostForAudit(raw: unknown): {
  classification: PostContractClassification;
  pendingResult: PostContractCheckResult;
  readyResult: PostContractCheckResult;
  hints: string[];
} {
  const pending = checkPostContractV2(raw, "instantPending");
  const ready = checkPostContractV2(raw, "completedReady");
  const post = asRecord(raw) ?? {};
  const hints: string[] = [];

  // Detect "processor_failed_after_generation": failed status but variants exist.
  const videoProcessingStatus = String(post.videoProcessingStatus ?? "").toLowerCase();
  const playbackLab = asRecord(post.playbackLab);
  const labAssets = asRecord(playbackLab?.assets) ?? {};
  let anyGeneratedStartup720 = false;
  for (const k of Object.keys(labAssets)) {
    const node = asRecord(labAssets[k]);
    const gen = asRecord(node?.generated);
    if (typeof gen?.startup720FaststartAvc === "string" && gen.startup720FaststartAvc.startsWith("http")) {
      anyGeneratedStartup720 = true;
      break;
    }
  }
  if (videoProcessingStatus === "failed" && anyGeneratedStartup720) {
    hints.push("processor_failed_after_generation");
  }

  // Detect compatibility sync issues (already errors in completed mode).
  const compatibility = asRecord(post.compatibility);
  if (
    compatibility &&
    typeof compatibility.photoLinks2 === "string" &&
    classifyMediaUrl(compatibility.photoLinks2) === "image" &&
    ready.ok === false
  ) {
    hints.push("compatibility_photo_links_image_when_completed_expected");
  }

  // Possible HDR poster mismatch — declared by diagnostics block when present.
  const diagnostics = asRecord(post.mediaProcessingDiagnostics) ??
    asRecord(asRecord(post.processing)?.mediaProcessingDiagnostics);
  if (
    diagnostics &&
    diagnostics.sourceHdrDetected === true &&
    diagnostics.posterToneMappingApplied !== true
  ) {
    hints.push("possible_hdr_poster_mismatch");
  }

  let classification: PostContractClassification;
  if (ready.ok) {
    classification = "valid_ready";
  } else if (hints.includes("processor_failed_after_generation")) {
    classification = "processor_failed_after_generation";
  } else if (ready.summary.posterPlaybackMixupErrors > 0) {
    classification = "poster_playback_mismatch_risk";
  } else if (ready.summary.compatibilityErrors > 0 && pending.ok) {
    classification = "invalid_compatibility_sync";
  } else if (ready.summary.mediaErrors > 0 && pending.ok) {
    classification = "invalid_media_sync";
  } else if (pending.ok) {
    classification = "valid_pending";
  } else {
    classification = "invalid_contract";
  }
  if (hints.includes("possible_hdr_poster_mismatch") && classification === "valid_ready") {
    classification = "possible_hdr_poster_mismatch";
  }
  return { classification, pendingResult: pending, readyResult: ready, hints };
}

/**
 * Strict-mode bridge: when the caller already has a fully-parsed `MasterPostV2` canonical, run
 * the existing strict ready-validator AND the contract validator together. Useful for the live
 * writer to keep both validators aligned without duplicating logic.
 */
export function strictValidateMasterAndContract(
  canonical: MasterPostV2,
  raw: Record<string, unknown>,
): {
  master: ReturnType<typeof validateMasterPostV2>;
  contract: PostContractCheckResult;
} {
  return {
    master: validateMasterPostV2(canonical),
    contract: checkPostContractV2(raw, "completedReady"),
  };
}

/** Re-exported asset type for callers that want to assert per-asset. */
export type ContractAsset = MasterPostAssetV2;
