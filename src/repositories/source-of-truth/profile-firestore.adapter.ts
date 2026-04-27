import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { mapPostDocToGridPreview, readOrderMillisFromSnapshot } from "./post-firestore-projection.js";

export type FirestoreProfileHeader = {
  userId: string;
  handle: string;
  name: string;
  profilePic: string | null;
  bio?: string;
  counts: {
    posts: number;
    followers: number;
    following: number;
  };
};

export type FirestoreProfileRelationship = {
  isSelf: boolean;
  following: boolean;
  followedBy: boolean;
  canMessage: boolean;
};

export type FirestoreProfilePreviewItem = {
  postId: string;
  thumbUrl: string;
  mediaType: "image" | "video";
  aspectRatio?: number;
  updatedAtMs: number;
  processing?: boolean;
  processingFailed?: boolean;
};

export type FirestoreProfilePreviewPage = {
  items: FirestoreProfilePreviewItem[];
  nextCursor: string | null;
  queryCount: number;
  readCount: number;
};

type ProfileUserDoc = {
  handle?: string;
  name?: string;
  displayName?: string;
  profilePicPath?: string;
  profilePicLarge?: string;
  profilePicSmall?: string;
  photoURL?: string;
  bio?: string;
  postCount?: number;
  postsCount?: number;
  numPosts?: number;
  numposts?: number;
  followerCount?: number;
  followersCount?: number;
  followingCount?: number;
  postCountVerifiedAtMs?: number;
  postCountVerifiedValue?: number;
  followers?: unknown[];
  following?: unknown[];
  stats?: {
    posts?: unknown;
    totalPosts?: unknown;
  };
};

/** Cursor modes for profile grid: stable paging avoids offset scans on deep pages. */
export type ProfileGridFirestoreCursor =
  | { mode: "first" }
  | { mode: "legacy_offset"; offset: number }
  | { mode: "stable_after"; orderMs: number; postId: string; orderKind: "timestamp" | "number" };

export class ProfileFirestoreAdapter {
  private static readonly PROFILE_HEADER_FIELD_MASK = [
    "handle",
    "name",
    "displayName",
    "profilePicPath",
    "profilePicLarge",
    "profilePicSmall",
    "photoURL",
    "bio",
    "postCount",
    "postsCount",
    "numPosts",
    "numposts",
    "postCountVerifiedAtMs",
    "postCountVerifiedValue",
    "followerCount",
    "followersCount",
    "followingCount",
    "followers",
    "following",
    "stats"
  ] as const;
  private static readonly postCountVerificationInFlight = new Set<string>();
  constructor(private readonly db = getFirestoreSourceClient()) {}
  private static readonly FIRESTORE_TIMEOUT_MS = 1200;
  private static readonly LEGACY_SCAN_CAP = 240;
  private static readonly VERIFIED_POST_COUNT_TTL_MS = 5 * 60_000;
  private disabledUntilMs = 0;

  static resetCachesForTests(): void {
    ProfileFirestoreAdapter.postCountVerificationInFlight.clear();
  }

  isEnabled(): boolean {
    if (!this.db) return false;
    return Date.now() >= this.disabledUntilMs;
  }

  markUnavailableBriefly(): void {
    this.disabledUntilMs = Date.now() + 5_000;
  }

