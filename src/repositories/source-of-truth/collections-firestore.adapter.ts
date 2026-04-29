import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { incrementDbOps, recordSurfaceTimings } from "../../observability/request-context.js";
import { globalCache } from "../../cache/global-cache.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { SourceOfTruthRequiredError } from "./strict-mode.js";

export type FirestoreCollaboratorInfo = {
  id: string;
  name?: string;
  handle?: string;
  profilePic?: string | null;
};

export type FirestoreCollectionRecord = {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  privacy: "private" | "friends" | "public";
  coverUri?: string;
  color?: string;
  collaborators: string[];
  collaboratorInfo?: FirestoreCollaboratorInfo[];
  items: string[];
  itemsCount: number;
  createdAt: string;
  updatedAt: string;
  lastContentActivityAtMs?: number;
  permissions: {
    isOwner: boolean;
    isCollaborator: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canManageCollaborators: boolean;
  };
  kind: "backend";
};

export type FirestoreCollectionPostEdge = {
  postId: string;
  addedAt: string;
};

type StoredCollectionIndexRecord = Omit<FirestoreCollectionRecord, "permissions">;

type CursorPayload = { addedAt: string };
const TEST_COLLECTION_RESETS = new Set<string>();
const SEEDED_COLLECTIONS_BY_VIEWER = new Map<string, Map<string, FirestoreCollectionRecord>>();
const RECENTLY_DELETED_COLLECTION_IDS_BY_VIEWER = new Map<string, Set<string>>();
let SEEDED_COLLECTION_COUNTER = 1;
const COLLECTION_INDEX_TRUST_TTL_MS = 10 * 60_000;

function encodeCursor(input: CursorPayload): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeCursor(raw: string): CursorPayload {
  const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as CursorPayload;
  if (!parsed?.addedAt) throw new Error("invalid_cursor");
  return parsed;
}

function asIso(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function asUnixMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis: () => number }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return undefined;
}

function normalizePrivacy(value: unknown): "private" | "friends" | "public" {
  const s = String(value ?? "").toLowerCase();
  if (s === "friends") return "friends";
  if (s === "public") return "public";
  return "private";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

function normalizeHandleToken(raw: string): string {
  return raw.replace(/^@+/, "").trim().toLowerCase();
}

function looksLikeUid(token: string): boolean {
  // Firebase auth uids are typically URL-safe-ish and long; handles/emails often are short or include punctuation.
  if (!token) return false;
  if (token.includes("@")) return false;
  if (/\s/.test(token)) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(token)) return false;
  return token.length >= 16;
}

async function resolveUserIdByHandle(db: FirebaseFirestore.Firestore, rawHandle: string): Promise<string | null> {
  const normalized = normalizeHandleToken(rawHandle);
  if (!normalized) return null;
  try {
    const snap = await db.collection("users").where("searchHandle", "==", normalized).limit(1).get();
    const doc = snap.docs[0];
    return doc ? doc.id : null;
  } catch {
    return null;
  }
}

async function readCollaboratorInfo(
  db: FirebaseFirestore.Firestore,
  userIds: string[]
): Promise<FirestoreCollaboratorInfo[]> {
  const unique = [...new Set(userIds.map((v) => v.trim()).filter(Boolean))].slice(0, 50);
  if (unique.length === 0) return [];
  const refs = unique.map((id) => db.collection("users").doc(id));
  const snaps = await Promise.all(refs.map((r) => r.get()));
  const out: FirestoreCollaboratorInfo[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = (snap.data() ?? {}) as { name?: unknown; displayName?: unknown; handle?: unknown; profilePic?: unknown; profilePicture?: unknown; photo?: unknown };
    const handle = String(data.handle ?? "").replace(/^@+/, "").trim();
    const name = String(data.name ?? data.displayName ?? "").trim();
    const picCandidate = [data.profilePic, data.profilePicture, data.photo].find((v) => typeof v === "string" && v.trim());
    const profilePic = typeof picCandidate === "string" ? picCandidate.trim() : null;
    out.push({
      id: snap.id,
      ...(name ? { name } : {}),
      ...(handle ? { handle } : {}),
      profilePic
    });
  }
  return out;
}

async function normalizeCollaboratorTokens(
  db: FirebaseFirestore.Firestore,
  viewerId: string,
  tokens: string[]
): Promise<{ collaboratorIds: string[]; collaboratorInfo: FirestoreCollaboratorInfo[] }> {
  const cleaned = tokens.map((v) => String(v).trim()).filter(Boolean);
  const ids: string[] = [];
  for (const token of cleaned) {
    if (token === viewerId) {
      ids.push(viewerId);
      continue;
    }
    if (looksLikeUid(token)) {
      ids.push(token);
      continue;
    }
    // Treat as handle (with or without @) and resolve via searchHandle.
    const resolved = await resolveUserIdByHandle(db, token);
    if (resolved) ids.push(resolved);
  }
  const uniqueIds = Array.from(new Set([viewerId, ...ids].map((v) => v.trim()).filter(Boolean)));
  const collaboratorInfo = await readCollaboratorInfo(db, uniqueIds);
  return { collaboratorIds: uniqueIds, collaboratorInfo };
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: unknown; details?: unknown; message?: unknown };
  return (
    row.code === 6 ||
    row.code === "already-exists" ||
    row.code === "ALREADY_EXISTS" ||
    String(row.details ?? row.message ?? "")
      .toLowerCase()
      .includes("already exists")
  );
}

function mapCollectionDoc(doc: QueryDocumentSnapshot, viewerId: string): FirestoreCollectionRecord {
  return mapCollectionData(doc.id, doc.data() as Record<string, unknown>, viewerId);
}

function mapCollectionData(docId: string, data: Record<string, unknown>, viewerId: string): FirestoreCollectionRecord {
  const ownerId = String(data.ownerId ?? data.userId ?? "");
  const collaborators = normalizeStringArray(data.collaborators);
  const isOwner = ownerId === viewerId;
  const isCollaborator = collaborators.includes(viewerId);
  return {
    id: docId,
    ownerId,
    name: String(data.name ?? "Untitled collection"),
    description: typeof data.description === "string" ? data.description : undefined,
    privacy: normalizePrivacy(data.privacy ?? (data.isPublic ? "public" : "private")),
    coverUri:
      typeof data.coverUri === "string"
        ? data.coverUri
        : typeof data.displayPhotoUrl === "string"
          ? data.displayPhotoUrl
          : undefined,
    color: typeof data.color === "string" ? data.color : undefined,
    collaborators,
    collaboratorInfo: Array.isArray(data.collaboratorInfo)
      ? (data.collaboratorInfo as FirestoreCollaboratorInfo[])
      : undefined,
    items: normalizeStringArray(data.items),
    itemsCount: Math.max(
      0,
      Number(data.itemsCount ?? (Array.isArray(data.items) ? data.items.length : 0)) || 0
    ),
    createdAt: asIso(data.createdAt),
    updatedAt: asIso(data.updatedAt),
    lastContentActivityAtMs:
      asUnixMs(data.lastContentActivityAtMs) ?? asUnixMs(data.updatedAt) ?? undefined,
    permissions: {
      isOwner,
      isCollaborator,
      canEdit: isOwner || isCollaborator,
      canDelete: isOwner,
      canManageCollaborators: isOwner,
    },
    kind: "backend",
  };
}

