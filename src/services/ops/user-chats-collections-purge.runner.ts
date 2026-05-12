import { FieldPath } from "firebase-admin/firestore";
import type { Firestore, QueryDocumentSnapshot, QuerySnapshot } from "firebase-admin/firestore";
import { CollectionsFirestoreAdapter, isSystemOrGeneratedCollection } from "../../repositories/source-of-truth/collections-firestore.adapter.js";

const CHATS_PAGE = 400;
const MESSAGES_PAGE = 450;

/** Same membership rule as native inbox: `chats` docs whose `participants` array contains this uid. */
export const CHATS_PURGE_SCOPE =
  "Only `chats/{conversationId}` where `participants` array-contains the given userId. Does not touch conversations this user is not a member of.";

/** Owner-only: not collaborator-only rows on someone else's collection. */
export const COLLECTIONS_PURGE_SCOPE =
  "Only `collections/{id}` where effective owner is this user (`ownerId` if set, else `userId`). Does not delete collections owned by another user.";

export const COLLECTIONS_PURGE_SCOPE_WITH_SYSTEM =
  COLLECTIONS_PURGE_SCOPE +
  " When `includeSystemCollections` is true, also deletes system-managed / generated docs this user owns (still no root `posts`).";

export type UserChatsCollectionsPurgeSummary = {
  userId: string;
  dryRun: boolean;
  includeSystemCollections: boolean;
  chats: {
    /** Human-readable guarantee of what is included */
    scope: string;
    conversationIds: string[];
    count: number;
    /** Firestore paths that would be / were touched for chats only */
    pathsTouched: string[];
  };
  collections: {
    scope: string;
    /** Hand-curated / normal collections (deleteCollection path) */
    collectionIds: string[];
    count: number;
    /** System-managed or generated rows this user still owns in `collections/` */
    systemOwnedCollectionIds: string[];
    systemOwnedCount: number;
    /**
     * When `includeSystemCollections` is false: equals `systemOwnedCount` (left in place).
     * When true after execute: 0.
     */
    skippedSystemOrGenerated: number;
    pathsTouched: string[];
  };
};

function directPairDocIdFromPairKey(pairKey: string): string {
  return pairKey.replace(/[^\w.-]/g, "_");
}

function effectiveCollectionOwnerId(data: Record<string, unknown>): string {
  return String(data.ownerId ?? data.userId ?? "").trim();
}

async function deleteMessagesSubcollection(db: Firestore, conversationId: string): Promise<number> {
  const messagesCol = db.collection("chats").doc(conversationId).collection("messages");
  let deleted = 0;
  for (;;) {
    const snap = await messagesCol.orderBy(FieldPath.documentId()).limit(MESSAGES_PAGE).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
    deleted += snap.docs.length;
    if (snap.docs.length < MESSAGES_PAGE) break;
  }
  return deleted;
}

async function deleteChatDirectPairIfPresent(
  db: Firestore,
  conversationId: string,
  chatData: Record<string, unknown>,
  participants: string[]
): Promise<boolean> {
  const isGroup =
    participants.length > 2 ||
    typeof chatData.groupName === "string" ||
    chatData.isGroupChat === true;
  if (isGroup) return false;
  const pairKey =
    typeof chatData.directPairKey === "string" && chatData.directPairKey.trim().length > 0
      ? chatData.directPairKey.trim()
      : participants.length === 2
        ? [...participants].sort().join(":")
        : "";
  if (!pairKey) return false;
  const pairDocId = directPairDocIdFromPairKey(pairKey);
  const ref = db.collection("chat_direct_pairs").doc(pairDocId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const row = (snap.data() ?? {}) as Record<string, unknown>;
  if (typeof row.conversationId === "string" && row.conversationId !== conversationId) return false;
  await ref.delete();
  return true;
}

async function listAllChatIdsForUser(db: Firestore, userId: string): Promise<string[]> {
  const out: string[] = [];
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db
      .collection("chats")
      .where("participants", "array-contains", userId)
      .orderBy(FieldPath.documentId())
      .limit(CHATS_PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) out.push(d.id);
    if (snap.docs.length < CHATS_PAGE) break;
    last = snap.docs[snap.docs.length - 1] ?? null;
    if (!last) break;
  }
  return out;
}

async function listOwnedCollectionIdsForUser(db: Firestore, userId: string): Promise<{
  regularIds: string[];
  systemOwnedIds: string[];
}> {
  const seen = new Set<string>();
  const regularIds: string[] = [];
  const systemOwnedIds: string[] = [];

  const ingestSnap = (snap: QuerySnapshot): void => {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = (d.data() ?? {}) as Record<string, unknown>;
      if (effectiveCollectionOwnerId(data) !== userId) continue;
      if (isSystemOrGeneratedCollection(data)) {
        systemOwnedIds.push(d.id);
      } else {
        regularIds.push(d.id);
      }
    }
  };

  for (const field of ["ownerId", "userId"] as const) {
    let last: QueryDocumentSnapshot | null = null;
    for (;;) {
      let q = db.collection("collections").where(field, "==", userId).orderBy(FieldPath.documentId()).limit(CHATS_PAGE);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      ingestSnap(snap);
      if (snap.docs.length < CHATS_PAGE) break;
      last = snap.docs[snap.docs.length - 1] ?? null;
      if (!last) break;
    }
  }

  return { regularIds, systemOwnedIds };
}

