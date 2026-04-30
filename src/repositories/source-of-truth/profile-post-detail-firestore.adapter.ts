import type { DocumentSnapshot } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "./firestore-client.js";
import {
  inferPostMediaType,
  readMaybeMillis,
  readPostThumbUrl
} from "./post-firestore-projection.js";

export type FirestoreProfilePostDetail = {
  postId: string;
  userId: string;
  caption?: string;
  createdAtMs: number;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string;
  letterboxGradientBottom?: string;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
  mediaType: "image" | "video";
  thumbUrl: string;
  assets: Array<{
    id: string;
    type: "image" | "video";
    poster?: string;
    thumbnail?: string;
    variants?: {
      startup720FaststartAvc?: string;
      main720Avc?: string;
      hls?: string;
    };
  }>;
  author: {
    userId: string;
    handle: string;
    name: string;
    profilePic: string;
  };
  social: {
    likeCount: number;
    commentCount: number;
    viewerHasLiked: boolean;
  };
};

export class ProfilePostDetailFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();
  private static readonly FIRESTORE_TIMEOUT_MS = 400;
  private disabledUntilMs = 0;

  isEnabled(): boolean {
    if (!this.db) return false;
    return Date.now() >= this.disabledUntilMs;
  }

  markUnavailableBriefly(): void {
    this.disabledUntilMs = Date.now() + 5_000;
  }

  async getPostDetail(input: { userId: string; postId: string; viewerId: string }): Promise<{ data: FirestoreProfilePostDetail; queryCount: number; readCount: number }> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const { userId, postId, viewerId } = input;
    const [postDoc, userDoc, likedDoc] = await withTimeout(
      Promise.all([
        this.db.collection("posts").doc(postId).get(),
        this.db.collection("users").doc(userId).get(),
        this.db.collection("posts").doc(postId).collection("likes").doc(viewerId).get()
      ]),
      ProfilePostDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "profile-post-detail-firestore"
    );
    return {
      data: mapProfilePostDetail({
        postDoc,
        userId,
        viewerId,
        userDoc,
        likedDoc
      }),
      queryCount: 3,
      readCount: 3
    };
  }

  async getPostDetailByPostId(input: {
    postId: string;
    viewerId: string;
  }): Promise<{ data: FirestoreProfilePostDetail; queryCount: number; readCount: number } | null> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const postDoc = await withTimeout(
      this.db.collection("posts").doc(input.postId).get(),
      ProfilePostDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "profile-post-detail-by-id-firestore"
    );
    if (!postDoc.exists) return null;
    const raw = postDoc.data() as Record<string, unknown>;
    const userId =
      typeof raw.userId === "string" && raw.userId.trim().length > 0
        ? raw.userId.trim()
        : null;
    if (!userId) return null;
    const [userDoc, likedDoc] = await withTimeout(
      Promise.all([
        this.db.collection("users").doc(userId).get(),
        this.db.collection("posts").doc(input.postId).collection("likes").doc(input.viewerId).get()
      ]),
      ProfilePostDetailFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "profile-post-detail-by-id-hydration"
    );
    return {
      data: mapProfilePostDetail({
        postDoc,
        userId,
        viewerId: input.viewerId,
        userDoc,
        likedDoc
      }),
      queryCount: 3,
      readCount: 3
    };
  }
}

function mapProfilePostDetail(input: {
  postDoc: DocumentSnapshot;
  userId: string;
  viewerId: string;
  userDoc: DocumentSnapshot;
  likedDoc: DocumentSnapshot;
}): FirestoreProfilePostDetail {
  if (!input.postDoc.exists) throw new Error("post_not_found_for_profile");
  const raw = input.postDoc.data() as Record<string, unknown>;
  const postData = raw as {
    userId?: string;
    caption?: string;
    content?: string;
    title?: string;
    createdAtMs?: number;
    mediaType?: "image" | "video";
    thumbUrl?: string;
    assets?: FirestoreProfilePostDetail["assets"];
    likeCount?: number;
    likesCount?: number;
    commentCount?: number;
    commentsCount?: number;
    comments?: unknown[];
    likes?: unknown;
    carouselFitWidth?: unknown;
    layoutLetterbox?: unknown;
    letterboxGradientTop?: unknown;
    letterboxGradientBottom?: unknown;
    letterbox_gradient_top?: unknown;
    letterbox_gradient_bottom?: unknown;
    letterboxGradients?: unknown;
  };
  if (postData.userId !== input.userId) {
    throw new Error("post_not_found_for_profile");
  }
  const userData = (input.userDoc.data() ?? {}) as {
    handle?: string;
    name?: string;
    displayName?: string;
    profilePic?: string;
    profilePicture?: string;
    photo?: string;
  };
  const caption =
    typeof postData.caption === "string"
      ? postData.caption
      : typeof postData.content === "string"
        ? postData.content
        : typeof postData.title === "string"
          ? postData.title
          : undefined;
  const mediaType = inferPostMediaType(raw);
  const likeCount = normalizeCounter(postData.likeCount ?? postData.likesCount);
  const likesArr = Array.isArray(postData.likes) ? postData.likes : [];
  const likedViaArray = likesArr.some(
    (value) => value === input.viewerId || (typeof value === "object" && value && "userId" in value && (value as { userId?: string }).userId === input.viewerId)
  );

  const { letterboxGradientTop, letterboxGradientBottom, letterboxGradients } = normalizeLetterboxHints(postData);
  return {
    postId: input.postDoc.id,
    userId: input.userId,
    caption,
    createdAtMs: normalizePostCreatedMs(raw),
    carouselFitWidth: typeof postData.carouselFitWidth === "boolean" ? postData.carouselFitWidth : undefined,
    layoutLetterbox: typeof postData.layoutLetterbox === "boolean" ? postData.layoutLetterbox : undefined,
    ...(typeof letterboxGradientTop === "string" ? { letterboxGradientTop } : {}),
    ...(typeof letterboxGradientBottom === "string" ? { letterboxGradientBottom } : {}),
    ...(letterboxGradients ? { letterboxGradients } : {}),
    mediaType,
    thumbUrl: readPostThumbUrl(raw, input.postDoc.id),
    assets: Array.isArray(postData.assets) && postData.assets.length > 0 ? postData.assets : defaultAssets(input.postDoc.id, mediaType),
    author: {
      userId: input.userId,
      handle: String(userData.handle ?? "").replace(/^@+/, "") || `user_${input.userId.slice(0, 8)}`,
      name: String(userData.name ?? userData.displayName ?? "").trim() || `User ${input.userId.slice(0, 8)}`,
      profilePic: pickPic(userData)
    },
    social: {
      likeCount,
      commentCount: resolveCommentCount(postData),
      viewerHasLiked: (input.likedDoc.exists || likedViaArray) && input.viewerId.length > 0
    }
  };
}

