import { Timestamp } from "firebase-admin/firestore";
/**
 * READ ONLY restore preview. This module must never write to Firestore.
 * buildRestorePreviewFromCanonicalBackupReadOnly only mutates in-memory clones for preview output.
 */

export type CanonicalBackupField =
  | "auto"
  | "compactLivePost"
  | "canonicalPreview"
  | "canonicalPreview.postDoc"
  | "optimizedRaw"
  | "rawBefore";

export type CurrentPostParentState = "missing" | "empty" | "has_data";

export type RestorePreviewWriteMode = "create_parent_doc" | "skip_existing_doc" | "overwrite_existing_doc";

type AnyRecord = Record<string, unknown>;

export type ResolveRestoreSourceResult = {
  sourceName: "compactLivePost" | "canonicalPreview" | "canonicalPreview.postDoc" | "optimizedRaw" | "rawBefore" | "none";
  sourcePayload: AnyRecord | null;
  sourceQuality:
    | "canonical_live"
    | "canonical_preview"
    | "canonical_post_doc"
    | "legacy_optimized_raw"
    | "legacy_raw_before"
    | "none";
  canApplySafely: boolean;
  requiresManualRawRestore: boolean;
  reason: string;
  fieldCandidates: {
    compactLivePost: boolean;
    canonicalPreview: boolean;
    canonicalPreviewPostDoc: boolean;
    optimizedRaw: boolean;
    rawBefore: boolean;
  };
};

export function toFirestoreTimestamp(value: unknown): Timestamp | undefined {
  if (!value) return undefined;
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === "number" && Number.isFinite(value)) return Timestamp.fromMillis(value);
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return Timestamp.fromMillis(ms);
    return undefined;
  }
  if (typeof value === "object") {
    const obj = value as { _seconds?: unknown; _nanoseconds?: unknown; seconds?: unknown; nanoseconds?: unknown };
    const secondsRaw = typeof obj._seconds === "number" ? obj._seconds : typeof obj.seconds === "number" ? obj.seconds : null;
    const nanosRaw =
      typeof obj._nanoseconds === "number" ? obj._nanoseconds : typeof obj.nanoseconds === "number" ? obj.nanoseconds : 0;
    if (secondsRaw !== null) return new Timestamp(secondsRaw, nanosRaw);
  }
  return undefined;
}

