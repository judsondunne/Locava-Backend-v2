import { getFirestoreSourceClient } from "./firestore-client.js";
import { readMaybeMillis } from "./post-firestore-projection.js";

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
    assets: Array<{
      id: string;
      type: "image" | "video";
      original?: string | null;
      poster: string | null;
      thumbnail: string | null;
      variants?: Record<string, unknown>;
    }>;
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
          "long",
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
          "commentCount"
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

    const [userDoc, likedDoc, savedDoc] = await withTimeout(
      Promise.all([
        this.db.collection("users").doc(resolvedUserId).get(),
        this.db.collection("posts").doc(postDoc.id).collection("likes").doc(input.viewerId).get(),
        this.db.collection("users").doc(input.viewerId).collection("savedPosts").doc(postDoc.id).get()
      ]),
      FeedDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "feed-detail-firestore-related"
    );

    const userData = (userDoc.data() ?? {}) as UserDataShape;

    return buildFeedDetailBundleFromParts({
      responsePostId: input.syntheticPostId,
      postData,
      userData,
      liked: likedDoc.exists,
      saved: savedDoc.exists,
      queryCount: 4,
      readCount: postSnapshot.docs.length + 3
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
      const [likedDoc, savedDoc] = await withTimeout(
        Promise.all([
          this.db.collection("posts").doc(postId).collection("likes").doc(viewerId).get(),
          this.db.collection("users").doc(viewerId).collection("savedPosts").doc(postId).get()
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
        liked: likedDoc.exists,
        saved: savedDoc.exists,
        queryCount: 3,
        readCount: 3
      });
    } catch {
      return null;
    }
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
  activities?: unknown[];
  address?: string;
  lat?: number;
  long?: number;
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
  assets?: Array<{
    id?: string;
    type?: "image" | "video";
    original?: string;
    poster?: string;
    thumbnail?: string;
    variants?: Record<string, unknown>;
  }>;
  likeCount?: number;
  likesCount?: number;
  commentCount?: number;
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

  const { letterboxGradientTop, letterboxGradientBottom, letterboxGradients } = normalizeLetterboxHints(input.postData);
  return {
    post: {
      postId: input.responsePostId,
      userId,
      caption: normalizeCaption(input.postData),
      title: normalizeNullable(input.postData.title),
      description: normalizeNullable(input.postData.description),
      activities: normalizeStringArray(input.postData.activities),
      address: normalizeNullable(input.postData.address),
      lat: normalizeNullableNumber(input.postData.lat),
      lng: normalizeNullableNumber(input.postData.long),
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
      assets: normalizeAssets(input.responsePostId, mediaType, thumbUrl, input.postData.assets)
    },
    author: {
      userId,
      handle: String(input.userData.handle ?? "").replace(/^@+/, "") || `user_${userId.slice(0, 8)}`,
      name: normalizeNullable(input.userData.name ?? input.userData.displayName),
      pic: normalizeNullable(input.userData.profilePic ?? input.userData.profilePicture ?? input.userData.photo)
    },
    social: {
      likeCount: normalizeCounter(input.postData.likesCount ?? input.postData.likeCount),
      commentCount: normalizeCounter(input.postData.commentCount)
    },
    viewer: {
      liked: input.liked,
      saved: input.saved
    },
    queryCount: input.queryCount,
    readCount: input.readCount
  };
}

function normalizeLetterboxHints(data: PostDataShape): {
  letterboxGradientTop: string | null | undefined;
  letterboxGradientBottom: string | null | undefined;
  letterboxGradients: Array<{ top: string; bottom: string }> | undefined;
} {
  const legacy = (data as unknown as { legacy?: unknown }).legacy as
    | {
        letterboxGradientTop?: unknown;
        letterboxGradientBottom?: unknown;
        letterboxGradients?: unknown;
        letterbox_gradient_top?: unknown;
        letterbox_gradient_bottom?: unknown;
      }
    | undefined;
  const topRaw =
    typeof data.letterboxGradientTop === "string"
      ? data.letterboxGradientTop
      : typeof data.letterbox_gradient_top === "string"
        ? data.letterbox_gradient_top
        : typeof legacy?.letterboxGradientTop === "string"
          ? (legacy.letterboxGradientTop as string)
          : typeof legacy?.letterbox_gradient_top === "string"
            ? (legacy.letterbox_gradient_top as string)
        : null;
  const bottomRaw =
    typeof data.letterboxGradientBottom === "string"
      ? data.letterboxGradientBottom
      : typeof data.letterbox_gradient_bottom === "string"
        ? data.letterbox_gradient_bottom
        : typeof legacy?.letterboxGradientBottom === "string"
          ? (legacy.letterboxGradientBottom as string)
          : typeof legacy?.letterbox_gradient_bottom === "string"
            ? (legacy.letterbox_gradient_bottom as string)
        : null;
  const top = topRaw?.trim() ? topRaw.trim() : null;
  const bottom = bottomRaw?.trim() ? bottomRaw.trim() : null;

  const gradientsRaw = Array.isArray(data.letterboxGradients)
    ? data.letterboxGradients
    : Array.isArray(legacy?.letterboxGradients)
      ? (legacy!.letterboxGradients as unknown[])
      : null;
  if (!Array.isArray(gradientsRaw)) {
    return { letterboxGradientTop: top ?? undefined, letterboxGradientBottom: bottom ?? undefined, letterboxGradients: undefined };
  }
  const out: Array<{ top: string; bottom: string }> = [];
  for (const entry of gradientsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { top?: unknown; bottom?: unknown };
    if (typeof e.top !== "string" || typeof e.bottom !== "string") continue;
    const t = e.top.trim();
    const b = e.bottom.trim();
    if (!t || !b) continue;
    out.push({ top: t, bottom: b });
  }
  return {
    letterboxGradientTop: top ?? undefined,
    letterboxGradientBottom: bottom ?? undefined,
    letterboxGradients: out.length > 0 ? out : undefined
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

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function normalizeCaption(data: PostDataShape): string | null {
  const caption = normalizeNullable(data.caption);
  if (caption) return caption;
  const content = normalizeNullable(data.content);
  if (content) return content;
  const title = normalizeNullable(data.title);
  if (title) return title;
  return normalizeNullable(data.description);
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

function normalizeAssets(
  syntheticPostId: string,
  mediaType: "image" | "video",
  thumbUrl: string,
  rawAssets:
    | Array<{
        id?: string;
        type?: "image" | "video";
        poster?: string;
        thumbnail?: string;
        original?: string;
        variants?: Record<string, unknown>;
      }>
    | undefined
): FirestoreFeedDetailBundle["post"]["assets"] {
  if (Array.isArray(rawAssets) && rawAssets.length > 0) {
    return rawAssets.map((asset, idx) => ({
      id: typeof asset.id === "string" && asset.id ? asset.id : `${syntheticPostId}-asset-${idx + 1}`,
      type: asset.type === "video" ? "video" : "image",
      original: typeof asset.original === "string" ? asset.original : null,
      poster: typeof asset.poster === "string" ? asset.poster : thumbUrl,
      thumbnail: typeof asset.thumbnail === "string" ? asset.thumbnail : thumbUrl,
      variants: asset.variants ?? {}
    }));
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}
