/**
 * App-facing post contract returned from Backend V2 to native clients.
 * Derived from Master Post V2 (`locava.post` v2) via `toAppPostV2`.
 */

export type AppPostSchemaNameV2 = "locava.appPost";

export type AppPostLifecycleStatusV2 = "active" | "deleted" | "hidden" | "processing" | "failed";
export type AppPostMediaKindV2 = "image" | "video" | "mixed" | "text" | "unknown";
export type AppPostMediaStatusV2 = "ready" | "processing" | "partial" | "failed" | "none";
export type AppPostMediaCompletenessV2 = "complete" | "partial" | "legacy_recovered" | "missing";
export type AppPostAssetTypeV2 = "image" | "video";

export type AppPostImageBlockV2 = {
  originalUrl: string | null;
  displayUrl: string | null;
  thumbnailUrl: string | null;
  blurhash: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  orientation: string | null;
};

export type AppPostVideoPlaybackV2 = {
  defaultUrl: string | null;
  primaryUrl: string | null;
  startupUrl: string | null;
  highQualityUrl: string | null;
  upgradeUrl: string | null;
  hlsUrl: string | null;
  fallbackUrl: string | null;
  previewUrl: string | null;
};

export type AppPostVideoVariantsV2 = {
  preview360: string | null;
  preview360Avc: string | null;
  main720: string | null;
  main720Avc: string | null;
  main1080: string | null;
  main1080Avc: string | null;
  startup540Faststart: string | null;
  startup540FaststartAvc: string | null;
  startup720Faststart: string | null;
  startup720FaststartAvc: string | null;
  startup1080Faststart: string | null;
  startup1080FaststartAvc: string | null;
  upgrade1080Faststart: string | null;
  upgrade1080FaststartAvc: string | null;
  hls: string | null;
  hlsAvcMaster: string | null;
};

export type AppPostVideoReadinessV2 = {
  assetsReady: boolean | null;
  instantPlaybackReady: boolean | null;
  faststartVerified: boolean | null;
  processingStatus: string | null;
};

export type AppPostVideoTechnicalV2 = {
  sourceCodec: string | null;
  playbackCodec: string | null;
  audioCodec: string | null;
  bitrateKbps: number | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
};

export type AppPostVideoBlockV2 = {
  originalUrl: string | null;
  posterUrl: string | null;
  posterHighUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  hasAudio: boolean | null;
  playback: AppPostVideoPlaybackV2;
  variants: AppPostVideoVariantsV2;
  readiness: AppPostVideoReadinessV2;
  technical: AppPostVideoTechnicalV2;
};

export type AppPostPresentationV2 = {
  letterboxGradient: { top: string | null; bottom: string | null } | null;
};

export type AppPostAssetV2 =
  | AppPostImageAssetV2
  | AppPostVideoAssetV2;

export type AppPostImageAssetV2 = {
  id: string;
  index: number;
  type: "image";
  image: AppPostImageBlockV2;
  video: null;
  presentation: AppPostPresentationV2;
};

export type AppPostVideoAssetV2 = {
  id: string;
  index: number;
  type: "video";
  image: null;
  video: AppPostVideoBlockV2;
  presentation: AppPostPresentationV2;
};

export type AppPostMediaCoverV2 = {
  assetId: string | null;
  type: AppPostAssetTypeV2 | null;
  url: string | null;
  thumbUrl: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  gradient: { top: string | null; bottom: string | null } | null;
};

export type AppPostMediaV2 = {
  status: AppPostMediaStatusV2;
  assetsReady: boolean;
  instantPlaybackReady: boolean;
  completeness: AppPostMediaCompletenessV2;
  assetCount: number;
  rawAssetCount: number;
  hasMultipleAssets: boolean;
  primaryAssetId: string | null;
  coverAssetId: string | null;
  cover: AppPostMediaCoverV2;
  assets: AppPostAssetV2[];
};

export type AppPostAuthorV2 = {
  userId: string | null;
  displayName: string | null;
  handle: string | null;
  profilePicUrl: string | null;
};

export type AppPostTextV2 = {
  title: string;
  caption: string;
  description: string;
  content: string;
  searchableText: string;
};