export function parseBackupDocId(backupDocId: string): { postId: string; timestampMs: number | null } {
  const idx = backupDocId.lastIndexOf("_");
  if (idx <= 0) return { postId: backupDocId, timestampMs: null };
  const postId = backupDocId.slice(0, idx);
  const suffix = backupDocId.slice(idx + 1);
  const ts = Number.parseInt(suffix, 10);
  return { postId, timestampMs: Number.isFinite(ts) ? ts : null };
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function isMeaningfulRecord(value: unknown): value is AnyRecord {
  const rec = asRecord(value);
  return Boolean(rec && Object.keys(rec).length > 0);
}

function splitCsvUrls(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function hasMeaningfulParentFields(data: AnyRecord): boolean {
  const keys = Object.keys(data);
  if (keys.length === 0) return false;
  return keys.some((k) => !["updatedAt", "lastUpdated", "__name__"].includes(k));
}

export function resolveCanonicalBackupRestoreSource(
  backupDoc: AnyRecord,
  requestedBackupField: CanonicalBackupField
): ResolveRestoreSourceResult {
  const compactLivePost = asRecord(backupDoc.compactLivePost);
  const canonicalPreview = asRecord(backupDoc.canonicalPreview);
  const canonicalPreviewPostDoc = asRecord(canonicalPreview?.postDoc);
  const optimizedRaw = asRecord(backupDoc.optimizedRaw);
  const rawBefore = asRecord(backupDoc.rawBefore);

  const fieldCandidates = {
    compactLivePost: isMeaningfulRecord(compactLivePost),
    canonicalPreview: isMeaningfulRecord(canonicalPreview),
    canonicalPreviewPostDoc: isMeaningfulRecord(canonicalPreviewPostDoc),
    optimizedRaw: isMeaningfulRecord(optimizedRaw),
    rawBefore: isMeaningfulRecord(rawBefore)
  };

  const explicit = (name: CanonicalBackupField): ResolveRestoreSourceResult | null => {
    if (name === "compactLivePost" && compactLivePost) {
      return {
        sourceName: "compactLivePost",
        sourcePayload: deepClone(compactLivePost),
        sourceQuality: "canonical_live",
        canApplySafely: true,
        requiresManualRawRestore: false,
        reason: "Using compactLivePost.",
        fieldCandidates
      };
    }
    if (name === "canonicalPreview" && canonicalPreview) {
      return {
        sourceName: "canonicalPreview",
        sourcePayload: deepClone(canonicalPreview),
        sourceQuality: "canonical_preview",
        canApplySafely: true,
        requiresManualRawRestore: false,
        reason: "Using canonicalPreview.",
        fieldCandidates
      };
    }
    if (name === "canonicalPreview.postDoc" && canonicalPreviewPostDoc) {
      return {
        sourceName: "canonicalPreview.postDoc",
        sourcePayload: deepClone(canonicalPreviewPostDoc),
        sourceQuality: "canonical_post_doc",
        canApplySafely: true,
        requiresManualRawRestore: false,
        reason: "Using canonicalPreview.postDoc.",
        fieldCandidates
      };
    }
    if (name === "optimizedRaw" && optimizedRaw) {
      return {
        sourceName: "optimizedRaw",
        sourcePayload: deepClone(optimizedRaw),
        sourceQuality: "legacy_optimized_raw",
        canApplySafely: true,
        requiresManualRawRestore: false,
        reason: "Using optimizedRaw.",
        fieldCandidates
      };
    }
    if (name === "rawBefore" && rawBefore) {
      return {
        sourceName: "rawBefore",
        sourcePayload: deepClone(rawBefore),
        sourceQuality: "legacy_raw_before",
        canApplySafely: false,
        requiresManualRawRestore: true,
        reason: "rawBefore is preview-only unless explicit raw restore mode is enabled.",
        fieldCandidates
      };
    }
    return null;
  };

  if (requestedBackupField !== "auto") {
    const resolved = explicit(requestedBackupField);
    if (resolved) return resolved;
    return {
      sourceName: "none",
      sourcePayload: null,
      sourceQuality: "none",
      canApplySafely: false,
      requiresManualRawRestore: false,
      reason: `Requested backup field '${requestedBackupField}' was not found.`,
      fieldCandidates
    };
  }

  const autoOrder: CanonicalBackupField[] = [
    "compactLivePost",
    "canonicalPreview",
    "canonicalPreview.postDoc",
    "optimizedRaw",
    "rawBefore"
  ];
  for (const candidate of autoOrder) {
    const resolved = explicit(candidate);
    if (resolved) return resolved;
  }
  return {
    sourceName: "none",
    sourcePayload: null,
    sourceQuality: "none",
    canApplySafely: false,
    requiresManualRawRestore: false,
    reason: "No supported restore source found in backup doc.",
    fieldCandidates
  };
}

function pickDisplayUrl(image: AnyRecord): string | null {
  return (
    (typeof image.displayUrl === "string" && image.displayUrl) ||
    (typeof image.lg === "string" && image.lg) ||
    (typeof image.md === "string" && image.md) ||
    (typeof image.originalUrl === "string" && image.originalUrl) ||
    null
  );
}

export function buildCanonicalMediaFromSource(sourcePayload: AnyRecord, rawBefore: AnyRecord | null): AnyRecord {
  const existingMedia = asRecord(sourcePayload.media);
  if (existingMedia && Array.isArray(existingMedia.assets) && existingMedia.assets.length > 0) {
    return deepClone(existingMedia);
  }

  const sourceAssets = Array.isArray(sourcePayload.assets) ? (sourcePayload.assets as AnyRecord[]) : [];
  const rawAssets = Array.isArray(rawBefore?.assets) ? (rawBefore?.assets as AnyRecord[]) : [];
  const assetsInput = sourceAssets.length > 0 ? sourceAssets : rawAssets;
  const builtAssets: AnyRecord[] = [];

  const letterboxGradients = Array.isArray(rawBefore?.letterboxGradients) ? (rawBefore?.letterboxGradients as unknown[]) : [];
  for (let idx = 0; idx < assetsInput.length; idx += 1) {
    const asset = assetsInput[idx] ?? {};
    const typeRaw = typeof asset.type === "string" ? asset.type.toLowerCase() : "image";
    const type = typeRaw.includes("video") ? "video" : "image";
    const out: AnyRecord = { id: String(asset.id ?? `asset_${idx}`), index: idx, type };
    if (type === "image") {
      const imageSource = asRecord(asset.image) ?? asset;
      const displayUrl = pickDisplayUrl(imageSource ?? {});
      out.image = {
        originalUrl:
          (typeof imageSource?.originalUrl === "string" && imageSource.originalUrl) ||
          displayUrl ||
          (typeof imageSource?.url === "string" ? imageSource.url : null),
        displayUrl,
        thumbnailUrl:
          (typeof imageSource?.thumbnailUrl === "string" && imageSource.thumbnailUrl) ||
          (typeof imageSource?.thumbUrl === "string" ? imageSource.thumbUrl : null),
        width: imageSource?.width ?? null,
        height: imageSource?.height ?? null,
        aspectRatio: imageSource?.aspectRatio ?? null,
        blurhash: imageSource?.blurhash ?? null,
        orientation: imageSource?.orientation ?? null
      };
    } else {
      const video = asRecord(asset.video) ?? asset;
      const playback = asRecord(video.playback) ?? {};
      out.video = {
        playback: {
          startupUrl: playback.startupUrl ?? video.startupUrl ?? null,
          defaultUrl: playback.defaultUrl ?? video.defaultUrl ?? null,
          primaryUrl: playback.primaryUrl ?? video.primaryUrl ?? null,
          goodNetworkUrl: playback.goodNetworkUrl ?? video.goodNetworkUrl ?? null,
          weakNetworkUrl: playback.weakNetworkUrl ?? video.weakNetworkUrl ?? null,
          poorNetworkUrl: playback.poorNetworkUrl ?? video.poorNetworkUrl ?? null,
          fallbackVideoUrl: playback.fallbackVideoUrl ?? video.fallbackVideoUrl ?? null
        },
        posterUrl: video.posterUrl ?? playback.previewUrl ?? null
      };
    }
    const gradient = letterboxGradients[idx];
    if (gradient) out.presentation = { letterboxGradient: gradient };
    builtAssets.push(out);
  }

  if (builtAssets.length === 0) {
    const photoLinks = splitCsvUrls(sourcePayload.photoLink ?? rawBefore?.photoLink);
    for (let idx = 0; idx < photoLinks.length; idx += 1) {
      const url = photoLinks[idx]!;
      builtAssets.push({
        id: `photo_${idx}`,
        index: idx,
        type: "image",
        image: { originalUrl: url, displayUrl: url, thumbnailUrl: url }
      });
    }
  }

  const coverAsset = builtAssets[0] ?? null;
  const coverImage = asRecord((coverAsset as AnyRecord | null)?.image);
  const coverVideo = asRecord((coverAsset as AnyRecord | null)?.video);
  return {
    status: "ready",
    assetCount: builtAssets.length,
    rawAssetCount: assetsInput.length || builtAssets.length,
    hasMultipleAssets: builtAssets.length > 1,
    primaryAssetId: coverAsset?.id ?? null,
    coverAssetId: coverAsset?.id ?? null,
    assets: builtAssets,
    cover:
      coverAsset?.type === "image"
        ? { url: (coverImage?.displayUrl as string | undefined) ?? (coverImage?.originalUrl as string | undefined) ?? null, thumbUrl: (coverImage?.thumbnailUrl as string | undefined) ?? null }
        : { url: (coverVideo?.posterUrl as string | undefined) ?? null, thumbUrl: (coverVideo?.posterUrl as string | undefined) ?? null }
  };
}

function first<T>(...values: T[]): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null && `${v}` !== "") return v;
  }
  return undefined;
}