function resolveCommentCount(post: {
  commentsCount?: number;
  commentCount?: number;
  comments?: unknown[];
}): number {
  const explicit = normalizeCounter(post.commentsCount ?? post.commentCount);
  if (explicit > 0) return explicit;
  if (!Array.isArray(post.comments)) return 0;
  return post.comments.filter((entry) => isTopLevelEmbeddedComment(entry)).length;
}

function isTopLevelEmbeddedComment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const wire = value as { id?: unknown; commentId?: unknown; replyingTo?: unknown };
  const commentIdRaw = wire.id ?? wire.commentId;
  const commentId = typeof commentIdRaw === "string" ? commentIdRaw.trim() : "";
  if (!commentId) return false;
  return wire.replyingTo == null;
}

function normalizeLetterboxHints(data: {
  letterboxGradientTop?: unknown;
  letterboxGradientBottom?: unknown;
  letterbox_gradient_top?: unknown;
  letterbox_gradient_bottom?: unknown;
  letterboxGradients?: unknown;
  legacy?: unknown;
}): {
  letterboxGradientTop: string | undefined;
  letterboxGradientBottom: string | undefined;
  letterboxGradients: Array<{ top: string; bottom: string }> | undefined;
} {
  const legacy = (data as { legacy?: unknown }).legacy as
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
        : "";
  const bottomRaw =
    typeof data.letterboxGradientBottom === "string"
      ? data.letterboxGradientBottom
      : typeof data.letterbox_gradient_bottom === "string"
        ? data.letterbox_gradient_bottom
        : typeof legacy?.letterboxGradientBottom === "string"
          ? (legacy.letterboxGradientBottom as string)
          : typeof legacy?.letterbox_gradient_bottom === "string"
            ? (legacy.letterbox_gradient_bottom as string)
        : "";
  const top = topRaw.trim();
  const bottom = bottomRaw.trim();

  const gradientsRaw = Array.isArray(data.letterboxGradients)
    ? data.letterboxGradients
    : Array.isArray(legacy?.letterboxGradients)
      ? (legacy!.letterboxGradients as unknown[])
      : null;
  if (!Array.isArray(gradientsRaw)) {
    return { letterboxGradientTop: top || undefined, letterboxGradientBottom: bottom || undefined, letterboxGradients: undefined };
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
    letterboxGradientTop: top || undefined,
    letterboxGradientBottom: bottom || undefined,
    letterboxGradients: out.length > 0 ? out : undefined
  };
}

function normalizeCounter(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function normalizePostCreatedMs(data: Record<string, unknown>): number {
  const ms = readMaybeMillis(data.time ?? data.lastUpdated ?? data.updatedAt ?? data.createdAtMs);
  if (ms !== null && ms > 0) return ms;
  return Date.now();
}

function pickPic(data: { profilePic?: string; profilePicture?: string; photo?: string }): string {
  const value = data.profilePic ?? data.profilePicture ?? data.photo;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed && !/placeholder/i.test(trimmed)) return trimmed;
  return "";
}

function defaultAssets(postId: string, mediaType: "image" | "video" | undefined): FirestoreProfilePostDetail["assets"] {
  if (mediaType === "video") {
    return [
      {
        id: `${postId}-asset-1`,
        type: "video"
      }
    ];
  }
  return [
    {
      id: `${postId}-asset-1`,
      type: "image"
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
