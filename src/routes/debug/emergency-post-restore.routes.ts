import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FieldPath } from "firebase-admin/firestore";
import { getFirestoreAdminIdentity, getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

const REQUIRED_PROJECT_ID = "learn-32d72";
const REQUIRED_CONFIRMATION_VALUE = "I_UNDERSTAND_RESTORE_POSTS";

type RestoreSourceField = "compactLivePost" | "canonicalPreview.postDoc" | "optimizedRaw";
type AnyRecord = Record<string, unknown>;

const DryRunBodySchema = z.object({
  postId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
  backupField: z.enum(["compactLivePost", "canonicalPreview.postDoc", "optimizedRaw"]).optional().default("compactLivePost")
});

const ApplyOneBodySchema = z.object({
  postId: z.string().min(1),
  backupField: z.enum(["compactLivePost", "canonicalPreview.postDoc", "optimizedRaw"]).optional().default("compactLivePost"),
  confirmationPhrase: z.string().min(1)
});

function parseBackupDocId(backupDocId: string): { postId: string; timestampMs: number | null } {
  const idx = backupDocId.lastIndexOf("_");
  if (idx <= 0) return { postId: backupDocId, timestampMs: null };
  const postId = backupDocId.slice(0, idx);
  const suffix = backupDocId.slice(idx + 1);
  const ts = Number.parseInt(suffix, 10);
  return { postId, timestampMs: Number.isFinite(ts) ? ts : null };
}

function hasMeaningfulDocData(data: AnyRecord): boolean {
  const keys = Object.keys(data);
  if (keys.length === 0) return false;
  return keys.some((k) => !["updatedAt", "lastUpdated", "__name__"].includes(k));
}

function pickRestoreSource(
  backup: AnyRecord,
  preferred: "compactLivePost" | "canonicalPreview.postDoc" | "optimizedRaw"
): { field: RestoreSourceField | null; payload: AnyRecord | null } {
  const canonicalPreview = (backup.canonicalPreview ?? null) as AnyRecord | null;
  const ordered: Array<{ field: RestoreSourceField; value: unknown }> = [
    { field: preferred, value: preferred === "canonicalPreview.postDoc" ? canonicalPreview?.postDoc : backup[preferred] },
    { field: "compactLivePost", value: backup.compactLivePost },
    { field: "canonicalPreview.postDoc", value: canonicalPreview?.postDoc },
    { field: "optimizedRaw", value: backup.optimizedRaw }
  ];
  for (const row of ordered) {
    if (row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
      return { field: row.field, payload: { ...(row.value as AnyRecord) } };
    }
  }
  return { field: null, payload: null };
}

function hasMediaLike(payload: AnyRecord): boolean {
  if (Array.isArray(payload.media) && payload.media.length > 0) return true;
  if (payload.media && typeof payload.media === "object") {
    const media = payload.media as AnyRecord;
    if (Array.isArray(media.assets) && media.assets.length > 0) return true;
    if (Object.keys(media).length > 0) return true;
  }
  if (Array.isArray(payload.assets) && payload.assets.length > 0) return true;
  return false;
}

function validatePayload(payload: AnyRecord): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!(typeof payload.id === "string" && payload.id.trim().length > 0)) reasons.push("missing_id");
  if (!hasMediaLike(payload)) reasons.push("missing_media_like");
  if (!((payload.author && typeof payload.author === "object") || typeof payload.userId === "string")) {
    reasons.push("missing_author_or_userId");
  }
  if (!((payload.lifecycle && typeof payload.lifecycle === "object") || typeof payload.status === "string")) {
    reasons.push("missing_lifecycle_or_status");
  }
  return { ok: reasons.length === 0, reasons };
}

function normalizePayload(postId: string, payload: AnyRecord, backupDocId: string): AnyRecord {
  const out: AnyRecord = { ...payload };
  out.id = postId;
  out.postId = typeof out.postId === "string" && out.postId.trim().length > 0 ? out.postId : postId;
  const schema = out.schema && typeof out.schema === "object" ? { ...(out.schema as AnyRecord) } : {};
  schema.restoredFromCanonicalBackup = true;
  schema.restoredAt = new Date().toISOString();
  schema.restoreBackupDocId = backupDocId;
  out.schema = schema;
  return out;
}

