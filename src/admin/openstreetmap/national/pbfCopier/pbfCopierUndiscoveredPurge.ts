import { FieldPath } from "firebase-admin/firestore";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import {
  assertOsmNationalWriteAllowed,
  type OsmNationalWriteTarget,
} from "../osmNationalWriteGuard.js";
import {
  getFirestoreAdminIdentity,
  getFirestoreSourceClient,
} from "../../../../repositories/source-of-truth/firestore-client.js";
import { incrementDbOps } from "../../../../observability/request-context.js";

/** Master switch — purge API and UI stay disabled unless this is exactly `true` at process start. */
export const PBF_PURGE_UNDISCOVERED_ENV_VAR = "OSM_PBF_COPIER_ALLOW_PURGE_UNDISCOVERED";

export const PBF_PURGE_UNDISCOVERED_CONFIRMATION =
  "DELETE_ALL_UNDISCOVERED_SPOTS_AND_ROUTES";

/** Only these top-level collections may be purged. Never `/posts` or anything else. */
export const PBF_PURGE_ALLOWED_COLLECTIONS = [
  "unexploredSpots",
  "unexploredRoutes",
  /** Map tile cache — embedded copies of spots/routes; map reads this first. */
  "unexploredTiles",
] as const;

export type PbfPurgeAllowedCollection = (typeof PBF_PURGE_ALLOWED_COLLECTIONS)[number];

/** Docs fetched per query page (not per transaction). */
const PURGE_QUERY_PAGE_SIZE = 50;
/** Max deletes per Firestore batch commit — keeps transactions under the ~10 MiB limit. */
const PURGE_DELETE_BATCH_SIZE = 10;
const ROUTE_GEOMETRY_CHUNK_PAGE = 50;
const GEOMETRY_DELETE_BATCH_SIZE = 25;

export type UndiscoveredPurgeInput = {
  writeTarget: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  confirmPurge: string;
  dryRun?: boolean;
};

export type UndiscoveredPurgeSummary = {
  dryRun: boolean;
  writeTarget: OsmNationalWriteTarget;
  spotsDeleted: number;
  routesDeleted: number;
  tilesDeleted: number;
  geometryChunksDeleted: number;
  /** Human-readable scope guarantee for operators. */
  scope: string;
  postsTouched: false;
  collectionsTouched: readonly PbfPurgeAllowedCollection[];
};

export function isPbfUndiscoveredPurgeEnabled(): boolean {
  const value = process.env[PBF_PURGE_UNDISCOVERED_ENV_VAR];
  return typeof value === "string" && value.trim() === "true";
}

export function assertPbfPurgeCollectionTarget(collectionName: string): asserts collectionName is PbfPurgeAllowedCollection {
  if (collectionName === "posts") {
    throw new Error("PBF_PURGE_POSTS_FORBIDDEN");
  }
  if (!PBF_PURGE_ALLOWED_COLLECTIONS.includes(collectionName as PbfPurgeAllowedCollection)) {
    throw new Error(`PBF_PURGE_COLLECTION_FORBIDDEN:${collectionName}`);
  }
}

export function assertPbfUndiscoveredPurgeAllowed(input: UndiscoveredPurgeInput): void {
  if (!isPbfUndiscoveredPurgeEnabled()) {
    throw new Error(
      `PBF_PURGE_DISABLED:Set ${PBF_PURGE_UNDISCOVERED_ENV_VAR}=true in backend .env and restart the server.`
    );
  }

  if (input.writeTarget === "none") {
    throw new Error("PBF_PURGE_WRITE_TARGET_REQUIRED:writeTarget must be emulator or production");
  }

  if (input.confirmPurge?.trim() !== PBF_PURGE_UNDISCOVERED_CONFIRMATION) {
    throw new Error(
      `PBF_PURGE_CONFIRMATION_REQUIRED:confirmPurge must be exactly ${PBF_PURGE_UNDISCOVERED_CONFIRMATION}`
    );
  }

  assertOsmNationalWriteAllowed({
    writeTarget: input.writeTarget,
    operation: input.dryRun ? "osm_pbf_copier.purge_undiscovered.dry_run" : "osm_pbf_copier.purge_undiscovered",
    confirmProductionWrite: input.confirmProductionWrite,
  });
}

export type UndiscoveredFirestoreCounts = {
  projectId: string;
  spots: number;
  routes: number;
  /** Spots + routes (canonical undiscovered documents). */
  total: number;
  /** Nested unexploredTiles cache — not available from aggregate count(); null when skipped. */
  tiles: number | null;
  countedAt: string;
  source: string;
};

/** Live Firestore counts for admin dashboards — same logic as purge dry-run. */
export async function getUndiscoveredFirestoreCounts(): Promise<UndiscoveredFirestoreCounts> {
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_unavailable");
  }
  const identity = getFirestoreAdminIdentity();
  const counts = await countUndiscoveredDocsFast(db);
  return {
    projectId: identity.projectId ?? "unknown",
    spots: counts.spots,
    routes: counts.routes,
    total: counts.spots + counts.routes,
    tiles: counts.tiles,
    countedAt: new Date().toISOString(),
    source:
      "Firestore aggregate count() on unexploredSpots + unexploredRoutes (tile cache nested under unexploredTiles — omitted from quick poll).",
  };
}

