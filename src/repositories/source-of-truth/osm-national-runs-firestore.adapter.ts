import type { Firestore, Query } from "firebase-admin/firestore";
import type {
  OsmChunkRun,
  OsmNationalEvent,
  OsmNationalRun,
  OsmStateRun,
} from "../../contracts/entities/osm-national-entities.contract.js";
import {
  assertOsmNationalCollectionTarget,
  assertOsmNationalProgressWriteAllowed,
  assertOsmNationalWriteAllowed,
  type OsmNationalWriteGuardOptions,
} from "../../admin/openstreetmap/national/osmNationalWriteGuard.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";
import {
  isOsmNationalMemoryStoreEnabled,
  memoryGetChunkRun,
  memoryGetNationalRun,
  memoryGetStateRun,
  memoryListChunkRuns,
  memoryListEvents,
  memoryListNationalRuns,
  memoryListStateRuns,
  memoryPutChunkRun,
  memoryPutEvent,
  memoryPutNationalRun,
  memoryPutStateRun,
} from "../../admin/openstreetmap/national/osmNationalMemoryStore.js";

const COLLECTION = "openStreetMapNationalRuns";
const CHUNK_SIZE = 400;

export type OsmNationalWriteOptions = Pick<
  OsmNationalWriteGuardOptions,
  "writeTarget" | "confirmProductionWrite" | "allowProductionEnvVarName"
> & {
  operation: string;
  progressOnly?: boolean;
};

function isProgressOnlyWrite(options: OsmNationalWriteOptions): boolean {
  return options.progressOnly ?? options.writeTarget === "none";
}

/** Dev/test dry runs store progress in memory so dashboard work does not touch production Firestore. */
function shouldUseMemoryStore(options: OsmNationalWriteOptions): boolean {
  if (!isOsmNationalMemoryStoreEnabled()) return false;
  if (isProgressOnlyWrite(options)) return true;
  return !getFirestoreSourceClient();
}

function isRunInMemoryStore(runId: string): boolean {
  return isOsmNationalMemoryStoreEnabled() && memoryGetNationalRun(runId) != null;
}

function assertWriteOptions(options: OsmNationalWriteOptions, collectionName: string): void {
  const progressOnly = options.progressOnly ?? options.writeTarget === "none";
  assertOsmNationalCollectionTarget(collectionName, { progressOnly });
  if (progressOnly) {
    assertOsmNationalProgressWriteAllowed({
      writeTarget: options.writeTarget,
      operation: options.operation,
      confirmProductionWrite: options.confirmProductionWrite,
      allowProductionEnvVarName: options.allowProductionEnvVarName,
    });
    return;
  }
  assertOsmNationalWriteAllowed({
    writeTarget: options.writeTarget,
    operation: options.operation,
    confirmProductionWrite: options.confirmProductionWrite,
    allowProductionEnvVarName: options.allowProductionEnvVarName,
  });
}

function nationalRunRef(db: Firestore, runId: string) {
  return db.collection(COLLECTION).doc(runId);
}

function stateRunRef(db: Firestore, runId: string, stateCode: string) {
  return nationalRunRef(db, runId).collection("stateRuns").doc(stateCode.toUpperCase());
}

function chunkRunRef(
  db: Firestore,
  runId: string,
  stateCode: string,
  chunkId: string
) {
  return stateRunRef(db, runId, stateCode).collection("chunks").doc(chunkId);
}

function eventRef(db: Firestore, runId: string, eventId: string) {
  return nationalRunRef(db, runId).collection("events").doc(eventId);
}

export async function getOsmNationalRun(runId: string): Promise<OsmNationalRun | null> {
  if (isOsmNationalMemoryStoreEnabled()) {
    const memoryRun = memoryGetNationalRun(runId);
    if (memoryRun) return memoryRun;
  }
  const db = getFirestoreSourceClient();
  if (!db) return null;
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await nationalRunRef(db, runId).get();
  if (!snap.exists) return null;
  return snap.data() as OsmNationalRun;
}

