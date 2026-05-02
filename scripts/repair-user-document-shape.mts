#!/usr/bin/env node
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import {
  normalizeCanonicalUserDocument,
  normalizeActivityProfile,
} from "../src/domains/users/canonical-user-document.js";
import { mergeUserDocumentWritePayload } from "../src/repositories/source-of-truth/user-document-firestore.adapter.js";

type Args = {
  dryRun: boolean;
  apply: boolean;
  all: boolean;
  userId: string | null;
  email: string | null;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: true, apply: false, all: false, userId: null, email: null, limit: 50 };
  for (const raw of argv) {
    if (raw === "--dry-run") out.dryRun = true;
    else if (raw === "--apply") {
      out.apply = true;
      out.dryRun = false;
    } else if (raw === "--all") out.all = true;
    else if (raw.startsWith("--userId=")) out.userId = raw.slice("--userId=".length).trim() || null;
    else if (raw.startsWith("--email=")) out.email = raw.slice("--email=".length).trim().toLowerCase() || null;
    else if (raw.startsWith("--limit=")) out.limit = Math.max(1, Number.parseInt(raw.slice("--limit=".length), 10) || 50);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore source unavailable");
  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (args.userId) {
    const doc = await db.collection("users").doc(args.userId).get();
    if (doc.exists) docs = [doc as FirebaseFirestore.QueryDocumentSnapshot];
  } else if (args.email) {
    const snap = await db.collection("users").where("email", "==", args.email).limit(1).get();
    docs = snap.docs;
  } else if (args.all) {
    const snap = await db.collection("users").limit(args.limit).get();
    docs = snap.docs;
  } else {
    throw new Error("Pass --userId, --email, or --all");
  }

  for (const doc of docs) {
    const raw = (doc.data() ?? {}) as Record<string, unknown>;
    const normalized = normalizeCanonicalUserDocument({ ...raw, uid: doc.id, userId: doc.id, id: doc.id });
    const patch = mergeUserDocumentWritePayload(normalized);
    const repairedFields = Object.keys(patch).filter((k) => JSON.stringify((raw as any)[k]) !== JSON.stringify((patch as any)[k]));
    const profilePicResolved = String(
      (patch.profilePic as string) ||
        (patch.profilePicture as string) ||
        (patch.photoURL as string) ||
        (patch.photo as string) ||
        ""
    ).length > 0;
    const searchFieldsPresent = Boolean(patch.searchHandle && patch.searchName);
    const activity = normalizeActivityProfile(raw.activityProfile);
    const row = {
      userId: doc.id,
      email: String(raw.email ?? ""),
      rawActivityProfileType: Array.isArray(raw.activityProfile) ? "array" : typeof raw.activityProfile,
      normalizedActivityProfileCount: Object.keys(activity).length,
      profilePicResolved,
      searchFieldsPresent,
      settingsSerializable: true,
      searchSerializable: true,
      repairedFields,
    };
    console.log(JSON.stringify(row));
    if (args.apply && repairedFields.length > 0) {
      await db.collection("users").doc(doc.id).set(patch, { merge: true });
      console.info("USER_DOC_SHAPE_REPAIRED", { userId: doc.id, repairedFields });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
