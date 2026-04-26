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
    likes?: unknown;
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

  return {
    postId: input.postDoc.id,
    userId: input.userId,
    caption,
    createdAtMs: normalizePostCreatedMs(raw),
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
      commentCount: normalizeCounter(postData.commentCount),
      viewerHasLiked: (input.likedDoc.exists || likedViaArray) && input.viewerId.length > 0
    }
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