export function buildRestorePayloadFromBackupSource(input: {
  postId: string;
  backupDocId: string;
  backup: AnyRecord;
  sourceName: ResolveRestoreSourceResult["sourceName"];
  sourcePayload: AnyRecord;
}): AnyRecord {
  const rawBefore = asRecord(input.backup.rawBefore);
  const source = deepClone(input.sourcePayload);
  const payload: AnyRecord =
    input.sourceName === "canonicalPreview" && asRecord(source.postDoc)
      ? deepClone(asRecord(source.postDoc) as AnyRecord)
      : deepClone(source);

  payload.id = input.postId;
  payload.postId = input.postId;
  payload.media = buildCanonicalMediaFromSource(payload, rawBefore);

  const author = asRecord(payload.author) ?? {};
  const text = asRecord(payload.text) ?? {};
  const location = asRecord(payload.location) ?? {};
  const coordinates = asRecord(location.coordinates) ?? {};
  const classification = asRecord(payload.classification) ?? {};
  const engagement = asRecord(payload.engagement) ?? {};
  const compatibility = asRecord(payload.compatibility) ?? {};
  const lifecycle = asRecord(payload.lifecycle) ?? {};

  payload.author = {
    ...author,
    userId: first(author.userId as string | undefined, payload.userId as string | undefined, rawBefore?.userId as string | undefined),
    displayName: first(author.displayName as string | undefined, payload.userName as string | undefined, rawBefore?.userName as string | undefined),
    handle: first(author.handle as string | undefined, payload.userHandle as string | undefined, rawBefore?.userHandle as string | undefined),
    profilePicUrl: first(author.profilePicUrl as string | undefined, payload.userPic as string | undefined, rawBefore?.userPic as string | undefined)
  };
  payload.text = {
    ...text,
    title: first(text.title as string | undefined, payload.title as string | undefined, rawBefore?.title as string | undefined),
    content: first(
      text.content as string | undefined,
      (payload.content as string | undefined) ?? (payload.caption as string | undefined),
      rawBefore?.content as string | undefined
    )
  };
  payload.location = {
    ...location,
    coordinates: {
      ...coordinates,
      lat: first(coordinates.lat as number | undefined, payload.lat as number | undefined, rawBefore?.lat as number | undefined),
      lng: first(coordinates.lng as number | undefined, payload.long as number | undefined, rawBefore?.long as number | undefined)
    }
  };
  const mediaRecord = asRecord(payload.media) ?? {};
  payload.classification = {
    ...classification,
    mediaKind: first(
      classification.mediaKind as string | undefined,
      payload.mediaType as string | undefined,
      (Array.isArray(mediaRecord.assets) && (mediaRecord.assets as AnyRecord[]).find((a) => a.type === "video") ? "video" : "image") as
        | string
        | undefined
    ),
    activities: first(classification.activities as unknown, payload.activities as unknown, rawBefore?.activities as unknown),
    privacyLabel: first(classification.privacyLabel as string | undefined, payload.privacy as string | undefined, rawBefore?.privacy as string | undefined)
  };
  payload.engagement = {
    ...engagement,
    likeCount: first(engagement.likeCount as number | undefined, payload.likesCount as number | undefined, rawBefore?.likesCount as number | undefined, 0),
    commentCount: first(
      engagement.commentCount as number | undefined,
      payload.commentsCount as number | undefined,
      rawBefore?.commentsCount as number | undefined,
      Array.isArray(rawBefore?.comments) ? rawBefore?.comments.length : undefined,
      0
    ),
    likesVersion: first(engagement.likesVersion as number | undefined, payload.likesVersion as number | undefined),
    commentsVersion: first(engagement.commentsVersion as number | undefined, payload.commentsVersion as number | undefined)
  };
  payload.engagementPreview = asRecord(payload.engagementPreview) ?? asRecord(rawBefore?.engagementPreview) ?? {};
  payload.lifecycle = {
    ...lifecycle,
    status: first(lifecycle.status as string | undefined, payload.status as string | undefined, "live"),
    createdAt: first(lifecycle.createdAt as string | undefined, payload.time as string | undefined),
    updatedAt: first(lifecycle.updatedAt as string | undefined, payload.updatedAt as string | undefined),
    createdAtMs: first(
      lifecycle.createdAtMs as number | undefined,
      rawBefore?.createdAtMs as number | undefined,
      typeof payload.time === "number" ? payload.time : undefined
    )
  };
  payload.compatibility = {
    ...compatibility,
    photoLink: first(
      compatibility.photoLink as string | undefined,
      payload.photoLink as string | undefined,
      (asRecord(mediaRecord.cover)?.url as string | undefined),
      rawBefore?.photoLink as string | undefined
    ),
    displayPhotoLink: first(
      compatibility.displayPhotoLink as string | undefined,
      payload.displayPhotoLink as string | undefined,
      (asRecord(mediaRecord.cover)?.url as string | undefined),
      rawBefore?.displayPhotoLink as string | undefined
    ),
    thumbUrl: first(
      compatibility.thumbUrl as string | undefined,
      payload.thumbUrl as string | undefined,
      (asRecord(mediaRecord.cover)?.thumbUrl as string | undefined),
      rawBefore?.thumbUrl as string | undefined
    )
  };

  const authorRec = asRecord(payload.author) ?? {};
  const textRec = asRecord(payload.text) ?? {};
  const classRec = asRecord(payload.classification) ?? {};
  const locRec = asRecord(payload.location) ?? {};
  const coordsRec = asRecord(locRec.coordinates) ?? {};
  const compatRec = asRecord(payload.compatibility) ?? {};
  const engageRec = asRecord(payload.engagement) ?? {};
  const lifecycleRec = asRecord(payload.lifecycle) ?? {};
  payload.userId = authorRec.userId;
  payload.userName = authorRec.displayName;
  payload.userHandle = authorRec.handle;
  payload.userPic = authorRec.profilePicUrl;
  payload.title = textRec.title;
  payload.content = textRec.content;
  payload.activities = classRec.activities ?? payload.activities ?? [];
  payload.privacy = classRec.privacyLabel ?? payload.privacy ?? "public";
  payload.settingType = first(payload.settingType as string | undefined, rawBefore?.settingType as string | undefined, "public");
  payload.reel = first(payload.reel as boolean | undefined, rawBefore?.reel as boolean | undefined, false);
  payload.isBoosted = first(payload.isBoosted as boolean | undefined, rawBefore?.isBoosted as boolean | undefined, false);
  payload.showLikes = first(payload.showLikes as boolean | undefined, rawBefore?.showLikes as boolean | undefined, true);
  payload.showComments = first(payload.showComments as boolean | undefined, rawBefore?.showComments as boolean | undefined, true);
  payload.lat = coordsRec.lat ?? payload.lat ?? rawBefore?.lat;
  payload.long = coordsRec.lng ?? payload.long ?? rawBefore?.long;
  payload.geohash = first(payload.geohash as string | undefined, rawBefore?.geohash as string | undefined);
  payload.countryRegionId = first(payload.countryRegionId as string | undefined, rawBefore?.countryRegionId as string | undefined);
  payload.stateRegionId = first(payload.stateRegionId as string | undefined, rawBefore?.stateRegionId as string | undefined);
  payload.cityRegionId = first(payload.cityRegionId as string | undefined, rawBefore?.cityRegionId as string | undefined);
  payload.photoLink = compatRec.photoLink;
  payload.displayPhotoLink = compatRec.displayPhotoLink;
  payload.thumbUrl = compatRec.thumbUrl;
  payload.mediaType = classRec.mediaKind;
  payload.assetsReady = first(payload.assetsReady as boolean | undefined, Array.isArray(mediaRecord.assets) && mediaRecord.assets.length > 0, false);
  payload.likesCount = engageRec.likeCount;
  payload.commentsCount = engageRec.commentCount;
  payload.likesVersion = engageRec.likesVersion ?? payload.likesVersion;
  payload.commentsVersion = engageRec.commentsVersion ?? payload.commentsVersion;
  payload.time = first(payload.time as unknown, rawBefore?.time as unknown, lifecycleRec.createdAt as unknown);
  payload.updatedAt = first(payload.updatedAt as unknown, rawBefore?.updatedAt as unknown, lifecycleRec.updatedAt as unknown);
  payload.lastUpdated = first(payload.lastUpdated as unknown, rawBefore?.lastUpdated as unknown, payload.updatedAt as unknown);

  const schema = asRecord(payload.schema) ?? {};
  payload.schema = {
    ...schema,
    restoredFromCanonicalBackup: true,
    restoreBackupDocId: input.backupDocId,
    restoreSourceName: input.sourceName,
    sourceShape: input.sourceName === "optimizedRaw" ? "optimizedRaw_restore" : schema.sourceShape
  };
  return payload;
}

