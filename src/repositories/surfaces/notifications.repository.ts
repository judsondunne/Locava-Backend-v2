import { FieldPath, FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import type { NotificationSummary } from "../../contracts/entities/notification-entities.contract.js";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import { incrementDbOps, recordEntityCacheHit, recordFallback, recordSurfaceTimings } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";
import { FeedRepository } from "./feed.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";

type NotificationRecord = NotificationSummary & { viewerId: string };
type CachedNotificationReadState = {
  exists: boolean;
  read: boolean;
  badgeEligible?: boolean;
};

type RawNotificationDoc = {
  type?: unknown;
  senderUserId?: unknown;
  senderUsername?: unknown;
  message?: unknown;
  timestamp?: unknown;
  createdAt?: unknown;
  read?: unknown;
  seen?: unknown;
  priority?: unknown;
  postId?: unknown;
  targetId?: unknown;
  targetUserId?: unknown;
  collectionId?: unknown;
  commentId?: unknown;
  conversationId?: unknown;
  chatId?: unknown;
  senderName?: unknown;
  senderProfilePic?: unknown;
  metadata?: unknown;
};

export class NotificationsRepositoryError extends Error {
  constructor(public readonly code: "invalid_cursor", message: string) {
    super(message);
  }
}

const KNOWN_NOTIFICATION_TYPES = new Set([
  "like",
  "comment",
  "follow",
  "post",
  "mention",
  "invite",
  "group_invite",
  "group_joined",
  "collection_shared",
  "contact_joined",
  "place_follow",
  "audio_like",
  "system",
  "chat",
  "achievement_leaderboard",
  "leaderboard_rank_up",
  "leaderboard_rank_down",
  "leaderboard_passed",
  "post_discovery"
] as const);

const LIKE_AGG_WINDOW_MS = 24 * 60 * 60 * 1000;
const LIKE_AGG_INDIVIDUAL_CAP = 2;
const MAX_IDS_IN_AGG_METADATA = 80;
const notificationFeedService = new FeedService(new FeedRepository());

type LegacySenderData = {
  senderName?: string;
  senderProfilePic?: string | null;
  senderUsername?: string;
};

type LegacyNotificationMutationInput = {
  type:
    | "like"
    | "comment"
    | "follow"
    | "mention"
    | "chat"
    | "invite"
    | "collection_shared"
    | "group_invite"
    | "group_joined"
    | "group_faceoff"
    | "contact_joined"
    | "place_follow"
    | "audio_like"
    | "system"
    | "achievement_leaderboard"
    | "leaderboard_rank_up"
    | "leaderboard_rank_down"
    | "leaderboard_passed"
    | "post"
    | "post_discovery";
  actorId: string;
  targetId: string;
  recipientUserId?: string | null;
  message?: string | null;
  commentId?: string | null;
  metadata?: Record<string, unknown>;
  createdAtMs?: number;
};

function normalizeType(input: unknown): NotificationSummary["type"] {
  const v = String(input ?? "").toLowerCase() as NotificationSummary["type"];
  if (KNOWN_NOTIFICATION_TYPES.has(v)) return v;
  return "post";
}

function sanitizeProfilePic(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  if (/via\.placeholder\.com/i.test(value) || /placeholder/i.test(value)) return null;
  return value;
}

function toMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return Math.floor((value as { toMillis: () => number }).toMillis());
  }
  if (value && typeof value === "object") {
    const row = value as { seconds?: unknown; _seconds?: unknown };
    const sec = typeof row.seconds === "number" ? row.seconds : typeof row._seconds === "number" ? row._seconds : null;
    if (sec != null) return Math.floor(sec * 1000);
  }
  return Date.now();
}

function defaultPreviewText(type: NotificationSummary["type"]): string {
  if (type === "follow") return "started following you";
  if (type === "comment") return "commented on your post";
  if (type === "like") return "liked your post";
  if (type === "mention") return "mentioned you in a post";
  if (type === "chat") return "sent you a message";
  if (type === "invite") return "invited you to collaborate";
  if (type === "collection_shared") return "shared a collection with you";
  return "interacted with your content";
}

function countsTowardNotificationsUnreadCount(type: unknown): boolean {
  return normalizeType(type) !== "chat";
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLikelyPlaceholderIdentity(value: unknown, userId?: string | null): boolean {
  const trimmed = asTrimmedString(value);
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase().replace(/^@+/, "");
  const normalizedUserId = asTrimmedString(userId)?.toLowerCase() ?? "";
  if (lower === "someone" || lower === "unknown" || lower === "unknown user") return true;
  if (normalizedUserId && lower === normalizedUserId) return true;
  if (/^(user|chat_user|sender)_[a-z0-9][a-z0-9._-]{3,}$/i.test(lower)) return true;
  if (/^user_?id[a-z0-9._-]+$/i.test(lower)) return true;
  if (/^[a-z0-9_-]{20,}$/i.test(lower) && !lower.includes(".") && !lower.includes("@") && !lower.includes(" ")) {
    return true;
  }
  return false;
}

function safeFirestoreDocIdSegment(id: string): string {
  return String(id || "unknown")
    .replace(/[/\s]/g, "_")
    .slice(0, 700);
}

function formatTieredCount(n: number): string {
  if (n >= 20) return "20+";
  if (n >= 10) return "10+";
  return String(Math.max(0, n));
}

function formatOthersLikedPhrase(additionalBeyondIndividual: number): string {
  const t = formatTieredCount(additionalBeyondIndividual);
  if (t === "1") return "1 other";
  return `${t} others`;
}

function postTitleForAggMessage(title?: string | null): string {
  return asTrimmedString(title) ?? "your post";
}

function pickUnreadCountFromUserDoc(data: Record<string, unknown> | null | undefined): number | null {
  if (!data) return null;
  for (const key of ["unreadCount", "unreadNotificationCount", "notificationUnreadCount", "notifUnread"]) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  }
  return null;
}

function pickReadAllAtMsFromUserDoc(data: Record<string, unknown> | null | undefined): number | null {
  if (!data) return null;
  for (const key of ["notificationsReadAllAtMs", "notificationsMarkedReadThroughMs"]) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return null;
}