export async function listOsmNationalRuns(limit = 20): Promise<OsmNationalRun[]> {
  const merged = new Map<string, OsmNationalRun>();
  if (isOsmNationalMemoryStoreEnabled()) {
    for (const run of memoryListNationalRuns(limit * 2)) merged.set(run.runId, run);
  }
  const db = getFirestoreSourceClient();
  if (db) {
    incrementDbOps("reads", 1);
    incrementDbOps("queries", 1);
    const snap = await db.collection(COLLECTION).orderBy("createdAt", "desc").limit(limit).get();
    incrementDbOps("reads", snap.size);
    for (const doc of snap.docs) merged.set(doc.id, doc.data() as OsmNationalRun);
  }
  return [...merged.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function writeOsmNationalRun(
  run: OsmNationalRun,
  options: OsmNationalWriteOptions
): Promise<void> {
  assertWriteOptions(options, COLLECTION);
  if (shouldUseMemoryStore(options)) {
    memoryPutNationalRun(run);
    return;
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  incrementDbOps("writes", 1);
  await nationalRunRef(db, run.runId).set(run, { merge: true });
}

export async function writeOsmStateRun(
  run: OsmStateRun,
  options: OsmNationalWriteOptions
): Promise<void> {
  assertWriteOptions(options, COLLECTION);
  if (shouldUseMemoryStore(options)) {
    memoryPutStateRun(run);
    return;
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  incrementDbOps("writes", 1);
  await stateRunRef(db, run.runId, run.stateCode).set(run, { merge: true });
}

export async function listOsmStateRuns(
  runId: string,
  limit = 60
): Promise<OsmStateRun[]> {
  if (isRunInMemoryStore(runId)) {
    return memoryListStateRuns(runId).slice(0, limit);
  }
  const db = getFirestoreSourceClient();
  if (!db) return [];
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await nationalRunRef(db, runId).collection("stateRuns").limit(limit).get();
  incrementDbOps("reads", snap.size);
  return snap.docs.map((doc) => doc.data() as OsmStateRun);
}

export async function getOsmStateRun(
  runId: string,
  stateCode: string
): Promise<OsmStateRun | null> {
  if (isOsmNationalMemoryStoreEnabled()) {
    const memoryState = memoryGetStateRun(runId, stateCode);
    if (memoryState) return memoryState;
  }
  const db = getFirestoreSourceClient();
  if (!db) return null;
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await stateRunRef(db, runId, stateCode).get();
  if (!snap.exists) return null;
  return snap.data() as OsmStateRun;
}

export async function writeOsmChunkRun(
  chunk: OsmChunkRun,
  options: OsmNationalWriteOptions
): Promise<void> {
  assertWriteOptions(options, COLLECTION);
  if (shouldUseMemoryStore(options)) {
    memoryPutChunkRun(chunk);
    return;
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  incrementDbOps("writes", 1);
  await chunkRunRef(db, chunk.runId, chunk.stateCode, chunk.chunkId).set(chunk, { merge: true });
}

export async function listOsmChunkRuns(
  runId: string,
  stateCode: string,
  input?: { limit?: number; status?: OsmChunkRun["status"] }
): Promise<OsmChunkRun[]> {
  if (isRunInMemoryStore(runId)) {
    return memoryListChunkRuns(runId, stateCode, input);
  }
  const db = getFirestoreSourceClient();
  if (!db) return [];
  const limit = input?.limit ?? 200;
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  let query: Query = stateRunRef(db, runId, stateCode).collection("chunks");
  if (input?.status) {
    query = query.where("status", "==", input.status);
  }
  const snap = await query.limit(limit).get();
  incrementDbOps("reads", snap.size);
  return snap.docs.map((doc) => doc.data() as OsmChunkRun);
}

export async function getOsmChunkRun(
  runId: string,
  stateCode: string,
  chunkId: string
): Promise<OsmChunkRun | null> {
  if (isOsmNationalMemoryStoreEnabled()) {
    const memoryChunk = memoryGetChunkRun(runId, stateCode, chunkId);
    if (memoryChunk) return memoryChunk;
  }
  const db = getFirestoreSourceClient();
  if (!db) return null;
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await chunkRunRef(db, runId, stateCode, chunkId).get();
  if (!snap.exists) return null;
  return snap.data() as OsmChunkRun;
}

export async function writeOsmNationalEvent(
  event: OsmNationalEvent,
  options: OsmNationalWriteOptions
): Promise<void> {
  assertWriteOptions(options, COLLECTION);
  if (shouldUseMemoryStore(options)) {
    memoryPutEvent(event);
    return;
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  incrementDbOps("writes", 1);
  await eventRef(db, event.runId, event.eventId).set(event, { merge: true });
}

export async function listOsmNationalEvents(
  runId: string,
  limit = 100
): Promise<OsmNationalEvent[]> {
  if (isRunInMemoryStore(runId)) {
    return memoryListEvents(runId, limit);
  }
  const db = getFirestoreSourceClient();
  if (!db) return [];
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await nationalRunRef(db, runId)
    .collection("events")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  incrementDbOps("reads", snap.size);
  return snap.docs.map((doc) => doc.data() as OsmNationalEvent);
}

export async function batchWriteOsmChunkRuns(
  chunks: OsmChunkRun[],
  options: OsmNationalWriteOptions
): Promise<number> {
  assertWriteOptions(options, COLLECTION);
  if (shouldUseMemoryStore(options)) {
    for (const chunk of chunks) memoryPutChunkRun(chunk);
    return chunks.length;
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  let written = 0;
  for (let i = 0; i < chunks.length; i += CHUNK_SIZE) {
    const slice = chunks.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const chunk of slice) {
      batch.set(chunkRunRef(db, chunk.runId, chunk.stateCode, chunk.chunkId), chunk, { merge: true });
      written += 1;
    }
    await batch.commit();
    incrementDbOps("writes", slice.length);
  }
  return written;
}

export async function osmNationalChunkedSetDocuments<T extends Record<string, unknown>>(
  collectionName: string,
  docs: T[],
  idField: keyof T,
  options: OsmNationalWriteOptions
): Promise<number> {
  assertOsmNationalCollectionTarget(collectionName);
  assertOsmNationalWriteAllowed({
    writeTarget: options.writeTarget,
    operation: options.operation,
    confirmProductionWrite: options.confirmProductionWrite,
    allowProductionEnvVarName: options.allowProductionEnvVarName,
  });
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  let written = 0;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const doc of chunk) {
      const id = String(doc[idField] ?? "").trim();
      if (!id) continue;
      batch.set(db.collection(collectionName).doc(id), doc, { merge: true });
      written += 1;
    }
    await batch.commit();
    incrementDbOps("writes", chunk.length);
  }
  return written;
}

export async function writeRouteGeometryChunk(input: {
  routeId: string;
  chunkIndex: number;
  coordinates: unknown;
  options: OsmNationalWriteOptions;
}): Promise<void> {
  assertOsmNationalWriteAllowed({
    writeTarget: input.options.writeTarget,
    operation: input.options.operation,
    confirmProductionWrite: input.options.confirmProductionWrite,
    allowProductionEnvVarName: input.options.allowProductionEnvVarName,
  });
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  incrementDbOps("writes", 1);
  await db
    .collection("unexploredRoutes")
    .doc(input.routeId)
    .collection("geometryChunks")
    .doc(String(input.chunkIndex))
    .set({ coordinates: input.coordinates }, { merge: true });
}
