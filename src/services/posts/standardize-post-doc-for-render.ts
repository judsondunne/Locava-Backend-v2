/**
 * standardize-post-doc-for-render
 *
 * Coerces a raw Firestore post document into a shape that satisfies
 * `StandardizedPostDocSchema`. Real production data routinely has:
 *   - top-level mirror fields (likesCount/commentsCount/address/content/title)
 *     stored as `null` or omitted entirely
 *   - optional video metadata (`posterHighUrl`, `thumbnailUrl`, technical
 *     dimensions, codecs) stored as `null` even when the schema requires
 *     `z.string()`/`z.number()`
 *   - `media.assets[].video.readiness.processingStatus` stored as values
 *     outside the strict enum (`"complete"`, `"active"`, etc.)
 *   - mirror sections (compatibility / lifecycle / ranking / schema) absent
 *
 * The contract drift guard (scripts/check-standardized-post-doc-contract-drift.js)
 * enforces that the OUTER sections of the schema match the canonical mirror,
 * but it does not police the per-field strictness. We deliberately keep the
 * Zod schema strict and instead coerce every field here so the response
 * remains a clean canonical doc — and so a Firestore data-quality drift can
 * be picked up via `RENDER_STANDARDIZED_BATCH_DOC_SANITIZED` warnings rather
 * than as a wholesale rejection that blocks renders.
 *
 * Returns one of:
 *   - { ok: true, doc, sanitizedFields: string[] }
 *     when the doc has at least one renderable asset.
 *   - { ok: false, reason: "fatal_no_id" | "fatal_deleted" |
 *        "fatal_no_media_assets" | "fatal_no_renderable_asset" |
 *        "fatal_invalid_shape" }
 *     for truly unrenderable docs.
 */

import type { StandardizedPostDoc } from "../../contracts/standardized-post-doc.contract.js";

type UnknownRecord = Record<string, unknown>;

export type StandardizePostDocResult =
  | { ok: true; doc: StandardizedPostDoc; sanitizedFields: string[] }
  | {
      ok: false;
      reason:
        | "fatal_no_id"
        | "fatal_deleted"
        | "fatal_no_media_assets"
        | "fatal_no_renderable_asset"
        | "fatal_invalid_shape";
      detail?: string;
    };

function asRecord(value: unknown): UnknownRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

class FieldSanitizer {
  readonly sanitizedFields: string[] = [];

  private mark(path: string): void {
    if (!this.sanitizedFields.includes(path)) {
      this.sanitizedFields.push(path);
    }
  }

  /**
   * Coerce any value into a string. Non-string inputs (null/object/number)
   * become the supplied default and the field is reported as sanitized.
   */
  string(value: unknown, defaultValue: string, path: string): string {
    if (typeof value === "string") return value;
    if (value == null || value === undefined) {
      this.mark(path);
      return defaultValue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      this.mark(path);
      return String(value);
    }
    this.mark(path);
    return defaultValue;
  }

  /** Coerce to a nullable string (preserves `null` over `undefined`). */
  nullableString(value: unknown, path: string): string | null {
    if (typeof value === "string") return value;
    if (value === null) return null;
    if (value === undefined) return null;
    this.mark(path);
    return null;
  }

  /** Coerce to a finite number. Strings that parse cleanly are accepted. */
  number(value: unknown, defaultValue: number, path: string): number {
    if (isFiniteNumber(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        this.mark(path);
        return parsed;
      }
    }
    if (value !== undefined) this.mark(path);
    return defaultValue;
  }

  /** Coerce to a nullable finite number. */
  nullableNumber(value: unknown, path: string): number | null {
    if (isFiniteNumber(value)) return value;
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        this.mark(path);
        return parsed;
      }
    }
    this.mark(path);
    return null;
  }

  bool(value: unknown, defaultValue: boolean, path: string): boolean {
    if (typeof value === "boolean") return value;
    if (value !== undefined) this.mark(path);
    return defaultValue;
  }

  enum<T extends string>(
    value: unknown,
    allowed: readonly T[],
    defaultValue: T,
    path: string,
  ): T {
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
      return value as T;
    }
    if (value !== undefined) this.mark(path);
    return defaultValue;
  }

  stringArray(value: unknown, path: string): string[] {
    if (Array.isArray(value)) {
      const out: string[] = [];
      let mutated = false;
      for (const item of value) {
        if (typeof item === "string") out.push(item);
        else mutated = true;
      }
      if (mutated) this.mark(path);
      return out;
    }
    if (value !== undefined) this.mark(path);
    return [];
  }
}

function buildAuthor(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
): StandardizedPostDoc["author"] {
  const author = asRecord(raw.author) ?? {};
  return {
    userId: sanitizer.string(
      author.userId ?? raw.userId,
      "",
      "author.userId",
    ),
    displayName: sanitizer.string(
      author.displayName ?? raw.userName,
      "",
      "author.displayName",
    ),
    handle: sanitizer.string(
      author.handle ?? raw.userHandle ?? raw.handle,
      "",
      "author.handle",
    ),
    profilePicUrl: sanitizer.string(
      author.profilePicUrl ?? raw.userPic,
      "",
      "author.profilePicUrl",
    ),
  };
}

