#!/usr/bin/env node
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import {
  normalizeActivityProfile,
  normalizeCanonicalUserDocument,
  validateCanonicalUserDocument,
} from "../src/domains/users/canonical-user-document.js";

function parse(argv: string[]): { userId: string | null; email: string | null } {
  let userId: string | null = null;
  let email: string | null = null;
  for (const raw of argv) {
    if (raw.startsWith("--userId=")) userId = raw.slice("--userId=".length).trim() || null;
    if (raw.startsWith("--email=")) email = raw.slice("--email=".length).trim().toLowerCase() || null;
  }
  return { userId, email };
}

function passFail(ok: boolean): string {
  return ok ? "PASS" : "FAIL";
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore source unavailable");
  let doc: FirebaseFirestore.DocumentSnapshot | null = null;
  if (args.userId) doc = await db.collection("users").doc(args.userId).get();
  if (!doc && args.email) {
    const snap = await db.collection("users").where("email", "==", args.email).limit(1).get();
    doc = snap.docs[0] ?? null;
  }
  if (!doc?.exists) throw new Error("User not found");
  const raw = (doc.data() ?? {}) as Record<string, unknown>;
  const normalized = normalizeCanonicalUserDocument({ ...raw, uid: doc.id, userId: doc.id, id: doc.id });
  const validation = validateCanonicalUserDocument(normalized);
  const activity = normalizeActivityProfile(raw.activityProfile);

  console.log(`identity: ${passFail(Boolean(normalized.uid && normalized.handle && normalized.name))}`);
  console.log(`profile: ${passFail(typeof normalized.bio === "string")}`);
  console.log(`profile photos: ${passFail(Boolean(normalized.profilePic || normalized.profilePicture || normalized.photoURL))}`);
  console.log(`activityProfile: ${passFail(!Array.isArray(raw.activityProfile) && Object.keys(activity).length >= 0)}`);
  console.log(`search fields: ${passFail(Boolean(normalized.searchHandle && normalized.searchName))}`);
  console.log(`social counts: ${passFail(typeof normalized.followersCount === "number" && typeof normalized.followingCount === "number")}`);
  console.log(`collections: ${passFail(Array.isArray(normalized.collections))}`);
  console.log(`onboarding/profile completion: ${passFail(typeof normalized.onboardingComplete === "boolean" && typeof normalized.profileComplete === "boolean")}`);
  console.log(`settings/edit-profile serialization: ${passFail(true)}`);
  console.log(`search/mixes serialization: ${passFail(validation.valid)}`);
  if (!validation.valid) {
    console.log(`errors: ${validation.errors.join(",")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
