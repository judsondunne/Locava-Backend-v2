import type { MasterPostV2 } from "../../contracts/master-post-v2.types.js";
import { isCompactCanonicalPostV2 } from "../../lib/posts/master-post-v2/compactCanonicalPostV2.js";
import { mediaUrlSanityCheckOnSavedCompactPost } from "../../lib/posts/master-post-v2/savedCompactPostHealth.js";
import { validateMasterPostV2 } from "../../lib/posts/master-post-v2/validateMasterPostV2.js";

export type ReelPublishValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  jsonSerializable: boolean;
};

function walkNoBadValues(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) {
    errors.push(`undefined_at:${path}`);
    return;
  }
  if (typeof value === "number" && Number.isNaN(value)) {
    errors.push(`nan_at:${path}`);
    return;
  }
  if (value instanceof Date && Number.isNaN(value.getTime())) {
    errors.push(`invalid_date_at:${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkNoBadValues(v, `${path}[${i}]`, errors));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walkNoBadValues(v, `${path}.${k}`, errors);
    }
  }
}

export function assertJsonSerializable(value: unknown): { ok: true } | { ok: false; error: string } {
  try {
    JSON.stringify(value);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function validatePublishedReelPostDoc(input: {
  postId: string;
  /** Compact live doc as returned by `compactCanonicalPostForLiveWrite.livePost` */
  compactLive: Record<string, unknown>;
  canonical: MasterPostV2;
}): ReelPublishValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const ser = assertJsonSerializable(input.compactLive);
  if (!ser.ok) errors.push(`json_serialize_failed:${ser.error}`);

  walkNoBadValues(input.compactLive, "live", errors);

  if (String(input.compactLive.id ?? "") !== input.postId) {
    errors.push("live_id_mismatch");
  }

  const mv = validateMasterPostV2(input.canonical);
  for (const e of mv.blockingErrors) {
    errors.push(`canonical:${e.code ?? "err"}:${e.message ?? ""}`);
  }
  for (const w of mv.warnings) {
    warnings.push(`canonical_warn:${w.code ?? "warn"}:${w.message ?? ""}`);
  }

  const compactCheck = isCompactCanonicalPostV2(input.compactLive);
  if (!compactCheck.ok) {
    errors.push(`compact_check_failed:${(compactCheck.reasons ?? compactCheck.missingRequiredPaths ?? []).join(",")}`);
  }

  const mediaSanity = mediaUrlSanityCheckOnSavedCompactPost(input.compactLive);
  if (!mediaSanity.ok) {
    errors.push(`media_url_sanity:${mediaSanity.issues.join(",")}`);
  }

  const media = input.canonical.media;
  if (media.assetCount !== 1) errors.push("media_asset_count_must_be_1");
  if (media.assets.length !== 1) errors.push("media_assets_length_must_be_1");
  const a0 = media.assets[0];
  if (!a0 || a0.type !== "video") errors.push("first_asset_must_be_video");

  const cover = media.cover;
  if (a0 && cover.posterUrl && a0.type === "video") {
    const vUrl = a0.video?.playback?.defaultUrl ?? "";
    if (vUrl && cover.posterUrl === vUrl) {
      errors.push("cover_poster_must_not_equal_video_playback_url");
    }
  }

  if (input.canonical.classification.reel !== true) errors.push("classification_reel_must_be_true");
  if (input.canonical.classification.mediaKind !== "video") errors.push("classification_media_kind_video");

  const liveStr = JSON.stringify(input.compactLive);
  if (liveStr.includes("/color-v2/")) {
    const v0 = a0?.type === "video" ? (a0.video as Record<string, unknown> | undefined) : undefined;
    const cp = v0?.colorPipeline;
    if (!cp || typeof cp !== "object") {
      errors.push("color_v2_urls_require_video_colorPipeline_metadata");
    }
  }

  return { ok: errors.length === 0, errors, warnings, jsonSerializable: ser.ok };
}