function applyPreviewSchemaMetadata(payload: AnyRecord, backupDocId: string, previewIsoTimestamp: string): void {
  const prior = payload.schema && typeof payload.schema === "object" ? { ...(payload.schema as AnyRecord) } : {};
  payload.schema = {
    ...prior,
    restoredFromCanonicalBackup: true,
    restoredAt: previewIsoTimestamp,
    restoreBackupDocId: backupDocId,
    restorePreviewOnly: true
  };
}

export function normalizeRestoreTimestamps(payload: AnyRecord, backupData: AnyRecord, backupDocId: string): {
  payload: AnyRecord;
  timestampPreview: Record<string, Record<string, unknown>>;
} {
  const rawBefore = backupData.rawBefore && typeof backupData.rawBefore === "object" ? (backupData.rawBefore as AnyRecord) : {};
  const out = payload;
  const timestampPreview: Record<string, Record<string, unknown>> = {};

  const setTs = (field: string, sourceValue: unknown, fallbackValue: unknown, sourceLabel: string) => {
    const ts = toFirestoreTimestamp(sourceValue ?? fallbackValue);
    if (ts) {
      out[field] = ts;
      timestampPreview[field] = { type: "FirestoreTimestamp", source: sourceLabel, seconds: ts.seconds };
    }
  };

  setTs("time", rawBefore.time, out.time ?? (out.lifecycle as AnyRecord | undefined)?.createdAt, "backup.rawBefore.time");
  setTs(
    "updatedAt",
    rawBefore.updatedAt,
    out.updatedAt ?? (out.lifecycle as AnyRecord | undefined)?.updatedAt,
    "backup.rawBefore.updatedAt"
  );
  setTs("lastUpdated", rawBefore.lastUpdated, out.lastUpdated ?? out.updatedAt, "backup.rawBefore.lastUpdated");
  setTs("likeBoostScheduledAt", rawBefore.likeBoostScheduledAt, out.likeBoostScheduledAt, "backup.rawBefore.likeBoostScheduledAt");

  const schema = out.schema && typeof out.schema === "object" ? { ...(out.schema as AnyRecord) } : {};
  schema.restoredFromCanonicalBackup = true;
  schema.restoreBackupDocId = backupDocId;
  schema.restoredAt = Timestamp.now();
  if (!schema.restoreSourceName) schema.restoreSourceName = "unknown";
  out.schema = schema;
  timestampPreview.schemaRestoredAt = { type: "FirestoreTimestamp", source: "Timestamp.now", seconds: (schema.restoredAt as Timestamp).seconds };

  const lifecycle = out.lifecycle && typeof out.lifecycle === "object" ? (out.lifecycle as AnyRecord) : null;
  if (lifecycle) {
    timestampPreview.lifecycleCreatedAt = {
      type: typeof lifecycle.createdAt,
      preservedCanonicalString: typeof lifecycle.createdAt === "string",
      hasCreatedAtMs: typeof lifecycle.createdAtMs === "number"
    };
  }

  const ranking = out.ranking && typeof out.ranking === "object" ? (out.ranking as AnyRecord) : null;
  const rankingAgg = ranking?.aggregates && typeof ranking.aggregates === "object" ? (ranking.aggregates as AnyRecord) : null;
  const rankingAggregates = out.rankingAggregates && typeof out.rankingAggregates === "object" ? (out.rankingAggregates as AnyRecord) : null;
  const raTs = toFirestoreTimestamp(rankingAgg?.lastAggregatedAt);
  if (raTs && rankingAgg) rankingAgg.lastAggregatedAt = raTs;
  const ra2Ts = toFirestoreTimestamp(rankingAggregates?.lastAggregatedAt);
  if (ra2Ts && rankingAggregates) rankingAggregates.lastAggregatedAt = ra2Ts;

  return { payload: out, timestampPreview };
}

