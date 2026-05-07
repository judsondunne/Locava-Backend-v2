#!/usr/bin/env node
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getFirestoreAdminIdentity, getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

type Args = {
  sampleSize: number;
  reportDir: string;
};

type ValidationRow = {
  postId: string;
  exists: boolean;
  restoredFromCanonicalBackup: boolean;
  restoreBackupDocId: string | null;
  hasMediaAssets: boolean;
  hasAnyImageOrVideoUrl: boolean;
  hasEngagementCounts: boolean;
  hasAuthorOrUserId: boolean;
  hasLocation: boolean;
  likesSubcollectionPresent: boolean;
  commentsSubcollectionPresent: boolean;
  likesCount: number | null;
  commentsCount: number | null;
  backupMatchFound: boolean;
};

function parseArgs(argv: string[]): Args {
  const read = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx < 0 || idx + 1 >= argv.length) return undefined;
    return String(argv[idx + 1] ?? "").trim();
  };
  const sampleSizeRaw = read("--sample-size");
  const sampleSize = sampleSizeRaw ? Number.parseInt(sampleSizeRaw, 10) : 50;
  return {
    sampleSize: Number.isFinite(sampleSize) && sampleSize > 0 ? sampleSize : 50,
    reportDir: read("--report-dir") ?? "docs/emergency-restore"
  };
}

function hasMediaAssets(data: Record<string, unknown>): boolean {
  if (data.media && Array.isArray(data.media) && data.media.length > 0) return true;
  if (data.assets && Array.isArray(data.assets) && data.assets.length > 0) return true;
  if (data.media && typeof data.media === "object") return true;
  return false;
}

function containsImageOrVideoUrl(value: unknown): boolean {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return lower.startsWith("http") && (lower.includes(".jpg") || lower.includes(".jpeg") || lower.includes(".png") || lower.includes(".webp") || lower.includes(".gif") || lower.includes(".mp4") || lower.includes(".mov") || lower.includes(".m3u8"));
  }
  if (Array.isArray(value)) return value.some(containsImageOrVideoUrl);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(containsImageOrVideoUrl);
  return false;
}