async function loadLatestBackupForPostId(db: NonNullable<ReturnType<typeof getFirestoreSourceClient>>, postId: string): Promise<{
  backupDocId: string;
  ts: number | null;
  data: AnyRecord;
} | null> {
  const start = `${postId}_`;
  const end = `${postId}_\uf8ff`;
  try {
    const snap = await db
      .collection("postCanonicalBackups")
      .where(FieldPath.documentId(), ">=", start)
      .where(FieldPath.documentId(), "<=", end)
      .orderBy(FieldPath.documentId(), "desc")
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (!doc) return null;
    const parsed = parseBackupDocId(doc.id);
    return { backupDocId: doc.id, ts: parsed.timestampMs, data: (doc.data() ?? {}) as AnyRecord };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const requiresIndex = message.includes("requires an index");
    if (!requiresIndex) throw error;
    const fallback = await db.collection("postCanonicalBackups").limit(5000).get();
    let latest: { backupDocId: string; ts: number | null; data: AnyRecord } | null = null;
    for (const doc of fallback.docs) {
      if (!doc.id.startsWith(`${postId}_`)) continue;
      const parsed = parseBackupDocId(doc.id);
      const candidate = { backupDocId: doc.id, ts: parsed.timestampMs, data: (doc.data() ?? {}) as AnyRecord };
      if (!latest || (candidate.ts ?? -1) > (latest.ts ?? -1)) latest = candidate;
    }
    return latest;
  }
}

function renderPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Post Canonical Backups Lookup</title>
    <style>
      body { font-family: Inter, Arial, sans-serif; margin: 20px; background: #0f172a; color: #e2e8f0; }
      h1 { margin: 0 0 12px 0; }
      .panel { border: 1px solid #334155; border-radius: 10px; padding: 12px; background: #111827; margin-bottom: 12px; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
      input, select { background: #1f2937; border: 1px solid #334155; color: #fff; border-radius: 8px; padding: 8px 10px; }
      button { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
      button.secondary { background: #334155; }
      pre { white-space: pre-wrap; word-break: break-word; background: #020617; padding: 10px; border-radius: 8px; max-height: 320px; overflow: auto; }
      .warn { color: #fbbf24; }
      .danger { color: #f87171; }
      a { color: #93c5fd; text-decoration: none; }
      .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 12px; margin-right: 8px; margin-top: 4px; }
      .badge.green { background: #14532d; color: #bbf7d0; border: 1px solid #166534; }
      .badge.yellow { background: #713f12; color: #fef08a; border: 1px solid #a16207; }
      .badge.red { background: #7f1d1d; color: #fecaca; border: 1px solid #991b1b; }
    </style>
  </head>
  <body>
    <h1>Post Canonical Backups Lookup</h1>
    <div class="row"><a href="/admin">← Admin</a></div>
    <div class="panel">
      <div class="warn">Read-only lookup: fetch one backup document by its document ID.</div>
    </div>
    <div class="panel">
      <h3>Posts vs canonical backups — instant counts (read-only)</h3>
      <div class="warn" style="font-size:12px;margin-bottom:6px">Uses Firestore <code>count()</code> only — fast. Distinct postIds per backup would require a full scan (not available here).</div>
      <div class="row">
        <button onclick="fetchPostsSimpleCounts()">Fetch counts</button>
      </div>
      <pre id="postsSimpleCountsOut" style="max-height:220px"></pre>
    </div>
    <div class="panel">
      <h3>Lookup</h3>
      <div class="row">
        <label>Backup Doc ID <input id="backupDocId" value="FNM5327GjX7VOI7wUXGW_1778036149336" style="min-width:420px" /></label>
        <button onclick="lookupBackupDoc()">Fetch Backup Doc</button>
        <button class="secondary" onclick="dryRunRestorePreview()">Dry Run Restore Preview</button>
      </div>
      <div id="previewStatus" class="row" style="min-height:28px"></div>
      <pre id="lookupOut"></pre>
      <h3 style="margin-top:16px;font-size:14px;opacity:.9">Restore preview (read-only)</h3>
      <pre id="previewOut" style="max-height:480px"></pre>

      <h3 style="margin-top:16px;font-size:14px;opacity:.9">Apply One (writes exactly one parent doc)</h3>
      <div class="row">
        <label>Backup Field
          <select id="applyBackupField">
            <option value="auto">auto</option>
            <option value="compactLivePost">compactLivePost</option>
            <option value="canonicalPreview">canonicalPreview</option>
            <option value="canonicalPreview.postDoc">canonicalPreview.postDoc</option>
            <option value="optimizedRaw">optimizedRaw</option>
            <option value="rawBefore">rawBefore (preview only)</option>
          </select>
        </label>
        <button id="applyOneBtn" class="secondary" onclick="applyOneRestore()">Apply One</button>
        <button class="secondary" onclick="verifyRestoredPost()">Verify Restored Post</button>
      </div>
      <div class="warn" style="font-size:12px;margin-bottom:6px">Apply One will write exactly one parent doc: /posts/{inferredPostId}. It will not touch likes/comments subcollections.</div>
      <pre id="applyOut" style="max-height:360px"></pre>
      <pre id="verifyOut" style="max-height:240px"></pre>
    </div>
    <div class="panel">
      <h3>Emergency Bulk Post Restore</h3>
      <div class="warn" style="font-size:12px;margin-bottom:6px">NO DELETES. BACKUPS UNTOUCHED. SUBCOLLECTIONS UNTOUCHED. EXISTING HEALTHY DOCS SKIPPED BY DEFAULT.</div>
      <div class="danger" style="font-size:12px;margin-bottom:6px">The previous ALL restore request aborted after 120 seconds. This may be a browser timeout. Do not assume writes failed. Run Audit Restore State before applying again.</div>
      <div class="row">
        <label>Limit
          <input id="bulkLimit" type="number" min="1" max="20000" value="20" style="width:100px" />
        </label>
        <button class="secondary" onclick="setBulkLimitAll()">ALL</button>
        <span id="bulkTotalLabel" style="font-size:12px;opacity:.85"></span>
        <label>Source
          <select id="bulkSource">
            <option value="auto">auto</option>
            <option value="compactLivePost">compactLivePost</option>
            <option value="canonicalPreview">canonicalPreview</option>
            <option value="canonicalPreview.postDoc">canonicalPreview.postDoc</option>
            <option value="optimizedRaw">optimizedRaw</option>
          </select>
        </label>
        <label>Restore Policy
          <select id="bulkPolicy">
            <option value="missing_or_empty_only">missing_or_empty_only</option>
            <option value="replace_restored_only">replace_restored_only</option>
          </select>
        </label>
      </div>
      <div class="row">
        <label>Confirmation
          <input id="bulkConfirmation" placeholder="I_UNDERSTAND_BULK_RESTORE_POSTS" style="min-width:320px" oninput="syncBulkApplyState()" />
        </label>
        <button onclick="previewBulkRestore()">Preview Bulk Restore</button>
        <button id="bulkApplyBtn" class="secondary" onclick="applyBulkRestore()" disabled>Apply Bulk Restore</button>
        <button class="secondary" onclick="prefillBulkConfirmation()">Use Correct Confirmation</button>
        <button class="secondary" onclick="refreshBulkLastRun()">Refresh Last Run</button>
        <button class="secondary" onclick="verifyLastBulkRun()">Verify Last Bulk Run</button>
        <button class="secondary" onclick="auditRestoreStateAfterAbortedRun()">Audit Restore State After Aborted Run</button>
        <button class="secondary" onclick="continueMissingOnly()">Continue Missing Only</button>
        <button class="secondary" onclick="stopBulkRun()">Stop/Pause</button>
        <button class="secondary" onclick="exportBulkReportJson()">Export report JSON</button>
      </div>
      <div id="bulkApplyStateHint" class="warn" style="font-size:12px;margin-bottom:6px">Apply disabled until confirmation matches: I_UNDERSTAND_BULK_RESTORE_POSTS</div>
      <pre id="bulkProgressOut" style="max-height:220px"></pre>
      <pre id="bulkOut" style="max-height:380px"></pre>
    </div>
    <script>
      function set(id, value) { document.getElementById(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
      async function fetchPostsSimpleCounts() {
        set('postsSimpleCountsOut', 'Loading...');
        const out = await getJson('/debug/posts/simple-counts', 30000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        set('postsSimpleCountsOut', { httpStatus: out.status, ...out.body, clickedAt: new Date().toISOString() });
      }
      async function getJson(url, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
        const res = await fetch(url, { method: 'GET', signal: controller.signal }).finally(() => clearTimeout(timer));
        const body = await res.json().catch(() => ({}));
        return { status: res.status, body };
      }
      async function postJson(url, payload, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        }).finally(() => clearTimeout(timer));
        const body = await res.json().catch(() => ({}));
        return { status: res.status, body };
      }
      function getInferredPostIdFromBackupDocId() {
        const backupDocId = document.getElementById('backupDocId').value.trim();
        const idx = backupDocId.lastIndexOf('_');
        return idx > 0 ? backupDocId.slice(0, idx) : backupDocId;
      }
      async function lookupBackupDoc() {
        const backupDocId = document.getElementById('backupDocId').value.trim();
        if (!backupDocId) {
          set('lookupOut', { ok: false, error: 'backupDocId_required' });
          return;
        }
        set('lookupOut', 'Fetching backup doc...');
        const out = await getJson('/debug/emergency-post-restore/backup-doc/' + encodeURIComponent(backupDocId), 15000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        set('lookupOut', { httpStatus: out.status, ...out.body, clickedAt: new Date().toISOString() });
      }
      async function dryRunRestorePreview() {
        const backupDocId = document.getElementById('backupDocId').value.trim();
        const statusEl = document.getElementById('previewStatus');
        if (!backupDocId) {
          set('previewOut', { ok: false, error: 'backupDocId_required' });
          statusEl.innerHTML = '';
          return;
        }
        set('previewOut', 'Loading restore preview (read-only)...');
        statusEl.innerHTML = '<span class="badge green">Read-only preview. No write performed.</span>';
        const backupField = document.getElementById('applyBackupField').value;
        const url =
          '/debug/post-canonical-backups/' +
          encodeURIComponent(backupDocId) +
          '/restore-preview?backupField=' +
          encodeURIComponent(backupField) +
          '&allowOverwrite=false';
        const out = await getJson(url, 60000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        const body = out.body || {};
        set('previewOut', { httpStatus: out.status, ...body, clickedAt: new Date().toISOString() });
        let badges = '<span class="badge green">Read-only preview. No write performed.</span>';
        if (body.decision && body.decision.wouldWrite && (body.currentPostDoc?.state === 'missing' || body.currentPostDoc?.state === 'empty')) {
          badges += '<span class="badge yellow">Would create/replace missing or empty parent doc only (subcollections untouched).</span>';
        } else if (body.decision && body.decision.wouldWrite && body.currentPostDoc?.state === 'has_data') {
          badges += '<span class="badge yellow">Would overwrite parent doc if applied (preview only; not executed).</span>';
        }
        if (body.validation && body.validation.valid === false) {
          badges += '<span class="badge red">Validation errors — review before any real restore.</span>';
        }
        statusEl.innerHTML = badges;
      }
      async function applyOneRestore() {
        const backupDocId = document.getElementById('backupDocId').value.trim();
        const backupField = document.getElementById('applyBackupField').value;
        if (!backupDocId) {
          set('applyOut', { ok: false, error: 'backupDocId_required' });
          return;
        }
        set('applyOut', 'Applying one parent-doc restore...');
        const url = '/debug/post-canonical-backups/' + encodeURIComponent(backupDocId) + '/apply-one';
        const out = await postJson(
          url,
          { backupField, allowOverwrite: false },
          60000
        ).catch((error) => ({ status: 0, body: { ok: false, wrote: false, error: String(error) } }));
        const body = out.body || {};
        const response = { httpStatus: out.status, ...body, clickedAt: new Date().toISOString() };
        if (body && body.wrote === true) {
          response.banner = 'RESTORED ONE POST PARENT DOC';
        }
        set('applyOut', response);
      }
      async function verifyRestoredPost() {
        const postId = getInferredPostIdFromBackupDocId();
        if (!postId) {
          set('verifyOut', { ok: false, error: 'cannot_infer_postId' });
          return;
        }
        set('verifyOut', 'Verifying restored post...');
        const out = await getJson('/debug/posts/' + encodeURIComponent(postId) + '/restore-verify', 30000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        set('verifyOut', { httpStatus: out.status, ...out.body, checkedAt: new Date().toISOString() });
      }
      function syncBulkApplyState() {
        const v = document.getElementById('bulkConfirmation').value.trim();
        document.getElementById('bulkApplyBtn').disabled = v !== 'I_UNDERSTAND_BULK_RESTORE_POSTS';
      }
      function getBulkParams() {
        return {
          limit: Number(document.getElementById('bulkLimit').value || 20),
          source: document.getElementById('bulkSource').value,
          restorePolicy: document.getElementById('bulkPolicy').value
        };
      }
      function setBulkButtonsDisabled(disabled) {
        const applyBtn = document.getElementById('bulkApplyBtn');
        const matches = document.getElementById('bulkConfirmation').value.trim() === 'I_UNDERSTAND_BULK_RESTORE_POSTS';
        applyBtn.disabled = disabled || !matches;
        const hint = document.getElementById('bulkApplyStateHint');
        if (disabled) {
          hint.textContent = 'Apply in progress...';
          hint.className = 'warn';
        } else if (!matches) {
          hint.textContent = 'Apply disabled: enter exact confirmation I_UNDERSTAND_BULK_RESTORE_POSTS';
          hint.className = 'danger';
        } else {
          hint.textContent = 'Apply enabled: confirmation matched.';
          hint.className = 'warn';
        }
      }
      function prefillBulkConfirmation() {
        document.getElementById('bulkConfirmation').value = 'I_UNDERSTAND_BULK_RESTORE_POSTS';
        setBulkButtonsDisabled(false);
      }
      let activeJobPoll = null;
      async function startAsyncBulkJob(p, confirmation) {
        const out = await postJson('/debug/post-canonical-backups/bulk-restore/start-job', { ...p, confirmation, chunkSize: 100 }, 30000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        const body = out.body || {};
        if (!body.ok || !body.runId) {
          set('bulkProgressOut', { state: 'JOB_START_FAILED', httpStatus: out.status, ...body });
          return;
        }
        const runId = body.runId;
        set('bulkProgressOut', { state: 'JOB_STARTED', runId, status: 'Async bulk restore running on server...' });
        if (activeJobPoll) clearInterval(activeJobPoll);
        activeJobPoll = setInterval(async () => {
          const status = await getJson('/debug/post-canonical-backups/bulk-restore/jobs/' + encodeURIComponent(runId), 15000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
          const jb = status.body || {};
          set('bulkProgressOut', {
            runId,
            state: jb.state || 'unknown',
            totalPlanned: jb.totalPlanned,
            processedCount: jb.processedCount,
            wroteCount: jb.wroteCount,
            skippedCount: jb.skippedCount,
            repairedCount: jb.repairedCount,
            verifiedCount: jb.verifiedCount,
            verificationFailedCount: jb.verificationFailedCount,
            badTimestampCount: jb.badTimestampCount,
            badStructureCount: jb.badStructureCount,
            errorCount: jb.errorCount,
            currentPostId: jb.currentPostId,
            currentBackupDocId: jb.currentBackupDocId,
            updatedAt: jb.lastUpdatedAt
          });
          if (jb.state === 'completed' || jb.state === 'failed' || jb.state === 'stopped') {
            clearInterval(activeJobPoll);
            activeJobPoll = null;
            set('bulkOut', { httpStatus: status.status, ...jb, checkedAt: new Date().toISOString() });
            setBulkButtonsDisabled(false);
          }
        }, 2000);
      }
      async function previewBulkRestore() {
        const p = getBulkParams();
        set('bulkProgressOut', 'Running bulk preview...');
        const q = new URLSearchParams({ limit: String(p.limit), source: p.source, restorePolicy: p.restorePolicy, includeExisting: 'false' });
        const out = await getJson('/debug/post-canonical-backups/bulk-restore/preview?' + q.toString(), 120000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        const body = out.body || {};
        set('bulkProgressOut', { summary: { wouldWriteCount: body.wouldWriteCount, skipCount: body.skipCount, errorCount: body.errorCount, sourceCounts: body.sourceCounts, stateCounts: body.stateCounts }, checkedAt: new Date().toISOString() });
        set('bulkOut', { httpStatus: out.status, ...body });
      }
      async function setBulkLimitAll() {
        set('bulkProgressOut', { state: 'LOADING_TOTAL', status: 'Fetching total backup doc count...' });
        const out = await getJson('/debug/post-canonical-backups/bulk-restore/total-count', 30000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        const body = out.body || {};
        if (out.status !== 200 || !body.ok) {
          set('bulkProgressOut', { state: 'TOTAL_COUNT_FAILED', httpStatus: out.status, ...body });
          return;
        }
        const total = Number(body.totalBackupDocs || 0);
        document.getElementById('bulkLimit').value = String(total);
        document.getElementById('bulkTotalLabel').textContent = 'Total backups: ' + total + ' (limit set to ALL)';
        set('bulkProgressOut', { state: 'TOTAL_COUNT_READY', totalBackupDocs: total, limitSetTo: total });
      }
      async function applyBulkRestore() {
        const p = getBulkParams();
        const confirmation = document.getElementById('bulkConfirmation').value.trim();
        setBulkButtonsDisabled(true);
        const startedAt = Date.now();
        if (p.limit > 200) {
          set('bulkProgressOut', { state: 'SWITCH_TO_ASYNC', warning: 'Large run detected (>200). Starting async job mode.' });
          await startAsyncBulkJob(p, confirmation);
          return;
        }
        let tick = 0;
        const timer = setInterval(() => {
          tick += 1;
          set('bulkProgressOut', {
            state: 'APPLYING',
            status: 'Applying bulk post restore now...',
            current: String(tick) + 's elapsed',
            limit: p.limit,
            source: p.source,
            restorePolicy: p.restorePolicy,
            runningCounts: { wrote: 0, skipped: 0, error: 0 }
          });
        }, 1000);
        const out = await postJson('/debug/post-canonical-backups/bulk-restore/apply', { ...p, confirmation }, 120000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        clearInterval(timer);
        const body = out.body || {};
        set('bulkProgressOut', {
          state: body.ok ? 'COMPLETED' : 'FAILED',
          summary: {
            wroteCount: body.wroteCount ?? 0,
            skippedCount: body.skippedCount ?? 0,
            errorCount: body.errorCount ?? 0
          },
          durationMs: Date.now() - startedAt,
          completedAt: body.completedAt || new Date().toISOString()
        });
        set('bulkOut', { httpStatus: out.status, ...body });
        setBulkButtonsDisabled(false);
      }
      async function refreshBulkLastRun() {
        const out = await getJson('/debug/post-canonical-backups/bulk-restore/last-run', 20000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        set('bulkOut', { httpStatus: out.status, ...out.body, checkedAt: new Date().toISOString() });
      }
      async function verifyLastBulkRun() {
        set('bulkProgressOut', { state: 'VERIFYING_LAST_RUN', runId: 'bulk_1778096995079', startedAt: new Date().toISOString() });
        const out = await postJson('/debug/post-canonical-backups/bulk-restore/verify-run', { runId: 'bulk_1778096995079' }, 120000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        const body = out.body || {};
        set('bulkProgressOut', {
          state: body.ok ? 'VERIFY_COMPLETED' : 'VERIFY_FAILED',
          checkedCount: body.checkedCount ?? 0,
          verifiedCount: body.verifiedCount ?? 0,
          repairedCount: body.repairedCount ?? 0,
          badTimestampCount: body.badTimestampCount ?? 0,
          badStructureCount: body.badStructureCount ?? 0,
          verificationFailedCount: body.verificationFailedCount ?? 0,
          errorCount: body.errorCount ?? 0
        });
        set('bulkOut', { httpStatus: out.status, ...body, checkedAt: new Date().toISOString() });
      }
      async function stopBulkRun() {
        const last = await getJson('/debug/post-canonical-backups/bulk-restore/last-run', 10000).catch(() => ({ status: 0, body: {} }));
        const runId = last.body?.run?.runId;
        const out = runId
          ? await postJson('/debug/post-canonical-backups/bulk-restore/jobs/' + encodeURIComponent(runId) + '/stop', {}, 20000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }))
          : await postJson('/debug/post-canonical-backups/bulk-restore/stop', {}, 20000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        set('bulkProgressOut', { httpStatus: out.status, ...out.body, requestedAt: new Date().toISOString() });
      }
      async function auditRestoreStateAfterAbortedRun() {
        set('bulkProgressOut', { state: 'AUDITING', status: 'Running read-only full restore state audit...' });
        const totalOut = await getJson('/debug/post-canonical-backups/bulk-restore/total-count', 30000).catch(() => ({ status: 0, body: {} }));
        const total = Number(totalOut.body?.totalBackupDocs || 1250);
        const q = new URLSearchParams({ limit: String(total), source: document.getElementById('bulkSource').value, restorePolicy: document.getElementById('bulkPolicy').value });
        const out = await getJson('/debug/post-canonical-backups/bulk-restore/audit-state?' + q.toString(), 120000).catch((error) => ({ status: 0, body: { ok: false, error: String(error) } }));
        const body = out.body || {};
        set('bulkProgressOut', {
          state: body.ok ? 'AUDIT_COMPLETED' : 'AUDIT_FAILED',
          totalBackupDocs: body.totalBackupDocs,
          restoredExistingCount: body.restoredExistingCount,
          missingParentCount: body.missingParentCount,
          emptyParentCount: body.emptyParentCount,
          wouldWriteCount: body.wouldWriteCount,
          invalidBackupCount: body.invalidBackupCount,
          badTimestampCount: body.timestampBadCount,
          badStructureCount: body.structureBadCount,
          nextRecommendedAction: body.nextRecommendedAction
        });
        set('bulkOut', { httpStatus: out.status, ...body, checkedAt: new Date().toISOString() });
      }
      async function continueMissingOnly() {
        const confirmation = document.getElementById('bulkConfirmation').value.trim();
        const totalOut = await getJson('/debug/post-canonical-backups/bulk-restore/total-count', 30000).catch(() => ({ status: 0, body: {} }));
        const total = Number(totalOut.body?.totalBackupDocs || 1250);
        const p = { limit: total, source: document.getElementById('bulkSource').value, restorePolicy: 'missing_or_empty_only' };
        set('bulkProgressOut', { state: 'CONTINUE_MISSING_ONLY', status: 'Starting async missing_or_empty_only continuation job...' });
        await startAsyncBulkJob(p, confirmation);
      }
      function exportBulkReportJson() {
        const content = document.getElementById('bulkOut').textContent || '{}';
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bulk-restore-report-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      syncBulkApplyState();
      document.getElementById('bulkConfirmation').addEventListener('input', () => setBulkButtonsDisabled(false));
      setBulkButtonsDisabled(false);
    </script>
  </body>
</html>`;
}

export async function registerEmergencyPostRestoreRoutes(app: FastifyInstance): Promise<void> {
  app.get("/debug/emergency-post-restore", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderPage());
  });

  app.get("/debug/emergency-post-restore/summary", async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(5000).optional().default(500) }).parse(request.query);
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const projectId = getFirestoreAdminIdentity().projectId ?? null;
    if (projectId !== REQUIRED_PROJECT_ID) {
      return reply.status(400).send({ ok: false, error: `wrong_project:${String(projectId)}`, requiredProjectId: REQUIRED_PROJECT_ID });
    }
    const backups = await db.collection("postCanonicalBackups").limit(query.limit).get();
    const grouped = new Map<string, { backupDocId: string; ts: number | null; data: AnyRecord }>();
    for (const doc of backups.docs) {
      const parsed = parseBackupDocId(doc.id);
      const existing = grouped.get(parsed.postId);
      const candidate = { backupDocId: doc.id, ts: parsed.timestampMs, data: (doc.data() ?? {}) as AnyRecord };
      if (!existing || (candidate.ts ?? -1) > (existing.ts ?? -1)) grouped.set(parsed.postId, candidate);
    }
    let restoreable = 0;
    let missingOrEmptyParent = 0;
    let existingMeaningfulParent = 0;
    const sample: Array<Record<string, unknown>> = [];
    for (const [postId, chosen] of grouped.entries()) {
      const picked = pickRestoreSource(chosen.data, "compactLivePost");
      if (picked.field) restoreable += 1;
      const postSnap = await db.collection("posts").doc(postId).get();
      const postData = (postSnap.data() ?? {}) as AnyRecord;
      const meaningful = postSnap.exists && hasMeaningfulDocData(postData);
      if (meaningful) existingMeaningfulParent += 1;
      else missingOrEmptyParent += 1;
      if (sample.length < 20) {
        sample.push({ postId, backupDocId: chosen.backupDocId, restoreSource: picked.field, parentExists: postSnap.exists, parentMeaningful: meaningful });
      }
    }
    return {
      ok: true,
      projectId,
      countedBackupDocs: backups.size,
      uniquePostIdsFromBackups: grouped.size,
      restoreableLatestBackups: restoreable,
      existingMeaningfulParent,
      missingOrEmptyParent,
      remainingToRestoreEstimate: Math.max(0, Math.min(restoreable, missingOrEmptyParent)),
      sample
    };
  });

  app.get<{ Params: { postId: string } }>("/debug/emergency-post-restore/backups/:postId", async (request, reply) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const projectId = getFirestoreAdminIdentity().projectId ?? null;
    if (projectId !== REQUIRED_PROJECT_ID) {
      return reply.status(400).send({ ok: false, error: `wrong_project:${String(projectId)}`, requiredProjectId: REQUIRED_PROJECT_ID });
    }

    // Fast lookup path: query backup payload ids directly.
    const [compactSnap, canonicalSnap, optimizedSnap] = await Promise.all([
      db.collection("postCanonicalBackups").where("compactLivePost.id", "==", params.postId).limit(50).get(),
      db.collection("postCanonicalBackups").where("canonicalPreview.postDoc.id", "==", params.postId).limit(50).get(),
      db.collection("postCanonicalBackups").where("optimizedRaw.id", "==", params.postId).limit(50).get()
    ]);
    const byId = new Map<string, AnyRecord>();
    for (const snap of [compactSnap, canonicalSnap, optimizedSnap]) {
      for (const doc of snap.docs) {
        byId.set(doc.id, (doc.data() ?? {}) as AnyRecord);
      }
    }
    const docs: Array<{ backupDocId: string; timestampMs: number | null; fieldCandidates: Record<string, boolean>; data: AnyRecord }> =
      Array.from(byId.entries())
        .map(([docId, data]) => {
          const parsed = parseBackupDocId(docId);
          return {
            backupDocId: docId,
            timestampMs: parsed.timestampMs,
            fieldCandidates: {
              compactLivePost: Boolean(data.compactLivePost && typeof data.compactLivePost === "object"),
              canonicalPreviewPostDoc: Boolean(
                data.canonicalPreview &&
                  typeof data.canonicalPreview === "object" &&
                  (data.canonicalPreview as AnyRecord).postDoc &&
                  typeof (data.canonicalPreview as AnyRecord).postDoc === "object"
              ),
              optimizedRaw: Boolean(data.optimizedRaw && typeof data.optimizedRaw === "object")
            },
            data
          };
        })
        .sort((a, b) => (b.timestampMs ?? -1) - (a.timestampMs ?? -1));

    return {
      ok: true,
      projectId,
      postId: params.postId,
      count: docs.length,
      latestBackupDocId: docs[0]?.backupDocId ?? null,
      queryCounts: {
        compactLivePost: compactSnap.size,
        canonicalPreviewPostDoc: canonicalSnap.size,
        optimizedRaw: optimizedSnap.size
      },
      backups: docs
    };
  });

  app.get<{ Params: { backupDocId: string } }>("/debug/emergency-post-restore/backup-doc/:backupDocId", async (request, reply) => {
    const params = z.object({ backupDocId: z.string().min(1) }).parse(request.params);
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const projectId = getFirestoreAdminIdentity().projectId ?? null;
    if (projectId !== REQUIRED_PROJECT_ID) {
      return reply.status(400).send({ ok: false, error: `wrong_project:${String(projectId)}`, requiredProjectId: REQUIRED_PROJECT_ID });
    }

    const doc = await db.collection("postCanonicalBackups").doc(params.backupDocId).get();
    if (!doc.exists) {
      return reply.status(404).send({ ok: false, error: "backup_doc_not_found", backupDocId: params.backupDocId });
    }
    const data = (doc.data() ?? {}) as AnyRecord;
    const parsed = parseBackupDocId(doc.id);
    return {
      ok: true,
      projectId,
      backupDocId: doc.id,
      inferredPostId: parsed.postId,
      timestampMs: parsed.timestampMs,
      fieldCandidates: {
        compactLivePost: Boolean(data.compactLivePost && typeof data.compactLivePost === "object"),
        canonicalPreviewPostDoc: Boolean(
          data.canonicalPreview &&
            typeof data.canonicalPreview === "object" &&
            (data.canonicalPreview as AnyRecord).postDoc &&
            typeof (data.canonicalPreview as AnyRecord).postDoc === "object"
        ),
        optimizedRaw: Boolean(data.optimizedRaw && typeof data.optimizedRaw === "object")
      },
      backup: data
    };
  });

  app.post("/debug/emergency-post-restore/dry-run", async (request, reply) => {
    const body = DryRunBodySchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const projectId = getFirestoreAdminIdentity().projectId ?? null;
    if (projectId !== REQUIRED_PROJECT_ID) {
      return reply.status(400).send({ ok: false, error: `wrong_project:${String(projectId)}`, requiredProjectId: REQUIRED_PROJECT_ID });
    }

    const latestByPostId = new Map<string, { backupDocId: string; ts: number | null; data: AnyRecord }>();
    if (body.postId) {
      const latest = await loadLatestBackupForPostId(db, body.postId);
      if (latest) latestByPostId.set(body.postId, latest);
    } else {
      const backupsSnap = await db.collection("postCanonicalBackups").limit(body.limit ?? 200).get();
      for (const doc of backupsSnap.docs) {
        const parsed = parseBackupDocId(doc.id);
        const existing = latestByPostId.get(parsed.postId);
        const candidate = { backupDocId: doc.id, ts: parsed.timestampMs, data: (doc.data() ?? {}) as AnyRecord };
        if (!existing || (candidate.ts ?? -1) > (existing.ts ?? -1)) latestByPostId.set(parsed.postId, candidate);
      }
    }

    const rows: Array<Record<string, unknown>> = [];
    for (const [postId, backup] of latestByPostId.entries()) {
      const picked = pickRestoreSource(backup.data, body.backupField);
      if (!picked.payload || !picked.field) {
        rows.push({ postId, backupDocId: backup.backupDocId, action: "skip_no_restore_source" });
        continue;
      }
      const normalized = normalizePayload(postId, picked.payload, backup.backupDocId);
      const validation = validatePayload(normalized);
      const postSnap = await db.collection("posts").doc(postId).get();
      const postData = (postSnap.data() ?? {}) as AnyRecord;
      const meaningful = postSnap.exists && hasMeaningfulDocData(postData);
      if (!validation.ok) {
        rows.push({ postId, backupDocId: backup.backupDocId, action: "skip_validation_failed", reasons: validation.reasons });
      } else if (meaningful) {
        rows.push({ postId, backupDocId: backup.backupDocId, action: "skip_existing_meaningful_doc", selectedSource: picked.field });
      } else {
        rows.push({ postId, backupDocId: backup.backupDocId, action: "restore", selectedSource: picked.field, payloadFieldCount: Object.keys(normalized).length });
      }
    }
    return {
      ok: true,
      mode: "dry-run",
      projectId,
      checkedPostIds: latestByPostId.size,
      restoreCount: rows.filter((r) => r.action === "restore").length,
      skipCount: rows.filter((r) => r.action !== "restore").length,
      rows
    };
  });

  app.post("/debug/emergency-post-restore/apply-one", async (request, reply) => {
    const body = ApplyOneBodySchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ ok: false, error: "firestore_unavailable" });
    const projectId = getFirestoreAdminIdentity().projectId ?? null;
    if (projectId !== REQUIRED_PROJECT_ID) {
      return reply.status(400).send({ ok: false, error: `wrong_project:${String(projectId)}`, requiredProjectId: REQUIRED_PROJECT_ID });
    }
    if (process.env.CONFIRM_RESTORE_POSTS_FROM_BACKUPS !== REQUIRED_CONFIRMATION_VALUE) {
      return reply.status(400).send({
        ok: false,
        error: "missing_server_env_confirmation",
        required: "CONFIRM_RESTORE_POSTS_FROM_BACKUPS=I_UNDERSTAND_RESTORE_POSTS"
      });
    }
    if (body.confirmationPhrase !== REQUIRED_CONFIRMATION_VALUE) {
      return reply.status(400).send({ ok: false, error: "confirmation_phrase_mismatch" });
    }

    const latest = await loadLatestBackupForPostId(db, body.postId);
    if (!latest) return reply.status(404).send({ ok: false, error: "backup_not_found_for_postId", postId: body.postId });

    const picked = pickRestoreSource(latest.data, body.backupField);
    if (!picked.payload || !picked.field) {
      return reply.status(400).send({ ok: false, error: "no_restore_source", backupDocId: latest.backupDocId });
    }

    const normalized = normalizePayload(body.postId, picked.payload, latest.backupDocId);
    const validation = validatePayload(normalized);
    if (!validation.ok) {
      return reply.status(400).send({ ok: false, error: "validation_failed", reasons: validation.reasons, backupDocId: latest.backupDocId });
    }

    const postRef = db.collection("posts").doc(body.postId);
    const postSnap = await postRef.get();
    const postData = (postSnap.data() ?? {}) as AnyRecord;
    const meaningful = postSnap.exists && hasMeaningfulDocData(postData);
    if (meaningful) {
      return reply.status(409).send({ ok: false, error: "existing_meaningful_doc_skip", postId: body.postId });
    }

    await postRef.set(normalized, { merge: false });
    const verify = await postRef.get();
    return {
      ok: true,
      applied: true,
      projectId,
      postId: body.postId,
      backupDocId: latest.backupDocId,
      selectedSource: picked.field,
      postNowExists: verify.exists,
      fieldCount: Object.keys((verify.data() ?? {}) as AnyRecord).length
    };
  });
}
