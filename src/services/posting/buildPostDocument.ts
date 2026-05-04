import { Timestamp } from "firebase-admin/firestore";
import type { AssembledPostAssets } from "./assemblePostAssets.js";

export type NativePostGeoBlock = {
  cityRegionId: string | null;
  stateRegionId: string | null;
  countryRegionId: string | null;
  geohash: string;
  geoData: { country: string | null; state: string | null; city: string | null };
  addressDisplayName: string;
  locationDisplayName: string;
  fallbackPrecision: "address" | "city" | "region" | "country" | "coordinates";
  reverseGeocodeStatus: "resolved" | "partial" | "fallback" | "failed";
  source: "exif" | "manual" | "user_selected" | "unknown";
};

export type NativePostUserSnapshot = {
  handle: string;
  name: string;
  profilePic: string;
};

export type BuildNativePostDocumentInput = {
  postId: string;
  effectiveUserId: string;
  viewerId: string;
  sessionId: string;
  stagedSessionId: string;
  idempotencyKey: string;
  nowMs: number;
  nowTs: Timestamp;
  user: NativePostUserSnapshot;
  title?: string;
  content?: string;
  activities: string[];
  lat: number;
  lng: number;
  address: string;
  privacy: string;
  tags: Array<Record<string, unknown>>;
  texts: unknown[];
  recordings: unknown[];
  assembled: AssembledPostAssets;
  geo: NativePostGeoBlock;
  /** When omitted, defaults to fit-width + neutral placeholder letterbox (legacy finalize behavior). */
  carouselFitWidth?: boolean;
  /** Per-post letterbox gradient list (broadcast single entry across slides when shorter than asset count). */
  letterboxGradients?: Array<{ top: string; bottom: string }>;
};

function settingTypeFromActivities(activities: string[]): string {
  const joined = activities.join(" ");
  return /gym|museum|mall|studio|indoor/i.test(joined) ? "indoor" : "outdoor";
}

