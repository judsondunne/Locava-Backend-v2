import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { entityCacheKeys, getOrSetEntityCache } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import {
  isCompleteProfileHeaderEntityCache,
  toPublicProfileHeader,
  withProfileHeaderCacheMetadata,
} from "../../domains/profile/profile-header-cache.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { mapPostDocToGridPreview, readMaybeMillis, readOrderMillisFromSnapshot } from "./post-firestore-projection.js";
import type { UserDiscoveryRow } from "../../contracts/entities/user-discovery-entities.contract.js";

export type FirestoreProfileHeader = {
  userId: string;
  handle: string;
  name: string;
  profilePic: string | null;
  profilePicSmallPath?: string | null;
  profilePicLargePath?: string | null;
  profilePicSource?: string | null;
  bio?: string;
  updatedAtMs?: number | null;
  profileVersion?: string | null;
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
  profilePicLargePath?: string;
  profilePicLarge?: string;
  profilePic?: string;
  profilePicture?: string;
  profilePicSmallPath?: string;
  profilePicSmall?: string;
  photo?: string;
  photoURL?: string;
  avatarUrl?: string;
  bio?: string;
  updatedAt?: unknown;
  profileVersion?: unknown;
  postCount?: number;
  postsCount?: number;
  numPosts?: number;
  numposts?: number;
  followerCount?: number;
  followersCount?: number;
  followingCount?: number;
  postCountVerifiedAtMs?: number;
  postCountVerifiedValue?: number;
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
    "profilePicLargePath",
    "profilePicLarge",
    "profilePic",
    "profilePicture",
    "profilePicSmallPath",
    "profilePicSmall",
    "photo",
    "photoURL",
    "avatarUrl",
    "bio",
    "updatedAt",
    "profileVersion",
    "postCount",
    "postsCount",
    "numPosts",
    "numposts",
    "postCountVerifiedAtMs",
    "postCountVerifiedValue",
    "followerCount",
    "followersCount",
    "followingCount",
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

  private async loadUserDiscoveryRows(viewerId: string, userIds: string[]): Promise<UserDiscoveryRow[]> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const unique = [...new Set(userIds.filter(Boolean))].slice(0, 200);
    if (unique.length === 0) return [];
    const refs = unique.map((id) => this.db!.collection("users").doc(id));
    const snaps = await Promise.all(refs.map((r) => r.get()));
    const rows: UserDiscoveryRow[] = [];
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = (snap.data() ?? {}) as ProfileUserDoc;
      const userId = snap.id;
      rows.push({
        userId,
        handle: String(data.handle ?? "").replace(/^@+/, ""),
        displayName: String(data.name ?? data.displayName ?? "").trim() || null,
        profilePic: resolveProfilePicture(data).url,
        isFollowing: undefined
      });
    }
    // Fill viewer follow relationship for these items (for modal follow buttons).
    try {
      const followRefs = unique.map((id) => this.db!.collection("users").doc(viewerId).collection("following").doc(id));
      const followSnaps = await Promise.all(followRefs.map((r) => r.get()));
      const followingSet = new Set<string>();
      followSnaps.forEach((s, idx) => {
        const followedId = unique[idx];
        if (s.exists && typeof followedId === "string" && followedId.length > 0) {
          followingSet.add(followedId);
        }
      });
      return rows.map((r) => ({ ...r, isFollowing: followingSet.has(r.userId) }));
    } catch {
      return rows;
    }
  }

  async listFollowers(params: {
    viewerId: string;
    userId: string;
    cursor: string | null;
    limit: number;
  }): Promise<{ items: UserDiscoveryRow[]; totalCount: number; nextCursor: string | null; queryCount: number; readCount: number }> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const safeLimit = Math.max(10, Math.min(params.limit, 200));
    const userRef = this.db.collection("users").doc(params.userId);
    let q = userRef.collection("followers").orderBy(FieldPath.documentId(), "asc").limit(safeLimit);
    if (params.cursor) {
      q = q.startAfter(params.cursor);
    }
    const snap = await q.get();
    const ids = snap.docs.map((d) => d.id);
    const rows = ids.length > 0 ? await this.loadUserDiscoveryRows(params.viewerId, ids) : [];
    const tailDoc = snap.docs[snap.docs.length - 1];
    const nextCursor = snap.docs.length === safeLimit && tailDoc ? tailDoc.id : null;
    const needsTotalCount = params.cursor != null || nextCursor != null;
    const totalCount = needsTotalCount ? Number((await userRef.collection("followers").count().get()).data().count ?? 0) : snap.docs.length;
    return {
      items: rows,
      totalCount,
      nextCursor,
      queryCount: 1 + (ids.length > 0 ? 1 : 0) + (needsTotalCount ? 1 : 0),
      readCount: snap.docs.length + ids.length * 2
    };
  }

  async listFollowing(params: {
    viewerId: string;
    userId: string;
    cursor: string | null;
    limit: number;
  }): Promise<{ items: UserDiscoveryRow[]; totalCount: number; nextCursor: string | null; queryCount: number; readCount: number }> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const safeLimit = Math.max(10, Math.min(params.limit, 200));
    const userRef = this.db.collection("users").doc(params.userId);
    let q = userRef.collection("following").orderBy(FieldPath.documentId(), "asc").limit(safeLimit);
    if (params.cursor) {
      q = q.startAfter(params.cursor);
    }
    const snap = await q.get();
    const ids = snap.docs.map((d) => d.id);
    const rows = ids.length > 0 ? await this.loadUserDiscoveryRows(params.viewerId, ids) : [];
    const tailDoc = snap.docs[snap.docs.length - 1];
    const nextCursor = snap.docs.length === safeLimit && tailDoc ? tailDoc.id : null;
    const needsTotalCount = params.cursor != null || nextCursor != null;
    const totalCount = needsTotalCount ? Number((await userRef.collection("following").count().get()).data().count ?? 0) : snap.docs.length;
    return {
      items: rows,
      totalCount,
      nextCursor,
      queryCount: 1 + (ids.length > 0 ? 1 : 0) + (needsTotalCount ? 1 : 0),
      readCount: snap.docs.length + ids.length * 2
    };
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
    const canonicalKey = entityCacheKeys.profileHeaderCanonical(userId);
    const cachedSummary = await globalCache.get<unknown>(canonicalKey);
    if (isCompleteProfileHeaderEntityCache(cachedSummary)) {
      return {
        data: toPublicProfileHeader(cachedSummary),
        queryCount: 0,
        readCount: 0,
      };
    }
    if (cachedSummary !== undefined) {
      void globalCache.del(canonicalKey).catch(() => undefined);
    }
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
    const picture = resolveProfilePicture(data);
    const summary: FirestoreProfileHeader = {
      userId,
      handle: String(data.handle ?? "").replace(/^@+/, ""),
      name: String(data.name ?? data.displayName ?? "").trim(),
      profilePic: picture.url,
      profilePicSmallPath: picture.profilePicSmallPath,
      profilePicLargePath: picture.profilePicLargePath,
      profilePicSource: picture.source,
      bio: typeof data.bio === "string" ? data.bio : undefined,
      updatedAtMs: readMaybeMillis(data.updatedAt),
      profileVersion:
        typeof data.profileVersion === "string" && data.profileVersion.trim().length > 0
          ? data.profileVersion.trim()
          : null,
      counts: {
        posts: postCount.count ?? embeddedPostCount,
        followers: followCounts.followersCount,
        following: followCounts.followingCount
      }
    };
    void globalCache
      .set(canonicalKey, withProfileHeaderCacheMetadata(summary), 30_000)
      .catch(() => undefined);
    return {
      data: summary,
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
  ): Promise<{
    followersCount: number;
    followingCount: number;
    source: string;
    queryCount: number;
    readCount: number;
    exact: boolean;
  }> {
    const embeddedFollowersCount = normalizeEmbeddedCount(userDocData.followersCount ?? userDocData.followerCount);
    const embeddedFollowingCount = normalizeEmbeddedCount(userDocData.followingCount);
    const followersArray = countUniqueGraphArray(userDocData.followers);
    const followingArray = countUniqueGraphArray(userDocData.following);

    // Source-of-truth for counts must match the follower/following subcollections used by modals.
    // Use count aggregation with short TTL; fall back to embedded arrays/counts only if Firestore lacks count().
    try {
      const cached = await getOrSetEntityCache(
        entityCacheKeys.userFollowCounts(_userId),
        20_000,
        async () => {
          if (!this.db) throw new Error("firestore_source_unavailable");
          const userRef = this.db.collection("users").doc(_userId);
          const timeoutMs = ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS;
          const [followersAgg, followingAgg] = await withTimeout(
            Promise.all([userRef.collection("followers").count().get(), userRef.collection("following").count().get()]),
            timeoutMs,
            "profile-firestore-follow-counts"
          );
          return {
            followersCount: Number(followersAgg.data().count ?? 0),
            followingCount: Number(followingAgg.data().count ?? 0)
          };
        }
      );
      return {
        followersCount: Math.max(0, cached.followersCount || 0),
        followingCount: Math.max(0, cached.followingCount || 0),
        source: "subcollection_count_agg",
        queryCount: 2,
        readCount: 0,
        exact: true
      };
    } catch (err) {
      // Cold-start / transient count-aggregation failures can briefly surface stale embedded counts.
      // Retry once with a longer timeout before falling back.
      try {
        if (!this.db) throw err;
        const userRef = this.db.collection("users").doc(_userId);
        const timeoutMs = Math.max(2500, ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS * 3);
        const [followersAgg, followingAgg] = await withTimeout(
          Promise.all([userRef.collection("followers").count().get(), userRef.collection("following").count().get()]),
          timeoutMs,
          "profile-firestore-follow-counts-retry"
        );
        const resolvedFollowers = Math.max(0, Number(followersAgg.data().count ?? 0) || 0);
        const resolvedFollowing = Math.max(0, Number(followingAgg.data().count ?? 0) || 0);
        void globalCache.set(entityCacheKeys.userFollowCounts(_userId), { followersCount: resolvedFollowers, followingCount: resolvedFollowing }, 20_000);
        return {
          followersCount: resolvedFollowers,
          followingCount: resolvedFollowing,
          source: "subcollection_count_agg_retry",
          queryCount: 2,
          readCount: 0,
          exact: true
        };
      } catch {
        // Fall through to embedded/arrays fallback.
      }
      const hasEmbedded = embeddedFollowersCount != null || embeddedFollowingCount != null;
      const hasArrays = followersArray != null || followingArray != null;
      if (hasEmbedded || hasArrays) {
        return {
          followersCount: embeddedFollowersCount ?? followersArray ?? 0,
          followingCount: embeddedFollowingCount ?? followingArray ?? 0,
          source: hasEmbedded && hasArrays ? "embedded_counts_arrays" : hasEmbedded ? "embedded_counts" : "arrays",
          queryCount: 0,
          readCount: 0,
          exact: false
        };
      }
      return {
        followersCount: 0,
        followingCount: 0,
        source: "staged_missing_counts",
        queryCount: 0,
        readCount: 0,
        exact: false
      };
    }
  }

  /**
   * Canonical follower/following totals aligned with `/v2/profiles/:id/followers` and `/following`
   * (`users/{id}/followers` + `users/{id}/following` subcollection count aggregation when available).
   */
  async getProfileSocialCounts(
    userId: string,
    userDocForFallback: {
      followerCount?: unknown;
      followersCount?: unknown;
      followingCount?: unknown;
      followers?: unknown[];
      following?: unknown[];
    }
  ): Promise<{ followerCount: number; followingCount: number; source: string; exact: boolean }> {
    const r = await this.getFollowCounts(userId, userDocForFallback);
    return {
      followerCount: r.followersCount,
      followingCount: r.followingCount,
      source: r.source,
      exact: r.exact,
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
    } catch (err) {
      // Retry once with a longer timeout to avoid surfacing stale embedded counts on cold start.
      try {
        if (!this.db) throw err;
        const snap = await withTimeout(
          this.db.collection("posts").where("userId", "==", userId).count().get(),
          Math.max(2500, ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS * 3),
          "profile-firestore-post-count-retry"
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
        // Fall back to embedded count below.
      }
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

    const isDeletedDoc = (doc: FirebaseFirestore.QueryDocumentSnapshot): boolean => {
      const deleted = doc.get("deleted");
      const isDeleted = doc.get("isDeleted");
      return Boolean(deleted) || Boolean(isDeleted);
    };

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
        "assetsReady",
        "deleted",
        "isDeleted"
      )
      // Small bounded over-fetch allows skipping tombstoned rows without exploding reads for heavy profiles.
      .limit(Math.min(32, safeLimit + 1 + 4));

    if (cursor.mode === "stable_after") {
      const orderValue =
        cursor.orderKind === "timestamp" ? Timestamp.fromMillis(cursor.orderMs) : cursor.orderMs;
      queryRef = queryRef.startAfter(orderValue, cursor.postId);
    }

    const snapshot = await withTimeout(queryRef.get(), ProfileFirestoreAdapter.FIRESTORE_TIMEOUT_MS, timeoutLabel);
    const liveDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const doc of snapshot.docs) {
      if (liveDocs.length >= safeLimit) break;
      if (isDeletedDoc(doc)) continue;
      liveDocs.push(doc);
    }
    const items = liveDocs.map((doc) => mapPostDocToGridPreview(doc));
    // If we had to filter, we may still have more results beyond this page.
    const hasMore = snapshot.docs.length > liveDocs.length;
    const last = liveDocs[liveDocs.length - 1];
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

export function resolveProfilePicture(data: {
  profilePicPath?: string;
  profilePicLargePath?: string;
  profilePicMediumPath?: string;
  profilePicLarge?: string;
  profilePic?: string;
  profilePicture?: string;
  profilePicSmallPath?: string;
  profilePicSmall?: string;
  photo?: string;
  photoURL?: string;
  avatarUrl?: string;
}): { url: string | null; source: string | null; profilePicSmallPath: string | null; profilePicLargePath: string | null } {
  const candidates: Array<[string, unknown]> = [
    ["profilePicLargePath", data.profilePicLargePath],
    ["profilePicMediumPath", data.profilePicMediumPath],
    ["profilePicLarge", data.profilePicLarge],
    ["profilePic", data.profilePic],
    ["profilePicture", data.profilePicture],
    ["profilePicPath", data.profilePicPath],
    ["profilePicSmallPath", data.profilePicSmallPath],
    ["profilePicSmall", data.profilePicSmall],
    ["photoURL", data.photoURL],
    ["photo", data.photo],
    ["avatarUrl", data.avatarUrl],
  ];
  let selectedUrl: string | null = null;
  let selectedSource: string | null = null;
  for (const [source, raw] of candidates) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) continue;
    selectedUrl = trimmed;
    selectedSource = source;
    break;
  }
  const small = typeof data.profilePicSmallPath === "string" && data.profilePicSmallPath.trim()
    ? data.profilePicSmallPath.trim()
    : null;
  const largeRaw = data.profilePicLargePath ?? data.profilePicLarge;
  const large = typeof largeRaw === "string" && largeRaw.trim() ? largeRaw.trim() : null;
  return {
    url: selectedUrl,
    source: selectedSource,
    profilePicSmallPath: small,
    profilePicLargePath: large,
  };
}

function pickPic(data: {
  profilePicPath?: string;
  profilePicLargePath?: string;
  profilePicMediumPath?: string;
  profilePicLarge?: string;
  profilePic?: string;
  profilePicture?: string;
  profilePicSmallPath?: string;
  profilePicSmall?: string;
  photo?: string;
  photoURL?: string;
  avatarUrl?: string;
}): string | null {
  return resolveProfilePicture(data).url;
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
