#!/usr/bin/env node
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type DocumentData } from "firebase-admin/firestore";
import { getFirestoreAdminIdentity, getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

type RestoreSourceField = "compactLivePost" | "canonicalPreview.postDoc" | "optimizedRaw";

type Args = {
  dryRun: boolean;
  apply: boolean;
  limit: number | null;
  postId: string | null;
  backupField: "compactLivePost" | "canonicalPreview.postDoc" | "optimizedRaw";
  allowOverwrite: boolean;
  createMissingOnly: boolean;
  batchSize: number;
  reportDir: string;
  allowProject: string | null;
};

type Candidate = {
  postId: string;
  backupDocId: string;
  backupTimestampMs: number | null;
  backupData: Record<string, unknown>;
};

type Validation = {
  ok: boolean;
  reasons: string[];
};

type PlanRow = {
  postId: string;
  backupDocId: string;
  backupTimestampMs: number | null;
  selectedSourceField: RestoreSourceField | null;
  action:
    | "restore"
    | "skip_no_restore_source"
    | "skip_validation_failed"
    | "skip_existing_meaningful_doc"
    | "skip_overwrite_not_allowed";
  reason: string | null;
  parentExists: boolean;
  parentMeaningful: boolean;
  payloadFieldCount: number;
};

const REQUIRED_CONFIRMATION_VALUE = "I_UNDERSTAND_RESTORE_POSTS";
const REQUIRED_PROJECT_ID = "learn-32d72";

function parseArgs(argv: string[]): Args {
  const hasFlag = (flag: string): boolean => argv.includes(flag);
  const read = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx < 0 || idx + 1 >= argv.length) return undefined;
    return String(argv[idx + 1] ?? "").trim();
  };
  const readBool = (flag: string, fallback: boolean): boolean => {
    const raw = read(flag);
    if (raw === undefined) return fallback;
    return !["false", "0", "no"].includes(raw.toLowerCase());
  };
  const limitRaw = read("--limit");
  const limitParsed = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  const batchSizeRaw = read("--batch-size");
  const batchSizeParsed = batchSizeRaw ? Number.parseInt(batchSizeRaw, 10) : 200;
  const apply = hasFlag("--apply");
  const explicitDryRun = read("--dry-run");
  const dryRun = apply ? false : explicitDryRun === undefined ? true : readBool("--dry-run", true);
  return {
    dryRun,
    apply,
    limit: Number.isFinite(limitParsed) && (limitParsed ?? 0) > 0 ? limitParsed : null,
    postId: read("--post-id") ?? null,
    backupField: (read("--backup-field") as Args["backupField"] | undefined) ?? "compactLivePost",
    allowOverwrite: readBool("--allow-overwrite", false),
    createMissingOnly: readBool("--create-missing-only", true),
    batchSize: Number.isFinite(batchSizeParsed) && batchSizeParsed > 0 ? batchSizeParsed : 200,
    reportDir: read("--report-dir") ?? "docs/emergency-restore",
    allowProject: read("--allow-project") ?? null
  };
}

function parseBackupDocId(backupDocId: string): { postId: string; timestampMs: number | null } {
  const idx = backupDocId.lastIndexOf("_");
  if (idx <= 0) return { postId: backupDocId, timestampMs: null };
  const postId = backupDocId.slice(0, idx);
  const suffix = backupDocId.slice(idx + 1);
  const timestampMs = Number.parseInt(suffix, 10);
  return { postId, timestampMs: Number.isFinite(timestampMs) ? timestampMs : null };
}

function hasMeaningfulDocData(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data);
  if (keys.length === 0) return false;
  const meaningful = keys.filter((k) => !["updatedAt", "lastUpdated", "__name__"].includes(k));
  return meaningful.length > 0;
}

function pickRestoreSource(
  backup: Record<string, unknown>,
  preferred: Args["backupField"]
): { field: RestoreSourceField | null; payload: Record<string, unknown> | null } {
  const compactLivePost = backup.compactLivePost;
  const canonicalPreview = backup.canonicalPreview as Record<string, unknown> | undefined;
  const canonicalPostDoc = canonicalPreview?.postDoc;
  const optimizedRaw = backup.optimizedRaw;

  const options: Array<{ field: RestoreSourceField; value: unknown }> = [
    { field: preferred, value: preferred === "canonicalPreview.postDoc" ? canonicalPostDoc : backup[preferred] },
    { field: "compactLivePost", value: compactLivePost },
    { field: "canonicalPreview.postDoc", value: canonicalPostDoc },
    { field: "optimizedRaw", value: optimizedRaw }
  ];

  for (const option of options) {
    if (!option.value || typeof option.value !== "object") continue;
    return { field: option.field, payload: { ...(option.value as Record<string, unknown>) } };
  }
  return { field: null, payload: null };
}