function getMediaRecord(payload: AnyRecord): AnyRecord | null {
  const m = payload.media;
  return m && typeof m === "object" && !Array.isArray(m) ? (m as AnyRecord) : null;
}

export function validateRestorePayloadForPreview(payload: AnyRecord): {
  valid: boolean;
  warnings: string[];
  errors: string[];
  checks: {
    hasId: boolean;
    hasPostId: boolean;
    hasMedia: boolean;
    hasMediaAssets: boolean;
    hasAuthor: boolean;
    hasText: boolean;
    hasLocation: boolean;
    hasLifecycle: boolean;
    hasClassification: boolean;
    hasCompatibilityOrCover: boolean;
    hasEngagement: boolean;
  };
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  const hasId = typeof payload.id === "string" && payload.id.trim().length > 0;
  const hasPostId = typeof payload.postId === "string" && payload.postId.trim().length > 0;

  const media = getMediaRecord(payload);
  const hasMedia = Boolean(media);
  const hasMediaAssets = Boolean(media && Array.isArray(media.assets) && media.assets.length > 0);
  const hasMeaningfulMediaObject = Boolean(media && Object.keys(media).length > 0);
  const mediaOk = hasMedia && (hasMediaAssets || hasMeaningfulMediaObject);

  const author = payload.author && typeof payload.author === "object" ? (payload.author as AnyRecord) : null;
  const hasAuthor = Boolean(author || (typeof payload.userId === "string" && payload.userId.trim().length > 0));

  const text = payload.text && typeof payload.text === "object" ? (payload.text as AnyRecord) : null;
  const hasText = Boolean(
    (text && (typeof text.title === "string" || typeof text.content === "string" || typeof text.body === "string")) ||
      (typeof payload.title === "string" && payload.title.trim().length > 0) ||
      (typeof payload.caption === "string" && payload.caption.trim().length > 0) ||
      typeof payload.text === "string"
  );

  const loc = payload.location && typeof payload.location === "object" ? (payload.location as AnyRecord) : null;
  const latOk = typeof payload.lat === "number" || typeof payload.lat === "string";
  const lngOk =
    typeof payload.long === "number" ||
    typeof payload.long === "string" ||
    typeof payload.lng === "number" ||
    typeof payload.lng === "string";
  const hasLocation = Boolean(loc || (latOk && lngOk));

  const lifecycle = payload.lifecycle && typeof payload.lifecycle === "object";
  const hasLifecycle = Boolean(lifecycle || (typeof payload.status === "string" && payload.status.trim().length > 0));

  const classification = payload.classification && typeof payload.classification === "object" ? (payload.classification as AnyRecord) : null;
  const hasClassification = Boolean(
    classification || (typeof payload.mediaKind === "string" && payload.mediaKind.trim().length > 0)
  );

  const compat = payload.compatibility && typeof payload.compatibility === "object";
  const cover = media && typeof media.cover === "object";
  const hasCompatibilityOrCover = Boolean(compat || cover);

  const engagement = payload.engagement && typeof payload.engagement === "object";
  const hasEngagement = Boolean(engagement);

  if (!hasId) errors.push("missing_id");
  if (!hasPostId) errors.push("missing_postId");
  if (!mediaOk) {
    if (!hasMedia) errors.push("missing_media_object");
    else errors.push("missing_media_assets_or_meaningful_media_object");
  }
  if (hasMedia && !hasMediaAssets && hasMeaningfulMediaObject) {
    warnings.push("media_object_without_assets_array");
  }
  if (!hasAuthor) errors.push("missing_author_or_userId");
  if (!hasText) errors.push("missing_text_title_or_caption");
  if (!hasLocation) errors.push("missing_location_or_lat_long");
  if (!hasLifecycle) errors.push("missing_lifecycle_or_status");
  if (!hasClassification) errors.push("missing_classification_or_mediaKind");
  if (!hasCompatibilityOrCover) errors.push("missing_compatibility_or_media_cover");
  if (!hasEngagement) errors.push("missing_engagement");

  const checks = {
    hasId,
    hasPostId,
    hasMedia,
    hasMediaAssets,
    hasAuthor,
    hasText,
    hasLocation,
    hasLifecycle,
    hasClassification,
    hasCompatibilityOrCover,
    hasEngagement
  };

  return { valid: errors.length === 0, warnings, errors, checks };
}

