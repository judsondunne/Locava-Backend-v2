#!/usr/bin/env node
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getFirestoreAdminIdentity, getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

type KnownPostInspection = {
  postId: string;
  postDocExists: boolean;
  postDocFieldCount: number;
  postDocMeaningful: boolean;
  subcollections: string[];
  hasLikesSubcollection: boolean;
  hasCommentsSubcollection: boolean;
  backupDocIds: string[];
  latestBackupDocId: string | null;
  latestBackupTimestampMs: number | null;
  latestBackupFieldCandidates: {
    compactLivePost: boolean;
    canonicalPreviewPostDoc: boolean;
    optimizedRaw: boolean;
  };
};

type BackupGroupSummary = {
  postId: string;
  backupCount: number;
  latestBackupDocId: string;
  latestBackupTimestampMs: number | null;
  fieldCandidates: {
    compactLivePost: boolean;
    canonicalPreviewPostDoc: boolean;
    optimizedRaw: boolean;
  };
};

function parseBackupDocId(backupDocId: string): { postId: string; timestampMs: number | null } {
  const idx = backupDocId.lastIndexOf("_");
  if (idx <= 0) return { postId: backupDocId, timestampMs: null };
  const postId = backupDocId.slice(0, idx);
  const suffix = backupDocId.slice(idx + 1);
  const timestampMs = Number.parseInt(suffix, 10);
  return { postId, timestampMs: Number.isFinite(timestampMs) ? timestampMs : null };
}

function toIsoOrNull(timestampMs: number | null): string | null {
  if (!timestampMs) return null;
  const d = new Date(timestampMs);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function hasMeaningfulDocData(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data);
  if (keys.length === 0) return false;
  const meaningfulKeys = keys.filter((k) => !["updatedAt", "lastUpdated", "__name__"].includes(k));
  return meaningfulKeys.length > 0;
}

function getBackupFieldCandidates(data: Record<string, unknown>): {
  compactLivePost: boolean;
  canonicalPreviewPostDoc: boolean;
  optimizedRaw: boolean;
} {
  const compactLivePost = typeof data.compactLivePost === "object" && data.compactLivePost !== null;
  const canonicalPreviewPostDoc =
    typeof data.canonicalPreview === "object" &&
    data.canonicalPreview !== null &&
    typeof (data.canonicalPreview as Record<string, unknown>).postDoc === "object" &&
    (data.canonicalPreview as Record<string, unknown>).postDoc !== null;
  const optimizedRaw = typeof data.optimizedRaw === "object" && data.optimizedRaw !== null;
  return { compactLivePost, canonicalPreviewPostDoc, optimizedRaw };
}

