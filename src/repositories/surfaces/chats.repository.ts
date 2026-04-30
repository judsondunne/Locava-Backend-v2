import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import type { ConversationSummary } from "../../contracts/entities/chat-entities.contract.js";
import type { MessageSummary } from "../../contracts/entities/chat-message-entities.contract.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination.js";
import { incrementDbOps, recordEntityCacheHit, recordFallback, recordSurfaceTimings } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

type ConversationRecord = ConversationSummary & { viewerId: string };
type MessageRecord = Omit<MessageSummary, "ownedByViewer" | "seenByViewer"> & {
  seenBy: string[];
  reactions?: Record<string, string>;
};
type UserSummary = { userId: string; handle: string; name: string | null; pic: string | null };
type SendTextMessageInput = {
  viewerId: string;
  conversationId: string;
  messageType: "text" | "photo" | "gif" | "post";
  text: string | null;
  photoUrl: string | null;
  gifUrl: string | null;
  gif: null | {
    provider: "giphy";
    gifId: string;
    title?: string;
    previewUrl: string;
    fixedHeightUrl?: string;
    mp4Url?: string;
    width?: number;
    height?: number;
    originalUrl?: string;
  };
  postId: string | null;
  replyingToMessageId: string | null;
  clientMessageId: string | null;
};

export class ChatsRepositoryError extends Error {
  constructor(
    public readonly code: "invalid_cursor" | "conversation_not_found" | "not_group_chat",
    message: string
  ) {
    super(message);
  }
}

function seeded(seed: string): number {
  let n = 0;
  for (let i = 0; i < seed.length; i += 1) n = (n + seed.charCodeAt(i) * (i + 17)) % 1_000_003;
  return n;
}

function fallbackAuthor(userId: string): UserSummary {
  const s = seeded(userId);
  return { userId, handle: `user_${s % 1000}`, name: `User ${s % 500}`, pic: null };
}

function toMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function normalizeMessageType(raw: unknown): MessageSummary["messageType"] {
  switch (String(raw ?? "").toLowerCase()) {
    case "photo":
      return "photo";
    case "gif":
      return "gif";
    case "post":
      return "post";
    case "place":
      return "place";
    case "collection":
      return "collection";
    case "message":
      return "message";
    default:
      return "text";
  }
}

function normalizeConversationType(raw: unknown): ConversationSummary["lastMessageType"] {
  const n = normalizeMessageType(raw);
  return n === "text" ? "message" : n;
}

function toPreviewText(messageType: MessageSummary["messageType"], data: Record<string, unknown>): string | null {
  if (messageType === "photo") return "Sent a photo";
  if (messageType === "gif") return "Sent a GIF";
  if (messageType === "post") return "Shared a post";
  const text = typeof data.content === "string" ? data.content : typeof data.text === "string" ? data.text : null;
  return text ? text.slice(0, 140) : null;
}

function shouldAllowSeededFallback(viewerId: string): boolean {
  if (viewerId === "anonymous") return true;
  if (process.env.NODE_ENV === "test") return true;
  return false;
}

function directPairKeyFor(viewerId: string, otherUserId: string): string {
  return [viewerId, otherUserId].sort().join(":");
}

function directPairRefKeyFor(pairKey: string): string {
  return pairKey.replace(/[^\w.-]/g, "_");
}

function mapCachedUserDocToSummary(userId: string, userDoc: Record<string, unknown>): UserSummary {
  return {
    userId,
    handle: String(userDoc.handle ?? "").replace(/^@+/, "") || `user_${userId.slice(0, 8)}`,
    name:
      typeof userDoc.name === "string"
        ? userDoc.name
        : typeof userDoc.displayName === "string"
          ? userDoc.displayName
          : null,
    pic:
      typeof userDoc.profilePic === "string"
        ? userDoc.profilePic
        : typeof userDoc.photo === "string"
          ? userDoc.photo
          : null
  };
}

export class ChatsRepository {
  private readonly db = getFirestoreSourceClient();
  private readonly clientMessageIndex = new Map<string, string>();
  private readonly seededConversationsByViewer = new Map<string, ConversationRecord[]>();
  private readonly seededMessagesByConversation = new Map<string, MessageRecord[]>();

