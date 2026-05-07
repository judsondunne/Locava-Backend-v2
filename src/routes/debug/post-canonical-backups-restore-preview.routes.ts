import type { FastifyInstance } from "fastify";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import {
  buildRestorePreviewFromCanonicalBackupReadOnly,
  type CanonicalBackupField,
  resolveCanonicalBackupRestoreSource,
  normalizeRestoreTimestamps,
  parseBackupDocId,
  toFirestoreTimestamp
} from "../../lib/emergency/buildRestorePreviewFromCanonicalBackupReadOnly.js";
import { getFirestoreAdminIdentity, getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { getFirebaseAdminFirestore } from "../../lib/firebase-admin.js";

const REQUIRED_PROJECT_ID = "learn-32d72";
const BULK_CONFIRMATION = "I_UNDERSTAND_BULK_RESTORE_POSTS";
const OVERWRITE_CONFIRMATION = "I_UNDERSTAND_OVERWRITE_EXISTING_POSTS";
type RestorePolicy = "missing_or_empty_only" | "replace_restored_only" | "overwrite_existing";
type BulkSource = "auto" | "compactLivePost" | "canonicalPreview" | "canonicalPreview.postDoc" | "optimizedRaw";
type CurrentPostState = "missing" | "empty" | "has_data" | "restored_existing";
type TimestampKind = "FirestoreTimestamp" | "TimestampLike" | "PlainMapSecondsNanoseconds" | "String" | "Number" | "Missing" | string;
let bulkRunState: {
  runId: string;
  running: boolean;
  stopRequested: boolean;
  startedAt: string;
  completedAt?: string;
  report?: Record<string, unknown>;
} | null = null;
const bulkJobs = new Map<
  string,
  {
    runId: string;
    state: "running" | "completed" | "failed" | "stopped";
    startedAt: string;
    lastUpdatedAt: string;
    totalPlanned: number;
    processedCount: number;
    wroteCount: number;
    skippedCount: number;
    repairedCount: number;
    verifiedCount: number;
    verificationFailedCount: number;
    badTimestampCount: number;
    badStructureCount: number;
    errorCount: number;
    currentPostId: string | null;
    currentBackupDocId: string | null;
    nextCursor: string | null;
    stopRequested: boolean;
    itemsSample: Array<Record<string, unknown>>;
    errorsSample: Array<Record<string, unknown>>;
  }
>();

function parseLooseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off", ""].includes(normalized)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function classifyCurrentPostState(data: Record<string, unknown> | null, exists: boolean): CurrentPostState {
  if (!exists) return "missing";
  const keys = Object.keys(data ?? {});
  const meaningful = keys.some((k) => !["updatedAt", "lastUpdated", "__name__"].includes(k));
  if (!meaningful) return "empty";
  const schema = data?.schema && typeof data.schema === "object" ? (data.schema as Record<string, unknown>) : null;
  if (schema?.restoredFromCanonicalBackup === true) return "restored_existing";
  return "has_data";
}

function policyAllowsWrite(policy: RestorePolicy, state: CurrentPostState): boolean {
  if (policy === "missing_or_empty_only") return state === "missing" || state === "empty";
  if (policy === "replace_restored_only") return state === "missing" || state === "empty" || state === "restored_existing";
  return true;
}