async function main(): Promise<void> {
  const knownPostIds = ["8BqoHf5RCmZAfjZA5wNm", "giZPXQl74CKwKcTxtID1", "FNM5327GjX7VOI7wUXGW"];
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("Firestore source client unavailable. Ensure FIRESTORE_SOURCE_ENABLED and credentials are configured.");
  }

  const identity = getFirestoreAdminIdentity();
  const projectId = identity.projectId ?? db.app.options.projectId ?? null;
  const databaseId = "(default)";

  const [postsSample, backupsSnapshot] = await Promise.all([
    db.collection("posts").limit(25).get(),
    db.collection("postCanonicalBackups").get()
  ]);

  const grouped = new Map<
    string,
    Array<{
      backupDocId: string;
      timestampMs: number | null;
      fieldCandidates: ReturnType<typeof getBackupFieldCandidates>;
    }>
  >();

  for (const doc of backupsSnapshot.docs) {
    const parsed = parseBackupDocId(doc.id);
    const candidates = getBackupFieldCandidates((doc.data() ?? {}) as Record<string, unknown>);
    if (!grouped.has(parsed.postId)) grouped.set(parsed.postId, []);
    grouped.get(parsed.postId)?.push({
      backupDocId: doc.id,
      timestampMs: parsed.timestampMs,
      fieldCandidates: candidates
    });
  }

  const backupGroupSummaries: BackupGroupSummary[] = [];
  for (const [postId, rows] of grouped.entries()) {
    rows.sort((a, b) => (b.timestampMs ?? -1) - (a.timestampMs ?? -1));
    const latest = rows[0];
    backupGroupSummaries.push({
      postId,
      backupCount: rows.length,
      latestBackupDocId: latest.backupDocId,
      latestBackupTimestampMs: latest.timestampMs,
      fieldCandidates: latest.fieldCandidates
    });
  }

  const knownPostInspection: KnownPostInspection[] = [];
  for (const postId of knownPostIds) {
    const postRef = db.collection("posts").doc(postId);
    const postSnap = await postRef.get();
    const postData = (postSnap.data() ?? {}) as Record<string, unknown>;
    const subcollections = (await postRef.listCollections()).map((c) => c.id).sort();

    const backupRows = (grouped.get(postId) ?? []).slice().sort((a, b) => (b.timestampMs ?? -1) - (a.timestampMs ?? -1));
    const latestBackup = backupRows[0] ?? null;

    knownPostInspection.push({
      postId,
      postDocExists: postSnap.exists,
      postDocFieldCount: Object.keys(postData).length,
      postDocMeaningful: hasMeaningfulDocData(postData),
      subcollections,
      hasLikesSubcollection: subcollections.includes("likes"),
      hasCommentsSubcollection: subcollections.includes("comments"),
      backupDocIds: backupRows.map((r) => r.backupDocId),
      latestBackupDocId: latestBackup?.backupDocId ?? null,
      latestBackupTimestampMs: latestBackup?.timestampMs ?? null,
      latestBackupFieldCandidates: latestBackup?.fieldCandidates ?? {
        compactLivePost: false,
        canonicalPreviewPostDoc: false,
        optimizedRaw: false
      }
    });
  }

  const latestBackupsSelected = backupGroupSummaries.length;
  const restoreableCount = backupGroupSummaries.filter(
    (g) => g.fieldCandidates.compactLivePost || g.fieldCandidates.canonicalPreviewPostDoc || g.fieldCandidates.optimizedRaw
  ).length;

  const result = {
    generatedAt: new Date().toISOString(),
    projectId,
    databaseId,
    counts: {
      postsSampleCount: postsSample.size,
      postCanonicalBackupsCount: backupsSnapshot.size,
      uniquePostIdsInBackups: grouped.size,
      latestBackupsSelected,
      restoreableCount
    },
    knownPostInspection,
    backupGroupsSample: backupGroupSummaries.slice(0, 100).map((row) => ({
      ...row,
      latestBackupTimestampIso: toIsoOrNull(row.latestBackupTimestampMs)
    }))
  };

  const docsDir = path.resolve(process.cwd(), "docs");
  mkdirSync(docsDir, { recursive: true });
  const jsonPath = path.join(docsDir, "emergency-backup-inspection.json");
  const mdPath = path.join(docsDir, "emergency-backup-inspection.md");
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const mdLines: string[] = [];
  mdLines.push("# Emergency Backup Inspection");
  mdLines.push("");
  mdLines.push(`- Generated at: ${result.generatedAt}`);
  mdLines.push(`- Project ID: ${String(projectId ?? "unknown")}`);
  mdLines.push(`- Database: ${databaseId}`);
  mdLines.push(`- /posts sample count (limit 25): ${result.counts.postsSampleCount}`);
  mdLines.push(`- /postCanonicalBackups count: ${result.counts.postCanonicalBackupsCount}`);
  mdLines.push(`- Unique post IDs in backups: ${result.counts.uniquePostIdsInBackups}`);
  mdLines.push(`- Latest backups selected: ${result.counts.latestBackupsSelected}`);
  mdLines.push(`- Estimated restoreable count: ${result.counts.restoreableCount}`);
  mdLines.push("");
  mdLines.push("## Known Post IDs");
  mdLines.push("");
  for (const row of knownPostInspection) {
    mdLines.push(`### ${row.postId}`);
    mdLines.push(`- /posts exists: ${row.postDocExists}`);
    mdLines.push(`- /posts field count: ${row.postDocFieldCount}`);
    mdLines.push(`- /posts meaningful: ${row.postDocMeaningful}`);
    mdLines.push(`- subcollections: ${row.subcollections.join(", ") || "(none)"}`);
    mdLines.push(`- likes subcollection present: ${row.hasLikesSubcollection}`);
    mdLines.push(`- comments subcollection present: ${row.hasCommentsSubcollection}`);
    mdLines.push(`- matching backup docs: ${row.backupDocIds.length}`);
    mdLines.push(`- latest backup doc: ${row.latestBackupDocId ?? "(none)"}`);
    mdLines.push(`- latest backup timestamp: ${toIsoOrNull(row.latestBackupTimestampMs) ?? "(unknown)"}`);
    mdLines.push(
      `- latest backup fields: compactLivePost=${row.latestBackupFieldCandidates.compactLivePost}, canonicalPreview.postDoc=${row.latestBackupFieldCandidates.canonicalPreviewPostDoc}, optimizedRaw=${row.latestBackupFieldCandidates.optimizedRaw}`
    );
    mdLines.push("");
  }
  mdLines.push("## Backup Group Sample");
  mdLines.push("");
  for (const row of result.backupGroupsSample.slice(0, 20)) {
    mdLines.push(
      `- ${row.postId}: backups=${row.backupCount}, latest=${row.latestBackupDocId}, ts=${row.latestBackupTimestampIso ?? "unknown"}, fields=[compactLivePost=${row.fieldCandidates.compactLivePost}, canonicalPreview.postDoc=${row.fieldCandidates.canonicalPreviewPostDoc}, optimizedRaw=${row.fieldCandidates.optimizedRaw}]`
    );
  }
  mdLines.push("");
  writeFileSync(mdPath, `${mdLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId,
        databaseId,
        postCanonicalBackupsCount: backupsSnapshot.size,
        uniquePostIdsInBackups: grouped.size,
        restoreableCount,
        output: {
          json: "docs/emergency-backup-inspection.json",
          md: "docs/emergency-backup-inspection.md"
        }
      },
      null,
      2
    )
  );
}

await main();