export function buildNativePostDocument(input: BuildNativePostDocumentInput): Record<string, unknown> {
  const title = input.title ?? "";
  const content = input.content ?? "";
  // Caption is the explicit user-entered caption only. Never fall back to title.
  const caption = content;
  const activities = input.activities;
  const first = input.assembled.assets[0] as { poster?: string; original?: string; type?: string } | undefined;
  const photoLink =
    input.assembled.mediaType === "video"
      ? String(first?.poster ?? input.assembled.primaryDisplayUrl)
      : String(first?.original ?? input.assembled.primaryDisplayUrl);
  const firstVideo = input.assembled.assets.find(
    (asset) => String((asset as { type?: string }).type ?? "").toLowerCase() === "video",
  ) as { original?: string; poster?: string } | undefined;
  const fallbackVideoUrl = String(firstVideo?.original ?? "").trim() || undefined;
  const posterUrl = String(firstVideo?.poster ?? first?.poster ?? input.assembled.primaryDisplayUrl).trim() || undefined;

  const base: Record<string, unknown> = {
    postId: input.postId,
    userId: input.effectiveUserId,
    title,
    content,
    caption,
    description: content,
    activities,
    lat: input.lat,
    long: input.lng,
    lng: input.lng,
    address: input.geo.addressDisplayName,
    locationLabel: input.geo.locationDisplayName,
    placeName: input.geo.locationDisplayName,
    addressDisplayName: input.geo.addressDisplayName,
    locationDisplayName: input.geo.locationDisplayName,
    fallbackPrecision: input.geo.fallbackPrecision,
    reverseGeocodeStatus: input.geo.reverseGeocodeStatus,
    locationSource: input.geo.source,
    privacy: input.privacy,
    settingType: settingTypeFromActivities(activities),
    mediaType: input.assembled.mediaType,
    thumbUrl: input.assembled.primaryDisplayUrl,
    displayPhotoLink: input.assembled.primaryDisplayUrl,
    photoLink,
    photoLinks2: photoLink,
    photoLinks3: photoLink,
    legacy: {
      photoLink,
      photoLinks2: "",
      photoLinks3: ""
    },
    assets: input.assembled.assets,
    assetsReady: !input.assembled.hasVideo,
    mediaStatus: input.assembled.hasVideo ? "processing" : "ready",
    sessionId: input.sessionId,
    stagedSessionId: input.stagedSessionId,
    tags: input.tags,
    texts: input.texts,
    recordings: input.recordings,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    createdAt: input.nowTs,
    updatedAt: input.nowTs,
    lastUpdated: input.nowTs,
    time: input.nowTs,
    "time-created": input.nowTs,
    likesCount: 0,
    likeCount: 0,
    commentsCount: 0,
    commentCount: 0,
    likedBy: [],
    likes: [],
    comments: [],
    userHandle: input.user.handle,
    userName: input.user.name,
    userPic: input.user.profilePic,
    showComments: true,
    showLikes: true,
    moderatorTier: 0,
    place: null,
    isBoosted: false,
    cityRegionId: input.geo.cityRegionId,
    stateRegionId: input.geo.stateRegionId,
    countryRegionId: input.geo.countryRegionId,
    geohash: input.geo.geohash,
    geoData: {
      ...input.geo.geoData,
      address: input.geo.addressDisplayName
    },
    carouselFitWidth: input.carouselFitWidth ?? true,
    letterboxGradients:
      Array.isArray(input.letterboxGradients) && input.letterboxGradients.length > 0
        ? input.letterboxGradients
        : [{ top: "#1f2937", bottom: "#111827" }]
  };

  if (input.assembled.hasVideo) {
    base.posterReady = Boolean(posterUrl);
    base.posterPresent = Boolean(posterUrl);
    if (posterUrl) base.posterUrl = posterUrl;
    base.playbackReady = false;
    base.playbackUrlPresent = false;
    if (fallbackVideoUrl) base.fallbackVideoUrl = fallbackVideoUrl;
    base.videoProcessingStatus = "pending";
    base.instantPlaybackReady = false;
    base.videoProcessingProgress = {
      totalVideos: input.assembled.videoCount,
      processedVideos: 0
    };
    base.playbackLabStatus = "queued";
    base.playbackLabUpdatedAt = input.nowTs;
    base.playbackLab = {
      status: "queued",
      version: 1,
      generatedAt: input.nowTs,
      lastVerifyAllOk: false,
      asyncPipeline: {
        status: "queued",
        source: "native_v2_finalize",
        lastGenerateSuccess: false,
        lastVerifyAllOk: false,
        lastException: null,
        lastGenerateErrors: []
      }
    };
  } else {
    base.posterReady = true;
    base.posterPresent = true;
    base.posterUrl = photoLink;
    base.playbackReady = false;
    base.playbackUrlPresent = false;
    base.imageProcessingStatus = "pending";
  }

  return base;
}

export function validateNativePostDocumentForWrite(doc: Record<string, unknown>): void {
  const assets = Array.isArray(doc.assets) ? (doc.assets as Record<string, unknown>[]) : [];
  if (assets.length === 0) throw new Error("publish_validation_empty_assets");

  const displayPhotoLink = String(doc.displayPhotoLink ?? "").trim();
  if (!displayPhotoLink) throw new Error("publish_validation_missing_display_photo");

  for (const asset of assets) {
    const type = String(asset.type ?? "").toLowerCase();
    const original = String(asset.original ?? "").trim();
    if (!original || !/^https?:\/\//i.test(original)) {
      throw new Error("publish_validation_asset_missing_original");
    }
    if (type === "video") {
      const poster = String(asset.poster ?? "").trim();
      const vPoster =
        asset.variants && typeof asset.variants === "object"
          ? String((asset.variants as { poster?: string }).poster ?? "").trim()
          : "";
      if (!poster && !vPoster) throw new Error("publish_validation_video_missing_poster");
    }
  }

}