function getNested(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    if (!cur[key] || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function getTimestampKind(value: unknown): TimestampKind {
  if (value instanceof Timestamp) return "FirestoreTimestamp";
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function" && typeof (value as { toMillis?: unknown }).toMillis === "function") return "TimestampLike";
  if (value && typeof value === "object" && "_seconds" in (value as Record<string, unknown>) && "_nanoseconds" in (value as Record<string, unknown>)) {
    return "PlainMapSecondsNanoseconds";
  }
  if (typeof value === "string") return "String";
  if (typeof value === "number") return "Number";
  if (value == null) return "Missing";
  return typeof value;
}

function isGoodTimestampKind(kind: TimestampKind): boolean {
  return kind === "FirestoreTimestamp" || kind === "TimestampLike";
}

function forcePayloadAdminTimestamps(payload: Record<string, unknown>): void {
  const fields = [
    "time",
    "updatedAt",
    "lastUpdated",
    "schema.restoredAt",
    "ranking.aggregates.lastAggregatedAt",
    "rankingAggregates.lastAggregatedAt",
    "playbackLab.generatedAt",
    "playbackLab.lastVerifyAt"
  ];
  for (const field of fields) {
    const current = getNested(payload, field);
    const ts = toFirestoreTimestamp(current);
    if (ts) setNested(payload, field, ts);
  }
}

function assertRestorePayloadHasAdminTimestamps(payload: Record<string, unknown>): { ok: boolean; errors: string[]; kinds: Record<string, string> } {
  const checks = ["time", "updatedAt", "lastUpdated", "schema.restoredAt"];
  const errors: string[] = [];
  const kinds: Record<string, string> = {};
  for (const field of checks) {
    const kind = getTimestampKind(getNested(payload, field));
    kinds[field] = kind;
    if (!isGoodTimestampKind(kind)) errors.push(`invalid_${field}:${kind}`);
  }
  return { ok: errors.length === 0, errors, kinds };
}

async function verifyRestoredPostParentDoc(input: {
  db: NonNullable<ReturnType<typeof getFirestoreSourceClient>>;
  postId: string;
  expectedBackupDocId: string;
  expectedRunId: string;
}): Promise<{
  ok: boolean;
  errors: string[];
  warnings: string[];
  fieldCount: number;
  timestampCheck: Record<string, string>;
  structureCheck: Record<string, boolean>;
}> {
  const snap = await input.db.collection("posts").doc(input.postId).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const media = data.media && typeof data.media === "object" ? (data.media as Record<string, unknown>) : null;
  const assets = media && Array.isArray(media.assets) ? (media.assets as Array<Record<string, unknown>>) : [];
  const schema = data.schema && typeof data.schema === "object" ? (data.schema as Record<string, unknown>) : {};
  const errors: string[] = [];
  const warnings: string[] = [];
  const timestampCheck = {
    time: getTimestampKind(data.time),
    updatedAt: getTimestampKind(data.updatedAt),
    lastUpdated: getTimestampKind(data.lastUpdated),
    schemaRestoredAt: getTimestampKind(schema.restoredAt),
    rankingLastAggregatedAt: getTimestampKind(getNested(data, "ranking.aggregates.lastAggregatedAt"))
  };
  const structureCheck = {
    exists: snap.exists,
    hasMedia: Boolean(media),
    hasMediaAssets: assets.length > 0,
    hasAuthor: Boolean(data.author && typeof data.author === "object"),
    hasText: Boolean(data.text && typeof data.text === "object"),
    hasLocation: Boolean(data.location && typeof data.location === "object"),
    hasEngagement: Boolean(data.engagement && typeof data.engagement === "object"),
    hasSchemaRestoreMetadata:
      schema.restoredFromCanonicalBackup === true && schema.restoreBackupDocId === input.expectedBackupDocId && schema.restoreRunId === input.expectedRunId
  };
  if (!structureCheck.exists) errors.push("missing_doc");
  if (Object.keys(data).length <= 0) errors.push("empty_doc");
  if (data.id !== input.postId) errors.push("id_mismatch");
  if (data.postId !== input.postId) errors.push("postId_mismatch");
  if (!structureCheck.hasAuthor) errors.push("missing_author");
  if (!structureCheck.hasText) errors.push("missing_text");
  if (!structureCheck.hasLocation) errors.push("missing_location");
  if (!structureCheck.hasMedia) errors.push("missing_media");
  if (!structureCheck.hasMediaAssets) errors.push("missing_media_assets");
  if (!structureCheck.hasEngagement) errors.push("missing_engagement");
  if (!structureCheck.hasSchemaRestoreMetadata) errors.push("missing_schema_restore_metadata");
  if (!isGoodTimestampKind(timestampCheck.time)) errors.push(`bad_time:${timestampCheck.time}`);
  if (!isGoodTimestampKind(timestampCheck.updatedAt)) errors.push(`bad_updatedAt:${timestampCheck.updatedAt}`);
  if (!isGoodTimestampKind(timestampCheck.lastUpdated)) errors.push(`bad_lastUpdated:${timestampCheck.lastUpdated}`);
  if (!isGoodTimestampKind(timestampCheck.schemaRestoredAt)) errors.push(`bad_schemaRestoredAt:${timestampCheck.schemaRestoredAt}`);
  if (typeof (data.engagement as Record<string, unknown> | undefined)?.likeCount !== "number") warnings.push("engagement_likeCount_not_number");
  if (typeof (data.engagement as Record<string, unknown> | undefined)?.commentCount !== "number") warnings.push("engagement_commentCount_not_number");
  return { ok: errors.length === 0, errors, warnings, fieldCount: Object.keys(data).length, timestampCheck, structureCheck };
}

async function buildBulkPlan(input: {
  db: NonNullable<ReturnType<typeof getFirestoreSourceClient>>;
  limit: number;
  offsetCursor?: string;
  source: BulkSource;
  restorePolicy: RestorePolicy;
  includeExisting: boolean;
}): Promise<{
  scannedBackupDocs: number;
  uniquePostIdsConsidered: number;
  sourceCounts: Record<string, number>;
  stateCounts: Record<string, number>;
  mediaKindCounts: Record<string, number>;
  timestampSourceCounts: Record<string, number>;
  wouldWriteCount: number;
  skipCount: number;
  errorCount: number;
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
}> {
  const queryBase = input.db.collection("postCanonicalBackups").orderBy(FieldPath.documentId()).limit(input.limit);
  const backupsSnap = input.offsetCursor ? await queryBase.startAfter(input.offsetCursor).get() : await queryBase.get();
  const sourceCounts: Record<string, number> = {};
  const stateCounts: Record<string, number> = {};
  const mediaKindCounts: Record<string, number> = {};
  const timestampSourceCounts: Record<string, number> = {};
  const items: Array<Record<string, unknown>> = [];
  let wouldWriteCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const seenPostIds = new Set<string>();

  for (const backupDoc of backupsSnap.docs) {
    const backupData = (backupDoc.data() ?? {}) as Record<string, unknown>;
    const { postId } = parseBackupDocId(backupDoc.id);
    if (seenPostIds.has(postId)) continue;
    seenPostIds.add(postId);
    const postSnap = await input.db.collection("posts").doc(postId).get();
    const postData = (postSnap.data() ?? {}) as Record<string, unknown>;
    const currentPostState = classifyCurrentPostState(postData, postSnap.exists);
    stateCounts[currentPostState] = (stateCounts[currentPostState] ?? 0) + 1;

    const preview = buildRestorePreviewFromCanonicalBackupReadOnly({
      projectId: getFirestoreAdminIdentity().projectId ?? null,
      backupDocId: backupDoc.id,
      backupData,
      currentPostExists: postSnap.exists,
      currentPostData: postData,
      backupField: input.source,
      allowOverwrite: input.restorePolicy === "overwrite_existing",
      previewIsoTimestamp: new Date().toISOString(),
      allowRawRestore: false
    });

    if (!preview.ok) {
      items.push({
        backupDocId: backupDoc.id,
        postId,
        sourceName: "none",
        currentPostState,
        wouldWrite: false,
        skipReason: "INVALID_BACKUP_SOURCE",
        validationValid: false,
        validationErrors: [preview.error]
      });
      skipCount += 1;
      errorCount += 1;
      continue;
    }
    sourceCounts[preview.sourceName] = (sourceCounts[preview.sourceName] ?? 0) + 1;
    const mediaKind = String((preview.restorePayloadSummary.mediaKind as string | undefined) ?? "unknown");
    mediaKindCounts[mediaKind] = (mediaKindCounts[mediaKind] ?? 0) + 1;
    const tsSource = String(preview.timestampPreview.time?.source ?? "missing");
    timestampSourceCounts[tsSource] = (timestampSourceCounts[tsSource] ?? 0) + 1;

    let skipReason: string | null = null;
    if (preview.sourceName === "rawBefore" || preview.requiresManualRawRestore) skipReason = "RAW_BEFORE_PREVIEW_ONLY";
    else if (!preview.canApplySafely) skipReason = "SOURCE_NOT_SAFE";
    else if (!preview.validation.valid) skipReason = "VALIDATION_FAILED";
    else if (preview.timestampPreview.time?.type !== "FirestoreTimestamp") skipReason = "MISSING_QUERY_CRITICAL_TIME";
    else if (!policyAllowsWrite(input.restorePolicy, currentPostState)) skipReason = "POLICY_SKIP_EXISTING_HEALTHY";
    else if (!input.includeExisting && (currentPostState === "has_data" || currentPostState === "restored_existing")) {
      skipReason = "EXISTING_DOC_SKIPPED";
    }
    const wouldWrite = skipReason === null;
    if (wouldWrite) wouldWriteCount += 1;
    else skipCount += 1;
    items.push({
      backupDocId: backupDoc.id,
      postId,
      sourceName: preview.sourceName,
      sourceQuality: preview.sourceQuality,
      currentPostState,
      wouldWrite,
      skipReason,
      validationValid: preview.validation.valid,
      validationErrors: preview.validation.errors,
      title: preview.restorePayloadSummary.title ?? null,
      authorHandle: preview.restorePayloadSummary.authorHandle ?? null,
      mediaKind,
      assetCount: preview.restorePayloadSummary.assetCount ?? 0,
      likeCount: preview.restorePayloadSummary.likeCount ?? null,
      commentCount: preview.restorePayloadSummary.commentCount ?? null,
      timeTypePreview: preview.timestampPreview.time?.type ?? "missing",
      updatedAtTypePreview: preview.timestampPreview.updatedAt?.type ?? "missing",
      lastUpdatedTypePreview: preview.timestampPreview.lastUpdated?.type ?? "missing",
      schemaRestoredAtTypePreview: preview.timestampPreview.schemaRestoredAt?.type ?? "missing",
      backupFieldUsed: preview.backupFieldUsed,
      payload: preview.restorePayloadPreview,
      backupData
    });
  }

  return {
    scannedBackupDocs: backupsSnap.size,
    uniquePostIdsConsidered: seenPostIds.size,
    sourceCounts,
    stateCounts,
    mediaKindCounts,
    timestampSourceCounts,
    wouldWriteCount,
    skipCount,
    errorCount,
    items,
    nextCursor: backupsSnap.docs.at(-1)?.id ?? null
  };
}

type ExistingAuditState = "missing" | "empty" | "restored_existing" | "healthy_existing" | "invalid_existing";
async function classifyExistingPostDoc(input: {
  db: NonNullable<ReturnType<typeof getFirestoreSourceClient>>;
  postId: string;
}): Promise<{
  state: ExistingAuditState;
  verify: Awaited<ReturnType<typeof verifyRestoredPostParentDoc>> | null;
}> {
  const snap = await input.db.collection("posts").doc(input.postId).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  if (!snap.exists) return { state: "missing", verify: null };
  const keys = Object.keys(data);
  const meaningful = keys.some((k) => !["updatedAt", "lastUpdated", "__name__"].includes(k));
  if (!meaningful) return { state: "empty", verify: null };
  const schema = data.schema && typeof data.schema === "object" ? (data.schema as Record<string, unknown>) : {};
  const restoreBackupDocId = String(schema.restoreBackupDocId ?? "");
  const verify = await verifyRestoredPostParentDoc({
    db: input.db,
    postId: input.postId,
    expectedBackupDocId: restoreBackupDocId,
    expectedRunId: String(schema.restoreRunId ?? "")
  });
  if (schema.restoredFromCanonicalBackup === true) return { state: "restored_existing", verify };
  if (verify.errors.some((e) => e.startsWith("bad_") || e.startsWith("missing_"))) return { state: "invalid_existing", verify };
  return { state: "healthy_existing", verify };
}

async function runBulkRestoreJob(input: {
  db: NonNullable<ReturnType<typeof getFirestoreSourceClient>>;
  jobId: string;
  source: BulkSource;
  restorePolicy: RestorePolicy;
  chunkSize: number;
  limit: number;
}): Promise<void> {
  const job = bulkJobs.get(input.jobId);
  if (!job) return;
  let cursor: string | undefined = undefined;
  let remaining = input.limit;
  while (remaining > 0 && !job.stopRequested && job.state === "running") {
    const slice = Math.min(input.chunkSize, remaining);
    const plan = await buildBulkPlan({
      db: input.db,
      limit: slice,
      offsetCursor: cursor,
      source: input.source,
      restorePolicy: input.restorePolicy,
      includeExisting: false
    });
    cursor = plan.nextCursor ?? undefined;
    job.nextCursor = plan.nextCursor;
    if (plan.items.length === 0) break;
    for (const item of plan.items) {
      if (job.stopRequested) break;
      job.currentPostId = String(item.postId ?? "");
      job.currentBackupDocId = String(item.backupDocId ?? "");
      job.processedCount += 1;
      job.lastUpdatedAt = new Date().toISOString();
      if (!item.wouldWrite) {
        job.skippedCount += 1;
        if (job.itemsSample.length < 40) job.itemsSample.push({ postId: item.postId, backupDocId: item.backupDocId, action: "skipped", reason: item.skipReason });
        continue;
      }
      try {
        const payload = structuredClone(item.payload as Record<string, unknown>);
        forcePayloadAdminTimestamps(payload);
        const prewrite = assertRestorePayloadHasAdminTimestamps(payload);
        if (!prewrite.ok) {
          job.errorCount += 1;
          job.badTimestampCount += 1;
          if (job.errorsSample.length < 30) job.errorsSample.push({ postId: item.postId, backupDocId: item.backupDocId, error: "PREWRITE_TIMESTAMP_INVALID", details: prewrite.errors });
          continue;
        }
        setNested(payload, "schema.restoreRunId", input.jobId);
        setNested(payload, "schema.restoreBackupDocId", item.backupDocId);
        setNested(payload, "schema.restoredFromCanonicalBackup", true);
        setNested(payload, "schema.restoredAt", Timestamp.now());
        await input.db.collection("posts").doc(String(item.postId)).set(payload, { merge: false });
        job.wroteCount += 1;
        const verify = await verifyRestoredPostParentDoc({
          db: input.db,
          postId: String(item.postId),
          expectedBackupDocId: String(item.backupDocId),
          expectedRunId: input.jobId
        });
        if (verify.ok) {
          job.verifiedCount += 1;
          if (job.itemsSample.length < 40) job.itemsSample.push({ postId: item.postId, backupDocId: item.backupDocId, action: "wrote", verified: true });
        } else {
          job.verificationFailedCount += 1;
          if (verify.errors.some((e) => e.startsWith("bad_"))) job.badTimestampCount += 1;
          if (verify.errors.some((e) => e.startsWith("missing_"))) job.badStructureCount += 1;
          job.errorCount += 1;
          if (job.errorsSample.length < 30) {
            job.errorsSample.push({ postId: item.postId, backupDocId: item.backupDocId, error: "POST_WRITE_VERIFY_FAILED", details: verify.errors });
          }
        }
      } catch (error) {
        job.errorCount += 1;
        if (job.errorsSample.length < 30) job.errorsSample.push({ postId: item.postId, backupDocId: item.backupDocId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    remaining -= plan.items.length;
    job.lastUpdatedAt = new Date().toISOString();
    if (!cursor) break;
  }
  job.currentPostId = null;
  job.currentBackupDocId = null;
  job.lastUpdatedAt = new Date().toISOString();
  job.state = job.stopRequested ? "stopped" : "completed";
}

/**
 * READ ONLY restore preview. This endpoint must never write to Firestore.
 */
export async function registerPostCanonicalBackupsRestorePreviewRoutes(app: FastifyInstance): Promise<void> {
  const resolveDbForVerify = () => getFirestoreSourceClient() ?? getFirebaseAdminFirestore();
  app.get<{ Params: { backupDocId: string } }>(
    "/debug/post-canonical-backups/:backupDocId/restore-preview",
    async (request, reply) => {
      const params = z.object({ backupDocId: z.string().min(1) }).parse(request.params);
      const query = z
        .object({
          backupField: z
            .enum(["auto", "compactLivePost", "canonicalPreview", "canonicalPreview.postDoc", "optimizedRaw", "rawBefore"])
            .optional()
            .default("auto"),
          allowOverwrite: z.unknown().optional().transform((v) => parseLooseBoolean(v, false)).default(false)
        })
        .parse(request.query);

      const db = getFirestoreSourceClient();
      if (!db) {
        return reply.status(503).send({ ok: false, error: "firestore_unavailable", NO_FIRESTORE_WRITE_PERFORMED: "NO_FIRESTORE_WRITE_PERFORMED" });
      }

      const projectId = getFirestoreAdminIdentity().projectId ?? null;
      if (projectId !== REQUIRED_PROJECT_ID) {
        return reply.status(400).send({
          ok: false,
          error: `wrong_project:${String(projectId)}`,
          requiredProjectId: REQUIRED_PROJECT_ID,
          NO_FIRESTORE_WRITE_PERFORMED: "NO_FIRESTORE_WRITE_PERFORMED"
        });
      }

      const backupSnap = await db.collection("postCanonicalBackups").doc(params.backupDocId).get();
      if (!backupSnap.exists) {
        return reply.status(404).send({
          ok: false,
          dryRun: true,
          readOnly: true,
          wrote: false,
          NO_FIRESTORE_WRITE_PERFORMED: "NO_FIRESTORE_WRITE_PERFORMED",
          error: "backup_doc_not_found",
          backupDocId: params.backupDocId
        });
      }

      const backupData = (backupSnap.data() ?? {}) as Record<string, unknown>;
      const { postId } = parseBackupDocId(params.backupDocId);
      const postSnap = await db.collection("posts").doc(postId).get();
      const currentPostData = postSnap.exists ? ((postSnap.data() ?? {}) as Record<string, unknown>) : null;

      const preview = buildRestorePreviewFromCanonicalBackupReadOnly({
        projectId,
        backupDocId: params.backupDocId,
        backupData,
        currentPostExists: postSnap.exists,
        currentPostData,
        backupField: query.backupField,
        allowOverwrite: query.allowOverwrite,
        previewIsoTimestamp: new Date().toISOString(),
        allowRawRestore: query.backupField === "rawBefore"
      });

      if (!preview.ok) {
        return reply.status(400).send(preview);
      }
      const previewPayloadClone = structuredClone(preview.restorePayloadPreview as Record<string, unknown>);
      const normalizedPreview = normalizeRestoreTimestamps(previewPayloadClone, backupData, params.backupDocId);
      return {
        ...preview,
        restorePayloadPreview: normalizedPreview.payload,
        timestampPreview: normalizedPreview.timestampPreview
      };
    }
  );

  app.post<{ Params: { backupDocId: string } }>(
    "/debug/post-canonical-backups/:backupDocId/apply-one",
    async (request, reply) => {
      const params = z.object({ backupDocId: z.string().min(1) }).parse(request.params);
      const body = z
        .object({
          backupField: z
            .enum(["auto", "compactLivePost", "canonicalPreview", "canonicalPreview.postDoc", "optimizedRaw", "rawBefore"])
            .optional()
            .default("auto"),
          allowOverwrite: z.unknown().optional().transform((v) => parseLooseBoolean(v, false)).default(false)
        })
        .parse(request.body ?? {});

      const db = getFirestoreSourceClient();
      if (!db) return reply.status(503).send({ ok: false, apply: true, wrote: false, error: "firestore_unavailable" });

      const projectId = getFirestoreAdminIdentity().projectId ?? null;
      if (projectId !== REQUIRED_PROJECT_ID) {
        return reply.status(400).send({
          ok: false,
          apply: true,
          wrote: false,
          error: `wrong_project:${String(projectId)}`,
          requiredProjectId: REQUIRED_PROJECT_ID
        });
      }

      const backupSnap = await db.collection("postCanonicalBackups").doc(params.backupDocId).get();
      if (!backupSnap.exists) {
        return reply.status(404).send({
          ok: false,
          apply: true,
          wrote: false,
          error: "backup_doc_not_found",
          backupDocId: params.backupDocId
        });
      }

      const backupData = (backupSnap.data() ?? {}) as Record<string, unknown>;
      const { postId } = parseBackupDocId(params.backupDocId);
      const postRef = db.collection("posts").doc(postId);
      const postSnap = await postRef.get();
      const currentPostData = postSnap.exists ? ((postSnap.data() ?? {}) as Record<string, unknown>) : null;
      const preview = buildRestorePreviewFromCanonicalBackupReadOnly({
        projectId,
        backupDocId: params.backupDocId,
        backupData,
        currentPostExists: postSnap.exists,
        currentPostData,
        backupField: body.backupField as CanonicalBackupField,
        allowOverwrite: body.allowOverwrite,
        previewIsoTimestamp: new Date().toISOString(),
        allowRawRestore: false
      });

      if (!preview.ok) {
        return reply.status(422).send({
          ok: false,
          apply: true,
          wrote: false,
          error: "INVALID_BACKUP_FIELD_SOURCE",
          backupDocId: params.backupDocId,
          backupFieldUsed: body.backupField
        });
      }

      if (!preview.validation.valid) {
        return reply.status(422).send({
          ok: false,
          apply: true,
          wrote: false,
          error: "VALIDATION_FAILED",
          backupDocId: params.backupDocId,
          postId,
          backupFieldUsed: preview.backupFieldUsed,
          currentPostDocBefore: {
            exists: preview.currentPostDoc.exists,
            state: preview.currentPostDoc.state,
            fieldCount: preview.currentPostDoc.fieldCount
          },
          decision: {
            writeMode: preview.decision.writeMode,
            allowOverwrite: body.allowOverwrite,
            reason: preview.decision.reason
          },
          validation: {
            valid: false,
            warnings: preview.validation.warnings,
            errors: preview.validation.errors
          }
        });
      }

      if (!preview.decision.wouldWrite || preview.decision.writeMode === "skip_existing_doc") {
        return reply.status(409).send({
          ok: true,
          apply: true,
          wrote: false,
          projectId,
          backupDocId: params.backupDocId,
          postId,
          targetPath: `posts/${postId}`,
          backupFieldUsed: preview.backupFieldUsed,
          currentPostDocBefore: {
            exists: preview.currentPostDoc.exists,
            state: preview.currentPostDoc.state,
            fieldCount: preview.currentPostDoc.fieldCount
          },
          decision: {
            writeMode: "skip_existing_doc",
            allowOverwrite: body.allowOverwrite,
            reason: "existing parent doc has data"
          },
          validation: {
            valid: true,
            warnings: preview.validation.warnings,
            errors: []
          },
          restorePayloadSummary: preview.restorePayloadSummary
        });
      }

      const writePayloadBase = structuredClone(preview.restorePayloadPreview as Record<string, unknown>);
      const normalizedWrite = normalizeRestoreTimestamps(writePayloadBase, backupData, params.backupDocId);
      const writePayload = normalizedWrite.payload;
      const schema =
        writePayload.schema && typeof writePayload.schema === "object"
          ? { ...(writePayload.schema as Record<string, unknown>) }
          : {};
      delete schema.restorePreviewOnly;
      writePayload.schema = schema;

      await postRef.set(writePayload, { merge: false });

      return {
        ok: true,
        apply: true,
        wrote: true,
        projectId,
        backupDocId: params.backupDocId,
        postId,
        targetPath: `posts/${postId}`,
        backupFieldUsed: preview.backupFieldUsed,
        currentPostDocBefore: {
          exists: preview.currentPostDoc.exists,
          state: preview.currentPostDoc.state,
          fieldCount: preview.currentPostDoc.fieldCount
        },
        decision: {
          writeMode: "create_parent_doc",
          allowOverwrite: body.allowOverwrite,
          reason: "parent doc missing or empty"
        },
        validation: {
          valid: true,
          warnings: preview.validation.warnings,
          errors: []
        },
        restorePayloadSummary: preview.restorePayloadSummary,
        timestampPreview: normalizedWrite.timestampPreview,
        sourceName: preview.sourceName,
        sourceQuality: preview.sourceQuality
      };
    }
  );

  app.post<{ Params: { backupDocId: string } }>(
    "/debug/post-canonical-backups/:backupDocId/repair-one-timestamps",
    async (request, reply) => {
      const params = z.object({ backupDocId: z.string().min(1) }).parse(request.params);
      const body = z.object({ confirmation: z.string().optional() }).parse(request.body ?? {});
      if (body.confirmation !== "I_UNDERSTAND_REPAIR_ONE_POST_TIMESTAMPS") {
        return reply.status(400).send({ ok: false, wrote: false, error: "CONFIRMATION_REQUIRED" });
      }
      const db = getFirestoreSourceClient();
      if (!db) return reply.status(503).send({ ok: false, wrote: false, error: "firestore_unavailable" });
      const projectId = getFirestoreAdminIdentity().projectId ?? null;
      if (projectId !== REQUIRED_PROJECT_ID) {
        return reply.status(400).send({ ok: false, wrote: false, error: `wrong_project:${String(projectId)}` });
      }

      const backupSnap = await db.collection("postCanonicalBackups").doc(params.backupDocId).get();
      if (!backupSnap.exists) return reply.status(404).send({ ok: false, wrote: false, error: "backup_doc_not_found" });
      const backupData = (backupSnap.data() ?? {}) as Record<string, unknown>;
      const { postId } = parseBackupDocId(params.backupDocId);
      const postRef = db.collection("posts").doc(postId);
      const postSnap = await postRef.get();
      if (!postSnap.exists) return reply.status(404).send({ ok: false, wrote: false, error: "post_doc_not_found", postId });
      const before = (postSnap.data() ?? {}) as Record<string, unknown>;
      const candidate = structuredClone(before);
      const normalized = normalizeRestoreTimestamps(candidate, backupData, params.backupDocId);
      const schema = normalized.payload.schema as Record<string, unknown>;
      delete schema.restorePreviewOnly;
      await postRef.set(
        {
          time: normalized.payload.time,
          updatedAt: normalized.payload.updatedAt,
          lastUpdated: normalized.payload.lastUpdated,
          likeBoostScheduledAt: normalized.payload.likeBoostScheduledAt,
          ranking: normalized.payload.ranking,
          rankingAggregates: normalized.payload.rankingAggregates,
          schema
        },
        { merge: true }
      );
      return {
        ok: true,
        wrote: true,
        postId,
        backupDocId: params.backupDocId,
        targetPath: `posts/${postId}`,
        timestampPreview: normalized.timestampPreview
      };
    }
  );

  app.get<{ Params: { postId: string } }>("/debug/posts/:postId/restore-verify", async (request, reply) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const db = resolveDbForVerify();
    const doc = await db.collection("posts").doc(params.postId).get();
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    const media = data.media && typeof data.media === "object" ? (data.media as Record<string, unknown>) : null;
    const assets = media && Array.isArray(media.assets) ? media.assets : [];

    let likesCount: number | null = null;
    let commentsCount: number | null = null;
    let subcollectionWarning: string | null = null;
    try {
      const [likesAgg, commentsAgg] = await Promise.all([
        doc.ref.collection("likes").count().get(),
        doc.ref.collection("comments").count().get()
      ]);
      likesCount = likesAgg.data().count;
      commentsCount = commentsAgg.data().count;
    } catch (error) {
      likesCount = null;
      commentsCount = null;
      subcollectionWarning = error instanceof Error ? error.message : String(error);
    }

    return reply.send({
      ok: true,
      postId: params.postId,
      exists: doc.exists,
      fieldCount: Object.keys(data).length,
      hasMedia: Boolean(media),
      hasMediaAssets: assets.length > 0,
      hasAuthor: Boolean(data.author && typeof data.author === "object"),
      hasText: Boolean(data.text || data.title || data.caption),
      hasLocation: Boolean(data.location || ((data.lat || data.lat === 0) && (data.long || data.long === 0 || data.lng || data.lng === 0))),
      hasEngagement: Boolean(data.engagement && typeof data.engagement === "object"),
      timestampCheck: {
        time: data.time instanceof Timestamp ? "Firestore Timestamp ✅" : typeof data.time,
        updatedAt: data.updatedAt instanceof Timestamp ? "Firestore Timestamp ✅" : typeof data.updatedAt,
        lastUpdated: data.lastUpdated instanceof Timestamp ? "Firestore Timestamp ✅" : typeof data.lastUpdated,
        schemaRestoredAt:
          (data.schema as Record<string, unknown> | undefined)?.restoredAt instanceof Timestamp
            ? "Firestore Timestamp ✅"
            : typeof (data.schema as Record<string, unknown> | undefined)?.restoredAt
      },
      lifecycleCheck: {
        hasLifecycleCreatedAt: Boolean((data.lifecycle as Record<string, unknown> | undefined)?.createdAt),
        hasLifecycleCreatedAtMs: typeof (data.lifecycle as Record<string, unknown> | undefined)?.createdAtMs === "number"
      },
      subcollections: {
        likesCount,
        commentsCount
      },
      warning: subcollectionWarning ? `subcollection_count_unavailable:${subcollectionWarning}` : null
    });
  });

  app.get("/debug/post-canonical-backups/restore-readiness-scan", async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(2000).optional().default(200) }).parse(request.query);
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const backupsSnap = await db.collection("postCanonicalBackups").limit(query.limit).get();
    const rows: Array<Record<string, unknown>> = [];
    const sourceCounts: Record<string, number> = {};
    const mediaCounts: { image: number; video: number; mixed: number; unknown: number } = {
      image: 0,
      video: 0,
      mixed: 0,
      unknown: 0
    };
    const timestampSourceCounts: { "rawBefore.time": number; "lifecycle.createdAt": number; missing: number } = {
      "rawBefore.time": 0,
      "lifecycle.createdAt": 0,
      missing: 0
    };
    const validationErrorCounts: Record<string, number> = {};
    const sampleVideoBackupIds: string[] = [];
    const sampleMultiImageBackupIds: string[] = [];
    let validRestoreable = 0;
    let missingOrEmptyParent = 0;
    let existingParent = 0;

    for (const doc of backupsSnap.docs) {
      const backup = (doc.data() ?? {}) as Record<string, unknown>;
      const { postId } = parseBackupDocId(doc.id);
      const resolved = resolveCanonicalBackupRestoreSource(backup, "auto");
      sourceCounts[resolved.sourceName] = (sourceCounts[resolved.sourceName] ?? 0) + 1;
      if (resolved.sourceName !== "none" && resolved.canApplySafely) {
        const preview = buildRestorePreviewFromCanonicalBackupReadOnly({
          projectId: getFirestoreAdminIdentity().projectId ?? null,
          backupDocId: doc.id,
          backupData: backup,
          currentPostExists: false,
          currentPostData: null,
          backupField: "auto",
          allowOverwrite: false,
          previewIsoTimestamp: new Date().toISOString(),
          allowRawRestore: false
        });
        if (preview.ok) {
          if (preview.validation.valid) validRestoreable += 1;
          else {
            for (const err of preview.validation.errors) {
              validationErrorCounts[err] = (validationErrorCounts[err] ?? 0) + 1;
            }
          }
          const assets = Array.isArray((preview.restorePayloadPreview.media as Record<string, unknown> | undefined)?.assets)
            ? (((preview.restorePayloadPreview.media as Record<string, unknown>).assets as unknown[]) ?? [])
            : [];
          const types = assets.map((a) => String((a as Record<string, unknown>)?.type ?? "unknown"));
          const hasImage = types.includes("image");
          const hasVideo = types.includes("video");
          if (hasImage && hasVideo) mediaCounts.mixed += 1;
          else if (hasVideo) mediaCounts.video += 1;
          else if (hasImage) mediaCounts.image += 1;
          else mediaCounts.unknown += 1;
          if (hasVideo && sampleVideoBackupIds.length < 10) sampleVideoBackupIds.push(doc.id);
          const imageCount = types.filter((t) => t === "image").length;
          if (imageCount > 1 && sampleMultiImageBackupIds.length < 10) sampleMultiImageBackupIds.push(doc.id);
          const source = preview.timestampPreview.time?.source;
          if (source === "backup.rawBefore.time") timestampSourceCounts["rawBefore.time"] += 1;
          else if (source === "lifecycle.createdAt") timestampSourceCounts["lifecycle.createdAt"] += 1;
          else timestampSourceCounts.missing += 1;
        }
      }
      const postSnap = await db.collection("posts").doc(postId).get();
      const postData = (postSnap.data() ?? {}) as Record<string, unknown>;
      const hasData = postSnap.exists && Object.keys(postData).some((k) => !["updatedAt", "lastUpdated"].includes(k));
      if (hasData) existingParent += 1;
      else missingOrEmptyParent += 1;
      rows.push({
        backupDocId: doc.id,
        postId,
        sourceName: resolved.sourceName,
        canApplySafely: resolved.canApplySafely,
        requiresManualRawRestore: resolved.requiresManualRawRestore
      });
    }

    return reply.send({
      ok: true,
      dryRun: true,
      readOnly: true,
      totalScanned: backupsSnap.size,
      uniquePostIds: new Set(rows.map((r) => String(r.postId))).size,
      sourceCounts,
      validRestoreableCount: validRestoreable,
      missingOrEmptyParentCount: missingOrEmptyParent,
      existingParentCount: existingParent,
      mediaTypeCounts: mediaCounts,
      timestampSourceCounts,
      validationErrorCounts,
      sampleInvalidBackupIds: rows.filter((r) => String(r.sourceName) === "none").slice(0, 10).map((r) => r.backupDocId),
      sampleRawBeforeOnlyBackupIds: rows
        .filter((r) => String(r.sourceName) === "rawBefore")
        .slice(0, 10)
        .map((r) => r.backupDocId),
      sampleVideoBackupIds,
      sampleMultiImageBackupIds,
      rows: rows.slice(0, 200)
    });
  });

  app.get("/debug/post-canonical-backups/bulk-restore/preview", async (request, reply) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(20000).optional().default(20),
        offsetCursor: z.string().optional(),
        source: z.enum(["auto", "compactLivePost", "canonicalPreview", "canonicalPreview.postDoc", "optimizedRaw"]).optional().default("auto"),
        restorePolicy: z.enum(["missing_or_empty_only", "replace_restored_only", "overwrite_existing"]).optional().default("missing_or_empty_only"),
        includeExisting: z.unknown().optional().transform((v) => parseLooseBoolean(v, false)).default(false)
      })
      .parse(request.query);
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable", wrote: false });
    const plan = await buildBulkPlan({
      db,
      limit: query.limit,
      offsetCursor: query.offsetCursor,
      source: query.source,
      restorePolicy: query.restorePolicy,
      includeExisting: query.includeExisting
    });
    return reply.send({
      ok: true,
      dryRun: true,
      wrote: false,
      limit: query.limit,
      ...plan,
      items: plan.items.map((i) => {
        const { payload: _payload, ...safe } = i;
        return safe;
      })
    });
  });

  app.get("/debug/post-canonical-backups/bulk-restore/audit-state", async (request, reply) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50000).optional(),
        source: z.enum(["auto", "compactLivePost", "canonicalPreview", "canonicalPreview.postDoc", "optimizedRaw"]).optional().default("auto"),
        restorePolicy: z.enum(["missing_or_empty_only", "replace_restored_only", "overwrite_existing"]).optional().default("missing_or_empty_only")
      })
      .parse(request.query);
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const totalBackupDocs = (await db.collection("postCanonicalBackups").count().get()).data().count;
    const target = query.limit ?? totalBackupDocs;
    const plan = await buildBulkPlan({
      db,
      limit: Math.min(target, 50000),
      source: query.source,
      restorePolicy: query.restorePolicy,
      includeExisting: false
    });
    let restoredExistingCount = 0;
    let healthyExistingCount = 0;
    let missingParentCount = 0;
    let emptyParentCount = 0;
    let invalidBackupCount = 0;
    let rawBeforeOnlyCount = 0;
    let timestampGoodCount = 0;
    let timestampBadCount = 0;
    let structureGoodCount = 0;
    let structureBadCount = 0;
    const sampleMissing: string[] = [];
    const sampleInvalid: string[] = [];
    const sampleBadTimestamp: string[] = [];
    const sampleRestoredExisting: string[] = [];
    for (const item of plan.items) {
      const postId = String(item.postId);
      const audit = await classifyExistingPostDoc({ db, postId });
      if (audit.state === "restored_existing") {
        restoredExistingCount += 1;
        if (sampleRestoredExisting.length < 10) sampleRestoredExisting.push(postId);
      } else if (audit.state === "healthy_existing") healthyExistingCount += 1;
      else if (audit.state === "missing") {
        missingParentCount += 1;
        if (sampleMissing.length < 10) sampleMissing.push(postId);
      } else if (audit.state === "empty") emptyParentCount += 1;
      if (item.skipReason === "RAW_BEFORE_PREVIEW_ONLY") rawBeforeOnlyCount += 1;
      if (item.skipReason === "INVALID_BACKUP_SOURCE" || item.skipReason === "VALIDATION_FAILED") {
        invalidBackupCount += 1;
        if (sampleInvalid.length < 10) sampleInvalid.push(String(item.backupDocId));
      }
      if (audit.verify) {
        const t = audit.verify.timestampCheck;
        const okTs = isGoodTimestampKind(t.time as TimestampKind) && isGoodTimestampKind(t.updatedAt as TimestampKind) && isGoodTimestampKind(t.lastUpdated as TimestampKind);
        if (okTs) timestampGoodCount += 1;
        else {
          timestampBadCount += 1;
          if (sampleBadTimestamp.length < 10) sampleBadTimestamp.push(postId);
        }
        if (audit.verify.ok) structureGoodCount += 1;
        else structureBadCount += 1;
      }
    }
    const nextRecommendedAction =
      missingParentCount + emptyParentCount > 0
        ? "Run async bulk restore job with missing_or_empty_only and chunkSize=100."
        : "No missing/empty parent docs remain. Run verify-last-run only.";
    return reply.send({
      ok: true,
      readOnly: true,
      totalBackupDocs,
      uniquePostIds: plan.uniquePostIdsConsidered,
      restoredExistingCount,
      healthyExistingCount,
      missingParentCount,
      emptyParentCount,
      wouldWriteCount: plan.wouldWriteCount,
      invalidBackupCount,
      rawBeforeOnlyCount,
      errorCount: plan.errorCount,
      sourceCounts: plan.sourceCounts,
      mediaKindCounts: plan.mediaKindCounts,
      timestampGoodCount,
      timestampBadCount,
      structureGoodCount,
      structureBadCount,
      sampleMissing,
      sampleInvalid,
      sampleBadTimestamp,
      sampleRestoredExisting,
      nextRecommendedAction
    });
  });

  app.post("/debug/post-canonical-backups/bulk-restore/apply", async (request, reply) => {
    const body = z
      .object({
        limit: z.coerce.number().int().min(1).max(20000).optional().default(20),
        source: z.enum(["auto", "compactLivePost", "canonicalPreview", "canonicalPreview.postDoc", "optimizedRaw"]).optional().default("auto"),
        restorePolicy: z.enum(["missing_or_empty_only", "replace_restored_only", "overwrite_existing"]).optional().default("missing_or_empty_only"),
        confirmation: z.string().optional(),
        overwriteConfirmation: z.string().optional(),
        offsetCursor: z.string().optional()
      })
      .parse(request.body ?? {});
    if (body.confirmation !== BULK_CONFIRMATION) {
      return reply.status(400).send({ ok: false, apply: true, wroteCount: 0, error: "CONFIRMATION_REQUIRED" });
    }
    if (body.limit > 200) {
      return reply.status(400).send({
        ok: false,
        apply: true,
        wroteCount: 0,
        error: "SYNC_LIMIT_EXCEEDED_USE_ASYNC_JOB",
        message: "For limit > 200 use /debug/post-canonical-backups/bulk-restore/start-job"
      });
    }
    if (body.restorePolicy === "overwrite_existing" && body.overwriteConfirmation !== OVERWRITE_CONFIRMATION) {
      return reply.status(400).send({ ok: false, apply: true, wroteCount: 0, error: "OVERWRITE_CONFIRMATION_REQUIRED" });
    }
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, apply: true, wroteCount: 0, error: "firestore_unavailable" });
    const runId = `bulk_${Date.now()}`;
    const startedAt = new Date().toISOString();
    bulkRunState = { runId, running: true, stopRequested: false, startedAt };

    const plan = await buildBulkPlan({
      db,
      limit: body.limit,
      offsetCursor: body.offsetCursor,
      source: body.source,
      restorePolicy: body.restorePolicy,
      includeExisting: body.restorePolicy === "overwrite_existing"
    });
    const itemsOut: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];
    let wroteCount = 0;
    let skippedCount = 0;
    let repairedCount = 0;
    let verifiedCount = 0;
    let verificationFailedCount = 0;
    let badTimestampCount = 0;
    let badStructureCount = 0;
    let errorCount = 0;

    for (const item of plan.items) {
      if (bulkRunState?.stopRequested) {
        itemsOut.push({ postId: item.postId, backupDocId: item.backupDocId, action: "skipped", reason: "STOP_REQUESTED" });
        skippedCount += 1;
        continue;
      }
      if (!item.wouldWrite) {
        itemsOut.push({
          postId: item.postId,
          backupDocId: item.backupDocId,
          sourceName: item.sourceName,
          beforeState: item.currentPostState,
          action: "skipped",
          reason: item.skipReason,
          title: item.title,
          assetCount: item.assetCount,
          mediaKind: item.mediaKind,
          likeCount: item.likeCount,
          commentCount: item.commentCount
        });
        skippedCount += 1;
        continue;
      }
      try {
        const postId = String(item.postId);
        const backupDocId = String(item.backupDocId);
        let payload = structuredClone(item.payload as Record<string, unknown>);
        forcePayloadAdminTimestamps(payload);
        let prewrite = assertRestorePayloadHasAdminTimestamps(payload);
        if (!prewrite.ok) {
          const repairedCandidate = normalizeRestoreTimestamps(structuredClone(payload), item.backupData as Record<string, unknown>, backupDocId).payload;
          forcePayloadAdminTimestamps(repairedCandidate);
          prewrite = assertRestorePayloadHasAdminTimestamps(repairedCandidate);
          payload = repairedCandidate;
        }
        if (!prewrite.ok) {
          errorCount += 1;
          badTimestampCount += 1;
          itemsOut.push({
            postId,
            backupDocId,
            sourceName: item.sourceName,
            beforeState: item.currentPostState,
            action: "error",
            reason: "PREWRITE_TIMESTAMP_INVALID",
            errors: prewrite.errors,
            timestampCheck: prewrite.kinds,
            postWriteVerified: false,
            repairAttempted: false,
            repairSucceeded: false
          });
          continue;
        }
        setNested(payload, "schema.restoreRunId", runId);
        setNested(payload, "schema.restoredFromCanonicalBackup", true);
        setNested(payload, "schema.restoreBackupDocId", backupDocId);
        setNested(payload, "schema.restoredAt", Timestamp.now());

        await db.collection("posts").doc(postId).set(payload, { merge: false });
        wroteCount += 1;
        let verification = await verifyRestoredPostParentDoc({
          db,
          postId,
          expectedBackupDocId: backupDocId,
          expectedRunId: runId
        });
        let repairAttempted = false;
        let repairSucceeded = false;
        let action: "wrote" | "repaired" | "error" = "wrote";
        let reason = "applied_and_verified";
        if (!verification.ok) {
          repairAttempted = true;
          const existingSnap = await db.collection("posts").doc(postId).get();
          const existing = (existingSnap.data() ?? {}) as Record<string, unknown>;
          const existingSchema =
            existing.schema && typeof existing.schema === "object" ? (existing.schema as Record<string, unknown>) : {};
          const allowedRepair =
            existingSchema.restoreRunId === runId || existingSchema.restoredFromCanonicalBackup === true;
          if (allowedRepair) {
            const backupSnap = await db.collection("postCanonicalBackups").doc(backupDocId).get();
            const backupData = (backupSnap.data() ?? {}) as Record<string, unknown>;
            const rebuiltPreview = buildRestorePreviewFromCanonicalBackupReadOnly({
              projectId: getFirestoreAdminIdentity().projectId ?? null,
              backupDocId,
              backupData,
              currentPostExists: true,
              currentPostData: existing,
              backupField: item.backupFieldUsed as CanonicalBackupField,
              allowOverwrite: true,
              previewIsoTimestamp: new Date().toISOString(),
              allowRawRestore: false
            });
            if (rebuiltPreview.ok) {
              const repairPayload = structuredClone(rebuiltPreview.restorePayloadPreview as Record<string, unknown>);
              forcePayloadAdminTimestamps(repairPayload);
              setNested(repairPayload, "schema.restoreRunId", runId);
              setNested(repairPayload, "schema.restoreRepairAttempt", 1);
              setNested(repairPayload, "schema.restoredFromCanonicalBackup", true);
              setNested(repairPayload, "schema.restoreBackupDocId", backupDocId);
              setNested(repairPayload, "schema.restoredAt", Timestamp.now());
              const repairPrewrite = assertRestorePayloadHasAdminTimestamps(repairPayload);
              if (repairPrewrite.ok) {
                await db.collection("posts").doc(postId).set(repairPayload, { merge: false });
                const secondVerify = await verifyRestoredPostParentDoc({
                  db,
                  postId,
                  expectedBackupDocId: backupDocId,
                  expectedRunId: runId
                });
                verification = secondVerify;
                if (secondVerify.ok) {
                  repairedCount += 1;
                  verifiedCount += 1;
                  repairSucceeded = true;
                  action = "repaired";
                  reason = "post_write_verify_failed_then_repaired";
                }
              }
            }
          }
        } else {
          verifiedCount += 1;
        }
        if (!verification.ok && !repairSucceeded) {
          verificationFailedCount += 1;
          errorCount += 1;
          action = "error";
          reason = "POST_WRITE_VERIFY_FAILED";
          if (verification.errors.some((e) => e.startsWith("bad_"))) badTimestampCount += 1;
          if (verification.errors.some((e) => e.startsWith("missing_"))) badStructureCount += 1;
        }
        itemsOut.push({
          postId,
          backupDocId,
          sourceName: item.sourceName,
          beforeState: item.currentPostState,
          action,
          reason,
          title: item.title,
          assetCount: item.assetCount,
          mediaKind: item.mediaKind,
          likeCount: item.likeCount,
          commentCount: item.commentCount,
          postWriteVerified: verification.ok,
          repairAttempted,
          repairSucceeded,
          timestampCheck: verification.timestampCheck,
          structureCheck: verification.structureCheck,
          errors: verification.errors,
          warnings: verification.warnings
        });
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        itemsOut.push({
          postId: item.postId,
          backupDocId: item.backupDocId,
          action: "error",
          reason: message,
          postWriteVerified: false,
          repairAttempted: false,
          repairSucceeded: false
        });
        errors.push({ postId: item.postId, backupDocId: item.backupDocId, error: message });
      }
    }
    const completedAt = new Date().toISOString();
    const report = {
      ok: true,
      apply: true,
      runId,
      startedAt,
      completedAt,
      durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      wroteCount,
      skippedCount,
      repairedCount,
      verifiedCount,
      verificationFailedCount,
      badTimestampCount,
      badStructureCount,
      errorCount,
      sourceCounts: plan.sourceCounts,
      stateCounts: plan.stateCounts,
      items: itemsOut,
      errors,
      nextCursor: plan.nextCursor
    };
    bulkRunState = { runId, running: false, stopRequested: false, startedAt, completedAt, report };
    return reply.send(report);
  });

  app.get("/debug/post-canonical-backups/bulk-restore/last-run", async (_request, reply) => {
    return reply.send({ ok: true, running: bulkRunState?.running ?? false, stopRequested: bulkRunState?.stopRequested ?? false, run: bulkRunState });
  });

  app.post("/debug/post-canonical-backups/bulk-restore/start-job", async (request, reply) => {
    const body = z
      .object({
        limit: z.coerce.number().int().min(1).max(50000).optional().default(200),
        source: z.enum(["auto", "compactLivePost", "canonicalPreview", "canonicalPreview.postDoc", "optimizedRaw"]).optional().default("auto"),
        restorePolicy: z.enum(["missing_or_empty_only", "replace_restored_only", "overwrite_existing"]).optional().default("missing_or_empty_only"),
        chunkSize: z.coerce.number().int().min(10).max(200).optional().default(100),
        confirmation: z.string().optional()
      })
      .parse(request.body ?? {});
    if (body.confirmation !== BULK_CONFIRMATION) return reply.status(400).send({ ok: false, error: "CONFIRMATION_REQUIRED" });
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const runId = `bulk_job_${Date.now()}`;
    const now = new Date().toISOString();
    bulkJobs.set(runId, {
      runId,
      state: "running",
      startedAt: now,
      lastUpdatedAt: now,
      totalPlanned: body.limit,
      processedCount: 0,
      wroteCount: 0,
      skippedCount: 0,
      repairedCount: 0,
      verifiedCount: 0,
      verificationFailedCount: 0,
      badTimestampCount: 0,
      badStructureCount: 0,
      errorCount: 0,
      currentPostId: null,
      currentBackupDocId: null,
      nextCursor: null,
      stopRequested: false,
      itemsSample: [],
      errorsSample: []
    });
    void runBulkRestoreJob({
      db,
      jobId: runId,
      source: body.source,
      restorePolicy: body.restorePolicy,
      chunkSize: body.chunkSize,
      limit: body.limit
    }).catch((error) => {
      const job = bulkJobs.get(runId);
      if (!job) return;
      job.state = "failed";
      job.lastUpdatedAt = new Date().toISOString();
      job.errorCount += 1;
      if (job.errorsSample.length < 30) job.errorsSample.push({ error: error instanceof Error ? error.message : String(error) });
    });
    return reply.send({ ok: true, runId, started: true });
  });

  app.get<{ Params: { runId: string } }>("/debug/post-canonical-backups/bulk-restore/jobs/:runId", async (request, reply) => {
    const params = z.object({ runId: z.string().min(1) }).parse(request.params);
    const job = bulkJobs.get(params.runId);
    if (!job) return reply.status(404).send({ ok: false, error: "job_not_found", runId: params.runId });
    return reply.send({ ...job });
  });

  app.post<{ Params: { runId: string } }>("/debug/post-canonical-backups/bulk-restore/jobs/:runId/stop", async (request, reply) => {
    const params = z.object({ runId: z.string().min(1) }).parse(request.params);
    const job = bulkJobs.get(params.runId);
    if (!job) return reply.status(404).send({ ok: false, error: "job_not_found", runId: params.runId });
    job.stopRequested = true;
    job.lastUpdatedAt = new Date().toISOString();
    return reply.send({ ok: true, runId: params.runId, stopRequested: true });
  });

  app.post("/debug/post-canonical-backups/bulk-restore/verify-run", async (request, reply) => {
    const body = z.object({ runId: z.string().min(1) }).parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const knownFirstRunPosts =
      body.runId === "bulk_1778096995079"
        ? [
            "0DR3fda5K4KWKKj4Spfp",
            "0DeNN73dUUiD1FxRUXua",
            "0GarvqNZv544v2WNNOwZ",
            "0I5lL14QiyiMU8nNXVZE",
            "0IEi1VrMerMxeMVO0A2w",
            "0JBUlGUhTFHdriaH2NuJ",
            "0OplEp6pJW1p6h6tVAqR",
            "0ZDgzL4zrHfqKSh5Bj6T",
            "0d5qByhMgrtMccWvjSQ5",
            "0eI3e5u0GDZf9O2GMuS8",
            "0f9kagpMqJkFYG2XdUzr",
            "0i6NaF1ElefeXPj6bSoz",
            "0q2HD0a28ta1jNrSMcaV",
            "0qcjjsO0IZNXBxLp1qkZ",
            "0r9L8ACrSuSKInDyDixe",
            "1145Np0j1TeeJJ5a6FoL",
            "16eCQLxvRgYrTnIm161i"
          ]
        : [];
    const fromLastRun = bulkRunState?.report?.items && Array.isArray((bulkRunState.report as Record<string, unknown>).items)
      ? (((bulkRunState.report as Record<string, unknown>).items as Array<Record<string, unknown>>)
          .filter((x) => x.action === "wrote" || x.action === "repaired")
          .map((x) => String(x.postId)))
      : [];
    const postIds = fromLastRun.length > 0 ? fromLastRun : knownFirstRunPosts;
    const out: Array<Record<string, unknown>> = [];
    let verifiedCount = 0;
    let badTimestampCount = 0;
    let badStructureCount = 0;
    let verificationFailedCount = 0;
    let repairedCount = 0;
    let errorCount = 0;
    for (const postId of postIds) {
      try {
        const postSnap = await db.collection("posts").doc(postId).get();
        const postData = (postSnap.data() ?? {}) as Record<string, unknown>;
        const backupDocId = String((postData.schema as Record<string, unknown> | undefined)?.restoreBackupDocId ?? "");
        const verify = await verifyRestoredPostParentDoc({ db, postId, expectedBackupDocId: backupDocId, expectedRunId: body.runId });
        let repaired = false;
        if (!verify.ok) {
          if ((postData.schema as Record<string, unknown> | undefined)?.restoredFromCanonicalBackup === true && backupDocId) {
            const backupSnap = await db.collection("postCanonicalBackups").doc(backupDocId).get();
            if (backupSnap.exists) {
              const backupData = (backupSnap.data() ?? {}) as Record<string, unknown>;
              const preview = buildRestorePreviewFromCanonicalBackupReadOnly({
                projectId: getFirestoreAdminIdentity().projectId ?? null,
                backupDocId,
                backupData,
                currentPostExists: true,
                currentPostData: postData,
                backupField: "auto",
                allowOverwrite: true,
                previewIsoTimestamp: new Date().toISOString(),
                allowRawRestore: false
              });
              if (preview.ok) {
                const repairPayload = structuredClone(preview.restorePayloadPreview as Record<string, unknown>);
                forcePayloadAdminTimestamps(repairPayload);
                setNested(repairPayload, "schema.restoreRunId", body.runId);
                setNested(repairPayload, "schema.restoreRepairAttempt", 1);
                setNested(repairPayload, "schema.restoredAt", Timestamp.now());
                await db.collection("posts").doc(postId).set(repairPayload, { merge: false });
                const verify2 = await verifyRestoredPostParentDoc({ db, postId, expectedBackupDocId: backupDocId, expectedRunId: body.runId });
                if (verify2.ok) {
                  repaired = true;
                  repairedCount += 1;
                  verifiedCount += 1;
                  out.push({ postId, action: "repaired", verification: verify2 });
                  continue;
                }
              }
            }
          }
        } else {
          verifiedCount += 1;
        }
        if (!verify.ok && !repaired) {
          verificationFailedCount += 1;
          if (verify.errors.some((e) => e.startsWith("bad_"))) badTimestampCount += 1;
          if (verify.errors.some((e) => e.startsWith("missing_"))) badStructureCount += 1;
        }
        out.push({ postId, action: verify.ok ? "verified" : "error", repaired, verification: verify });
      } catch (error) {
        errorCount += 1;
        out.push({ postId, action: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }
    return reply.send({
      ok: true,
      runId: body.runId,
      checkedCount: postIds.length,
      verifiedCount,
      repairedCount,
      badTimestampCount,
      badStructureCount,
      verificationFailedCount,
      errorCount,
      items: out
    });
  });

  app.get("/debug/post-canonical-backups/bulk-restore/total-count", async (_request, reply) => {
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const countSnap = await db.collection("postCanonicalBackups").count().get();
    return reply.send({ ok: true, totalBackupDocs: countSnap.data().count });
  });

  /** Read-only: total /posts docs vs docs that have a `time` field (via orderBy — excludes missing field). */
  app.get("/debug/posts/simple-counts", async (_request, reply) => {
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const projectId = getFirestoreAdminIdentity().projectId ?? null;
    if (projectId !== REQUIRED_PROJECT_ID) {
      return reply.status(400).send({
        ok: false,
        error: `wrong_project:${String(projectId)}`,
        requiredProjectId: REQUIRED_PROJECT_ID
      });
    }
    const postsCol = db.collection("posts");
    const totalPosts = (await postsCol.count().get()).data().count;
    let postsWithTimeField: number | null = null;
    let note = "";
    try {
      postsWithTimeField = (await postsCol.orderBy("time").count().get()).data().count;
      note =
        "postsWithTimeField = count of docs Firestore can include when ordering by `time` (field present; usually Timestamp).";
    } catch (error) {
      note =
        "orderBy(time) count failed (index may be missing). totalPosts is still valid. " +
        (error instanceof Error ? error.message : String(error));
    }
    const postsMissingTimeApprox =
      postsWithTimeField === null ? null : Math.max(0, totalPosts - postsWithTimeField);

    const totalCanonicalBackupDocs = (await db.collection("postCanonicalBackups").count().get()).data().count;

    return reply.send({
      ok: true,
      readOnly: true,
      totalPosts,
      postsWithTimeField,
      postsMissingTimeApprox,
      totalCanonicalBackupDocs,
      canonicalNote:
        "totalCanonicalBackupDocs = number of rows in postCanonicalBackups. Firestore cannot count distinct postIds from doc IDs without reading every document (not instant). Multiple backups can share one postId.",
      note
    });
  });

  app.post("/debug/post-canonical-backups/bulk-restore/stop", async (_request, reply) => {
    if (bulkRunState?.running) {
      bulkRunState.stopRequested = true;
      return reply.send({ ok: true, running: true, stopRequested: true });
    }
    return reply.send({ ok: true, running: false, stopRequested: false });
  });
}