function markCollectionDeleted(viewerIds: string[], collectionId: string): void {
  for (const viewerId of viewerIds.map((value) => value.trim()).filter(Boolean)) {
    const deleted = RECENTLY_DELETED_COLLECTION_IDS_BY_VIEWER.get(viewerId) ?? new Set<string>();
    deleted.add(collectionId);
    RECENTLY_DELETED_COLLECTION_IDS_BY_VIEWER.set(viewerId, deleted);
  }
}

function clearDeletedCollectionMark(viewerIds: string[], collectionId: string): void {
  for (const viewerId of viewerIds.map((value) => value.trim()).filter(Boolean)) {
    const deleted = RECENTLY_DELETED_COLLECTION_IDS_BY_VIEWER.get(viewerId);
    if (!deleted) continue;
    deleted.delete(collectionId);
    if (deleted.size === 0) {
      RECENTLY_DELETED_COLLECTION_IDS_BY_VIEWER.delete(viewerId);
    }
  }
}

function isCollectionMarkedDeleted(viewerId: string, collectionId: string): boolean {
  return RECENTLY_DELETED_COLLECTION_IDS_BY_VIEWER.get(viewerId)?.has(collectionId) ?? false;
}

function isSystemOrGeneratedCollection(data: Record<string, unknown>): boolean {
  if (data.systemManaged === true) return true;
  if (typeof data.kind === "string" && data.kind === "system_mix") return true;
  if (data.systemMix && typeof data.systemMix === "object") return true;
  if (data.generatedBy && typeof data.generatedBy === "object") return true;
  return false;
}

function sortCollectionsDesc(a: FirestoreCollectionRecord, b: FirestoreCollectionRecord): number {
  const ams = a.lastContentActivityAtMs ?? Date.parse(a.updatedAt) ?? 0;
  const bms = b.lastContentActivityAtMs ?? Date.parse(b.updatedAt) ?? 0;
  if (ams === bms) return a.id.localeCompare(b.id);
  return bms - ams;
}

function buildSeededSavedPostIdsForTests(viewerId: string): string[] {
  if (process.env.NODE_ENV !== "test" || viewerId !== "internal-viewer") return [];
  const excluded = new Set(["internal-viewer-feed-post-7", "internal-viewer-feed-post-11", "internal-viewer-feed-post-19"]);
  const out: string[] = [];
  for (let slot = 24; slot >= 1; slot -= 1) {
    const postId = `${viewerId}-feed-post-${slot}`;
    if (excluded.has(postId)) continue;
    out.push(postId);
  }
  return out;
}

function toStoredCollectionIndexRecord(record: FirestoreCollectionRecord): StoredCollectionIndexRecord {
  const { permissions: _permissions, ...stored } = record;
  return stored;
}

function fromStoredCollectionIndexRecord(viewerId: string, row: StoredCollectionIndexRecord): FirestoreCollectionRecord {
  const collaborators = normalizeStringArray(row.collaborators);
  const isOwner = row.ownerId === viewerId;
  const isCollaborator = collaborators.includes(viewerId);
  return {
    ...row,
    collaborators,
    items: normalizeStringArray(row.items),
    permissions: {
      isOwner,
      isCollaborator,
      canEdit: isOwner || isCollaborator,
      canDelete: isOwner,
      canManageCollaborators: isOwner
    }
  };
}

function queueCacheWrite<T>(key: string, value: T, ttlMs: number): void {
  void globalCache.set(key, value, ttlMs).catch(() => undefined);
}