  async getProfileHeader(userId: string): Promise<{ data: FirestoreProfileHeader; queryCount: number; readCount: number }> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const cachedData = await globalCache.get<ProfileUserDoc>(entityCacheKeys.userFirestoreDoc(userId));
    let baseQueryCount = 0;
    let baseReadCount = 0;
    let data: ProfileUserDoc | undefined = cachedData;
    if (!data) {
      const docRef = this.db.collection("users").doc(userId);
      const doc = await withTimeout(
        typeof (this.db as { getAll?: unknown }).getAll === "function"
          ? (
              this.db as {
                getAll: (
                  ref: FirebaseFirestore.DocumentReference,
                  options: { fieldMask: string[] }
                ) => Promise<FirebaseFirestore.DocumentSnapshot[]>;
              }
            )
              .getAll(docRef, { fieldMask: [...ProfileFirestoreAdapter.PROFILE_HEADER_FIELD_MASK] })
              .then(([snap]) => snap)
          : docRef.get(),
        ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        "profile-firestore-header"
      );
      if (!doc?.exists) throw new Error("profile_header_not_found");
      data = doc.data() as ProfileUserDoc;
      baseQueryCount = 1;
      baseReadCount = 1;
      void globalCache.set(entityCacheKeys.userFirestoreDoc(userId), data, 25_000);
    }
    if (!data) throw new Error("profile_header_not_found");
    const stats = data.stats && typeof data.stats === "object" ? data.stats : undefined;
    const nestedEmbeddedPostCount =
      normalizeEmbeddedCount(stats?.posts) ?? normalizeEmbeddedCount(stats?.totalPosts) ?? undefined;
    const flatEmbeddedPostCount =
      normalizeEmbeddedCount(data.postCount ?? data.postsCount ?? data.numPosts ?? data.numposts) ?? undefined;
    const verifiedPostCount = normalizeEmbeddedCount(data.postCountVerifiedValue);
    const embeddedPostCount =
      typeof verifiedPostCount === "number" &&
      typeof flatEmbeddedPostCount === "number" &&
      verifiedPostCount === flatEmbeddedPostCount
        ? flatEmbeddedPostCount
        : pickCount(nestedEmbeddedPostCount, flatEmbeddedPostCount) ?? 0;
    const [followCounts, postCount] = await Promise.all([
      this.getFollowCounts(userId, data),
      this.countPostsByUser(userId, embeddedPostCount, data.postCountVerifiedAtMs, verifiedPostCount ?? undefined)
    ]);
    return {
      data: {
        userId,
        handle: String(data.handle ?? "").replace(/^@+/, ""),
        name: String(data.name ?? data.displayName ?? "").trim(),
        profilePic: pickPic(data),
        bio: typeof data.bio === "string" ? data.bio : undefined,
        counts: {
          posts: postCount.count ?? embeddedPostCount,
          followers: followCounts.followersCount,
          following: followCounts.followingCount
        }
      },
      queryCount: baseQueryCount + followCounts.queryCount + postCount.queryCount,
      readCount: baseReadCount + followCounts.readCount + postCount.readCount
    };
  }

  async getRelationship(viewerId: string, targetUserId: string): Promise<{ data: FirestoreProfileRelationship; queryCount: number; readCount: number }> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const isSelf = viewerId === targetUserId;
    if (isSelf) {
      return {
        data: { isSelf: true, following: false, followedBy: false, canMessage: true },
        queryCount: 0,
        readCount: 0
      };
    }
    const [followingDoc, followedByDoc] = await withTimeout(
      Promise.all([
        this.db.collection("users").doc(viewerId).collection("following").doc(targetUserId).get(),
        this.db.collection("users").doc(targetUserId).collection("following").doc(viewerId).get()
      ]),
      ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "profile-firestore-relationship"
    );
    return {
      data: {
        isSelf: false,
        following: followingDoc.exists,
        followedBy: followedByDoc.exists,
        canMessage: true
      },
      queryCount: 2,
      readCount: 2
    };
  }

  async getGridPreview(userId: string, limit: number): Promise<FirestoreProfilePreviewPage> {
    return this.getGridPageInternal(userId, { mode: "first" }, limit, "profile-firestore-grid-preview");
  }

  async getGridPage(userId: string, cursor: ProfileGridFirestoreCursor, limit: number): Promise<FirestoreProfilePreviewPage> {
    return this.getGridPageInternal(userId, cursor, limit, "profile-firestore-grid-page");
  }

  private async getFollowCounts(
    _userId: string,
    userDocData: {
      followerCount?: unknown;
      followersCount?: unknown;
      followingCount?: unknown;
      followers?: unknown[];
      following?: unknown[];
    }
  ): Promise<{ followersCount: number; followingCount: number; source: string; queryCount: number; readCount: number }> {
    const embeddedFollowersCount = normalizeEmbeddedCount(userDocData.followersCount ?? userDocData.followerCount);
    const embeddedFollowingCount = normalizeEmbeddedCount(userDocData.followingCount);
    const followersArray = countUniqueGraphArray(userDocData.followers);
    const followingArray = countUniqueGraphArray(userDocData.following);

    const hasEmbedded = embeddedFollowersCount != null || embeddedFollowingCount != null;
    const hasArrays = followersArray != null || followingArray != null;
    if (hasEmbedded || hasArrays) {
      return {
        followersCount: embeddedFollowersCount ?? followersArray ?? 0,
        followingCount: embeddedFollowingCount ?? followingArray ?? 0,
        source: hasEmbedded && hasArrays ? "embedded_counts_arrays" : hasEmbedded ? "embedded_counts" : "arrays",
        queryCount: 0,
        readCount: 0
      };
    }

    return {
      followersCount: 0,
      followingCount: 0,
      source: "staged_missing_counts",
      queryCount: 0,
      readCount: 0
    };
  }

  private async countPostsByUser(
    userId: string,
    embeddedCount: number,
    verifiedAtMs?: number,
    verifiedCount?: number
  ): Promise<{ count: number | null; queryCount: number; readCount: number }> {
    if (!this.db) return { count: null, queryCount: 0, readCount: 0 };
    const normalizedEmbeddedCount = Math.max(0, Math.floor(embeddedCount));
    const cached = await globalCache.get<number>(entityCacheKeys.userPostCount(userId));
    if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) {
      return { count: Math.floor(cached), queryCount: 0, readCount: 0 };
    }
    const verifiedIsFresh =
      typeof verifiedAtMs === "number" &&
      Number.isFinite(verifiedAtMs) &&
      verifiedAtMs > 0 &&
      Date.now() - verifiedAtMs <= ProfileFirestoreAdapter.VERIFIED_POST_COUNT_TTL_MS;
    const verifiedMatchesEmbedded =
      typeof verifiedCount === "number" &&
      Number.isFinite(verifiedCount) &&
      verifiedCount >= 0 &&
      Math.floor(verifiedCount) === normalizedEmbeddedCount;
    if (verifiedIsFresh && verifiedMatchesEmbedded) {
      return { count: normalizedEmbeddedCount, queryCount: 0, readCount: 0 };
    }
    try {
      const snap = await withTimeout(
        this.db.collection("posts").where("userId", "==", userId).count().get(),
        ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        "profile-firestore-post-count"
      );
      const resolvedCount = Math.max(0, normalizeCount(snap.data()?.count));
      void globalCache.set(entityCacheKeys.userPostCount(userId), resolvedCount, 30_000);
      if (resolvedCount !== normalizedEmbeddedCount) {
        await this.selfHealPostCount(userId, resolvedCount);
      } else {
        await this.touchVerifiedPostCount(userId, resolvedCount);
      }
      return { count: resolvedCount, queryCount: 1, readCount: 0 };
    } catch {
      if (normalizedEmbeddedCount > 0) {
        void this.schedulePostCountVerification(userId, normalizedEmbeddedCount, verifiedAtMs);
      }
      return { count: normalizedEmbeddedCount, queryCount: 0, readCount: 0 };
    }
  }

  private async schedulePostCountVerification(
    userId: string,
    embeddedCount: number,
    verifiedAtMs?: number
  ): Promise<void> {
    if (!this.db) return;
    const verifiedIsFresh =
      typeof verifiedAtMs === "number" &&
      Number.isFinite(verifiedAtMs) &&
      verifiedAtMs > 0 &&
      Date.now() - verifiedAtMs <= ProfileFirestoreAdapter.VERIFIED_POST_COUNT_TTL_MS;
    if (verifiedIsFresh || ProfileFirestoreAdapter.postCountVerificationInFlight.has(userId)) {
      return;
    }
    ProfileFirestoreAdapter.postCountVerificationInFlight.add(userId);
    try {
      const query = this.db.collection("posts").where("userId", "==", userId);
      let resolvedCount: number | null = null;
      if (typeof (query as { count?: unknown }).count === "function") {
        try {
          const snap = await withTimeout(
            (query as { count: () => { get: () => Promise<{ data: () => { count?: unknown } }> } }).count().get(),
            ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
            "profile-firestore-post-count-verify"
          );
          const count = snap.data()?.count;
          if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
            resolvedCount = Math.floor(count);
          }
        } catch {
          resolvedCount = null;
        }
      }
      if (resolvedCount == null) {
        try {
          const snap = await withTimeout(
            query.get(),
            ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
            "profile-firestore-post-scan-verify"
          );
          resolvedCount = snap.size;
        } catch {
          resolvedCount = null;
        }
      }
      if (resolvedCount != null && resolvedCount !== embeddedCount) {
        await this.selfHealPostCount(userId, resolvedCount);
      } else if (resolvedCount != null) {
        const now = Date.now();
        await this.db
          .collection("users")
          .doc(userId)
          .set({ postCountVerifiedAtMs: now, postCountVerifiedValue: resolvedCount }, { merge: true });
        const cached = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(userId));
        if (cached && typeof cached === "object") {
          void globalCache.set(
            entityCacheKeys.userFirestoreDoc(userId),
            {
              ...cached,
              postCountVerifiedAtMs: now,
              postCountVerifiedValue: resolvedCount
            },
            25_000
          ).catch(() => undefined);
        }
      }
    } finally {
      ProfileFirestoreAdapter.postCountVerificationInFlight.delete(userId);
    }
  }

  private async selfHealPostCount(userId: string, canonicalCount: number): Promise<void> {
    if (!this.db) return;
    const now = Date.now();
    await this.db
      .collection("users")
      .doc(userId)
      .set(
        {
          numPosts: canonicalCount,
          postCount: canonicalCount,
          postsCount: canonicalCount,
          postCountVerifiedAtMs: now,
          postCountVerifiedValue: canonicalCount
        },
        { merge: true }
      );
    const cached = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(userId));
    if (cached && typeof cached === "object") {
      void globalCache.set(
        entityCacheKeys.userFirestoreDoc(userId),
        {
          ...cached,
          numPosts: canonicalCount,
          postCount: canonicalCount,
          postsCount: canonicalCount,
          postCountVerifiedAtMs: now,
          postCountVerifiedValue: canonicalCount
        },
        25_000
      ).catch(() => undefined);
    }
  }

  private async touchVerifiedPostCount(userId: string, verifiedCount: number): Promise<void> {
    if (!this.db) return;
    const now = Date.now();
    await this.db
      .collection("users")
      .doc(userId)
      .set({ postCountVerifiedAtMs: now, postCountVerifiedValue: verifiedCount }, { merge: true });
    const cached = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(userId));
    if (cached && typeof cached === "object") {
      void globalCache.set(
        entityCacheKeys.userFirestoreDoc(userId),
        {
          ...cached,
          postCountVerifiedAtMs: now,
          postCountVerifiedValue: verifiedCount
        },
        25_000
      ).catch(() => undefined);
    }
  }

  private async getGridPageInternal(
    userId: string,
    cursor: ProfileGridFirestoreCursor,
    limit: number,
    timeoutLabel: string
  ): Promise<FirestoreProfilePreviewPage> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const safeLimit = Math.max(1, Math.min(limit, 24));

    if (cursor.mode === "legacy_offset") {
      return this.getGridLegacyOffsetPage(userId, cursor.offset, safeLimit);
    }

    let queryRef = this.db
      .collection("posts")
      .where("userId", "==", userId)
      .orderBy("time", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .select(
        "time",
        "createdAtMs",
        "updatedAtMs",
        "displayPhotoLink",
        "photoLink",
        "thumbUrl",
        "mediaType",
        "aspectRatio",
        "processing",
        "processingFailed",
        "imageProcessingStatus",
        "assetsReady"
      )
      .limit(safeLimit + 1);

    if (cursor.mode === "stable_after") {
      const orderValue =
        cursor.orderKind === "timestamp" ? Timestamp.fromMillis(cursor.orderMs) : cursor.orderMs;
      queryRef = queryRef.startAfter(orderValue, cursor.postId);
    }

    const snapshot = await withTimeout(queryRef.get(), ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS, timeoutLabel);
    const pageDocs = snapshot.docs.slice(0, safeLimit);
    const items = pageDocs.map((doc) => mapPostDocToGridPreview(doc));
    const hasMore = snapshot.docs.length > safeLimit;
    const last = pageDocs[pageDocs.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeStableGridCursor(readOrderMillisFromSnapshot(last), last.id, last.get("time"))
        : null;

    return {
      items,
      nextCursor,
      queryCount: 1,
      readCount: snapshot.docs.length
    };
  }

  private async getGridLegacyOffsetPage(userId: string, offset: number, safeLimit: number): Promise<FirestoreProfilePreviewPage> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const safeOffset = Math.max(0, Math.floor(offset));
    const scanLimit = Math.min(
      ProfileFirestoreAdapter.LEGACY_SCAN_CAP,
      Math.max(safeOffset + safeLimit + 1, safeLimit + 1)
    );
    const snapshot = await withTimeout(
      this.db
        .collection("posts")
        .where("userId", "==", userId)
        .orderBy("time", "desc")
        .orderBy(FieldPath.documentId(), "desc")
        .select(
          "time",
          "createdAtMs",
          "updatedAtMs",
          "displayPhotoLink",
          "photoLink",
          "thumbUrl",
          "mediaType",
          "aspectRatio",
          "processing",
          "processingFailed",
          "imageProcessingStatus",
          "assetsReady"
        )
        .limit(scanLimit)
        .get(),
      ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "profile-firestore-grid-legacy-offset"
    );

    if (safeOffset >= snapshot.docs.length) {
      return {
        items: [],
        nextCursor: null,
        queryCount: 1,
        readCount: snapshot.docs.length
      };
    }
    const pageDocs = snapshot.docs.slice(safeOffset, safeOffset + safeLimit);
    const items = pageDocs.map((doc) => mapPostDocToGridPreview(doc));
    const hasMore = safeOffset + safeLimit < snapshot.docs.length;
    const last = pageDocs[pageDocs.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeStableGridCursor(readOrderMillisFromSnapshot(last), last.id, last.get("time"))
        : null;
    return {
      items,
      nextCursor,
      queryCount: 1,
      readCount: snapshot.docs.length
    };
  }
}