function buildClassification(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
  derivedMediaKind: "image" | "video" | "mixed" | "text" | "unknown",
): StandardizedPostDoc["classification"] {
  const cls = asRecord(raw.classification) ?? {};
  return {
    activities: sanitizer.stringArray(
      cls.activities ?? raw.activities,
      "classification.activities",
    ),
    primaryActivity: sanitizer.string(
      cls.primaryActivity,
      Array.isArray(raw.activities) && raw.activities.length > 0
        ? String(raw.activities[0] ?? "")
        : "",
      "classification.primaryActivity",
    ),
    mediaKind: sanitizer.enum(
      cls.mediaKind ?? raw.mediaType,
      ["image", "video", "mixed", "text", "unknown"],
      derivedMediaKind,
      "classification.mediaKind",
    ),
    visibility: sanitizer.enum(
      cls.visibility,
      ["public", "private", "group"],
      "public",
      "classification.visibility",
    ),
    isBoosted: sanitizer.bool(
      cls.isBoosted ?? raw.isBoosted,
      false,
      "classification.isBoosted",
    ),
    reel: sanitizer.bool(cls.reel, false, "classification.reel"),
    settingType: sanitizer.string(
      cls.settingType ?? raw.settingType,
      "outdoor",
      "classification.settingType",
    ),
    moderatorTier: sanitizer.number(
      cls.moderatorTier,
      0,
      "classification.moderatorTier",
    ),
    source: sanitizer.string(cls.source, "user", "classification.source"),
    privacyLabel: sanitizer.string(
      cls.privacyLabel ?? raw.privacy,
      "Public Spot",
      "classification.privacyLabel",
    ),
  };
}

function buildCompatibility(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
  cover: UnknownRecord | null,
): StandardizedPostDoc["compatibility"] {
  const compat = asRecord(raw.compatibility) ?? {};
  const coverUrl =
    nonEmptyString(cover?.url) ?? nonEmptyString(compat.displayPhotoLink) ?? nonEmptyString(raw.displayPhotoLink) ?? nonEmptyString(raw.photoLink) ?? "";
  const mediaTypeFromCover =
    typeof cover?.type === "string" && (cover!.type === "image" || cover!.type === "video")
      ? (cover!.type as "image" | "video")
      : null;
  return {
    displayPhotoLink: sanitizer.string(
      compat.displayPhotoLink ?? raw.displayPhotoLink,
      coverUrl,
      "compatibility.displayPhotoLink",
    ),
    mediaType: sanitizer.enum(
      compat.mediaType ?? raw.mediaType,
      ["image", "video"],
      mediaTypeFromCover ?? "image",
      "compatibility.mediaType",
    ),
    photoLink: sanitizer.string(
      compat.photoLink ?? raw.photoLink,
      coverUrl,
      "compatibility.photoLink",
    ),
    photoLinks2: sanitizer.nullableString(
      compat.photoLinks2 ?? raw.photoLinks2,
      "compatibility.photoLinks2",
    ),
    photoLinks3: sanitizer.nullableString(
      compat.photoLinks3 ?? raw.photoLinks3,
      "compatibility.photoLinks3",
    ),
    thumbUrl: sanitizer.string(
      compat.thumbUrl ?? raw.thumbUrl,
      coverUrl,
      "compatibility.thumbUrl",
    ),
    posterUrl: sanitizer.nullableString(
      compat.posterUrl ?? raw.posterUrl,
      "compatibility.posterUrl",
    ),
    fallbackVideoUrl: sanitizer.nullableString(
      compat.fallbackVideoUrl ?? raw.fallbackVideoUrl,
      "compatibility.fallbackVideoUrl",
    ),
  };
}

function buildEngagement(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
): StandardizedPostDoc["engagement"] {
  const eng = asRecord(raw.engagement) ?? {};
  return {
    commentCount: sanitizer.number(
      eng.commentCount ?? raw.commentCount ?? raw.commentsCount,
      0,
      "engagement.commentCount",
    ),
    commentsVersion: sanitizer.number(
      eng.commentsVersion ?? raw.commentsVersion,
      0,
      "engagement.commentsVersion",
    ),
    likeCount: sanitizer.number(
      eng.likeCount ?? raw.likeCount ?? raw.likesCount,
      0,
      "engagement.likeCount",
    ),
    likesVersion: sanitizer.number(
      eng.likesVersion ?? raw.likesVersion,
      0,
      "engagement.likesVersion",
    ),
    saveCount: sanitizer.number(
      eng.saveCount,
      0,
      "engagement.saveCount",
    ),
    savesVersion: sanitizer.number(
      eng.savesVersion,
      0,
      "engagement.savesVersion",
    ),
    shareCount: sanitizer.number(
      eng.shareCount,
      0,
      "engagement.shareCount",
    ),
    showComments: sanitizer.bool(
      eng.showComments ?? raw.showComments,
      true,
      "engagement.showComments",
    ),
    showLikes: sanitizer.bool(
      eng.showLikes ?? raw.showLikes,
      true,
      "engagement.showLikes",
    ),
    viewCount: sanitizer.number(eng.viewCount, 0, "engagement.viewCount"),
  };
}

