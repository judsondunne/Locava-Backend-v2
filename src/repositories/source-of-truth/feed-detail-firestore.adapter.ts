import { getFirestoreSourceClient } from "./firestore-client.js";
import { normalizeCanonicalPostLocation } from "../../lib/location/post-location-normalizer.js";
import { readMaybeMillis } from "./post-firestore-projection.js";
import { normalizeLetterboxHintsFromFirestorePost } from "../../lib/feed/normalizeLetterboxHintsFromPost.js";
import { buildSafeDisplayTextBlock } from "../../lib/posts/displayText.js";

export type FirestoreFeedDetailBundle = {
  post: {
    postId: string;
    userId: string;
    caption: string | null;
    title?: string | null;
    description?: string | null;
    activities?: string[];
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    geoData?: {
      city?: string | null;
      state?: string | null;
      country?: string | null;
      geohash?: string | null;
    };
    coordinates?: {
      lat?: number | null;
      lng?: number | null;
    };
    tags?: string[];
    createdAtMs: number;
    updatedAtMs: number;
    carouselFitWidth?: boolean;
    layoutLetterbox?: boolean;
    letterboxGradientTop?: string | null;
    letterboxGradientBottom?: string | null;
    letterboxGradients?: Array<{ top: string; bottom: string }>;
    mediaType: "image" | "video";
    thumbUrl: string;
    assetsReady?: boolean;
    playbackLab?: Record<string, unknown>;
    assetLocations?: Array<{ lat?: number | null; long?: number | null }>;
    assets: Array<{
      id: string;
      type: "image" | "video";
      original?: string | null;
      poster: string | null;
      thumbnail: string | null;
      aspectRatio?: number | null;
      durationSec?: number | null;
      width?: number | null;
      height?: number | null;
      orientation?: string | null;
      hasAudio?: boolean;
      codecs?: Record<string, unknown>;
      variantMetadata?: Record<string, unknown>;
      instantPlaybackReady?: boolean;
      playbackLab?: Record<string, unknown>;
    generated?: Record<string, unknown>;
    variants?: Record<string, unknown>;
  }>;
  comments?: Array<Record<string, unknown>>;
  commentsPreview?: Array<Record<string, unknown>>;
  rawPost?: Record<string, unknown> | null;
  sourcePost?: Record<string, unknown> | null;
  };
  author: {
    userId: string;
    handle: string;
    name: string | null;
    pic: string | null;
  };
  social: {
    likeCount: number;
    commentCount: number;
  };
  viewer: {
    liked: boolean;
    saved: boolean;
  };
  queryCount: number;
  readCount: number;
};

type NormalizedEmbeddedComment = Record<string, unknown> & {
  id: string;
  commentId: string;
  content: string;
  text: string;
  userId: string;
  userName: string | null;
  userHandle: string | null;
  userPic: string | null;
  time: unknown;
  createdAt: unknown;
  likedBy: string[];
  replies: unknown[];
};

