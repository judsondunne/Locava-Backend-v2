import type { InventoryImportRun } from "../../contracts/entities/inventory-entities.contract.js";
import {
  assertInventoryCollectionTarget,
  assertInventoryWriteAllowed,
  type InventoryWriteGuardOptions,
} from "../../admin/inventory/inventoryWriteGuard.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";

const COLLECTION = "inventoryImportRuns";
const CHUNK_SIZE = 400;

export type InventoryWriteOptions = Pick<
  InventoryWriteGuardOptions,
  "commitTarget" | "confirmProductionWrite" | "allowProductionEnvVarName"
> & {
  operation: string;
};

export async function getInventoryImportRun(runId: string): Promise<InventoryImportRun | null> {
  const db = getFirestoreSourceClient();
  if (!db) return null;
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await db.collection(COLLECTION).doc(runId).get();
  if (!snap.exists) return null;
  return snap.data() as InventoryImportRun;
}

export async function listInventoryImportRuns(limit = 50): Promise<InventoryImportRun[]> {
  const db = getFirestoreSourceClient();
  if (!db) return [];
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await db.collection(COLLECTION).orderBy("startedAt", "desc").limit(limit).get();
  incrementDbOps("reads", snap.size);
  return snap.docs.map((doc) => doc.data() as InventoryImportRun);
}

export async function writeInventoryImportRun(
  run: InventoryImportRun,
  options: InventoryWriteOptions
): Promise<void> {
  assertInventoryCollectionTarget(COLLECTION);
  assertInventoryWriteAllowed({
    commitTarget: options.commitTarget,
    operation: options.operation,
    confirmProductionWrite: options.confirmProductionWrite,
    allowProductionEnvVarName: options.allowProductionEnvVarName,
  });
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  incrementDbOps("writes", 1);
  await db.collection(COLLECTION).doc(run.runId).set(run, { merge: true });
}

export async function chunkedSetDocuments<T extends Record<string, unknown>>(
  collectionName: string,
  docs: T[],
  idField: keyof T,
  options: InventoryWriteOptions
): Promise<number> {
  assertInventoryCollectionTarget(collectionName);
  assertInventoryWriteAllowed({
    commitTarget: options.commitTarget,
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