function hasMediaLike(payload: Record<string, unknown>): boolean {
  if (Array.isArray(payload.media) && payload.media.length > 0) return true;
  if (payload.media && typeof payload.media === "object") {
    const media = payload.media as Record<string, unknown>;
    if (Array.isArray(media.assets) && media.assets.length > 0) return true;
    if (Object.keys(media).length > 0) return true;
  }
  if (Array.isArray(payload.assets) && payload.assets.length > 0) return true;
  if (payload.compatibility && typeof payload.compatibility === "object") {
    const compat = payload.compatibility as Record<string, unknown>;
    if (Array.isArray(compat.media) && compat.media.length > 0) return true;
  }
  return false;
}

function hasAuthorLike(payload: Record<string, unknown>): boolean {
  if (payload.author && typeof payload.author === "object") return true;
  if (typeof payload.userId === "string" && payload.userId.trim().length > 0) return true;
  return false;
}

function hasLifecycleLike(payload: Record<string, unknown>): boolean {
  if (payload.lifecycle && typeof payload.lifecycle === "object") return true;
  if (typeof payload.status === "string" && payload.status.trim().length > 0) return true;
  return false;
}

function hasTextLike(payload: Record<string, unknown>): boolean {
  const candidates = [payload.text, payload.caption, payload.title];
  return candidates.some((v) => typeof v === "string") || payload.text === "";
}

function normalizePayload(
  postId: string,
  payload: Record<string, unknown>,
  backupDocId: string
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  out.id = postId;
  out.postId = typeof out.postId === "string" && out.postId.trim().length > 0 ? out.postId : postId;
  const schema = typeof out.schema === "object" && out.schema !== null ? { ...(out.schema as Record<string, unknown>) } : {};
  schema.restoredFromCanonicalBackup = true;
  schema.restoredAt = new Date().toISOString();
  schema.restoreBackupDocId = backupDocId;
  out.schema = schema;
  return out;
}

function validatePayload(payload: Record<string, unknown>): Validation {
  const reasons: string[] = [];
  if (!(typeof payload.id === "string" && payload.id.trim().length > 0)) reasons.push("missing_id");
  if (!hasMediaLike(payload)) reasons.push("missing_media_like");
  if (!hasAuthorLike(payload)) reasons.push("missing_author_or_userId");
  if (!hasLifecycleLike(payload)) reasons.push("missing_lifecycle_or_status");
  if (!hasTextLike(payload)) reasons.push("missing_text_or_caption_or_title");
  if (
    !(
      (payload.classification && typeof payload.classification === "object") ||
      (typeof payload.mediaKind === "string" && payload.mediaKind.trim().length > 0)
    )
  ) {
    reasons.push("missing_classification_or_mediaKind");
  }
  return { ok: reasons.length === 0, reasons };
}

