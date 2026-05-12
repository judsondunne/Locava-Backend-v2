import type {
  AppPostAssetV2,
  AppPostClassificationV2,
  AppPostCompatibilityV2,
  AppPostEngagementPreviewV2,
  AppPostEngagementV2,
  AppPostImageAssetV2,
  AppPostLifecycleV2,
  AppPostLocationV2,
  AppPostMediaV2,
  AppPostRecentCommentPreviewV2,
  AppPostRecentLikerV2,
  AppPostSchemaV2,
  AppPostTextV2,
  AppPostV2,
  AppPostVideoAssetV2,
  AppPostVideoBlockV2,
  AppPostVideoPlaybackV2,
  AppPostVideoVariantsV2,
  AppPostViewerStateV2,
  AppPostChatSharedPostProjectionV2,
  AppPostCollectionPostProjectionV2,
  AppPostDetailProjectionV2,
  AppPostFeedCardV2,
  AppPostMapMarkerProjectionV2,
  AppPostNotificationPreviewProjectionV2,
  AppPostProfileGridProjectionV2,
  AppPostSearchResultProjectionV2
} from "../../../contracts/app-post-v2.contract.js";
import type {
  MasterPostAssetV2,
  MasterPostClassificationV2,
  MasterPostCompatibilityV2,
  MasterPostEngagementV2,
  MasterPostLifecycleV2,
  MasterPostLocationV2,
  MasterPostMediaV2,
  MasterPostRecentCommentPreviewV2,
  MasterPostV2,
  MasterPostVideoBlockV2,
  PostEngagementSourceAuditV2
} from "../../../contracts/master-post-v2.types.js";
import { normalizeMasterPostV2 } from "../master-post-v2/normalizeMasterPostV2.js";
import {
  buildSafeDisplayTextBlock,
  sanitizeHydratedPostDisplayText,
  type PostDocLike,
} from "../displayText.js";
import { debugLog } from "../../logging/debug-log.js";
import { LOG_VIDEO_DEBUG } from "../../logging/log-config.js";
import { isPendingPlaceholderUrl } from "../../../services/posting/photo-url-guards.js";

type RawPost = Record<string, unknown>;

export type ToMasterPostV2FromAnyOptions = {
  postId?: string;
  now?: Date;
  preserveRawLegacy?: boolean;
  strict?: boolean;
  engagementSourceAudit?: PostEngagementSourceAuditV2 | null;
  /** When true, always run `normalizeMasterPostV2` even for stored canonical docs. */
  forceNormalize?: boolean;
};

export type ToAppPostV2Options = ToMasterPostV2FromAnyOptions & {
  viewerState?: Partial<AppPostViewerStateV2> | null;
};

const VARIANT_KEYS = [
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
] as const;

function pickStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function pickImageStr(v: unknown): string | null {
  const value = pickStr(v);
  if (!value) return null;
  return isPendingPlaceholderUrl(value) ? null : value;
}

