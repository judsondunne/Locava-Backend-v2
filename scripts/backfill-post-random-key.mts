import { FieldPath } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

const PAGE_SIZE = 200;

async function main(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_source_unavailable");
  }

  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;

  while (true) {
    let query = db.collection("posts").orderBy(FieldPath.documentId(), "asc").select("randomKey").limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    let pageUpdated = 0;
    for (const doc of snap.docs) {
      scanned += 1;
      const current = doc.get("randomKey");
      if (typeof current === "number" && Number.isFinite(current)) {
        cursor = doc.id;
        continue;
      }
      batch.set(doc.ref, { randomKey: Math.random() }, { merge: true });
      updated += 1;
      pageUpdated += 1;
      cursor = doc.id;
    }
    if (pageUpdated > 0) {
      await batch.commit();
    }
    if (snap.docs.length < PAGE_SIZE) break;
  }

  console.log(JSON.stringify({ scanned, updated, field: "randomKey" }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