function splitBatches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function writeReports(reportDirAbs: string, name: string, payload: unknown, markdown: string): void {
  mkdirSync(reportDirAbs, { recursive: true });
  writeFileSync(path.join(reportDirAbs, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeFileSync(path.join(reportDirAbs, `${name}.md`), `${markdown}\n`, "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply) {
    throw new Error(
      "PERMANENTLY_DISABLED_PRODUCTION_SAFETY: emergency restore apply is disabled. Use dry-run analysis only."
    );
  }
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("Firestore source client unavailable. Ensure FIRESTORE_SOURCE_ENABLED and credentials are configured.");
  }
  const identity = getFirestoreAdminIdentity();
  const projectId = identity.projectId ?? db.app.options.projectId ?? null;
  const databaseId = "(default)";

  if (projectId !== REQUIRED_PROJECT_ID && args.allowProject !== projectId) {
    throw new Error(
      `Refusing to proceed: projectId=${String(projectId)} does not match required ${REQUIRED_PROJECT_ID}. Pass --allow-project ${String(projectId)} to bypass intentionally.`
    );
  }

  const backupSnapshot = await db.collection("postCanonicalBackups").get();
  if (backupSnapshot.empty) {
    throw new Error("Refusing to proceed: /postCanonicalBackups has 0 docs.");
  }

  const byPostId = new Map<string, Candidate[]>();
  for (const doc of backupSnapshot.docs) {
    const parsed = parseBackupDocId(doc.id);
    if (args.postId && parsed.postId !== args.postId) continue;
    if (!byPostId.has(parsed.postId)) byPostId.set(parsed.postId, []);
    byPostId.get(parsed.postId)?.push({
      postId: parsed.postId,
      backupDocId: doc.id,
      backupTimestampMs: parsed.timestampMs,
      backupData: (doc.data() ?? {}) as Record<string, unknown>
    });
  }

  const selectedLatest: Candidate[] = [];
  for (const row of byPostId.values()) {
    row.sort((a, b) => (b.backupTimestampMs ?? -1) - (a.backupTimestampMs ?? -1));
    selectedLatest.push(row[0]);
  }
  selectedLatest.sort((a, b) => (b.backupTimestampMs ?? -1) - (a.backupTimestampMs ?? -1));
  const limited = args.limit ? selectedLatest.slice(0, args.limit) : selectedLatest;

  const compactLivePostLatestCount = limited.filter(
    (c) => c.backupData.compactLivePost && typeof c.backupData.compactLivePost === "object"
  ).length;
  const compactCoverageRatio = limited.length > 0 ? compactLivePostLatestCount / limited.length : 0;
  if (limited.length >= 10 && compactCoverageRatio < 0.5) {
    throw new Error(
      `Refusing to proceed: compactLivePost present for only ${compactLivePostLatestCount}/${limited.length} latest backups (<50%).`
    );
  }

  const planRows: PlanRow[] = [];
  const toWrite: Array<{ postId: string; payload: DocumentData }> = [];
  const validationErrors: Array<{ postId: string; backupDocId: string; reasons: string[] }> = [];
  let missingOrEmptyParentCount = 0;
  let existingFullDocsCount = 0;

  for (const candidate of limited) {
    const picked = pickRestoreSource(candidate.backupData, args.backupField);
    if (!picked.payload || !picked.field) {
      planRows.push({
        postId: candidate.postId,
        backupDocId: candidate.backupDocId,
        backupTimestampMs: candidate.backupTimestampMs,
        selectedSourceField: null,
        action: "skip_no_restore_source",
        reason: "No restoreable source field found.",
        parentExists: false,
        parentMeaningful: false,
        payloadFieldCount: 0
      });
      continue;
    }

    const normalized = normalizePayload(candidate.postId, picked.payload, candidate.backupDocId);
    const validation = validatePayload(normalized);
    const postRef = db.collection("posts").doc(candidate.postId);
    const postSnap = await postRef.get();
    const postData = (postSnap.data() ?? {}) as Record<string, unknown>;
    const parentMeaningful = postSnap.exists && hasMeaningfulDocData(postData);
    if (parentMeaningful) existingFullDocsCount += 1;
    if (!postSnap.exists || !parentMeaningful) missingOrEmptyParentCount += 1;

    if (!validation.ok) {
      validationErrors.push({ postId: candidate.postId, backupDocId: candidate.backupDocId, reasons: validation.reasons });
      planRows.push({
        postId: candidate.postId,
        backupDocId: candidate.backupDocId,
        backupTimestampMs: candidate.backupTimestampMs,
        selectedSourceField: picked.field,
        action: "skip_validation_failed",
        reason: validation.reasons.join(","),
        parentExists: postSnap.exists,
        parentMeaningful,
        payloadFieldCount: Object.keys(normalized).length
      });
      continue;
    }

    if (parentMeaningful && args.createMissingOnly && !args.allowOverwrite) {
      planRows.push({
        postId: candidate.postId,
        backupDocId: candidate.backupDocId,
        backupTimestampMs: candidate.backupTimestampMs,
        selectedSourceField: picked.field,
        action: "skip_existing_meaningful_doc",
        reason: "Existing meaningful parent document; create-missing-only active.",
        parentExists: postSnap.exists,
        parentMeaningful,
        payloadFieldCount: Object.keys(normalized).length
      });
      continue;
    }
    if (parentMeaningful && !args.allowOverwrite) {
      planRows.push({
        postId: candidate.postId,
        backupDocId: candidate.backupDocId,
        backupTimestampMs: candidate.backupTimestampMs,
        selectedSourceField: picked.field,
        action: "skip_overwrite_not_allowed",
        reason: "Existing meaningful parent document and allow-overwrite=false.",
        parentExists: postSnap.exists,
        parentMeaningful,
        payloadFieldCount: Object.keys(normalized).length
      });
      continue;
    }

    planRows.push({
      postId: candidate.postId,
      backupDocId: candidate.backupDocId,
      backupTimestampMs: candidate.backupTimestampMs,
      selectedSourceField: picked.field,
      action: "restore",
      reason: null,
      parentExists: postSnap.exists,
      parentMeaningful,
      payloadFieldCount: Object.keys(normalized).length
    });
    toWrite.push({ postId: candidate.postId, payload: normalized });
  }

  const reportDirAbs = path.resolve(process.cwd(), args.reportDir);
  const planPayload = {
    generatedAt: new Date().toISOString(),
    mode: args.dryRun ? "dry-run" : "apply",
    args,
    projectId,
    databaseId,
    counters: {
      totalBackupDocs: backupSnapshot.size,
      uniquePostIdsFound: byPostId.size,
      latestBackupsSelected: limited.length,
      restoreableCount: planRows.filter((r) => r.action === "restore").length,
      skippedCount: planRows.filter((r) => r.action !== "restore").length,
      existingFullDocsCount,
      missingOrEmptyParentCount,
      compactLivePostLatestCount,
      compactCoverageRatio
    },
    sampleRestoreMappings: planRows.filter((r) => r.action === "restore").slice(0, 20),
    validationErrors,
    planRows
  };

  const planMd = [
    "# Emergency Restore Plan",
    "",
    `- Generated at: ${planPayload.generatedAt}`,
    `- Mode: ${planPayload.mode}`,
    `- Project ID: ${String(projectId ?? "unknown")}`,
    `- Database: ${databaseId}`,
    `- total backup docs: ${planPayload.counters.totalBackupDocs}`,
    `- unique post IDs found: ${planPayload.counters.uniquePostIdsFound}`,
    `- latest backups selected: ${planPayload.counters.latestBackupsSelected}`,
    `- restoreable count: ${planPayload.counters.restoreableCount}`,
    `- skipped count: ${planPayload.counters.skippedCount}`,
    `- existing full docs count: ${planPayload.counters.existingFullDocsCount}`,
    `- missing/empty parent docs count: ${planPayload.counters.missingOrEmptyParentCount}`,
    `- compactLivePost latest coverage: ${planPayload.counters.compactLivePostLatestCount}/${planPayload.counters.latestBackupsSelected}`,
    "",
    "## Sample Restore Mappings (max 20)",
    ...planPayload.sampleRestoreMappings.map(
      (r) => `- ${r.postId} <= ${r.backupDocId} via ${String(r.selectedSourceField)}`
    ),
    "",
    "## Validation Errors",
    ...(validationErrors.length === 0
      ? ["- none"]
      : validationErrors.slice(0, 50).map((e) => `- ${e.postId} (${e.backupDocId}): ${e.reasons.join(", ")}`)),
    ""
  ].join("\n");
  writeReports(reportDirAbs, "restore-plan", planPayload, planMd);

  console.log(
    JSON.stringify(
      {
        event: "emergency_restore_preflight",
        projectId,
        databaseId,
        restoreCount: toWrite.length,
        samplePostIds: toWrite.slice(0, 20).map((w) => w.postId)
      },
      null,
      2
    )
  );

  if (args.dryRun) {
    const dryResult = {
      ok: true,
      applied: false,
      reason: "dry_run_mode",
      restoreCountPlanned: toWrite.length,
      reportDir: args.reportDir
    };
    const dryMd = [
      "# Emergency Restore Result",
      "",
      "- Applied: false",
      "- Reason: dry_run_mode",
      `- Restore count planned: ${toWrite.length}`,
      `- Reports: ${args.reportDir}/restore-plan.{json,md} and ${args.reportDir}/restore-result.{json,md}`,
      ""
    ].join("\n");
    writeReports(reportDirAbs, "restore-result", dryResult, dryMd);
    console.log(JSON.stringify(dryResult, null, 2));
    return;
  }

  if (!args.apply) {
    throw new Error("Refusing to write: pass --apply for write mode.");
  }
  if (process.env.CONFIRM_RESTORE_POSTS_FROM_BACKUPS !== REQUIRED_CONFIRMATION_VALUE) {
    throw new Error(
      "Refusing to write: missing env CONFIRM_RESTORE_POSTS_FROM_BACKUPS=I_UNDERSTAND_RESTORE_POSTS"
    );
  }

  const batches = splitBatches(toWrite, args.batchSize);
  let written = 0;
  for (const chunk of batches) {
    const batch = db.batch();
    for (const row of chunk) {
      const ref = db.collection("posts").doc(row.postId);
      batch.set(ref, row.payload, { merge: false });
    }
    await batch.commit();
    written += chunk.length;
  }

  const result = {
    ok: true,
    applied: true,
    writtenCount: written,
    skippedCount: planRows.filter((r) => r.action !== "restore").length,
    reportDir: args.reportDir
  };
  const resultMd = [
    "# Emergency Restore Result",
    "",
    "- Applied: true",
    `- Written docs: ${written}`,
    `- Skipped docs: ${result.skippedCount}`,
    `- Reports: ${args.reportDir}/restore-plan.{json,md} and ${args.reportDir}/restore-result.{json,md}`,
    ""
  ].join("\n");
  writeReports(reportDirAbs, "restore-result", result, resultMd);
  console.log(JSON.stringify(result, null, 2));
}

await main();