export class FeedDetailFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();
  private static readonly FIRESTORE_TIMEOUT_MS = 700;
  private disabledUntilMs = 0;

  isEnabled(): boolean {
    if (!this.db) return false;
    return Date.now() >= this.disabledUntilMs;
  }

  markUnavailableBriefly(): void {
    this.disabledUntilMs = Date.now() + 5_000;
  }

  async getFeedDetailBundle(input: {
    syntheticPostId: string;
    slot: number;
    viewerId: string;
  }): Promise<FirestoreFeedDetailBundle> {
    if (!this.db) {
      throw new Error("firestore_source_unavailable");
    }

    const postSnapshot = await withTimeout(
      this.db
        .collection("posts")
        .where("feedSlot", "==", input.slot)
        .orderBy("createdAtMs", "desc")
        .select(
          "userId",
          "caption",
          "content",
          "title",
          "description",
          "activities",
          "address",
          "lat",
          "latitude",
          "long",
          "lng",
          "longitude",
          "location",
          "coordinates",
          "geo",
          "geoData",
          "tags",
          "createdAtMs",
          "updatedAtMs",
          "mediaType",
          "thumbUrl",
          "displayPhotoLink",
          "photoLink",
          "assets",
          "carouselFitWidth",
          "layoutLetterbox",
          "letterboxGradientTop",
          "letterboxGradientBottom",
          "letterboxGradients",
          "letterbox_gradient_top",
          "letterbox_gradient_bottom",
          "legacy",
          "likeCount",
          "commentsCount",
          "commentCount",
          "comments"
        )
        .limit(1)
        .get(),
      FeedDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "feed-detail-firestore-post"
    );

    const postDoc = postSnapshot.docs[0];
    if (!postDoc) {
      throw new Error("feed_detail_source_not_found");
    }

    const rawPost = postDoc.data() as PostDataShape;
    const resolvedUserId =
      typeof rawPost.userId === "string" && rawPost.userId.trim()
        ? rawPost.userId.trim()
        : `author-${(input.slot % 27) + 1}`;
    const postData: PostDataShape = { ...rawPost, userId: resolvedUserId };

    const [userDoc, liked, savedDoc, socialCounts] = await withTimeout(
      Promise.all([
        this.db.collection("users").doc(resolvedUserId).get(),
        this.resolveViewerLikedState(postDoc.id, input.viewerId),
        this.db.collection("users").doc(input.viewerId).collection("savedPosts").doc(postDoc.id).get(),
        this.resolveSocialCountsFromSubcollections(postDoc.id, postData),
      ]),
      FeedDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "feed-detail-firestore-related"
    );

    const userData = (userDoc.data() ?? {}) as UserDataShape;

    return buildFeedDetailBundleFromParts({
      responsePostId: input.syntheticPostId,
      postData,
      userData,
      liked,
      saved: savedDoc.exists,
      socialOverride: socialCounts,
      queryCount: 4,
      readCount: postSnapshot.docs.length + 3 + socialCounts.additionalReads
    });
  }

  /**
   * Loads post + author + viewer state by canonical Firestore post document id.
   * Returns null when the post is missing or reads time out.
   */
  async tryGetFeedDetailBundleByPostId(postId: string, viewerId: string): Promise<FirestoreFeedDetailBundle | null> {
    if (!this.db) return null;
    try {
      const postSnapshot = await withTimeout(
        this.db.collection("posts").doc(postId).get(),
        FeedDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        "feed-detail-firestore-post-by-id"
      );
      if (!postSnapshot.exists) return null;
      const postData = postSnapshot.data() as PostDataShape;
      const userId = typeof postData.userId === "string" && postData.userId.trim() ? postData.userId.trim() : "";
      if (!userId) return null;
      const [liked, savedDoc, socialCounts] = await withTimeout(
        Promise.all([
          this.resolveViewerLikedState(postId, viewerId),
          this.db.collection("users").doc(viewerId).collection("savedPosts").doc(postId).get(),
          this.resolveSocialCountsFromSubcollections(postId, postData),
        ]),
        FeedDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        "feed-detail-firestore-viewer-state-by-id"
      );
      return buildFeedDetailBundleFromParts({
        responsePostId: postId,
        postData,
        userData: {
          handle: postData.userHandle,
          name: postData.userName,
          displayName: postData.userDisplayName,
          profilePic: postData.userPic,
          profilePicture: postData.userProfilePicture,
          photo: postData.userPhoto
        },
        liked,
        saved: savedDoc.exists,
        socialOverride: socialCounts,
        queryCount: 3,
        readCount: 3 + socialCounts.additionalReads
      });
    } catch {
      return null;
    }
  }

  private async resolveViewerLikedState(postId: string, viewerId: string): Promise<boolean> {
    const likesRef = this.db!.collection("posts").doc(postId).collection("likes");
    const direct = await likesRef.doc(viewerId).get();
    if (direct.exists) return true;
    const byField = await likesRef
      .where("userId", "==", viewerId)
      .limit(1)
      .get();
    return !byField.empty;
  }

  private async resolveSocialCountsFromSubcollections(
    postId: string,
    postData: PostDataShape,
  ): Promise<{ likeCount: number; commentCount: number; additionalReads: number }> {
    const likeCountFromPost = normalizeCounter(postData.likesCount ?? postData.likeCount);
    const commentCountFromPost = resolveCommentCount(postData);
    if (likeCountFromPost > 0 && commentCountFromPost > 0) {
      return { likeCount: likeCountFromPost, commentCount: commentCountFromPost, additionalReads: 0 };
    }
    const postRef = this.db!.collection("posts").doc(postId);
    const [likesAgg, commentsAgg] = await Promise.all([
      likeCountFromPost > 0 ? null : postRef.collection("likes").count().get(),
      commentCountFromPost > 0 ? null : postRef.collection("comments").count().get(),
    ]);
    return {
      likeCount: likeCountFromPost > 0 ? likeCountFromPost : normalizeCounter(likesAgg?.data().count),
      commentCount: commentCountFromPost > 0 ? commentCountFromPost : normalizeCounter(commentsAgg?.data().count),
      additionalReads: (likeCountFromPost > 0 ? 0 : 1) + (commentCountFromPost > 0 ? 0 : 1),
    };
  }
}

