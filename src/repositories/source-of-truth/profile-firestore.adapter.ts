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
  | { mode: "stable_after"; createdAtMs: number; postId: string };

export class ProfileFirestoreAdapter {
  constructor(private readonly db = getFirestoreSourceClient()) {}
  private static readonly FIRESTORE_TIMEOUT_MS = 1200;
  private static readonly LEGACY_SCAN_CAP = 240;
  private static readonly VERIFIED_POST_COUNT_TTL_MS = 5 * 60_000;
  private disabledUntilMs = 0;

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
      const doc = await withTimeout(
        this.db
          .collection("users")
          .doc(userId)
          .get(),
        ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        "profile-firestore-header"
      );
      if (!doc.exists) throw new Error("profile_header_not_found");
      data = doc.data() as ProfileUserDoc;
      baseQueryCount = 1;
      baseReadCount = 1;
      void globalCache.set(entityCacheKeys.userFirestoreDoc(userId), data, 25_000);
    }
    if (!data) throw new Error("profile_header_not_found");
    const stats = data.stats && typeof data.stats === "object" ? data.stats : undefined;
    const embeddedPostCount =
      pickCount(
        normalizeEmbeddedCount(stats?.posts) ?? normalizeEmbeddedCount(stats?.totalPosts) ?? undefined,
        normalizeEmbeddedCount(data.postCount ?? data.postsCount ?? data.numPosts ?? data.numposts) ?? undefined
      ) ?? 0;
    const [followCounts, postCount] = await Promise.all([
      this.getFollowCounts(userId, data),
      this.countPostsByUser(userId, embeddedPostCount, data.postCountVerifiedAtMs)
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
    userId: string,
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

    if (followersArray != null || followingArray != null) {
      return {
        followersCount: embeddedFollowersCount ?? followersArray ?? 0,
        followingCount: embeddedFollowingCount ?? followingArray ?? 0,
        source: embeddedFollowersCount != null || embeddedFollowingCount != null ? "embedded_counts_arrays" : "arrays",
        queryCount: 0,
        readCount: 0
      };
    }

    const [followersSubcollection, followingSubcollection] = await Promise.all([
      embeddedFollowersCount != null ? Promise.resolve({ count: embeddedFollowersCount, queryCount: 0, readCount: 0 }) : this.countSubcollectionDocs(userId, "followers"),
      embeddedFollowingCount != null ? Promise.resolve({ count: embeddedFollowingCount, queryCount: 0, readCount: 0 }) : this.countSubcollectionDocs(userId, "following")
    ]);

    const followersCount = followersSubcollection.count ?? (followersArray != null ? followersArray : 0);
    const followingCount = followingSubcollection.count ?? (followingArray != null ? followingArray : 0);
    const usedSubcollections = followersSubcollection.count != null || followingSubcollection.count != null;
    const usedArrays =
      (followersSubcollection.count == null && followersArray != null) ||
      (followingSubcollection.count == null && followingArray != null);
    const usedEmbeddedCounts = embeddedFollowersCount != null || embeddedFollowingCount != null;
    const source = usedEmbeddedCounts
      ? usedArrays
        ? "embedded_counts_arrays"
        : "embedded_counts"
      : usedSubcollections && usedArrays
        ? "mixed_subcollections_arrays"
        : usedSubcollections
          ? "subcollections"
          : usedArrays
            ? "arrays"
            : "none";

    return {
      followersCount,
      followingCount,
      source,
      queryCount: followersSubcollection.queryCount + followingSubcollection.queryCount,
      readCount: followersSubcollection.readCount + followingSubcollection.readCount
    };
  }

  private async countSubcollectionDocs(
    userId: string,
    subcollection: "followers" | "following"
  ): Promise<{ count: number | null; queryCount: number; readCount: number }> {
    if (!this.db) return { count: null, queryCount: 0, readCount: 0 };
    const ref = this.db.collection("users").doc(userId).collection(subcollection);
    const supportsAggregateCount = typeof (ref as { count?: unknown }).count === "function";

    if (supportsAggregateCount) {
      try {
        const aggregateSnap = await withTimeout(
          (ref as { count: () => { get: () => Promise<{ data: () => { count?: unknown } }> } }).count().get(),
          ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
          `profile-firestore-${subcollection}-count`
        );
        const count = aggregateSnap.data()?.count;
        if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
          return { count: Math.floor(count), queryCount: 1, readCount: 0 };
        }
      } catch {
        // Fall through to non-aggregate counting.
      }
    }

    try {
      const snap = await withTimeout(
        ref.get(),
        ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        `profile-firestore-${subcollection}-scan`
      );
      return { count: snap.size, queryCount: 1, readCount: snap.size };
    } catch {
      return { count: null, queryCount: 0, readCount: 0 };
    }
  }

  private async countPostsByUser(
    userId: string,
    embeddedCount: number,
    verifiedAtMs?: number
  ): Promise<{ count: number | null; queryCount: number; readCount: number }> {
    if (!this.db) return { count: null, queryCount: 0, readCount: 0 };
    const normalizedEmbeddedCount = Math.max(0, Math.floor(embeddedCount));
    const verifiedIsFresh =
      typeof verifiedAtMs === "number" &&
      Number.isFinite(verifiedAtMs) &&
      verifiedAtMs > 0 &&
      Date.now() - verifiedAtMs <= ProfileFirestoreAdapter.VERIFIED_POST_COUNT_TTL_MS;
    if (verifiedIsFresh) {
      void globalCache.set(entityCacheKeys.userPostCount(userId), normalizedEmbeddedCount, 30_000);
      return { count: normalizedEmbeddedCount, queryCount: 0, readCount: 0 };
    }
    const cached = await globalCache.get<number>(entityCacheKeys.userPostCount(userId));
    if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) {
      return { count: Math.floor(cached), queryCount: 0, readCount: 0 };
    }
    const query = this.db.collection("posts").where("userId", "==", userId);
    try {
      if (typeof (query as { count?: unknown }).count === "function") {
        const snap = await withTimeout(
          (query as { count: () => { get: () => Promise<{ data: () => { count?: unknown } }> } }).count().get(),
          ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
          "profile-firestore-post-count"
        );
        const count = snap.data()?.count;
        if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
          const resolvedCount = Math.floor(count);
          await this.selfHealPostCount(userId, resolvedCount);
          void globalCache.set(entityCacheKeys.userPostCount(userId), resolvedCount, 30_000);
          return { count: resolvedCount, queryCount: 1, readCount: 0 };
        }
      }
    } catch {
      // Fall back to embedded counts if aggregate count is unavailable.
    }
    try {
      const snap = await withTimeout(query.get(), ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS, "profile-firestore-post-scan");
      const resolvedCount = snap.size;
      await this.selfHealPostCount(userId, resolvedCount);
      void globalCache.set(entityCacheKeys.userPostCount(userId), resolvedCount, 30_000);
      return { count: resolvedCount, queryCount: 1, readCount: snap.size };
    } catch {
      if (verifiedIsFresh || normalizedEmbeddedCount >= 0) {
        return { count: normalizedEmbeddedCount, queryCount: 0, readCount: 0 };
      }
      return { count: null, queryCount: 0, readCount: 0 };
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
          postCountVerifiedAtMs: now
        },
        { merge: true }
      );
    const cached = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(userId));
    if (cached && typeof cached === "object") {
      await globalCache.set(
        entityCacheKeys.userFirestoreDoc(userId),
        {
          ...cached,
          numPosts: canonicalCount,
          postCount: canonicalCount,
          postsCount: canonicalCount,
          postCountVerifiedAtMs: now
        },
        25_000
      );
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
        "lastUpdated",
        "updatedAt",
        "createdAtMs",
        "updatedAtMs",
        "displayPhotoLink",
        "photoLink",
        "thumbUrl",
        "assets",
        "mediaType",
        "aspectRatio",
        "processing",
        "processingFailed",
        "imageProcessingStatus",
        "assetsReady"
      )
      .limit(safeLimit + 1);

    if (cursor.mode === "stable_after") {
      queryRef = queryRef.startAfter(Timestamp.fromMillis(cursor.createdAtMs), cursor.postId);
    }

    const snapshot = await withTimeout(queryRef.get(), ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS, timeoutLabel);
    const pageDocs = snapshot.docs.slice(0, safeLimit);
    const items = pageDocs.map((doc) => mapPostDocToGridPreview(doc));
    const hasMore = snapshot.docs.length > safeLimit;
    const last = pageDocs[pageDocs.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeStableGridCursor(readOrderMillisFromSnapshot(last), last.id)
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
          "lastUpdated",
          "updatedAt",
          "createdAtMs",
          "updatedAtMs",
          "displayPhotoLink",
          "photoLink",
          "thumbUrl",
          "assets",
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
        ? encodeStableGridCursor(readOrderMillisFromSnapshot(last), last.id)
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
      const parsed = JSON.parse(raw) as { t?: unknown; id?: unknown };
      if (typeof parsed.t === "number" && typeof parsed.id === "string" && parsed.id.length > 0) {
        return { mode: "stable_after", createdAtMs: Math.floor(parsed.t), postId: parsed.id };
      }
    } catch {
      throw new Error("Invalid cursor format");
    }
  }
  throw new Error("Invalid cursor format");
}

function encodeStableGridCursor(createdAtMs: number, postId: string): string {
  const payload = JSON.stringify({ t: createdAtMs, id: postId });
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
