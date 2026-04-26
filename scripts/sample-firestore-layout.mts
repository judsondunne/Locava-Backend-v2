/**
 * Phase-0 helper: sample one document per collection (field keys + types only).
 * Run from repo root with credentials, e.g.:
 *   cd "Locava Backendv2" && npx tsx scripts/sample-firestore-layout.mts
 *
 * Requires FIRESTORE_SOURCE_ENABLED !== false and Application Default Credentials
 * or FIREBASE_* service account env vars (see firestore-client.ts).
 */
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

function describeValue(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return t;
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: () => number }).toMillis === "function") {
    return "Timestamp";
  }
  if (Array.isArray(value)) return `array(len=${value.length})`;
  if (t === "object") return "object";
  return t;
}

function summarizeDoc(data: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [k, v] of Object.entries(data)) {
    out[k] = describeValue(v);
  }
  return out;
}

async function sampleCollection(name: string, limit = 1): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("Firestore client unavailable (disabled or init failed).");
    process.exitCode = 1;
    return;
  }
  const snap = await db.collection(name).limit(limit).get();
  console.log(`\n=== collection: ${name} (docs=${snap.size}) ===`);
  if (snap.empty) {
    console.log("(empty)");
    return;
  }
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    console.log(`docId: ${doc.id}`);
    console.log(JSON.stringify(summarizeDoc(data), null, 2));
  }
}

async function main(): Promise<void> {
  const collections = [
    "users",
    "posts",
    "collections",
    "chats",
    "conversations",
    "messages",
    "comments",
    "notifications",
    "achievements",
    "places",
    "regions"
  ];
  for (const c of collections) {
    try {
      await sampleCollection(c, 1);
    } catch (e) {
      console.error(`[${c}]`, e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