type PostDataShape = {
  userId?: string;
  userHandle?: string;
  userName?: string;
  userDisplayName?: string;
  userPic?: string;
  userProfilePicture?: string;
  userPhoto?: string;
  caption?: string;
  content?: string;
  title?: string;
  description?: string;
  city?: string;
  state?: string;
  country?: string;
  locationSource?: string;
  reverseGeocodeStatus?: string;
  activities?: unknown[];
  address?: string;
  lat?: number;
  latitude?: number;
  lng?: number;
  long?: number;
  longitude?: number;
  location?: Record<string, unknown>;
  coordinates?: Record<string, unknown>;
  geo?: Record<string, unknown>;
  geoData?: Record<string, unknown>;
  tags?: unknown[];
  createdAtMs?: number;
  updatedAtMs?: number;
  time?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastUpdated?: unknown;
  mediaType?: "image" | "video";
  thumbUrl?: string;
  displayPhotoLink?: string;
  photoLink?: string;
  media?: Record<string, unknown>;
  assetsReady?: boolean;
  playbackLab?: Record<string, unknown>;
  assetLocations?: Array<Record<string, unknown>>;
  assets?: Array<{
    id?: string;
    type?: "image" | "video";
    original?: string;
    poster?: string;
    thumbnail?: string;
    aspectRatio?: number;
    durationSec?: number;
    width?: number;
    height?: number;
    orientation?: string;
    hasAudio?: boolean;
    codecs?: Record<string, unknown>;
    variantMetadata?: Record<string, unknown>;
    instantPlaybackReady?: boolean;
    playbackLab?: Record<string, unknown>;
    generated?: Record<string, unknown>;
    variants?: Record<string, unknown>;
  }>;
  likeCount?: number;
  likesCount?: number;
  commentCount?: number;
  commentsCount?: number;
  comments?: unknown[];
  carouselFitWidth?: unknown;
  layoutLetterbox?: unknown;
  letterboxGradientTop?: unknown;
  letterboxGradientBottom?: unknown;
  letterbox_gradient_top?: unknown;
  letterbox_gradient_bottom?: unknown;
  letterboxGradients?: unknown;
};

type UserDataShape = {
  handle?: string;
  name?: string;
  displayName?: string;
  profilePic?: string;
  profilePicture?: string;
  photo?: string;
};