export class CollectionsFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();
  private static readonly INDEX_FIELD = "collectionsV2Index";
  private static readonly INDEXED_AT_FIELD = "collectionsV2IndexedAtMs";
  private static readonly USER_INDEX_FIELD_MASK = [
    CollectionsFirestoreAdapter.INDEX_FIELD,
    CollectionsFirestoreAdapter.INDEXED_AT_FIELD
  ];

  private useSeededCollections(): boolean {
    return process.env.NODE_ENV === "test" && this.db === null;
  }

  private collectionCacheKey(viewerId: string, collectionId: string): string {
    return `collection:${collectionId}:viewer:${viewerId}`;
  }

  private withCollectionMutationLock<T>(viewerId: string, collectionId: string, fn: () => Promise<T>): Promise<T> {
    return withMutationLock(`collections:${viewerId}:${collectionId}`, fn);
  }

  getCollectionCacheKeyForViewer(viewerId: string, collectionId: string): string {
    return this.collectionCacheKey(viewerId, collectionId);
  }

  private requireDb() {
    if (!this.db) throw new SourceOfTruthRequiredError("collections_firestore_unavailable");
    return this.db;
  }

  private async readViewerCollectionsIndex(viewerId: string): Promise<FirestoreCollectionRecord[] | null> {
    let cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
    if (cachedUserDoc === undefined && this.db) {
      const [userSnap] = await this.db.getAll(this.db.collection("users").doc(viewerId), {
        fieldMask: [...CollectionsFirestoreAdapter.USER_INDEX_FIELD_MASK]
      });
      incrementDbOps("reads", userSnap?.exists ? 1 : 0);
      if (userSnap?.exists) {
        cachedUserDoc = (userSnap.data() as Record<string, unknown>) ?? {};
        queueCacheWrite(entityCacheKeys.userFirestoreDoc(viewerId), cachedUserDoc, 25_000);
      }
    }
    if (cachedUserDoc === undefined) {
      return null;
    }
    const raw = cachedUserDoc[CollectionsFirestoreAdapter.INDEX_FIELD];
    if (!Array.isArray(raw)) return null;
    const records = raw
      .filter((row): row is StoredCollectionIndexRecord => Boolean(row && typeof row === "object"))
      .map((row) => fromStoredCollectionIndexRecord(viewerId, row))
      .sort(sortCollectionsDesc);
    records.forEach((record) => queueCacheWrite(this.collectionCacheKey(viewerId, record.id), record, 30_000));
    return records;
  }

  private async writeViewerCollectionsIndex(
    viewerId: string,
    records: FirestoreCollectionRecord[],
    options: { persistToFirestore?: boolean } = {}
  ): Promise<void> {
    const persistToFirestore = options.persistToFirestore ?? true;
    const stored = records.map((row) => toStoredCollectionIndexRecord(row));
    const indexedAtMs = Date.now();
    if (persistToFirestore) {
      const db = this.requireDb();
      incrementDbOps("writes", 1);
      await db.collection("users").doc(viewerId).set(
        {
          [CollectionsFirestoreAdapter.INDEX_FIELD]: stored,
          [CollectionsFirestoreAdapter.INDEXED_AT_FIELD]: indexedAtMs
        },
        { merge: true }
      );
    }
    const cachedUserDoc = (await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId))) ?? {};
    await globalCache.set(
      entityCacheKeys.userFirestoreDoc(viewerId),
      {
        ...cachedUserDoc,
        [CollectionsFirestoreAdapter.INDEX_FIELD]: stored,
        [CollectionsFirestoreAdapter.INDEXED_AT_FIELD]: indexedAtMs
      },
      300_000
    );
    records.forEach((record) => queueCacheWrite(this.collectionCacheKey(viewerId, record.id), record, 30_000));
  }

  private async updateCachedViewerCollectionsIndex(
    viewerIds: string[],
    updater: (current: FirestoreCollectionRecord[]) => FirestoreCollectionRecord[]
  ): Promise<void> {
    const unique = this.normalizeViewerIds(viewerIds);
    for (const viewerId of unique) {
      const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
      if (cachedUserDoc === undefined) continue;
      const raw = cachedUserDoc[CollectionsFirestoreAdapter.INDEX_FIELD];
      if (!Array.isArray(raw)) continue;
      const current = raw
        .filter((row): row is StoredCollectionIndexRecord => Boolean(row && typeof row === "object"))
        .map((row) => fromStoredCollectionIndexRecord(viewerId, row));
      const next = updater(current).sort(sortCollectionsDesc);
      const stored = next.map((row) => toStoredCollectionIndexRecord(row));
      await globalCache.set(
        entityCacheKeys.userFirestoreDoc(viewerId),
        {
          ...cachedUserDoc,
          [CollectionsFirestoreAdapter.INDEX_FIELD]: stored,
          [CollectionsFirestoreAdapter.INDEXED_AT_FIELD]: Date.now()
        },
        25_000
      );
      next.forEach((record) => queueCacheWrite(this.collectionCacheKey(viewerId, record.id), record, 30_000));
    }
  }

  private persistViewerCollectionsIndexInBackground(viewerId: string, records: FirestoreCollectionRecord[]): void {
    scheduleBackgroundWork(async () => {
      await this.writeViewerCollectionsIndex(viewerId, records, { persistToFirestore: true });
    });
  }

  private buildDefaultSavedCollectionRecord(
    viewerId: string,
    overrides?: Partial<FirestoreCollectionRecord>
  ): FirestoreCollectionRecord {
    const nowIso = new Date().toISOString();
    return {
      id: `saved-${viewerId}`,
      ownerId: viewerId,
      name: "Saved",
      description: "",
      privacy: "private",
      collaborators: [viewerId],
      items: [],
      itemsCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastContentActivityAtMs: Date.now(),
      permissions: {
        isOwner: true,
        isCollaborator: true,
        canEdit: true,
        canDelete: true,
        canManageCollaborators: true
      },
      kind: "backend",
      ...overrides
    };
  }

  private ensureSeededCollectionsForViewer(viewerId: string): Map<string, FirestoreCollectionRecord> {
    const existing = SEEDED_COLLECTIONS_BY_VIEWER.get(viewerId);
    if (existing) return existing;
    const seededItems = buildSeededSavedPostIdsForTests(viewerId);
    const saved = this.buildDefaultSavedCollectionRecord(viewerId, {
      items: seededItems,
      itemsCount: seededItems.length,
      updatedAt: new Date().toISOString(),
      lastContentActivityAtMs: Date.now()
    });
    const map = new Map<string, FirestoreCollectionRecord>([[saved.id, saved]]);
    SEEDED_COLLECTIONS_BY_VIEWER.set(viewerId, map);
    return map;
  }

  private cloneCollection(record: FirestoreCollectionRecord): FirestoreCollectionRecord {
    return {
      ...record,
      collaborators: [...record.collaborators],
      collaboratorInfo: record.collaboratorInfo ? [...record.collaboratorInfo] : undefined,
      items: [...record.items],
      permissions: { ...record.permissions }
    };
  }

  private async queryViewerCollectionsFromFirestore(
    viewerId: string,
    limit: number
  ): Promise<FirestoreCollectionRecord[]> {
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    const collabSnap = await db
      .collection("collections")
      .where("collaborators", "array-contains", viewerId)
      .select(
        "ownerId",
        "userId",
        "name",
        "description",
        "privacy",
        "isPublic",
        "collaborators",
        "items",
        "itemsCount",
        "displayPhotoUrl",
        "coverUri",
        "color",
        "createdAt",
        "updatedAt",
        "lastContentActivityAtMs"
      )
      .limit(Math.max(1, limit))
      .get();
    incrementDbOps("reads", collabSnap.docs.length);
    const merged = new Map<string, FirestoreCollectionRecord>();
    collabSnap.docs.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      if (isSystemOrGeneratedCollection(data)) return;
      merged.set(doc.id, mapCollectionDoc(doc, viewerId));
    });
    return Array.from(merged.values()).sort(sortCollectionsDesc);
  }

  private async refreshViewerCollectionsIndexFromSource(
    viewerId: string,
    limit: number
  ): Promise<FirestoreCollectionRecord[]> {
    const sorted = await this.queryViewerCollectionsFromFirestore(viewerId, limit);
    await this.writeViewerCollectionsIndex(viewerId, sorted);
    return sorted;
  }

  private async findMissingCollectionIds(
    viewerId: string,
    collectionIds: string[]
  ): Promise<string[]> {
    if (collectionIds.length === 0) return [];
    const db = this.requireDb();
    const refs = collectionIds.map((collectionId) => db.collection("collections").doc(collectionId));
    const snaps = await db.getAll(...refs);
    incrementDbOps("reads", snaps.length);
    const missing: string[] = [];
    snaps.forEach((snap, index) => {
      if (!snap.exists) {
        const collectionId = collectionIds[index];
        if (collectionId) missing.push(collectionId);
      }
    });
    if (missing.length > 0) {
      void Promise.all(missing.map((collectionId) => globalCache.del(this.collectionCacheKey(viewerId, collectionId)))).catch(() => undefined);
    }
    return missing;
  }

  private normalizeViewerIds(viewerIds: string[]): string[] {
    return [...new Set(viewerIds.map((id) => id.trim()).filter(Boolean))];
  }

  private filterDeletedCollections(viewerId: string, collections: FirestoreCollectionRecord[]): FirestoreCollectionRecord[] {
    const deleted = RECENTLY_DELETED_COLLECTION_IDS_BY_VIEWER.get(viewerId);
    if (!deleted || deleted.size === 0) return collections;
    return collections.filter((row) => !deleted.has(row.id));
  }

  private async upsertCollectionInViewerIndexes(
    viewerIds: string[],
    collection: FirestoreCollectionRecord
  ): Promise<void> {
    const unique = this.normalizeViewerIds(viewerIds);
    if (unique.length === 0) return;
    clearDeletedCollectionMark(unique, collection.id);
    for (const viewerId of unique) {
      const viewerScopedCollection: FirestoreCollectionRecord = {
        ...collection,
        permissions: {
          isOwner: collection.ownerId === viewerId,
          isCollaborator: collection.collaborators.includes(viewerId),
          canEdit: collection.ownerId === viewerId || collection.collaborators.includes(viewerId),
          canDelete: collection.ownerId === viewerId,
          canManageCollaborators: collection.ownerId === viewerId
        }
      };
      queueCacheWrite(this.collectionCacheKey(viewerId, collection.id), viewerScopedCollection, 30_000);
      const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
      const raw = cachedUserDoc?.[CollectionsFirestoreAdapter.INDEX_FIELD];
      if (Array.isArray(raw)) {
        const next = raw
          .filter((row): row is StoredCollectionIndexRecord => Boolean(row && typeof row === "object"))
          .map((row) => fromStoredCollectionIndexRecord(viewerId, row))
          .filter((row) => row.id !== collection.id);
        next.push(viewerScopedCollection);
        next.sort(sortCollectionsDesc);
        await this.writeViewerCollectionsIndex(viewerId, next, { persistToFirestore: false });
        this.persistViewerCollectionsIndexInBackground(viewerId, next);
        continue;
      }
      scheduleBackgroundWork(async () => {
        const current = (await this.readViewerCollectionsIndex(viewerId)) ?? (await this.queryViewerCollectionsFromFirestore(viewerId, 120));
        const next = current.filter((row) => row.id !== collection.id);
        next.push(viewerScopedCollection);
        next.sort(sortCollectionsDesc);
        await this.writeViewerCollectionsIndex(viewerId, next, { persistToFirestore: true });
      });
    }
  }

  private async removeCollectionFromViewerIndexes(viewerIds: string[], collectionId: string): Promise<void> {
    const unique = this.normalizeViewerIds(viewerIds);
    if (unique.length === 0) return;
    markCollectionDeleted(unique, collectionId);
    for (const viewerId of unique) {
      const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
      const raw = cachedUserDoc?.[CollectionsFirestoreAdapter.INDEX_FIELD];
      if (Array.isArray(raw)) {
        const next = raw
          .filter((row): row is StoredCollectionIndexRecord => Boolean(row && typeof row === "object"))
          .map((row) => fromStoredCollectionIndexRecord(viewerId, row))
          .filter((row) => row.id !== collectionId);
        await this.writeViewerCollectionsIndex(viewerId, next, { persistToFirestore: false });
        this.persistViewerCollectionsIndexInBackground(viewerId, next);
      } else {
        scheduleBackgroundWork(async () => {
          const current = (await this.readViewerCollectionsIndex(viewerId)) ?? (await this.queryViewerCollectionsFromFirestore(viewerId, 120));
          const next = current.filter((row) => row.id !== collectionId);
          await this.writeViewerCollectionsIndex(viewerId, next, { persistToFirestore: true });
        });
      }
      void globalCache.del(this.collectionCacheKey(viewerId, collectionId)).catch(() => undefined);
    }
  }

  async ensureDefaultSavedCollection(viewerId: string): Promise<FirestoreCollectionRecord> {
    if (this.useSeededCollections()) {
      const seeded = this.ensureSeededCollectionsForViewer(viewerId).get(`saved-${viewerId}`)!;
      return this.cloneCollection(seeded);
    }
    const db = this.requireDb();
    const collectionId = `saved-${viewerId}`;
    const cached = await globalCache.get<FirestoreCollectionRecord>(this.collectionCacheKey(viewerId, collectionId));
    if (cached) return cached;
    const indexed = await this.readViewerCollectionsIndex(viewerId);
    const indexedSaved = indexed?.find((row) => row.id === collectionId);
    if (indexedSaved) {
      queueCacheWrite(this.collectionCacheKey(viewerId, collectionId), indexedSaved, 30_000);
      return indexedSaved;
    }
    const ref = db.collection("collections").doc(collectionId);
    const seededItems = buildSeededSavedPostIdsForTests(viewerId);
    if (seededItems.length > 0 && !TEST_COLLECTION_RESETS.has(viewerId)) {
      const edgesSnap = await ref.collection("posts").get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", edgesSnap.docs.length);
      const batch = db.batch();
      for (const doc of edgesSnap.docs) {
        batch.delete(doc.ref);
      }
      for (const [index, postId] of seededItems.entries()) {
        batch.set(ref.collection("posts").doc(postId), {
          postId,
          addedAt: new Date(Date.now() - index * 60_000).toISOString()
        });
      }
      batch.set(
        ref,
        {
          ownerId: viewerId,
          userId: viewerId,
          name: "Saved",
          description: "",
          privacy: "private",
          collaborators: [viewerId],
          items: seededItems,
          itemsCount: seededItems.length,
          lastContentActivityAtMs: Date.now(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      incrementDbOps("writes", edgesSnap.docs.length + seededItems.length + 1);
      await batch.commit();
      TEST_COLLECTION_RESETS.add(viewerId);
    }
    incrementDbOps("reads", 1);
    let snap = await ref.get();
    if (!snap.exists) {
      incrementDbOps("writes", 1);
      await ref.set({
        ownerId: viewerId,
        userId: viewerId,
        name: "Saved",
        description: "",
        privacy: "private",
        collaborators: [viewerId],
        items: seededItems,
        itemsCount: seededItems.length,
        lastContentActivityAtMs: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      snap = await ref.get();
      incrementDbOps("reads", snap.exists ? 1 : 0);
    }
    if (!snap.exists) throw new Error("default_saved_collection_unavailable");
    const mapped = mapCollectionDoc(snap as QueryDocumentSnapshot, viewerId);
    queueCacheWrite(this.collectionCacheKey(viewerId, collectionId), mapped, 30_000);
    await this.updateCachedViewerCollectionsIndex([viewerId], (current) => {
      const next = current.filter((row) => row.id !== mapped.id);
      next.push(mapped);
      return next;
    });
    void this.upsertCollectionInViewerIndexes([viewerId], mapped).catch(() => undefined);
    return mapped;
  }

  async createCollection(input: {
    viewerId: string;
    name: string;
    description?: string;
    privacy: "public" | "private";
    collaborators?: string[];
    items?: string[];
    coverUri?: string;
    color?: string;
  }): Promise<FirestoreCollectionRecord> {
    if (this.useSeededCollections()) {
      const map = this.ensureSeededCollectionsForViewer(input.viewerId);
      const id = `test-collection-${SEEDED_COLLECTION_COUNTER++}`;
      const collaborators = Array.from(
        new Set([input.viewerId, ...(input.collaborators ?? []).map((v) => String(v).trim()).filter(Boolean)])
      );
      const items = Array.from(new Set((input.items ?? []).map((v) => String(v).trim()).filter(Boolean)));
      const nowIso = new Date().toISOString();
      const created: FirestoreCollectionRecord = {
        id,
        ownerId: input.viewerId,
        name: input.name,
        description: input.description ?? "",
        privacy: input.privacy,
        coverUri: input.coverUri,
        color: input.color,
        collaborators,
        items,
        itemsCount: items.length,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastContentActivityAtMs: Date.now(),
        permissions: {
          isOwner: true,
          isCollaborator: true,
          canEdit: true,
          canDelete: true,
          canManageCollaborators: true
        },
        kind: "backend"
      };
      map.set(id, created);
      return this.cloneCollection(created);
    }
    const db = this.requireDb();
    const ref = db.collection("collections").doc();
    const { collaboratorIds: collaborators, collaboratorInfo } = await normalizeCollaboratorTokens(
      db,
      input.viewerId,
      [input.viewerId, ...(input.collaborators ?? [])]
    );
    const items = Array.from(new Set((input.items ?? []).map((v) => String(v).trim()).filter(Boolean)));
    incrementDbOps("writes", 1);
    const firestoreWriteStartedAt = performance.now();
    await ref.create({
      ownerId: input.viewerId,
      userId: input.viewerId,
      name: input.name,
      description: input.description ?? "",
      privacy: input.privacy,
      isPublic: input.privacy === "public",
      collaborators,
      collaboratorInfo,
      items,
      itemsCount: items.length,
      displayPhotoUrl: input.coverUri ?? "",
      color: input.color ?? "",
      lastContentActivityAtMs: Date.now(),
      lastContentActivityByUserId: input.viewerId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    recordSurfaceTimings({
      collections_create_firestore_set_ms: performance.now() - firestoreWriteStartedAt
    });
    const nowIso = new Date().toISOString();
    const created: FirestoreCollectionRecord = {
      id: ref.id,
      ownerId: input.viewerId,
      name: input.name,
      description: input.description ?? "",
      privacy: input.privacy,
      coverUri: input.coverUri,
      color: input.color,
      collaborators,
      collaboratorInfo,
      items,
      itemsCount: items.length,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastContentActivityAtMs: Date.now(),
      permissions: {
        isOwner: true,
        isCollaborator: true,
        canEdit: true,
        canDelete: true,
        canManageCollaborators: true,
      },
      kind: "backend",
    };
    clearDeletedCollectionMark(collaborators, ref.id);
    const cacheWriteStartedAt = performance.now();
    await globalCache.set(this.collectionCacheKey(input.viewerId, ref.id), created, 30_000);
    recordSurfaceTimings({
      collections_create_cache_set_ms: performance.now() - cacheWriteStartedAt
    });
    void this.upsertCollectionInViewerIndexes(collaborators, created).catch(() => undefined);
    return created;
  }

  async listViewerCollections(input: { viewerId: string; limit: number }): Promise<FirestoreCollectionRecord[]> {
    if (this.useSeededCollections()) {
      return [...this.ensureSeededCollectionsForViewer(input.viewerId).values()]
        .sort(sortCollectionsDesc)
        .slice(0, input.limit)
        .map((record) => this.cloneCollection(record));
    }
    const indexed = await this.readViewerCollectionsIndex(input.viewerId);
    if (indexed) {
      return this.filterDeletedCollections(input.viewerId, indexed).slice(0, input.limit);
    }
    const sorted = await this.refreshViewerCollectionsIndexFromSource(input.viewerId, input.limit);
    return this.filterDeletedCollections(input.viewerId, sorted).slice(0, input.limit);
  }

  async getCollection(input: { viewerId: string; collectionId: string }): Promise<FirestoreCollectionRecord | null> {
    if (this.useSeededCollections()) {
      const record = this.ensureSeededCollectionsForViewer(input.viewerId).get(input.collectionId) ?? null;
      return record ? this.cloneCollection(record) : null;
    }
    if (isCollectionMarkedDeleted(input.viewerId, input.collectionId)) {
      return null;
    }
    const db = this.requireDb();
    const cached = await globalCache.get<FirestoreCollectionRecord>(this.collectionCacheKey(input.viewerId, input.collectionId));
    if (cached) return cached;
    const indexed = await this.readViewerCollectionsIndex(input.viewerId);
    const indexedMatch = indexed?.find((row) => row.id === input.collectionId) ?? null;
    if (indexedMatch) {
      const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(input.viewerId));
      const rawIndexedAtMs = cachedUserDoc?.[CollectionsFirestoreAdapter.INDEXED_AT_FIELD];
      const indexedAtMs = typeof rawIndexedAtMs === "number" ? rawIndexedAtMs : null;
      if (indexedAtMs != null && Date.now() - indexedAtMs <= COLLECTION_INDEX_TRUST_TTL_MS) {
        queueCacheWrite(this.collectionCacheKey(input.viewerId, input.collectionId), indexedMatch, 30_000);
        return indexedMatch;
      }
    }
    incrementDbOps("reads", 1);
    const snap = await db.collection("collections").doc(input.collectionId).get();
    if (!snap.exists) {
      if (indexedMatch) {
        await this.removeCollectionFromViewerIndexes([input.viewerId], input.collectionId);
      }
      return null;
    }
    let mapped = mapCollectionDoc(snap as QueryDocumentSnapshot, input.viewerId);
    if (!mapped.permissions.isOwner && !mapped.permissions.isCollaborator) return null;
    if (isSystemOrGeneratedCollection((snap.data() as Record<string, unknown>) ?? {})) return null;

    // If collaborators were stored as handles (legacy clients), normalize to userIds and persist so
    // collaborator avatars/names can reliably hydrate in v2 CollectionDetail.
    try {
      const needsNormalize = mapped.collaborators.some((c) => !looksLikeUid(c) && c !== mapped.ownerId);
      const missingInfo = !mapped.collaboratorInfo || mapped.collaboratorInfo.length === 0;
      if (needsNormalize || missingInfo) {
        const normalized = await normalizeCollaboratorTokens(db, mapped.ownerId, mapped.collaborators);
        if (normalized.collaboratorIds.length > 0) {
          mapped = {
            ...mapped,
            collaborators: normalized.collaboratorIds,
            collaboratorInfo: normalized.collaboratorInfo
          };
          incrementDbOps("writes", 1);
          void db
            .collection("collections")
            .doc(input.collectionId)
            .update({
              collaborators: normalized.collaboratorIds,
              collaboratorInfo: normalized.collaboratorInfo,
              updatedAt: FieldValue.serverTimestamp()
            })
            .catch(() => undefined);
          void this.upsertCollectionInViewerIndexes(normalized.collaboratorIds, mapped).catch(() => undefined);
        }
      }
    } catch {
      // best-effort; do not fail read path
    }

    queueCacheWrite(this.collectionCacheKey(input.viewerId, input.collectionId), mapped, 30_000);
    if (
      !indexedMatch ||
      indexedMatch.updatedAt !== mapped.updatedAt ||
      indexedMatch.itemsCount !== mapped.itemsCount ||
      indexedMatch.name !== mapped.name
    ) {
      void this.upsertCollectionInViewerIndexes(mapped.collaborators, mapped).catch(() => undefined);
    }
    return mapped;
  }

  private async getCollectionForMutation(
    input: { viewerId: string; collectionId: string },
    options?: { selectFields?: string[] }
  ): Promise<FirestoreCollectionRecord | null> {
    if (this.useSeededCollections()) {
      const record = this.ensureSeededCollectionsForViewer(input.viewerId).get(input.collectionId) ?? null;
      return record ? this.cloneCollection(record) : null;
    }
    if (isCollectionMarkedDeleted(input.viewerId, input.collectionId)) {
      return null;
    }
    const cached = await globalCache.get<FirestoreCollectionRecord>(this.collectionCacheKey(input.viewerId, input.collectionId));
    if (cached && (cached.permissions.isOwner || cached.permissions.isCollaborator)) {
      return cached;
    }
    const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(input.viewerId));
    const cachedIndexRaw = cachedUserDoc?.[CollectionsFirestoreAdapter.INDEX_FIELD];
    if (Array.isArray(cachedIndexRaw)) {
      const indexedMatch =
        cachedIndexRaw
          .filter((row): row is StoredCollectionIndexRecord => Boolean(row && typeof row === "object"))
          .map((row) => fromStoredCollectionIndexRecord(input.viewerId, row))
          .find((row) => row.id === input.collectionId) ?? null;
      if (indexedMatch && (indexedMatch.permissions.isOwner || indexedMatch.permissions.isCollaborator)) {
        queueCacheWrite(this.collectionCacheKey(input.viewerId, input.collectionId), indexedMatch, 30_000);
        return indexedMatch;
      }
    }
    const db = this.requireDb();
    const ref = db.collection("collections").doc(input.collectionId);
    const snap =
      options?.selectFields && options.selectFields.length > 0
        ? (
            await db.getAll(ref, {
              fieldMask: options.selectFields
            })
          )[0] ?? null
        : await ref.get();
    incrementDbOps("reads", snap?.exists ? 1 : 0);
    if (!snap?.exists) {
      return null;
    }
    const mapped = mapCollectionData(input.collectionId, (snap.data() as Record<string, unknown>) ?? {}, input.viewerId);
    if (!mapped.permissions.isOwner && !mapped.permissions.isCollaborator) return null;
    if (isSystemOrGeneratedCollection((snap.data() as Record<string, unknown>) ?? {})) return null;
    queueCacheWrite(this.collectionCacheKey(input.viewerId, input.collectionId), mapped, 30_000);
    return mapped;
  }

  async updateCollection(input: {
    viewerId: string;
    collectionId: string;
    updates: {
      name?: string;
      description?: string;
      privacy?: "private" | "friends" | "public";
      coverUri?: string;
      color?: string;
    };
  }): Promise<{ changed: boolean; collection: FirestoreCollectionRecord | null; updatedFields: string[] }> {
    if (this.useSeededCollections()) {
      const map = this.ensureSeededCollectionsForViewer(input.viewerId);
      const existing = map.get(input.collectionId);
      if (!existing || !existing.permissions.isOwner) {
        return { changed: false, collection: null, updatedFields: [] };
      }
      const updatedFields: string[] = [];
      if (typeof input.updates.name !== "undefined") updatedFields.push("name");
      if (typeof input.updates.description !== "undefined") updatedFields.push("description");
      if (typeof input.updates.privacy !== "undefined") updatedFields.push("privacy");
      if (typeof input.updates.coverUri !== "undefined") updatedFields.push("coverUri");
      if (typeof input.updates.color !== "undefined") updatedFields.push("color");
      if (updatedFields.length === 0) {
        return { changed: false, collection: this.cloneCollection(existing), updatedFields: [] };
      }
      const next: FirestoreCollectionRecord = {
        ...existing,
        name: input.updates.name ?? existing.name,
        description: input.updates.description ?? existing.description,
        privacy: input.updates.privacy ?? existing.privacy,
        coverUri: input.updates.coverUri ?? existing.coverUri,
        color: input.updates.color ?? existing.color,
        updatedAt: new Date().toISOString()
      };
      map.set(input.collectionId, next);
      return { changed: true, collection: this.cloneCollection(next), updatedFields };
    }
    const db = this.requireDb();
    const existing = await this.getCollectionForMutation({ viewerId: input.viewerId, collectionId: input.collectionId });
    if (!existing || !existing.permissions.isOwner) {
      return { changed: false, collection: null, updatedFields: [] };
    }
    const payload: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    const updatedFields: string[] = [];
    if (typeof input.updates.name !== "undefined") {
      payload.name = input.updates.name;
      updatedFields.push("name");
    }
    if (typeof input.updates.description !== "undefined") {
      payload.description = input.updates.description;
      updatedFields.push("description");
    }
    if (typeof input.updates.privacy !== "undefined") {
      payload.privacy = input.updates.privacy;
      payload.isPublic = input.updates.privacy === "public";
      updatedFields.push("privacy");
    }
    if (typeof input.updates.coverUri !== "undefined") {
      payload.displayPhotoUrl = input.updates.coverUri;
      updatedFields.push("coverUri");
    }
    if (typeof input.updates.color !== "undefined") {
      payload.color = input.updates.color;
      updatedFields.push("color");
    }
    if (updatedFields.length === 0) {
      return { changed: false, collection: existing, updatedFields: [] };
    }
    incrementDbOps("writes", 1);
    await db.collection("collections").doc(input.collectionId).update(payload);
    const nowIso = new Date().toISOString();
    const merged: FirestoreCollectionRecord = {
      ...existing,
      name: typeof input.updates.name !== "undefined" ? input.updates.name : existing.name,
      description: typeof input.updates.description !== "undefined" ? input.updates.description : existing.description,
      privacy: typeof input.updates.privacy !== "undefined" ? input.updates.privacy : existing.privacy,
      coverUri: typeof input.updates.coverUri !== "undefined" ? input.updates.coverUri : existing.coverUri,
      color: typeof input.updates.color !== "undefined" ? input.updates.color : existing.color,
      updatedAt: nowIso,
      lastContentActivityAtMs: existing.lastContentActivityAtMs ?? Date.now()
    };
    void globalCache.set(this.collectionCacheKey(input.viewerId, input.collectionId), merged, 30_000);
    void this.upsertCollectionInViewerIndexes(existing.collaborators, merged).catch(() => undefined);
    return { changed: true, collection: merged, updatedFields };
  }

  async deleteCollection(input: {
    viewerId: string;
    collectionId: string;
  }): Promise<{ changed: boolean }> {
    if (this.useSeededCollections()) {
      const map = this.ensureSeededCollectionsForViewer(input.viewerId);
      return { changed: map.delete(input.collectionId) };
    }
    const db = this.requireDb();
    const existing = await this.getCollectionForMutation(input, {
      selectFields: ["ownerId", "userId", "collaborators"]
    });
    if (!existing || !existing.permissions.isOwner) return { changed: false };
    incrementDbOps("writes", 1);
    await db.collection("collections").doc(input.collectionId).delete();
    markCollectionDeleted(existing.collaborators, input.collectionId);
    void globalCache.del(this.collectionCacheKey(input.viewerId, input.collectionId)).catch(() => undefined);
    void this.removeCollectionFromViewerIndexes(existing.collaborators, input.collectionId).catch(() => undefined);
    return { changed: true };
  }

  async listCollectionPostIds(input: {
    viewerId: string;
    collectionId: string;
    limit: number;
    cursor: string | null;
  }): Promise<{ items: FirestoreCollectionPostEdge[]; nextCursor: string | null; hasMore: boolean }> {
    if (this.useSeededCollections()) {
      const col = await this.getCollection({ viewerId: input.viewerId, collectionId: input.collectionId });
      if (!col) throw new Error("collection_not_found");
      let offset = 0;
      if (input.cursor) {
        const decoded = decodeCursor(input.cursor);
        const foundIndex = col.items.findIndex((postId) => postId === decoded.addedAt);
        offset = foundIndex >= 0 ? foundIndex + 1 : col.items.length;
      }
      const slice = col.items.slice(offset, offset + input.limit);
      incrementDbOps("reads", slice.length);
      const hasMore = offset + slice.length < col.items.length;
      const tail = slice.at(-1);
      return {
        items: slice.map((postId) => ({ postId, addedAt: postId })),
        hasMore,
        nextCursor: hasMore && tail ? encodeCursor({ addedAt: tail }) : null
      };
    }
    const db = this.requireDb();
    let col = await this.getCollection({ viewerId: input.viewerId, collectionId: input.collectionId });
    if (!col) throw new Error("collection_not_found");
    if (col.items.length === 0 && col.itemsCount > 0) {
      incrementDbOps("reads", 1);
      const freshSnap = await db.collection("collections").doc(input.collectionId).get();
      if (freshSnap.exists) {
        const refreshed = mapCollectionDoc(freshSnap as QueryDocumentSnapshot, input.viewerId);
        if (refreshed.permissions.isOwner || refreshed.permissions.isCollaborator) {
          col = refreshed;
          queueCacheWrite(this.collectionCacheKey(input.viewerId, input.collectionId), refreshed, 30_000);
          void this.upsertCollectionInViewerIndexes(refreshed.collaborators, refreshed).catch(() => undefined);
        }
      }
    }
    if (Array.isArray(col.items) && col.items.length > 0) {
      let offset = 0;
      if (input.cursor) {
        const decoded = decodeCursor(input.cursor);
        const foundIndex = col.items.findIndex((postId) => postId === decoded.addedAt);
        offset = foundIndex >= 0 ? foundIndex + 1 : col.items.length;
      }
      const slice = col.items.slice(offset, offset + input.limit);
      const hasMore = offset + slice.length < col.items.length;
      const tail = slice.at(-1);
      return {
        items: slice.map((postId) => ({
          postId,
          addedAt: postId
        })),
        hasMore,
        nextCursor: hasMore && tail ? encodeCursor({ addedAt: tail }) : null
      };
    }
    let query = db
      .collection("collections")
      .doc(input.collectionId)
      .collection("posts")
      .orderBy("addedAt", "desc")
      .limit(input.limit + 1);
    if (input.cursor) {
      const decoded = decodeCursor(input.cursor);
      query = query.startAfter(decoded.addedAt);
    }
    incrementDbOps("queries", 1);
    const snap = await query.get();
    incrementDbOps("reads", snap.docs.length);
    const rows = snap.docs.slice(0, input.limit).map((doc) => ({
      postId: String((doc.data() as Record<string, unknown>).postId ?? doc.id),
      addedAt: asIso((doc.data() as Record<string, unknown>).addedAt),
    }));
    const hasMore = snap.docs.length > input.limit;
    const tail = rows.at(-1);
    return {
      items: rows,
      hasMore,
      nextCursor: hasMore && tail ? encodeCursor({ addedAt: tail.addedAt }) : null,
    };
  }

  async addPostToCollection(input: {
    viewerId: string;
    collectionId: string;
    postId: string;
  }): Promise<{ changed: boolean; collectionId: string }> {
    return this.withCollectionMutationLock(input.viewerId, input.collectionId, async () => {
      if (this.useSeededCollections()) {
        const map = this.ensureSeededCollectionsForViewer(input.viewerId);
        const collection = map.get(input.collectionId);
        if (!collection || !collection.permissions.canEdit) return { changed: false, collectionId: input.collectionId };
        if (collection.items.includes(input.postId)) return { changed: false, collectionId: input.collectionId };
        const next: FirestoreCollectionRecord = {
          ...collection,
          items: [input.postId, ...collection.items],
          itemsCount: collection.itemsCount + 1,
          updatedAt: new Date().toISOString(),
          lastContentActivityAtMs: Date.now()
        };
        map.set(input.collectionId, next);
        return { changed: true, collectionId: input.collectionId };
      }
      const db = this.requireDb();
      const collection = await this.getCollectionForMutation(
        { viewerId: input.viewerId, collectionId: input.collectionId },
        { selectFields: ["ownerId", "userId", "collaborators", "items", "itemsCount", "updatedAt", "lastContentActivityAtMs"] }
      );
      if (!collection || !collection.permissions.canEdit) return { changed: false, collectionId: input.collectionId };
      if (collection.items.includes(input.postId)) return { changed: false, collectionId: input.collectionId };
      const now = Date.now();
      const trustedInlineItems = collection.items.length === collection.itemsCount;
      if (trustedInlineItems) {
        incrementDbOps("writes", 1);
        await db.collection("collections").doc(input.collectionId).update({
          items: FieldValue.arrayUnion(input.postId),
          itemsCount: collection.itemsCount + 1,
          lastContentActivityAtMs: now,
          lastContentActivityByUserId: input.viewerId,
          updatedAt: FieldValue.serverTimestamp()
        });
      } else {
        const edgeRef = db.collection("collections").doc(input.collectionId).collection("posts").doc(input.postId);
        incrementDbOps("writes", 2);
        const batch = db.batch();
        batch.create(edgeRef, {
            postId: input.postId,
            addedAt: FieldValue.serverTimestamp(),
          });
        batch.update(db.collection("collections").doc(input.collectionId), {
            itemsCount: FieldValue.increment(1),
            lastContentActivityAtMs: now,
            lastContentActivityByUserId: input.viewerId,
            updatedAt: FieldValue.serverTimestamp(),
          });
        try {
          await batch.commit();
        } catch (error) {
          if (isAlreadyExistsError(error)) return { changed: false, collectionId: input.collectionId };
          throw error;
        }
      }
      const nowIso = new Date(now).toISOString();
      const updatedCollection: FirestoreCollectionRecord = {
        ...collection,
        items: collection.items.includes(input.postId) ? collection.items : [input.postId, ...collection.items],
        itemsCount: collection.items.includes(input.postId) ? collection.itemsCount : collection.itemsCount + 1,
        updatedAt: nowIso,
        lastContentActivityAtMs: now
      };
      queueCacheWrite(this.collectionCacheKey(input.viewerId, input.collectionId), updatedCollection, 30_000);
      void this.upsertCollectionInViewerIndexes(collection.collaborators, updatedCollection).catch(() => undefined);
      return { changed: true, collectionId: input.collectionId };
    });
  }

  async removePostFromCollection(input: {
    viewerId: string;
    collectionId: string;
    postId: string;
  }): Promise<{ changed: boolean; collectionId: string }> {
    return this.withCollectionMutationLock(input.viewerId, input.collectionId, async () => {
      if (this.useSeededCollections()) {
        const map = this.ensureSeededCollectionsForViewer(input.viewerId);
        const collection = map.get(input.collectionId);
        if (!collection || !collection.permissions.canEdit) return { changed: false, collectionId: input.collectionId };
        if (!collection.items.includes(input.postId)) return { changed: false, collectionId: input.collectionId };
        const nextItems = collection.items.filter((postId) => postId !== input.postId);
        const next: FirestoreCollectionRecord = {
          ...collection,
          items: nextItems,
          itemsCount: nextItems.length,
          updatedAt: new Date().toISOString(),
          lastContentActivityAtMs: Date.now()
        };
        map.set(input.collectionId, next);
        return { changed: true, collectionId: input.collectionId };
      }
      const db = this.requireDb();
      const collection = await this.getCollectionForMutation(
        { viewerId: input.viewerId, collectionId: input.collectionId },
        { selectFields: ["ownerId", "userId", "collaborators", "items", "itemsCount", "updatedAt", "lastContentActivityAtMs"] }
      );
      if (!collection || !collection.permissions.canEdit) return { changed: false, collectionId: input.collectionId };
      const trustedInlineItems = collection.items.length === collection.itemsCount;
      if (!collection.items.includes(input.postId) && !trustedInlineItems) {
        const edgeRef = db.collection("collections").doc(input.collectionId).collection("posts").doc(input.postId);
        incrementDbOps("reads", 1);
        const existing = await edgeRef.get();
        if (!existing.exists) return { changed: false, collectionId: input.collectionId };
      }
      const now = Date.now();
      if (trustedInlineItems) {
        const nextItems = collection.items.filter((postId) => postId !== input.postId);
        if (nextItems.length === collection.items.length) {
          return { changed: false, collectionId: input.collectionId };
        }
        incrementDbOps("writes", 1);
        await db.collection("collections").doc(input.collectionId).update({
          items: nextItems,
          itemsCount: nextItems.length,
          lastContentActivityAtMs: now,
          lastContentActivityByUserId: input.viewerId,
          updatedAt: FieldValue.serverTimestamp()
        });
      } else {
        const edgeRef = db.collection("collections").doc(input.collectionId).collection("posts").doc(input.postId);
        incrementDbOps("writes", 2);
        const batch = db.batch();
        batch.delete(edgeRef);
        batch.update(db.collection("collections").doc(input.collectionId), {
            itemsCount: FieldValue.increment(-1),
            lastContentActivityAtMs: now,
            lastContentActivityByUserId: input.viewerId,
            updatedAt: FieldValue.serverTimestamp(),
          });
        await batch.commit();
      }
      const nowIso = new Date(now).toISOString();
      const updatedCollection: FirestoreCollectionRecord = {
        ...collection,
        items: collection.items.filter((postId) => postId !== input.postId),
        itemsCount: Math.max(0, collection.itemsCount - 1),
        updatedAt: nowIso,
        lastContentActivityAtMs: now
      };
      queueCacheWrite(this.collectionCacheKey(input.viewerId, input.collectionId), updatedCollection, 30_000);
      void this.upsertCollectionInViewerIndexes(collection.collaborators, updatedCollection).catch(() => undefined);
      return { changed: true, collectionId: input.collectionId };
    });
  }

  async savePostToDefaultCollection(input: {
    viewerId: string;
    postId: string;
  }): Promise<{ collectionId: string; changed: boolean }> {
    const collectionId = `saved-${input.viewerId}`;
    return this.withCollectionMutationLock(input.viewerId, collectionId, async () => {
      if (this.useSeededCollections()) {
        const map = this.ensureSeededCollectionsForViewer(input.viewerId);
        const existing = map.get(collectionId) ?? this.buildDefaultSavedCollectionRecord(input.viewerId);
        if (existing.items.includes(input.postId)) return { collectionId, changed: false };
        const next: FirestoreCollectionRecord = {
          ...existing,
          items: [input.postId, ...existing.items],
          itemsCount: existing.itemsCount + 1,
          updatedAt: new Date().toISOString(),
          lastContentActivityAtMs: Date.now()
        };
        map.set(collectionId, next);
        return { collectionId, changed: true };
      }
      const db = this.requireDb();
      const collectionRef = db.collection("collections").doc(collectionId);
      const now = Date.now();
      const cachedCollection = await globalCache.get<FirestoreCollectionRecord>(this.collectionCacheKey(input.viewerId, collectionId));
      if (cachedCollection?.items.includes(input.postId)) {
        return { collectionId, changed: false };
      }
      incrementDbOps("writes", 1);
      await collectionRef.set(
        {
          ownerId: input.viewerId,
          userId: input.viewerId,
          name: "Saved",
          description: "",
          privacy: "private",
          collaborators: [input.viewerId],
          items: FieldValue.arrayUnion(input.postId),
          lastContentActivityAtMs: now,
          lastContentActivityByUserId: input.viewerId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      const baseCollection = cachedCollection ?? this.buildDefaultSavedCollectionRecord(input.viewerId);
      const updatedCollection: FirestoreCollectionRecord = {
        ...baseCollection,
        items: baseCollection.items.includes(input.postId) ? baseCollection.items : [input.postId, ...baseCollection.items],
        itemsCount: baseCollection.items.includes(input.postId) ? baseCollection.itemsCount : baseCollection.itemsCount + 1,
        updatedAt: new Date(now).toISOString(),
        lastContentActivityAtMs: now
      };
      queueCacheWrite(this.collectionCacheKey(input.viewerId, collectionId), updatedCollection, 30_000);
      void this.upsertCollectionInViewerIndexes([input.viewerId], updatedCollection).catch(() => undefined);
      return { collectionId, changed: true };
    });
  }

  async unsavePostFromDefaultCollection(input: {
    viewerId: string;
    postId: string;
  }): Promise<{ collectionId: string; changed: boolean }> {
    const collectionId = `saved-${input.viewerId}`;
    return this.withCollectionMutationLock(input.viewerId, collectionId, async () => {
      if (this.useSeededCollections()) {
        const map = this.ensureSeededCollectionsForViewer(input.viewerId);
        const existing = map.get(collectionId) ?? this.buildDefaultSavedCollectionRecord(input.viewerId);
        if (!existing.items.includes(input.postId)) return { collectionId, changed: false };
        const nextItems = existing.items.filter((postId) => postId !== input.postId);
        const next: FirestoreCollectionRecord = {
          ...existing,
          items: nextItems,
          itemsCount: nextItems.length,
          updatedAt: new Date().toISOString(),
          lastContentActivityAtMs: Date.now()
        };
        map.set(collectionId, next);
        return { collectionId, changed: true };
      }
      const db = this.requireDb();
      const collectionRef = db.collection("collections").doc(collectionId);
      const cachedCollection = await this.getCollectionForMutation(
        { viewerId: input.viewerId, collectionId },
        { selectFields: ["ownerId", "userId", "collaborators", "items", "itemsCount", "updatedAt", "lastContentActivityAtMs"] }
      );
      if (!cachedCollection) {
        return { collectionId, changed: false };
      }
      const trustedInlineItems = Boolean(
        cachedCollection && cachedCollection.items.length === cachedCollection.itemsCount
      );
      const cachedContainsPost = Boolean(cachedCollection?.items.includes(input.postId));
      if (trustedInlineItems) {
        if (!cachedContainsPost) {
          return { collectionId, changed: false };
        }
      } else if (!cachedContainsPost) {
        const edgeRef = collectionRef.collection("posts").doc(input.postId);
        incrementDbOps("reads", 1);
        const existing = await edgeRef.get();
        if (!existing.exists) return { collectionId, changed: false };
      }

      const now = Date.now();
      const nextItems = cachedCollection.items.filter((postId) => postId !== input.postId);
      incrementDbOps("writes", 1);
      await collectionRef.set(
        {
          ownerId: input.viewerId,
          userId: input.viewerId,
          name: "Saved",
          description: "",
          privacy: "private",
          collaborators: [input.viewerId],
          items: nextItems,
          itemsCount: nextItems.length,
          lastContentActivityAtMs: now,
          lastContentActivityByUserId: input.viewerId,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      const nextCollection = cachedCollection ?? this.buildDefaultSavedCollectionRecord(input.viewerId);
      const updatedCollection: FirestoreCollectionRecord = {
        ...nextCollection,
        items: nextCollection.items.filter((postId) => postId !== input.postId),
        itemsCount: Math.max(0, nextCollection.itemsCount - (nextCollection.items.includes(input.postId) ? 1 : 0)),
        updatedAt: new Date(now).toISOString(),
        lastContentActivityAtMs: now
      };
      queueCacheWrite(this.collectionCacheKey(input.viewerId, collectionId), updatedCollection, 30_000);
      void this.upsertCollectionInViewerIndexes([input.viewerId], updatedCollection).catch(() => undefined);
      return { collectionId, changed: true };
    });
  }

  async getPostSaveState(input: {
    viewerId: string;
    postId: string;
    limit?: number;
  }): Promise<{ saved: boolean; collectionIds: string[] }> {
    const collections = await this.listViewerCollections({
      viewerId: input.viewerId,
      limit: input.limit ?? 50,
    });
    const matching = collections.filter((row) => row.items.includes(input.postId)).map((row) => row.id);
    return {
      saved: matching.length > 0,
      collectionIds: matching,
    };
  }
}
