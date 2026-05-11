import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { reelsMvpPublisherEnabledFromEnv } from "../reelsMvpPublisher/reelsMvpPublisherEnv.js";
import {
  ReelsMvpPublisherDisabledError,
  ReelsMvpPublisherWriteDisabledError
} from "../reelsMvpPublisher/reelsMvpPublisher.service.js";
import {
  dryRunPostSingleVideoRepair,
  executePostSingleVideoRepair
} from "./postSingleVideoRepair.service.js";
import { scanUserPostDuplicatePairs } from "./userPostDuplicatesScan.service.js";
import { buildAidenBrossRepairQueueFromConnection } from "./aidenBrossWorkbench.service.js";
import { isValidFirestorePostDocId } from "./aidenBrossWorkbench.constants.js";

function gateDisabled(reply: { status: (n: number) => { send: (b: unknown) => void } }) {
  return reply.status(404).send(failure("reels_mvp_publisher_disabled", "Set REELS_MVP_PUBLISHER_ENABLED=true"));
}

const RepairBodySchema = z.object({
  postId: z
    .string()
    .min(1)
    .refine((s) => isValidFirestorePostDocId(s), "postId must be 8–64 chars [A-Za-z0-9_] (Firestore doc id; optional post_ prefix is stripped)"),
  newOriginalUrl: z.string().min(8),
  confirmWrite: z.boolean().optional(),
  colorPipelinePreset: z.string().min(1).optional()
});

const RepairQuerySchema = z.object({
  stream: z.string().optional()
});

const ScanUserDuplicatesBodySchema = z.object({
  userId: z.string().min(1).max(200).trim()
});

function htmlAdminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Post single-video repair (audio / ladder rebuild)</title>
  <style>
    body{font-family:ui-sans-serif,system-ui;margin:0;background:#0b1220;color:#e5e7eb}
    .shell{max-width:900px;margin:0 auto;padding:22px 16px 48px}
    .shell.wb-wide{max-width:1320px}
    .wb-mono{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all;color:#cbd5e1;line-height:1.35}
    .wb-queue ul li{font-size:13px;margin:6px 0;padding:8px 10px;background:#0f172a;border-radius:8px;border:1px solid #334155}
    .wb-main-grid{display:grid;grid-template-columns:minmax(320px,1fr) minmax(380px,1.15fr);gap:22px;align-items:start;margin-top:10px}
    @media (max-width:1040px){
      .wb-main-grid{grid-template-columns:1fr}
      .wb-right-stack{position:static;max-height:none}
    }
    .wb-left-stack{min-width:0}
    .wb-right-stack{position:sticky;top:10px;max-height:calc(100vh - 20px);overflow-y:auto;padding-right:8px}
    .wb-dual-head{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px;padding:0 2px}
    .wb-left-head-only .wb-dual-head,.wb-right-head-only .wb-dual-head{grid-template-columns:1fr;margin-bottom:12px}
    .wb-kicker{display:block;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:4px}
    .wb-col-title{font-size:15px;margin:0;color:#f1f5f9}
    .wb-repair-row{margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #1e293b}
    .wb-ig{background:#111827;border:1px solid #334155;border-radius:12px;padding:12px}
    .wb-all-reels-inner{display:flex;flex-direction:column;gap:14px}
    .wb-reel-card{background:#020617;border:1px solid #334155;border-radius:12px;padding:10px}
    .wb-reel-card video{width:100%;max-height:min(40vh,300px);object-fit:contain;border-radius:8px;background:#000;display:block}
    .wb-reel-meta{font-size:12px;color:#94a3b8;margin-bottom:6px;line-height:1.35}
    .wb-reel-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
    .wb-reel-actions button{width:auto;margin-top:0}
    .wb-poster-row{display:flex;gap:12px;align-items:flex-start}
    .wb-poster-row img{width:104px;height:auto;flex-shrink:0;border-radius:8px;border:1px solid #475569;background:#0f172a}
    .wb-ig-actions{display:flex;flex-direction:column;gap:8px;margin-top:10px}
    .wb-ig-actions button{width:auto;margin-top:0}
    .wb-ig-actions input{margin-top:0}
    h1{font-size:22px;margin:0 0 6px}
    .muted{color:#9ca3af;font-size:13px;line-height:1.45}
    label{display:block;font-size:12px;font-weight:700;margin:12px 0 6px;color:#cbd5e1}
    input,button{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid #374151;background:#111827;color:#e5e7eb;font-size:14px}
    button{cursor:pointer;font-weight:700;margin-top:10px}
    button.primary{background:#f97316;border-color:#ea580c;color:#111827}
    button.secondary{background:#1e293b;border-color:#334155;color:#e5e7eb}
    button:disabled{opacity:.45;cursor:not-allowed}
    .row{display:flex;gap:10px;margin-top:14px}
    .row button{flex:1;margin-top:0}
    .top-console{border:1px solid #334155;border-radius:14px;background:#020617;padding:14px 16px;margin:18px 0;box-shadow:0 4px 24px rgba(0,0,0,.35)}
    .top-console-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
    .top-console-head strong{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#38bdf8}
    pre#log{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:12px;margin:0;max-height:min(50vh,420px);min-height:160px;overflow:auto;font-size:12px;line-height:1.45;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    pre#json{background:#020617;border:1px solid #1f2937;border-radius:12px;padding:12px;max-height:360px;overflow:auto;font-size:11px;margin-top:8px}
    .tool-bar{margin:18px 0 8px;padding-top:14px;border-top:1px solid #1e293b}
    .tool-bar button.ghost{width:auto;margin-top:0;background:#1e293b;border-color:#475569;font-size:13px;padding:8px 14px}
    .modal-root{position:fixed;inset:0;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;z-index:100;padding:16px}
    .modal-root.open{display:flex}
    .modal-card{width:100%;max-width:560px;max-height:85vh;overflow:auto;background:#0f172a;border:1px solid #334155;border-radius:16px;padding:18px 20px 22px;box-shadow:0 16px 48px rgba(0,0,0,.5)}
    .modal-card h2{margin:0 0 8px;font-size:18px}
    .modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
    .modal-close{background:transparent;border:none;color:#9ca3af;font-size:22px;line-height:1;cursor:pointer;padding:4px 8px}
    .dup-tool-row{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;align-items:center}
    .dup-tool-row input{flex:1;min-width:160px;margin-top:0}
    .dup-tool-row button{width:auto;margin-top:0}
    #dupOut{margin-top:14px;font-size:13px;line-height:1.45}
    #dupOut section h4{margin:0 0 8px;font-size:14px;color:#fbbf24}
  </style>
</head>
<body>
  <div class="shell wb-wide">
    <section id="aidenWorkbench" style="margin-bottom:28px;padding-bottom:22px;border-bottom:1px solid #1e293b">
      <h2 style="font-size:18px;margin:0 0 6px">Aiden Bross · batch repair queue</h2>
      <p class="muted" style="margin:0 0 10px;font-size:13px">One Firestore read: <code>instagramCreatorProfiles/aiden.bross</code> (same merged Wasabi URLs as <a href="https://locava.app/creators/instagram-connection/aiden.bross" target="_blank" rel="noopener">the Instagram connection page</a>). Server matches 13 hard-coded <strong>post id + truncated admin-upload URL</strong> rows to full <code>.mp4</code> links on those reels, then you <strong>Match &amp; stage</strong> into <code>sessionStorage</code> and <strong>Run all staged repairs</strong>. Requires <code>REELS_MVP_PUBLISHER_ENABLED=true</code>; each regenerate sends <code>confirmWrite:true</code>.</p>
      <p class="muted" style="margin:0 0 10px;font-size:12px">If every repair says <code>post not found</code>, the server is on the wrong Firestore project (see JSON <code>firestoreProjectId</code>).</p>
      <div class="wb-queue" style="margin-top:12px">
        <h3 style="font-size:15px;margin:0 0 8px">Staging queue</h3>
        <ul id="wbQueueList" style="list-style:none;padding:0;margin:0 0 12px"></ul>
        <div class="row" style="margin-top:0">
          <button type="button" id="wbMatchStage" class="primary">Match &amp; stage from connection</button>
          <button type="button" id="wbRunQueue" class="primary">Run all staged repairs</button>
          <button type="button" id="wbRedoFailures" class="secondary" disabled>Redo last failures (0)</button>
          <button type="button" id="wbClearQueue" class="secondary">Clear queue</button>
        </div>
      </div>
    </section>
    <h1>Single post video repair</h1>
    <p class="muted">Rebuild <strong>exactly one</strong> <code>posts/{postId}</code> document: same title, activities, lat/lng, and engagement-preserving merge keys from the live snapshot, but re-run the full faststart + color ladder from a <strong>new trusted HTTPS original</strong> (Wasabi / Locava / S3). Requires <code>REELS_MVP_PUBLISHER_ENABLED=true</code>; regenerate requests must send <code>confirmWrite:true</code>.</p>
    <label for="postId">Post ID</label>
    <input id="postId" type="text" placeholder="QFawZvNe38NmKBLOe2NL" autocomplete="off"/>
    <label for="newOriginalUrl">New original video URL (HTTPS)</label>
    <input id="newOriginalUrl" type="url" placeholder="https://…wasabisys.com/…" autocomplete="off"/>
    <label for="colorPreset">Color preset (optional)</label>
    <input id="colorPreset" type="text" placeholder="default from server if empty"/>
    <div class="row">
      <button type="button" id="dry" class="secondary">Dry run</button>
      <button type="button" id="regen" class="primary">Regenerate (writes)</button>
    </div>
    <div class="tool-bar">
      <button type="button" id="openDupModal" class="ghost">Clean up duplicates</button>
      <p class="muted" style="margin:8px 0 0;font-size:12px">Opens a scanner: enter a user id, fetch their posts, list pairs with the <strong>same lat+lng</strong> or the <strong>same title</strong>. Read-only — nothing is deleted.</p>
    </div>
    <div id="dupModal" class="modal-root" role="dialog" aria-modal="true" aria-labelledby="dupModalTitle">
      <div class="modal-card" id="dupModalCard">
        <div class="modal-head">
          <h2 id="dupModalTitle">Duplicate post pairs (scan only)</h2>
          <button type="button" class="modal-close" id="dupModalClose" aria-label="Close">&times;</button>
        </div>
        <p class="muted" style="margin:0 0 10px">Queries <code>posts</code> where <code>userId</code> or <code>ownerId</code> matches (up to 1000 each). For each duplicate, playback <code>defaultUrl</code> and audio are read from the stored post only (no file probe). No writes.</p>
        <label for="dupUserId">User ID</label>
        <div class="dup-tool-row">
          <input id="dupUserId" type="text" placeholder="Firebase uid" autocomplete="off"/>
          <button type="button" id="dupScan" class="secondary">Scan</button>
        </div>
        <div id="dupOut"></div>
      </div>
    </div>
    <section class="top-console" aria-label="Console">
      <div class="top-console-head"><strong>Console</strong></div>
      <pre id="log">Idle.</pre>
    </section>
    <h3 class="muted" style="margin:0 0 6px">Last JSON</h3>
    <pre id="json">{}</pre>
  </div>
  <script>
    function jsonHeaders() { return { 'Content-Type': 'application/json' }; }
    function log(line) {
      var el = document.getElementById('log');
      var ts = new Date().toISOString().slice(11, 23);
      el.textContent += '[' + ts + '] ' + line + '\\n';
      el.scrollTop = el.scrollHeight;
    }
    async function fetchJson(path, opts) {
      opts = opts || {};
      var res = await fetch(path, Object.assign({}, opts, { headers: Object.assign({}, jsonHeaders(), (opts.headers || {})) }));
      var text = await res.text();
      var j = null;
      try { j = JSON.parse(text); } catch (_e) { j = { raw: text }; }
      if (!res.ok) throw new Error((j && j.message) || text || String(res.status));
      return j;
    }
    async function fetchRegenNdjson(body) {
      var res = await fetch('/internal/admin/post-single-video-repair/regenerate?stream=1', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        var t = await res.text();
        var j = null;
        try { j = JSON.parse(t); } catch (_e2) {}
        throw new Error((j && j.message) || t || String(res.status));
      }
      if (!res.body) throw new Error('no_response_body');
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var finalData = null;
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var nl;
        while ((nl = buffer.indexOf('\\n')) >= 0) {
          var line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          var msg;
          try { msg = JSON.parse(line); } catch (_e3) { log('ndjson_parse_skip ' + line.slice(0, 120)); continue; }
          if (msg.type === 'log' && msg.line) log(String(msg.line));
          else if (msg.type === 'done') finalData = msg.data;
          else if (msg.type === 'error') throw new Error(msg.message || 'stream_error');
        }
      }
      if (!finalData) throw new Error('stream_no_result');
      return finalData;
    }
    function payload() {
      var preset = document.getElementById('colorPreset').value.trim();
      return {
        postId: document.getElementById('postId').value.trim(),
        newOriginalUrl: document.getElementById('newOriginalUrl').value.trim(),
        colorPipelinePreset: preset || undefined
      };
    }
    document.getElementById('dry').onclick = async function () {
      document.getElementById('log').textContent = '';
      log('Dry run…');
      try {
        var j = await fetchJson('/internal/admin/post-single-video-repair/dry-run', {
          method: 'POST',
          body: JSON.stringify(payload())
        });
        var inner = (j.data && j.data.data !== undefined) ? j.data.data : j.data;
        document.getElementById('json').textContent = JSON.stringify(inner != null ? inner : j, null, 2);
        log('Dry run finished (see JSON).');
      } catch (e) { log('ERR ' + e.message); }
    };
    document.getElementById('regen').onclick = async function () {
      if (!confirm('Regenerate this ONE post in Firestore? confirmWrite will be sent.')) return;
      document.getElementById('log').textContent = '';
      log('Regenerate (streaming)…');
      try {
        var body = Object.assign({}, payload(), { confirmWrite: true });
        var inner = await fetchRegenNdjson(body);
        document.getElementById('json').textContent = JSON.stringify(inner, null, 2);
        log('done ok=' + inner.ok + ' code=' + (inner.code || ''));
      } catch (e) { log('ERR ' + e.message); }
    };
    (function dupModal() {
      var modal = document.getElementById('dupModal');
      var out = document.getElementById('dupOut');
      function openM() { modal.classList.add('open'); }
      function closeM() { modal.classList.remove('open'); }
      function renderDupResults(data) {
        out.textContent = '';
        if (!data) {
          out.textContent = 'No data.';
          return;
        }
        var head = document.createElement('p');
        head.className = 'muted';
        head.textContent =
          'Scanned ' +
          data.postsScanned +
          ' post(s) for user ' +
          data.userId +
          (data.possiblyTruncated
            ? ' — note: per-query limit reached; results may be incomplete.'
            : '');
        out.appendChild(head);
        var pairs = data.duplicatePairs || [];
        if (pairs.length === 0) {
          var p0 = document.createElement('p');
          p0.textContent = 'No duplicate pairs (same title or same lat+lng).';
          out.appendChild(p0);
          return;
        }
        function fmtAudio(v) {
          if (!v) return 'audio: unknown';
          if (v.hasAudio === true) return 'audio: yes (from post metadata)';
          if (v.hasAudio === false) return 'audio: no (from post metadata)';
          return 'audio: unknown (not on doc)';
        }
        function fmtVideoLine(label, postId, v) {
          if (!v) return label + ' ' + postId + ' — (no summary)';
          var hasV = v.hasVideoAsset ? 'yes' : 'no';
          var hasU = v.defaultPlaybackUrl ? 'yes' : 'no';
          return (
            label +
            ' ' +
            postId +
            ' — video row: ' +
            hasV +
            ' · playback defaultUrl: ' +
            hasU +
            ' · ' +
            fmtAudio(v)
          );
        }
        pairs.forEach(function (row) {
          var sec = document.createElement('section');
          sec.style.marginTop = '14px';
          sec.style.padding = '12px';
          sec.style.border = '1px solid #334155';
          sec.style.borderRadius = '10px';
          sec.style.background = '#111827';
          var h = document.createElement('h4');
          h.textContent = 'Duplicate pair ' + row.pairIndex;
          sec.appendChild(h);
          var p1 = document.createElement('p');
          p1.style.margin = '4px 0';
          p1.textContent = 'Firebase ID A: ' + row.postIdA;
          sec.appendChild(p1);
          var p1v = document.createElement('p');
          p1v.style.margin = '2px 0 8px';
          p1v.style.fontSize = '12px';
          p1v.style.color = '#a5b4fc';
          p1v.textContent = fmtVideoLine('↳ ', row.postIdA, row.postAVideo);
          sec.appendChild(p1v);
          var p2 = document.createElement('p');
          p2.style.margin = '4px 0';
          p2.textContent = 'Firebase ID B: ' + row.postIdB;
          sec.appendChild(p2);
          var p2v = document.createElement('p');
          p2v.style.margin = '2px 0 8px';
          p2v.style.fontSize = '12px';
          p2v.style.color = '#a5b4fc';
          p2v.textContent = fmtVideoLine('↳ ', row.postIdB, row.postBVideo);
          sec.appendChild(p2v);
          var pr = document.createElement('p');
          pr.style.margin = '8px 0 0';
          pr.style.fontSize = '12px';
          pr.style.color = '#9ca3af';
          var bits = ['Reasons: ' + (row.reasons || []).join(', ')];
          if (row.sharedTitle) bits.push('title: ' + row.sharedTitle);
          if (row.sharedLatLng) bits.push('lat,lng: ' + row.sharedLatLng.lat + ',' + row.sharedLatLng.lng);
          pr.textContent = bits.join(' · ');
          sec.appendChild(pr);
          out.appendChild(sec);
        });
      }
      document.getElementById('openDupModal').onclick = function () {
        out.textContent = '';
        openM();
      };
      document.getElementById('dupModalClose').onclick = closeM;
      modal.addEventListener('click', function (ev) {
        if (ev.target === modal) closeM();
      });
      document.getElementById('dupScan').onclick = async function () {
        var uid = document.getElementById('dupUserId').value.trim();
        if (!uid) return alert('Enter a user id');
        out.textContent = 'Scanning…';
        try {
          var j = await fetchJson('/internal/admin/post-single-video-repair/scan-user-post-duplicates', {
            method: 'POST',
            body: JSON.stringify({ userId: uid })
          });
          var inner = j.data && j.data.data !== undefined ? j.data.data : j.data;
          renderDupResults(inner);
          document.getElementById('json').textContent = JSON.stringify(inner != null ? inner : j, null, 2);
        } catch (e) {
          out.textContent = 'Error: ' + e.message;
        }
      };
    })();
    (function aidenWorkbench() {
      var QUEUE_SK = 'locava_post_single_video_repair_queue_v1';
      var FAILURES_SK = 'locava_post_single_video_repair_last_failures_v1';
      if (!document.getElementById('wbQueueList')) return;
      function loadQueue() {
        try {
          var raw = sessionStorage.getItem(QUEUE_SK);
          var q = raw ? JSON.parse(raw) : [];
          return Array.isArray(q) ? q : [];
        } catch (_e) {
          return [];
        }
      }
      function saveQueue(q) {
        sessionStorage.setItem(QUEUE_SK, JSON.stringify(q));
        renderQueue();
      }
      function loadLastFailures() {
        try {
          var raw = sessionStorage.getItem(FAILURES_SK);
          var a = raw ? JSON.parse(raw) : [];
          return Array.isArray(a) ? a : [];
        } catch (_e) {
          return [];
        }
      }
      function saveLastFailures(rows) {
        try {
          sessionStorage.setItem(FAILURES_SK, JSON.stringify(rows));
        } catch (_e2) {}
        syncRedoFailuresButton();
      }
      function syncRedoFailuresButton() {
        var btn = document.getElementById('wbRedoFailures');
        if (!btn) return;
        var n = loadLastFailures().length;
        btn.textContent = 'Redo last failures (' + n + ')';
        btn.disabled = n === 0;
      }
      function renderQueue() {
        var ul = document.getElementById('wbQueueList');
        if (!ul) return;
        ul.innerHTML = '';
        var q = loadQueue();
        if (q.length === 0) {
          var li0 = document.createElement('li');
          li0.style.opacity = '0.7';
          li0.textContent = '(empty — click Match & stage from connection)';
          ul.appendChild(li0);
          syncRedoFailuresButton();
          return;
        }
        q.forEach(function (item, idx) {
          var li = document.createElement('li');
          li.style.marginBottom = '6px';
          li.style.wordBreak = 'break-all';
          li.textContent =
            (idx + 1) + '. ' + item.postId + ' ← ' + (item.newOriginalUrl || '');
          ul.appendChild(li);
        });
        syncRedoFailuresButton();
      }
      function presetOpt() {
        var p = document.getElementById('colorPreset').value.trim();
        return p ? { colorPipelinePreset: p } : {};
      }
      async function matchAndStageFromConnection(replaceExisting) {
        try {
          var j = await fetchJson('/internal/admin/post-single-video-repair/aiden-bross-queue-from-connection', {
            method: 'GET'
          });
          var pack = j.data && j.data.data !== undefined ? j.data.data : j.data;
          var items = (pack && pack.items) || [];
          var errs = (pack && pack.errors) || [];
          if (errs.length) {
            log('match partial: ' + errs.length + ' row(s) failed — ' + JSON.stringify(errs).slice(0, 600));
          }
          if (!items.length) {
            alert(
              'No rows matched. Ensure instagramCreatorProfiles/aiden.bross has Wasabi URLs whose paths start with each hard-coded admin-video-uploads prefix.'
            );
            return;
          }
          if (replaceExisting && loadQueue().length) {
            if (!confirm('Replace current queue with ' + items.length + ' matched row(s)?')) return;
          }
          saveQueue(items);
          log(
            'staged ' +
              items.length +
              ' repair(s) from connection (profile exists=' +
              (pack.instagramProfileExists ? 'yes' : 'no') +
              ', reel count=' +
              (pack.instagramReelCount != null ? pack.instagramReelCount : '?') +
              ')'
          );
        } catch (err) {
          alert(err && err.message ? err.message : String(err));
        }
      }
      document.getElementById('wbMatchStage').onclick = function () {
        matchAndStageFromConnection(true);
      };
      document.getElementById('wbClearQueue').onclick = function () {
        if (!confirm('Clear entire local repair queue?')) return;
        saveQueue([]);
        log('repair queue cleared');
      };
      document.getElementById('wbRedoFailures').onclick = function () {
        var rows = loadLastFailures();
        if (!rows.length) return alert('No saved failures from the last batch run.');
        if (
          !confirm(
            'Replace the staging queue with ' +
              rows.length +
              ' failed row(s) from the last run? (You can edit Firestore / env first, then Run all again.)'
          )
        )
          return;
        var items = rows.map(function (r) {
          return { postId: r.postId, newOriginalUrl: r.newOriginalUrl };
        });
        saveQueue(items);
        log('queue replaced with ' + items.length + ' redo row(s)');
      };
      document.getElementById('wbRunQueue').onclick = async function () {
        var q = loadQueue();
        if (!q.length) return alert('Queue is empty — use Match & stage from connection first');
        if (!confirm('Run ' + q.length + ' staged repair(s) sequentially? Each will write Firestore.')) return;
        document.getElementById('log').textContent = '';
        var ok = 0;
        var fail = 0;
        var failureRows = [];
        for (var i = 0; i < q.length; i++) {
          var item = q[i];
          log('— queue ' + (i + 1) + '/' + q.length + ' postId=' + item.postId + ' —');
          try {
            var body = Object.assign({}, presetOpt(), {
              postId: item.postId,
              newOriginalUrl: item.newOriginalUrl,
              confirmWrite: true
            });
            var inner = await fetchRegenNdjson(body);
            document.getElementById('json').textContent = JSON.stringify(inner, null, 2);
            if (inner && inner.ok === true) {
              ok++;
            } else {
              fail++;
              failureRows.push({
                postId: item.postId,
                newOriginalUrl: item.newOriginalUrl,
                code: inner && inner.code ? inner.code : 'not_ok'
              });
              log('not ok: ' + JSON.stringify(inner).slice(0, 400));
            }
          } catch (e2) {
            fail++;
            failureRows.push({
              postId: item.postId,
              newOriginalUrl: item.newOriginalUrl,
              code: 'exception'
            });
            log('ERR ' + (e2 && e2.message ? e2.message : String(e2)));
          }
        }
        log('queue finished ok=' + ok + ' fail=' + fail);
        if (failureRows.length) {
          saveLastFailures(failureRows);
          log(
            'saved ' +
              failureRows.length +
              ' failed row(s) — click Redo last failures to put them back in the queue'
          );
        } else {
          saveLastFailures([]);
        }
      };
      renderQueue();
      if (!loadQueue().length) matchAndStageFromConnection(false);
    })();
  </script>
</body>
</html>`;
}

export async function registerPostSingleVideoRepairRoutes(app: FastifyInstance): Promise<void> {
  const base = "/internal/admin/post-single-video-repair";

  app.get(`${base}/ui`, async (_request, reply) => {
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    return reply.type("text/html").send(htmlAdminPage());
  });

  app.get(`${base}/aiden-bross-queue-from-connection`, async (_request, reply) => {
    setRouteName("internal.admin.post_single_video_repair.aiden_bross_queue_from_connection.get");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(500).send(failure("firestore_unavailable", "no db"));
    const data = await buildAidenBrossRepairQueueFromConnection({ db });
    return success({ data });
  });

  app.post(`${base}/scan-user-post-duplicates`, async (request, reply) => {
    setRouteName("internal.admin.post_single_video_repair.scan_user_post_duplicates.post");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const body = ScanUserDuplicatesBodySchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(500).send(failure("firestore_unavailable", "no db"));
    try {
      const data = await scanUserPostDuplicatePairs({ db, userId: body.userId });
      return success({ data });
    } catch (e) {
      return reply
        .status(400)
        .send(failure("scan_duplicates_failed", e instanceof Error ? e.message : String(e)));
    }
  });

  app.post(`${base}/dry-run`, async (request, reply) => {
    setRouteName("internal.admin.post_single_video_repair.dry_run.post");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const body = RepairBodySchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(500).send(failure("firestore_unavailable", "no db"));
    try {
      const data = await dryRunPostSingleVideoRepair({
        env,
        db,
        postId: body.postId,
        newOriginalUrl: body.newOriginalUrl
      });
      return success({ data });
    } catch (e) {
      if (e instanceof ReelsMvpPublisherDisabledError) return gateDisabled(reply);
      return reply.status(400).send(failure("dry_run_failed", e instanceof Error ? e.message : String(e)));
    }
  });

  app.post(`${base}/regenerate`, async (request, reply) => {
    setRouteName("internal.admin.post_single_video_repair.regenerate.post");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const body = RepairBodySchema.parse(request.body ?? {});
    const query = RepairQuerySchema.parse(request.query ?? {});

    if (body.confirmWrite !== true) {
      return reply
        .status(403)
        .send(failure("write_disabled", "confirmWrite:true is required in the JSON body"));
    }

    if (query.stream === "1") {
      const stream = new PassThrough();
      void (async () => {
        const writeLine = (obj: unknown) => {
          stream.write(`${JSON.stringify(obj)}\n`);
        };
        try {
          const data = await executePostSingleVideoRepair({
            env,
            postId: body.postId,
            newOriginalUrl: body.newOriginalUrl,
            confirmWrite: true,
            colorPipelinePreset: body.colorPipelinePreset,
            onLog: (line) => {
              app.log.info({ event: "post_single_video_repair_log", line });
              writeLine({ type: "log", line });
            }
          });
          writeLine({ type: "done", data });
        } catch (e) {
          writeLine({
            type: "error",
            message: e instanceof Error ? e.message : String(e)
          });
        } finally {
          stream.end();
        }
      })();
      reply.header("Content-Type", "application/x-ndjson; charset=utf-8");
      reply.header("Cache-Control", "no-store");
      reply.header("X-Accel-Buffering", "no");
      return reply.send(stream);
    }

    try {
      const data = await executePostSingleVideoRepair({
        env,
        postId: body.postId,
        newOriginalUrl: body.newOriginalUrl,
        confirmWrite: true,
        colorPipelinePreset: body.colorPipelinePreset,
        onLog: (line) => app.log.info({ event: "post_single_video_repair_log", line })
      });
      return success({ data });
    } catch (e) {
      if (e instanceof ReelsMvpPublisherDisabledError) return gateDisabled(reply);
      if (e instanceof ReelsMvpPublisherWriteDisabledError) {
        return reply.status(403).send(failure("write_disabled", e.message));
      }
      return reply.status(400).send(failure("regenerate_failed", e instanceof Error ? e.message : String(e)));
    }
  });
}
