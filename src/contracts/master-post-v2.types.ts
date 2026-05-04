export type MasterPostLifecycleStatusV2 = "active" | "deleted" | "hidden" | "processing" | "failed";
export type MasterPostMediaKindV2 = "image" | "video" | "mixed" | "text" | "unknown";
export type MasterPostMediaStatusV2 = "ready" | "processing" | "partial" | "failed" | "none";
export type MasterPostMediaCompletenessV2 = "complete" | "partial" | "legacy_recovered" | "missing";
export type MasterPostAssetTypeV2 = "image" | "video";
export type MasterPostLocationSourceV2 =
  | "geoData"
  | "coordinates"
  | "place"
  | "legacy"
  | "derived"
  | "unknown";
export type MasterPostLocationPrecisionV2 = "exact" | "approximate" | "city" | "state" | "country" | "unknown";
export type MasterPostValidationStatusV2 = "valid" | "warning" | "invalid";

export type MasterPostImageBlockV2 = {
  originalUrl: string | null;
  displayUrl: string | null;
  thumbnailUrl: string | null;
  blurhash: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  orientation: string | null;
};

export type MasterPostVideoBlockV2 = {
  originalUrl: string | null;
  posterUrl: string | null;
  posterHighUrl: string | null;
  playback: {
    defaultUrl: string | null;
    primaryUrl: string | null;
    startupUrl: string | null;
    highQualityUrl: string | null;
    upgradeUrl: string | null;
    hlsUrl: string | null;
    fallbackUrl: string | null;
    previewUrl: string | null;
  };
  variants: Record<string, unknown>;
  durationSec: number | null;
  hasAudio: boolean | null;
  codecs: Record<string, unknown> | null;
  technical: {
    sourceCodec: string | null;
    playbackCodec: string | null;
    audioCodec: string | null;
  };
  bitrateKbps: number | null;
  sizeBytes: number | null;
  readiness: {
    assetsReady: boolean | null;
    instantPlaybackReady: boolean | null;
    faststartVerified: boolean | null;
    processingStatus: string | null;
  };
};

/** Letterbox colors for contain / carousel presentation (optional provenance `source`). */
export type MasterPostLetterboxGradientV2 = {
  top: string | null;
  bottom: string | null;
  source?: string | null;
};

export type MasterPostCanonicalizedByV2 = "backend_v2_post_rebuilder" | "posting_finalize_v2";

export type MasterPostSourceShapeV2 =
  | "legacy_assets_video"
  | "legacy_assets_image"
  | "legacy_assets_mixed"
  | "legacy_links_only"
  | "native_posting_v2"
  | "unknown";

export type MasterPostAssetV2 = {
  id: string;
  index: number;
  type: MasterPostAssetTypeV2;
  source: {
    kind: "assets" | "media.assets" | "legacy";
    originalAssetId: string | null;
    primarySources: string[];
    legacySourcesConsidered: string[];
    recoveredFrom?: string[];
    legacyVariantUrlsMerged: boolean;
  };
  image: MasterPostImageBlockV2 | null;
  video: MasterPostVideoBlockV2 | null;
  presentation: {
    letterboxGradient: MasterPostLetterboxGradientV2 | null;
    carouselFitWidth?: boolean | null;
    resizeMode?: string | null;
  };
};

export type MasterPostLifecycleV2 = {
  status: MasterPostLifecycleStatusV2;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string | null;
  createdAtMs: number | null;
  updatedAt: string | null;
  lastMediaUpdatedAt: string | null;
  lastUserVisibleAt: string | null;
};

export type MasterPostAuthorV2 = {
  userId: string | null;
  displayName: string | null;
  handle: string | null;
  profilePicUrl: string | null;
};

export type MasterPostLocationV2 = {
  coordinates: {
    lat: number | null;
    lng: number | null;
    geohash: string | null;
  };
  display: {
    address: string | null;
    /** Place / address headline for maps and location UI — never mirrors `text.title`. */
    name: string | null;
    subtitle: string | null;
    label: string | null;
  };
  place: {
    placeId: string | null;
    placeName: string | null;
    source: MasterPostLocationSourceV2;
    precision: MasterPostLocationPrecisionV2;
  };
  regions: {
    city: string | null;
    state: string | null;
    country: string | null;
    cityRegionId: string | null;
    stateRegionId: string | null;
    countryRegionId: string | null;
  };
};