  private async loadCachedUserSummary(userId: string): Promise<UserSummary | null> {
    if (!userId.trim()) return null;
    const cachedSummary = await globalCache.get<UserSummary>(entityCacheKeys.userSummary(userId));
    if (cachedSummary) {
      recordEntityCacheHit();
      return cachedSummary;
    }
    const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(userId));
    if (cachedUserDoc) {
      recordEntityCacheHit();
      const derived = mapCachedUserDocToSummary(userId, cachedUserDoc);
      void globalCache.set(entityCacheKeys.userSummary(userId), derived, 25_000);
      return derived;
    }
    return null;
  }

  private ensureSeededViewer(viewerId: string): void {
    if (!shouldAllowSeededFallback(viewerId)) return;
    if (this.seededConversationsByViewer.has(viewerId)) return;
    const rows: ConversationRecord[] = Array.from({ length: 24 }, (_, idx) => {
      const slot = idx + 1;
      const other = `chat_user_${(seeded(`${viewerId}:${slot}`) % 140) + 1}`;
      const conversationId = `conv_${viewerId.slice(0, 6)}_${slot}`;
      const lastMessageAtMs = Date.now() - slot * 120_000;
      return {
        viewerId,
        conversationId,
        isGroup: slot % 5 === 0,
        title: slot % 5 === 0 ? `Group ${slot}` : fallbackAuthor(other).name ?? "Chat",
        displayPhotoUrl: null,
        participantIds: slot % 5 === 0 ? [viewerId, other, `chat_user_${slot + 300}`] : [viewerId, other],
        participantPreview: [fallbackAuthor(other)],
        lastMessagePreview: `Seeded message ${slot}`,
        lastMessageType: "message",
        lastSender: fallbackAuthor(other),
        lastMessageAtMs,
        unreadCount: slot <= 3 ? 1 : 0,
        muted: false,
        archived: false
      };
    });
    this.seededConversationsByViewer.set(viewerId, rows);
    for (const row of rows) {
      if (this.seededMessagesByConversation.has(row.conversationId)) continue;
      const messages: MessageRecord[] = Array.from({ length: 60 }, (_, idx) => {
        const n = idx + 1;
        const senderId = row.participantIds[n % row.participantIds.length] ?? viewerId;
        return {
          messageId: `${row.conversationId}_m_${String(n).padStart(3, "0")}`,
          conversationId: row.conversationId,
          senderId,
          sender: fallbackAuthor(senderId),
          messageType: "message",
          text: `Seeded thread message ${n}`,
          createdAtMs: row.lastMessageAtMs - n * 40_000,
          replyToMessageId: null,
          seenBy: [viewerId]
        };
      });
      this.seededMessagesByConversation.set(row.conversationId, messages);
    }
  }

  private async loadUserSummaries(userIds: string[], viewerIdForIndex?: string | null): Promise<Map<string, UserSummary>> {
    const unique = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0))];
    const out = new Map<string, UserSummary>();
    if (!this.db || unique.length === 0) return out;
    const ttlMs = 25_000;
    const viewerUserDoc =
      viewerIdForIndex && viewerIdForIndex.trim().length > 0
        ? await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerIdForIndex))
        : undefined;
    const viewerChatSummaryIndex =
      viewerUserDoc && viewerUserDoc.chatUserSummaryIndex && typeof viewerUserDoc.chatUserSummaryIndex === "object"
        ? (viewerUserDoc.chatUserSummaryIndex as Record<string, unknown>)
        : null;
    const cachedPairs = await Promise.all(
      unique.map(async (id) => ({
        id,
        summary: await globalCache.get<UserSummary>(entityCacheKeys.userSummary(id)),
        userDoc: await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(id))
      }))
    );
    const missing = new Set<string>();
    for (const { id, summary, userDoc } of cachedPairs) {
      if (summary !== undefined) {
        recordEntityCacheHit();
        out.set(id, summary);
        continue;
      }
      if (userDoc !== undefined) {
        const derived = mapCachedUserDocToSummary(id, userDoc);
        recordEntityCacheHit();
        out.set(id, derived);
        void globalCache.set(entityCacheKeys.userSummary(id), derived, ttlMs);
        continue;
      }
      const indexed = viewerChatSummaryIndex?.[id];
      if (indexed && typeof indexed === "object") {
        const row = indexed as Record<string, unknown>;
        const derived: UserSummary = {
          userId: id,
          handle: typeof row.handle === "string" ? row.handle : `user_${id.slice(0, 8)}`,
          name: typeof row.name === "string" ? row.name : null,
          pic: typeof row.pic === "string" ? row.pic : null
        };
        recordEntityCacheHit();
        out.set(id, derived);
        void globalCache.set(entityCacheKeys.userSummary(id), derived, ttlMs);
        continue;
      }
      missing.add(id);
    }
    if (missing.size === 0) return out;

    const chunks: string[][] = [];
    const missingIds = [...missing];
    for (let i = 0; i < missingIds.length; i += 10) chunks.push(missingIds.slice(i, i + 10));
    const snaps = await Promise.all(
      chunks.map((chunk) => this.db!.getAll(...chunk.map((id) => this.db!.collection("users").doc(id))))
    );
    const fetchedForViewerIndex: Record<string, { handle: string; name: string | null; pic: string | null }> = {};
    for (const docs of snaps) {
      incrementDbOps(
        "reads",
        docs.reduce((sum, doc) => sum + (doc.exists ? 1 : 0), 0)
      );
      for (const doc of docs) {
        if (!doc.exists) continue;
        const data = doc.data() as Record<string, unknown>;
        const summary: UserSummary = {
          userId: doc.id,
          handle: String(data.handle ?? "").replace(/^@+/, "") || `user_${doc.id.slice(0, 8)}`,
          name: typeof data.name === "string" ? data.name : typeof data.displayName === "string" ? data.displayName : null,
          pic: typeof data.profilePic === "string" ? data.profilePic : typeof data.photo === "string" ? data.photo : null
        };
        out.set(doc.id, summary);
        fetchedForViewerIndex[doc.id] = { handle: summary.handle, name: summary.name, pic: summary.pic };
        void globalCache.set(entityCacheKeys.userSummary(doc.id), summary, ttlMs);
      }
    }
    if (viewerIdForIndex && Object.keys(fetchedForViewerIndex).length > 0) {
      const nextIndex = {
        ...(viewerChatSummaryIndex ?? {}),
        ...fetchedForViewerIndex
      };
      void (async () => {
        const cachedUserDoc = (await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerIdForIndex))) ?? {};
        await globalCache.set(
          entityCacheKeys.userFirestoreDoc(viewerIdForIndex),
          {
            ...cachedUserDoc,
            chatUserSummaryIndex: nextIndex
          },
          ttlMs
        );
      })().catch(() => undefined);
    }
    return out;
  }

  private async assertViewerMembership(viewerId: string, conversationId: string): Promise<Record<string, unknown>> {
    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    const cached = await globalCache.get<Record<string, unknown>>(entityCacheKeys.chatConversationMembership(viewerId, conversationId));
    if (cached) {
      const participants = Array.isArray(cached.participants) ? cached.participants.filter((x): x is string => typeof x === "string") : [];
      if (participants.includes(viewerId)) {
        recordEntityCacheHit();
        return cached;
      }
    }
    incrementDbOps("queries", 1);
    const doc = await this.db.collection("chats").doc(conversationId).get();
    incrementDbOps("reads", 1);
    if (!doc.exists) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    const participants = Array.isArray(data.participants) ? data.participants.filter((x): x is string => typeof x === "string") : [];
    if (!participants.includes(viewerId)) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    void globalCache.set(entityCacheKeys.chatConversationMembership(viewerId, conversationId), data, 25_000).catch(() => undefined);
    return data;
  }

  async listInbox(input: {
    viewerId: string;
    cursor: string | null;
    limit: number;
  }): Promise<{ cursorIn: string | null; items: ConversationRecord[]; hasMore: boolean; nextCursor: string | null; totalConversationsUnread: number }> {
    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_inbox");
      this.ensureSeededViewer(input.viewerId);
      const all = this.seededConversationsByViewer.get(input.viewerId) ?? [];
      incrementDbOps("queries", 1);
      let start = 0;
      if (input.cursor) {
        try {
          const parsed = decodeCursor(input.cursor);
          start = all.findIndex((row) => row.lastMessageAtMs < parsed.createdAtMs || (row.lastMessageAtMs === parsed.createdAtMs && row.conversationId < parsed.id));
          if (start < 0) start = all.length;
        } catch {
          throw new ChatsRepositoryError("invalid_cursor", "Chats inbox cursor is invalid.");
        }
      }
      const items = all.slice(start, start + input.limit);
      incrementDbOps("reads", items.length);
      const hasMore = start + items.length < all.length;
      const tail = items[items.length - 1];
      const nextCursor = hasMore && tail ? encodeCursor({ id: tail.conversationId, createdAtMs: tail.lastMessageAtMs }) : null;
      return {
        cursorIn: input.cursor,
        items,
        hasMore,
        nextCursor,
        totalConversationsUnread: all.reduce((sum, row) => sum + (row.unreadCount > 0 ? 1 : 0), 0)
      };
    }
    if (!this.db) {
      return { cursorIn: input.cursor, items: [], hasMore: false, nextCursor: null, totalConversationsUnread: 0 };
    }
    let after: { id: string; createdAtMs: number } | null = null;
    if (input.cursor) {
      try {
        after = decodeCursor(input.cursor);
      } catch {
        throw new ChatsRepositoryError("invalid_cursor", "Chats inbox cursor is invalid.");
      }
    }

    let query = this.db
      .collection("chats")
      .where("participants", "array-contains", input.viewerId)
      .orderBy("lastMessageTime", "desc")
      .select(
        "participants",
        "groupName",
        "displayPhotoURL",
        "groupProfilePic",
        "manualUnreadBy",
        "lastMessage",
        "lastMessageTime",
        "createdAt"
      )
      .limit(input.limit + 1);

    if (after) {
      // lastMessageTime already has millisecond precision in production data; dropping the
      // document-id tie-breaker trims cold query latency on inbox loads.
      query = query.startAfter(Timestamp.fromMillis(after.createdAtMs));
    }

    incrementDbOps("queries", 1);
    let snap;
    const tInboxQuery0 = performance.now();
    try {
      snap = await query.get();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("PERMISSION_DENIED")) throw new SourceOfTruthRequiredError("chats_inbox_firestore_permission");
      if (message.includes("timeout")) throw new SourceOfTruthRequiredError("chats_inbox_firestore_timeout");
      throw error;
    }
    const tInboxQuery1 = performance.now();
    incrementDbOps("reads", snap.docs.length);
    const pageDocs = snap.docs.slice(0, input.limit);
    const hasMore = snap.docs.length > input.limit;
    const participantIds = new Set<string>();
    for (const doc of pageDocs) {
      const data = doc.data() as Record<string, unknown>;
      const participants = (Array.isArray(data.participants) ? data.participants : []).filter(
        (p): p is string => typeof p === "string"
      );
      const isGroup = participants.length > 2 || typeof data.groupName === "string" || data.isGroupChat === true;
      void globalCache.set(entityCacheKeys.chatConversationMembership(input.viewerId, doc.id), data, 25_000);
      if (!isGroup) {
        const directPeerId = participants.find((id) => id !== input.viewerId);
        if (directPeerId) participantIds.add(directPeerId);
      }
    }
    const tHydr0 = performance.now();
    // Inbox should show real peer names; cache-only hydration causes generic DM titles until user docs are cached.
    // Keep scope tight: only hydrate direct peers (<= page size).
    const users = await this.loadUserSummaries([...participantIds], input.viewerId);
    const tHydr1 = performance.now();

    const tMap0 = performance.now();
    const items = pageDocs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const participants = (Array.isArray(data.participants) ? data.participants : []).filter((p): p is string => typeof p === "string");
      const isGroup = participants.length > 2 || typeof data.groupName === "string";
      const lastMessage = (data.lastMessage as Record<string, unknown> | undefined) ?? null;
      const senderId = typeof lastMessage?.senderId === "string" ? lastMessage.senderId : null;
      const unreadBy = Array.isArray(data.manualUnreadBy) ? data.manualUnreadBy.filter((v): v is string => typeof v === "string") : [];
      const lastMessageSeenBy = Array.isArray(lastMessage?.seenBy)
        ? lastMessage.seenBy.filter((v): v is string => typeof v === "string")
        : [];
      const hasUnreadByFlag = unreadBy.includes(input.viewerId);
      const hasUnreadBySeenByFallback =
        Boolean(senderId) && senderId !== input.viewerId && !lastMessageSeenBy.includes(input.viewerId);
      const unreadCount = hasUnreadByFlag || (!Array.isArray(data.manualUnreadBy) && hasUnreadBySeenByFallback) ? 1 : 0;
      const lastType = normalizeConversationType(lastMessage?.type);
      const directPeerId = !isGroup ? participants.find((id) => id !== input.viewerId) ?? null : null;
      const directPeer = directPeerId ? users.get(directPeerId) : undefined;
      const directPeerTitle = directPeer?.name ?? directPeer?.handle ?? (directPeerId ? `user_${directPeerId.slice(0, 8)}` : "Chat");
      const title =
        isGroup
          ? (typeof data.groupName === "string" ? data.groupName : participants.filter((id) => id !== input.viewerId).slice(0, 2).join(", ") || "Group chat")
          : directPeerTitle;
      const participantPreview = !isGroup
        ? participants
            .filter((id) => id !== input.viewerId)
            .slice(0, 1)
            .map((id) => {
              const u = users.get(id);
              if (u) return { userId: u.userId, handle: u.handle, name: u.name, pic: u.pic };
              // No fake fallback authors in production inbox rows; keep handle stable and name null.
              return { userId: id, handle: `user_${id.slice(0, 8)}`, name: null, pic: null };
            })
        : [];
      const directPeerPic = directPeerId ? (directPeer?.pic ?? null) : null;
      return {
        viewerId: input.viewerId,
        conversationId: doc.id,
        isGroup,
        title,
        displayPhotoUrl:
          typeof data.displayPhotoURL === "string"
            ? data.displayPhotoURL
            : typeof data.groupProfilePic === "string"
              ? data.groupProfilePic
              : directPeerPic,
        participantIds: participants.slice(0, 12),
        participantPreview,
        lastMessagePreview: lastMessage ? toPreviewText(normalizeMessageType(lastMessage.type), lastMessage) : null,
        lastMessageType: lastMessage ? lastType : null,
        lastSender: null,
        lastMessageAtMs: toMillis(data.lastMessageTime ?? data.createdAt),
        unreadCount,
        muted: false,
        archived: false
      } satisfies ConversationRecord;
    });
    const tMap1 = performance.now();
    recordSurfaceTimings({
      chats_inbox_firestore_page_ms: tInboxQuery1 - tInboxQuery0,
      chats_inbox_user_batch_ms: tHydr1 - tHydr0,
      chats_inbox_map_ms: tMap1 - tMap0
    });

    const totalConversationsUnread = items.reduce((sum, row) => sum + (row.unreadCount > 0 ? 1 : 0), 0);
    const tail = items[items.length - 1];
    const nextCursor = hasMore && tail ? encodeCursor({ id: tail.conversationId, createdAtMs: tail.lastMessageAtMs }) : null;
    return { cursorIn: input.cursor, items, hasMore, nextCursor, totalConversationsUnread };
  }

  async markRead(input: { viewerId: string; conversationId: string }): Promise<{ conversationId: string; unreadCount: number; idempotent: boolean }> {
    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_mark_read");
      this.ensureSeededViewer(input.viewerId);
      incrementDbOps("queries", 1);
      const rows = this.seededConversationsByViewer.get(input.viewerId) ?? [];
      const row = rows.find((it) => it.conversationId === input.conversationId);
      if (!row) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
      const idempotent = row.unreadCount === 0;
      row.unreadCount = 0;
      if (!idempotent) incrementDbOps("writes", 1);
      return { conversationId: input.conversationId, unreadCount: 0, idempotent };
    }
    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    const docData = await this.assertViewerMembership(input.viewerId, input.conversationId);
    const unreadBy = Array.isArray(docData.manualUnreadBy) ? docData.manualUnreadBy.filter((v): v is string => typeof v === "string") : [];
    if (!unreadBy.includes(input.viewerId)) {
      return { conversationId: input.conversationId, unreadCount: 0, idempotent: true };
    }
    incrementDbOps("writes", 1);
    await this.db.collection("chats").doc(input.conversationId).update({ manualUnreadBy: FieldValue.arrayRemove(input.viewerId) });
    return { conversationId: input.conversationId, unreadCount: 0, idempotent: false };
  }

  async markUnread(input: { viewerId: string; conversationId: string }): Promise<{ conversationId: string; unreadCount: number; idempotent: boolean }> {
    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_mark_unread");
      this.ensureSeededViewer(input.viewerId);
      incrementDbOps("queries", 1);
      const rows = this.seededConversationsByViewer.get(input.viewerId) ?? [];
      const row = rows.find((it) => it.conversationId === input.conversationId);
      if (!row) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
      const idempotent = row.unreadCount > 0;
      row.unreadCount = 1;
      if (!idempotent) incrementDbOps("writes", 1);
      return { conversationId: input.conversationId, unreadCount: 1, idempotent };
    }
    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    const docData = await this.assertViewerMembership(input.viewerId, input.conversationId);
    const unreadBy = Array.isArray(docData.manualUnreadBy) ? docData.manualUnreadBy.filter((v): v is string => typeof v === "string") : [];
    if (unreadBy.includes(input.viewerId)) {
      return { conversationId: input.conversationId, unreadCount: 1, idempotent: true };
    }
    incrementDbOps("writes", 1);
    await this.db.collection("chats").doc(input.conversationId).update({ manualUnreadBy: FieldValue.arrayUnion(input.viewerId) });
    return { conversationId: input.conversationId, unreadCount: 1, idempotent: false };
  }

  async listThreadMessages(input: {
    viewerId: string;
    conversationId: string;
    cursor: string | null;
    limit: number;
  }): Promise<{ cursorIn: string | null; items: MessageRecord[]; hasMore: boolean; nextCursor: string | null }> {
    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_thread");
      this.ensureSeededViewer(input.viewerId);
      incrementDbOps("queries", 1);
      const rows = this.seededConversationsByViewer.get(input.viewerId) ?? [];
      const exists = rows.some((row) => row.conversationId === input.conversationId);
      if (!exists) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
      const all = this.seededMessagesByConversation.get(input.conversationId) ?? [];
      let start = 0;
      if (input.cursor) {
        try {
          const parsed = decodeCursor(input.cursor);
          start = all.findIndex((row) => row.createdAtMs < parsed.createdAtMs || (row.createdAtMs === parsed.createdAtMs && row.messageId < parsed.id));
          if (start < 0) start = all.length;
        } catch {
          throw new ChatsRepositoryError("invalid_cursor", "Chats thread cursor is invalid.");
        }
      }
      const items = all.slice(start, start + input.limit);
      incrementDbOps("reads", items.length);
      const hasMore = start + items.length < all.length;
      const tail = items[items.length - 1];
      const nextCursor = hasMore && tail ? encodeCursor({ id: tail.messageId, createdAtMs: tail.createdAtMs }) : null;
      return { cursorIn: input.cursor, items, hasMore, nextCursor };
    }
    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    const conversationData = await this.assertViewerMembership(input.viewerId, input.conversationId);
    let after: { id: string; createdAtMs: number } | null = null;
    if (input.cursor) {
      try {
        after = decodeCursor(input.cursor);
      } catch {
        throw new ChatsRepositoryError("invalid_cursor", "Chats thread cursor is invalid.");
      }
    }
    let query = this.db
      .collection("chats")
      .doc(input.conversationId)
      .collection("messages")
      .orderBy("timestamp", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .select("senderId", "seenBy", "type", "photoUrl", "gif", "gifUrl", "postId", "content", "text", "timestamp", "replyToMessageId", "reactions")
      .limit(input.limit + 1);
    if (after) query = query.startAfter(Timestamp.fromMillis(after.createdAtMs), after.id);
    incrementDbOps("queries", 1);
    let snap;
    try {
      snap = await query.get();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("PERMISSION_DENIED")) throw new SourceOfTruthRequiredError("chats_thread_firestore_permission");
      if (message.includes("timeout")) throw new SourceOfTruthRequiredError("chats_thread_firestore_timeout");
      throw error;
    }
    incrementDbOps("reads", snap.docs.length);
    const pageDocs = snap.docs.slice(0, input.limit);
    const hasMore = snap.docs.length > input.limit;
    const missingSenderIds = [
      ...new Set(
        pageDocs
          .map((d) => d.data() as Record<string, unknown>)
          .filter(
            (row) =>
              typeof row.senderName !== "string" &&
              typeof row.senderHandle !== "string" &&
              typeof row.senderProfilePic !== "string"
          )
          .map((row) => row.senderId)
          .filter((x): x is string => typeof x === "string")
      )
    ];
    const users = missingSenderIds.length > 0 ? await this.loadUserSummaries(missingSenderIds) : new Map<string, UserSummary>();
    const items = pageDocs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const senderId = typeof data.senderId === "string" ? data.senderId : "unknown";
      const senderSummary = users.get(senderId);
      const senderHandleRaw = typeof data.senderHandle === "string" ? data.senderHandle.replace(/^@+/, "").trim() : "";
      const senderNameRaw = typeof data.senderName === "string" ? data.senderName.trim() : "";
      const senderPicRaw = typeof data.senderProfilePic === "string" ? data.senderProfilePic.trim() : "";
      const fallback = fallbackAuthor(senderId);
      const sender = {
        userId: senderId,
        handle: senderHandleRaw || senderSummary?.handle || fallback.handle,
        name: senderNameRaw || senderSummary?.name || fallback.name,
        pic: senderPicRaw || senderSummary?.pic || null
      };
      const seenBy = Array.isArray(data.seenBy) ? data.seenBy.filter((x): x is string => typeof x === "string") : [];
      const messageType = normalizeMessageType(data.type);
      const photoUrl = typeof data.photoUrl === "string" && data.photoUrl.trim() ? data.photoUrl.trim() : null;
      const postId = typeof data.postId === "string" && data.postId.trim() ? data.postId.trim() : null;
      const gifUrlCandidate =
        typeof data.gifUrl === "string" && data.gifUrl.trim()
          ? data.gifUrl.trim()
          : typeof data.gif === "string" && data.gif.trim()
            ? data.gif.trim()
            : null;
      const gifObject =
        data.gif && typeof data.gif === "object"
          ? (data.gif as Record<string, unknown>)
          : null;
      const gif =
        gifObject && typeof gifObject.previewUrl === "string" && gifObject.previewUrl.trim()
          ? {
              provider: "giphy" as const,
              gifId: typeof gifObject.gifId === "string" && gifObject.gifId.trim() ? gifObject.gifId.trim() : doc.id,
              title: typeof gifObject.title === "string" ? gifObject.title : undefined,
              previewUrl: gifObject.previewUrl.trim(),
              fixedHeightUrl: typeof gifObject.fixedHeightUrl === "string" ? gifObject.fixedHeightUrl : undefined,
              mp4Url: typeof gifObject.mp4Url === "string" ? gifObject.mp4Url : undefined,
              width: typeof gifObject.width === "number" && Number.isFinite(gifObject.width) ? Math.floor(gifObject.width) : undefined,
              height: typeof gifObject.height === "number" && Number.isFinite(gifObject.height) ? Math.floor(gifObject.height) : undefined,
              originalUrl: typeof gifObject.originalUrl === "string" ? gifObject.originalUrl : undefined
            }
          : gifUrlCandidate
            ? {
                provider: "giphy" as const,
                gifId: doc.id,
                previewUrl: gifUrlCandidate
              }
            : null;

      const text =
        messageType === "photo"
          ? null
          : messageType === "gif"
            ? null
            : messageType === "post"
              ? null
              : typeof data.content === "string"
                ? data.content
                : typeof data.text === "string"
                  ? data.text
                  : null;
      const rawReactions = data.reactions && typeof data.reactions === "object" ? (data.reactions as Record<string, unknown>) : {};
      const reactions: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawReactions)) {
        if (typeof v === "string" && v.length > 0) reactions[k] = v;
      }
      return {
        messageId: doc.id,
        conversationId: input.conversationId,
        senderId,
        sender: { userId: sender.userId, handle: sender.handle, name: sender.name, pic: sender.pic },
        messageType,
        text,
        photoUrl: messageType === "photo" ? photoUrl : undefined,
        gif: messageType === "gif" ? gif : undefined,
        postId: messageType === "post" ? postId : undefined,
        createdAtMs: toMillis(data.timestamp),
        replyToMessageId: typeof data.replyToMessageId === "string" ? data.replyToMessageId : null,
        seenBy,
        ...(Object.keys(reactions).length > 0 ? { reactions } : {})
      } satisfies MessageRecord;
    });
    const tail = items[items.length - 1];
    const nextCursor = hasMore && tail ? encodeCursor({ id: tail.messageId, createdAtMs: tail.createdAtMs }) : null;
    return { cursorIn: input.cursor, items, hasMore, nextCursor };
  }

  async sendMessage(input: SendTextMessageInput): Promise<{
    message: MessageRecord;
    idempotent: boolean;
    recipientUserIds: string[];
    groupName: string | null;
  }> {
    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_send_message");
      this.ensureSeededViewer(input.viewerId);
      incrementDbOps("queries", 1);
      const rows = this.seededConversationsByViewer.get(input.viewerId) ?? [];
      const row = rows.find((it) => it.conversationId === input.conversationId);
      if (!row) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
      const key = input.clientMessageId ? `${input.viewerId}:${input.conversationId}:${input.clientMessageId}` : null;
      if (key) {
        const existingId = this.clientMessageIndex.get(key);
        if (existingId) {
          const existing = (this.seededMessagesByConversation.get(input.conversationId) ?? []).find((m) => m.messageId === existingId);
          if (existing) return { message: existing, idempotent: true, recipientUserIds: row.participantIds.filter((id) => id !== input.viewerId), groupName: row.isGroup ? row.title ?? null : null };
        }
      }
      const now = Date.now();
      const msg: MessageRecord = {
        messageId: `${input.conversationId}_local_${now}`,
        conversationId: input.conversationId,
        senderId: input.viewerId,
        sender: fallbackAuthor(input.viewerId),
        messageType: input.messageType === "text" ? "message" : input.messageType,
        text:
          input.messageType === "photo"
            ? input.photoUrl
            : input.messageType === "gif"
              ? input.gifUrl
              : input.messageType === "post"
                ? input.postId
                : input.text,
        createdAtMs: now,
        replyToMessageId: input.replyingToMessageId,
        seenBy: [input.viewerId]
      };
      const arr = this.seededMessagesByConversation.get(input.conversationId) ?? [];
      arr.unshift(msg);
      this.seededMessagesByConversation.set(input.conversationId, arr);
      row.lastMessageAtMs = now;
      row.lastMessageType = msg.messageType === "text" ? "message" : msg.messageType;
      row.lastMessagePreview = toPreviewText(
        msg.messageType,
        msg.messageType === "post" ? { postId: msg.text } : { content: msg.text }
      );
      row.lastSender = msg.sender;
      row.unreadCount = 0;
      incrementDbOps("writes", 1);
      if (key) this.clientMessageIndex.set(key, msg.messageId);
      return {
        message: msg,
        idempotent: false,
        recipientUserIds: row.participantIds.filter((id) => id !== input.viewerId),
        groupName: row.isGroup ? row.title ?? null : null,
      };
    }
    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    const tMembership0 = performance.now();
    const conversationPromise = this.assertViewerMembership(input.viewerId, input.conversationId);
    const senderPromise = this.loadCachedUserSummary(input.viewerId).catch(() => null);
    const [conversationData, prefetchedSender] = await Promise.all([conversationPromise, senderPromise]);
    const tMembership1 = performance.now();
    const participants = Array.isArray(conversationData.participants)
      ? conversationData.participants.filter((v: unknown): v is string => typeof v === "string")
      : [];
    const key = input.clientMessageId ? `${input.viewerId}:${input.conversationId}:${input.clientMessageId}` : null;
    if (key) {
      const existingId = this.clientMessageIndex.get(key);
      if (existingId) {
        incrementDbOps("queries", 1);
        const existing = await this.db.collection("chats").doc(input.conversationId).collection("messages").doc(existingId).get();
        incrementDbOps("reads", 1);
        if (existing.exists) {
          const data = existing.data() as Record<string, unknown>;
          const messageType = normalizeMessageType(data.type);
          const replayText =
            messageType === "post"
              ? typeof data.postId === "string"
                ? data.postId
                : null
              : typeof data.content === "string"
                ? data.content
                : null;
          return {
            idempotent: true,
            message: {
              messageId: existing.id,
              conversationId: input.conversationId,
              senderId: input.viewerId,
              sender: fallbackAuthor(input.viewerId),
              messageType,
              text: replayText,
              createdAtMs: toMillis(data.timestamp),
              replyToMessageId: typeof data.replyToMessageId === "string" ? data.replyToMessageId : null,
              seenBy: Array.isArray(data.seenBy) ? data.seenBy.filter((x): x is string => typeof x === "string") : [input.viewerId]
            },
            recipientUserIds: participants.filter((participantId: string) => participantId !== input.viewerId),
            groupName:
              participants.length > 2 || typeof conversationData.groupName === "string"
                ? (typeof conversationData.groupName === "string" ? conversationData.groupName : "Group chat")
                : null,
          };
        }
      }
    }

    const now = Timestamp.now();
    const messageRef = this.db.collection("chats").doc(input.conversationId).collection("messages").doc();
    const type = input.messageType === "text" ? "message" : input.messageType;
    const content =
      input.messageType === "photo"
        ? input.photoUrl
        : input.messageType === "gif"
          ? input.gifUrl
          : input.messageType === "post"
            ? input.text
            : input.text;
    const sender = prefetchedSender ?? fallbackAuthor(input.viewerId);
    const tSender1 = performance.now();
    const messagePayload: Record<string, unknown> = {
      type,
      senderId: input.viewerId,
      senderName: sender.name,
      senderHandle: sender.handle,
      senderProfilePic: sender.pic,
      timestamp: now,
      seenBy: [input.viewerId]
    };
    if (input.messageType === "photo") messagePayload.photoUrl = input.photoUrl;
    else if (input.messageType === "gif") {
      if (input.gif && input.gif.previewUrl) {
        messagePayload.gif = input.gif;
      } else if (input.gifUrl) {
        // Back-compat for older clients: store gifUrl for later hydration.
        messagePayload.gifUrl = input.gifUrl;
      }
    }
    else if (input.messageType === "post") {
      if (!input.postId) throw new ChatsRepositoryError("conversation_not_found", "postId is required for post messages.");
      messagePayload.postId = input.postId;
      if (typeof input.text === "string" && input.text.trim().length > 0) {
        messagePayload.content = input.text;
      }
    } else messagePayload.content = content;
    if (input.replyingToMessageId) messagePayload.replyToMessageId = input.replyingToMessageId;

    const unreadTargets = participants.filter((participantId: string) => participantId !== input.viewerId);

    incrementDbOps("writes", 2);
    const tWrite0 = performance.now();
    const batch = this.db.batch();
    batch.set(messageRef, messagePayload);
    batch.update(this.db.collection("chats").doc(input.conversationId), {
      lastMessageTime: now,
      lastMessage: {
        type,
        content:
          type === "post"
            ? typeof input.text === "string" && input.text.trim().length > 0
              ? input.text
              : "Shared a post"
            : typeof content === "string"
              ? content
              : null,
        senderId: input.viewerId,
        timestamp: now,
        seenBy: [input.viewerId]
      },
      manualUnreadBy: unreadTargets
    });
    await batch.commit();
    const tWrite1 = performance.now();
    recordSurfaceTimings({
      chats_send_membership_ms: tMembership1 - tMembership0,
      chats_send_sender_ms: tSender1 - tMembership1,
      chats_send_write_ms: tWrite1 - tWrite0
    });

    if (key) this.clientMessageIndex.set(key, messageRef.id);
    const normalizedType = normalizeMessageType(type);
    const outText = typeof content === "string" ? content : null;
    return {
      idempotent: false,
      recipientUserIds: unreadTargets,
      groupName:
        participants.length > 2 || typeof conversationData.groupName === "string"
          ? (typeof conversationData.groupName === "string" ? conversationData.groupName : "Group chat")
          : null,
      message: {
        messageId: messageRef.id,
        conversationId: input.conversationId,
        senderId: input.viewerId,
        sender,
        messageType: normalizedType,
        text: normalizedType === "text" || normalizedType === "message" ? outText : null,
        photoUrl: normalizedType === "photo" ? input.photoUrl : undefined,
        gif: normalizedType === "gif" ? (input.gif ?? (input.gifUrl ? { provider: "giphy" as const, gifId: messageRef.id, previewUrl: input.gifUrl } : null)) : undefined,
        postId: normalizedType === "post" ? input.postId : undefined,
        createdAtMs: now.toMillis(),
        replyToMessageId: input.replyingToMessageId,
        seenBy: [input.viewerId]
      }
    };
  }

  async createOrGetDirectConversation(input: { viewerId: string; otherUserId: string }): Promise<{ conversationId: string; created: boolean }> {
    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_create_or_get_direct");
      this.ensureSeededViewer(input.viewerId);
      incrementDbOps("queries", 1);
      const rows = this.seededConversationsByViewer.get(input.viewerId) ?? [];
      const pair = [input.viewerId, input.otherUserId].sort().join("\0");
      const existing = rows.find((row) => row.participantIds.length === 2 && [...row.participantIds].sort().join("\0") === pair);
      if (existing) return { conversationId: existing.conversationId, created: false };
      const now = Date.now();
      const conversationId = `conv_${input.viewerId.slice(0, 6)}_${input.otherUserId.slice(0, 6)}_${rows.length + 1}`;
      rows.unshift({
        viewerId: input.viewerId,
        conversationId,
        isGroup: false,
        title: fallbackAuthor(input.otherUserId).name ?? "Direct chat",
        displayPhotoUrl: null,
        participantIds: [input.viewerId, input.otherUserId],
        participantPreview: [fallbackAuthor(input.otherUserId)],
        lastMessagePreview: null,
        lastMessageType: null,
        lastSender: null,
        lastMessageAtMs: now,
        unreadCount: 0,
        muted: false,
        archived: false
      });
      this.seededMessagesByConversation.set(conversationId, []);
      incrementDbOps("writes", 1);
      return { conversationId, created: true };
    }
    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    const pair = [input.viewerId, input.otherUserId].sort();
    const pairKey = directPairKeyFor(input.viewerId, input.otherUserId);
    const pairRefKey = directPairRefKeyFor(pairKey);
    const cachedConversationId = await globalCache.get<string>(entityCacheKeys.chatDirectConversation(pairKey));
    if (cachedConversationId) {
      recordEntityCacheHit();
      return { conversationId: cachedConversationId, created: false };
    }

    const pairRef = this.db.collection("chat_direct_pairs").doc(pairRefKey);
    const now = Timestamp.now();
    const db = this.db!;
    const created = db.collection("chats").doc();
    const createdData = {
      participants: pair,
      directPairKey: pairKey,
      isGroupChat: false,
      createdAt: now,
      manualUnreadBy: [],
      lastMessageTime: now
    };
    incrementDbOps("writes", 2);
    try {
      const batch = db.batch();
      batch.create(created, createdData);
      batch.create(pairRef, {
        conversationId: created.id,
        participants: pair,
        directPairKey: pairKey,
        createdAt: now,
        updatedAt: now
      });
      await batch.commit();
      void globalCache.set(entityCacheKeys.chatDirectConversation(pairKey), created.id, 60_000).catch(() => undefined);
      void globalCache.set(entityCacheKeys.chatConversationMembership(input.viewerId, created.id), createdData, 25_000).catch(() => undefined);
      return { conversationId: created.id, created: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("PERMISSION_DENIED")) {
        throw new SourceOfTruthRequiredError("chats_create_direct_firestore_permission");
      }
      if (message.includes("ALREADY_EXISTS")) {
        const retrySnapshot = await pairRef.get();
        incrementDbOps("reads", retrySnapshot.exists ? 1 : 0);
        const retryData = retrySnapshot.data() as Record<string, unknown> | undefined;
        const existingConversationId = typeof retryData?.conversationId === "string" ? retryData.conversationId : null;
        if (existingConversationId) {
          void globalCache.set(entityCacheKeys.chatDirectConversation(pairKey), existingConversationId, 60_000).catch(() => undefined);
          return { conversationId: existingConversationId, created: false };
        }
      }
      throw error;
    }
  }

  async createGroupConversation(input: {
    viewerId: string;
    participantIds: string[];
    groupName: string;
    displayPhotoUrl?: string | null;
  }): Promise<{ conversationId: string }> {
    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_create_group");
      this.ensureSeededViewer(input.viewerId);
      incrementDbOps("queries", 1);
      const rows = this.seededConversationsByViewer.get(input.viewerId) ?? [];
      const participants = [...new Set([input.viewerId, ...input.participantIds])].slice(0, 12);
      const now = Date.now();
      const conversationId = `grp_${input.viewerId.slice(0, 6)}_${rows.length + 1}`;
      rows.unshift({
        viewerId: input.viewerId,
        conversationId,
        isGroup: true,
        title: input.groupName.trim() || "Group chat",
        displayPhotoUrl: input.displayPhotoUrl ?? null,
        participantIds: participants,
        participantPreview: participants.filter((id) => id !== input.viewerId).slice(0, 3).map((id) => fallbackAuthor(id)),
        lastMessagePreview: null,
        lastMessageType: null,
        lastSender: null,
        lastMessageAtMs: now,
        unreadCount: 0,
        muted: false,
        archived: false
      });
      this.seededMessagesByConversation.set(conversationId, []);
      incrementDbOps("writes", 1);
      return { conversationId };
    }
    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    const participants = [...new Set([input.viewerId, ...input.participantIds])].slice(0, 12);
    const now = Timestamp.now();
    incrementDbOps("writes", 1);
    const created = await this.db.collection("chats").add({
      participants,
      groupName: input.groupName.trim() || "Group chat",
      displayPhotoURL: input.displayPhotoUrl ?? null,
      createdAt: now,
      manualUnreadBy: [],
      lastMessageTime: now
    });
    void globalCache.set(
      entityCacheKeys.chatConversationMembership(input.viewerId, created.id),
      {
        participants,
        groupName: input.groupName.trim() || "Group chat",
        displayPhotoURL: input.displayPhotoUrl ?? null,
        createdAt: now,
        manualUnreadBy: [],
        lastMessageTime: now
      },
      25_000
    ).catch(() => undefined);
    return { conversationId: created.id };
  }

  async updateGroupMetadata(input: {
    viewerId: string;
    conversationId: string;
    groupName?: string;
    displayPhotoURL?: string | null;
  }): Promise<{ conversationId: string; groupName: string; displayPhotoURL: string | null }> {
    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_update_group");
      this.ensureSeededViewer(input.viewerId);
      incrementDbOps("queries", 1);
      const rows = this.seededConversationsByViewer.get(input.viewerId) ?? [];
      const row = rows.find((it) => it.conversationId === input.conversationId);
      if (!row) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
      if (!row.isGroup) {
        throw new ChatsRepositoryError("not_group_chat", "Only group conversations support metadata updates.");
      }
      if (typeof input.groupName === "string" && input.groupName.trim().length > 0) {
        row.title = input.groupName.trim();
      }
      if (input.displayPhotoURL !== undefined) {
        row.displayPhotoUrl = input.displayPhotoURL;
      }
      row.lastMessageAtMs = Date.now();
      incrementDbOps("writes", 1);
      return {
        conversationId: input.conversationId,
        groupName: row.title,
        displayPhotoURL: row.displayPhotoUrl ?? null
      };
    }
    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    const data = await this.assertViewerMembership(input.viewerId, input.conversationId);
    const participants = Array.isArray(data.participants) ? data.participants.filter((x): x is string => typeof x === "string") : [];
    const isGroup = participants.length > 2 || typeof data.groupName === "string";
    if (!isGroup) {
      throw new ChatsRepositoryError("not_group_chat", "Only group conversations support metadata updates.");
    }
    const updates: Record<string, unknown> = {};
    if (typeof input.groupName === "string" && input.groupName.trim().length > 0) {
      updates.groupName = input.groupName.trim();
    }
    if (input.displayPhotoURL !== undefined) {
      updates.displayPhotoURL = input.displayPhotoURL;
    }
    if (Object.keys(updates).length > 0) {
      incrementDbOps("writes", 1);
      await this.db.collection("chats").doc(input.conversationId).update(updates);
    }
    const nextName =
      typeof updates.groupName === "string"
        ? String(updates.groupName)
        : typeof data.groupName === "string"
          ? String(data.groupName)
          : participants.filter((id) => id !== input.viewerId).slice(0, 2).join(", ") || "Group chat";
    const nextPhoto =
      input.displayPhotoURL !== undefined
        ? input.displayPhotoURL
        : typeof data.displayPhotoURL === "string"
          ? data.displayPhotoURL
          : null;
    return { conversationId: input.conversationId, groupName: nextName, displayPhotoURL: nextPhoto };
  }

  async setMessageReaction(input: {
    viewerId: string;
    conversationId: string;
    messageId: string;
    emoji: string;
  }): Promise<{ messageId: string; reactions: Record<string, string>; viewerReaction: string | null }> {
    const emoji = input.emoji.trim().slice(0, 16);
    if (!emoji) throw new ChatsRepositoryError("conversation_not_found", "emoji is required.");

    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_reaction");
      this.ensureSeededViewer(input.viewerId);
      incrementDbOps("queries", 1);
      const exists = (this.seededConversationsByViewer.get(input.viewerId) ?? []).some(
        (row) => row.conversationId === input.conversationId
      );
      if (!exists) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
      const messages = this.seededMessagesByConversation.get(input.conversationId) ?? [];
      const msg = messages.find((m) => m.messageId === input.messageId);
      if (!msg) throw new ChatsRepositoryError("conversation_not_found", "Message was not found.");
      const next: Record<string, string> = { ...(msg.reactions ?? {}) };
      if (next[input.viewerId] === emoji) {
        delete next[input.viewerId];
      } else {
        next[input.viewerId] = emoji;
      }
      msg.reactions = Object.keys(next).length > 0 ? next : undefined;
      incrementDbOps("writes", 1);
      return {
        messageId: input.messageId,
        reactions: next,
        viewerReaction: next[input.viewerId] ?? null
      };
    }

    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    await this.assertViewerMembership(input.viewerId, input.conversationId);
    const msgRef = this.db.collection("chats").doc(input.conversationId).collection("messages").doc(input.messageId);
    incrementDbOps("queries", 1);
    const result = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(msgRef);
      incrementDbOps("reads", 1);
      if (!snap.exists) {
        throw new ChatsRepositoryError("conversation_not_found", "Message was not found.");
      }
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const raw = data.reactions && typeof data.reactions === "object" ? (data.reactions as Record<string, unknown>) : {};
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "string" && v.length > 0) next[k] = v;
      }
      if (next[input.viewerId] === emoji) {
        delete next[input.viewerId];
      } else {
        next[input.viewerId] = emoji;
      }
      tx.update(msgRef, { reactions: next });
      return { reactions: next, viewerReaction: next[input.viewerId] ?? null };
    });
    incrementDbOps("writes", 1);
    return { messageId: input.messageId, reactions: result.reactions, viewerReaction: result.viewerReaction };
  }

  async deleteConversation(input: { viewerId: string; conversationId: string }): Promise<{ conversationId: string; deleted: boolean }> {
    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_delete_conversation");
      this.ensureSeededViewer(input.viewerId);
      incrementDbOps("queries", 1);
      const rows = this.seededConversationsByViewer.get(input.viewerId) ?? [];
      const idx = rows.findIndex((row) => row.conversationId === input.conversationId);
      if (idx < 0) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
      rows.splice(idx, 1);
      this.seededMessagesByConversation.delete(input.conversationId);
      incrementDbOps("writes", 1);
      return { conversationId: input.conversationId, deleted: true };
    }
    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    await this.assertViewerMembership(input.viewerId, input.conversationId);
    incrementDbOps("writes", 1);
    await this.db.collection("chats").doc(input.conversationId).delete();
    return { conversationId: input.conversationId, deleted: true };
  }

  async deleteMessage(input: { viewerId: string; conversationId: string; messageId: string }): Promise<{ messageId: string; deleted: boolean }> {
    if (shouldAllowSeededFallback(input.viewerId)) {
      recordFallback("chats_seeded_delete_message");
      this.ensureSeededViewer(input.viewerId);
      incrementDbOps("queries", 1);
      const exists = (this.seededConversationsByViewer.get(input.viewerId) ?? []).some((row) => row.conversationId === input.conversationId);
      if (!exists) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
      const messages = this.seededMessagesByConversation.get(input.conversationId) ?? [];
      const idx = messages.findIndex((m) => m.messageId === input.messageId);
      if (idx >= 0) {
        messages.splice(idx, 1);
        incrementDbOps("writes", 1);
        return { messageId: input.messageId, deleted: true };
      }
      return { messageId: input.messageId, deleted: false };
    }
    if (!this.db) throw new ChatsRepositoryError("conversation_not_found", "Conversation was not found.");
    await this.assertViewerMembership(input.viewerId, input.conversationId);
    const ref = this.db.collection("chats").doc(input.conversationId).collection("messages").doc(input.messageId);
    // Delete message and repair chat lastMessage projection if needed.
    const now = Timestamp.now();
    incrementDbOps("writes", 2);
    await ref.delete();
    // Recompute last message preview (best-effort, avoids inbox showing a ghost message).
    try {
      incrementDbOps("queries", 1);
      const snap = await this.db
        .collection("chats")
        .doc(input.conversationId)
        .collection("messages")
        .orderBy("timestamp", "desc")
        .orderBy(FieldPath.documentId(), "desc")
        .limit(1)
        .get();
      incrementDbOps("reads", snap.docs.length);
      const last = snap.docs[0];
      const chatRef = this.db.collection("chats").doc(input.conversationId);
      if (!last) {
        await chatRef.set(
          {
            lastMessageTime: now,
            lastMessage: {
              type: "message",
              content: "Message unsent",
              senderId: input.viewerId,
              timestamp: now,
              seenBy: [input.viewerId]
            }
          },
          { merge: true }
        );
      } else {
        const d = last.data() as Record<string, unknown>;
        const type = typeof d.type === "string" ? d.type : "message";
        const content = typeof d.content === "string" ? d.content : typeof d.text === "string" ? d.text : null;
        const senderId = typeof d.senderId === "string" ? d.senderId : input.viewerId;
        const ts = d.timestamp instanceof Timestamp ? d.timestamp : now;
        await chatRef.set(
          {
            lastMessageTime: ts,
            lastMessage: {
              type,
              content: type === "photo" ? "Sent a photo" : type === "gif" ? "Sent a GIF" : type === "post" ? "Shared a post" : content,
              senderId,
              timestamp: ts,
              seenBy: [senderId]
            }
          },
          { merge: true }
        );
      }
    } catch {
      // best-effort: thread correctness comes from message collection itself
    }
    return { messageId: input.messageId, deleted: true };
  }

  resetForTests(): void {
    this.clientMessageIndex.clear();
    this.seededConversationsByViewer.clear();
    this.seededMessagesByConversation.clear();
  }
}

export const chatsRepository = new ChatsRepository();
