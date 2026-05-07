import { createRequire } from "node:module";
import type { App } from "firebase-admin/app";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const require = createRequire(import.meta.url);

const PATCHED_FLAG = Symbol.for("locava.readOnlyLatencyAuditGuard.patched");
const READ_ONLY_AUDIT_ENV = "READ_ONLY_LATENCY_AUDIT";

type MaybePatchable = Record<string | symbol, unknown>;

function hasPatchedFlag(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as MaybePatchable)[PATCHED_FLAG] === true);
}

function markPatched<T extends object>(value: T): T {
  (value as MaybePatchable)[PATCHED_FLAG] = true;
  return value;
}

function wrapMethod<T extends object>(proto: T, methodName: string, operationName: string): void {
  const record = proto as MaybePatchable;
  const original = record[methodName];
  if (typeof original !== "function" || hasPatchedFlag(original)) return;
  const wrapped = markPatched(function readOnlyLatencyAuditBlockedMethod(this: unknown, ...args: unknown[]) {
    void args;
    throw new Error(`read_only_latency_audit_blocked:${operationName}`);
  });
  record[methodName] = wrapped;
}

function patchFirestorePrototypes(db: Firestore): void {
  const firestoreProto = Object.getPrototypeOf(db) as MaybePatchable;
  if (!hasPatchedFlag(firestoreProto)) {
    wrapMethod(firestoreProto, "runTransaction", "firestore.runTransaction");
    wrapMethod(firestoreProto, "bulkWriter", "firestore.bulkWriter");
    markPatched(firestoreProto);
  }

  const batchProto = Object.getPrototypeOf(db.batch()) as MaybePatchable;
  if (!hasPatchedFlag(batchProto)) {
    wrapMethod(batchProto, "commit", "firestore.batch.commit");
    markPatched(batchProto);
  }

  const collectionProto = Object.getPrototypeOf(db.collection("__read_only_latency_audit__")) as MaybePatchable;
  if (!hasPatchedFlag(collectionProto)) {
    wrapMethod(collectionProto, "add", "firestore.collection.add");
    markPatched(collectionProto);
  }

  const docProto = Object.getPrototypeOf(
    db.collection("__read_only_latency_audit__").doc("__read_only_latency_audit__")
  ) as MaybePatchable;
  if (!hasPatchedFlag(docProto)) {
    wrapMethod(docProto, "set", "firestore.doc.set");
    wrapMethod(docProto, "update", "firestore.doc.update");
    wrapMethod(docProto, "create", "firestore.doc.create");
    wrapMethod(docProto, "delete", "firestore.doc.delete");
    markPatched(docProto);
  }
}

function patchFieldValueStatics(): void {
  const holder = FieldValue as unknown as MaybePatchable;
  for (const [methodName, operationName] of [
    ["increment", "firestore.FieldValue.increment"],
    ["arrayUnion", "firestore.FieldValue.arrayUnion"],
    ["arrayRemove", "firestore.FieldValue.arrayRemove"],
  ] as const) {
    const original = holder[methodName];
    if (typeof original !== "function" || hasPatchedFlag(original)) continue;
    holder[methodName] = markPatched(function readOnlyLatencyAuditBlockedFieldValue(): never {
      throw new Error(`read_only_latency_audit_blocked:${operationName}`);
    });
  }
}

function patchStoragePrototypes(app: App): void {
  try {
    const storage = getStorage(app);
    const bucketProto = Object.getPrototypeOf(storage.bucket("__read_only_latency_audit__")) as MaybePatchable;
    if (!hasPatchedFlag(bucketProto)) {
      wrapMethod(bucketProto, "upload", "storage.bucket.upload");
      wrapMethod(bucketProto, "deleteFiles", "storage.bucket.deleteFiles");
      markPatched(bucketProto);
    }
    const fileProto = Object.getPrototypeOf(
      storage.bucket("__read_only_latency_audit__").file("__read_only_latency_audit__")
    ) as MaybePatchable;
    if (!hasPatchedFlag(fileProto)) {
      wrapMethod(fileProto, "save", "storage.file.save");
      wrapMethod(fileProto, "delete", "storage.file.delete");
      markPatched(fileProto);
    }
  } catch {
    // Best-effort only; storage is not required for read-only feed audits.
  }
}

function patchCloudTasksPrototype(): void {
  try {
    const tasksMod = require("@google-cloud/tasks") as { CloudTasksClient?: { prototype?: MaybePatchable } };
    const proto = tasksMod.CloudTasksClient?.prototype;
    if (!proto || hasPatchedFlag(proto)) return;
    wrapMethod(proto as object, "createTask", "cloudtasks.createTask");
    markPatched(proto);
  } catch {
    // Optional dependency in this guard path.
  }
}

function patchBigQueryPrototype(): void {
  try {
    const bigQueryMod = require("@google-cloud/bigquery") as { BigQuery?: new (...args: unknown[]) => unknown };
    if (!bigQueryMod.BigQuery) return;
    const client = new bigQueryMod.BigQuery({ projectId: "read-only-latency-audit" }) as {
      dataset: (id: string) => { table: (name: string) => unknown };
    };
    const table = client.dataset("__read_only_latency_audit__").table("__read_only_latency_audit__");
    const proto = Object.getPrototypeOf(table) as MaybePatchable;
    if (!proto || hasPatchedFlag(proto)) return;
    wrapMethod(proto as object, "insert", "bigquery.table.insert");
    markPatched(proto);
  } catch {
    // Optional dependency in this guard path.
  }
}

function patchPubSubPrototype(): void {
  try {
    const pubSubMod = require("@google-cloud/pubsub") as { PubSub?: new (...args: unknown[]) => unknown };
    if (!pubSubMod.PubSub) return;
    const client = new pubSubMod.PubSub({ projectId: "read-only-latency-audit" }) as {
      topic: (name: string) => unknown;
    };
    const topic = client.topic("__read_only_latency_audit__");
    const proto = Object.getPrototypeOf(topic) as MaybePatchable;
    if (!proto || hasPatchedFlag(proto)) return;
    wrapMethod(proto as object, "publish", "pubsub.topic.publish");
    wrapMethod(proto as object, "publishMessage", "pubsub.topic.publishMessage");
    markPatched(proto);
  } catch {
    // PubSub is not currently installed in this workspace.
  }
}

export function isReadOnlyLatencyAuditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[READ_ONLY_AUDIT_ENV] ?? "").trim() === "1";
}

export function isReadOnlyLatencyAuditGuardActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return isReadOnlyLatencyAuditEnabled(env) && !String(env.FIRESTORE_EMULATOR_HOST ?? "").trim();
}

export function installReadOnlyLatencyAuditGuard(input: { db: Firestore; app: App }): void {
  if (!isReadOnlyLatencyAuditGuardActive()) return;
  patchFirestorePrototypes(input.db);
  patchFieldValueStatics();
  patchStoragePrototypes(input.app);
  patchCloudTasksPrototype();
  patchBigQueryPrototype();
  patchPubSubPrototype();
}