export type MasterPostClassificationV2 = {
  activities: string[];
  primaryActivity: string | null;
  mediaKind: MasterPostMediaKindV2;
  visibility: "public" | "friends" | "private" | "unknown";
  isBoosted: boolean;
  reel: boolean;
  settingType: string | null;
  moderatorTier: number | null;
  source: "user" | "admin" | "imported" | "seeded" | "unknown";
  privacyLabel: string | null;
};

export type MasterPostMediaV2 = {
  status: MasterPostMediaStatusV2;
  assetsReady: boolean;
  instantPlaybackReady: boolean;
  completeness: MasterPostMediaCompletenessV2;
  assetCount: number;
  rawAssetCount: number;
  hasMultipleAssets: boolean;
  primaryAssetId: string | null;
  coverAssetId: string | null;
  assets: MasterPostAssetV2[];
  /** Post-level carousel / resize defaults (native finalize + clients). */
  presentation?: {
    carouselFitWidth: boolean | null;
    resizeMode: string | null;
  } | null;
  cover: {
    assetId: string | null;
    type: MasterPostAssetTypeV2 | null;
    url: string | null;
    thumbUrl: string | null;
    posterUrl: string | null;
    width: number | null;
    height: number | null;
    aspectRatio: number | null;
    gradient: MasterPostLetterboxGradientV2 | null;
  };
};

export type MasterPostEngagementV2 = {
  likeCount: number;
  commentCount: number;
  saveCount: number;
  shareCount: number;
  viewCount: number;
  likesVersion: number | null;
  commentsVersion: number | null;
  savesVersion: number | null;
  showLikes: boolean | null;
  showComments: boolean | null;
};

export type MasterPostCompatibilityV2 = {
  photoLink: string | null;
  photoLinks2: string | null;
  photoLinks3: string | null;
  displayPhotoLink: string | null;
  thumbUrl: string | null;
  posterUrl: string | null;
  fallbackVideoUrl: string | null;
  mediaType: MasterPostMediaKindV2;
};

export type MasterPostLegacyV2 = {
  preserved: boolean;
  rawFieldNames: string[];
  originalMediaFields: Record<string, unknown>;
  originalEngagementFields: Record<string, unknown>;
  originalLocationFields: Record<string, unknown>;
  originalModerationFields: Record<string, unknown>;
  originalPosterMigration: Record<string, unknown>;
};

export type CanonicalizationWarning = {
  code: string;
  message: string;
  path?: string;
};

export type CanonicalizationError = {
  code: string;
  message: string;
  path?: string;
  blocking: boolean;
};

/** Source used for canonical like counts — see `auditPostEngagementSourcesV2`. */
export type MasterPostEngagementLikesSourceV2 = "subcollection" | "postDocArray" | "postDocCount" | "none";

/** Source used for canonical comment counts — see `auditPostEngagementSourcesV2`. */
export type MasterPostEngagementCommentsSourceV2 = "subcollection" | "postDocArray" | "postDocCount" | "none";

export type PostEngagementSourceAuditRecentLikerV2 = {
  userId: string;
  displayName: string | null;
  handle: string | null;
  profilePicUrl: string | null;
  likedAt: string | null;
};

/** Small preview slice for canonical engagement (not full thread storage). */
export type MasterPostRecentCommentPreviewV2 = {
  commentId: string;
  userId: string;
  displayName: string | null;
  handle: string | null;
  profilePicUrl: string | null;
  text: string;
  createdAt: string | null;
  replyCount: number;
};

/**
 * Engagement truth audit for one post. Production paths documented in Backend V2:
 * - Likes docs: `posts/{postId}/likes/{userId}` (increment + denormalized counts on post)
 * - Comment docs: `posts/{postId}/comments/{commentId}` OR embedded `post.comments[]` (see comments repository).
 */
export type PostEngagementSourceAuditV2 = {
  postDoc: {
    likeCount: number | null;
    likesArrayCount: number;
    commentsCount: number | null;
    commentsArrayCount: number;
    likesVersion: number | null;
    commentsVersion: number | null;
  };
  subcollections: {
    likesPath: string;
    likesCount: number | null;
    recentLikers: PostEngagementSourceAuditRecentLikerV2[];
    likesQueryError: string | null;
    commentsPath: string;
    commentsCount: number | null;
    recentComments: Array<Record<string, unknown>>;
    commentsQueryError: string | null;
  };
  recommendedCanonical: {
    likeCount: number;
    commentCount: number;
    likesVersion: number | null;
    commentsVersion: number | null;
  };
  selectedSource: {
    likes: MasterPostEngagementLikesSourceV2;
    comments: MasterPostEngagementCommentsSourceV2;
  };
  mismatches: string[];
  warnings: string[];
};