function buildNotificationMetadata(row: RawNotificationDoc): Record<string, unknown> | undefined {
  const base = row.metadata && typeof row.metadata === "object" ? { ...(row.metadata as Record<string, unknown>) } : {};
  const deepLinkFields: Array<[string, unknown]> = [
    ["commentId", row.commentId],
    ["collectionId", row.collectionId],
    ["conversationId", row.conversationId],
    ["chatId", row.chatId],
    ["postId", row.postId],
    ["targetId", row.targetId],
    ["targetUserId", row.targetUserId]
  ];
  for (const [key, value] of deepLinkFields) {
    if (typeof value === "string" && value.trim().length > 0) {
      base[key] = value.trim();
    }
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

type SeededNotificationDoc = RawNotificationDoc & { id: string };

/** Test-only in-memory post author hints when Firestore is disabled (NODE_ENV=test). */
const SEEDED_POST_AUTHOR_FOR_TESTS: Record<string, string> = {
  "internal-viewer-feed-post-1": "internal-viewer"
};

export class NotificationsRepository {
  private readonly seededNotificationsByViewer = new Map<string, SeededNotificationDoc[]>();
  private readonly viewerStateWarmQueued = new Set<string>();

  private notificationReadStateCacheKey(viewerId: string, notificationId: string): string {
    return `notification:${viewerId}:${notificationId}:read-state`;
  }

  private useSeededNotifications(): boolean {
    return process.env.NODE_ENV === "test" && getFirestoreSourceClient() === null;
  }

  private ensureDb(): NonNullable<ReturnType<typeof getFirestoreSourceClient>> {
    const db = getFirestoreSourceClient();
    if (!db) throw new SourceOfTruthRequiredError("notifications_firestore_unavailable");
    return db;
  }

  private ensureSeededViewer(viewerId: string): SeededNotificationDoc[] {
    if (this.seededNotificationsByViewer.has(viewerId)) {
      return this.seededNotificationsByViewer.get(viewerId)!;
    }
    const rows: SeededNotificationDoc[] = Array.from({ length: 25 }, (_, i) => {
      const slot = i + 1;
      const id = `seed_${viewerId.slice(0, 4)}_n_${String(slot).padStart(3, "0")}`;
      const sender = `sender_${(slot % 5) + 1}`;
      const t = slot % 4;
      const type: RawNotificationDoc["type"] = t === 0 ? "follow" : t === 1 ? "like" : t === 2 ? "comment" : "post";
      const createdAtMs = Date.now() - slot * 60_000;
      return {
        id,
        type,
        senderUserId: sender,
        message: defaultPreviewText(normalizeType(type)),
        read: slot > 3,
        timestamp: createdAtMs,
        postId: type === "follow" ? null : `post_seed_${slot}`,
        targetUserId: type === "follow" ? viewerId : null,
        metadata: { postThumbUrl: "https://example.com/thumb.jpg" }
      };
    });
    this.seededNotificationsByViewer.set(viewerId, rows);
    return rows;
  }

  private mapSeededDocsToRecords(allRaw: SeededNotificationDoc[], viewerId: string): NotificationRecord[] {
    return allRaw.map((row) => {
      const actorId = String(row.senderUserId ?? "system");
      const type = normalizeType(row.type);
      const createdAtMs = typeof row.timestamp === "number" ? row.timestamp : toMillis(row.timestamp ?? row.createdAt);
      const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
      const handle = `hdl_${actorId.replace(/[^a-z0-9]+/gi, "").slice(0, 8)}`;
      const name = `User ${actorId.slice(-4)}`;
      const rawTarget = String(row.postId ?? row.targetId ?? row.targetUserId ?? row.collectionId ?? row.id);
      const targetId = type === "follow" ? actorId : rawTarget;
      const metaOut = buildNotificationMetadata(row);
      return {
        notificationId: row.id,
        type,
        actorId,
        actor: { userId: actorId, handle, name, pic: null },
        targetId,
        createdAtMs,
        readState: Boolean(row.read) ? "read" : "unread",
        preview: {
          text: String(row.message ?? metadata.postTitle ?? defaultPreviewText(type)),
          thumbUrl: typeof metadata.postThumbUrl === "string" ? metadata.postThumbUrl : null
        },
        ...(metaOut ? { metadata: metaOut } : {}),
        viewerId
      };
    });
  }

  private listNotificationsSeeded(input: {
    viewerId: string;
    cursor: string | null;
    limit: number;
  }): {
    cursorIn: string | null;
    items: NotificationRecord[];
    hasMore: boolean;
    nextCursor: string | null;
    unreadCount: number | null;
    degraded: boolean;
    fallbacks: string[];
  } {
    recordFallback("notifications_seeded_list");
    const safeLimit = Math.max(1, Math.min(50, input.limit));
    const all = this.ensureSeededViewer(input.viewerId)
      .slice()
      .sort((a, b) => {
        const ta = typeof a.timestamp === "number" ? a.timestamp : toMillis(a.timestamp);
        const tb = typeof b.timestamp === "number" ? b.timestamp : toMillis(b.timestamp);
        if (tb !== ta) return tb - ta;
        return a.id < b.id ? 1 : -1;
      });
    let start = 0;
    if (input.cursor) {
      try {
        const parsed = decodeCursor(input.cursor);
        const idx = all.findIndex((row) => {
          const t = typeof row.timestamp === "number" ? row.timestamp : toMillis(row.timestamp);
          return t < parsed.createdAtMs || (t === parsed.createdAtMs && row.id < parsed.id);
        });
        start = idx < 0 ? all.length : idx;
      } catch {
        throw new NotificationsRepositoryError("invalid_cursor", "Notifications cursor is invalid.");
      }
    }
    const pageRows = all.slice(start, start + safeLimit + 1);
    const hasMore = pageRows.length > safeLimit;
    const slice = pageRows.slice(0, safeLimit);
    incrementDbOps("queries", 1);
    incrementDbOps("reads", slice.length);
    const items = this.mapSeededDocsToRecords(slice, input.viewerId);
    const unreadCount = all.filter((r) => !r.read && countsTowardNotificationsUnreadCount(r.type)).length;
    const tail = items[items.length - 1];
    const nextCursor = hasMore && tail ? encodeCursor({ id: tail.notificationId, createdAtMs: tail.createdAtMs }) : null;
    return { cursorIn: input.cursor, items, hasMore, nextCursor, unreadCount, degraded: false, fallbacks: [] };
  }

  private async loadUsersById(userIds: string[]): Promise<Map<string, DocumentData>> {
    const db = this.ensureDb();
    const unique = [...new Set(userIds.filter((v) => v.length > 0 && v !== "system"))];
    const result = new Map<string, DocumentData>();
    const ttlMs = 25_000;
    const cachedPairs = await Promise.all(
      unique.map(async (id) => ({ id, row: await globalCache.get<DocumentData>(entityCacheKeys.userFirestoreDoc(id)) }))
    );
    const missing: string[] = [];
    for (const { id, row } of cachedPairs) {
      if (row !== undefined) {
        recordEntityCacheHit();
        result.set(id, row);
      } else missing.push(id);
    }
    if (missing.length === 0) return result;

    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 10) chunks.push(missing.slice(i, i + 10));
    incrementDbOps("queries", chunks.length);
    const snaps = await Promise.all(
      chunks.map((chunk) => db.collection("users").where(FieldPath.documentId(), "in", chunk).get())
    );
    for (const snap of snaps) {
      incrementDbOps("reads", snap.docs.length);
      for (const doc of snap.docs) {
        const data = doc.data();
        result.set(doc.id, data);
        void globalCache.set(entityCacheKeys.userFirestoreDoc(doc.id), data, ttlMs);
      }
    }
    return result;
  }

  private async loadCachedUsersById(userIds: string[]): Promise<Map<string, DocumentData>> {
    const unique = [...new Set(userIds.filter((v) => v.length > 0 && v !== "system"))];
    const result = new Map<string, DocumentData>();
    const cachedPairs = await Promise.all(
      unique.map(async (id) => ({ id, row: await globalCache.get<DocumentData>(entityCacheKeys.userFirestoreDoc(id)) }))
    );
    for (const { id, row } of cachedPairs) {
      if (row !== undefined) {
        recordEntityCacheHit();
        result.set(id, row);
      }
    }
    return result;
  }

  private async readCachedUnreadCount(viewerId: string): Promise<number | null> {
    const cached = await globalCache.get<number>(entityCacheKeys.notificationsUnreadCount(viewerId));
    if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) {
      recordEntityCacheHit();
      return Math.floor(cached);
    }
    const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
    const fromUserDoc = pickUnreadCountFromUserDoc(cachedUserDoc);
    if (fromUserDoc != null) {
      recordEntityCacheHit();
      await globalCache.set(entityCacheKeys.notificationsUnreadCount(viewerId), fromUserDoc, 25_000);
      return fromUserDoc;
    }
    return null;
  }

  private async readCachedReadAllAtMs(viewerId: string): Promise<{ value: number; known: boolean }> {
    const cached = await globalCache.get<number>(entityCacheKeys.notificationsReadAllAt(viewerId));
    if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) {
      recordEntityCacheHit();
      return { value: Math.floor(cached), known: true };
    }
    const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
    if (cachedUserDoc !== undefined) {
      recordEntityCacheHit();
      const fromUserDoc = pickReadAllAtMsFromUserDoc(cachedUserDoc) ?? 0;
      await globalCache.set(entityCacheKeys.notificationsReadAllAt(viewerId), fromUserDoc, 25_000);
      return { value: fromUserDoc, known: true };
    }
    return { value: 0, known: false };
  }

  private async writeUnreadCountCaches(viewerId: string, unreadCount: number): Promise<void> {
    const safeUnread = Math.max(0, Math.floor(unreadCount));
    await globalCache.set(entityCacheKeys.notificationsUnreadCount(viewerId), safeUnread, 25_000);
    const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
    if (cachedUserDoc !== undefined) {
      await globalCache.set(
        entityCacheKeys.userFirestoreDoc(viewerId),
        {
          ...cachedUserDoc,
          unreadCount: safeUnread,
          unreadNotificationCount: safeUnread,
          notificationUnreadCount: safeUnread,
          notifUnread: safeUnread
        },
        25_000
      );
    }
  }

  private async cacheNotificationReadStates(
    viewerId: string,
    states: Array<{ notificationId: string; read: boolean; badgeEligible?: boolean }>,
  ): Promise<void> {
    await Promise.all(
      states.map((state) =>
        globalCache.set<CachedNotificationReadState>(
          this.notificationReadStateCacheKey(viewerId, state.notificationId),
          {
            exists: true,
            read: state.read,
            badgeEligible: state.badgeEligible
          },
          25_000
        )
      )
    );
  }

  private queueNotificationReadStateCache(
    viewerId: string,
    states: Array<{ notificationId: string; read: boolean; badgeEligible?: boolean }>,
  ): void {
    void this.cacheNotificationReadStates(viewerId, states).catch(() => undefined);
  }

  private queueUnreadCountCaches(viewerId: string, unreadCount: number): void {
    void this.writeUnreadCountCaches(viewerId, unreadCount).catch(() => undefined);
  }

  private queueUnreadCountFirestore(viewerId: string, unreadCount: number): void {
    void this.writeUnreadCountFirestore(viewerId, unreadCount).catch(() => undefined);
  }

  private queueReadAllAtCaches(viewerId: string, readAllAtMs: number): void {
    void this.writeReadAllAtCaches(viewerId, readAllAtMs).catch(() => undefined);
  }

  private async writeReadAllAtCaches(viewerId: string, readAllAtMs: number): Promise<void> {
    const safeReadAllAt = Math.max(0, Math.floor(readAllAtMs));
    await globalCache.set(entityCacheKeys.notificationsReadAllAt(viewerId), safeReadAllAt, 25_000);
    const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
    if (cachedUserDoc !== undefined) {
      await globalCache.set(
        entityCacheKeys.userFirestoreDoc(viewerId),
        {
          ...cachedUserDoc,
          notificationsReadAllAtMs: safeReadAllAt,
          notificationsMarkedReadThroughMs: safeReadAllAt
        },
        25_000
      );
    }
  }

  private queueViewerStateWarm(viewerId: string): void {
    if (this.viewerStateWarmQueued.has(viewerId)) return;
    this.viewerStateWarmQueued.add(viewerId);
    scheduleBackgroundWork(async () => {
      try {
        const db = this.ensureDb();
        const snap = await db.collection("users").doc(viewerId).get();
        if (!snap.exists) return;
        const data = (snap.data() ?? {}) as Record<string, unknown>;
        const unreadCount = pickUnreadCountFromUserDoc(data);
        const readAllAtMs = pickReadAllAtMsFromUserDoc(data);
        await Promise.all([
          globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), data, 25_000),
          unreadCount == null
            ? Promise.resolve()
            : globalCache.set(entityCacheKeys.notificationsUnreadCount(viewerId), unreadCount, 25_000),
          readAllAtMs == null
            ? Promise.resolve()
            : globalCache.set(entityCacheKeys.notificationsReadAllAt(viewerId), readAllAtMs, 25_000)
        ]);
      } catch {
        return;
      } finally {
        this.viewerStateWarmQueued.delete(viewerId);
      }
    });
  }

  private async writeUnreadCountFirestore(viewerId: string, unreadCount: number): Promise<void> {
    const safeUnread = Math.max(0, Math.floor(unreadCount));
    const db = this.ensureDb();
    await db.collection("users").doc(viewerId).set(
      {
        unreadCount: safeUnread,
        unreadNotificationCount: safeUnread,
        notificationUnreadCount: safeUnread,
        notifUnread: safeUnread
      },
      { merge: true }
    );
    incrementDbOps("writes", 1);
  }

  private async adjustUnreadCountFirestore(viewerId: string, delta: number): Promise<number> {
    const db = this.ensureDb();
    const userRef = db.collection("users").doc(viewerId);
    const nextUnread = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      incrementDbOps("reads", 1);
      const base = pickUnreadCountFromUserDoc((snap.data() ?? null) as Record<string, unknown> | null) ?? 0;
      const next = Math.max(0, base + delta);
      tx.set(
        userRef,
        {
          unreadCount: next,
          unreadNotificationCount: next,
          notificationUnreadCount: next,
          notifUnread: next
        },
        { merge: true }
      );
      return next;
    });
    incrementDbOps("queries", 1);
    incrementDbOps("writes", 1);
    await this.writeUnreadCountCaches(viewerId, nextUnread);
    return nextUnread;
  }

  private extractSenderData(userId: string, userDoc: Record<string, unknown> | null | undefined): LegacySenderData {
    if (userId === "system") {
      return {
        senderName: "Locava",
        senderProfilePic: "https://via.placeholder.com/150?text=Locava",
        senderUsername: "locava",
      };
    }
    const handle =
      asTrimmedString(userDoc?.handle) ??
      asTrimmedString(userDoc?.username) ??
      `user_${userId.slice(0, 8)}`;
    return {
      senderName:
        asTrimmedString(userDoc?.name) ??
        asTrimmedString(userDoc?.displayName) ??
        handle,
      senderProfilePic:
        asTrimmedString(userDoc?.profilePic) ??
        asTrimmedString(userDoc?.profilePicture) ??
        asTrimmedString(userDoc?.photoURL) ??
        asTrimmedString(userDoc?.photo) ??
        null,
      senderUsername: handle.replace(/^@+/, ""),
    };
  }

  private async resolveSenderData(userId: string): Promise<LegacySenderData> {
    if (this.useSeededNotifications()) {
      return {
        senderName: `User ${userId.slice(-4)}`,
        senderProfilePic: null,
        senderUsername: `hdl_${userId.slice(0, 8)}`,
      };
    }
    const users = await this.loadUsersById([userId]);
    return this.extractSenderData(userId, (users.get(userId) as Record<string, unknown> | undefined) ?? null);
  }

  private async resolvePostContext(postId: string): Promise<{
    recipientUserId: string | null;
    postTitle: string | null;
    postThumbUrl: string | null;
  }> {
    if (this.useSeededNotifications()) {
      return {
        recipientUserId: SEEDED_POST_AUTHOR_FOR_TESTS[postId] ?? null,
        postTitle: "your post",
        postThumbUrl: "https://example.com/thumb.jpg",
      };
    }
    const db = this.ensureDb();
    const postDoc = await db.collection("posts").doc(postId).get();
    incrementDbOps("queries", 1);
    incrementDbOps("reads", postDoc.exists ? 1 : 0);
    const postData = (postDoc.data() ?? {}) as Record<string, unknown>;
    const recipientUserId =
      asTrimmedString(postData.userId) ??
      asTrimmedString(postData.authorId) ??
      asTrimmedString(postData.ownerId);
    const postTitle =
      asTrimmedString(postData.title) ??
      asTrimmedString(postData.postTitle) ??
      asTrimmedString(postData.caption) ??
      asTrimmedString(postData.name);
    const postThumbUrl =
      asTrimmedString(postData.displayPhotoLink) ??
      asTrimmedString(postData.photoLink) ??
      asTrimmedString(postData.image);
    return { recipientUserId, postTitle, postThumbUrl };
  }

  private async createLegacyNotificationDoc(input: {
    recipientUserId: string;
    notificationData: Record<string, unknown>;
    unreadDelta?: number;
  }): Promise<{ notificationId: string }> {
    const unreadDelta =
      countsTowardNotificationsUnreadCount(input.notificationData.type) ? (input.unreadDelta ?? 1) : 0;
    if (this.useSeededNotifications()) {
      const rows = this.ensureSeededViewer(input.recipientUserId);
      const notificationId = `seed_${Date.now()}_${rows.length + 1}`;
      rows.unshift({
        id: notificationId,
        ...(input.notificationData as RawNotificationDoc),
        timestamp: Date.now(),
      });
      incrementDbOps("writes", 1);
      const priorUnread = (await this.readCachedUnreadCount(input.recipientUserId)) ?? 0;
      await this.writeUnreadCountCaches(input.recipientUserId, priorUnread + unreadDelta);
      return { notificationId };
    }
    const db = this.ensureDb();
    const ref = db.collection("users").doc(input.recipientUserId).collection("notifications").doc();
    await Promise.all([
      ref.set(input.notificationData),
      unreadDelta !== 0 ? this.adjustUnreadCountFirestore(input.recipientUserId, unreadDelta) : Promise.resolve(0),
    ]);
    incrementDbOps("writes", 1);
    return { notificationId: ref.id };
  }

  private async createGenericLegacyNotification(input: LegacyNotificationMutationInput & { recipientUserId: string }): Promise<{
    created: boolean;
    notificationId: string | null;
    viewerId: string | null;
    notificationData: Record<string, unknown> | null;
    senderData: LegacySenderData | null;
  }> {
    if (!input.recipientUserId || input.recipientUserId === input.actorId) {
      return { created: false, notificationId: null, viewerId: null, notificationData: null, senderData: null };
    }

    const senderData = await this.resolveSenderData(input.actorId);
    const metadata = { ...(input.metadata ?? {}) };
    const nowField = this.useSeededNotifications() ? input.createdAtMs ?? Date.now() : FieldValue.serverTimestamp();
    const notificationData: Record<string, unknown> = {
      senderUserId: input.actorId,
      ...senderData,
      type: input.type,
      message: input.message ?? defaultPreviewText(normalizeType(input.type)),
      timestamp: nowField,
      priority: "medium",
    };

    if (input.type === "follow") {
      notificationData.message = "followed you.";
      notificationData.read = false;
      notificationData.priority = "low";
    } else if (input.type === "comment") {
      notificationData.postId = input.targetId;
      if (input.commentId) notificationData.commentId = input.commentId;
      notificationData.message = "commented on your post.";
      notificationData.read = false;
      notificationData.priority = "medium";
    } else if (input.type === "mention") {
      notificationData.postId = input.targetId;
      if (input.commentId) notificationData.commentId = input.commentId;
      notificationData.message = input.message ?? "mentioned you in a post.";
      notificationData.read = false;
      notificationData.priority = "medium";
    } else if (input.type === "chat") {
      notificationData.chatId = input.targetId;
      notificationData.message = input.message ?? "New message";
      notificationData.seen = false;
      notificationData.priority = "medium";
    } else if (input.type === "invite" || input.type === "collection_shared") {
      notificationData.collectionId = input.targetId;
      notificationData.read = false;
      notificationData.priority = "medium";
    } else if (input.type === "group_invite" || input.type === "group_joined" || input.type === "group_faceoff") {
      notificationData.read = false;
      notificationData.priority = input.type === "group_faceoff" ? "high" : "medium";
    } else if (input.type === "place_follow") {
      notificationData.placeId = input.targetId;
      notificationData.read = false;
      notificationData.priority = "low";
    } else if (input.type === "audio_like") {
      notificationData.audioId = input.targetId;
      notificationData.read = false;
      notificationData.priority = "low";
    } else if (input.type === "contact_joined") {
      notificationData.message = "just joined Locava. Tap to view their profile.";
      notificationData.read = false;
      notificationData.priority = "medium";
      metadata.route = "/userDisplay/userDisplay";
    } else if (input.type === "system") {
      notificationData.senderUserId = "system";
      notificationData.senderName = "Locava";
      notificationData.senderProfilePic = "https://via.placeholder.com/150?text=Locava";
      notificationData.senderUsername = "locava";
      notificationData.read = false;
      notificationData.priority = typeof metadata.priority === "string" ? metadata.priority : "medium";
    } else if (input.type === "post") {
      notificationData.postId = input.targetId;
      notificationData.read = false;
      notificationData.priority = "low";
    } else {
      notificationData.postId = input.targetId;
      notificationData.read = false;
      notificationData.priority = input.type === "like" ? "high" : "medium";
    }

    if (Object.keys(metadata).length > 0) {
      notificationData.metadata = metadata;
    }
    const { notificationId } = await this.createLegacyNotificationDoc({
      recipientUserId: input.recipientUserId,
      notificationData,
    });
    return {
      created: true,
      notificationId,
      viewerId: input.recipientUserId,
      notificationData,
      senderData,
    };
  }

  private async createLegacyLikeNotification(input: LegacyNotificationMutationInput & {
    recipientUserId: string;
    postTitle?: string | null;
  }): Promise<{
    created: boolean;
    notificationId: string | null;
    viewerId: string | null;
    notificationData: Record<string, unknown> | null;
    senderData: LegacySenderData | null;
  }> {
    if (!input.recipientUserId || input.recipientUserId === input.actorId) {
      return { created: false, notificationId: null, viewerId: null, notificationData: null, senderData: null };
    }
    const senderData = await this.resolveSenderData(input.actorId);
    const postTitle = postTitleForAggMessage(input.postTitle);
    if (this.useSeededNotifications()) {
      const notificationData = {
        senderUserId: input.actorId,
        ...senderData,
        type: "like",
        postId: input.targetId,
        message: "liked your post.",
        timestamp: input.createdAtMs ?? Date.now(),
        read: false,
        priority: "high",
        metadata: { postTitle },
      };
      const { notificationId } = await this.createLegacyNotificationDoc({
        recipientUserId: input.recipientUserId,
        notificationData,
      });
      return {
        created: true,
        notificationId,
        viewerId: input.recipientUserId,
        notificationData,
        senderData,
      };
    }

    const db = this.ensureDb();
    const stateKey = `like_${safeFirestoreDocIdSegment(input.targetId)}`;
    const stateRef = db.collection("users").doc(input.recipientUserId).collection("notificationAggState").doc(stateKey);
    const notifCol = db.collection("users").doc(input.recipientUserId).collection("notifications");
    type Outcome = "individual" | "summary_create" | "summary_update" | "duplicate";
    const outcome: { value: Outcome } = { value: "individual" };
    let resultNotificationId: string | null = null;
    let pushNotificationData: Record<string, unknown> | null = null;

    await db.runTransaction(async (tx) => {
      const stateSnap = await tx.get(stateRef);
      const now = Date.now();
      let windowStartMs = now;
      let orderedLikerIds: string[] = [];
      let summaryNotificationId: string | null = null;

      if (stateSnap.exists) {
        const d = (stateSnap.data() ?? {}) as Record<string, unknown>;
        windowStartMs = typeof d.windowStartMs === "number" ? d.windowStartMs : now;
        orderedLikerIds = Array.isArray(d.orderedLikerIds) ? d.orderedLikerIds.filter((v): v is string => typeof v === "string") : [];
        summaryNotificationId = asTrimmedString(d.summaryNotificationId);
      }
      if (now - windowStartMs > LIKE_AGG_WINDOW_MS) {
        windowStartMs = now;
        orderedLikerIds = [];
        summaryNotificationId = null;
      }
      if (orderedLikerIds.includes(input.actorId)) {
        outcome.value = "duplicate";
        return;
      }
      orderedLikerIds.push(input.actorId);

      if (orderedLikerIds.length <= LIKE_AGG_INDIVIDUAL_CAP) {
        const newRef = notifCol.doc();
        const notificationData = {
          senderUserId: input.actorId,
          ...senderData,
          type: "like",
          postId: input.targetId,
          message: "liked your post.",
          timestamp: FieldValue.serverTimestamp(),
          read: false,
          priority: "high",
          metadata: { postTitle },
        };
        tx.set(newRef, notificationData);
        tx.set(
          stateRef,
          {
            windowStartMs,
            orderedLikerIds,
            summaryNotificationId,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        resultNotificationId = newRef.id;
        pushNotificationData = notificationData;
        outcome.value = "individual";
        return;
      }

      const additional = orderedLikerIds.length - LIKE_AGG_INDIVIDUAL_CAP;
      const othersPhrase = formatOthersLikedPhrase(additional);
      const bodyMessage =
        postTitle === "your post"
          ? `${othersPhrase} liked your post.`
          : `${othersPhrase} liked your post, ${postTitle}.`;
      const metadata = {
        postTitle,
        aggregated: true,
        aggregationKind: "like_post",
        orderedLikerIds: orderedLikerIds.slice(0, MAX_IDS_IN_AGG_METADATA),
        additionalLikerCount: additional,
        totalUniqueLikers: orderedLikerIds.length,
        individualCap: LIKE_AGG_INDIVIDUAL_CAP,
      };

      if (!summaryNotificationId) {
        const sumRef = notifCol.doc();
        const notificationData = {
          senderUserId: input.actorId,
          ...senderData,
          type: "like",
          postId: input.targetId,
          message: bodyMessage,
          timestamp: FieldValue.serverTimestamp(),
          read: false,
          priority: "high",
          metadata,
          pushTitle: senderData.senderName ?? "Someone",
          pushBody: `${othersPhrase} liked your post`,
          skipStoredPushTemplate: true,
        };
        tx.set(sumRef, notificationData);
        summaryNotificationId = sumRef.id;
        resultNotificationId = sumRef.id;
        pushNotificationData = notificationData;
        outcome.value = "summary_create";
      } else {
        const sumRef = notifCol.doc(summaryNotificationId);
        tx.update(sumRef, {
          senderUserId: input.actorId,
          senderName: senderData.senderName,
          senderProfilePic: senderData.senderProfilePic,
          senderUsername: senderData.senderUsername,
          message: bodyMessage,
          metadata,
          timestamp: FieldValue.serverTimestamp(),
          postId: input.targetId,
        });
        resultNotificationId = summaryNotificationId;
        outcome.value = "summary_update";
      }

      tx.set(
        stateRef,
        {
          windowStartMs,
          orderedLikerIds,
          summaryNotificationId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    if (outcome.value === "duplicate" || !resultNotificationId) {
      return { created: false, notificationId: null, viewerId: null, notificationData: null, senderData };
    }

    await this.adjustUnreadCountFirestore(input.recipientUserId, 1);
    return {
      created: true,
      notificationId: resultNotificationId,
      viewerId: input.recipientUserId,
      notificationData: pushNotificationData,
      senderData,
    };
  }

  async listNotifications(input: {
    viewerId: string;
    cursor: string | null;
    limit: number;
  }): Promise<{
    cursorIn: string | null;
    items: NotificationRecord[];
    hasMore: boolean;
    nextCursor: string | null;
    unreadCount: number | null;
    degraded: boolean;
    fallbacks: string[];
  }> {
    if (this.useSeededNotifications()) {
      return this.listNotificationsSeeded(input);
    }
    const db = this.ensureDb();
    const safeLimit = Math.max(1, Math.min(50, input.limit));
    let parsedCursor: { id: string; createdAtMs: number } | null = null;
    if (input.cursor) {
      try {
        parsedCursor = decodeCursor(input.cursor);
      } catch {
        throw new NotificationsRepositoryError("invalid_cursor", "Notifications cursor is invalid.");
      }
    }

    const coll = db.collection("users").doc(input.viewerId).collection("notifications");
    let pageQuery = coll
      .orderBy("timestamp", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .select(
        "type",
        "senderUserId",
        "message",
        "timestamp",
        "createdAt",
        "read",
        "postId",
        "targetId",
        "targetUserId",
        "collectionId",
        "commentId",
        "conversationId",
        "chatId",
        "senderName",
        "senderProfilePic",
        "senderUsername",
        "seen",
        "priority",
        "metadata"
      )
      .limit(safeLimit + 1);
    if (parsedCursor) {
      pageQuery = pageQuery.startAfter(parsedCursor.createdAtMs, parsedCursor.id);
    }
    const [cachedUnreadCount, cachedReadAll] = await Promise.all([
      this.readCachedUnreadCount(input.viewerId),
      this.readCachedReadAllAtMs(input.viewerId)
    ]);

    incrementDbOps("queries", 1);
    const tParallel0 = performance.now();
    const snapshot = await pageQuery.get();
    const tParallel1 = performance.now();
    incrementDbOps("reads", snapshot.docs.length);
    const fallbacks: string[] = [];
    if (cachedUnreadCount == null || !cachedReadAll.known) {
      this.queueViewerStateWarm(input.viewerId);
    }
    if (cachedUnreadCount == null) {
      fallbacks.push("notifications_unread_count_staged");
    }
    if (!cachedReadAll.known) {
      fallbacks.push("notifications_read_all_staged");
    }
    const unreadCount = cachedUnreadCount;
    const readAllAtMs = cachedReadAll.value;

    const pageDocs = snapshot.docs.slice(0, safeLimit);
    const hasMore = snapshot.docs.length > safeLimit;
    const allRaw = pageDocs.map((doc) => ({ id: doc.id, ...(doc.data() as RawNotificationDoc) }));
    const tUserHydr0 = performance.now();
    const actorIdsNeedingHydration = [
      ...new Set(
        allRaw
          .map((row) => (typeof row.senderUserId === "string" ? row.senderUserId.trim() : ""))
          .filter((actorId) => {
            if (!actorId || actorId === "system") return false;
            return allRaw.some(
              (row) =>
                row.senderUserId === actorId &&
                isLikelyPlaceholderIdentity(row.senderName, actorId)
            );
          })
      )
    ];
    const hydratedUsersById =
      actorIdsNeedingHydration.length > 0 ? await this.loadUsersById(actorIdsNeedingHydration) : new Map<string, DocumentData>();
    const tUserHydr1 = performance.now();
    const notificationPostIds = [...new Set(
      allRaw
        .map((row) => (typeof row.postId === "string" ? row.postId.trim() : ""))
        .filter(Boolean)
    )];
    const notificationPostCards =
      notificationPostIds.length > 0
        ? await notificationFeedService.loadPostCardSummaryBatch(input.viewerId, notificationPostIds).catch(() => [])
        : [];
    const notificationPostById = new Map(notificationPostCards.map((row) => [row.postId, row] as const));
    const tMap0 = performance.now();
    const items: NotificationRecord[] = allRaw.map((row) => {
      const actorId = String(row.senderUserId ?? "system");
      const type = normalizeType(row.type);
      const createdAtMs = toMillis(row.timestamp ?? row.createdAt);
      const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
      const hydratedSender = this.extractSenderData(
        actorId,
        (hydratedUsersById.get(actorId) as Record<string, unknown> | undefined) ?? null
      );
      const storedHandle = asTrimmedString(row.senderUsername)?.replace(/^@+/, "") ?? null;
      const handle =
        actorId === "system"
          ? "locava"
          : isLikelyPlaceholderIdentity(storedHandle, actorId)
            ? hydratedSender.senderUsername ?? `user_${actorId.slice(0, 8)}`
            : storedHandle ?? hydratedSender.senderUsername ?? `user_${actorId.slice(0, 8)}`;
      const storedName = asTrimmedString(row.senderName);
      const name =
        actorId === "system"
          ? "Locava"
          : isLikelyPlaceholderIdentity(storedName, actorId)
            ? hydratedSender.senderName ?? handle
            : storedName ?? hydratedSender.senderName ?? handle;
      const pic = sanitizeProfilePic(row.senderProfilePic) ?? sanitizeProfilePic(hydratedSender.senderProfilePic);
      const rawTarget = String(row.postId ?? row.targetId ?? row.targetUserId ?? row.collectionId ?? row.id);
      const postId = typeof row.postId === "string" ? row.postId.trim() : "";
      const targetId = type === "follow" ? actorId : rawTarget;
      const readState: "read" | "unread" =
        Boolean(row.read) || (readAllAtMs > 0 && createdAtMs <= readAllAtMs) ? "read" : "unread";
      const metaOut = buildNotificationMetadata(row);
      return {
        notificationId: row.id,
        type,
        actorId,
        actor: {
          userId: actorId,
          handle,
          name,
          pic
        },
        targetId,
        createdAtMs,
        readState,
        preview: {
          text: String(row.message ?? metadata.postTitle ?? defaultPreviewText(type)),
          thumbUrl: typeof metadata.postThumbUrl === "string" ? metadata.postThumbUrl : null
        },
        ...(postId && notificationPostById.has(postId) ? { post: notificationPostById.get(postId) } : {}),
        ...(metaOut ? { metadata: metaOut } : {}),
        viewerId: input.viewerId
      };
    });
    const tMap1 = performance.now();
    recordSurfaceTimings({
      notifications_firestore_parallel_ms: tParallel1 - tParallel0,
      notifications_user_batch_ms: tUserHydr1 - tUserHydr0,
      notifications_map_ms: tMap1 - tMap0
    });

    const tail = items[items.length - 1];
    const nextCursor = hasMore && tail ? encodeCursor({ id: tail.notificationId, createdAtMs: tail.createdAtMs }) : null;
    await this.cacheNotificationReadStates(
      input.viewerId,
      items.map((item) => ({
        notificationId: item.notificationId,
        read: item.readState === "read",
        badgeEligible: countsTowardNotificationsUnreadCount(item.type)
      }))
    );
    return {
      cursorIn: input.cursor,
      items,
      hasMore,
      nextCursor,
      unreadCount,
      degraded: fallbacks.length > 0,
      fallbacks
    };
  }

  async markRead(input: { viewerId: string; notificationIds: readonly string[] }): Promise<{
    requestedCount: number;
    markedCount: number;
    unreadCount: number;
    idempotent: boolean;
  }> {
    const requested = [...new Set(input.notificationIds.filter((id) => typeof id === "string" && id.length > 0))];
    if (requested.length === 0) {
      return { requestedCount: 0, markedCount: 0, unreadCount: 0, idempotent: true };
    }
    if (this.useSeededNotifications()) {
      recordFallback("notifications_seeded_mark_read");
      const rows = this.ensureSeededViewer(input.viewerId);
      let markedCount = 0;
      for (const id of requested) {
        const row = rows.find((r) => r.id === id);
        if (row && !row.read) {
          row.read = true;
          markedCount += 1;
          incrementDbOps("writes", 1);
        }
      }
      const unreadCount = rows.filter((r) => !r.read && countsTowardNotificationsUnreadCount(r.type)).length;
      return {
        requestedCount: requested.length,
        markedCount,
        unreadCount,
        idempotent: markedCount === 0
      };
    }
    const db = this.ensureDb();
    const coll = db.collection("users").doc(input.viewerId).collection("notifications");
    const [cachedUnreadCount, cachedReadStates] = await Promise.all([
      this.readCachedUnreadCount(input.viewerId),
      Promise.all(
        requested.map((id) =>
          globalCache.get<CachedNotificationReadState>(this.notificationReadStateCacheKey(input.viewerId, id))
        )
      )
    ]);
    const docsById = new Map<string, CachedNotificationReadState>();
    const unresolvedIds: string[] = [];
    requested.forEach((id, index) => {
      const cached = cachedReadStates[index];
      if (
        cached &&
        typeof cached.exists === "boolean" &&
        typeof cached.read === "boolean" &&
        typeof cached.badgeEligible === "boolean"
      ) {
        docsById.set(id, cached);
      } else {
        unresolvedIds.push(id);
      }
    });
    if (unresolvedIds.length > 0) {
      incrementDbOps("queries", 1);
      const unresolvedRefs = unresolvedIds.map((id) => coll.doc(id));
      const snaps = await db.getAll(...unresolvedRefs);
      incrementDbOps("reads", snaps.filter((s) => s.exists).length);
      await Promise.all(
        snaps.map((snap, index) => {
          const notificationId = unresolvedIds[index];
          if (!notificationId) return Promise.resolve();
          const state: CachedNotificationReadState = {
            exists: snap.exists,
            read: snap.exists ? Boolean((snap.data() as RawNotificationDoc).read) : false,
            badgeEligible: snap.exists
              ? countsTowardNotificationsUnreadCount((snap.data() as RawNotificationDoc).type)
              : false
          };
          docsById.set(notificationId, state);
          return globalCache.set(this.notificationReadStateCacheKey(input.viewerId, notificationId), state, 25_000);
        })
      );
    }

    let markedCount = 0;
    let badgeMarkedCount = 0;
    const batch = db.batch();
    const markedIds: string[] = [];
    for (const id of requested) {
      const doc = docsById.get(id);
      if (!doc?.exists || doc.read) continue;
      batch.update(coll.doc(id), { read: true, readAt: Timestamp.now() });
      markedCount += 1;
      if (doc.badgeEligible) badgeMarkedCount += 1;
      markedIds.push(id);
    }
    let unreadCount = cachedUnreadCount ?? 0;
    if (markedCount > 0) {
      await batch.commit();
      incrementDbOps("writes", markedCount);
      const readStates = markedIds.map((notificationId) => ({
        notificationId,
        read: true,
        badgeEligible: docsById.get(notificationId)?.badgeEligible,
      }));
      if (process.env.VITEST === "true") {
        await this.cacheNotificationReadStates(input.viewerId, readStates);
      } else {
        this.queueNotificationReadStateCache(input.viewerId, readStates);
      }
      if (cachedUnreadCount != null) {
        unreadCount = Math.max(0, cachedUnreadCount - badgeMarkedCount);
        if (process.env.VITEST === "true") {
          await Promise.all([this.writeUnreadCountCaches(input.viewerId, unreadCount), this.writeUnreadCountFirestore(input.viewerId, unreadCount)]);
        } else {
          this.queueUnreadCountCaches(input.viewerId, unreadCount);
          this.queueUnreadCountFirestore(input.viewerId, unreadCount);
        }
      } else {
        unreadCount = await this.adjustUnreadCountFirestore(input.viewerId, -badgeMarkedCount);
      }
    } else {
      unreadCount = Math.max(0, unreadCount);
    }
    return {
      requestedCount: requested.length,
      markedCount,
      unreadCount,
      idempotent: markedCount === 0
    };
  }

  async markAllRead(input: { viewerId: string }): Promise<{ markedCount: number; unreadCount: number; idempotent: boolean }> {
    if (this.useSeededNotifications()) {
      recordFallback("notifications_seeded_mark_all_read");
      const rows = this.ensureSeededViewer(input.viewerId);
      let markedCount = 0;
      for (const row of rows) {
        if (!row.read) {
          row.read = true;
          markedCount += 1;
        }
      }
      incrementDbOps("writes", markedCount);
      return { markedCount, unreadCount: 0, idempotent: markedCount === 0 };
    }
    const db = this.ensureDb();
    const cachedUnread = await this.readCachedUnreadCount(input.viewerId);
    const userRef = db.collection("users").doc(input.viewerId);
    let totalMarked = cachedUnread ?? 0;
    if (cachedUnread == null) {
      incrementDbOps("queries", 1);
      const unreadAgg = await userRef.collection("notifications").where("read", "==", false).count().get();
      totalMarked = Math.max(0, Math.floor(Number(unreadAgg.data().count ?? 0)));
    }
    if (totalMarked === 0) {
      await this.writeUnreadCountCaches(input.viewerId, 0);
      await this.writeReadAllAtCaches(input.viewerId, 0);
      return { markedCount: 0, unreadCount: 0, idempotent: true };
    }
    const markedReadThroughMs = Date.now();
    await db.collection("users").doc(input.viewerId).set(
      {
        unreadCount: 0,
        unreadNotificationCount: 0,
        notificationUnreadCount: 0,
        notifUnread: 0,
        notificationsReadAllAtMs: markedReadThroughMs,
        notificationsMarkedReadThroughMs: markedReadThroughMs
      },
      { merge: true }
    );
    incrementDbOps("writes", 1);
    if (process.env.VITEST === "true") {
      await Promise.all([
        this.writeUnreadCountCaches(input.viewerId, 0),
        this.writeReadAllAtCaches(input.viewerId, markedReadThroughMs)
      ]);
    } else {
      this.queueUnreadCountCaches(input.viewerId, 0);
      this.queueReadAllAtCaches(input.viewerId, markedReadThroughMs);
    }
    return { markedCount: totalMarked, unreadCount: 0, idempotent: false };
  }

  async createFromMutation(input: LegacyNotificationMutationInput): Promise<{
    created: boolean;
    notificationId: string | null;
    viewerId: string | null;
    notificationData?: Record<string, unknown> | null;
    senderData?: LegacySenderData | null;
  }> {
    let recipientUserId = asTrimmedString(input.recipientUserId);
    let postContext:
      | {
          recipientUserId: string | null;
          postTitle: string | null;
          postThumbUrl: string | null;
        }
      | null = null;

    if (!recipientUserId && (input.type === "like" || input.type === "comment" || input.type === "mention" || input.type === "post")) {
      postContext = await this.resolvePostContext(input.targetId);
      recipientUserId = postContext.recipientUserId;
    }
    if (!recipientUserId && input.type === "follow") {
      recipientUserId = input.targetId;
    }
    if (!recipientUserId) {
      return { created: false, notificationId: null, viewerId: null, notificationData: null, senderData: null };
    }

    const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
    if (input.commentId) metadata.commentId = input.commentId;
    if (postContext?.postTitle && !asTrimmedString(metadata.postTitle)) {
      metadata.postTitle = postContext.postTitle;
    }
    if (postContext?.postThumbUrl && !asTrimmedString(metadata.postThumbUrl)) {
      metadata.postThumbUrl = postContext.postThumbUrl;
    }

    if (input.type === "like") {
      return this.createLegacyLikeNotification({
        ...input,
        recipientUserId,
        metadata,
        postTitle: asTrimmedString(metadata.postTitle),
      });
    }

    if (input.type === "comment") {
      metadata.commentText = asTrimmedString(metadata.commentText) ?? asTrimmedString(input.message) ?? undefined;
      return this.createGenericLegacyNotification({
        ...input,
        recipientUserId,
        metadata,
      });
    }

    if (input.type === "mention") {
      return this.createGenericLegacyNotification({
        ...input,
        recipientUserId,
        metadata,
      });
    }

    if (input.type === "chat") {
      return this.createGenericLegacyNotification({
        ...input,
        recipientUserId,
        metadata,
      });
    }

    if (input.type === "follow") {
      return this.createGenericLegacyNotification({
        ...input,
        recipientUserId,
        metadata,
      });
    }

    return this.createGenericLegacyNotification({
      ...input,
      recipientUserId,
      metadata,
    });
  }

  resetForTests(): void {
    this.seededNotificationsByViewer.clear();
  }
}

export const notificationsRepository = new NotificationsRepository();