function buildFeedDetailBundleFromParts(input: {
  responsePostId: string;
  postData: PostDataShape;
  userData: UserDataShape;
  liked: boolean;
  saved: boolean;
  socialOverride?: { likeCount: number; commentCount: number; additionalReads?: number };
  queryCount: number;
  readCount: number;
}): FirestoreFeedDetailBundle {
  const userId =
    typeof input.postData.userId === "string" && input.postData.userId.trim()
      ? input.postData.userId.trim()
      : `author-placeholder`;

  const mediaType = input.postData.mediaType === "video" ? "video" : "image";
  const thumbUrl = resolveThumbCandidate(input.postData);
  if (!thumbUrl) {
    throw new Error("feed_detail_missing_media");
  }

  const createdAtMsCandidate =
    typeof input.postData.createdAtMs === "number" && Number.isFinite(input.postData.createdAtMs) && input.postData.createdAtMs > 0
      ? input.postData.createdAtMs
      : readMaybeMillis(input.postData.time) ??
        readMaybeMillis(input.postData.createdAt) ??
        readMaybeMillis(input.postData.lastUpdated) ??
        readMaybeMillis(input.postData.updatedAt) ??
        (typeof input.postData.updatedAtMs === "number" ? input.postData.updatedAtMs : null);

  const updatedAtMsCandidate =
    typeof input.postData.updatedAtMs === "number" && Number.isFinite(input.postData.updatedAtMs) && input.postData.updatedAtMs > 0
      ? input.postData.updatedAtMs
      : readMaybeMillis(input.postData.lastUpdated) ??
        readMaybeMillis(input.postData.updatedAt) ??
        readMaybeMillis(input.postData.time) ??
        readMaybeMillis(input.postData.createdAt) ??
        (typeof input.postData.createdAtMs === "number" ? input.postData.createdAtMs : null);

  const { letterboxGradientTop, letterboxGradientBottom, letterboxGradients } =
    normalizeLetterboxHintsFromFirestorePost(input.postData as unknown as Record<string, unknown>);
  const normalizedLocation = normalizeLocation(input.postData);
  const normalizedGeoData = normalizeGeoData(input.postData);
  const embeddedComments = normalizeEmbeddedComments(input.postData.comments, input.responsePostId);
  const safeText = buildSafeDisplayTextBlock(input.postData as Record<string, unknown>);
  const postSeed = {
      postId: input.responsePostId,
      userId,
      caption: normalizeCaption(input.postData),
      title: normalizeNullable(safeText.title) ?? normalizeNullable(input.postData.title),
      description:
        normalizeNullable(safeText.description) ??
        normalizeNullable(safeText.caption) ??
        normalizeNullable(safeText.content),
      activities: normalizeStringArray(input.postData.activities),
      address: normalizeNullable(input.postData.address) ?? normalizedLocation.address ?? null,
      lat: normalizedLocation.lat,
      lng: normalizedLocation.lng,
      ...(normalizedGeoData ? { geoData: normalizedGeoData } : {}),
      coordinates: {
        lat: normalizedLocation.lat,
        lng: normalizedLocation.lng,
      },
      tags: normalizeStringArray(input.postData.tags),
      createdAtMs: normalizeTs(createdAtMsCandidate),
      updatedAtMs: normalizeTs(updatedAtMsCandidate),
      carouselFitWidth: typeof input.postData.carouselFitWidth === "boolean" ? input.postData.carouselFitWidth : undefined,
      layoutLetterbox: typeof input.postData.layoutLetterbox === "boolean" ? input.postData.layoutLetterbox : undefined,
      letterboxGradientTop,
      letterboxGradientBottom,
      ...(letterboxGradients ? { letterboxGradients } : {}),
      mediaType,
      thumbUrl: normalizeThumbUrl(input.postData, thumbUrl),
      assetsReady: typeof input.postData.assetsReady === "boolean" ? input.postData.assetsReady : undefined,
      playbackLab: asRecord(input.postData.playbackLab) ?? undefined,
      assetLocations: normalizeAssetLocations(input.postData.assetLocations),
      assets: normalizeAssets(input.responsePostId, mediaType, thumbUrl, input.postData),
      comments: embeddedComments,
      commentsPreview: embeddedComments,
      rawPost: input.postData as unknown as Record<string, unknown>,
      sourcePost: input.postData as unknown as Record<string, unknown>,
    };
  return {
    post: postSeed as FirestoreFeedDetailBundle["post"],
    author: {
      userId,
      handle: String(input.userData.handle ?? "").replace(/^@+/, "") || `user_${userId.slice(0, 8)}`,
      name: normalizeNullable(input.userData.name ?? input.userData.displayName),
      pic: normalizeNullable(input.userData.profilePic ?? input.userData.profilePicture ?? input.userData.photo)
    },
    social: {
      likeCount:
        typeof input.socialOverride?.likeCount === "number"
          ? Math.max(0, input.socialOverride.likeCount)
          : normalizeCounter(input.postData.likesCount ?? input.postData.likeCount),
      commentCount:
        typeof input.socialOverride?.commentCount === "number"
          ? Math.max(0, input.socialOverride.commentCount)
          : resolveCommentCount(input.postData)
    },
    viewer: {
      liked: input.liked,
      saved: input.saved
    },
    queryCount: input.queryCount,
    readCount: input.readCount
  };
}