/**
 * Emergency purge: only `chats/*` (+ `messages` subcollections + matching `chat_direct_pairs/*`)
 * and user-owned `collections/*` (via CollectionsFirestoreAdapter.deleteCollection — index cleanup included).
 * When `includeSystemCollections` is true, also hard-deletes system-managed / generated `collections/*`
 * this user owns via `CollectionsFirestoreAdapter.emergencyHardDeleteCollection`.
 * Does not touch root `posts`.
 */
export async function runUserChatsAndOwnedCollectionsPurge(
  db: Firestore,
  input: { userId: string; dryRun: boolean; includeSystemCollections?: boolean }
): Promise<UserChatsCollectionsPurgeSummary> {
  const userId = input.userId.trim();
  if (!userId) {
    throw new Error("userId is required");
  }
  const includeSystemCollections = Boolean(input.includeSystemCollections);

  const chatIds = await listAllChatIdsForUser(db, userId);
  const { regularIds: collectionIds, systemOwnedIds } = await listOwnedCollectionIdsForUser(db, userId);
  const systemOwnedCount = systemOwnedIds.length;
  const skippedSystemOrGenerated = includeSystemCollections ? 0 : systemOwnedCount;

  const collectionScope = includeSystemCollections ? COLLECTIONS_PURGE_SCOPE_WITH_SYSTEM : COLLECTIONS_PURGE_SCOPE;
  const allCollectionPathsForTouch = [
    ...collectionIds.map((id) => `collections/${id}`),
    ...(includeSystemCollections ? systemOwnedIds.map((id) => `collections/${id} (system hard-delete)`) : []),
  ];

  const chatPaths = chatIds.flatMap((id) => [`chats/${id}`, `chats/${id}/messages/*`, "chat_direct_pairs/* (DM only)"]);

  if (input.dryRun) {
    return {
      userId,
      dryRun: true,
      includeSystemCollections,
      chats: {
        scope: CHATS_PURGE_SCOPE,
        conversationIds: chatIds,
        count: chatIds.length,
        pathsTouched: [...new Set(chatPaths)],
      },
      collections: {
        scope: collectionScope,
        collectionIds,
        count: collectionIds.length,
        systemOwnedCollectionIds: systemOwnedIds,
        systemOwnedCount,
        skippedSystemOrGenerated,
        pathsTouched: allCollectionPathsForTouch,
      },
    };
  }

  for (const conversationId of chatIds) {
    const ref = db.collection("chats").doc(conversationId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const chatData = (snap.data() ?? {}) as Record<string, unknown>;
    const participants = Array.isArray(chatData.participants)
      ? chatData.participants.filter((x): x is string => typeof x === "string")
      : [];
    if (!participants.includes(userId)) continue;

    await deleteMessagesSubcollection(db, conversationId);
    await deleteChatDirectPairIfPresent(db, conversationId, chatData, participants);
    await ref.delete();
  }

  const adapter = new CollectionsFirestoreAdapter();
  for (const collectionId of collectionIds) {
    const colSnap = await db.collection("collections").doc(collectionId).get();
    if (!colSnap.exists) continue;
    const data = (colSnap.data() ?? {}) as Record<string, unknown>;
    if (effectiveCollectionOwnerId(data) !== userId) continue;
    if (isSystemOrGeneratedCollection(data)) continue;
    await adapter.deleteCollection({ viewerId: userId, collectionId });
  }

  if (includeSystemCollections) {
    for (const collectionId of systemOwnedIds) {
      const colSnap = await db.collection("collections").doc(collectionId).get();
      if (!colSnap.exists) continue;
      const data = (colSnap.data() ?? {}) as Record<string, unknown>;
      if (effectiveCollectionOwnerId(data) !== userId) continue;
      if (!isSystemOrGeneratedCollection(data)) continue;
      await adapter.emergencyHardDeleteCollection({ collectionId });
    }
  }

  return {
    userId,
    dryRun: false,
    includeSystemCollections,
    chats: {
      scope: CHATS_PURGE_SCOPE,
      conversationIds: chatIds,
      count: chatIds.length,
      pathsTouched: [...new Set(chatPaths)],
    },
    collections: {
      scope: collectionScope,
      collectionIds,
      count: collectionIds.length,
      systemOwnedCollectionIds: systemOwnedIds,
      systemOwnedCount,
      skippedSystemOrGenerated,
      pathsTouched: allCollectionPathsForTouch,
    },
  };
}
