import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { incrementDbOps } from "../../observability/request-context.js";
import { globalCache } from "../../cache/global-cache.js";
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
let SEEDED_COLLECTION_COUNTER = 1;
const COLLECTION_INDEX_TRUST_TTL_MS = 2 * 60_000;

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
  const data = doc.data() as Record<string, unknown>;
  const ownerId = String(data.ownerId ?? data.userId ?? "");
  const collaborators = normalizeStringArray(data.collaborators);
  const isOwner = ownerId === viewerId;
  const isCollaborator = collaborators.includes(viewerId);
  return {
    id: doc.id,
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

export class CollectionsFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();
  private static readonly INDEX_FIELD = "collectionsV2Index";
  private static readonly INDEXED_AT_FIELD = "collectionsV2IndexedAtMs";

  private useSeededCollections(): boolean {
    return process.env.NODE_ENV === "test" && this.db === null;
  }

  private collectionCacheKey(viewerId: string, collectionId: string): string {
    return `collection:${collectionId}:viewer:${viewerId}`;
  }

  private requireDb() {
    if (!this.db) throw new SourceOfTruthRequiredError("collections_firestore_unavailable");
    return this.db;
  }

  private async readViewerCollectionsIndex(viewerId: string): Promise<FirestoreCollectionRecord[] | null> {
    const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
    if (cachedUserDoc !== undefined) {
      const raw = cachedUserDoc[CollectionsFirestoreAdapter.INDEX_FIELD];
      if (Array.isArray(raw)) {
        const records = raw
          .filter((row): row is StoredCollectionIndexRecord => Boolean(row && typeof row === "object"))
          .map((row) => fromStoredCollectionIndexRecord(viewerId, row))
          .sort(sortCollectionsDesc);
        await Promise.all(
          records.map((record) => globalCache.set(this.collectionCacheKey(viewerId, record.id), record, 30_000))
        );
        return records;
      }
    }

    const db = this.requireDb();
    const snap = await db.collection("users").doc(viewerId).get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    await globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), data, 25_000);
    const raw = data[CollectionsFirestoreAdapter.INDEX_FIELD];
    if (!Array.isArray(raw)) return null;
    const records = raw
      .filter((row): row is StoredCollectionIndexRecord => Boolean(row && typeof row === "object"))
      .map((row) => fromStoredCollectionIndexRecord(viewerId, row))
      .sort(sortCollectionsDesc);
    await Promise.all(
      records.map((record) => globalCache.set(this.collectionCacheKey(viewerId, record.id), record, 30_000))
    );
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
      25_000
    );
    await Promise.all(
      records.map((record) => globalCache.set(this.collectionCacheKey(viewerId, record.id), record, 30_000))
    );
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
      await Promise.all(next.map((record) => globalCache.set(this.collectionCacheKey(viewerId, record.id), record, 30_000)));
    }
  }

  private persistViewerCollectionsIndexInBackground(viewerId: string, records: FirestoreCollectionRecord[]): void {
    void this.writeViewerCollectionsIndex(viewerId, records, { persistToFirestore: true }).catch(() => undefined);
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
        "collaboratorInfo",
        "items",
        "itemsCount",
        "displayPhotoUrl",
        "coverUri",
        "color",
        "createdAt",
        "updatedAt",
        "lastContentActivityAtMs"
      )
      .limit(Math.max(limit * 3, limit))
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
      await Promise.all(missing.map((collectionId) => globalCache.del(this.collectionCacheKey(viewerId, collectionId))));
    }
    return missing;
  }

  private normalizeViewerIds(viewerIds: string[]): string[] {
    return [...new Set(viewerIds.map((id) => id.trim()).filter(Boolean))];
  }

  private async loadViewerCollectionsIndexForMutation(viewerId: string): Promise<FirestoreCollectionRecord[]> {
    return (await this.readViewerCollectionsIndex(viewerId)) ?? (await this.queryViewerCollectionsFromFirestore(viewerId, 120));
  }

  private async upsertCollectionInViewerIndexes(
    viewerIds: string[],
    collection: FirestoreCollectionRecord
  ): Promise<void> {
    const unique = this.normalizeViewerIds(viewerIds);
    if (unique.length === 0) return;
    const stored = toStoredCollectionIndexRecord(collection);
    for (const viewerId of unique) {
      const current = await this.loadViewerCollectionsIndexForMutation(viewerId);
      const next = current.filter((row) => row.id !== collection.id);
      next.push(fromStoredCollectionIndexRecord(viewerId, stored));
      next.sort(sortCollectionsDesc);
      await this.writeViewerCollectionsIndex(viewerId, next, { persistToFirestore: false });
      this.persistViewerCollectionsIndexInBackground(viewerId, next);
    }
  }

  private async removeCollectionFromViewerIndexes(viewerIds: string[], collectionId: string): Promise<void> {
    const unique = this.normalizeViewerIds(viewerIds);
    if (unique.length === 0) return;
    for (const viewerId of unique) {
      const current = await this.loadViewerCollectionsIndexForMutation(viewerId);
      const next = current.filter((row) => row.id !== collectionId);
      await this.writeViewerCollectionsIndex(viewerId, next, { persistToFirestore: false });
      this.persistViewerCollectionsIndexInBackground(viewerId, next);
      await globalCache.del(this.collectionCacheKey(viewerId, collectionId));
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
      await globalCache.set(this.collectionCacheKey(viewerId, collectionId), indexedSaved, 30_000);
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
    await globalCache.set(this.collectionCacheKey(viewerId, collectionId), mapped, 30_000);
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
    const collaborators = Array.from(
      new Set([input.viewerId, ...(input.collaborators ?? []).map((v) => String(v).trim()).filter(Boolean)])
    );
    const items = Array.from(new Set((input.items ?? []).map((v) => String(v).trim()).filter(Boolean)));
    incrementDbOps("writes", 1);
    await ref.set({
      ownerId: input.viewerId,
      userId: input.viewerId,
      name: input.name,
      description: input.description ?? "",
      privacy: input.privacy,
      isPublic: input.privacy === "public",
      collaborators,
      items,
      itemsCount: items.length,
      displayPhotoUrl: input.coverUri ?? "",
      color: input.color ?? "",
      lastContentActivityAtMs: Date.now(),
      lastContentActivityByUserId: input.viewerId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
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
    void globalCache.set(this.collectionCacheKey(input.viewerId, ref.id), created, 30_000);
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
      const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(input.viewerId));
      const indexedAtMs =
        typeof cachedUserDoc?.[CollectionsFirestoreAdapter.INDEXED_AT_FIELD] === "number" &&
        Number.isFinite(cachedUserDoc[CollectionsFirestoreAdapter.INDEXED_AT_FIELD] as number)
          ? Math.floor(cachedUserDoc[CollectionsFirestoreAdapter.INDEXED_AT_FIELD] as number)
          : null;
      const indexedSlice = indexed.slice(0, input.limit);
      const indexStillTrusted =
        indexedAtMs != null &&
        Date.now() - indexedAtMs <= COLLECTION_INDEX_TRUST_TTL_MS;
      if (indexStillTrusted) {
        return indexedSlice;
      }
      const missingIds = await this.findMissingCollectionIds(input.viewerId, indexedSlice.map((row) => row.id));
      if (missingIds.length === 0) {
        return indexedSlice;
      }
      const refreshed = await this.refreshViewerCollectionsIndexFromSource(
        input.viewerId,
        Math.max(input.limit, indexed.length)
      );
      return refreshed.slice(0, input.limit);
    }
    const sorted = await this.refreshViewerCollectionsIndexFromSource(input.viewerId, input.limit);
    return sorted.slice(0, input.limit);
  }

  async getCollection(input: { viewerId: string; collectionId: string }): Promise<FirestoreCollectionRecord | null> {
    if (this.useSeededCollections()) {
      const record = this.ensureSeededCollectionsForViewer(input.viewerId).get(input.collectionId) ?? null;
      return record ? this.cloneCollection(record) : null;
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
        await globalCache.set(this.collectionCacheKey(input.viewerId, input.collectionId), indexedMatch, 30_000);
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
    const mapped = mapCollectionDoc(snap as QueryDocumentSnapshot, input.viewerId);
    if (!mapped.permissions.isOwner && !mapped.permissions.isCollaborator) return null;
    if (isSystemOrGeneratedCollection((snap.data() as Record<string, unknown>) ?? {})) return null;
    await globalCache.set(this.collectionCacheKey(input.viewerId, input.collectionId), mapped, 30_000);
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
    const existing = await this.getCollection({ viewerId: input.viewerId, collectionId: input.collectionId });
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
    const existing = await this.getCollection(input);
    if (!existing || !existing.permissions.isOwner) return { changed: false };
    const batch = db.batch();
    let deletedEdges = 0;
    if (existing.itemsCount > 0) {
      const postsSnap = await db.collection("collections").doc(input.collectionId).collection("posts").get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", postsSnap.docs.length);
      postsSnap.docs.forEach((doc) => batch.delete(doc.ref));
      deletedEdges = postsSnap.docs.length;
    }
    batch.delete(db.collection("collections").doc(input.collectionId));
    incrementDbOps("writes", deletedEdges + 1);
    await batch.commit();
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
    const col = await this.getCollection({ viewerId: input.viewerId, collectionId: input.collectionId });
    if (!col) throw new Error("collection_not_found");
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
    const collection = await this.getCollection({ viewerId: input.viewerId, collectionId: input.collectionId });
    if (!collection || !collection.permissions.canEdit) return { changed: false, collectionId: input.collectionId };
    const edgeRef = db.collection("collections").doc(input.collectionId).collection("posts").doc(input.postId);
    incrementDbOps("reads", 1);
    const existing = await edgeRef.get();
    if (existing.exists) return { changed: false, collectionId: input.collectionId };
    const now = Date.now();
    incrementDbOps("writes", 2);
    await Promise.all([
      edgeRef.set({
        postId: input.postId,
        addedAt: FieldValue.serverTimestamp(),
      }),
      db.collection("collections").doc(input.collectionId).update({
        items: FieldValue.arrayUnion(input.postId),
        itemsCount: FieldValue.increment(1),
        lastContentActivityAtMs: now,
        lastContentActivityByUserId: input.viewerId,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);
    const nowIso = new Date(now).toISOString();
    const updatedCollection: FirestoreCollectionRecord = {
      ...collection,
      items: collection.items.includes(input.postId) ? collection.items : [input.postId, ...collection.items],
      itemsCount: collection.items.includes(input.postId) ? collection.itemsCount : collection.itemsCount + 1,
      updatedAt: nowIso,
      lastContentActivityAtMs: now
    };
    void this.upsertCollectionInViewerIndexes(collection.collaborators, updatedCollection).catch(() => undefined);
    return { changed: true, collectionId: input.collectionId };
  }

  async removePostFromCollection(input: {
    viewerId: string;
    collectionId: string;
    postId: string;
  }): Promise<{ changed: boolean; collectionId: string }> {
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
    const collection = await this.getCollection({ viewerId: input.viewerId, collectionId: input.collectionId });
    if (!collection || !collection.permissions.canEdit) return { changed: false, collectionId: input.collectionId };
    const edgeRef = db.collection("collections").doc(input.collectionId).collection("posts").doc(input.postId);
    incrementDbOps("reads", 1);
    const existing = await edgeRef.get();
    if (!existing.exists) return { changed: false, collectionId: input.collectionId };
    const now = Date.now();
    incrementDbOps("writes", 2);
    await Promise.all([
      edgeRef.delete(),
      db.collection("collections").doc(input.collectionId).update({
        items: FieldValue.arrayRemove(input.postId),
        itemsCount: FieldValue.increment(-1),
        lastContentActivityAtMs: now,
        lastContentActivityByUserId: input.viewerId,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);
    const nowIso = new Date(now).toISOString();
    const updatedCollection: FirestoreCollectionRecord = {
      ...collection,
      items: collection.items.filter((postId) => postId !== input.postId),
      itemsCount: Math.max(0, collection.itemsCount - 1),
      updatedAt: nowIso,
      lastContentActivityAtMs: now
    };
    void this.upsertCollectionInViewerIndexes(collection.collaborators, updatedCollection).catch(() => undefined);
    return { changed: true, collectionId: input.collectionId };
  }

  async savePostToDefaultCollection(input: {
    viewerId: string;
    postId: string;
  }): Promise<{ collectionId: string; changed: boolean }> {
    if (this.useSeededCollections()) {
      const map = this.ensureSeededCollectionsForViewer(input.viewerId);
      const collectionId = `saved-${input.viewerId}`;
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
    const collectionId = `saved-${input.viewerId}`;
    const collectionRef = db.collection("collections").doc(collectionId);
    const edgeRef = collectionRef.collection("posts").doc(input.postId);
    const now = Date.now();
    const batch = db.batch();
    batch.create(edgeRef, {
      postId: input.postId,
      addedAt: FieldValue.serverTimestamp()
    });
    batch.set(
      collectionRef,
      {
        ownerId: input.viewerId,
        userId: input.viewerId,
        name: "Saved",
        description: "",
        privacy: "private",
        collaborators: [input.viewerId],
        items: FieldValue.arrayUnion(input.postId),
        itemsCount: FieldValue.increment(1),
        lastContentActivityAtMs: now,
        lastContentActivityByUserId: input.viewerId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    try {
      incrementDbOps("writes", 2);
      await batch.commit();
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        return { collectionId, changed: false };
      }
      throw error;
    }

    const cachedCollection =
      (await globalCache.get<FirestoreCollectionRecord>(this.collectionCacheKey(input.viewerId, collectionId))) ??
      this.buildDefaultSavedCollectionRecord(input.viewerId);
    const updatedCollection: FirestoreCollectionRecord = {
      ...cachedCollection,
      items: cachedCollection.items.includes(input.postId) ? cachedCollection.items : [input.postId, ...cachedCollection.items],
      itemsCount: cachedCollection.items.includes(input.postId) ? cachedCollection.itemsCount : cachedCollection.itemsCount + 1,
      updatedAt: new Date(now).toISOString(),
      lastContentActivityAtMs: now
    };
    void globalCache.set(this.collectionCacheKey(input.viewerId, collectionId), updatedCollection, 30_000);
    void this.upsertCollectionInViewerIndexes([input.viewerId], updatedCollection).catch(() => undefined);
    return { collectionId, changed: true };
  }

  async unsavePostFromDefaultCollection(input: {
    viewerId: string;
    postId: string;
  }): Promise<{ collectionId: string; changed: boolean }> {
    if (this.useSeededCollections()) {
      const map = this.ensureSeededCollectionsForViewer(input.viewerId);
      const collectionId = `saved-${input.viewerId}`;
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
    const collectionId = `saved-${input.viewerId}`;
    const db = this.requireDb();
    const collectionRef = db.collection("collections").doc(collectionId);
    const edgeRef = collectionRef.collection("posts").doc(input.postId);
    const cachedCollection =
      (await globalCache.get<FirestoreCollectionRecord>(this.collectionCacheKey(input.viewerId, collectionId))) ??
      (await this.readViewerCollectionsIndex(input.viewerId))?.find((row) => row.id === collectionId) ??
      null;
    const cachedContainsPost = Boolean(cachedCollection?.items.includes(input.postId));
    if (!cachedContainsPost) {
      incrementDbOps("reads", 1);
      const existing = await edgeRef.get();
      if (!existing.exists) return { collectionId, changed: false };
    }

    const now = Date.now();
    const batch = db.batch();
    batch.delete(edgeRef);
    batch.set(
      collectionRef,
      {
        ownerId: input.viewerId,
        userId: input.viewerId,
        name: "Saved",
        description: "",
        privacy: "private",
        collaborators: [input.viewerId],
        items: FieldValue.arrayRemove(input.postId),
        itemsCount: FieldValue.increment(-1),
        lastContentActivityAtMs: now,
        lastContentActivityByUserId: input.viewerId,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    incrementDbOps("writes", 2);
    await batch.commit();

    const nextCollection = cachedCollection ?? this.buildDefaultSavedCollectionRecord(input.viewerId);
    const updatedCollection: FirestoreCollectionRecord = {
      ...nextCollection,
      items: nextCollection.items.filter((postId) => postId !== input.postId),
      itemsCount: Math.max(0, nextCollection.itemsCount - (nextCollection.items.includes(input.postId) ? 1 : 0)),
      updatedAt: new Date(now).toISOString(),
      lastContentActivityAtMs: now
    };
    void globalCache.set(this.collectionCacheKey(input.viewerId, collectionId), updatedCollection, 30_000);
    void this.upsertCollectionInViewerIndexes([input.viewerId], updatedCollection).catch(() => undefined);
    return { collectionId, changed: true };
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