function resolveThumbCandidate(data: PostDataShape): string {
  const direct = normalizeNullable(data.thumbUrl);
  if (direct) return direct;
  const display = normalizeNullable(data.displayPhotoLink);
  if (display) return display;
  if (typeof data.photoLink === "string" && data.photoLink.includes(",")) {
    const first = data.photoLink
      .split(",")
      .map((v) => v.trim())
      .find((v) => v.length > 0);
    if (first) return first;
  }
  if (typeof data.photoLink === "string" && data.photoLink.trim()) {
    return data.photoLink.trim();
  }
  if (Array.isArray(data.assets)) {
    for (const asset of data.assets) {
      if (typeof asset.thumbnail === "string" && asset.thumbnail.trim()) return asset.thumbnail.trim();
      if (typeof asset.poster === "string" && asset.poster.trim()) return asset.poster.trim();
      if (typeof asset.original === "string" && asset.original.trim()) return asset.original.trim();
    }
  }
  return "";
}

function normalizeNullable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeCounter(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function resolveCommentCount(post: PostDataShape): number {
  const explicit = normalizeCounter(post.commentsCount ?? post.commentCount);
  if (explicit > 0) return explicit;
  if (!Array.isArray(post.comments)) return 0;
  return post.comments.filter((entry) => isTopLevelEmbeddedComment(entry)).length;
}

function getCommentText(comment: Record<string, unknown>): string {
  const candidates = [
    comment.content,
    comment.text,
    comment.body,
    comment.comment,
    comment.message,
    comment.caption,
  ];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function normalizeEmbeddedComments(value: unknown, postIdForDebug?: string): NormalizedEmbeddedComment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map<NormalizedEmbeddedComment | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const wire = entry as Record<string, unknown>;
      const idRaw = wire.id ?? wire.commentId;
      const id = typeof idRaw === "string" ? idRaw.trim() : "";
      if (!id) return null;
      const text = getCommentText(wire);
      if (process.env.NODE_ENV !== "production" && text.length === 0) {
        console.warn("[comments_v2_empty_text]", {
          postId: postIdForDebug ?? null,
          commentId: id,
          rawCommentKeys: Object.keys(wire),
          rawComment: wire,
        });
      }
      return {
        id,
        commentId: id,
        content: text,
        text,
        userId: typeof wire.userId === "string" ? wire.userId : "",
        userName: typeof wire.userName === "string" ? wire.userName : null,
        userHandle: typeof wire.userHandle === "string" ? wire.userHandle : null,
        userPic: typeof wire.userPic === "string" ? wire.userPic : null,
        time: wire.time ?? null,
        createdAt: wire.createdAt ?? wire.time ?? null,
        likedBy: Array.isArray(wire.likedBy)
          ? wire.likedBy.filter((v): v is string => typeof v === "string")
          : [],
        replies: Array.isArray(wire.replies) ? wire.replies : [],
      };
    })
    .filter((row): row is NormalizedEmbeddedComment => row !== null);
}

