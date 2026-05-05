import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { normalizeMasterPostV2 } from "../../lib/posts/master-post-v2/normalizeMasterPostV2.js";
import { validateMasterPostV2 } from "../../lib/posts/master-post-v2/validateMasterPostV2.js";
import { extractMediaProcessingDebugV2 } from "../../lib/posts/master-post-v2/extractMediaProcessingDebugV2.js";
import { hashPostForRebuild } from "../../lib/posts/master-post-v2/hashPostForRebuild.js";
import { diffMasterPostPreview } from "../../lib/posts/master-post-v2/diffMasterPostPreview.js";
import { auditPostEngagementSourcesV2 } from "../../lib/posts/master-post-v2/auditPostEngagementSourcesV2.js";

const ParamsSchema = z.object({ postId: z.string().min(1) });
const WriteSchema = z.object({
  expectedHash: z.string().min(8),
  mode: z.literal("additiveCanonicalFieldsOnly"),
  force: z.boolean().optional().default(false)
});
const RevertSchema = z.object({ backupId: z.string().min(1) });
const PreviewQuerySchema = z.object({
  dryRunMode: z.enum(["default", "singleVideoCheck"]).optional().default("default")
});
const LoadNewestPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(12)
});

type UnknownRecord = Record<string, unknown>;

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function getNestedRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function getNestedString(root: UnknownRecord | null, ...path: string[]): string | null {
  let cursor: unknown = root;
  for (const segment of path) {
    const record = getNestedRecord(cursor);
    if (!record) return null;
    cursor = record[segment];
  }
  return typeof cursor === "string" && cursor.trim().length > 0 ? cursor.trim() : null;
}

function coerceIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === "object") {
    const timestampLike = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
    };
    if (typeof timestampLike.toDate === "function") return timestampLike.toDate().toISOString();
    const seconds =
      typeof timestampLike.seconds === "number"
        ? timestampLike.seconds
        : typeof timestampLike._seconds === "number"
          ? timestampLike._seconds
          : null;
    if (seconds !== null) return new Date(seconds * 1000).toISOString();
  }
  return null;
}

function summarizeQueueCandidate(postId: string, raw: UnknownRecord) {
  const text = getNestedRecord(raw.text);
  const classification = getNestedRecord(raw.classification);
  const location = getNestedRecord(raw.location);
  const display = getNestedRecord(location?.display);
  const author = getNestedRecord(raw.author);
  const rawSchema = getNestedRecord(raw.schema);
  return {
    postId,
    time: coerceIsoDate(raw.time ?? raw.createdAt),
    userId: firstNonEmptyString(raw.userId, author?.userId, raw.uid),
    title: firstNonEmptyString(
      text?.title,
      raw.title,
      raw.caption,
      raw.description,
      raw.postTitle
    ),
    mediaKind: firstNonEmptyString(
      classification?.mediaKind,
      raw.mediaType,
      raw.postType,
      raw.type
    ),
    locationName: firstNonEmptyString(
      display?.name,
      location?.locationTitle,
      location?.name,
      raw.address,
      raw.locationLabel
    ),
    schemaVersion: firstNonEmptyString(rawSchema?.version, rawSchema?.name),
    hasCanonicalSchema: Boolean(rawSchema?.version || rawSchema?.name)
  };
}

