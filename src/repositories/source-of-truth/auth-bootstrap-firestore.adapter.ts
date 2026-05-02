import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { getFirestoreSourceClient } from "./firestore-client.js";

export type AuthBootstrapUserFields = {
  uid: string;
  email: string | null;
  handle: string;
  name: string | null;
  profilePic: string | null;
  profilePicSmallPath: string | null;
  profilePicMediumPath: string | null;
  profilePicLargePath: string | null;
  badge: string;
  unreadCount: number;
  onboardingComplete: boolean;
};

type AuthBootstrapViewerSummary = {
  handle: string;
  name: string;
  pic: string | null;
};

/**
 * Lightweight user-doc reads for session/bootstrap. Does not replace auth tokens;
 * enriches canonical v2 contracts with denormalized fields when present.
 */
export class AuthBootstrapFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();
  private static readonly FIRESTORE_TIMEOUT_MS = 450;
  private static readonly USER_FIELDS_TTL_MS = 30_000;
  private static readonly USER_FIELDS_MASK = [
    "handle",
    "name",
    "displayName",
    "bio",
    "profilePic",
    "profilePicMediumPath",
    "profilePicPath",
    "profilePicLarge",
    "profilePicSmall",
    "profilePicture",
    "photo",
    "photoURL",
    "badge",
    "profileBadge",
    "viewerBadge",
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
    "stats",
    "unreadCount",
    "unreadNotificationCount",
    "notificationUnreadCount",
    "notifUnread",
    "notificationsReadAllAtMs",
    "notificationsMarkedReadThroughMs",
    "profileComplete",
    "onboardingComplete"
  ] as const;
  private static userFieldsCache = new Map<string, { expiresAtMs: number; data: AuthBootstrapUserFields }>();
  private static viewerSummaryCache = new Map<string, { expiresAtMs: number; data: AuthBootstrapViewerSummary }>();
  private disabledUntilMs = 0;

  static resetCachesForTests(): void {
    AuthBootstrapFirestoreAdapter.userFieldsCache.clear();
    AuthBootstrapFirestoreAdapter.viewerSummaryCache.clear();
  }

  static getCachedViewerSummary(viewerId: string): AuthBootstrapViewerSummary | null {
    const cached = AuthBootstrapFirestoreAdapter.viewerSummaryCache.get(viewerId);
    if (!cached) return null;
    if (Date.now() >= cached.expiresAtMs) {
      AuthBootstrapFirestoreAdapter.viewerSummaryCache.delete(viewerId);
      return null;
    }
    return cached.data;
  }

  isEnabled(): boolean {
    if (!this.db) return false;
    return Date.now() >= this.disabledUntilMs;
  }

  markUnavailableBriefly(): void {
    this.disabledUntilMs = Date.now() + 5_000;
  }

  async getViewerBootstrapFields(viewerId: string): Promise<{
    data: AuthBootstrapUserFields;
    queryCount: number;
    readCount: number;
  }> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    if (viewerId === "anonymous") {
      return {
        data: {
          uid: "anonymous",
          email: null,
          handle: "guest",
          name: "Guest",
          profilePic: null,
          profilePicSmallPath: null,
          profilePicMediumPath: null,
          profilePicLargePath: null,
          badge: "none",
          unreadCount: 0,
          onboardingComplete: true
        },
        queryCount: 0,
        readCount: 0
      };
    }

    const cached = AuthBootstrapFirestoreAdapter.userFieldsCache.get(viewerId);
    if (cached && Date.now() < cached.expiresAtMs) {
      return { data: cached.data, queryCount: 0, readCount: 0 };
    }

    const docs = await withTimeout(
      this.db.getAll(this.db.collection("users").doc(viewerId), {
        fieldMask: [...AuthBootstrapFirestoreAdapter.USER_FIELDS_MASK]
      }),
      AuthBootstrapFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
      "auth-bootstrap-firestore-user"
    );
    const doc = docs[0];
    if (!doc || !doc.exists) {
      throw new Error("auth_bootstrap_user_not_found");
    }

    const data = doc.data() as {
      email?: string;
      handle?: string;
      name?: string;
      displayName?: string;
      profilePic?: string;
      profilePicMediumPath?: string;
      profilePicLargePath?: string;
      profilePicSmallPath?: string;
      profilePicture?: string;
      photo?: string;
      photoURL?: string;
      avatarUrl?: string;
      badge?: string;
      profileBadge?: string;
      viewerBadge?: string;
      unreadCount?: number;
      unreadNotificationCount?: number;
      notificationUnreadCount?: number;
      notifUnread?: number;
      notificationsReadAllAtMs?: number;
      notificationsMarkedReadThroughMs?: number;
      profileComplete?: boolean;
      onboardingComplete?: boolean;
    };

    const handle = String(data.handle ?? "").replace(/^@+/, "").trim();
    const badge = pickString(data.badge ?? data.profileBadge ?? data.viewerBadge, "standard");
    const unreadCount = pickUnread(data);
    const onboardingComplete = !(data.profileComplete === false || data.onboardingComplete === false);
    const email = pickNullableString(data.email);
    const name = pickNullableString(data.name ?? data.displayName);
    const profilePicLargePath = pickNullableString(data.profilePicLargePath);
    const profilePicMediumPath = pickNullableString(data.profilePicMediumPath);
    const profilePicSmallPath = pickNullableString(data.profilePicSmallPath);
    const profilePic = firstNonEmptyString([
      data.profilePic,
      data.profilePicLargePath,
      data.profilePicMediumPath,
      data.profilePicSmallPath,
      data.profilePicture,
      data.photoURL,
      data.photo,
      data.avatarUrl
    ]);

    const payload: AuthBootstrapUserFields = {
      uid: viewerId,
      email,
      handle,
      name,
      profilePic,
      profilePicSmallPath,
      profilePicMediumPath,
      profilePicLargePath,
      badge,
      unreadCount,
      onboardingComplete
    };
    const viewerSummary: AuthBootstrapViewerSummary = {
      handle,
      name: pickString(data.name ?? data.displayName, ""),
      pic: pickNullableString(data.profilePic ?? data.profilePicture ?? data.photo)
    };
    AuthBootstrapFirestoreAdapter.userFieldsCache.set(viewerId, {
      expiresAtMs: Date.now() + AuthBootstrapFirestoreAdapter.USER_FIELDS_TTL_MS,
      data: payload
    });
    AuthBootstrapFirestoreAdapter.viewerSummaryCache.set(viewerId, {
      expiresAtMs: Date.now() + AuthBootstrapFirestoreAdapter.USER_FIELDS_TTL_MS,
      data: viewerSummary
    });
    await Promise.all([
      globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), data as Record<string, unknown>, 300_000),
      globalCache.set(entityCacheKeys.notificationsUnreadCount(viewerId), unreadCount, 25_000),
      globalCache.set(
        entityCacheKeys.userSummary(viewerId),
        {
          userId: viewerId,
          handle: viewerSummary.handle,
          name: viewerSummary.name,
          pic: viewerSummary.pic
        },
        300_000
      )
    ]);
    void this.db
      .collection("users")
      .doc(viewerId)
      .collection("achievements")
      .doc("state")
      .get()
      .then((stateDoc) =>
        globalCache.set(`achievements:${viewerId}:state`, stateDoc.exists ? ((stateDoc.data() as Record<string, unknown>) ?? {}) : null, 25_000)
      )
      .catch(() => undefined);

    return {
      data: payload,
      queryCount: 0,
      readCount: 1
    };
  }
}

function pickString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const t = value.trim();
  return t.length > 0 ? t : fallback;
}

function pickUnread(data: {
  unreadCount?: number;
  unreadNotificationCount?: number;
  notificationUnreadCount?: number;
  notifUnread?: number;
}): number {
  const candidates = [
    data.unreadCount,
    data.unreadNotificationCount,
    data.notificationUnreadCount,
    data.notifUnread
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c >= 0) {
      return Math.min(Math.floor(c), 1_000_000);
    }
  }
  return 0;
}

function pickNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstNonEmptyString(values: unknown[]): string | null {
  for (const value of values) {
    const normalized = pickNullableString(value);
    if (normalized) return normalized;
  }
  return null;
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