function buildRestorePayloadSummary(payload: AnyRecord, backupData: AnyRecord): Record<string, unknown> {
  const media = getMediaRecord(payload);
  const assets = media && Array.isArray(media.assets) ? (media.assets as AnyRecord[]) : [];
  const author = payload.author && typeof payload.author === "object" ? (payload.author as AnyRecord) : null;
  const text = payload.text && typeof payload.text === "object" ? (payload.text as AnyRecord) : null;
  const classification = payload.classification && typeof payload.classification === "object" ? (payload.classification as AnyRecord) : null;
  const engagement = payload.engagement && typeof payload.engagement === "object" ? (payload.engagement as AnyRecord) : null;
  const auditRecommended =
    backupData.engagementSourceAudit &&
    typeof backupData.engagementSourceAudit === "object" &&
    (backupData.engagementSourceAudit as AnyRecord).recommendedCanonical &&
    typeof (backupData.engagementSourceAudit as AnyRecord).recommendedCanonical === "object"
      ? ((backupData.engagementSourceAudit as AnyRecord).recommendedCanonical as AnyRecord)
      : null;
  const presentation = media?.presentation && typeof media.presentation === "object" ? (media.presentation as AnyRecord) : null;

  const first = assets[0] ?? null;
  return {
    id: payload.id ?? null,
    mediaKind: classification?.mediaKind ?? payload.mediaKind ?? null,
    assetCount: assets.length,
    firstAssetType: first && typeof first.type === "string" ? first.type : null,
    title: (text?.title as string | undefined) ?? (typeof payload.title === "string" ? payload.title : null),
    authorUserId: (author?.userId as string | undefined) ?? (typeof payload.userId === "string" ? payload.userId : null),
    authorHandle: (author?.handle as string | undefined) ?? (typeof payload.userHandle === "string" ? payload.userHandle : null),
    lat: payload.lat ?? null,
    lng: payload.long ?? payload.lng ?? null,
    likeCount:
      (engagement?.likeCount as number | undefined) ??
      (payload.likesCount as number | undefined) ??
      (payload.likeCount as number | undefined) ??
      (auditRecommended?.likeCount as number | undefined) ??
      null,
    commentCount:
      (engagement?.commentCount as number | undefined) ??
      (payload.commentsCount as number | undefined) ??
      (payload.commentCount as number | undefined) ??
      (auditRecommended?.commentCount as number | undefined) ??
      null,
    likesVersion:
      (engagement?.likesVersion as number | undefined) ??
      (payload.likesVersion as number | undefined) ??
      null,
    commentsVersion:
      (engagement?.commentsVersion as number | undefined) ??
      (payload.commentsVersion as number | undefined) ??
      null,
    hasCompactMedia: Boolean(media),
    hasLetterboxGradient: Boolean(
      presentation?.letterboxGradient ?? media?.letterboxGradient ?? payload.letterboxGradient
    ),
    byteEstimate: Buffer.byteLength(JSON.stringify(payload), "utf8")
  };
}

