import { FieldPath } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import {
  assertOsmNationalWriteAllowed,
  type OsmNationalWriteTarget,
} from "../osmNationalWriteGuard.js";
import { getFirestoreSourceClient } from "../../../../repositories/source-of-truth/firestore-client.js";
import { incrementDbOps } from "../../../../observability/request-context.js";

/** Master switch — purge API and UI stay disabled unless this is exactly `true` at process start. */
export const PBF_PURGE_UNDISCOVERED_ENV_VAR = "OSM_PBF_COPIER_ALLOW_PURGE_UNDISCOVERED";

export const PBF_PURGE_UNDISCOVERED_CONFIRMATION =
  "DELETE_ALL_UNDISCOVERED_SPOTS_AND_ROUTES";

/** Only these top-level collections may be purged. Never `/posts` or anything else. */
export const PBF_PURGE_ALLOWED_COLLECTIONS = ["unexploredSpots", "unexploredRoutes"] as const;

export type PbfPurgeAllowedCollection = (typeof PBF_PURGE_ALLOWED_COLLECTIONS)[number];

const PURGE_PAGE_SIZE = 400;
const ROUTE_GEOMETRY_CHUNK_PAGE = 400;

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

/** Fast dry-run count via Firestore aggregate (no deletes, no full collection scan). */
async function countUndiscoveredDocsFast(db: Firestore): Promise<{ spots: number; routes: number }> {
  incrementDbOps("queries", 2);
  const [spotsSnap, routesSnap] = await Promise.all([
    db.collection("unexploredSpots").count().get(),
    db.collection("unexploredRoutes").count().get(),
  ]);
  incrementDbOps("reads", 2);
  return {
    spots: Number(spotsSnap.data().count ?? 0),
    routes: Number(routesSnap.data().count ?? 0),
  };
}

async function deleteCollectionPage(
  db: Firestore,
  collectionName: PbfPurgeAllowedCollection,
  dryRun: boolean
): Promise<number> {
  assertPbfPurgeCollectionTarget(collectionName);
  let deleted = 0;
  let lastId: string | null = null;

  for (;;) {
    let query = db.collection(collectionName).orderBy(FieldPath.documentId()).limit(PURGE_PAGE_SIZE);
    if (lastId) query = query.startAfter(lastId);
    incrementDbOps("queries", 1);
    const snap = await query.get();
    incrementDbOps("reads", snap.size);
    if (snap.empty) break;

    if (!dryRun) {
      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      incrementDbOps("writes", snap.docs.length);
    }

    deleted += snap.docs.length;
    lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.docs.length < PURGE_PAGE_SIZE) break;
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
      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      incrementDbOps("writes", snap.docs.length);
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
    let query = db.collection("unexploredRoutes").orderBy(FieldPath.documentId()).limit(PURGE_PAGE_SIZE);
    if (lastId) query = query.startAfter(lastId);
    incrementDbOps("queries", 1);
    const snap = await query.get();
    incrementDbOps("reads", snap.size);
    if (snap.empty) break;

    for (const doc of snap.docs) {
      geometryChunksDeleted += await deleteRouteGeometryChunks(db, doc.id, dryRun);
    }

    if (!dryRun) {
      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      incrementDbOps("writes", snap.docs.length);
    }

    routesDeleted += snap.docs.length;
    lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.docs.length < PURGE_PAGE_SIZE) break;
    if (!lastId) break;
  }

  return { routesDeleted, geometryChunksDeleted };
}

/**
 * Deletes every document in `unexploredSpots` and `unexploredRoutes` (including route
 * `geometryChunks` subcollections). Never touches `/posts` or any other collection.
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
    return {
      dryRun: true,
      writeTarget: input.writeTarget,
      spotsDeleted: counts.spots,
      routesDeleted: counts.routes,
      geometryChunksDeleted: 0,
      scope:
        "Fast count only (Firestore aggregate queries). Zero deletes. " +
        "Only counts top-level unexploredSpots and unexploredRoutes docs — not geometryChunks. " +
        "Does not touch posts or any other collection.",
      postsTouched: false,
      collectionsTouched: [...PBF_PURGE_ALLOWED_COLLECTIONS],
    };
  }

  const spotsDeleted = await deleteCollectionPage(db, "unexploredSpots", false);
  const routeResult = await purgeUnexploredRoutes(db, false);

  return {
    dryRun: false,
    writeTarget: input.writeTarget,
    spotsDeleted,
    routesDeleted: routeResult.routesDeleted,
    geometryChunksDeleted: routeResult.geometryChunksDeleted,
    scope:
      "Only top-level unexploredSpots and unexploredRoutes documents (plus unexploredRoutes/{id}/geometryChunks). " +
      "Does not touch posts, unexploredTiles, unexploredRawArtifacts, openStreetMapNationalRuns, or any other collection.",
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