function isTopLevelEmbeddedComment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const wire = value as { id?: unknown; commentId?: unknown; replyingTo?: unknown };
  const commentIdRaw = wire.id ?? wire.commentId;
  const commentId = typeof commentIdRaw === "string" ? commentIdRaw.trim() : "";
  if (!commentId) return false;
  return wire.replyingTo == null;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function readGeoPoint(value: unknown): { latitude?: unknown; longitude?: unknown } | null {
  if (!value || typeof value !== "object") return null;
  const gp = value as { latitude?: unknown; longitude?: unknown };
  return gp;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeLocation(post: PostDataShape): {
  lat: number | null;
  lng: number | null;
  address: string | null;
} {
  const location = (post.location ?? {}) as Record<string, unknown>;
  const coordinates = (post.coordinates ?? {}) as Record<string, unknown>;
  const geo = (post.geo ?? post.geoData ?? {}) as Record<string, unknown>;
  const geoPoint = readGeoPoint((geo as { geopoint?: unknown }).geopoint);
  const lat = firstFiniteNumber(
      post.lat,
      post.latitude,
      location.lat,
      location.latitude,
      coordinates.lat,
      coordinates.latitude,
      geoPoint?.latitude,
    );
  const lng = firstFiniteNumber(
      post.long,
      post.lng,
      post.longitude,
      location.long,
      location.lng,
      location.longitude,
      coordinates.long,
      coordinates.lng,
      coordinates.longitude,
      geoPoint?.longitude,
    );
  const normalized = normalizeCanonicalPostLocation({
    latitude: lat,
    longitude: lng,
    addressDisplayName:
      normalizeNullable(post.address) ??
      normalizeNullable(location.address) ??
      normalizeNullable((geo as { address?: unknown }).address),
    city: normalizeNullable((geo as { city?: unknown }).city) ?? normalizeNullable((post as Record<string, unknown>).city),
    region: normalizeNullable((geo as { state?: unknown }).state) ?? normalizeNullable((post as Record<string, unknown>).state),
    country: normalizeNullable((geo as { country?: unknown }).country) ?? normalizeNullable((post as Record<string, unknown>).country),
    source: post.locationSource ?? "unknown",
    reverseGeocodeMatched: post.reverseGeocodeStatus === "resolved"
  });
  return {
    lat: normalized.latitude,
    lng: normalized.longitude,
    address: normalized.addressDisplayName ?? "Unknown location"
  };
}

function normalizeGeoData(
  post: PostDataShape,
): {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  geohash?: string | null;
} | undefined {
  const geo = (post.geo ?? post.geoData ?? {}) as Record<string, unknown>;
  const city = normalizeNullable(geo.city);
  const state = normalizeNullable(geo.state);
  const country = normalizeNullable(geo.country);
  const geohash = normalizeNullable(geo.geohash);
  if (!city && !state && !country && !geohash) return undefined;
  return { city, state, country, geohash };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeAssetLocations(
  value: unknown,
): Array<{ lat?: number | null; long?: number | null }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map<{ lat?: number | null; long?: number | null } | null>((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const lat = firstFiniteNumber(record.lat, record.latitude);
      const long = firstFiniteNumber(record.long, record.lng, record.longitude);
      if (lat == null && long == null) return null;
      return {
        ...(lat != null ? { lat } : {}),
        ...(long != null ? { long } : {}),
      };
    })
    .filter((entry): entry is { lat?: number | null; long?: number | null } => entry !== null);
  return out.length > 0 ? out : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function normalizeCaption(data: PostDataShape): string | null {
  const safe = buildSafeDisplayTextBlock(data as Record<string, unknown>);
  return (
    normalizeNullable(safe.caption) ??
    normalizeNullable(safe.description) ??
    normalizeNullable(safe.content) ??
    normalizeNullable(safe.title) ??
    normalizeNullable(data.title)
  );
}

function normalizeThumbUrl(data: PostDataShape, fallback: string): string {
  const candidate = normalizeNullable(data.thumbUrl) ?? normalizeNullable(data.displayPhotoLink);
  if (candidate) return candidate;
  if (typeof data.photoLink === "string" && data.photoLink.includes(",")) {
    const first = data.photoLink.split(",").map((v) => v.trim()).find(Boolean);
    if (first) return first;
  }
  return fallback;
}

function normalizeTs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return Date.now();
  return Math.floor(value);
}

function isLikelyVideoUrlHint(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /\.(mp4|mov|m4v|webm|m3u8)(\?|#|$)/i.test(value.trim());
}

/** Firestore rows sometimes store `type: "image"` while `id` is `video_*` and variants carry mp4. */
function inferFirestoreAssetIsVideo(asset: NonNullable<PostDataShape["assets"]>[number]): boolean {
  if (String(asset.type ?? "").toLowerCase() === "video") return true;
  const id = typeof asset.id === "string" ? asset.id : "";
  if (/^video_/i.test(id)) return true;
  if (isLikelyVideoUrlHint(asset.original)) return true;
  const v = asRecord(asset.variants);
  if (v && Object.values(v).some((val) => isLikelyVideoUrlHint(val))) return true;
  return false;
}

function normalizeAssets(
  syntheticPostId: string,
  mediaType: "image" | "video",
  thumbUrl: string,
  postData: PostDataShape,
): FirestoreFeedDetailBundle["post"]["assets"] {
  const canonicalMedia = asRecord(postData.media);
  const canonicalMediaAssets = Array.isArray(canonicalMedia?.assets)
    ? (canonicalMedia.assets as Array<Record<string, unknown>>)
    : [];
  const canonicalTopAssets = canonicalMediaAssets.map((asset) => {
    const image = asRecord(asset.image);
    const video = asRecord(asset.video);
    const videoTechnical = asRecord(video?.technical);
    const playback = asRecord(video?.playback);
    const variants = asRecord(video?.variants);
    return {
      id: typeof asset.id === "string" ? asset.id : undefined,
      type: (String(asset.type ?? "image").toLowerCase() === "video" ? "video" : "image") as "image" | "video",
      original:
        normalizeNullable(image?.originalUrl) ??
        normalizeNullable(video?.originalUrl) ??
        normalizeNullable(playback?.primaryUrl) ??
        normalizeNullable(playback?.defaultUrl) ??
        normalizeNullable(playback?.startupUrl) ??
        undefined,
      poster:
        normalizeNullable(video?.posterHighUrl) ??
        normalizeNullable(video?.posterUrl) ??
        normalizeNullable(video?.thumbnailUrl) ??
        normalizeNullable(image?.displayUrl) ??
        normalizeNullable(image?.thumbnailUrl) ??
        thumbUrl,
      thumbnail:
        normalizeNullable(image?.thumbnailUrl) ??
        normalizeNullable(video?.thumbnailUrl) ??
        normalizeNullable(video?.posterUrl) ??
        normalizeNullable(image?.displayUrl) ??
        thumbUrl,
      aspectRatio: normalizeNullableNumber(image?.aspectRatio ?? asset.aspectRatio),
      durationSec: normalizeNullableNumber(video?.durationSec ?? asset.durationSec),
      width: normalizeNullableNumber(image?.width ?? videoTechnical?.width ?? asset.width),
      height: normalizeNullableNumber(image?.height ?? videoTechnical?.height ?? asset.height),
      orientation: normalizeNullable(image?.orientation ?? asset.orientation),
      hasAudio: typeof video?.hasAudio === "boolean" ? video.hasAudio : undefined,
      codecs: asRecord(video?.technical) ?? undefined,
      variantMetadata: asRecord(asset.presentation) ?? undefined,
      instantPlaybackReady:
        typeof video?.readiness === "object" && video?.readiness
          ? Boolean((video.readiness as Record<string, unknown>).instantPlaybackReady)
          : undefined,
      playbackLab: asRecord(video?.playback) ?? undefined,
      generated: undefined,
      variants: {
        ...(variants ?? {}),
        ...(asRecord(playback) ?? {}),
      },
    };
  });
  const rawAssets =
    canonicalTopAssets.length > 0
      ? canonicalTopAssets
      : Array.isArray(postData.assets)
        ? postData.assets
        : undefined;
  const playbackLabAssets = asRecord(asRecord(postData.playbackLab)?.assets);
  if (Array.isArray(rawAssets) && rawAssets.length > 0) {
    return rawAssets.map((asset, idx) => {
      const assetRec = asset as Record<string, unknown>;
      const assetId = typeof assetRec.id === "string" && assetRec.id ? assetRec.id : `${syntheticPostId}-asset-${idx + 1}`;
      const labAsset = asRecord(playbackLabAssets?.[String(assetRec.id ?? "")]);
      const sourceSnapshot = asRecord(labAsset?.sourceSnapshot);
      return {
        id: assetId,
        type: inferFirestoreAssetIsVideo(assetRec as NonNullable<PostDataShape["assets"]>[number]) ? "video" : "image",
        original:
          normalizeNullable(assetRec.original) ??
          normalizeNullable(sourceSnapshot?.original) ??
          null,
        poster:
          normalizeNullable(assetRec.poster) ??
          normalizeNullable(assetRec.thumbnail) ??
          normalizeNullable(sourceSnapshot?.poster) ??
          thumbUrl,
        thumbnail:
          normalizeNullable(assetRec.thumbnail) ??
          normalizeNullable(assetRec.poster) ??
          normalizeNullable(sourceSnapshot?.poster) ??
          thumbUrl,
        aspectRatio: normalizeNullableNumber(assetRec.aspectRatio),
        durationSec: normalizeNullableNumber(assetRec.durationSec),
        width: normalizeNullableNumber(assetRec.width),
        height: normalizeNullableNumber(assetRec.height),
        orientation: normalizeNullable(assetRec.orientation),
        ...(typeof assetRec.hasAudio === "boolean" ? { hasAudio: assetRec.hasAudio } : {}),
        ...(asRecord(assetRec.codecs) ? { codecs: asRecord(assetRec.codecs) ?? undefined } : {}),
        ...(asRecord(assetRec.variantMetadata)
          ? { variantMetadata: asRecord(assetRec.variantMetadata) ?? undefined }
          : {}),
        ...(typeof assetRec.instantPlaybackReady === "boolean"
          ? { instantPlaybackReady: assetRec.instantPlaybackReady }
          : {}),
        ...(asRecord(assetRec.playbackLab) ? { playbackLab: asRecord(assetRec.playbackLab) ?? undefined } : {}),
        ...(asRecord(assetRec.generated) ? { generated: asRecord(assetRec.generated) ?? undefined } : {}),
        variants: {
          ...(assetRec.variants ?? {}),
          ...(asRecord(sourceSnapshot?.variants) ?? {}),
          ...(asRecord(labAsset?.generated) ?? {}),
          ...(asRecord(assetRec.generated) ?? {}),
        }
      };
    });
  }
  if (mediaType === "video") {
    return [
      {
        id: `${syntheticPostId}-asset-1`,
        type: "video",
        poster: thumbUrl,
        thumbnail: thumbUrl
      }
    ];
  }
  return [
    {
      id: `${syntheticPostId}-asset-1`,
      type: "image",
      poster: thumbUrl,
      thumbnail: thumbUrl
    }
  ];
}

export function __testNormalizeFeedDetailAssetsFromPostData(input: {
  postId: string;
  mediaType: "image" | "video";
  thumbUrl: string;
  postData: Record<string, unknown>;
}): FirestoreFeedDetailBundle["post"]["assets"] {
  return normalizeAssets(input.postId, input.mediaType, input.thumbUrl, input.postData as PostDataShape);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}