export type BuildRestorePreviewFromCanonicalBackupReadOnlyInput = {
  projectId: string | null;
  backupDocId: string;
  backupData: AnyRecord;
  currentPostExists: boolean;
  currentPostData: AnyRecord | null;
  backupField: CanonicalBackupField;
  allowOverwrite: boolean;
  /** ISO timestamp string used only in preview schema metadata */
  previewIsoTimestamp: string;
  allowRawRestore?: boolean;
};

export type BuildRestorePreviewFromCanonicalBackupReadOnlyResult =
  | {
      ok: true;
      dryRun: true;
      readOnly: true;
      wrote: false;
      NO_FIRESTORE_WRITE_PERFORMED: "NO_FIRESTORE_WRITE_PERFORMED";
      projectId: string | null;
      backupDocId: string;
      inferredPostId: string;
      timestampMs: number | null;
      backupFieldUsed: CanonicalBackupField;
      currentPostDoc: {
        path: string;
        exists: boolean;
        fieldCount: number;
        state: CurrentPostParentState;
        sampleFields: string[];
      };
      decision: {
        wouldWrite: boolean;
        writeMode: RestorePreviewWriteMode;
        reason: string;
        allowOverwrite: boolean;
      };
      validation: ReturnType<typeof validateRestorePayloadForPreview>;
      restorePayloadSummary: Record<string, unknown>;
      restorePayloadPreview: AnyRecord;
      sourceName: ResolveRestoreSourceResult["sourceName"];
      sourceQuality: ResolveRestoreSourceResult["sourceQuality"];
      canApplySafely: boolean;
      requiresManualRawRestore: boolean;
      sourceReason: string;
      fieldCandidates: ResolveRestoreSourceResult["fieldCandidates"];
      timestampPreview: Record<string, Record<string, unknown>>;
    }
  | {
      ok: false;
      dryRun: true;
      readOnly: true;
      wrote: false;
      NO_FIRESTORE_WRITE_PERFORMED: "NO_FIRESTORE_WRITE_PERFORMED";
      error: string;
      backupDocId: string;
      inferredPostId?: string;
      backupFieldUsed?: CanonicalBackupField;
    };