function buildEngagementPreview(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
): StandardizedPostDoc["engagementPreview"] {
  const preview = asRecord(raw.engagementPreview) ?? {};
  const recentComments = Array.isArray(preview.recentComments)
    ? preview.recentComments
        .map((entry) => {
          const r = asRecord(entry);
          if (!r) return null;
          return {
            commentId: sanitizer.string(r.commentId, "", "engagementPreview.recentComments.commentId"),
            userId: sanitizer.string(r.userId, "", "engagementPreview.recentComments.userId"),
            displayName: sanitizer.string(r.displayName, "", "engagementPreview.recentComments.displayName"),
            handle: sanitizer.string(r.handle, "", "engagementPreview.recentComments.handle"),
            profilePicUrl: sanitizer.string(r.profilePicUrl, "", "engagementPreview.recentComments.profilePicUrl"),
            text: sanitizer.string(r.text, "", "engagementPreview.recentComments.text"),
            createdAt: sanitizer.string(r.createdAt, "", "engagementPreview.recentComments.createdAt"),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    : [];
  const recentLikers = Array.isArray(preview.recentLikers)
    ? preview.recentLikers
        .map((entry) => {
          const r = asRecord(entry);
          if (!r) return null;
          return {
            userId: sanitizer.string(r.userId, "", "engagementPreview.recentLikers.userId"),
            displayName: sanitizer.string(r.displayName, "", "engagementPreview.recentLikers.displayName"),
            handle: sanitizer.string(r.handle, "", "engagementPreview.recentLikers.handle"),
            profilePicUrl: sanitizer.string(r.profilePicUrl, "", "engagementPreview.recentLikers.profilePicUrl"),
            likedAt: sanitizer.string(r.likedAt, "", "engagementPreview.recentLikers.likedAt"),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    : [];
  return { recentComments, recentLikers };
}

function buildLifecycle(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
): StandardizedPostDoc["lifecycle"] {
  const life = asRecord(raw.lifecycle) ?? {};
  const iso = nowIso();
  const createdAtMs = sanitizer.number(life.createdAtMs ?? raw.createdAtMs, Date.now(), "lifecycle.createdAtMs");
  return {
    createdAt: sanitizer.string(life.createdAt, new Date(createdAtMs).toISOString(), "lifecycle.createdAt"),
    createdAtMs,
    deletedAt: sanitizer.nullableString(life.deletedAt, "lifecycle.deletedAt"),
    isDeleted: sanitizer.bool(life.isDeleted, false, "lifecycle.isDeleted"),
    lastMediaUpdatedAt: sanitizer.string(life.lastMediaUpdatedAt, iso, "lifecycle.lastMediaUpdatedAt"),
    lastUserVisibleAt: sanitizer.string(life.lastUserVisibleAt, iso, "lifecycle.lastUserVisibleAt"),
    status: sanitizer.enum(
      life.status,
      ["active", "deleted", "hidden", "processing", "failed"],
      "active",
      "lifecycle.status",
    ),
    updatedAt: sanitizer.string(life.updatedAt, iso, "lifecycle.updatedAt"),
  };
}

function buildLocation(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
): StandardizedPostDoc["location"] {
  const loc = asRecord(raw.location) ?? {};
  const coords = asRecord(loc.coordinates) ?? {};
  const display = asRecord(loc.display) ?? {};
  const place = asRecord(loc.place) ?? {};
  const regions = asRecord(loc.regions) ?? {};
  const legacyGeo = asRecord(raw.geo) ?? {};
  const lat = sanitizer.number(
    coords.lat ?? raw.lat ?? legacyGeo.lat,
    0,
    "location.coordinates.lat",
  );
  const lng = sanitizer.number(
    coords.lng ?? coords.long ?? raw.long ?? raw.lng ?? legacyGeo.long,
    0,
    "location.coordinates.lng",
  );
  return {
    coordinates: {
      geohash: sanitizer.string(coords.geohash ?? legacyGeo.geohash, "", "location.coordinates.geohash"),
      lat,
      lng,
    },
    display: {
      address: sanitizer.string(display.address ?? raw.address, "", "location.display.address"),
      label: sanitizer.string(display.label ?? raw.address, "", "location.display.label"),
      name: sanitizer.string(display.name ?? raw.address, "", "location.display.name"),
      subtitle: sanitizer.string(display.subtitle, "", "location.display.subtitle"),
    },
    place: {
      placeId: sanitizer.nullableString(place.placeId, "location.place.placeId"),
      placeName: sanitizer.nullableString(place.placeName, "location.place.placeName"),
      precision: sanitizer.string(place.precision, "unknown", "location.place.precision"),
      source: sanitizer.string(place.source, "unknown", "location.place.source"),
    },
    regions: {
      city: sanitizer.string(regions.city ?? legacyGeo.city, "", "location.regions.city"),
      cityRegionId: sanitizer.string(regions.cityRegionId, "", "location.regions.cityRegionId"),
      country: sanitizer.string(regions.country ?? legacyGeo.country, "", "location.regions.country"),
      countryRegionId: sanitizer.string(regions.countryRegionId, "", "location.regions.countryRegionId"),
      state: sanitizer.string(regions.state ?? legacyGeo.state, "", "location.regions.state"),
      stateRegionId: sanitizer.string(regions.stateRegionId, "", "location.regions.stateRegionId"),
    },
  };
}

function buildAssetPresentation(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
  pathPrefix: string,
): { carouselFitWidth: boolean; letterboxGradient: { top: string; bottom: string }; resizeMode: "contain" } {
  const presentation = asRecord(raw.presentation) ?? {};
  const gradient = asRecord(presentation.letterboxGradient) ?? {};
  return {
    carouselFitWidth: sanitizer.bool(
      presentation.carouselFitWidth,
      true,
      `${pathPrefix}.presentation.carouselFitWidth`,
    ),
    letterboxGradient: {
      top: sanitizer.string(gradient.top, "#000000", `${pathPrefix}.presentation.letterboxGradient.top`),
      bottom: sanitizer.string(gradient.bottom, "#000000", `${pathPrefix}.presentation.letterboxGradient.bottom`),
    },
    // resizeMode is a literal in the schema — we always emit "contain".
    resizeMode: "contain",
  };
}

function buildAssetSource(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
  pathPrefix: string,
  fallbackId: string,
): {
  kind: string;
  legacySourcesConsidered: unknown[];
  legacyVariantUrlsMerged: boolean;
  originalAssetId: string;
  primarySources: string[];
} {
  const source = asRecord(raw.source) ?? {};
  return {
    kind: sanitizer.string(source.kind, "canonical", `${pathPrefix}.source.kind`),
    legacySourcesConsidered: Array.isArray(source.legacySourcesConsidered)
      ? source.legacySourcesConsidered
      : [],
    legacyVariantUrlsMerged: sanitizer.bool(
      source.legacyVariantUrlsMerged,
      false,
      `${pathPrefix}.source.legacyVariantUrlsMerged`,
    ),
    originalAssetId: sanitizer.string(
      source.originalAssetId,
      fallbackId,
      `${pathPrefix}.source.originalAssetId`,
    ),
    primarySources: sanitizer.stringArray(
      source.primarySources,
      `${pathPrefix}.source.primarySources`,
    ),
  };
}

type SanitizedAsset = StandardizedPostDoc["media"]["assets"][number];

function sanitizeImageAsset(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
  index: number,
): SanitizedAsset | { fatal: true; reason: string } {
  const id = nonEmptyString(raw.id) ?? `asset-${index}`;
  const pathPrefix = `media.assets.${index}`;
  const image = asRecord(raw.image) ?? {};
  const displayUrl = nonEmptyString(image.displayUrl);
  if (!displayUrl) {
    return { fatal: true, reason: `${pathPrefix}.image.displayUrl` };
  }
  return {
    id,
    index: sanitizer.number(raw.index, index, `${pathPrefix}.index`),
    type: "image",
    image: {
      aspectRatio: sanitizer.number(image.aspectRatio, 1, `${pathPrefix}.image.aspectRatio`),
      blurhash: sanitizer.nullableString(image.blurhash, `${pathPrefix}.image.blurhash`),
      displayUrl,
      height: sanitizer.number(image.height, 1080, `${pathPrefix}.image.height`),
      orientation: sanitizer.enum(
        image.orientation,
        ["portrait", "landscape", "square"],
        "portrait",
        `${pathPrefix}.image.orientation`,
      ),
      originalUrl: sanitizer.string(image.originalUrl, displayUrl, `${pathPrefix}.image.originalUrl`),
      thumbnailUrl: sanitizer.string(image.thumbnailUrl, displayUrl, `${pathPrefix}.image.thumbnailUrl`),
      width: sanitizer.number(image.width, 1080, `${pathPrefix}.image.width`),
    },
    presentation: buildAssetPresentation(raw, sanitizer, pathPrefix),
    source: buildAssetSource(raw, sanitizer, pathPrefix, id),
  };
}

function sanitizeVideoAsset(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
  index: number,
): SanitizedAsset | { fatal: true; reason: string } {
  const id = nonEmptyString(raw.id) ?? `asset-${index}`;
  const pathPrefix = `media.assets.${index}`;
  const video = asRecord(raw.video) ?? {};
  const playback = asRecord(video.playback) ?? {};
  const variants = asRecord(video.variants) ?? {};
  const readiness = asRecord(video.readiness) ?? {};
  const codecs = asRecord(video.codecs) ?? {};
  const technical = asRecord(video.technical) ?? {};

  const startupUrl = nonEmptyString(playback.startupUrl);
  const primaryUrl = nonEmptyString(playback.primaryUrl);
  const defaultUrl = nonEmptyString(playback.defaultUrl);
  const goodNetworkUrl = nonEmptyString(playback.goodNetworkUrl);
  const fallbackUrl = nonEmptyString(playback.fallbackUrl);
  const playableUrl = startupUrl ?? primaryUrl ?? defaultUrl ?? goodNetworkUrl ?? fallbackUrl;
  if (!playableUrl) {
    return { fatal: true, reason: `${pathPrefix}.video.playback.no_playable_url` };
  }

  const posterUrl =
    nonEmptyString(video.posterUrl) ??
    nonEmptyString(video.posterHighUrl) ??
    nonEmptyString(video.thumbnailUrl) ??
    "";
  // Track posterHighUrl / thumbnailUrl drift explicitly. If the source has
  // them as `null` or a non-string we report the field path even though the
  // schema-side string ends up populated from the cascading fallback above.
  if (video.posterHighUrl != null && typeof video.posterHighUrl !== "string") {
    sanitizer.string(video.posterHighUrl, posterUrl, `${pathPrefix}.video.posterHighUrl`);
  } else if (video.posterHighUrl === null) {
    sanitizer.string(null, posterUrl, `${pathPrefix}.video.posterHighUrl`);
  }
  if (video.thumbnailUrl != null && typeof video.thumbnailUrl !== "string") {
    sanitizer.string(video.thumbnailUrl, posterUrl, `${pathPrefix}.video.thumbnailUrl`);
  } else if (video.thumbnailUrl === null) {
    sanitizer.string(null, posterUrl, `${pathPrefix}.video.thumbnailUrl`);
  }
  const posterHighUrl =
    nonEmptyString(video.posterHighUrl) ?? nonEmptyString(video.posterUrl) ?? posterUrl;
  const thumbnailUrl =
    nonEmptyString(video.thumbnailUrl) ?? nonEmptyString(video.posterUrl) ?? posterUrl;
  const originalUrl =
    nonEmptyString(video.originalUrl) ?? primaryUrl ?? defaultUrl ?? playableUrl;

  // processingStatus normalisation: the schema enum is ready/processing/failed.
  // Real Firestore docs sometimes carry "complete", "active", "ok" or null.
  // If we have a playable URL, treat the asset as ready unless the doc
  // explicitly tells us it is processing/failed.
  let processingStatus: "ready" | "processing" | "failed";
  const rawStatus = typeof readiness.processingStatus === "string" ? readiness.processingStatus : "";
  if (rawStatus === "processing" || rawStatus === "failed") {
    processingStatus = rawStatus;
  } else {
    // Anything else (`""`, `"complete"`, `"active"`, `null`, …) maps to
    // `ready` because we already proved a playable URL exists. The
    // sanitizer.enum() call records the field as sanitized when the input
    // was non-empty and non-canonical so the audit log can flag the
    // upstream data drift.
    processingStatus = sanitizer.enum(
      rawStatus,
      ["ready", "processing", "failed"],
      "ready",
      `${pathPrefix}.video.readiness.processingStatus`,
    );
  }

  return {
    id,
    index: sanitizer.number(raw.index, index, `${pathPrefix}.index`),
    type: "video",
    video: {
      originalUrl,
      posterUrl: sanitizer.string(posterUrl, "", `${pathPrefix}.video.posterUrl`),
      posterHighUrl: sanitizer.string(posterHighUrl, posterUrl, `${pathPrefix}.video.posterHighUrl`),
      thumbnailUrl: sanitizer.string(thumbnailUrl, posterUrl, `${pathPrefix}.video.thumbnailUrl`),
      durationSec: sanitizer.number(video.durationSec, 0, `${pathPrefix}.video.durationSec`),
      hasAudio: sanitizer.bool(video.hasAudio, true, `${pathPrefix}.video.hasAudio`),
      playback: {
        primaryUrl: sanitizer.string(playback.primaryUrl, primaryUrl ?? playableUrl, `${pathPrefix}.video.playback.primaryUrl`),
        startupUrl: sanitizer.string(playback.startupUrl, startupUrl ?? playableUrl, `${pathPrefix}.video.playback.startupUrl`),
        goodNetworkUrl: sanitizer.nullableString(playback.goodNetworkUrl, `${pathPrefix}.video.playback.goodNetworkUrl`),
        weakNetworkUrl: sanitizer.nullableString(playback.weakNetworkUrl, `${pathPrefix}.video.playback.weakNetworkUrl`),
        poorNetworkUrl: sanitizer.nullableString(playback.poorNetworkUrl, `${pathPrefix}.video.playback.poorNetworkUrl`),
        defaultUrl: sanitizer.string(playback.defaultUrl, defaultUrl ?? playableUrl, `${pathPrefix}.video.playback.defaultUrl`),
        highQualityUrl: sanitizer.nullableString(playback.highQualityUrl, `${pathPrefix}.video.playback.highQualityUrl`),
        fallbackUrl: sanitizer.nullableString(playback.fallbackUrl, `${pathPrefix}.video.playback.fallbackUrl`),
        upgradeUrl: sanitizer.nullableString(playback.upgradeUrl, `${pathPrefix}.video.playback.upgradeUrl`),
        hlsUrl: sanitizer.nullableString(playback.hlsUrl, `${pathPrefix}.video.playback.hlsUrl`),
        previewUrl: sanitizer.nullableString(playback.previewUrl, `${pathPrefix}.video.playback.previewUrl`),
        selectedReason: sanitizer.string(
          playback.selectedReason,
          "canonical",
          `${pathPrefix}.video.playback.selectedReason`,
        ),
      },
      variants: {
        preview360: sanitizer.nullableString(variants.preview360, `${pathPrefix}.video.variants.preview360`),
        preview360Avc: sanitizer.nullableString(variants.preview360Avc, `${pathPrefix}.video.variants.preview360Avc`),
        main720: sanitizer.nullableString(variants.main720, `${pathPrefix}.video.variants.main720`),
        main720Avc: sanitizer.nullableString(variants.main720Avc, `${pathPrefix}.video.variants.main720Avc`),
        main1080: sanitizer.nullableString(variants.main1080, `${pathPrefix}.video.variants.main1080`),
        main1080Avc: sanitizer.nullableString(variants.main1080Avc, `${pathPrefix}.video.variants.main1080Avc`),
        startup540Faststart: sanitizer.nullableString(variants.startup540Faststart, `${pathPrefix}.video.variants.startup540Faststart`),
        startup540FaststartAvc: sanitizer.nullableString(variants.startup540FaststartAvc, `${pathPrefix}.video.variants.startup540FaststartAvc`),
        startup720Faststart: sanitizer.nullableString(variants.startup720Faststart, `${pathPrefix}.video.variants.startup720Faststart`),
        startup720FaststartAvc: sanitizer.nullableString(variants.startup720FaststartAvc, `${pathPrefix}.video.variants.startup720FaststartAvc`),
        startup1080Faststart: sanitizer.nullableString(variants.startup1080Faststart, `${pathPrefix}.video.variants.startup1080Faststart`),
        startup1080FaststartAvc: sanitizer.nullableString(variants.startup1080FaststartAvc, `${pathPrefix}.video.variants.startup1080FaststartAvc`),
        upgrade1080Faststart: sanitizer.nullableString(variants.upgrade1080Faststart, `${pathPrefix}.video.variants.upgrade1080Faststart`),
        upgrade1080FaststartAvc: sanitizer.nullableString(variants.upgrade1080FaststartAvc, `${pathPrefix}.video.variants.upgrade1080FaststartAvc`),
        hls: sanitizer.nullableString(variants.hls, `${pathPrefix}.video.variants.hls`),
        hlsAvcMaster: sanitizer.nullableString(variants.hlsAvcMaster, `${pathPrefix}.video.variants.hlsAvcMaster`),
      },
      readiness: {
        assetsReady: sanitizer.bool(readiness.assetsReady, true, `${pathPrefix}.video.readiness.assetsReady`),
        instantPlaybackReady: sanitizer.bool(
          readiness.instantPlaybackReady,
          true,
          `${pathPrefix}.video.readiness.instantPlaybackReady`,
        ),
        faststartVerified: sanitizer.bool(
          readiness.faststartVerified,
          false,
          `${pathPrefix}.video.readiness.faststartVerified`,
        ),
        processingStatus,
      },
      codecs: {
        video: sanitizer.nullableString(codecs.video, `${pathPrefix}.video.codecs.video`),
        audio: sanitizer.nullableString(codecs.audio, `${pathPrefix}.video.codecs.audio`),
      },
      technical: {
        sourceCodec: sanitizer.nullableString(technical.sourceCodec, `${pathPrefix}.video.technical.sourceCodec`),
        playbackCodec: sanitizer.nullableString(technical.playbackCodec, `${pathPrefix}.video.technical.playbackCodec`),
        audioCodec: sanitizer.nullableString(technical.audioCodec, `${pathPrefix}.video.technical.audioCodec`),
        bitrateKbps: sanitizer.nullableNumber(technical.bitrateKbps, `${pathPrefix}.video.technical.bitrateKbps`),
        sizeBytes: sanitizer.nullableNumber(technical.sizeBytes, `${pathPrefix}.video.technical.sizeBytes`),
        width: sanitizer.number(technical.width, 640, `${pathPrefix}.video.technical.width`),
        height: sanitizer.number(technical.height, 1138, `${pathPrefix}.video.technical.height`),
      },
    },
    presentation: buildAssetPresentation(raw, sanitizer, pathPrefix),
    source: buildAssetSource(raw, sanitizer, pathPrefix, id),
  };
}

function sanitizeMediaAssets(
  raw: unknown,
  sanitizer: FieldSanitizer,
): { ok: true; assets: SanitizedAsset[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "media.assets_not_array" };
  }
  const out: SanitizedAsset[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = asRecord(raw[i]);
    if (!r) continue;
    const t = typeof r.type === "string" ? r.type : "";
    if (t === "image") {
      const result = sanitizeImageAsset(r, sanitizer, i);
      if ("fatal" in result) {
        // Drop unrenderable single asset but keep going if siblings exist.
        continue;
      }
      out.push(result);
    } else if (t === "video") {
      const result = sanitizeVideoAsset(r, sanitizer, i);
      if ("fatal" in result) {
        continue;
      }
      out.push(result);
    } else {
      // Unsupported asset type → skipped, not fatal for the whole post.
      continue;
    }
  }
  if (out.length === 0) {
    return { ok: false, reason: "no_renderable_asset" };
  }
  return { ok: true, assets: out };
}

function buildCoverFromFirstAsset(
  asset: SanitizedAsset,
  // sanitizer kept on the signature for symmetry with other builders even
  // though the cover fields here are entirely derived from the asset.
  _sanitizer: FieldSanitizer,
): StandardizedPostDoc["media"]["cover"] {
  if (asset.type === "image") {
    const aspect = asset.image.height > 0 ? asset.image.width / asset.image.height : 1;
    return {
      assetId: asset.id,
      aspectRatio: aspect,
      gradient: asset.presentation.letterboxGradient,
      height: asset.image.height,
      posterUrl: null,
      thumbUrl: asset.image.thumbnailUrl || asset.image.displayUrl,
      type: "image",
      url: asset.image.displayUrl,
      width: asset.image.width,
    };
  }
  const technical = asset.video.technical;
  const aspect = technical.height > 0 ? technical.width / technical.height : 0.5625;
  const poster = asset.video.posterUrl || asset.video.posterHighUrl || asset.video.thumbnailUrl;
  return {
    assetId: asset.id,
    aspectRatio: aspect,
    gradient: asset.presentation.letterboxGradient,
    height: technical.height,
    posterUrl: poster || null,
    thumbUrl: poster || asset.video.thumbnailUrl,
    type: "video",
    url: poster || asset.video.playback.startupUrl,
    width: technical.width,
  };
}

function buildMedia(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
):
  | { ok: true; media: StandardizedPostDoc["media"]; mediaKind: "image" | "video" | "mixed" | "text" | "unknown" }
  | { ok: false; reason: "fatal_no_media_assets" | "fatal_no_renderable_asset" } {
  const media = asRecord(raw.media);
  if (!media) {
    return { ok: false, reason: "fatal_no_media_assets" };
  }
  const sanitized = sanitizeMediaAssets(media.assets, sanitizer);
  if (!sanitized.ok) {
    return {
      ok: false,
      reason: sanitized.reason === "no_renderable_asset"
        ? "fatal_no_renderable_asset"
        : "fatal_no_media_assets",
    };
  }
  const assets = sanitized.assets;
  const cover = asRecord(media.cover);
  let resolvedCover: StandardizedPostDoc["media"]["cover"];
  if (cover && nonEmptyString(cover.url)) {
    const coverType =
      typeof cover.type === "string" && (cover.type === "image" || cover.type === "video")
        ? (cover.type as "image" | "video")
        : assets[0]!.type;
    resolvedCover = {
      assetId: sanitizer.string(cover.assetId, assets[0]!.id, "media.cover.assetId"),
      aspectRatio: sanitizer.number(cover.aspectRatio, 1, "media.cover.aspectRatio"),
      gradient: {
        top: sanitizer.string(asRecord(cover.gradient)?.top, "#000000", "media.cover.gradient.top"),
        bottom: sanitizer.string(asRecord(cover.gradient)?.bottom, "#000000", "media.cover.gradient.bottom"),
      },
      height: sanitizer.number(cover.height, 1080, "media.cover.height"),
      posterUrl: sanitizer.nullableString(cover.posterUrl, "media.cover.posterUrl"),
      thumbUrl: sanitizer.string(cover.thumbUrl, nonEmptyString(cover.url) ?? "", "media.cover.thumbUrl"),
      type: coverType,
      url: sanitizer.string(cover.url, "", "media.cover.url"),
      width: sanitizer.number(cover.width, 1080, "media.cover.width"),
    };
  } else {
    resolvedCover = buildCoverFromFirstAsset(assets[0]!, sanitizer);
  }

  const hasVideo = assets.some((a) => a.type === "video");
  const hasImage = assets.some((a) => a.type === "image");
  const mediaKind: "image" | "video" | "mixed" | "text" | "unknown" =
    hasVideo && hasImage ? "mixed" : hasVideo ? "video" : "image";

  const presentation = asRecord(media.presentation) ?? {};

  return {
    ok: true,
    mediaKind,
    media: {
      assetCount: assets.length,
      assets,
      assetsReady: sanitizer.bool(media.assetsReady, true, "media.assetsReady"),
      completeness: sanitizer.enum(
        media.completeness,
        ["complete", "partial", "legacy_recovered", "missing"],
        "complete",
        "media.completeness",
      ),
      cover: resolvedCover,
      coverAssetId: sanitizer.string(media.coverAssetId, resolvedCover.assetId, "media.coverAssetId"),
      hasMultipleAssets: assets.length > 1,
      instantPlaybackReady: sanitizer.bool(
        media.instantPlaybackReady,
        true,
        "media.instantPlaybackReady",
      ),
      presentation: {
        carouselFitWidth: sanitizer.bool(
          presentation.carouselFitWidth,
          true,
          "media.presentation.carouselFitWidth",
        ),
        resizeMode: "contain",
      },
      primaryAssetId: sanitizer.string(media.primaryAssetId, assets[0]!.id, "media.primaryAssetId"),
      rawAssetCount: sanitizer.number(media.rawAssetCount, assets.length, "media.rawAssetCount"),
      status: sanitizer.enum(
        media.status,
        ["ready", "processing", "partial", "failed", "none"],
        "ready",
        "media.status",
      ),
    },
  };
}

function buildRanking(
  raw: UnknownRecord,
): StandardizedPostDoc["ranking"] {
  const ranking = asRecord(raw.ranking) ?? {};
  const aggregates: Record<string, number | string | null> = {};
  if (asRecord(ranking.aggregates)) {
    for (const [k, v] of Object.entries(ranking.aggregates as UnknownRecord)) {
      if (typeof v === "number" || typeof v === "string" || v === null) {
        aggregates[k] = v;
      }
    }
  }
  const rollup: Record<string, number> = {};
  if (asRecord(ranking.rollup)) {
    for (const [k, v] of Object.entries(ranking.rollup as UnknownRecord)) {
      if (typeof v === "number" && Number.isFinite(v)) rollup[k] = v;
    }
  }
  return { aggregates, rollup };
}

function buildSchema(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
  sourceShape: string,
): StandardizedPostDoc["schema"] {
  const schema = asRecord(raw.schema) ?? {};
  const iso = nowIso();
  return {
    canonicalizedAt: sanitizer.string(schema.canonicalizedAt, iso, "schema.canonicalizedAt"),
    canonicalizedBy: sanitizer.string(
      schema.canonicalizedBy,
      "backendv2_standardizePostDocForRender",
      "schema.canonicalizedBy",
    ),
    migrationRunId: sanitizer.nullableString(schema.migrationRunId, "schema.migrationRunId"),
    name: "locava.post",
    restoreBackupDocId: sanitizer.string(schema.restoreBackupDocId, "", "schema.restoreBackupDocId"),
    restorePreviewOnly: sanitizer.bool(schema.restorePreviewOnly, false, "schema.restorePreviewOnly"),
    restoreRunId: sanitizer.string(schema.restoreRunId, "", "schema.restoreRunId"),
    restoreSourceName: sanitizer.string(schema.restoreSourceName, sourceShape, "schema.restoreSourceName"),
    restoredAt: sanitizer.string(schema.restoredAt, iso, "schema.restoredAt"),
    restoredFromCanonicalBackup: sanitizer.bool(
      schema.restoredFromCanonicalBackup,
      false,
      "schema.restoredFromCanonicalBackup",
    ),
    sourceShape: sanitizer.string(schema.sourceShape, sourceShape, "schema.sourceShape"),
    version: 2,
  };
}

function buildText(
  raw: UnknownRecord,
  sanitizer: FieldSanitizer,
): StandardizedPostDoc["text"] {
  const text = asRecord(raw.text) ?? {};
  return {
    title: sanitizer.string(text.title ?? raw.title, "", "text.title"),
    caption: sanitizer.string(text.caption ?? raw.caption, "", "text.caption"),
    description: sanitizer.string(text.description ?? raw.description, "", "text.description"),
    content: sanitizer.string(text.content ?? raw.content, "", "text.content"),
    searchableText: sanitizer.string(text.searchableText, "", "text.searchableText"),
  };
}

export function standardizePostDocForRender(
  rawInput: Record<string, unknown>,
  fallbackPostId: string,
): StandardizePostDocResult {
  const raw = asRecord(rawInput);
  if (!raw) {
    return { ok: false, reason: "fatal_invalid_shape" };
  }

  const postId =
    nonEmptyString(raw.id) ??
    nonEmptyString(raw.postId) ??
    nonEmptyString(asRecord(raw.appPostV2)?.id) ??
    nonEmptyString(fallbackPostId);
  if (!postId) {
    return { ok: false, reason: "fatal_no_id" };
  }

  // Hard-fatal lifecycle states.
  const lifecycleRaw = asRecord(raw.lifecycle);
  if (lifecycleRaw?.isDeleted === true) return { ok: false, reason: "fatal_deleted" };
  const status = typeof lifecycleRaw?.status === "string" ? lifecycleRaw.status : "";
  if (status === "deleted") return { ok: false, reason: "fatal_deleted" };

  const sanitizer = new FieldSanitizer();

  // Some Firestore docs only expose appPostV2 — in that case promote that
  // record so all subsequent sections see media.assets / author / text.
  const app = asRecord(raw.appPostV2);
  let workingDoc = raw;
  let sourceShape = "root_standardized";
  if (!asRecord(raw.media) || !Array.isArray(asRecord(raw.media)?.assets)) {
    if (app && asRecord(app.media) && Array.isArray(asRecord(app.media)?.assets)) {
      workingDoc = { ...raw, ...app } as UnknownRecord;
      sourceShape = "appPostV2_envelope";
    }
  }

  const mediaResult = buildMedia(workingDoc, sanitizer);
  if (!mediaResult.ok) {
    return { ok: false, reason: mediaResult.reason };
  }

  const text = buildText(workingDoc, sanitizer);
  const author = buildAuthor(workingDoc, sanitizer);
  const classification = buildClassification(workingDoc, sanitizer, mediaResult.mediaKind);
  const compatibility = buildCompatibility(workingDoc, sanitizer, mediaResult.media.cover as unknown as UnknownRecord);
  const engagement = buildEngagement(workingDoc, sanitizer);
  const engagementPreview = buildEngagementPreview(workingDoc, sanitizer);
  const lifecycle = buildLifecycle(workingDoc, sanitizer);
  const location = buildLocation(workingDoc, sanitizer);
  const ranking = buildRanking(workingDoc);
  const schemaSection = buildSchema(workingDoc, sanitizer, sourceShape);

  // Top-level mirror fields: always coerce to the strict Zod schema's
  // expectations. These are the fields that triggered the wave of
  // `address:invalid_type / commentCount:invalid_type / ...` rejections in
  // production: real Firestore docs frequently store them as `null`.
  const userId = author.userId || sanitizer.string(workingDoc.userId, "", "userId");
  const doc: StandardizedPostDoc = {
    id: postId,
    postId,
    userId,
    userName: sanitizer.string(workingDoc.userName, author.displayName, "userName"),
    userHandle: sanitizer.string(workingDoc.userHandle, author.handle, "userHandle"),
    userPic: sanitizer.string(workingDoc.userPic, author.profilePicUrl, "userPic"),
    title: sanitizer.string(workingDoc.title, text.title, "title"),
    content: sanitizer.string(workingDoc.content, text.content, "content"),
    address: sanitizer.string(workingDoc.address, location.display.address, "address"),
    lat: sanitizer.number(workingDoc.lat, location.coordinates.lat, "lat"),
    long: sanitizer.number(workingDoc.long, location.coordinates.lng, "long"),
    activities: classification.activities,
    mediaType: sanitizer.enum(
      workingDoc.mediaType ?? compatibility.mediaType,
      ["image", "video"],
      compatibility.mediaType,
      "mediaType",
    ),
    photoLink: compatibility.photoLink,
    thumbUrl: compatibility.thumbUrl,
    assetsReady: mediaResult.media.assetsReady,
    likesCount: sanitizer.number(workingDoc.likesCount, engagement.likeCount, "likesCount"),
    likesVersion: sanitizer.number(workingDoc.likesVersion, engagement.likesVersion, "likesVersion"),
    commentsCount: sanitizer.number(workingDoc.commentsCount, engagement.commentCount, "commentsCount"),
    commentsVersion: sanitizer.number(workingDoc.commentsVersion, engagement.commentsVersion, "commentsVersion"),
    likeCount: engagement.likeCount,
    commentCount: engagement.commentCount,
    showLikes: engagement.showLikes,
    showComments: engagement.showComments,
    author,
    classification,
    compatibility,
    engagement,
    engagementPreview,
    lifecycle,
    location,
    media: mediaResult.media,
    ranking,
    schema: schemaSection,
    text,
  };

  return { ok: true, doc, sanitizedFields: sanitizer.sanitizedFields };
}