export function parseProfileGridCursor(cursor: string | null): ProfileGridFirestoreCursor {
  if (!cursor || cursor.trim() === "") {
    return { mode: "first" };
  }
  const trimmed = cursor.trim();
  const legacy = /^cursor:(\d+)$/.exec(trimmed);
  if (legacy) {
    return { mode: "legacy_offset", offset: Number(legacy[1]) };
  }
  const stable = /^pgrid:v1:(.+)$/.exec(trimmed);
  const stablePayload = stable?.[1];
  if (stablePayload) {
    try {
      const raw = Buffer.from(stablePayload, "base64url").toString("utf8");
      const parsed = JSON.parse(raw) as { t?: unknown; id?: unknown; k?: unknown };
      if (typeof parsed.t === "number" && typeof parsed.id === "string" && parsed.id.length > 0) {
        const k = parsed.k === "number" ? "number" : "timestamp";
        return {
          mode: "stable_after",
          orderMs: Math.floor(parsed.t),
          postId: parsed.id,
          orderKind: k
        };
      }
    } catch {
      throw new Error("Invalid cursor format");
    }
  }
  throw new Error("Invalid cursor format");
}

function encodeStableGridCursor(orderMs: number, postId: string, rawOrder: unknown): string {
  const orderKind: "timestamp" | "number" =
    typeof rawOrder === "number" ? "number" : "timestamp";
  const payload = JSON.stringify({ t: orderMs, id: postId, k: orderKind });
  return `pgrid:v1:${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function pickPic(data: {
  profilePicPath?: string;
  profilePicLarge?: string;
  profilePicSmall?: string;
  photoURL?: string;
}): string | null {
  const raw = data.profilePicPath ?? data.profilePicLarge ?? data.profilePicSmall ?? data.photoURL ?? null;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function pickCount(nested: number | undefined, flat: number | undefined): number {
  const a = normalizeCount(nested);
  if (a > 0) return a;
  return normalizeCount(flat);
}

function normalizeCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function normalizeEmbeddedCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function countUniqueGraphArray(values: unknown[] | undefined): number | null {
  if (!Array.isArray(values)) return null;
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      seen.add(value.trim());
      continue;
    }
    if (value && typeof value === "object") {
      const row = value as { userId?: unknown; id?: unknown; uid?: unknown };
      const candidate = [row.userId, row.id, row.uid].find((v) => typeof v === "string" && v.trim().length > 0);
      if (typeof candidate === "string") seen.add(candidate.trim());
    }
  }
  return seen.size;
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
