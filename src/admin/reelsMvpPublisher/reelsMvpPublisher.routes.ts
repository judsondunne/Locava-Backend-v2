import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { reelsMvpPublisherEnabledFromEnv, reelsMvpPublisherWriteEnabledFromEnv } from "./reelsMvpPublisherEnv.js";
import {
  batchDryRun,
  batchPublish,
  dryRunOne,
  listStagedForPublisher,
  publishOne,
  regenerateReelMediaFromStage,
  ReelsMvpPublisherDisabledError,
  ReelsMvpPublisherWriteDisabledError,
  verifyPostById
} from "./reelsMvpPublisher.service.js";
import { runReelsColorPreviewPackage } from "./reelsColorPreview.service.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

function gateDisabled(reply: { status: (n: number) => { send: (b: unknown) => void } }) {
  return reply.status(404).send(failure("reels_mvp_publisher_disabled", "Set REELS_MVP_PUBLISHER_ENABLED=true"));
}

const StagedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  readyOnly: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return true;
      if (typeof v === "boolean") return v;
      const s = String(v).trim().toLowerCase();
      return !(s === "0" || s === "false" || s === "no");
    })
});

const StageParamsSchema = z.object({ stageId: z.string().min(1) });

const DryRunBodySchema = z.object({
  allowFallbackAuthor: z.boolean().optional()
});

const PublishOneBodySchema = z.object({
  confirmWrite: z.boolean(),
  forceRebuild: z.boolean().optional(),
  allowFallbackAuthor: z.boolean().optional(),
  colorPipelinePreset: z.string().min(1).optional()
});

const PublishOneQuerySchema = z.object({
  stream: z.string().optional()
});

const RegenerateMediaBodySchema = z.object({
  postId: z.string().min(1),
  colorPipelinePreset: z.string().min(1),
  confirmWrite: z.literal(true)
});

const BatchDryBodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).optional().default(5)
});

const BatchPublishBodySchema = z.object({
  confirmWrite: z.boolean(),
  limit: z.coerce.number().int().min(1).max(50),
  stopOnError: z.boolean().optional().default(false)
});

function htmlAdminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Reels MVP Publisher</title>
  <style>
    body{font-family:ui-sans-serif,system-ui;margin:0;background:#0b1220;color:#e5e7eb}
    .shell{max-width:1280px;margin:0 auto;padding:22px 16px 48px}
    h1{font-size:22px;margin:0 0 6px}
    .muted{color:#9ca3af;font-size:13px;line-height:1.45}
    .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:14px 0}
    .puball-wrap{margin:18px 0;padding:16px;border-radius:14px;border:1px solid #334155;background:#111827}
    .puball-wrap p{margin:8px 0 0;font-size:13px}
    input,button,select{padding:8px 10px;border-radius:10px;border:1px solid #374151;background:#111827;color:#e5e7eb}
    button{cursor:pointer;font-weight:700}
    button.primary{background:#f97316;border-color:#ea580c;color:#111827}
    button:disabled{opacity:.45;cursor:not-allowed}
    table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
    th,td{border:1px solid #1f2937;padding:8px;text-align:left;vertical-align:top}
    th{background:#111827}
    .top-console{border:1px solid #334155;border-radius:14px;background:#020617;padding:14px 16px;margin:16px 0 20px;box-shadow:0 4px 24px rgba(0,0,0,.35)}
    .top-console-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:12px}
    .top-console-head strong{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fb923c}
    pre#log{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:12px;margin:0;max-height:min(40vh,320px);min-height:120px;overflow:auto;font-size:12px;line-height:1.45;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    pre#json{background:#020617;border:1px solid #1f2937;border-radius:12px;padding:12px;max-height:420px;overflow:auto;font-size:11px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    @media(max-width:900px){.grid2{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="shell">
    <h1>Reels MVP Publisher</h1>
    <p class="muted">Same exposure model as <code>/debug/post-rebuilder</code>: no auth on these routes; protect by keeping <code>REELS_MVP_PUBLISHER_ENABLED</code> off in shared/prod hosts and only enabling locally or on a locked-down admin port.</p>
    <p class="muted">Color v2: optional <code>POST …/publish-one</code> JSON <code>colorPipelinePreset</code> (default <code>phone-hlg-sdr-v1-mobius</code>). Compare presets via <code>POST …/:stageId/color-preview</code> (writes under <code>videos-lab-debug/reels-color-preview/…</code>). Regenerate published ladder via <code>POST …/:stageId/regenerate-media</code> with <code>postId</code>, <code>colorPipelinePreset</code>, <code>confirmWrite:true</code> (alias of publish with <code>forceRebuild</code>).</p>
    <section class="top-console" aria-label="Console">
      <div class="top-console-head">
        <strong>Console</strong>
      </div>
      <pre id="log">Idle.</pre>
    </section>
    <div class="row">
      <button type="button" id="refresh">Refresh staged reels</button>
      <label class="muted">limit</label>
      <input id="limit" type="number" value="50" style="width:72px"/>
      <label><input id="readyOnly" type="checkbox" checked/> ready only</label>
    </div>
    <div class="puball-wrap">
      <div class="row" style="margin:0 0 10px;gap:12px;flex-wrap:wrap">
        <button type="button" id="pubAll" class="primary" style="font-size:16px;padding:14px 20px">Publish all (one by one)</button>
        <button type="button" id="pubRetry" class="primary" style="font-size:15px;padding:12px 18px;background:#22c55e;border-color:#16a34a">Retry not published only</button>
      </div>
      <p class="muted" id="stagingCounts">Published: — · Not published yet: —</p>
      <p class="muted">Rows in table: <span id="pubAllCount">0</span>. <strong>Retry not published only</strong> skips rows whose staging <code>publish.status</code> is already <code>published</code> — that picks up network errors, <code>staged_invalid</code>, and anything else that did not finish.</p>
    </div>
    <div class="row">
      <button type="button" id="dryOne" class="primary">Dry run selected</button>
      <button type="button" id="pubOne">Publish selected</button>
      <button type="button" id="dryBatch">Batch dry run</button>
      <button type="button" id="pubBatch">Batch publish</button>
    </div>
    <table><thead><tr>
      <th></th><th>stage id</th><th>Firebase <code>posts/</code> id</th><th>title</th><th>posterUid</th><th>author</th><th>activities</th>
      <th>lat/lng</th><th>media</th><th>review</th><th>publish</th>
    </tr></thead><tbody id="tbody"></tbody></table>
    <div class="grid2" style="margin-top:14px">
      <div><h3>Preview JSON</h3><pre id="json">{}</pre></div>
      <div><h3>Selected id</h3><pre id="sel">—</pre></div>
    </div>
  </div>
  <script>
    let staged = [];
    let selectedId = '';
    let pubAllRunning = false;
    function jsonHeaders() {
      return { 'Content-Type': 'application/json' };
    }
    function log(line) {
      const el = document.getElementById('log');
      const ts = new Date().toISOString().slice(11, 23);
      el.textContent += '[' + ts + '] ' + line + "\\n";
      el.scrollTop = el.scrollHeight;
    }
    function replayPublishPayload(payload, opts) {
      opts = opts || {};
      if (!payload) return;
      if (!opts.skipTrace && Array.isArray(payload.trace) && payload.trace.length) {
        log('— server trace (' + payload.trace.length + ' lines) —');
        for (const t of payload.trace) log(String(t));
        log('— end server trace —');
      }
      if (payload.readBack) log('readBack: ' + JSON.stringify(payload.readBack));
      log('summary: ok=' + payload.ok + ' code=' + (payload.code || '') + (payload.postId ? ' postId=' + payload.postId : ''));
    }
    async function fetchPublishOneNdjson(stageId, body) {
      const res = await fetch(
        '/internal/admin/reels-mvp-publisher/' + encodeURIComponent(stageId) + '/publish-one?stream=1',
        { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) }
      );
      if (!res.ok) {
        const text = await res.text();
        let j = null;
        try { j = JSON.parse(text); } catch (_e) {}
        throw new Error((j && j.message) || text || String(res.status));
      }
      if (!res.body) throw new Error('no_response_body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalData = null;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch (_e) { log('ndjson_parse_skip ' + line.slice(0, 120)); continue; }
          if (msg.type === 'log' && msg.line) log(String(msg.line));
          else if (msg.type === 'done') finalData = msg.data;
          else if (msg.type === 'error') throw new Error(msg.message || 'stream_error');
        }
      }
      if (!finalData) throw new Error('publish_stream_no_result');
      return finalData;
    }
    async function fetchJson(path, opts = {}) {
      const res = await fetch(path, { ...opts, headers: { ...jsonHeaders(), ...(opts.headers||{}) } });
      const text = await res.text();
      let j = null;
      try { j = JSON.parse(text); } catch { j = { raw: text }; }
      if (!res.ok) throw new Error((j && j.message) || text || res.status);
      return j;
    }
    function stagingPublishStatus(row) {
      var p = row.publish || (row.row && row.row.publish);
      return p && p.status ? String(p.status) : '';
    }
    function isStagingPublished(row) {
      return stagingPublishStatus(row) === 'published';
    }
    function updateStagingCounts() {
      var pub = 0;
      var notPub = 0;
      for (var i = 0; i < staged.length; i++) {
        if (isStagingPublished(staged[i])) pub++;
        else notPub++;
      }
      var cEl = document.getElementById('pubAllCount');
      if (cEl) cEl.textContent = String(staged.length);
      var sc = document.getElementById('stagingCounts');
      if (sc) sc.textContent = 'Published: ' + pub + ' · Not published yet: ' + notPub;
    }
    function pick(sel) {
      selectedId = sel;
      const row = staged.find(function (x) { return x.id === sel; });
      const ep = row && row.expectedPostId;
      document.getElementById('sel').textContent = sel ? ('stageId: ' + sel + '\\nposts/' + (ep || '?')) : '—';
    }
    function render() {
      const tb = document.getElementById('tbody');
      tb.innerHTML = '';
      for (const row of staged) {
        const r = row.row || {};
        const d = r.draft || {};
        const m = r.media || {};
        const tr = document.createElement('tr');
        const id = row.id;
        tr.innerHTML = '<td><input type="radio" name="p" '+(id===selectedId?'checked':'')+'/></td>'+
          '<td>'+id+'</td><td style="max-width:140px;word-break:break-all">'+(row.expectedPostId||'')+'</td><td>'+(d.title||'')+'</td><td>'+(d.posterUid||'')+'</td>'+
          '<td>'+JSON.stringify(row.authorPreview||null)+'</td>'+
          '<td>'+JSON.stringify(d.activities||[])+'</td>'+
          '<td>'+(d.lat??'')+','+(d.lng??'')+'</td>'+
          '<td style="max-width:180px;word-break:break-all">'+(m.originalUrl||'')+'</td>'+
          '<td>'+(r.reviewState||'')+'</td>'+
          '<td>'+JSON.stringify(r.publish||{})+'</td>';
        tr.querySelector('input').addEventListener('change', () => pick(id));
        tb.appendChild(tr);
      }
    }
    document.getElementById('refresh').onclick = async () => {
      document.getElementById('log').textContent = '';
      log('Loading…');
      try {
        const lim = Number(document.getElementById('limit').value||50);
        const ready = document.getElementById('readyOnly').checked;
        const j = await fetchJson('/internal/admin/reels-mvp-publisher/staged?limit='+encodeURIComponent(lim)+'&readyOnly='+(ready?'true':'false'));
        staged = (j.data && j.data.rows) || [];
        if (!selectedId && staged[0]) pick(staged[0].id);
        render();
        updateStagingCounts();
        log('Loaded '+staged.length+' rows');
      } catch(e) { log('ERR '+e.message); }
    };
    document.getElementById('dryOne').onclick = async () => {
      if (!selectedId) return alert('Select a row');
      const row = staged.find(function (x) { return x.id === selectedId; });
      log('Dry run stageId=' + selectedId + (row && row.expectedPostId ? ' (expect posts/' + row.expectedPostId + ')' : '') + '…');
      try {
        const j = await fetchJson('/internal/admin/reels-mvp-publisher/'+encodeURIComponent(selectedId)+'/dry-run', { method:'POST', body: '{}' });
        document.getElementById('json').textContent = JSON.stringify(j.data||j, null, 2);
        const dr = j.data && j.data.data;
        if (dr && dr.postId) log('Dry run done; server postId=' + dr.postId);
        else log('Dry run done');
      } catch(e) { log('ERR '+e.message); }
    };
    document.getElementById('pubOne').onclick = async () => {
      if (!selectedId) return alert('Select a row');
      if (!confirm('Publish ONE reel to /posts with confirmWrite?')) return;
      const row = staged.find(function (x) { return x.id === selectedId; });
      const exp = row && row.expectedPostId;
      log('Publish stageId=' + selectedId + (exp ? '; canonical doc id posts/' + exp : ''));
      log('Streaming logs: POST /publish-one?stream=1 …');
      try {
        const inner = await fetchPublishOneNdjson(selectedId, { confirmWrite: true });
        document.getElementById('json').textContent = JSON.stringify({ ok: true, data: { data: inner } }, null, 2);
        replayPublishPayload(inner, { skipTrace: true });
      } catch(e) { log('ERR '+e.message); }
    };
    document.getElementById('dryBatch').onclick = async () => {
      log('Batch dry…');
      try {
        const j = await fetchJson('/internal/admin/reels-mvp-publisher/batch-dry-run', { method:'POST', body: JSON.stringify({ limit:5 }) });
        document.getElementById('json').textContent = JSON.stringify(j.data||j, null, 2);
        log('Batch dry done');
      } catch(e) { log('ERR '+e.message); }
    };
    document.getElementById('pubBatch').onclick = async () => {
      if (!confirm('Batch publish ready reels?')) return;
      log('Batch publish…');
      try {
        const j = await fetchJson('/internal/admin/reels-mvp-publisher/batch-publish', {
          method:'POST',
          body: JSON.stringify({ confirmWrite:true, limit:3 })
        });
        document.getElementById('json').textContent = JSON.stringify(j.data||j, null, 2);
        const arr = (j.data && j.data.data) || [];
        if (Array.isArray(arr)) {
          arr.forEach(function (item, i) {
            log('— batch item ' + i + ' —');
            replayPublishPayload(item);
          });
        }
        log('Batch publish finished (' + (Array.isArray(arr) ? arr.length : 0) + ' items)');
      } catch(e) { log('ERR '+e.message); }
    };
    async function runPublishSequential(queue, confirmMsg, startBanner) {
      if (pubAllRunning) return;
      if (!queue.length) {
        alert('No reels in this list. Click Refresh.');
        return;
      }
      var n = queue.length;
      if (!confirm(confirmMsg)) return;
      pubAllRunning = true;
      var btnAll = document.getElementById('pubAll');
      var btnRetry = document.getElementById('pubRetry');
      btnAll.disabled = true;
      if (btnRetry) btnRetry.disabled = true;
      var ok = 0;
      var fail = 0;
      try {
        log(startBanner);
        for (var i = 0; i < queue.length; i++) {
          var row = queue[i];
          var sid = row.id;
          var ep = row.expectedPostId || '';
          log('— [' + (i + 1) + '/' + n + '] stageId=' + sid + (ep ? ' → posts/' + ep : '') + ' —');
          pick(sid);
          try {
            var inner = await fetchPublishOneNdjson(sid, { confirmWrite: true });
            document.getElementById('json').textContent = JSON.stringify({ ok: true, data: { data: inner } }, null, 2);
            replayPublishPayload(inner, { skipTrace: true });
            if (inner && inner.ok === true) {
              ok++;
            } else {
              fail++;
            }
          } catch (e) {
            log('ERR ' + e.message);
            fail++;
            log('(continuing with next reel)');
          }
        }
        log('══ Done — ok=' + ok + ' not_ok=' + fail + ' — click Refresh to reload publish status ══');
      } finally {
        pubAllRunning = false;
        btnAll.disabled = false;
        if (btnRetry) btnRetry.disabled = false;
        render();
      }
    }
    document.getElementById('pubAll').onclick = function () {
      runPublishSequential(
        staged,
        'Publish ALL ' + staged.length + ' reel(s) in the table?\\n\\nOne after another; already-published rows are skipped quickly on the server.',
        '══ Publish all: start (' + staged.length + ' reels) ══'
      );
    };
    document.getElementById('pubRetry').onclick = function () {
      var queue = staged.filter(function (r) {
        return !isStagingPublished(r);
      });
      var already = staged.length - queue.length;
      runPublishSequential(
        queue,
        'Retry ONLY ' + queue.length + ' reel(s) not marked published in staging?\\n\\n(Skipping ' + already + ' already published.)',
        '══ Retry not published: start (' + queue.length + ' reels) ══'
      );
    };
    document.getElementById('refresh').click();
  </script>
</body>
</html>`;
}

export async function registerReelsMvpPublisherRoutes(app: FastifyInstance): Promise<void> {
  const base = "/internal/admin/reels-mvp-publisher";

  app.get(`${base}/ui`, async (_request, reply) => {
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    return reply.type("text/html").send(htmlAdminPage());
  });

  app.get(`${base}/staged`, async (request, reply) => {
    setRouteName("internal.admin.reels_mvp_publisher.staged.get");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const q = StagedQuerySchema.parse(request.query ?? {});
    const rows = await listStagedForPublisher({
      env,
      limit: q.limit ?? 50,
      readyOnly: q.readyOnly ?? true
    });
    return success({ rows });
  });

  app.post(`${base}/:stageId/dry-run`, async (request, reply) => {
    setRouteName("internal.admin.reels_mvp_publisher.dry_run.post");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const params = StageParamsSchema.parse(request.params);
    const body = DryRunBodySchema.parse(request.body ?? {});
    try {
      const data = await dryRunOne({ env, stageId: params.stageId, allowFallbackAuthor: body.allowFallbackAuthor });
      return success({ data });
    } catch (e) {
      if (e instanceof ReelsMvpPublisherDisabledError) return gateDisabled(reply);
      return reply.status(400).send(failure("dry_run_failed", e instanceof Error ? e.message : String(e)));
    }
  });

  app.post(`${base}/:stageId/publish-one`, async (request, reply) => {
    setRouteName("internal.admin.reels_mvp_publisher.publish_one.post");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const params = StageParamsSchema.parse(request.params);
    const body = PublishOneBodySchema.parse(request.body ?? {});
    const query = PublishOneQuerySchema.parse(request.query ?? {});
    if (!reelsMvpPublisherWriteEnabledFromEnv(env) || body.confirmWrite !== true) {
      return reply
        .status(403)
        .send(
          failure(
            "write_disabled",
            "REELS_MVP_PUBLISHER_WRITE_ENABLED must be true and confirmWrite:true in body",
          ),
        );
    }

    if (query.stream === "1") {
      const stream = new PassThrough();
      void (async () => {
        const writeLine = (obj: unknown) => {
          stream.write(`${JSON.stringify(obj)}\n`);
        };
        try {
          const data = await publishOne({
            env,
            stageId: params.stageId,
            confirmWrite: body.confirmWrite,
            forceRebuild: body.forceRebuild,
            allowFallbackAuthor: body.allowFallbackAuthor,
            colorPipelinePreset: body.colorPipelinePreset,
            onLog: (line) => {
              app.log.info({ event: "reels_mvp_publisher_log", line });
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
      const data = await publishOne({
        env,
        stageId: params.stageId,
        confirmWrite: body.confirmWrite,
        forceRebuild: body.forceRebuild,
        allowFallbackAuthor: body.allowFallbackAuthor,
        colorPipelinePreset: body.colorPipelinePreset,
        onLog: (line) => app.log.info({ event: "reels_mvp_publisher_log", line })
      });
      return success({ data });
    } catch (e) {
      if (e instanceof ReelsMvpPublisherDisabledError) return gateDisabled(reply);
      if (e instanceof ReelsMvpPublisherWriteDisabledError) {
        return reply.status(403).send(failure("write_disabled", e.message));
      }
      return reply.status(400).send(failure("publish_failed", e instanceof Error ? e.message : String(e)));
    }
  });

  app.post(`${base}/batch-dry-run`, async (request, reply) => {
    setRouteName("internal.admin.reels_mvp_publisher.batch_dry_run.post");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const body = BatchDryBodySchema.parse(request.body ?? {});
    const data = await batchDryRun({ env, limit: body.limit ?? 5 });
    return success({ data });
  });

  app.post(`${base}/batch-publish`, async (request, reply) => {
    setRouteName("internal.admin.reels_mvp_publisher.batch_publish.post");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const body = BatchPublishBodySchema.parse(request.body ?? {});
    if (!reelsMvpPublisherWriteEnabledFromEnv(env) || body.confirmWrite !== true) {
      return reply.status(403).send(failure("write_disabled", "writes disabled or confirmWrite missing"));
    }
    try {
      const data = await batchPublish({
        env,
        limit: body.limit,
        confirmWrite: true,
        stopOnError: body.stopOnError,
        onLog: (line) => app.log.info({ event: "reels_mvp_publisher_log", line })
      });
      return success({ data });
    } catch (e) {
      if (e instanceof ReelsMvpPublisherWriteDisabledError) {
        return reply.status(403).send(failure("write_disabled", e.message));
      }
      throw e;
    }
  });

  app.post(`${base}/:stageId/color-preview`, async (request, reply) => {
    setRouteName("internal.admin.reels_mvp_publisher.color_preview.post");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const params = StageParamsSchema.parse(request.params);
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(500).send(failure("firestore_unavailable", "no db"));
    try {
      const data = await runReelsColorPreviewPackage({ db, stageId: params.stageId });
      return success({ data });
    } catch (e) {
      return reply.status(400).send(failure("color_preview_failed", e instanceof Error ? e.message : String(e)));
    }
  });

  app.post(`${base}/:stageId/regenerate-media`, async (request, reply) => {
    setRouteName("internal.admin.reels_mvp_publisher.regenerate_media.post");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const params = StageParamsSchema.parse(request.params);
    const body = RegenerateMediaBodySchema.parse(request.body ?? {});
    if (!reelsMvpPublisherWriteEnabledFromEnv(env)) {
      return reply.status(403).send(failure("write_disabled", "REELS_MVP_PUBLISHER_WRITE_ENABLED must be true"));
    }
    try {
      const data = await regenerateReelMediaFromStage({
        env,
        stageId: params.stageId,
        postId: body.postId,
        colorPipelinePreset: body.colorPipelinePreset,
        confirmWrite: body.confirmWrite,
        onLog: (line) => app.log.info({ event: "reels_mvp_publisher_log", line })
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

  app.get(`${base}/verify-post`, async (request, reply) => {
    setRouteName("internal.admin.reels_mvp_publisher.verify_post.get");
    const env = app.config as AppEnv;
    if (!reelsMvpPublisherEnabledFromEnv(env)) return gateDisabled(reply);
    const q = z.object({ postId: z.string().min(1) }).parse(request.query ?? {});
    const data = await verifyPostById({ env, postId: q.postId });
    return success({ data });
  });
}
