import 'dotenv/config'
import { FieldPath } from "firebase-admin/firestore";
import { getFirestoreAdminIdentity, getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

type ProbeResult = {
  name: string;
  ok: boolean;
  elapsedMs: number;
  detail: string;
};

const VIEWER_ID = process.env.DEBUG_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const SEARCH_QUERY = (process.env.DEBUG_SEARCH_QUERY ?? "a").toLowerCase();
const TIMEOUT_MS = Number(process.env.DEBUG_FIRESTORE_TIMEOUT_MS ?? 1_500);

console.log(JSON.stringify({
  event: 'env_debug',
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? null,
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID ?? null,
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT ?? null
}))

function nowMs(): number {
  return Date.now();
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout_after_${TIMEOUT_MS}ms`)), TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runProbe(name: string, fn: () => Promise<string>): Promise<ProbeResult> {
  const started = nowMs();
  try {
    const detail = await fn();
    return { name, ok: true, elapsedMs: nowMs() - started, detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { name, ok: false, elapsedMs: nowMs() - started, detail };
  }
}

async function main(): Promise<void> {
  const identity = getFirestoreAdminIdentity();
  console.log(
    JSON.stringify({
      event: "firestore_probe_identity",
      projectId: identity.projectId,
      credentialType: identity.credentialType,
      serviceAccountEmail: identity.serviceAccountEmail,
      credentialPath: identity.credentialPath
    })
  );

  const db = getFirestoreSourceClient();
  if (!db) {
    console.log(JSON.stringify({ event: "firestore_probe_unavailable", ok: false, reason: "firestore_source_unavailable" }));
    process.exitCode = 1;
    return;
  }

  const probes: Array<Promise<ProbeResult>> = [
    runProbe("users_doc_get", async () => {
      const doc = await withTimeout(db.collection("users").doc(VIEWER_ID).get(), "users_doc_get");
      return `exists=${doc.exists}`;
    }),
    runProbe("posts_feed_query", async () => {
      const snap = await withTimeout(
        db
          .collection("posts")
          .orderBy("time", "desc")
          .select("feedSlot", "time", "createdAtMs", "updatedAtMs", "lastUpdated")
          .limit(30)
          .get(),
        "posts_feed_query"
      );
      return `docs=${snap.docs.length}`;
    }),
    runProbe("posts_profile_grid_query", async () => {
      const snap = await withTimeout(
        db
          .collection("posts")
          .where("userId", "==", VIEWER_ID)
          .orderBy("time", "desc")
          .orderBy(FieldPath.documentId(), "desc")
          .select("time", "displayPhotoLink", "photoLink", "thumbUrl", "assets", "mediaType")
          .limit(13)
          .get(),
        "posts_profile_grid_query"
      );
      return `docs=${snap.docs.length}`;
    }),
    runProbe("users_search_query", async () => {
      const snap = await withTimeout(
        db
          .collection("users")
          .orderBy("searchHandle")
          .startAt(SEARCH_QUERY)
          .endAt(`${SEARCH_QUERY}\uf8ff`)
          .select("searchHandle", "name", "handle", "profilePic", "profilePicture", "photo")
          .limit(9)
          .get(),
        "users_search_query"
      );
      return `docs=${snap.docs.length}`;
    }),
    runProbe("following_doc_get", async () => {
      const snap = await withTimeout(
        db.collection("users").doc(VIEWER_ID).collection("following").doc(VIEWER_ID).get(),
        "following_doc_get"
      );
      return `exists=${snap.exists}`;
    })
  ];

  const results = await Promise.all(probes);
  for (const row of results) {
    console.log(JSON.stringify({ event: "firestore_probe_result", ...row }));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify({
      event: "firestore_probe_summary",
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      failedChecks: failed.map((f) => f.name)
    })
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();