function hasEngagementCounts(data: Record<string, unknown>): boolean {
  const direct = data.engagement as Record<string, unknown> | undefined;
  if (direct && (typeof direct.likes === "number" || typeof direct.comments === "number" || typeof direct.shares === "number")) {
    return true;
  }
  return (
    typeof data.likeCount === "number" ||
    typeof data.likesCount === "number" ||
    typeof data.commentCount === "number" ||
    typeof data.commentsCount === "number"
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("Firestore source client unavailable. Ensure FIRESTORE_SOURCE_ENABLED and credentials are configured.");
  }

  const identity = getFirestoreAdminIdentity();
  const projectId = identity.projectId ?? db.app.options.projectId ?? null;
  const databaseId = "(default)";
  const knownPostIds = ["8BqoHf5RCmZAfjZA5wNm", "giZPXQl74CKwKcTxtID1", "FNM5327GjX7VOI7wUXGW"];

  const restoredSnap = await db
    .collection("posts")
    .where("schema.restoredFromCanonicalBackup", "==", true)
    .limit(args.sampleSize)
    .get();

  const rows: ValidationRow[] = [];
  for (const doc of restoredSnap.docs) {
    const postId = doc.id;
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    const restoreBackupDocId =
      data.schema && typeof data.schema === "object"
        ? ((data.schema as Record<string, unknown>).restoreBackupDocId as string | undefined) ?? null
        : null;
    const likesRef = doc.ref.collection("likes");
    const commentsRef = doc.ref.collection("comments");
    const [subcollections, likesCountAgg, commentsCountAgg, backupDoc] = await Promise.all([
      doc.ref.listCollections(),
      likesRef.count().get().catch(() => null),
      commentsRef.count().get().catch(() => null),
      restoreBackupDocId ? db.collection("postCanonicalBackups").doc(restoreBackupDocId).get() : Promise.resolve(null)
    ]);

    const subIds = subcollections.map((s) => s.id);
    rows.push({
      postId,
      exists: doc.exists,
      restoredFromCanonicalBackup: true,
      restoreBackupDocId,
      hasMediaAssets: hasMediaAssets(data),
      hasAnyImageOrVideoUrl: containsImageOrVideoUrl(data.media) || containsImageOrVideoUrl(data.assets),
      hasEngagementCounts: hasEngagementCounts(data),
      hasAuthorOrUserId: Boolean((data.author && typeof data.author === "object") || typeof data.userId === "string"),
      hasLocation: Boolean(data.location && typeof data.location === "object"),
      likesSubcollectionPresent: subIds.includes("likes"),
      commentsSubcollectionPresent: subIds.includes("comments"),
      likesCount: likesCountAgg ? likesCountAgg.data().count : null,
      commentsCount: commentsCountAgg ? commentsCountAgg.data().count : null,
      backupMatchFound: Boolean(backupDoc?.exists)
    });
  }

  const knownChecks: Record<string, { exists: boolean; meaningful: boolean }> = {};
  for (const postId of knownPostIds) {
    const snap = await db.collection("posts").doc(postId).get();
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    knownChecks[postId] = {
      exists: snap.exists,
      meaningful: Object.keys(data).length > 0
    };
  }

  const result = {
    generatedAt: new Date().toISOString(),
    projectId,
    databaseId,
    sampleSizeRequested: args.sampleSize,
    sampledRestoredDocs: rows.length,
    restoredFromCanonicalBackupCount: restoredSnap.size,
    counts: {
      validMediaAssets: rows.filter((r) => r.hasMediaAssets).length,
      validImageOrVideoUrls: rows.filter((r) => r.hasAnyImageOrVideoUrl).length,
      validEngagementCounts: rows.filter((r) => r.hasEngagementCounts).length,
      validAuthorOrUserId: rows.filter((r) => r.hasAuthorOrUserId).length,
      backupMatchesFound: rows.filter((r) => r.backupMatchFound).length
    },
    knownPostChecks: knownChecks,
    rows
  };

  const reportDirAbs = path.resolve(process.cwd(), args.reportDir);
  mkdirSync(reportDirAbs, { recursive: true });
  const jsonPath = path.join(reportDirAbs, "validation-result.json");
  const mdPath = path.join(reportDirAbs, "validation-result.md");
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const mdLines = [
    "# Emergency Restore Validation Result",
    "",
    `- Generated at: ${result.generatedAt}`,
    `- Project ID: ${String(projectId ?? "unknown")}`,
    `- Database: ${databaseId}`,
    `- Sample size requested: ${result.sampleSizeRequested}`,
    `- Sampled restored docs: ${result.sampledRestoredDocs}`,
    `- restoredFromCanonicalBackup count (sample query): ${result.restoredFromCanonicalBackupCount}`,
    `- Valid media assets: ${result.counts.validMediaAssets}/${rows.length}`,
    `- Valid image/video URLs: ${result.counts.validImageOrVideoUrls}/${rows.length}`,
    `- Valid engagement counts: ${result.counts.validEngagementCounts}/${rows.length}`,
    `- Valid author/userId: ${result.counts.validAuthorOrUserId}/${rows.length}`,
    `- Backup matches found: ${result.counts.backupMatchesFound}/${rows.length}`,
    "",
    "## Known Post Checks",
    ...Object.entries(knownChecks).map(([id, check]) => `- ${id}: exists=${check.exists}, meaningful=${check.meaningful}`),
    "",
    "## Sample Rows",
    ...rows.slice(0, 30).map(
      (r) =>
        `- ${r.postId}: media=${r.hasMediaAssets}, urls=${r.hasAnyImageOrVideoUrl}, engagement=${r.hasEngagementCounts}, likesSub=${r.likesSubcollectionPresent}, commentsSub=${r.commentsSubcollectionPresent}, likesCount=${String(r.likesCount)}, commentsCount=${String(r.commentsCount)}`
    ),
    ""
  ];
  writeFileSync(mdPath, `${mdLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output: {
          json: path.relative(process.cwd(), jsonPath),
          md: path.relative(process.cwd(), mdPath)
        }
      },
      null,
      2
    )
  );
}

await main();