export type AppPostLocationV2 = {
  coordinates: {
    lat: number | null;
    lng: number | null;
    geohash: string | null;
  };
  display: {
    address: string | null;
    name: string | null;
    subtitle: string | null;
    label: string | null;
  };
  place: {
    placeId: string | null;
    placeName: string | null;
    source: string;
    precision: string;
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

export type AppPostClassificationV2 = {
  activities: string[];
  primaryActivity: string | null;
  mediaKind: AppPostMediaKindV2;
  visibility: "public" | "friends" | "private" | "unknown";
  isBoosted: boolean;
  reel: boolean;
  settingType: string | null;
  moderatorTier: number | null;
  source: "user" | "admin" | "imported" | "seeded" | "unknown";
  privacyLabel: string | null;
};

export type AppPostEngagementV2 = {
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

export type AppPostRecentLikerV2 = {
  userId: string;
  displayName: string | null;
  handle: string | null;
  profilePicUrl: string | null;
  likedAt: string | null;
};

export type AppPostRecentCommentPreviewV2 = {
  commentId: string;
  userId: string;
  displayName: string | null;
  handle: string | null;
  profilePicUrl: string | null;
  text: string;
  createdAt: string | null;
  replyCount: number;
};

export type AppPostEngagementPreviewV2 = {
  recentLikers: AppPostRecentLikerV2[];
  recentComments: AppPostRecentCommentPreviewV2[];
};

export type AppPostViewerStateV2 = {
  liked: boolean;
  saved: boolean;
  savedCollectionIds: string[];
  followsAuthor: boolean;
};

export type AppPostCompatibilityV2 = {
  photoLink: string | null;
  photoLinks2: string | null;
  photoLinks3: string | null;
  displayPhotoLink: string | null;
  thumbUrl: string | null;
  posterUrl: string | null;
  fallbackVideoUrl: string | null;
  mediaType: AppPostMediaKindV2;
};

export type AppPostLifecycleV2 = {
  status: AppPostLifecycleStatusV2;
  isDeleted: boolean;
  createdAt: string | null;
  createdAtMs: number | null;
  updatedAt: string | null;
};

export type AppPostSchemaV2 = {
  name: AppPostSchemaNameV2;
  version: 2;
  sourcePostSchemaVersion: number;
  normalizedFromLegacy: boolean;
};

export type AppPostV2 = {
  id: string;
  schema: AppPostSchemaV2;
  lifecycle: AppPostLifecycleV2;
  author: AppPostAuthorV2;
  text: AppPostTextV2;
  location: AppPostLocationV2;
  classification: AppPostClassificationV2;
  media: AppPostMediaV2;
  engagement: AppPostEngagementV2;
  engagementPreview: AppPostEngagementPreviewV2;
  viewerState: AppPostViewerStateV2;
  compatibility: AppPostCompatibilityV2;
};

/** Marks a projection payload as derived from {@link AppPostV2}. */
export type AppPostProjectionMetaV2 = {
  postContractVersion: 2;
  projection: string;
  derivesFromAppPostV2: true;
};

export type AppPostFeedCardV2 = AppPostProjectionMetaV2 & {
  projection: "feedCard";
  appPost: Pick<
    AppPostV2,
    | "id"
    | "schema"
    | "lifecycle"
    | "author"
    | "text"
    | "location"
    | "classification"
    | "media"
    | "engagement"
    | "engagementPreview"
    | "viewerState"
    | "compatibility"
  >;
};

export type AppPostDetailProjectionV2 = AppPostProjectionMetaV2 & {
  projection: "profileDetail";
  appPost: AppPostV2;
};

export type AppPostMapMarkerProjectionV2 = AppPostProjectionMetaV2 & {
  projection: "mapMarker";
  appPost: Pick<
    AppPostV2,
    "id" | "schema" | "lifecycle" | "author" | "location" | "classification" | "media" | "engagement" | "viewerState" | "compatibility"
  > &
    Partial<Pick<AppPostV2, "text" | "engagementPreview">>;
};

export type AppPostSearchResultProjectionV2 = AppPostProjectionMetaV2 & {
  projection: "searchResult";
  appPost: Pick<
    AppPostV2,
    | "id"
    | "schema"
    | "lifecycle"
    | "author"
    | "text"
    | "location"
    | "classification"
    | "media"
    | "engagement"
    | "viewerState"
    | "compatibility"
  >;
};

export type AppPostCollectionPostProjectionV2 = AppPostProjectionMetaV2 & {
  projection: "collectionPost";
  appPost: AppPostV2;
};

export type AppPostChatSharedPostProjectionV2 = AppPostProjectionMetaV2 & {
  projection: "chatSharedPost";
  appPost: Pick<
    AppPostV2,
    | "id"
    | "schema"
    | "lifecycle"
    | "author"
    | "text"
    | "media"
    | "engagement"
    | "viewerState"
    | "compatibility"
  > &
    Partial<Pick<AppPostV2, "location" | "classification" | "engagementPreview">>;
};

export type AppPostNotificationPreviewProjectionV2 = AppPostProjectionMetaV2 & {
  projection: "notificationPreview";
  appPost: Pick<
    AppPostV2,
    "id" | "schema" | "lifecycle" | "author" | "text" | "media" | "engagement" | "viewerState" | "compatibility"
  > &
    Partial<Pick<AppPostV2, "engagementPreview">>;
};

export type AppPostProfileGridProjectionV2 = AppPostProjectionMetaV2 & {
  projection: "profileGrid";
  appPost: Pick<
    AppPostV2,
    "id" | "schema" | "lifecycle" | "author" | "classification" | "media" | "engagement" | "viewerState" | "compatibility"
  > &
    Partial<Pick<AppPostV2, "text" | "location">>;
};