export type MasterPostAuditV2 = {
  canonicalValidationStatus: MasterPostValidationStatusV2;
  warnings: CanonicalizationWarning[];
  errors: CanonicalizationError[];
  /** ISO time when a rebuilder/migration normalized raw Firestore; null for brand-new canonical finalize writes. */
  rebuiltFromRawAt: string | null;
  /** ISO time when `/v2/posting/finalize` first wrote this doc as Master Post V2. */
  createdFromPostingFinalizeAt?: string | null;
  reversible: boolean;
  backupDocPath: string | null;
  engagementSourceAuditSummary?: PostEngagementSourceAuditV2 | null;
  normalizationDebug?: {
    ignoredLegacyVariantUrls: string[];
    mergedVariantUrls: string[];
    suppressedDuplicateAssets: string[];
    assetCountBefore: number;
    assetCountAfter: number;
    rawLetterboxGradientsCount?: number;
    rawHasPostLevelLetterboxGradient?: boolean;
    rawHasLetterboxButCoverGradientMissing?: boolean;
    rawHasLetterboxButAllAssetGradientsMissing?: boolean;
    /** Which raw field produced `lifecycle.createdAtMs`, if any. */
    lifecycleCreatedAtMsSource?: "createdAtMs" | "time" | "createdAt" | "time-created" | "updatedAt" | null;
    /** True when raw had timestamp-like fields but ms could not be derived (validator should warn). */
    lifecycleCreatedAtMsMissingDespiteRawFields?: boolean;
  };
};

export type MasterPostV2 = {
  id: string;
  schema: {
    name: "locava.post";
    version: 2;
    canonicalizedAt: string;
    canonicalizedBy: MasterPostCanonicalizedByV2;
    sourceShape: MasterPostSourceShapeV2;
    migrationRunId: string | null;
  };
  lifecycle: MasterPostLifecycleV2;
  author: MasterPostAuthorV2;
  text: {
    title: string;
    caption: string;
    description: string;
    content: string;
    searchableText: string;
  };
  location: MasterPostLocationV2;
  classification: MasterPostClassificationV2;
  media: MasterPostMediaV2;
  engagement: MasterPostEngagementV2;
  engagementPreview: {
    /**
     * Preserves today’s embedded liker display fields (`userName` → displayName, `userHandle`, `userPic`, liked time).
     * Source: subcollection `posts/{postId}/likes` when populated, otherwise last entries from legacy `likes[]`.
     */
    recentLikers: Array<{
      userId: string;
      displayName: string | null;
      handle: string | null;
      profilePicUrl: string | null;
      likedAt: string | null;
    }>;
    /**
     * Recent comments for UI/preview — from `posts/{postId}/comments` when authoritative, otherwise embedded `post.comments[]`
     * (e.g. empty subcollection with legacy array until migration).
     */
    recentComments: MasterPostRecentCommentPreviewV2[];
  };
  ranking: {
    aggregates: Record<string, unknown> | null;
    rollup: Record<string, unknown> | null;
  };
  compatibility: MasterPostCompatibilityV2;
  legacy: MasterPostLegacyV2;
  audit: MasterPostAuditV2;
};

export type CanonicalizationResult = {
  canonical: MasterPostV2;
  warnings: CanonicalizationWarning[];
  errors: CanonicalizationError[];
  recoveredLegacyAssets: number;
  dedupedAssets: number;
};

export type PostRebuilderPreviewResponse = {
  postId: string;
  rawHash: string;
  raw: Record<string, unknown> | null;
  canonicalPreview: MasterPostV2 | null;
  engagementSourceAudit: PostEngagementSourceAuditV2 | null;
  mediaProcessingDebugPreview: Record<string, unknown> | null;
  validation: {
    status: MasterPostValidationStatusV2;
    blockingErrors: CanonicalizationError[];
    warnings: CanonicalizationWarning[];
  };
  diffSummary: Record<string, unknown>;
  writeAllowed: boolean;
};

export type PostRebuilderWriteResponse = {
  backupId: string;
  backupPath: string;
  canonical: MasterPostV2;
  validation: {
    status: MasterPostValidationStatusV2;
    blockingErrors: CanonicalizationError[];
    warnings: CanonicalizationWarning[];
  };
  fieldsWritten: string[];
  mediaProcessingDebugWritten: boolean;
};

export type PostRebuilderRevertResponse = {
  success: boolean;
  postId: string;
  backupId: string;
  restoredAt: string;
};