const htmlPage = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Post Rebuilder Queue</title>
  <style>
    :root{
      --bg:#f4f1ea;
      --bg-accent:#efe6d6;
      --surface:#fffdf8;
      --surface-strong:#ffffff;
      --ink:#1f2430;
      --muted:#5d6472;
      --line:#d8cfbf;
      --line-strong:#c4b79f;
      --brand:#9f4f2e;
      --brand-soft:#f4d6c8;
      --success:#246a3d;
      --success-soft:#dff3e6;
      --warning:#8d5b12;
      --warning-soft:#f9ebc9;
      --danger:#a23434;
      --danger-soft:#f9d8d8;
      --info:#205e8f;
      --info-soft:#dceefb;
      --shadow:0 18px 40px rgba(86, 60, 20, 0.08);
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      color:var(--ink);
      font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      background:
        radial-gradient(circle at top left, rgba(255,255,255,0.85), transparent 32%),
        linear-gradient(180deg, #faf6ef 0%, #f4f1ea 38%, #efe6d6 100%);
    }
    button,input,select,textarea{font:inherit}
    button{
      border:1px solid var(--line-strong);
      background:var(--surface-strong);
      color:var(--ink);
      border-radius:12px;
      padding:10px 14px;
      cursor:pointer;
      transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease;
      box-shadow:0 2px 0 rgba(31,36,48,0.03);
    }
    button:hover:enabled{
      transform:translateY(-1px);
      border-color:var(--brand);
      box-shadow:0 10px 20px rgba(159,79,46,0.1);
    }
    button:disabled{
      opacity:.55;
      cursor:not-allowed;
      box-shadow:none;
    }
    input,select,textarea{
      width:100%;
      border:1px solid var(--line);
      border-radius:12px;
      background:var(--surface-strong);
      color:var(--ink);
      padding:10px 12px;
    }
    textarea{min-height:220px;resize:vertical}
    textarea.compact{min-height:110px}
    pre{
      margin:0;
      white-space:pre-wrap;
      word-break:break-word;
      background:#191d24;
      color:#dbe7ff;
      padding:14px;
      border-radius:14px;
      overflow:auto;
      min-height:96px;
    }
    .shell{
      max-width:1660px;
      margin:0 auto;
      padding:20px;
    }
    .hero{
      display:grid;
      grid-template-columns:minmax(0,1.7fr) minmax(280px,.95fr);
      gap:18px;
      align-items:stretch;
      margin-bottom:18px;
    }
    .hero-card,.panel,.detail-card{
      background:rgba(255,253,248,0.92);
      border:1px solid rgba(196,183,159,0.8);
      border-radius:22px;
      box-shadow:var(--shadow);
    }
    .hero-copy{
      padding:24px;
      background:
        linear-gradient(140deg, rgba(255,255,255,0.8), rgba(255,246,232,0.95)),
        linear-gradient(180deg, rgba(159,79,46,0.08), rgba(159,79,46,0));
    }
    .eyebrow{
      margin:0 0 10px;
      color:var(--brand);
      text-transform:uppercase;
      letter-spacing:.14em;
      font-size:12px;
      font-weight:800;
    }
    h1,h2,h3,p{margin:0}
    .hero-copy h1{
      font-size:34px;
      line-height:1.05;
      margin-bottom:10px;
      letter-spacing:-0.04em;
    }
    .hero-copy p{
      color:var(--muted);
      max-width:850px;
      line-height:1.5;
    }
    .hero-stats{
      padding:18px;
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:12px;
    }
    .stat{
      padding:16px;
      border-radius:18px;
      background:var(--surface-strong);
      border:1px solid var(--line);
    }
    .stat span{
      display:block;
      color:var(--muted);
      font-size:12px;
      text-transform:uppercase;
      letter-spacing:.08em;
      margin-bottom:8px;
    }
    .stat strong{
      display:block;
      font-size:26px;
      line-height:1;
    }
    .controls{
      display:grid;
      grid-template-columns:1.35fr .9fr .9fr;
      gap:16px;
      margin-bottom:18px;
    }
    .panel{
      padding:18px;
    }
    .panel h2{
      font-size:18px;
      margin-bottom:12px;
    }
    .muted{
      color:var(--muted);
      line-height:1.45;
    }
    .inline-row{
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap:wrap;
    }
    .inline-row > *{flex:1 1 auto}
    .button-row{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      margin-top:12px;
    }
    .button-row button{flex:0 0 auto}
    .checkbox{
      display:flex;
      align-items:center;
      gap:8px;
      color:var(--muted);
      margin-top:12px;
    }
    .checkbox input{
      width:auto;
      padding:0;
      border-radius:6px;
    }
    .mode-switch{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:10px;
      margin-bottom:12px;
    }
    .mode-switch button.active{
      background:var(--brand);
      color:#fff8f2;
      border-color:var(--brand);
    }
    .workspace{
      display:grid;
      grid-template-columns:minmax(360px, 430px) minmax(0,1fr);
      gap:18px;
      align-items:start;
    }
    .queue-toolbar{
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      margin-top:14px;
    }
    .queue-list{
      display:flex;
      flex-direction:column;
      gap:12px;
      margin-top:16px;
      max-height:calc(100vh - 330px);
      overflow:auto;
      padding-right:4px;
    }
    .queue-card{
      width:100%;
      text-align:left;
      padding:16px;
      border-radius:18px;
      border:1px solid var(--line);
      background:var(--surface-strong);
    }
    .queue-card.active{
      border-color:var(--brand);
      box-shadow:0 18px 28px rgba(159,79,46,0.14);
      background:linear-gradient(180deg, #fffefb, #fff5ef);
    }
    .queue-card h3{
      font-size:16px;
      margin-bottom:6px;
      word-break:break-word;
    }
    .queue-card p{
      color:var(--muted);
      line-height:1.4;
      margin-bottom:10px;
      word-break:break-word;
    }
    .badge-row{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
    }
    .badge{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-height:28px;
      padding:4px 10px;
      border-radius:999px;
      font-size:12px;
      font-weight:800;
      letter-spacing:.02em;
      border:1px solid transparent;
    }
    .badge.neutral{background:#f3ede3;color:#64553c;border-color:#e2d4bb}
    .badge.info{background:var(--info-soft);color:var(--info);border-color:#b3daef}
    .badge.success{background:var(--success-soft);color:var(--success);border-color:#bee0ca}
    .badge.warning{background:var(--warning-soft);color:var(--warning);border-color:#efd993}
    .badge.danger{background:var(--danger-soft);color:var(--danger);border-color:#e9b4b4}
    .details{
      display:grid;
      gap:16px;
    }
    .detail-card{
      padding:18px;
    }
    .selected-head{
      display:flex;
      justify-content:space-between;
      gap:18px;
      align-items:flex-start;
      flex-wrap:wrap;
      margin-bottom:14px;
    }
    .selected-head h2{
      font-size:24px;
      line-height:1.1;
      margin-top:4px;
      word-break:break-word;
    }
    .selected-overline{
      color:var(--brand);
      text-transform:uppercase;
      letter-spacing:.1em;
      font-size:11px;
      font-weight:800;
    }
    .summary-grid{
      display:grid;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:12px;
      margin-top:14px;
    }
    .summary-chip{
      padding:12px;
      border-radius:14px;
      background:var(--surface-strong);
      border:1px solid var(--line);
    }
    .summary-chip span{
      display:block;
      color:var(--muted);
      font-size:12px;
      text-transform:uppercase;
      letter-spacing:.08em;
      margin-bottom:6px;
    }
    .summary-chip strong{
      display:block;
      font-size:15px;
      line-height:1.3;
      word-break:break-word;
    }
    .detail-grid{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:16px;
    }
    .detail-grid .span-2{grid-column:span 2}
    .detail-card h3{
      font-size:16px;
      margin-bottom:10px;
    }
    .log{
      margin-top:18px;
    }
    .hint{
      margin-top:10px;
      padding:12px 14px;
      border-radius:14px;
      background:#f7f1e5;
      border:1px solid #ebddbf;
      color:#6c5a35;
      line-height:1.45;
    }
    [data-mode-section]{display:none}
    body[data-mode="manual"] [data-mode-section="manual"]{display:block}
    body[data-mode="auto"] [data-mode-section="auto"]{display:block}
    @media (max-width: 1280px){
      .controls,.workspace,.hero,.detail-grid{grid-template-columns:1fr}
      .queue-list{max-height:none}
      .detail-grid .span-2{grid-column:auto}
      .summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    }
    @media (max-width: 720px){
      .shell{padding:14px}
      .hero-copy h1{font-size:28px}
      .summary-grid,.hero-stats{grid-template-columns:1fr}
      .selected-head{flex-direction:column}
    }
  </style>
</head>
<body data-mode="manual">
  <div class="shell">
    <section class="hero">
      <div class="hero-card hero-copy">
        <p class="eyebrow">Debug / Master Post V2</p>
        <h1>Post Rebuilder Queue</h1>
        <p>
          Exact same per-post rebuild flow, now wrapped in a multi-post queue. Paste a comma-separated list of post IDs,
          pull the newest posts from Firestore, inspect one selected post in detail, or run clean sequential auto previews and writes.
        </p>
      </div>
      <div class="hero-card hero-stats">
        <div class="stat"><span>Queue Size</span><strong id="queueCount">0</strong></div>
        <div class="stat"><span>Preview Ready</span><strong id="previewReadyCount">0</strong></div>
        <div class="stat"><span>Writes Completed</span><strong id="writeCompleteCount">0</strong></div>
        <div class="stat"><span>Blocked / Errors</span><strong id="problemCount">0</strong></div>
      </div>
    </section>

    <section class="controls">
      <div class="panel">
        <h2>Queue Input</h2>
        <p class="muted">Paste one or many post IDs. Commas and new lines both work.</p>
        <textarea id="postIdsInput" class="compact" placeholder="postIdOne, postIdTwo, postIdThree"></textarea>
        <label class="checkbox">
          <input id="appendQueue" type="checkbox"/>
          <span>Append to existing queue instead of replacing it</span>
        </label>
        <div class="button-row">
          <button id="loadIds">Build Queue From IDs</button>
          <button id="clearQueue">Clear Queue</button>
        </div>
      </div>

      <div class="panel">
        <h2>Load Newest Posts</h2>
        <p class="muted">Reads directly from the <code>posts</code> collection ordered by newest first.</p>
        <div class="inline-row" style="margin-top:12px">
          <input id="newestLimit" type="number" min="1" max="200" value="12"/>
          <button id="loadNewest">Load Newest Posts</button>
        </div>
        <div class="hint">This only prepares the queue. Nothing previews or writes until you choose a manual or auto action.</div>
      </div>

      <div class="panel">
        <h2>Modes</h2>
        <div class="mode-switch">
          <button id="manualMode" class="active">Manual Mode</button>
          <button id="autoMode">Auto Mode</button>
        </div>
        <div data-mode-section="manual">
          <p class="muted">Use this when you want the same old one-post workflow, but for a selected post inside a multi-post queue.</p>
        </div>
        <div data-mode-section="auto">
          <p class="muted">Use this when you want a clean migration dashboard feel: sequential queue processing with clear per-post status tracking.</p>
        </div>
        <div class="hint" id="modeHint">
          Manual mode keeps the original raw / preview / write / backups / revert steps focused on one selected post at a time.
        </div>
      </div>
    </section>

    <section class="workspace">
      <div class="panel">
        <h2>Post Queue</h2>
        <p class="muted">Click any queued post to inspect its full JSON and migration state on the right.</p>

        <div class="queue-toolbar" data-mode-section="manual">
          <button id="loadRawSelected">Load Raw Selected</button>
          <button id="previewSelected">Preview Selected</button>
          <button id="writeSelected">Write Selected</button>
          <button id="backupsSelected">Load Backups</button>
        </div>

        <div class="queue-toolbar" data-mode-section="auto">
          <button id="autoPreviewQueue">Auto Preview Queue</button>
          <button id="autoPreviewWriteQueue">Auto Preview + Write Queue</button>
          <button id="stopAuto">Stop Auto Run</button>
        </div>

        <div class="hint" id="queueStatusHint" style="margin-top:14px">
          Queue is empty. Add post IDs or load newest posts to get started.
        </div>
        <div id="queueList" class="queue-list"></div>
      </div>

      <div class="details">
        <div class="detail-card">
          <div id="selectedSummary"></div>
          <div class="inline-row" style="margin-top:14px">
            <select id="backupSelect"></select>
            <button id="revertSelected">Revert Selected Backup</button>
          </div>
        </div>

        <div class="detail-grid">
          <div class="detail-card">
            <h3>Diff Summary</h3>
            <pre id="diff"></pre>
          </div>
          <div class="detail-card">
            <h3>Validation</h3>
            <pre id="validation"></pre>
          </div>
          <div class="detail-card">
            <h3>Engagement Source Audit</h3>
            <pre id="engagementAudit"></pre>
          </div>
          <div class="detail-card">
            <h3>Media Preview</h3>
            <pre id="media"></pre>
          </div>
          <div class="detail-card">
            <h3>Engagement Preview</h3>
            <pre id="engagement"></pre>
          </div>
          <div class="detail-card">
            <h3>Location</h3>
            <pre id="location"></pre>
          </div>
          <div class="detail-card span-2">
            <h3>Raw JSON</h3>
            <textarea id="raw"></textarea>
          </div>
          <div class="detail-card span-2">
            <h3>Canonical JSON</h3>
            <textarea id="canonical"></textarea>
          </div>
          <div class="detail-card span-2">
            <h3>Media Processing Debug Preview</h3>
            <textarea id="processing"></textarea>
          </div>
        </div>

        <div class="detail-card log">
          <h3>Run Log</h3>
          <pre id="activityLog"></pre>
        </div>
      </div>
    </section>
  </div>

  <script>
    const state = {
      mode: 'manual',
      queue: [],
      activePostId: null,
      log: [],
      auto: { running: false, kind: null }
    };

    const el = (id) => document.getElementById(id);

    function json(value) {
      if (value === undefined) return 'null';
      try {
        return JSON.stringify(value, null, 2);
      } catch (_error) {
        return String(value);
      }
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function dedupePostIds(text) {
      const seen = new Set();
      return String(text || '')
        .split(/[\\n,]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((postId) => {
          if (seen.has(postId)) return false;
          seen.add(postId);
          return true;
        });
    }

    function nowLabel() {
      return new Date().toLocaleTimeString();
    }

    function addLog(message, postId) {
      const line = '[' + nowLabel() + '] ' + (postId ? postId + ' - ' : '') + message;
      state.log = [line].concat(state.log).slice(0, 220);
      el('activityLog').textContent = state.log.length ? state.log.join('\\n') : 'No actions yet.';
    }

    function buildBadge(label, tone) {
      return '<span class="badge ' + tone + '">' + escapeHtml(label) + '</span>';
    }

    function createQueueItem(postId) {
      return {
        postId: postId,
        title: '',
        mediaKind: '',
        locationName: '',
        userId: '',
        time: '',
        schemaVersion: '',
        hasCanonicalSchema: false,
        exists: null,
        rawHash: null,
        raw: null,
        canonicalPreview: null,
        mediaProcessingDebugPreview: null,
        engagementSourceAudit: null,
        diffSummary: null,
        validation: null,
        mediaView: null,
        engagementView: null,
        locationView: null,
        backups: [],
        backupSelection: '',
        status: {
          raw: 'idle',
          preview: 'idle',
          write: 'idle',
          backups: 'idle',
          revert: 'idle'
        },
        counts: {
          warnings: 0,
          blocking: 0
        },
        previewChecks: null,
        lastMessage: '',
        lastError: '',
        backupId: '',
        lastPreviewedAt: '',
        lastWrittenAt: ''
      };
    }

    function mergeQueueSummary(item, patch) {
      if (!patch) return item;
      ['title', 'mediaKind', 'locationName', 'userId', 'time', 'schemaVersion'].forEach(function (key) {
        if (typeof patch[key] === 'string' && patch[key].trim()) item[key] = patch[key].trim();
      });
      if (patch.hasCanonicalSchema !== undefined) item.hasCanonicalSchema = Boolean(patch.hasCanonicalSchema);
      if (patch.exists !== undefined) item.exists = patch.exists;
      return item;
    }

    function getQueueItem(postId) {
      return state.queue.find(function (item) { return item.postId === postId; }) || null;
    }

    function getActiveItem() {
      return state.activePostId ? getQueueItem(state.activePostId) : null;
    }

    function ensureQueueFromSeeds(seeds, append) {
      const queue = append ? state.queue.slice() : [];
      const byId = new Map(queue.map(function (item) { return [item.postId, item]; }));
      seeds.forEach(function (seed) {
        const postId = String(seed.postId || '').trim();
        if (!postId) return;
        let item = byId.get(postId);
        if (!item) {
          item = createQueueItem(postId);
          queue.push(item);
          byId.set(postId, item);
        }
        mergeQueueSummary(item, seed);
      });
      state.queue = queue;
      if (!state.activePostId && state.queue.length) state.activePostId = state.queue[0].postId;
      if (state.activePostId && !getQueueItem(state.activePostId)) {
        state.activePostId = state.queue.length ? state.queue[0].postId : null;
      }
    }

    function setMode(mode) {
      state.mode = mode === 'auto' ? 'auto' : 'manual';
      document.body.dataset.mode = state.mode;
      el('manualMode').classList.toggle('active', state.mode === 'manual');
      el('autoMode').classList.toggle('active', state.mode === 'auto');
      el('modeHint').textContent =
        state.mode === 'manual'
          ? 'Manual mode keeps the original raw / preview / write / backups / revert steps focused on one selected post at a time.'
          : 'Auto mode previews and writes the queue in order, then leaves every post card with a clear status trail.';
      render();
    }

    function setSelectedPost(postId) {
      state.activePostId = postId;
      render();
    }

    function summarizeFromPreview(item, data) {
      const canonical = data && data.canonicalPreview ? data.canonicalPreview : {};
      const text = canonical.text || {};
      const classification = canonical.classification || {};
      const location = canonical.location || {};
      const display = location.display || {};
      const author = canonical.author || {};
      const schema = canonical.schema || {};
      mergeQueueSummary(item, {
        title: text.title || item.title,
        mediaKind: classification.mediaKind || item.mediaKind,
        locationName: display.name || item.locationName,
        userId: author.userId || item.userId || (data && data.raw ? data.raw.userId : ''),
        time: item.time || ((data && data.raw && typeof data.raw.time === 'string') ? data.raw.time : ''),
        schemaVersion: schema.version || item.schemaVersion,
        hasCanonicalSchema: Boolean(schema.version || schema.name)
      });
    }

    function renderQueueCard(item) {
      const badges = [];
      if (item.hasCanonicalSchema) badges.push(buildBadge('CANONICAL', 'info'));
      if (item.status.raw === 'success') badges.push(buildBadge('RAW LOADED', 'neutral'));
      if (item.status.raw === 'missing') badges.push(buildBadge('RAW MISSING', 'danger'));
      if (item.status.preview === 'success') badges.push(buildBadge('PREVIEW READY', 'success'));
      if (item.status.preview === 'warning') badges.push(buildBadge('PREVIEW WARN', 'warning'));
      if (item.status.preview === 'blocked') badges.push(buildBadge('PREVIEW BLOCKED', 'danger'));
      if (item.status.preview === 'error') badges.push(buildBadge('PREVIEW ERROR', 'danger'));
      if (item.counts.warnings > 0) badges.push(buildBadge('WARN ' + item.counts.warnings, 'warning'));
      if (item.counts.blocking > 0) badges.push(buildBadge('BLOCK ' + item.counts.blocking, 'danger'));
      if (item.status.write === 'success') badges.push(buildBadge('WRITE OK', 'success'));
      if (item.status.write === 'skipped') badges.push(buildBadge('WRITE SKIPPED', 'warning'));
      if (item.status.write === 'error') badges.push(buildBadge('WRITE ERROR', 'danger'));
      if (item.backups.length > 0) badges.push(buildBadge('BACKUPS ' + item.backups.length, 'info'));
      if (item.status.preview === 'working' || item.status.write === 'working' || item.status.raw === 'working') {
        badges.push(buildBadge('RUNNING', 'info'));
      }
      const title = item.title || '(untitled / not yet previewed)';
      const meta = [item.mediaKind, item.locationName, item.userId, item.time].filter(Boolean).join(' • ') || 'No preview metadata yet.';
      const note = item.lastError || item.lastMessage || 'Ready.';
      return ''
        + '<button class="queue-card' + (state.activePostId === item.postId ? ' active' : '') + '" data-post-id="' + escapeHtml(item.postId) + '">'
        +   '<h3>' + escapeHtml(item.postId) + '</h3>'
        +   '<p><strong>' + escapeHtml(title) + '</strong></p>'
        +   '<p>' + escapeHtml(meta) + '</p>'
        +   '<div class="badge-row">' + badges.join('') + '</div>'
        +   '<p style="margin-top:10px">' + escapeHtml(note) + '</p>'
        + '</button>';
    }

    function renderQueue() {
      el('queueList').innerHTML = state.queue.map(renderQueueCard).join('');
      el('queueStatusHint').textContent = state.queue.length
        ? (state.auto.running
            ? 'Auto run is active. The selected card will follow the queue as each post is processed.'
            : 'Queue ready. Select any post card to inspect the full migration details.')
        : 'Queue is empty. Add post IDs or load newest posts to get started.';
    }

    function renderStats() {
      const previewReadyCount = state.queue.filter(function (item) {
        return item.status.preview === 'success' || item.status.preview === 'warning';
      }).length;
      const writeCompleteCount = state.queue.filter(function (item) { return item.status.write === 'success'; }).length;
      const problemCount = state.queue.filter(function (item) {
        return item.status.preview === 'blocked' || item.status.preview === 'error' || item.status.write === 'error' || item.counts.blocking > 0;
      }).length;
      el('queueCount').textContent = String(state.queue.length);
      el('previewReadyCount').textContent = String(previewReadyCount);
      el('writeCompleteCount').textContent = String(writeCompleteCount);
      el('problemCount').textContent = String(problemCount);
    }

    function renderSelected() {
      const item = getActiveItem();
      if (!item) {
        el('selectedSummary').innerHTML = ''
          + '<div class="selected-head">'
          +   '<div>'
          +     '<div class="selected-overline">Selected Post</div>'
          +     '<h2>No post selected</h2>'
          +     '<p class="muted" style="margin-top:8px">Load a queue and click a post card to inspect its migration details.</p>'
          +   '</div>'
          + '</div>';
        el('backupSelect').innerHTML = '';
        el('diff').textContent = 'Select a post from the queue.';
        el('validation').textContent = 'Select a post from the queue.';
        el('engagementAudit').textContent = 'Select a post from the queue.';
        el('media').textContent = 'Select a post from the queue.';
        el('engagement').textContent = 'Select a post from the queue.';
        el('location').textContent = 'Select a post from the queue.';
        el('raw').value = '';
        el('canonical').value = '';
        el('processing').value = '';
        return;
      }

      const badges = [];
      if (item.status.preview === 'success') badges.push(buildBadge('PREVIEW READY', 'success'));
      if (item.status.preview === 'warning') badges.push(buildBadge('PREVIEW WARNINGS', 'warning'));
      if (item.status.preview === 'blocked') badges.push(buildBadge('PREVIEW BLOCKED', 'danger'));
      if (item.status.write === 'success') badges.push(buildBadge('WRITE COMPLETE', 'success'));
      if (item.status.write === 'error') badges.push(buildBadge('WRITE ERROR', 'danger'));
      if (item.backups.length > 0) badges.push(buildBadge('BACKUP READY', 'info'));

      const title = item.title || '(untitled / not yet previewed)';
      const summaryHtml = ''
        + '<div class="selected-head">'
        +   '<div>'
        +     '<div class="selected-overline">Selected Post</div>'
        +     '<h2>' + escapeHtml(item.postId) + '</h2>'
        +     '<p class="muted" style="margin-top:8px">' + escapeHtml(title) + '</p>'
        +   '</div>'
        +   '<div class="badge-row">' + badges.join('') + '</div>'
        + '</div>'
        + '<div class="summary-grid">'
        +   '<div class="summary-chip"><span>Media Kind</span><strong>' + escapeHtml(item.mediaKind || 'Unknown') + '</strong></div>'
        +   '<div class="summary-chip"><span>Warnings</span><strong>' + escapeHtml(item.counts.warnings || 0) + '</strong></div>'
        +   '<div class="summary-chip"><span>Blocking Errors</span><strong>' + escapeHtml(item.counts.blocking || 0) + '</strong></div>'
        +   '<div class="summary-chip"><span>Latest Backup</span><strong>' + escapeHtml(item.backupId || item.backupSelection || 'None') + '</strong></div>'
        +   '<div class="summary-chip"><span>Author</span><strong>' + escapeHtml(item.userId || 'Unknown') + '</strong></div>'
        +   '<div class="summary-chip"><span>Location</span><strong>' + escapeHtml(item.locationName || 'Unknown') + '</strong></div>'
        +   '<div class="summary-chip"><span>Previewed At</span><strong>' + escapeHtml(item.lastPreviewedAt || 'Not yet') + '</strong></div>'
        +   '<div class="summary-chip"><span>Write Status</span><strong>' + escapeHtml(item.lastError || item.lastMessage || 'Idle') + '</strong></div>'
        + '</div>';
      el('selectedSummary').innerHTML = summaryHtml;

      const backupSelect = el('backupSelect');
      backupSelect.innerHTML = '';
      if (!item.backups.length) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'No backups loaded';
        backupSelect.appendChild(placeholder);
      } else {
        item.backups.forEach(function (backup) {
          const option = document.createElement('option');
          option.value = backup.backupId;
          option.textContent = backup.backupId;
          if (item.backupSelection && item.backupSelection === backup.backupId) option.selected = true;
          backupSelect.appendChild(option);
        });
      }

      el('diff').textContent = json(item.diffSummary || {});
      el('validation').textContent = json(item.validation || {});
      el('engagementAudit').textContent = json(item.engagementSourceAudit || null);
      el('media').textContent = json(item.mediaView || null);
      el('engagement').textContent = json(item.engagementView || null);
      el('location').textContent = json(item.locationView || null);
      el('raw').value = json(item.raw || null);
      el('canonical').value = json(item.canonicalPreview || null);
      el('processing').value = json(item.mediaProcessingDebugPreview || null);
    }

    function renderButtons() {
      const item = getActiveItem();
      const queueEmpty = state.queue.length === 0;
      const busy = state.auto.running;
      const hasBlocking = Boolean(item && item.counts.blocking > 0);
      el('loadRawSelected').disabled = !item || busy;
      el('previewSelected').disabled = !item || busy;
      el('writeSelected').disabled = !item || busy || !item.rawHash || hasBlocking || item.status.preview === 'working';
      el('backupsSelected').disabled = !item || busy;
      el('revertSelected').disabled = !item || busy || !item.backupSelection;
      el('autoPreviewQueue').disabled = queueEmpty || busy;
      el('autoPreviewWriteQueue').disabled = queueEmpty || busy;
      el('stopAuto').disabled = !busy;
      el('loadIds').disabled = busy;
      el('clearQueue').disabled = busy && queueEmpty;
      el('loadNewest').disabled = busy;
    }

    function render() {
      renderStats();
      renderQueue();
      renderSelected();
      renderButtons();
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, options || {});
      let data = null;
      try {
        data = await response.json();
      } catch (_error) {
        data = null;
      }
      if (!response.ok) {
        const message =
          (data && typeof data.error === 'string' && data.error) ||
          (data && data.error && typeof data.error.message === 'string' && data.error.message) ||
          ('request_failed_' + response.status);
        const error = new Error(message);
        error.statusCode = response.status;
        error.body = data;
        throw error;
      }
      return data;
    }

    function setActionState(item, action, nextState, note) {
      item.status[action] = nextState;
      item.lastMessage = note || item.lastMessage;
      if (nextState !== 'error') item.lastError = '';
      render();
    }

    function hydratePreviewViews(item, data) {
      const canonical = data.canonicalPreview || {};
      const media = canonical.media || {};
      const mediaAssets = (media.assets || []).map(function (asset) {
        if (asset.type === 'video') {
          return {
            id: asset.id,
            type: asset.type,
            default: asset.video && asset.video.playback ? asset.video.playback.defaultUrl : undefined,
            primary: asset.video && asset.video.playback ? asset.video.playback.primaryUrl : undefined,
            startup: asset.video && asset.video.playback ? asset.video.playback.startupUrl : undefined,
            highQuality: asset.video && asset.video.playback ? asset.video.playback.highQualityUrl : undefined,
            upgrade: asset.video && asset.video.playback ? asset.video.playback.upgradeUrl : undefined,
            hls: asset.video && asset.video.playback ? asset.video.playback.hlsUrl : undefined,
            fallback: asset.video && asset.video.playback ? asset.video.playback.fallbackUrl : undefined,
            preview: asset.video && asset.video.playback ? asset.video.playback.previewUrl : undefined
          };
        }
        return {
          id: asset.id,
          type: asset.type,
          width: asset.image ? asset.image.width : undefined,
          height: asset.image ? asset.image.height : undefined,
          aspectRatio: asset.image ? asset.image.aspectRatio : undefined,
          display: asset.image ? asset.image.displayUrl : undefined,
          thumbnail: asset.image ? asset.image.thumbnailUrl : undefined,
          original: asset.image ? asset.image.originalUrl : undefined
        };
      });
      item.mediaView = {
        cover: media.cover,
        assetCount: media.assetCount,
        assetsReady: media.assetsReady,
        instantPlaybackReady: media.instantPlaybackReady,
        rawAssetCount: media.rawAssetCount,
        hasMultipleAssets: media.hasMultipleAssets,
        primaryAssetId: media.primaryAssetId,
        coverAssetId: media.coverAssetId,
        coverDimensions: {
          width: media.cover ? media.cover.width : undefined,
          height: media.cover ? media.cover.height : undefined,
          aspectRatio: media.cover ? media.cover.aspectRatio : undefined
        },
        completeness: media.completeness,
        assets: mediaAssets,
        faststartVerified: mediaAssets
          .filter(function (asset) { return asset.type === 'video'; })
          .map(function (asset) {
            const fullAsset = (media.assets || []).find(function (value) { return value.id === asset.id; });
            return asset.id + ':' + String(fullAsset && fullAsset.video && fullAsset.video.readiness ? fullAsset.video.readiness.faststartVerified : false);
          })
      };
      item.engagementView = {
        oldLikesArrayCount: Array.isArray(data.raw && data.raw.likes) ? data.raw.likes.length : 0,
        oldCommentsArrayCount: Array.isArray(data.raw && data.raw.comments) ? data.raw.comments.length : 0,
        canonicalLikeCount: canonical.engagement ? canonical.engagement.likeCount : undefined,
        canonicalCommentCount: canonical.engagement ? canonical.engagement.commentCount : undefined,
        recentLikers: canonical.engagementPreview ? canonical.engagementPreview.recentLikers : undefined,
        recentComments: canonical.engagementPreview ? canonical.engagementPreview.recentComments : undefined,
        preservationNote: 'Likers/comments previews mirror production fields; full arrays remain in backup/raw + legacy summaries — canonical stores counts + small preview slices only.'
      };
      item.locationView = {
        old: {
          lat: data.raw ? data.raw.lat : undefined,
          long: data.raw ? data.raw.long : undefined,
          lng: data.raw ? data.raw.lng : undefined,
          geohash: data.raw ? data.raw.geohash : undefined,
          address: data.raw ? data.raw.address : undefined
        },
        canonical: canonical.location,
        note: 'location.display.name is place/address UI — text.title is the post title only.'
      };
    }

    async function loadRawForItem(item) {
      setActionState(item, 'raw', 'working', 'Loading raw...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/raw');
        item.exists = Boolean(data.exists);
        item.rawHash = data.rawHash || null;
        item.raw = data.raw || null;
        item.status.raw = data.exists ? 'success' : 'missing';
        item.lastMessage = data.exists ? 'Raw loaded.' : 'Post was not found.';
        mergeQueueSummary(item, { exists: data.exists });
        addLog(item.lastMessage, item.postId);
        render();
        return data;
      } catch (error) {
        item.status.raw = 'error';
        item.lastError = error.message || 'raw_load_failed';
        addLog('Raw load failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function previewItem(item) {
      setActionState(item, 'preview', 'working', 'Previewing canonical rebuild...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/preview', { method: 'POST' });
        item.exists = Boolean(data.raw);
        item.rawHash = data.rawHash || null;
        item.raw = data.raw || null;
        item.canonicalPreview = data.canonicalPreview || null;
        item.mediaProcessingDebugPreview = data.mediaProcessingDebugPreview || null;
        item.engagementSourceAudit = data.engagementSourceAudit || null;
        item.diffSummary = data.diffSummary || {};
        item.validation = data.validation || null;
        item.previewChecks = data.previewChecks || null;
        item.counts = {
          warnings: Array.isArray(data.validation && data.validation.warnings) ? data.validation.warnings.length : 0,
          blocking: Array.isArray(data.validation && data.validation.blockingErrors) ? data.validation.blockingErrors.length : 0
        };
        item.status.preview = item.counts.blocking > 0 ? 'blocked' : (item.counts.warnings > 0 ? 'warning' : 'success');
        item.lastPreviewedAt = nowLabel();
        item.lastMessage =
          item.status.preview === 'blocked'
            ? 'Preview finished with blocking errors.'
            : item.status.preview === 'warning'
              ? 'Preview finished with warnings.'
              : 'Preview ready.';
        summarizeFromPreview(item, data);
        hydratePreviewViews(item, data);
        addLog(item.lastMessage, item.postId);
        render();
        return data;
      } catch (error) {
        item.status.preview = 'error';
        item.lastError = error.message || 'preview_failed';
        addLog('Preview failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function listBackupsForItem(item) {
      setActionState(item, 'backups', 'working', 'Loading backups...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/backups');
        item.backups = Array.isArray(data.backups) ? data.backups : [];
        item.backupSelection = item.backups.length ? item.backups[0].backupId : '';
        item.status.backups = 'success';
        item.lastMessage = item.backups.length ? 'Loaded ' + item.backups.length + ' backups.' : 'No backups found.';
        addLog(item.lastMessage, item.postId);
        render();
        return data;
      } catch (error) {
        item.status.backups = 'error';
        item.lastError = error.message || 'backup_list_failed';
        addLog('Backup load failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function writeItem(item) {
      if (!item.rawHash) {
        alert('Preview selected post first.');
        return null;
      }
      if (item.counts.blocking > 0) {
        alert('Selected post has blocking validation errors. Fix or inspect the preview before writing.');
        return null;
      }
      const force = window.confirm('Force write even with blocking errors?');
      setActionState(item, 'write', 'working', 'Writing canonical fields...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/write', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedHash: item.rawHash,
            mode: 'additiveCanonicalFieldsOnly',
            force: force
          })
        });
        item.status.write = 'success';
        item.backupId = data.backupId || '';
        item.lastWrittenAt = nowLabel();
        item.lastMessage = 'Write complete: ' + (data.backupPath || data.backupId || 'ok');
        if (item.backupId) {
          item.backups = [{ backupId: item.backupId }].concat(item.backups.filter(function (backup) {
            return backup.backupId !== item.backupId;
          }));
          item.backupSelection = item.backupId;
        }
        addLog(item.lastMessage, item.postId);
        render();
        return data;
      } catch (error) {
        item.status.write = 'error';
        item.lastError = error.message || 'write_failed';
        if (error.body && error.body.validation) {
          item.validation = error.body.validation;
          item.counts.blocking = Array.isArray(error.body.validation.blockingErrors) ? error.body.validation.blockingErrors.length : item.counts.blocking;
          item.counts.warnings = Array.isArray(error.body.validation.warnings) ? error.body.validation.warnings.length : item.counts.warnings;
        }
        addLog('Write failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function revertItem(item) {
      if (!item.backupSelection) {
        alert('Select a backup first.');
        return null;
      }
      if (!window.confirm('Revert selected post to backup ' + item.backupSelection + '?')) return null;
      setActionState(item, 'revert', 'working', 'Reverting post to selected backup...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/revert', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ backupId: item.backupSelection })
        });
        item.status.revert = 'success';
        item.lastMessage = 'Reverted from backup ' + item.backupSelection + '.';
        addLog(item.lastMessage, item.postId);
        render();
        return data;
      } catch (error) {
        item.status.revert = 'error';
        item.lastError = error.message || 'revert_failed';
        addLog('Revert failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function loadNewestPosts() {
      const limit = Number(el('newestLimit').value || 12);
      const append = Boolean(el('appendQueue').checked);
      const data = await fetchJson('/debug/post-rebuilder/posts?limit=' + encodeURIComponent(String(limit)));
      ensureQueueFromSeeds((data.posts || []).map(function (post) { return post; }), append);
      el('postIdsInput').value = state.queue.map(function (item) { return item.postId; }).join(', ');
      addLog('Loaded ' + String((data.posts || []).length) + ' newest posts into the queue.');
      render();
    }

    function loadIdsIntoQueue() {
      const postIds = dedupePostIds(el('postIdsInput').value);
      if (!postIds.length) {
        alert('Paste one or more post IDs first.');
        return;
      }
      const append = Boolean(el('appendQueue').checked);
      ensureQueueFromSeeds(postIds.map(function (postId) { return { postId: postId }; }), append);
      addLog('Queued ' + postIds.length + ' post id' + (postIds.length === 1 ? '' : 's') + '.');
      render();
    }

    function clearQueue() {
      state.queue = [];
      state.activePostId = null;
      state.auto.running = false;
      state.auto.kind = null;
      el('postIdsInput').value = '';
      addLog('Cleared queue.');
      render();
    }

    async function runAutoSequence(withWrite) {
      if (!state.queue.length) {
        alert('Queue is empty.');
        return;
      }
      state.auto.running = true;
      state.auto.kind = withWrite ? 'preview_write' : 'preview';
      addLog(withWrite ? 'Started auto preview + write queue.' : 'Started auto preview queue.');
      render();
      try {
        for (const item of state.queue) {
          if (!state.auto.running) break;
          setSelectedPost(item.postId);
          try {
            await previewItem(item);
            if (withWrite) {
              if (item.counts.blocking > 0) {
                item.status.write = 'skipped';
                item.lastMessage = 'Write skipped because preview has blocking errors.';
                addLog(item.lastMessage, item.postId);
                render();
                continue;
              }
              await writeItem(item);
            }
          } catch (_error) {
            if (!state.auto.running) break;
          }
        }
      } finally {
        const stoppedEarly = !state.auto.running;
        state.auto.running = false;
        state.auto.kind = null;
        addLog(stoppedEarly ? 'Auto run stopped.' : 'Auto run finished.');
        render();
      }
    }

    el('queueList').addEventListener('click', function (event) {
      const card = event.target.closest('[data-post-id]');
      if (!card) return;
      const postId = card.getAttribute('data-post-id');
      if (postId) setSelectedPost(postId);
    });

    el('backupSelect').addEventListener('change', function () {
      const item = getActiveItem();
      if (!item) return;
      item.backupSelection = el('backupSelect').value;
      renderButtons();
    });

    el('manualMode').onclick = function () { setMode('manual'); };
    el('autoMode').onclick = function () { setMode('auto'); };
    el('loadIds').onclick = function () { loadIdsIntoQueue(); };
    el('clearQueue').onclick = function () { clearQueue(); };
    el('loadNewest').onclick = async function () {
      try {
        await loadNewestPosts();
      } catch (error) {
        addLog('Newest-post load failed: ' + (error.message || 'request_failed'));
      }
    };

    el('loadRawSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await loadRawForItem(item);
      } catch (_error) {}
    };
    el('previewSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await previewItem(item);
      } catch (_error) {}
    };
    el('writeSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await writeItem(item);
      } catch (_error) {}
    };
    el('backupsSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await listBackupsForItem(item);
      } catch (_error) {}
    };
    el('revertSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await revertItem(item);
      } catch (_error) {}
    };
    el('autoPreviewQueue').onclick = async function () {
      await runAutoSequence(false);
    };
    el('autoPreviewWriteQueue').onclick = async function () {
      if (!window.confirm('Run preview + write across the current queue?')) return;
      await runAutoSequence(true);
    };
    el('stopAuto').onclick = function () {
      state.auto.running = false;
      addLog('Stop requested for auto run.');
      render();
    };

    addLog('System ready. No preview or write has been run yet.');
    render();
  </script>
</body>
</html>`;

export async function registerPostRebuilderRoutes(app: FastifyInstance): Promise<void> {
  if (!app.config.ENABLE_POST_REBUILDER_DEBUG_ROUTES) {
    app.log.info("post rebuilder debug routes disabled (ENABLE_POST_REBUILDER_DEBUG_ROUTES!=true)");
    return;
  }

  app.get("/debug/post-rebuilder", async (_request, reply) => reply.type("text/html").send(htmlPage));

  app.get("/debug/post-rebuilder/posts", async (request, reply) => {
    const query = LoadNewestPostsQuerySchema.parse(request.query ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable", posts: [] });
    const snap = await db.collection("posts").orderBy("time", "desc").limit(query.limit).get();
    return {
      order: "time_desc",
      count: snap.size,
      posts: snap.docs.map((doc) => summarizeQueueCandidate(doc.id, (doc.data() ?? {}) as UnknownRecord))
    };
  });

  app.get<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/raw", async (request) => {
    const params = ParamsSchema.parse(request.params);
    const db = getFirestoreSourceClient();
    if (!db) return { postId: params.postId, exists: false, raw: null, rawHash: hashPostForRebuild(null) };
    const snap = await db.collection("posts").doc(params.postId).get();
    const raw = snap.exists ? ((snap.data() ?? {}) as UnknownRecord) : null;
    return { postId: params.postId, exists: snap.exists, raw, rawHash: hashPostForRebuild(raw) };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/preview", async (request) => {
    const params = ParamsSchema.parse(request.params);
    const query = PreviewQuerySchema.parse(request.query ?? {});
    const db = getFirestoreSourceClient();
    if (!db)
      return {
        postId: params.postId,
        rawHash: "",
        raw: null,
        canonicalPreview: null,
        engagementSourceAudit: null,
        mediaProcessingDebugPreview: null,
        validation: {
          status: "invalid",
          blockingErrors: [{ code: "firestore_unavailable", message: "Firestore unavailable", blocking: true }],
          warnings: []
        },
        diffSummary: {},
        writeAllowed: false
      };
    const snap = await db.collection("posts").doc(params.postId).get();
    const raw = snap.exists ? ((snap.data() ?? {}) as UnknownRecord) : null;
    const rawHash = hashPostForRebuild(raw);
    if (!raw) {
      return {
        postId: params.postId,
        rawHash,
        raw: null,
        canonicalPreview: null,
        engagementSourceAudit: null,
        mediaProcessingDebugPreview: null,
        validation: {
          status: "invalid",
          blockingErrors: [{ code: "post_not_found", message: "Post does not exist", blocking: true }],
          warnings: []
        },
        diffSummary: {},
        writeAllowed: false
      };
    }
    const engagementSourceAudit = await auditPostEngagementSourcesV2(db, params.postId, raw);
    const normalized = normalizeMasterPostV2(raw, { postId: params.postId, engagementSourceAudit });
    const validation = validateMasterPostV2(normalized.canonical, { engagementSourceAudit });
    const mediaProcessingDebugPreview = extractMediaProcessingDebugV2(raw);
    const diffSummary = diffMasterPostPreview({
      raw,
      canonical: normalized.canonical,
      recoveredLegacyAssets: normalized.recoveredLegacyAssets,
      dedupedAssets: normalized.dedupedAssets,
      warnings: [...normalized.warnings, ...validation.warnings],
      errors: [...normalized.errors, ...validation.blockingErrors],
      processingDebugExtracted: Boolean(mediaProcessingDebugPreview)
    });
    const previewChecks =
      query.dryRunMode === "singleVideoCheck"
        ? {
            mediaAssetCountAfterIsOne: normalized.canonical.media.assetCount === 1,
            mediaKindIsVideo: normalized.canonical.classification.mediaKind === "video",
            compatibilityStillExists:
              Boolean(normalized.canonical.compatibility.photoLink) &&
              Boolean(normalized.canonical.compatibility.displayPhotoLink) &&
              Boolean(normalized.canonical.compatibility.photoLinks2 ?? normalized.canonical.compatibility.fallbackVideoUrl),
            hasMp4ImageAssets: normalized.canonical.media.assets.some(
              (asset) => asset.type === "image" && /\.mp4(\?|$)/i.test(asset.image?.displayUrl ?? "")
            )
          }
        : null;
    return {
      postId: params.postId,
      rawHash,
      raw,
      canonicalPreview: normalized.canonical,
      engagementSourceAudit,
      mediaProcessingDebugPreview,
      validation,
      diffSummary,
      previewChecks,
      writeAllowed: validation.blockingErrors.length === 0
    };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/write", async (request, reply) => {
    const params = ParamsSchema.parse(request.params);
    const body = WriteSchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const postRef = db.collection("posts").doc(params.postId);
    const snap = await postRef.get();
    if (!snap.exists) return reply.status(404).send({ error: "post_not_found" });
    const raw = (snap.data() ?? {}) as UnknownRecord;
    const rawHash = hashPostForRebuild(raw);
    if (rawHash !== body.expectedHash) {
      return reply.status(409).send({ error: "stale_hash", expectedHash: body.expectedHash, currentHash: rawHash });
    }
    const engagementSourceAudit = await auditPostEngagementSourcesV2(db, params.postId, raw);
    const normalized = normalizeMasterPostV2(raw, { postId: params.postId, strict: true, engagementSourceAudit });
    const validation = validateMasterPostV2(normalized.canonical, { engagementSourceAudit });
    if (validation.blockingErrors.length > 0 && !body.force) {
      return reply.status(422).send({ error: "blocking_validation_errors", validation });
    }
    const mediaProcessingDebugPreview = extractMediaProcessingDebugV2(raw);
    const ts = Date.now();
    const backupId = `${params.postId}_${ts}`;
    const backupPath = `postCanonicalBackups/${backupId}`;
    await db.collection("postCanonicalBackups").doc(backupId).set({
      postId: params.postId,
      createdAt: new Date().toISOString(),
      rawBefore: raw,
      rawHash,
      canonicalPreview: normalized.canonical,
      engagementSourceAudit,
      mediaProcessingDebugPreview: mediaProcessingDebugPreview ?? null,
      actor: { route: "debug/post-rebuilder/write" }
    });
    const canonicalToWrite = {
      ...normalized.canonical,
      audit: {
        ...normalized.canonical.audit,
        backupDocPath: backupPath
      }
    };
    await postRef.set(canonicalToWrite, { merge: true });
    if (mediaProcessingDebugPreview) {
      await postRef
        .collection("mediaProcessingDebug")
        .doc("masterPostV2")
        .set(mediaProcessingDebugPreview, { merge: true });
    }
    const fieldsWritten = [
      "schema",
      "lifecycle",
      "author",
      "text",
      "location",
      "classification",
      "media",
      "engagement",
      "engagementPreview",
      "ranking",
      "compatibility",
      "legacy",
      "audit"
    ];
    return {
      backupId,
      backupPath,
      canonical: canonicalToWrite,
      validation,
      fieldsWritten,
      mediaProcessingDebugWritten: Boolean(mediaProcessingDebugPreview)
    };
  });

  app.get<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/backups", async (request) => {
    const params = ParamsSchema.parse(request.params);
    const db = getFirestoreSourceClient();
    if (!db) return { postId: params.postId, backups: [] };
    const snap = await db
      .collection("postCanonicalBackups")
      .where("postId", "==", params.postId)
      .orderBy("createdAt", "desc")
      .limit(30)
      .get();
    return {
      postId: params.postId,
      backups: snap.docs.map((doc) => ({ backupId: doc.id, ...(doc.data() ?? {}) }))
    };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/revert", async (request, reply) => {
    const params = ParamsSchema.parse(request.params);
    const body = RevertSchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const backupSnap = await db.collection("postCanonicalBackups").doc(body.backupId).get();
    if (!backupSnap.exists) return reply.status(404).send({ error: "backup_not_found" });
    const backup = (backupSnap.data() ?? {}) as Record<string, any>;
    if (backup.postId !== params.postId) return reply.status(400).send({ error: "backup_post_mismatch" });
    const rawBefore = backup.rawBefore;
    await db.collection("posts").doc(params.postId).set(rawBefore, { merge: false });
    await db
      .collection("posts")
      .doc(params.postId)
      .collection("mediaProcessingDebug")
      .doc("revertAudit")
      .set(
        {
          backupId: body.backupId,
          revertedAt: new Date().toISOString(),
          action: "restore_rawBefore_exact"
        },
        { merge: true }
      );
    return { success: true, postId: params.postId, backupId: body.backupId, restoredAt: new Date().toISOString() };
  });
}