export function buildRestorePreviewFromCanonicalBackupReadOnly(
  input: BuildRestorePreviewFromCanonicalBackupReadOnlyInput
): BuildRestorePreviewFromCanonicalBackupReadOnlyResult {
  const { postId, timestampMs } = parseBackupDocId(input.backupDocId);
  const baseMeta = {
    dryRun: true as const,
    readOnly: true as const,
    wrote: false as const,
    NO_FIRESTORE_WRITE_PERFORMED: "NO_FIRESTORE_WRITE_PERFORMED" as const,
    backupDocId: input.backupDocId
  };

  const resolvedSource = resolveCanonicalBackupRestoreSource(input.backupData, input.backupField);
  if (!resolvedSource.sourcePayload || resolvedSource.sourceName === "none") {
    return {
      ok: false,
      ...baseMeta,
      error: "backup_field_missing_or_invalid",
      inferredPostId: postId,
      backupFieldUsed: input.backupField
    };
  }
  if (resolvedSource.requiresManualRawRestore && !input.allowRawRestore) {
    return {
      ok: false,
      ...baseMeta,
      error: "raw_before_preview_only_requires_explicit_raw_restore",
      inferredPostId: postId,
      backupFieldUsed: input.backupField
    };
  }

  const restorePayloadPreview = buildRestorePayloadFromBackupSource({
    postId,
    backupDocId: input.backupDocId,
    backup: input.backupData,
    sourceName: resolvedSource.sourceName,
    sourcePayload: resolvedSource.sourcePayload
  });
  applyPreviewSchemaMetadata(restorePayloadPreview, input.backupDocId, input.previewIsoTimestamp);
  const normalized = normalizeRestoreTimestamps(restorePayloadPreview, input.backupData, input.backupDocId);

  const postPath = `posts/${postId}`;
  const data = input.currentPostData ?? {};
  const fieldCount = Object.keys(data).length;
  const exists = input.currentPostExists;
  let state: CurrentPostParentState;
  if (!exists) state = "missing";
  else if (!hasMeaningfulParentFields(data)) state = "empty";
  else state = "has_data";

  const sampleFields = Object.keys(data).slice(0, 12);

  let wouldWrite: boolean;
  let writeMode: RestorePreviewWriteMode;
  let reason: string;

  if (state === "missing" || state === "empty") {
    wouldWrite = true;
    writeMode = "create_parent_doc";
    reason = "Parent document is missing or empty; restore would create/replace parent fields only (subcollections untouched).";
  } else if (!input.allowOverwrite) {
    wouldWrite = false;
    writeMode = "skip_existing_doc";
    reason = "Parent document already has data and allowOverwrite=false.";
  } else {
    wouldWrite = true;
    writeMode = "overwrite_existing_doc";
    reason = "Parent has data but allowOverwrite=true; a real restore would overwrite parent doc (preview only here).";
  }

  const validation = validateRestorePayloadForPreview(normalized.payload);
  const restorePayloadSummary = buildRestorePayloadSummary(normalized.payload, input.backupData);

  return {
    ok: true,
    ...baseMeta,
    projectId: input.projectId,
    inferredPostId: postId,
    timestampMs,
    backupFieldUsed: resolvedSource.sourceName as CanonicalBackupField,
    currentPostDoc: {
      path: postPath,
      exists,
      fieldCount,
      state,
      sampleFields
    },
    decision: {
      wouldWrite,
      writeMode,
      reason,
      allowOverwrite: input.allowOverwrite
    },
    validation,
    restorePayloadSummary,
    restorePayloadPreview: normalized.payload,
    sourceName: resolvedSource.sourceName,
    sourceQuality: resolvedSource.sourceQuality,
    canApplySafely: resolvedSource.canApplySafely,
    requiresManualRawRestore: resolvedSource.requiresManualRawRestore,
    sourceReason: resolvedSource.reason,
    fieldCandidates: resolvedSource.fieldCandidates,
    timestampPreview: normalized.timestampPreview
  };
}