/** Fast counts — spots/routes via aggregate count(). Tile cache is nested under z/x/y and skipped here (too slow for polling). */
async function countUndiscoveredDocsFast(db: Firestore): Promise<{
  spots: number;
  routes: number;
  tiles: number | null;
}> {
  incrementDbOps("queries", 2);
  const [spotsSnap, routesSnap] = await Promise.all([
    db.collection("unexploredSpots").count().get(),
    db.collection("unexploredRoutes").count().get(),
  ]);
  incrementDbOps("reads", 2);
  return {
    spots: Number(spotsSnap.data().count ?? 0),
    routes: Number(routesSnap.data().count ?? 0),
    tiles: null,
  };
}

function isFirestoreTransactionTooBig(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Transaction too big");
}

async function commitDeleteRefs(db: Firestore, refs: DocumentReference[], batchSize: number): Promise<void> {
  for (let i = 0; i < refs.length; ) {
    const size = Math.min(batchSize, refs.length - i);
    const slice = refs.slice(i, i + size);
    try {
      const batch = db.batch();
      for (const ref of slice) {
        batch.delete(ref);
      }
      await batch.commit();
      incrementDbOps("writes", slice.length);
      i += slice.length;
    } catch (error) {
      if (slice.length <= 1 || !isFirestoreTransactionTooBig(error)) {
        throw error;
      }
      const smaller = Math.max(1, Math.floor(slice.length / 2));
      await commitDeleteRefs(db, slice, smaller);
      i += slice.length;
    }
  }
}

async function deleteCollectionPage(
  db: Firestore,
  collectionName: Exclude<PbfPurgeAllowedCollection, "unexploredTiles">,
  dryRun: boolean,
  deleteBatchSize = PURGE_DELETE_BATCH_SIZE
): Promise<number> {
  assertPbfPurgeCollectionTarget(collectionName);
  let deleted = 0;
  let lastId: string | null = null;

  for (;;) {
    let query = db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(PURGE_QUERY_PAGE_SIZE);
    if (lastId) query = query.startAfter(lastId);
    incrementDbOps("queries", 1);
    const snap = await query.get();
    incrementDbOps("reads", snap.size);
    if (snap.empty) break;

    if (!dryRun) {
      await commitDeleteRefs(
        db,
        snap.docs.map((doc) => doc.ref),
        deleteBatchSize
      );
    }

    deleted += snap.docs.length;
    lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.docs.length < PURGE_QUERY_PAGE_SIZE) break;
    if (!lastId) break;
  }

  return deleted;
}

async function deleteRouteGeometryChunks(
  db: Firestore,
  routeId: string,
  dryRun: boolean
): Promise<number> {
  assertPbfPurgeCollectionTarget("unexploredRoutes");
  const chunksCol = db.collection("unexploredRoutes").doc(routeId).collection("geometryChunks");
  let deleted = 0;

  for (;;) {
    incrementDbOps("queries", 1);
    const snap = await chunksCol.orderBy(FieldPath.documentId()).limit(ROUTE_GEOMETRY_CHUNK_PAGE).get();
    incrementDbOps("reads", snap.size);
    if (snap.empty) break;

    if (!dryRun) {
      await commitDeleteRefs(
        db,
        snap.docs.map((doc) => doc.ref),
        GEOMETRY_DELETE_BATCH_SIZE
      );
    }

    deleted += snap.docs.length;
    if (snap.docs.length < ROUTE_GEOMETRY_CHUNK_PAGE) break;
  }

  return deleted;
}

async function purgeUnexploredRoutes(db: Firestore, dryRun: boolean): Promise<{
  routesDeleted: number;
  geometryChunksDeleted: number;
}> {
  assertPbfPurgeCollectionTarget("unexploredRoutes");
  let routesDeleted = 0;
  let geometryChunksDeleted = 0;
  let lastId: string | null = null;

  for (;;) {
    let query = db
      .collection("unexploredRoutes")
      .orderBy(FieldPath.documentId())
      .limit(PURGE_QUERY_PAGE_SIZE);
    if (lastId) query = query.startAfter(lastId);
    incrementDbOps("queries", 1);
    const snap = await query.get();
    incrementDbOps("reads", snap.size);
    if (snap.empty) break;

    for (const doc of snap.docs) {
      geometryChunksDeleted += await deleteRouteGeometryChunks(db, doc.id, dryRun);
    }

    if (!dryRun) {
      await commitDeleteRefs(
        db,
        snap.docs.map((doc) => doc.ref),
        PURGE_DELETE_BATCH_SIZE
      );
    }

    routesDeleted += snap.docs.length;
    lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.docs.length < PURGE_QUERY_PAGE_SIZE) break;
    if (!lastId) break;
  }

  return { routesDeleted, geometryChunksDeleted };
}

