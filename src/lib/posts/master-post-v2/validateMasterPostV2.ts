import type {
  CanonicalizationError,
  CanonicalizationWarning,
  MasterPostV2,
  MasterPostValidationStatusV2,
  PostEngagementSourceAuditV2
} from "../../../contracts/master-post-v2.types.js";
import { classifyMediaUrl } from "./mediaUrlClassifier.js";

export type MasterPostValidationResult = {
  status: MasterPostValidationStatusV2;
  blockingErrors: CanonicalizationError[];
  warnings: CanonicalizationWarning[];
};

const isValidUrl = (value: string | null): boolean => Boolean(value && /^https?:\/\//i.test(value));

function firstValidHttpUrl(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const t = value.trim();
    if (isValidUrl(t)) return t;
  }
  return null;
}

export function validateMasterPostV2(
  post: MasterPostV2,
  options?: { engagementSourceAudit?: PostEngagementSourceAuditV2 | null }
): MasterPostValidationResult {
  const warnings: CanonicalizationWarning[] = [];
  const blockingErrors: CanonicalizationError[] = [];

  if (post.schema.version !== 2 || post.schema.name !== "locava.post") {
    blockingErrors.push({
      code: "invalid_schema_version",
      message: "schema must be locava.post version 2",
      path: "schema",
      blocking: true
    });
  }

  if (!["public", "friends", "private", "unknown"].includes(post.classification.visibility)) {
    blockingErrors.push({
      code: "invalid_visibility_enum",
      message: "classification.visibility must be strict enum",
      path: "classification.visibility",
      blocking: true
    });
  }
  if (post.classification.source === (post.classification.mediaKind as unknown as "user")) {
    warnings.push({
      code: "source_equals_media_kind",
      message: "classification.source should represent origin, not media kind",
      path: "classification.source"
    });
  }

  if (!post.id) {
    blockingErrors.push({ code: "missing_id", message: "Post id is required", path: "id", blocking: true });
  }
  if (!post.lifecycle.status) {
    blockingErrors.push({
      code: "missing_lifecycle_status",
      message: "Lifecycle status is required",
      path: "lifecycle.status",
      blocking: true
    });
  }
  if (!post.lifecycle.createdAt && !post.lifecycle.createdAtMs) {
    blockingErrors.push({
      code: "missing_created_at",
      message: "createdAt or createdAtMs is required",
      path: "lifecycle.createdAt",
      blocking: true
    });
  }

  if (post.lifecycle.createdAt && post.lifecycle.createdAtMs == null) {
    warnings.push({
      code: "lifecycle_created_at_iso_without_ms",
      message: "lifecycle.createdAt is set but lifecycle.createdAtMs is null — canonical should carry epoch ms for sorting/clients",
      path: "lifecycle.createdAtMs"
    });
  }

  if (post.audit.normalizationDebug?.lifecycleCreatedAtMsMissingDespiteRawFields) {
    warnings.push({
      code: "lifecycle_created_at_ms_not_derived_from_raw",
      message: "Raw post had timestamp-related fields but lifecycle.createdAtMs could not be derived",
      path: "lifecycle.createdAtMs"
    });
  }

  if (post.audit.normalizationDebug?.rawHasLetterboxButCoverGradientMissing) {
    warnings.push({
      code: "letterbox_cover_gradient_missing_from_raw",
      message: "Raw post had letterbox gradients but canonical media.cover.gradient is missing",
      path: "media.cover.gradient"
    });
  }
  if (post.audit.normalizationDebug?.rawHasLetterboxButAllAssetGradientsMissing) {
    warnings.push({
      code: "letterbox_asset_gradients_missing_from_raw",
      message: "Raw post had letterbox gradients but canonical media.assets[].presentation.letterboxGradient is missing",
      path: "media.assets.presentation.letterboxGradient"
    });
  }

  if (post.location.coordinates.lat != null && (post.location.coordinates.lat < -90 || post.location.coordinates.lat > 90)) {
    blockingErrors.push({
      code: "invalid_latitude",
      message: "Latitude must be between -90 and 90",
      path: "location.coordinates.lat",
      blocking: true
    });
  }
  if (post.location.coordinates.lng != null && (post.location.coordinates.lng < -180 || post.location.coordinates.lng > 180)) {
    blockingErrors.push({
      code: "invalid_longitude",
      message: "Longitude must be between -180 and 180",
      path: "location.coordinates.lng",
      blocking: true
    });
  }

  if (typeof post.media.assetsReady !== "boolean") {
    blockingErrors.push({
      code: "media_assets_ready_missing",
      message: "media.assetsReady must exist as boolean",
      path: "media.assetsReady",
      blocking: true
    });
  }
  if (typeof post.media.instantPlaybackReady !== "boolean") {
    blockingErrors.push({
      code: "media_instant_playback_ready_missing",
      message: "media.instantPlaybackReady must exist as boolean",
      path: "media.instantPlaybackReady",
      blocking: true
    });
  }
  if (typeof post.media.rawAssetCount !== "number") {
    blockingErrors.push({
      code: "media_raw_asset_count_missing",
      message: "media.rawAssetCount must exist as number",
      path: "media.rawAssetCount",
      blocking: true
    });
  }
  if (post.media.hasMultipleAssets !== (post.media.assetCount > 1)) {
    blockingErrors.push({
      code: "media_has_multiple_assets_mismatch",
      message: "media.hasMultipleAssets must match assetCount > 1",
      path: "media.hasMultipleAssets",
      blocking: true
    });
  }
  if (post.media.assetCount > 0 && !post.media.primaryAssetId) {
    blockingErrors.push({
      code: "media_primary_asset_missing",
      message: "media.primaryAssetId must exist when assets are present",
      path: "media.primaryAssetId",
      blocking: true
    });
  }

  if (post.media.assetCount !== post.media.assets.length) {
    blockingErrors.push({
      code: "asset_count_mismatch",
      message: "media.assetCount must equal media.assets.length",
      path: "media.assetCount",
      blocking: true
    });
  }

  const ids = new Set<string>();
  const primaryUrls = new Map<string, string>();
  for (const asset of post.media.assets) {
    if (ids.has(asset.id)) {
      blockingErrors.push({
        code: "duplicate_asset_id",
        message: `Duplicate asset id: ${asset.id}`,
        path: "media.assets",
        blocking: true
      });
    }
    ids.add(asset.id);

    if (
      !asset.source ||
      typeof asset.source !== "object" ||
      !Array.isArray(asset.source.primarySources) ||
      !Array.isArray(asset.source.legacySourcesConsidered)
    ) {
      blockingErrors.push({
        code: "asset_source_invalid",
        message: `Asset ${asset.id} source must be structured object`,
        path: "media.assets.source",
        blocking: true
      });
    }

    if (asset.type === "image") {
      const imagePrimary = firstValidHttpUrl(
        asset.image?.displayUrl,
        asset.image?.originalUrl,
        asset.image?.thumbnailUrl
      );
      if (!imagePrimary) {
        blockingErrors.push({
          code: "image_missing_display_url",
          message: `Image asset ${asset.id} is missing a usable image URL (displayUrl/originalUrl/thumbnailUrl)`,
          path: "media.assets.image.displayUrl",
          blocking: true
        });
      }
      const imageKind = classifyMediaUrl(imagePrimary);
      if (imageKind === "video") {
        blockingErrors.push({
          code: "image_asset_has_video_url",
          message: `Image asset ${asset.id} points to a video URL`,
          path: "media.assets.image.displayUrl",
          blocking: true
        });
      }
    } else if (asset.type === "video") {
      const primary = asset.video?.playback.primaryUrl ?? null;
      if (!isValidUrl(primary)) {
        blockingErrors.push({
          code: "video_missing_primary_url",
          message: `Video asset ${asset.id} is missing playback.primaryUrl`,
          path: "media.assets.video.playback.primaryUrl",
          blocking: true
        });
      }
      const preview = asset.video?.playback.previewUrl ?? null;
      const startup = asset.video?.playback.startupUrl ?? null;
      const upgrade = asset.video?.playback.upgradeUrl ?? null;
      if (primary && preview && primary === preview && startup && startup !== preview) {
        blockingErrors.push({
          code: "video_preview_as_primary",
          message: `Video asset ${asset.id} uses preview as primary while better variant exists`,
          path: "media.assets.video.playback.primaryUrl",
          blocking: true
        });
      }
      if (primary && startup && upgrade && primary === startup && /startup720/i.test(startup) && /upgrade1080/i.test(upgrade) && asset.video?.readiness.faststartVerified === true) {
        warnings.push({
          code: "primary_uses_startup_while_upgrade_exists",
          message: `Video asset ${asset.id} primaryUrl equals startup while verified upgrade exists`,
          path: "media.assets.video.playback.primaryUrl"
        });
      }
      if (!preview && ((asset.video?.variants?.preview360Avc as string | null) || (asset.video?.variants?.preview360 as string | null))) {
        warnings.push({
          code: "preview_missing_while_variant_exists",
          message: `Video asset ${asset.id} previewUrl is null while preview variant exists`,
          path: "media.assets.video.playback.previewUrl"
        });
      }
      if (primary) {
        const owner = primaryUrls.get(primary);
        if (owner && owner !== asset.id) {
          warnings.push({
            code: "duplicate_video_primary_url",
            message: `Video playback URL reused by ${owner} and ${asset.id}`,
            path: "media.assets.video.playback.primaryUrl"
          });
        } else {
          primaryUrls.set(primary, asset.id);
        }
      }
    }
  }

  if (post.media.assetCount > 0 && post.media.primaryAssetId && !ids.has(post.media.primaryAssetId)) {
    blockingErrors.push({
      code: "media_primary_asset_not_found",
      message: "media.primaryAssetId must point to an existing asset id",
      path: "media.primaryAssetId",
      blocking: true
    });
  }
  if (post.media.coverAssetId && !ids.has(post.media.coverAssetId)) {
    blockingErrors.push({
      code: "media_cover_asset_not_found",
      message: "media.coverAssetId must point to an existing asset id",
      path: "media.coverAssetId",
      blocking: true
    });
  }

  if (post.classification.mediaKind === "image" || post.classification.mediaKind === "video" || post.classification.mediaKind === "mixed") {
    const coverEffective = firstValidHttpUrl(
      post.media.cover.url,
      post.media.cover.thumbUrl,
      post.media.cover.posterUrl,
      post.compatibility.photoLink,
      post.compatibility.displayPhotoLink,
      post.compatibility.thumbUrl
    );
    if (!coverEffective) {
      blockingErrors.push({
        code: "missing_cover_url",
        message: "Visual post requires media.cover.url (or equivalent thumb/poster/compatibility mirror)",
        path: "media.cover.url",
        blocking: true
      });
    }
  }

  const countFields = [post.engagement.likeCount, post.engagement.commentCount, post.engagement.saveCount, post.engagement.shareCount, post.engagement.viewCount];
  if (countFields.some((v) => typeof v !== "number" || Number.isNaN(v))) {
    blockingErrors.push({
      code: "invalid_engagement_counts",
      message: "Engagement counts must be finite numbers",
      path: "engagement",
      blocking: true
    });
  }

  if (post.lifecycle.isDeleted && post.lifecycle.status !== "deleted") {
    warnings.push({
      code: "deleted_flag_mismatch",
      message: "lifecycle.isDeleted=true but lifecycle.status is not deleted",
      path: "lifecycle"
    });
  }

  const imageCount = post.media.assets.filter((asset) => asset.type === "image").length;
  const videoCount = post.media.assets.filter((asset) => asset.type === "video").length;
  if (videoCount > 0 && imageCount === 0 && post.classification.mediaKind !== "video") {
    blockingErrors.push({
      code: "single_video_misclassified",
      message: "Post has only video assets but mediaKind is not video",
      path: "classification.mediaKind",
      blocking: true
    });
  }

  const videoOriginalMap = new Map<string, string>();
  const stableVariantKeys = new Set([
    "poster",
    "posterHigh",
    "preview360",
    "preview360Avc",
    "main720",
    "main720Avc",
    "main1080",
    "main1080Avc",
    "startup540Faststart",
    "startup540FaststartAvc",
    "startup720Faststart",
    "startup720FaststartAvc",
    "startup1080Faststart",
    "startup1080FaststartAvc",
    "upgrade1080Faststart",
    "upgrade1080FaststartAvc",
    "hls",
    "hlsAvcMaster"
  ]);
  for (const asset of post.media.assets.filter((asset) => asset.type === "video")) {
    const nonPlayableVariantKeys = Object.keys(asset.video?.variants ?? {}).filter((key) =>
      ["diagnosticsJson", "photoLinks2", "photoLinks3"].includes(key) || key.startsWith("legacy.")
    );
    if (nonPlayableVariantKeys.length > 0) {
      blockingErrors.push({
        code: "video_variants_contains_debug_keys",
        message: `Video asset ${asset.id} contains debug/legacy keys in variants`,
        path: "media.assets.video.variants",
        blocking: true
      });
    }
    const variantKeys = Object.keys(asset.video?.variants ?? {});
    for (const key of variantKeys) {
      if (!stableVariantKeys.has(key)) {
        blockingErrors.push({
          code: "video_variant_illegal_key",
          message: `Video asset ${asset.id} contains illegal variant key ${key}`,
          path: "media.assets.video.variants",
          blocking: true
        });
      }
    }
    for (const key of stableVariantKeys) {
      if (!(key in (asset.video?.variants ?? {}))) {
        blockingErrors.push({
          code: "video_variant_missing_stable_key",
          message: `Video asset ${asset.id} missing stable variant key ${key}`,
          path: "media.assets.video.variants",
          blocking: true
        });
      }
    }
    const rawMain1080 = asset.video?.variants?.main1080 as string | null | undefined;
    const rawMain1080Avc = asset.video?.variants?.main1080Avc as string | null | undefined;
    const upgrade1080 = asset.video?.variants?.upgrade1080Faststart as string | null | undefined;
    const upgrade1080Avc = asset.video?.variants?.upgrade1080FaststartAvc as string | null | undefined;
    const upgradeUrlSet = new Set(
      [upgrade1080, upgrade1080Avc]
        .map((url) => (typeof url === "string" ? url.trim() : ""))
        .filter(Boolean)
    );
    const main1080 = typeof rawMain1080 === "string" ? rawMain1080.trim() : "";
    const main1080Avc = typeof rawMain1080Avc === "string" ? rawMain1080Avc.trim() : "";
    if (
      upgradeUrlSet.size > 0 &&
      ((Boolean(main1080) && upgradeUrlSet.has(main1080)) ||
        (Boolean(main1080Avc) && upgradeUrlSet.has(main1080Avc)))
    ) {
      warnings.push({
        code: "main1080_aliases_upgrade1080",
        message: `Video asset ${asset.id} main1080/main1080Avc duplicates upgrade1080 URL (should be null unless true main1080 fields)`,
        path: "media.assets.video.variants"
      });
    }
    const fingerprint = asset.video?.playback.fallbackUrl ?? asset.video?.originalUrl ?? asset.video?.playback.primaryUrl;
    if (!fingerprint) continue;
    const owner = videoOriginalMap.get(fingerprint);
    if (owner && owner !== asset.id) {
      warnings.push({
        code: "duplicate_video_asset_fallback",
        message: `Video assets ${owner} and ${asset.id} share fallback/original URL`,
        path: "media.assets.video.playback.fallbackUrl"
      });
    } else {
      videoOriginalMap.set(fingerprint, asset.id);
    }
  }

  if (post.media.completeness === "legacy_recovered" && post.audit.normalizationDebug?.assetCountBefore && post.audit.normalizationDebug.assetCountBefore > 0) {
    warnings.push({
      code: "legacy_recovered_with_raw_assets",
      message: "media.completeness=legacy_recovered while raw assets existed",
      path: "media.completeness"
    });
  }

  if (post.location.coordinates.geohash == null) {
    warnings.push({
      code: "missing_geohash",
      message: "location.coordinates.geohash is missing",
      path: "location.coordinates.geohash"
    });
  }

  if (/\s{2,}/.test(post.text.searchableText)) {
    blockingErrors.push({
      code: "searchable_text_whitespace",
      message: "text.searchableText must not contain repeated whitespace",
      path: "text.searchableText",
      blocking: true
    });
  }

  if (typeof post.engagement.likesVersion !== "number" || typeof post.engagement.commentsVersion !== "number") {
    blockingErrors.push({
      code: "engagement_versions_missing",
      message: "engagement likesVersion/commentsVersion must be numbers",
      path: "engagement",
      blocking: true
    });
  }

  if (post.media.cover.url && post.media.cover.posterUrl && (post.media.cover.width == null || post.media.cover.height == null || post.media.cover.aspectRatio == null)) {
    warnings.push({
      code: "cover_dimensions_missing",
      message: "Cover dimensions should be present when metadata exists",
      path: "media.cover"
    });
  }

  const audit = options?.engagementSourceAudit;
  if (audit) {
    for (const m of audit.mismatches) {
      warnings.push({
        code: "engagement_count_mismatch",
        message: m,
        path: "audit.engagementSourceAuditSummary"
      });
    }
    for (const w of audit.warnings) {
      warnings.push({
        code: "engagement_audit_warning",
        message: w,
        path: "audit.engagementSourceAuditSummary"
      });
    }
    if (audit.selectedSource.likes === "postDocArray") {
      warnings.push({
        code: "likes_selected_legacy_embedded_post_array",
        message:
          "likes counts/previews use embedded post doc likes[] — production source of truth is posts/{postId}/likes/{userId} when present",
        path: "engagement"
      });
    }
    if (
      audit.selectedSource.comments === "postDocArray" &&
      audit.postDoc.commentsArrayCount > 0 &&
      !audit.warnings.includes("comments_subcollection_empty_using_post_doc_array")
    ) {
      warnings.push({
        code: "comments_selected_legacy_embedded_post_array",
        message:
          "comments use embedded post doc array — canonical path is posts/{postId}/comments/{commentId} when subcollection is authoritative",
        path: "engagement"
      });
    }

    if (audit.subcollections.commentsCount === 0 && audit.postDoc.commentsArrayCount > 0) {
      warnings.push({
        code: "comments_embedded_exist_while_subcollection_empty",
        message:
          "Comments subcollection is empty but embedded post.comments[] has items — canonical uses embedded counts/preview until migrated to subcollection",
        path: "audit.engagementSourceAuditSummary"
      });
    }

    if (
      audit.selectedSource.comments === "subcollection" &&
      audit.subcollections.commentsCount === 0 &&
      audit.postDoc.commentsArrayCount > 0
    ) {
      warnings.push({
        code: "comments_engagement_audit_should_not_select_subcollection_here",
        message:
          "Audit selected subcollection for comments while subcollection count is 0 and embedded comments exist — re-run derive or fix audit input",
        path: "audit.engagementSourceAuditSummary"
      });
    }

    if (audit.recommendedCanonical.commentCount !== post.engagement.commentCount) {
      warnings.push({
        code: "canonical_comment_count_mismatch_vs_engagement_audit",
        message: `canonical engagement.commentCount (${post.engagement.commentCount}) does not match audit recommended ${audit.recommendedCanonical.commentCount}`,
        path: "engagement.commentCount"
      });
    }

    const srcComments = audit.selectedSource.comments;
    const commentsPreviewExpected = srcComments === "subcollection" || srcComments === "postDocArray";
    const recentComments = post.engagementPreview.recentComments ?? [];
    if (
      audit.recommendedCanonical.commentCount > 0 &&
      commentsPreviewExpected &&
      recentComments.length === 0
    ) {
      warnings.push({
        code: "engagement_recent_comments_empty_despite_nonzero_count",
        message:
          "engagement.commentCount > 0 but engagementPreview.recentComments is empty — check subcollection/doc query and embedded comments mapping",
        path: "engagementPreview.recentComments"
      });
    }

    for (let ci = 0; ci < recentComments.length; ci += 1) {
      const c = recentComments[ci]!;
      if (typeof c.replyCount !== "number" || Number.isNaN(c.replyCount)) {
        warnings.push({
          code: "engagement_recent_comment_reply_count_invalid",
          message: `recentComments[${ci}] missing numeric replyCount`,
          path: "engagementPreview.recentComments"
        });
      }
    }

    const n = Math.min(post.engagementPreview.recentLikers.length, audit.subcollections.recentLikers.length);
    for (let i = 0; i < n; i += 1) {
      const row = post.engagementPreview.recentLikers[i]!;
      const src = audit.subcollections.recentLikers[i];
      if (src?.profilePicUrl && !row.profilePicUrl) {
        warnings.push({
          code: "engagement_preview_missing_profile_pic",
          message: `recentLikers[${i}] missing profilePicUrl while likes subcollection had userPic/profile`,
          path: "engagementPreview.recentLikers"
        });
      }
      if (src?.likedAt && !row.likedAt) {
        warnings.push({
          code: "engagement_preview_missing_liked_at",
          message: `recentLikers[${i}] missing likedAt while likes subcollection had timestamps`,
          path: "engagementPreview.recentLikers"
        });
      }
    }

    const expectedCc = audit.recommendedCanonical.commentCount;
    if (expectedCc > 0 && post.engagement.commentCount === 0) {
      warnings.push({
        code: "engagement_comment_count_zero_but_sources_nonzero",
        message: `commentCount canonical is 0 but engagement audit recommended ${expectedCc}`,
        path: "engagement.commentCount"
      });
    }
  }

  const status: MasterPostValidationStatusV2 =
    blockingErrors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid";
  return { status, blockingErrors, warnings };
}
