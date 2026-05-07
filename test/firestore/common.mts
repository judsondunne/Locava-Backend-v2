import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertEmulatorOnlyDestructiveFirestoreOperation } from "../../src/safety/firestoreDestructiveGuard.js";
import { buildSeedDocs, PROJECT_ID } from "./seed-data.mts";

export { PROJECT_ID };
let firestoreConfigured = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureEmulatorEnv(): void {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.trim()) {
    throw new Error(
      "deterministic_firestore_emulator_required:Set FIRESTORE_EMULATOR_HOST by running under `npm run test:deterministic` or firebase emulators:exec"
    );
  }
}

function confirmEmulatorOnlyScript(operationName: string, targetPath: string): void {
  ensureEmulatorEnv();
  assertEmulatorOnlyDestructiveFirestoreOperation(operationName, targetPath);
  console.log(
    `EMULATOR_ONLY_SCRIPT_CONFIRMED operation=${operationName} FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST ?? ""} projectId=${process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? PROJECT_ID}`
  );
}

export function getEmulatorDb(): Firestore {
  ensureEmulatorEnv();
  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }
  const db = getFirestore();
  if (!firestoreConfigured) {
    db.settings({ ignoreUndefinedProperties: true });
    firestoreConfigured = true;
  }
  return db;
}

export async function resetFirestore(): Promise<void> {
  confirmEmulatorOnlyScript("resetFirestore", "posts");
  const host = process.env.FIRESTORE_EMULATOR_HOST!.trim();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
      method: "DELETE"
    });
    if (response.ok) {
      return;
    }
    if (response.status !== 409 || attempt === 29) {
      throw new Error(`firestore_emulator_reset_failed:${response.status}`);
    }
    await sleep(Math.min(250 * (attempt + 1), 1_000));
  }
}

export async function seedFirestore(): Promise<void> {
  confirmEmulatorOnlyScript("seedFirestore", "posts");
  const db = getEmulatorDb();
  const docs = buildSeedDocs();
  for (let index = 0; index < docs.length; index += 400) {
    const batch = db.batch();
    for (const doc of docs.slice(index, index + 400)) {
      batch.set(db.doc(doc.path), doc.data, { merge: true });
    }
    await batch.commit();
  }
}