/** Tile keys like `13/2437/2988` are stored as nested paths unexploredTiles/13/2437/2988 — not listable from the top-level collection query. */
async function deleteNestedFirestoreBranch(ref: DocumentReference, dryRun: boolean): Promise<number> {
  const subcols = await ref.listCollections();
  let deleted = 0;
  for (const subcol of subcols) {
    incrementDbOps("queries", 1);
    const snap = await subcol.get();
    incrementDbOps("reads", snap.size);
    for (const doc of snap.docs) {
      deleted += await deleteNestedFirestoreBranch(doc.ref, dryRun);
    }
  }
  if (!dryRun) {
    await ref.delete();
    incrementDbOps("writes", 1);
  }
  return deleted + 1;
}

async function countNestedUnexploredTileDocs(db: Firestore): Promise<number> {
  let count = 0;
  const topRefs = await db.collection("unexploredTiles").listDocuments();
  for (const ref of topRefs) {
    count += await countNestedFirestoreBranch(ref);
  }
  return count;
}

async function countNestedFirestoreBranch(ref: DocumentReference): Promise<number> {
  const subcols = await ref.listCollections();
  let count = 0;
  for (const subcol of subcols) {
    incrementDbOps("queries", 1);
    const snap = await subcol.get();
    incrementDbOps("reads", snap.size);
    for (const doc of snap.docs) {
      count += await countNestedFirestoreBranch(doc.ref);
    }
  }
  return count + 1;
}

async function purgeUnexploredTilesNested(db: Firestore, dryRun: boolean): Promise<number> {
  assertPbfPurgeCollectionTarget("unexploredTiles");
  const topRefs = await db.collection("unexploredTiles").listDocuments();
  let deleted = 0;
  for (const ref of topRefs) {
    deleted += await deleteNestedFirestoreBranch(ref, dryRun);
  }
  return deleted;
}

/**
 * Deletes every document in `unexploredSpots`, `unexploredRoutes`, and `unexploredTiles`
 * (including route `geometryChunks` subcollections). Never touches `/posts` or any other collection.
 */
export async function purgeAllUndiscoveredSpotsAndRoutes(
  input: UndiscoveredPurgeInput
): Promise<UndiscoveredPurgeSummary> {
  assertPbfUndiscoveredPurgeAllowed(input);

  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_unavailable");
  }

  const dryRun = input.dryRun === true;

  if (dryRun) {
    const counts = await countUndiscoveredDocsFast(db);
    const tilesDeleted =
      counts.tiles ?? (await countNestedUnexploredTileDocs(db));
    return {
      dryRun: true,
      writeTarget: input.writeTarget,
      spotsDeleted: counts.spots,
      routesDeleted: counts.routes,
      tilesDeleted,
      geometryChunksDeleted: 0,
      scope:
        "Count only (zero deletes). unexploredSpots + unexploredRoutes (aggregate) + nested unexploredTiles (recursive scan). " +
        "Does not touch posts, unexploredRawArtifacts, openStreetMapNationalRuns, or any other collection.",
      postsTouched: false,
      collectionsTouched: [...PBF_PURGE_ALLOWED_COLLECTIONS],
    };
  }

  const spotsDeleted = await deleteCollectionPage(db, "unexploredSpots", false);
  const routeResult = await purgeUnexploredRoutes(db, false);
  const tilesDeleted = await purgeUnexploredTilesNested(db, false);

  return {
    dryRun: false,
    writeTarget: input.writeTarget,
    spotsDeleted,
    routesDeleted: routeResult.routesDeleted,
    tilesDeleted,
    geometryChunksDeleted: routeResult.geometryChunksDeleted,
    scope:
      "Only unexploredSpots, unexploredRoutes (plus geometryChunks), and unexploredTiles map cache. " +
      "Does not touch posts, unexploredRawArtifacts, openStreetMapNationalRuns, or any other collection.",
    postsTouched: false,
    collectionsTouched: [...PBF_PURGE_ALLOWED_COLLECTIONS],
  };
}

export function pbfUndiscoveredPurgeHealthFields(): {
  purgeUndiscoveredEnabled: boolean;
  purgeUndiscoveredEnvVar: string;
  purgeUndiscoveredConfirmation: string;
  purgeAllowedCollections: readonly PbfPurgeAllowedCollection[];
  purgeForbiddenCollections: readonly ["posts"];
  purgePostsForbidden: true;
} {
  return {
    purgeUndiscoveredEnabled: isPbfUndiscoveredPurgeEnabled(),
    purgeUndiscoveredEnvVar: PBF_PURGE_UNDISCOVERED_ENV_VAR,
    purgeUndiscoveredConfirmation: PBF_PURGE_UNDISCOVERED_CONFIRMATION,
    purgeAllowedCollections: PBF_PURGE_ALLOWED_COLLECTIONS,
    purgeForbiddenCollections: ["posts"],
    purgePostsForbidden: true,
  };
}