function isLikelyVideoUrl(value: unknown): boolean {
  const raw = pickStr(value);
  if (!raw) return false;
  return /\.(mp4|mov|m4v|webm|m3u8)(\?|$)/i.test(raw);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function isStoredCanonicalMasterPostV2(raw: RawPost): boolean {
  const schema = asRecord(raw.schema);
  const ver = schema?.version;
  const versionNum = typeof ver === "number" ? ver : typeof ver === "string" ? Number(ver) : NaN;
  if (!(schema?.name === "locava.post" && versionNum === 2 && Array.isArray(asRecord(raw.media)?.assets))) {
    return false;
  }
  // Feed/list projections can carry schema+media but omit required canonical sections.
  // Only bypass normalize when core canonical blocks are present.
  const lifecycle = asRecord(raw.lifecycle);
  const classification = asRecord(raw.classification);
  const engagement = asRecord(raw.engagement);
  const author = asRecord(raw.author);
  return Boolean(
    lifecycle &&
      typeof lifecycle.status === "string" &&
      classification &&
      typeof classification.mediaKind === "string" &&
      engagement &&
      typeof engagement.likeCount === "number" &&
      typeof engagement.commentCount === "number" &&
      author &&
      typeof author.userId === "string"
  );
}

/**
 * Prefer highest verified progressive MP4 for primary playback; keep startup/preview separate.
 */
function refineVideoPlayback(video: MasterPostVideoBlockV2): AppPostVideoPlaybackV2 {
  const p = video.playback;
  const pAny = p as unknown as Record<string, unknown>;
  const goodNetworkUrl = pickStr(pAny.goodNetworkUrl);
  const weakNetworkUrl = pickStr(pAny.weakNetworkUrl);
  const poorNetworkUrl = pickStr(pAny.poorNetworkUrl);
  const hq =
    pickStr(p.highQualityUrl) ??
    pickStr(p.upgradeUrl) ??
    pickStr(p.primaryUrl) ??
    pickStr(p.defaultUrl);
  const primary =
    hq ??
    pickStr(p.primaryUrl) ??
    pickStr(p.defaultUrl) ??
    pickStr(p.fallbackUrl);
  const startup = goodNetworkUrl ?? pickStr(p.startupUrl);
  const defaultUrl = goodNetworkUrl ?? pickStr(p.defaultUrl) ?? primary;
  const primaryUrl = goodNetworkUrl ?? primary;
  const preview = pickStr(p.previewUrl);
  return {
    defaultUrl,
    primaryUrl,
    startupUrl: startup,
    highQualityUrl: pickStr(p.highQualityUrl) ?? pickStr(p.upgradeUrl) ?? primary,
    upgradeUrl: pickStr(p.upgradeUrl),
    hlsUrl: pickStr(p.hlsUrl),
    fallbackUrl: pickStr(p.fallbackUrl),
    previewUrl: preview,
    goodNetworkUrl,
    weakNetworkUrl,
    poorNetworkUrl,
    selectedReason: pickStr(pAny.selectedReason)
  };
}

function mapVariants(variants: Record<string, unknown>): AppPostVideoVariantsV2 {
  const out = {} as AppPostVideoVariantsV2;
  for (const k of VARIANT_KEYS) {
    const raw = variants[k];
    out[k] = pickStr(raw) ?? null;
  }
  return out;
}

function mapVideoBlock(video: MasterPostVideoBlockV2): AppPostVideoBlockV2 {
  const variants = mapVariants((video.variants ?? {}) as Record<string, unknown>);
  const poster = pickStr(video.posterUrl);
  const thumb =
    poster ??
    pickStr(variants.preview360Avc) ??
    pickStr(variants.preview360) ??
    null;
  return {
    originalUrl: pickStr(video.originalUrl),
    posterUrl: poster,
    posterHighUrl: pickStr(video.posterHighUrl),
    thumbnailUrl: thumb,
    durationSec: typeof video.durationSec === "number" && Number.isFinite(video.durationSec) ? video.durationSec : null,
    hasAudio: typeof video.hasAudio === "boolean" ? video.hasAudio : null,
    playback: refineVideoPlayback(video),
    variants,
    readiness: {
      assetsReady: video.readiness.assetsReady,
      instantPlaybackReady: video.readiness.instantPlaybackReady,
      faststartVerified: video.readiness.faststartVerified,
      processingStatus: pickStr(video.readiness.processingStatus)
    },
    technical: {
      sourceCodec: pickStr(video.technical.sourceCodec),
      playbackCodec: pickStr(video.technical.playbackCodec),
      audioCodec: pickStr(video.technical.audioCodec),
      bitrateKbps:
        typeof video.bitrateKbps === "number" && Number.isFinite(video.bitrateKbps) ? Math.floor(video.bitrateKbps) : null,
      sizeBytes: typeof video.sizeBytes === "number" && Number.isFinite(video.sizeBytes) ? Math.floor(video.sizeBytes) : null,
      width: null,
      height: null
    }
  };
}

function mapAsset(a: MasterPostAssetV2): AppPostAssetV2 {
  const presentation = {
    letterboxGradient: a.presentation?.letterboxGradient ?? null,
    ...(typeof a.presentation?.carouselFitWidth === "boolean" ? { carouselFitWidth: a.presentation.carouselFitWidth } : {}),
    ...(typeof a.presentation?.resizeMode === "string" && a.presentation.resizeMode
      ? { resizeMode: a.presentation.resizeMode as "cover" | "contain" }
      : {})
  };
  const imageOriginal = pickImageStr(a.image?.originalUrl);
  const imageDisplay = pickImageStr(a.image?.displayUrl);
  const imageThumb = pickImageStr(a.image?.thumbnailUrl);
  const fallbackVideoLikeUrl =
    (isLikelyVideoUrl(imageOriginal) ? imageOriginal : null) ??
    (isLikelyVideoUrl(imageDisplay) ? imageDisplay : null) ??
    (isLikelyVideoUrl(imageThumb) ? imageThumb : null) ??
    null;
  const treatAsVideo = (a.type === "video" && Boolean(a.video)) || Boolean(a.video) || Boolean(fallbackVideoLikeUrl);
  if (treatAsVideo) {
    const video = a.video
      ? mapVideoBlock(a.video)
      : mapVideoBlock({
          originalUrl: fallbackVideoLikeUrl,
          posterUrl: imageDisplay ?? imageThumb,
          posterHighUrl: imageDisplay ?? imageThumb,
          playback: {
            defaultUrl: fallbackVideoLikeUrl,
            primaryUrl: fallbackVideoLikeUrl,
            startupUrl: fallbackVideoLikeUrl,
            highQualityUrl: fallbackVideoLikeUrl,
            upgradeUrl: null,
            hlsUrl: null,
            fallbackUrl: fallbackVideoLikeUrl,
            previewUrl: imageThumb ?? imageDisplay
          },
          variants: {},
          durationSec: null,
          hasAudio: null,
          codecs: null,
          technical: {
            sourceCodec: null,
            playbackCodec: null,
            audioCodec: null
          },
          bitrateKbps: null,
          sizeBytes: null,
          readiness: {
            assetsReady: null,
            instantPlaybackReady: null,
            faststartVerified: null,
            processingStatus: null
          }
        });
    const startup = pickStr(video.playback.startupUrl);
    const playbackDefault = pickStr(video.playback.defaultUrl);
    const playbackPrimary = pickStr(video.playback.primaryUrl);
    const compatibilityUrl = startup ?? playbackDefault ?? playbackPrimary ?? pickStr(video.originalUrl) ?? null;
    const row: AppPostVideoAssetV2 = {
      id: a.id,
      index: a.index,
      type: "video",
      mediaType: "video",
      posterUrl: pickStr(video.posterUrl),
      thumbUrl: pickStr(video.thumbnailUrl),
      imageUrl: pickStr(video.posterUrl) ?? pickStr(video.thumbnailUrl) ?? null,
      image: null,
      video,
      playback: { ...video.playback },
      url: compatibilityUrl,
      videoUrl: compatibilityUrl,
      fallbackVideoUrl: pickStr(video.playback.fallbackUrl) ?? pickStr(video.originalUrl),
      presentation
    };
    return row;
  }
  const img = a.image;
  const row: AppPostImageAssetV2 = {
    id: a.id,
    index: a.index,
    type: "image",
    image: {
      originalUrl: pickStr(img?.originalUrl),
      displayUrl: pickStr(img?.displayUrl),
      thumbnailUrl: pickStr(img?.thumbnailUrl),
      blurhash: pickStr(img?.blurhash),
      width: typeof img?.width === "number" && Number.isFinite(img.width) ? img.width : null,
      height: typeof img?.height === "number" && Number.isFinite(img.height) ? img.height : null,
      aspectRatio: typeof img?.aspectRatio === "number" && Number.isFinite(img.aspectRatio) ? img.aspectRatio : null,
      orientation: pickStr(img?.orientation)
    },
    video: null,
    presentation
  };
  return row;
}

function mapMedia(media: MasterPostMediaV2): AppPostMediaV2 {
  const coverUrl = pickImageStr(media.cover?.url);
  const coverThumb = pickImageStr(media.cover?.thumbUrl);
  const coverPoster = pickImageStr(media.cover?.posterUrl);
  return {
    status: media.status,
    assetsReady: media.assetsReady,
    instantPlaybackReady: media.instantPlaybackReady,
    completeness: media.completeness,
    assetCount: media.assetCount,
    rawAssetCount: media.rawAssetCount,
    hasMultipleAssets: media.hasMultipleAssets,
    primaryAssetId: media.primaryAssetId,
    coverAssetId: media.coverAssetId,
    ...(media.presentation && (media.presentation.carouselFitWidth !== null || media.presentation.resizeMode != null)
      ? { presentation: { ...media.presentation } }
      : {}),
    cover: {
      ...media.cover,
      url: coverUrl,
      thumbUrl: coverThumb,
      posterUrl: coverPoster
    },
    assets: media.assets.map(mapAsset)
  };
}

function mapLifecycle(lifecycle: MasterPostLifecycleV2): AppPostLifecycleV2 {
  return {
    status: lifecycle.status,
    isDeleted: lifecycle.isDeleted,
    createdAt: lifecycle.createdAt,
    createdAtMs: lifecycle.createdAtMs,
    updatedAt: lifecycle.updatedAt
  };
}

function mapLocation(location: MasterPostLocationV2): AppPostLocationV2 {
  return {
    coordinates: { ...location.coordinates },
    display: { ...location.display },
    place: {
      ...location.place,
      source: location.place.source,
      precision: location.place.precision
    },
    regions: { ...location.regions }
  };
}

function mapClassification(c: MasterPostClassificationV2): AppPostClassificationV2 {
  return { ...c };
}

function mapText(text: MasterPostV2["text"], source: PostDocLike): AppPostTextV2 {
  const safe = buildSafeDisplayTextBlock({ ...source, text });
  return {
    title: safe.title || text.title,
    caption: safe.caption,
    description: safe.description,
    content: safe.content,
    searchableText: "",
  };
}

function mapEngagement(
  engagement: MasterPostEngagementV2,
  master: MasterPostV2
): AppPostEngagementV2 {
  const rollup = asRecord(master.ranking?.rollup);
  const savesVersionRaw = rollup?.savesVersion ?? rollup?.saveVersion;
  const savesVersionFromRollup =
    typeof savesVersionRaw === "number" && Number.isFinite(savesVersionRaw)
      ? Math.floor(savesVersionRaw)
      : typeof savesVersionRaw === "string" && savesVersionRaw.trim()
        ? Number(savesVersionRaw)
        : null;
  const savesVersionFromEngagement =
    typeof engagement.savesVersion === "number" && Number.isFinite(engagement.savesVersion)
      ? Math.floor(engagement.savesVersion)
      : null;
  const savesVersion = savesVersionFromEngagement ?? savesVersionFromRollup;
  return {
    likeCount: engagement.likeCount,
    commentCount: engagement.commentCount,
    saveCount: engagement.saveCount,
    shareCount: engagement.shareCount,
    viewCount: engagement.viewCount,
    likesVersion: engagement.likesVersion,
    commentsVersion: engagement.commentsVersion,
    savesVersion: savesVersion !== null && Number.isFinite(savesVersion) ? savesVersion : null,
    showLikes: engagement.showLikes,
    showComments: engagement.showComments
  };
}

function mapRecentLikers(rows: MasterPostV2["engagementPreview"]["recentLikers"]): AppPostRecentLikerV2[] {
  return rows.map((r: MasterPostV2["engagementPreview"]["recentLikers"][number]) => ({
    userId: r.userId,
    displayName: r.displayName,
    handle: r.handle,
    profilePicUrl: r.profilePicUrl,
    likedAt: r.likedAt
  }));
}

function mapRecentComments(rows: MasterPostRecentCommentPreviewV2[]): AppPostRecentCommentPreviewV2[] {
  return rows.map((r) => ({
    commentId: r.commentId,
    userId: r.userId,
    displayName: r.displayName,
    handle: r.handle,
    profilePicUrl: r.profilePicUrl,
    text: r.text,
    createdAt: r.createdAt,
    replyCount: r.replyCount
  }));
}

function mapEngagementPreview(prev: MasterPostV2["engagementPreview"]): AppPostEngagementPreviewV2 {
  return {
    recentLikers: mapRecentLikers(prev.recentLikers),
    recentComments: mapRecentComments(prev.recentComments)
  };
}

function mapCompatibility(c: MasterPostCompatibilityV2): AppPostCompatibilityV2 {
  return { ...c };
}

function defaultViewerState(overrides?: Partial<AppPostViewerStateV2> | null): AppPostViewerStateV2 {
  return {
    liked: overrides?.liked ?? false,
    saved: overrides?.saved ?? false,
    savedCollectionIds: Array.isArray(overrides?.savedCollectionIds) ? overrides.savedCollectionIds : [],
    followsAuthor: overrides?.followsAuthor ?? false
  };
}

function buildAppSchema(master: MasterPostV2, normalizedFromLegacy: boolean): AppPostSchemaV2 {
  return {
    name: "locava.appPost",
    version: 2,
    sourcePostSchemaVersion: master.schema.version,
    normalizedFromLegacy
  };
}

export function toMasterPostV2FromAny(rawPost: RawPost, options: ToMasterPostV2FromAnyOptions = {}): MasterPostV2 {
  const audit = options.engagementSourceAudit ?? null;
  if (!options.forceNormalize && !audit && isStoredCanonicalMasterPostV2(rawPost)) {
    try {
      return structuredClone(rawPost) as MasterPostV2;
    } catch {
      return normalizeMasterPostV2(rawPost as Record<string, unknown>, {
        postId: options.postId,
        now: options.now,
        preserveRawLegacy: options.preserveRawLegacy,
        strict: options.strict,
        engagementSourceAudit: null
      }).canonical;
    }
  }
  return normalizeMasterPostV2(rawPost as Record<string, unknown>, {
    postId: options.postId,
    now: options.now,
    preserveRawLegacy: options.preserveRawLegacy,
    strict: options.strict,
    engagementSourceAudit: audit
  }).canonical;
}

/** Same as {@link toMasterPostV2FromAny} but records whether the canonical doc was read directly vs normalized. */
export function toMasterPostV2FromAnyWithProvenance(
  rawPost: RawPost,
  options: ToMasterPostV2FromAnyOptions = {}
): { master: MasterPostV2; normalizedFromLegacy: boolean } {
  const audit = options.engagementSourceAudit ?? null;
  if (!options.forceNormalize && !audit && isStoredCanonicalMasterPostV2(rawPost)) {
    try {
      return { master: structuredClone(rawPost) as MasterPostV2, normalizedFromLegacy: false };
    } catch {
      return {
        master: normalizeMasterPostV2(rawPost as Record<string, unknown>, {
          postId: options.postId,
          now: options.now,
          preserveRawLegacy: options.preserveRawLegacy,
          strict: options.strict,
          engagementSourceAudit: null
        }).canonical,
        normalizedFromLegacy: true
      };
    }
  }
  return {
    master: normalizeMasterPostV2(rawPost as Record<string, unknown>, {
      postId: options.postId,
      now: options.now,
      preserveRawLegacy: options.preserveRawLegacy,
      strict: options.strict,
      engagementSourceAudit: audit
    }).canonical,
    normalizedFromLegacy: true
  };
}

export type ToAppPostV2CoreOptions = Pick<ToAppPostV2Options, "viewerState"> & {
  normalizedFromLegacy?: boolean;
};

export function toAppPostV2(master: MasterPostV2, options: ToAppPostV2CoreOptions = {}): AppPostV2 {
  const viewerState = defaultViewerState(options.viewerState ?? undefined);
  const normalizedFromLegacy =
    typeof options.normalizedFromLegacy === "boolean"
      ? options.normalizedFromLegacy
      : master.schema.sourceShape !== "unknown" && master.schema.sourceShape.startsWith("legacy_");
  const appPost: AppPostV2 = {
    id: master.id,
    schema: buildAppSchema(master, normalizedFromLegacy),
    lifecycle: mapLifecycle(master.lifecycle),
    author: { ...master.author },
    text: mapText(master.text, master as unknown as PostDocLike),
    location: mapLocation(master.location),
    classification: mapClassification(master.classification),
    media: mapMedia(master.media),
    engagement: mapEngagement(master.engagement, master),
    engagementPreview: mapEngagementPreview(master.engagementPreview),
    viewerState,
    compatibility: mapCompatibility(master.compatibility)
  };
  const firstVideo = appPost.media.assets.find((asset): asset is AppPostVideoAssetV2 => asset.type === "video");
  const compatibilityPlaybackUrl =
    pickStr(firstVideo?.video?.playback?.startupUrl) ??
    pickStr(firstVideo?.video?.playback?.defaultUrl) ??
    pickStr(firstVideo?.video?.playback?.primaryUrl) ??
    pickStr(firstVideo?.video?.playback?.fallbackUrl) ??
    pickStr(firstVideo?.video?.originalUrl) ??
    null;
  if (firstVideo) {
    appPost.mediaType = "video";
    appPost.photoLinks2 = compatibilityPlaybackUrl;
    appPost.photoLinks3 = compatibilityPlaybackUrl;
    appPost.fallbackVideoUrl = pickStr(firstVideo.video.playback.fallbackUrl) ?? pickStr(firstVideo.video.originalUrl) ?? null;
    appPost.assets = appPost.media.assets;
  }
  assertPlayableVideoAssetOnWire(master, appPost);
  sanitizeHydratedPostDisplayText(appPost as unknown as PostDocLike, {
    route: "toAppPostV2",
    postId: appPost.id,
  });
  return appPost;
}

function assertPlayableVideoAssetOnWire(master: MasterPostV2, appPost: AppPostV2): void {
  const mediaKind = master.classification.mediaKind;
  const canonicalVideoAssets = master.media.assets.filter((asset) => asset.type === "video" && asset.video);
  const mustCarryVideo = (mediaKind === "video" || mediaKind === "mixed") && canonicalVideoAssets.length > 0;
  if (!mustCarryVideo) return;
  const wireVideo = appPost.media.assets.find((asset): asset is AppPostVideoAssetV2 => asset.type === "video");
  const wireStartup = pickStr(wireVideo?.video?.playback?.startupUrl) ?? pickStr(wireVideo?.playback?.startupUrl);
  const wireDefault = pickStr(wireVideo?.video?.playback?.defaultUrl) ?? pickStr(wireVideo?.playback?.defaultUrl);
  const wirePrimary = pickStr(wireVideo?.video?.playback?.primaryUrl) ?? pickStr(wireVideo?.playback?.primaryUrl);
  const wireFallback =
    pickStr(wireVideo?.video?.playback?.fallbackUrl) ??
    pickStr(wireVideo?.video?.originalUrl) ??
    pickStr(appPost.compatibility.fallbackVideoUrl);
  const hasPlayable = Boolean(wireStartup ?? wireDefault ?? wirePrimary ?? wireFallback);
  const canonicalPaths = canonicalVideoAssets.map((asset) => ({
    id: asset.id,
    startupUrl: pickStr(asset.video?.playback.startupUrl),
    defaultUrl: pickStr(asset.video?.playback.defaultUrl),
    primaryUrl: pickStr(asset.video?.playback.primaryUrl),
    selectedReason: pickStr((asset.video?.playback as unknown as Record<string, unknown>)?.selectedReason)
  }));
  const canonicalInstantReady = canonicalVideoAssets.some((asset) => asset.video?.readiness.instantPlaybackReady === true);
  const startupOrDefaultPresent = Boolean(wireStartup ?? wireDefault);
  if (!wireVideo || !hasPlayable || (canonicalInstantReady && !startupOrDefaultPresent)) {
    if (LOG_VIDEO_DEBUG) {
      debugLog("video", "WIRE_VIDEO_ASSET_DROPPED", () => ({
          postId: master.id,
          sourceDocMediaKind: mediaKind,
          canonicalAssetPaths: canonicalPaths,
          serializedAsset: wireVideo ?? null,
          missingPaths: {
            missingVideoAsset: !wireVideo,
            missingPlayableUrl: !hasPlayable,
            missingStartupDefaultWhenInstantReady: canonicalInstantReady && !startupOrDefaultPresent
          }
        }));
    }
  }
}

export function toAppPostV2FromAny(rawPost: RawPost, options: ToAppPostV2Options = {}): AppPostV2 {
  const { master, normalizedFromLegacy } = toMasterPostV2FromAnyWithProvenance(rawPost, options);
  return toAppPostV2(master, { viewerState: options.viewerState ?? undefined, normalizedFromLegacy });
}

export function toAppPostCardV2(appPost: AppPostV2): AppPostFeedCardV2 {
  return {
    postContractVersion: 3,
    projection: "feedCard",
    derivesFromAppPostV2: true,
    appPost: {
      id: appPost.id,
      schema: appPost.schema,
      lifecycle: appPost.lifecycle,
      author: appPost.author,
      text: appPost.text,
      location: appPost.location,
      classification: appPost.classification,
      media: appPost.media,
      engagement: appPost.engagement,
      engagementPreview: appPost.engagementPreview,
      viewerState: appPost.viewerState,
      compatibility: appPost.compatibility
    }
  };
}

export function toAppPostDetailV2(appPost: AppPostV2): AppPostDetailProjectionV2 {
  return {
    postContractVersion: 3,
    projection: "profileDetail",
    derivesFromAppPostV2: true,
    appPost
  };
}

export function toAppMapMarkerPostV2(appPost: AppPostV2): AppPostMapMarkerProjectionV2 {
  return {
    postContractVersion: 3,
    projection: "mapMarker",
    derivesFromAppPostV2: true,
    appPost: {
      id: appPost.id,
      schema: appPost.schema,
      lifecycle: appPost.lifecycle,
      author: appPost.author,
      location: appPost.location,
      classification: appPost.classification,
      media: appPost.media,
      engagement: appPost.engagement,
      viewerState: appPost.viewerState,
      compatibility: appPost.compatibility,
      text: appPost.text,
      engagementPreview: appPost.engagementPreview
    }
  };
}

export function toAppSearchResultPostV2(appPost: AppPostV2): AppPostSearchResultProjectionV2 {
  return {
    postContractVersion: 3,
    projection: "searchResult",
    derivesFromAppPostV2: true,
    appPost: {
      id: appPost.id,
      schema: appPost.schema,
      lifecycle: appPost.lifecycle,
      author: appPost.author,
      text: appPost.text,
      location: appPost.location,
      classification: appPost.classification,
      media: appPost.media,
      engagement: appPost.engagement,
      viewerState: appPost.viewerState,
      compatibility: appPost.compatibility
    }
  };
}

export function toAppCollectionPostV2(appPost: AppPostV2): AppPostCollectionPostProjectionV2 {
  return {
    postContractVersion: 3,
    projection: "collectionPost",
    derivesFromAppPostV2: true,
    appPost
  };
}

export function toAppChatSharedPostV2(appPost: AppPostV2): AppPostChatSharedPostProjectionV2 {
  return {
    postContractVersion: 3,
    projection: "chatSharedPost",
    derivesFromAppPostV2: true,
    appPost: {
      id: appPost.id,
      schema: appPost.schema,
      lifecycle: appPost.lifecycle,
      author: appPost.author,
      text: appPost.text,
      media: appPost.media,
      engagement: appPost.engagement,
      viewerState: appPost.viewerState,
      compatibility: appPost.compatibility,
      location: appPost.location,
      classification: appPost.classification,
      engagementPreview: appPost.engagementPreview
    }
  };
}

export function toAppNotificationPostPreviewV2(appPost: AppPostV2): AppPostNotificationPreviewProjectionV2 {
  return {
    postContractVersion: 3,
    projection: "notificationPreview",
    derivesFromAppPostV2: true,
    appPost: {
      id: appPost.id,
      schema: appPost.schema,
      lifecycle: appPost.lifecycle,
      author: appPost.author,
      text: appPost.text,
      media: appPost.media,
      engagement: appPost.engagement,
      viewerState: appPost.viewerState,
      compatibility: appPost.compatibility,
      engagementPreview: appPost.engagementPreview
    }
  };
}

export function toAppProfileGridPostV2(appPost: AppPostV2): AppPostProfileGridProjectionV2 {
  return {
    postContractVersion: 3,
    projection: "profileGrid",
    derivesFromAppPostV2: true,
    appPost: {
      id: appPost.id,
      schema: appPost.schema,
      lifecycle: appPost.lifecycle,
      author: appPost.author,
      classification: appPost.classification,
      media: appPost.media,
      engagement: appPost.engagement,
      viewerState: appPost.viewerState,
      compatibility: appPost.compatibility,
      text: appPost.text,
      location: appPost.location
    }
  };
}

export type SurfaceCompareLegacyCompatSliceV2 = Pick<
  AppPostCompatibilityV2,
  "photoLink" | "displayPhotoLink" | "thumbUrl" | "posterUrl" | "mediaType" | "fallbackVideoUrl"
>;

export type SurfaceCompareRowV2 = {
  projection: string;
  derivesFromAppPostV2: boolean;
  postContractVersion: 3;
  viewerState: AppPostViewerStateV2;
  legacyCompat: SurfaceCompareLegacyCompatSliceV2;
  mediaAssetCount: number;
  assetIds: string[];
  coverUrl: string | null;
  videoPrimaryUrl: string | null;
  videoStartupUrl: string | null;
  videoUpgradeUrl: string | null;
  videoPreviewUrl: string | null;
  engagement: Pick<AppPostEngagementV2, "likeCount" | "commentCount" | "saveCount">;
  validationWarnings: string[];
};

export function buildSurfaceComparePayload(appPost: AppPostV2): {
  appPostFull: AppPostV2;
  projections: Record<string, SurfaceCompareRowV2>;
} {
  const warn: string[] = [];
  if (!appPost.media.assets.length) warn.push("missing_media_assets");
  const fullHasCoverGradient = Boolean(appPost.media.cover.gradient?.top || appPost.media.cover.gradient?.bottom);
  const fullHasAssetGradient = appPost.media.assets.some((asset) =>
    Boolean(asset.presentation?.letterboxGradient?.top || asset.presentation?.letterboxGradient?.bottom)
  );
  const ids = appPost.media.assets.map((a) => a.id);
  if (new Set(ids).size !== ids.length) warn.push("duplicate_asset_ids");

  const firstVideo = appPost.media.assets.find((a): a is AppPostVideoAssetV2 => a.type === "video");

  const snapshotRow = (projection: string, slice: AppPostV2 | Record<string, unknown>): SurfaceCompareRowV2 => {
    const media = (slice as AppPostV2).media ?? (slice as { media?: AppPostMediaV2 }).media;
    const engagement = (slice as AppPostV2).engagement ?? (slice as { engagement?: AppPostEngagementV2 }).engagement;
    const assets = media?.assets ?? [];
    const fv = assets.find((a: AppPostAssetV2) => a.type === "video") as AppPostVideoAssetV2 | undefined;
    const coverUrl = media?.cover?.url ?? media?.cover?.thumbUrl ?? null;
    const rowWarn = [...warn];
    if (assets.length > 0 && !coverUrl) rowWarn.push("missing_visual_cover");
    const rowHasCoverGradient = Boolean(media?.cover?.gradient?.top || media?.cover?.gradient?.bottom);
    const rowHasAssetGradient = assets.some((a: AppPostAssetV2) =>
      Boolean(a.presentation?.letterboxGradient?.top || a.presentation?.letterboxGradient?.bottom)
    );
    if (fullHasCoverGradient && !rowHasCoverGradient) rowWarn.push("dropped_cover_gradient_from_full_app_post");
    if (fullHasAssetGradient && !rowHasAssetGradient) rowWarn.push("dropped_asset_gradients_from_full_app_post");
    const compat = appPost.compatibility;
    return {
      projection,
      derivesFromAppPostV2: true,
      postContractVersion: 3,
      viewerState: { ...appPost.viewerState },
      legacyCompat: {
        photoLink: compat.photoLink,
        displayPhotoLink: compat.displayPhotoLink,
        thumbUrl: compat.thumbUrl,
        posterUrl: compat.posterUrl,
        mediaType: compat.mediaType,
        fallbackVideoUrl: compat.fallbackVideoUrl
      },
      mediaAssetCount: assets.length,
      assetIds: assets.map((a: AppPostAssetV2) => a.id),
      coverUrl,
      videoPrimaryUrl: fv?.video?.playback?.primaryUrl ?? null,
      videoStartupUrl: fv?.video?.playback?.startupUrl ?? null,
      videoUpgradeUrl: fv?.video?.playback?.upgradeUrl ?? null,
      videoPreviewUrl: fv?.video?.playback?.previewUrl ?? null,
      engagement: {
        likeCount: engagement?.likeCount ?? 0,
        commentCount: engagement?.commentCount ?? 0,
        saveCount: engagement?.saveCount ?? 0
      },
      validationWarnings: rowWarn
    };
  };

  return {
    appPostFull: appPost,
    projections: {
      feedCard: snapshotRow("feedCard", toAppPostCardV2(appPost).appPost),
      profileGrid: snapshotRow("profileGrid", toAppProfileGridPostV2(appPost).appPost),
      profileDetail: snapshotRow("profileDetail", toAppPostDetailV2(appPost).appPost),
      mapMarker: snapshotRow("mapMarker", toAppMapMarkerPostV2(appPost).appPost),
      searchResult: snapshotRow("searchResult", toAppSearchResultPostV2(appPost).appPost),
      collectionPost: snapshotRow("collectionPost", toAppCollectionPostV2(appPost).appPost),
      chatSharedPost: snapshotRow("chatSharedPost", toAppChatSharedPostV2(appPost).appPost),
      notificationPreview: snapshotRow("notificationPreview", toAppNotificationPostPreviewV2(appPost).appPost)
    }
  };
}
