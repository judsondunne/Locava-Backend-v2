import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addressBackfillService } from "../../services/location/addressBackfill.service.js";

const PreviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().optional(),
  resolve: z.coerce.boolean().optional().default(false),
  force: z.coerce.boolean().optional().default(false)
});

const RunOneSchema = z.object({
  postId: z.string().min(1),
  dryRun: z.boolean().optional().default(true),
  force: z.boolean().optional().default(false),
  confirmAddressOnlyWrite: z.boolean().optional().default(false)
});

const RunBatchSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(10),
  cursor: z.string().optional(),
  dryRun: z.boolean().optional().default(true),
  force: z.boolean().optional().default(false),
  confirmAddressOnlyWrite: z.boolean().optional().default(false)
});
const RunAllSchema = z.object({
  batchLimit: z.number().int().min(1).max(50).optional().default(10),
  dryRun: z.boolean().optional().default(true),
  force: z.boolean().optional().default(false),
  confirmAddressOnlyWrite: z.boolean().optional().default(false),
  maxBatches: z.number().int().min(1).max(1000).optional().default(200)
});

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Address Backfill Dashboard</title>
    <style>
      body { font-family: Inter, Arial, sans-serif; margin: 20px; background: #0f172a; color: #e2e8f0; }
      h1, h2, h3 { margin: 0 0 8px 0; }
      .muted { color: #94a3b8; }
      .panel { border: 1px solid #334155; border-radius: 8px; padding: 12px; background: #111827; margin-bottom: 12px; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      input, button { background: #1f2937; border: 1px solid #334155; color: #fff; border-radius: 6px; padding: 8px; }
      button { cursor: pointer; background: #2563eb; }
      button.warn { background: #b45309; }
      button.danger { background: #b91c1c; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { border-bottom: 1px solid #334155; text-align: left; padding: 6px; font-size: 13px; vertical-align: top; }
      pre { background: #020617; padding: 8px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow: auto; }
    </style>
  </head>
  <body>
    <h1>Post Address Backfill</h1>
    <p class="muted">Manual-only tool. Default is dry run. Real writes require confirm flag and only update address display fields.</p>
    <div class="panel">
      <h3>Summary</h3>
      <div id="summary" class="muted">No preview yet.</div>
      <div id="progress" class="muted" style="margin-top:6px;"></div>
    </div>
    <div class="panel">
      <h3>Controls</h3>
      <div class="row">
        <label>Limit <input id="limit" value="10" style="width:80px"/></label>
        <label>Cursor <input id="cursor" value="0" style="width:100px"/></label>
        <label><input id="force" type="checkbox"/> force (include existing address)</label>
      </div>
      <div class="row" style="margin-top:8px;">
        <button onclick="preview(false)">Preview next candidates</button>
        <button onclick="preview(true)">Preview + resolve addresses</button>
        <button onclick="runBatch(true, 10)">Dry run next 10</button>
        <button class="warn" onclick="runBatch(false, 10)">Write next 10 (address fields only)</button>
        <button class="warn" onclick="runBatch(false, 25)">Write next 25 (address fields only)</button>
        <button class="danger" onclick="runBatch(false, 50)">Write next 50 (address fields only)</button>
        <button class="danger" onclick="runAll(false)">Write ALL candidates (address field only)</button>
      </div>
      <div class="row" style="margin-top:8px;">
        <label>Post ID <input id="singlePostId" style="width:280px" placeholder="post id"/></label>
        <button onclick="runOne(true)">Dry run this post</button>
        <button class="warn" onclick="runOne(false)">Write address for this post</button>
      </div>
    </div>
    <div class="panel">
      <h3>Candidates (newest first)</h3>
      <table>
        <thead>
          <tr>
            <th>postId</th><th>title</th><th>userId</th><th>time</th><th>lat</th><th>lng</th><th>current address</th><th>resolved preview</th><th>status</th><th>reason</th><th>actions</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <div class="panel">
      <h3>Last run summary</h3>
      <pre id="lastRun"></pre>
    </div>
    <script>
      async function api(path, options) {
        const response = await fetch(path, options);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || body.message || ('http_' + response.status));
        return body;
      }
      function getLimit() {
        const n = Number(document.getElementById('limit').value || '10');
        return Number.isFinite(n) && n > 0 ? n : 10;
      }
      function getCursor() {
        return String(document.getElementById('cursor').value || '0');
      }
      function getForce() {
        return document.getElementById('force').checked;
      }
      function setProgress(text) {
        document.getElementById('progress').textContent = text;
      }
      function setSummary(payload) {
        document.getElementById('summary').textContent =
          'scanned=' + payload.scannedCount +
          ' candidates=' + payload.candidateCount +
          ' skippedAlreadyAddress=' + payload.skippedAlreadyAddressCount +
          ' skippedInvalidCoords=' + payload.skippedInvalidCoordsCount +
          ' skippedDeleted=' + payload.skippedDeletedCount;
      }
      function escapeHtml(value) {
        return String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }
      function cleanAddressForDisplay(value) {
        const full = String(value ?? '').trim();
        if (!full) return '';
        const parts = full.split(',').map((part) => part.trim()).filter(Boolean);
        if (parts.length <= 1) return full;
        const countryTokens = new Set([
          'US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA',
          'HU', 'HUNGARY',
          'GR', 'GREECE', 'ΕΛΛΑΔΑ',
          'GB', 'UNITED KINGDOM',
          'CA', 'CANADA',
          'AU', 'AUSTRALIA',
          'DE', 'GERMANY',
          'FR', 'FRANCE',
          'IT', 'ITALY',
          'ES', 'SPAIN',
          'PT', 'PORTUGAL',
          'NL', 'NETHERLANDS',
          'BE', 'BELGIUM',
          'AT', 'AUSTRIA',
          'CH', 'SWITZERLAND',
          'IE', 'IRELAND',
          'SE', 'SWEDEN',
          'NO', 'NORWAY',
          'DK', 'DENMARK',
          'FI', 'FINLAND',
          'PL', 'POLAND',
          'CZ', 'CZECHIA',
          'SK', 'SLOVAKIA',
          'SI', 'SLOVENIA',
          'HR', 'CROATIA',
          'RO', 'ROMANIA',
          'BG', 'BULGARIA',
          'RS', 'SERBIA',
          'AL', 'ALBANIA',
          'ME', 'MONTENEGRO',
          'MK', 'NORTH MACEDONIA',
          'TR', 'TURKEY',
          'JP', 'JAPAN',
          'KR', 'SOUTH KOREA',
          'CN', 'CHINA',
          'IN', 'INDIA',
          'BR', 'BRAZIL',
          'MX', 'MEXICO',
          'AR', 'ARGENTINA',
          'CL', 'CHILE',
          'PE', 'PERU',
          'ZA', 'SOUTH AFRICA',
          'NZ', 'NEW ZEALAND'
        ]);
        const normalizeToken = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
        const countyHints = ['county', 'parish', 'prefecture', 'regional municipality', 'περιφερειακή ενότητα', 'Δημοτική Ενότητα', 'arrondissement'];
        const filtered = parts.filter((part, index) => {
          const up = normalizeToken(part);
          const looksLikeCountryCode = /^[A-Z]{2,3}$/.test(up);
          if (index === parts.length - 1 && (looksLikeCountryCode || countryTokens.has(up))) return false;
          const lower = part.toLowerCase();
          if (countyHints.some((hint) => lower.includes(hint.toLowerCase()))) return false;
          return true;
        });
        const cleaned = filtered.join(', ') || full;
        const maxChars = 'Sunset Ridge Trail, Underhill, Vermont'.length;
        if (cleaned.length <= maxChars) return cleaned;
        const bounded = cleaned.slice(0, maxChars);
        const lastComma = bounded.lastIndexOf(',');
        if (lastComma > 0) return bounded.slice(0, lastComma).trim();
        return bounded.trim();
      }
      function renderRows(rows) {
        const body = document.getElementById('rows');
        body.innerHTML = '';
        for (const row of rows) {
          const currentAddress = cleanAddressForDisplay(row.currentAddress);
          const resolvedAddress = cleanAddressForDisplay(row.resolvedAddress);
          const currentAddressCell = currentAddress ? '<span title="' + escapeHtml(currentAddress) + '">' + escapeHtml(currentAddress) + '</span>' : '';
          const resolvedAddressCell = resolvedAddress ? '<span title="' + escapeHtml(resolvedAddress) + '">' + escapeHtml(resolvedAddress) + '</span>' : '';
          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + escapeHtml(row.postId || '') + '</td>' +
            '<td>' + escapeHtml(row.title || '') + '</td>' +
            '<td>' + escapeHtml(row.userId || '') + '</td>' +
            '<td>' + escapeHtml(row.time ? JSON.stringify(row.time) : '') + '</td>' +
            '<td>' + (Number.isFinite(row.lat) ? row.lat : '') + '</td>' +
            '<td>' + (Number.isFinite(row.lng) ? row.lng : '') + '</td>' +
            '<td>' + currentAddressCell + '</td>' +
            '<td>' + resolvedAddressCell + '</td>' +
            '<td>' + escapeHtml(row.status || '') + '</td>' +
            '<td>' + escapeHtml(row.reason || '') + '</td>' +
            '<td>' +
              (row.postId ? '<button onclick="runOneFromTable(\\'' + row.postId + '\\', true)">Dry run</button> <button class="warn" onclick="runOneFromTable(\\'' + row.postId + '\\', false)">Write address only</button>' : '') +
            '</td>';
          body.appendChild(tr);
        }
      }
      async function preview(resolve) {
        setProgress('Loading preview...');
        try {
          const query = new URLSearchParams({
            limit: String(getLimit()),
            cursor: getCursor(),
            resolve: String(resolve),
            force: String(getForce())
          });
          const payload = await api('/debug/api/address-backfill/preview?' + query.toString());
          setSummary(payload);
          renderRows(payload.rows || []);
          document.getElementById('cursor').value = payload.nextCursor || getCursor();
          document.getElementById('lastRun').textContent = JSON.stringify(payload, null, 2);
          setProgress('Preview loaded.');
        } catch (error) {
          setProgress(String(error.message || error));
        }
      }
      async function runOne(dryRun) {
        const postId = String(document.getElementById('singlePostId').value || '').trim();
        if (!postId) return setProgress('post id is required');
        return runOneByPostId(postId, dryRun);
      }
      async function runOneFromTable(postId, dryRun) {
        return runOneByPostId(postId, dryRun);
      }
      async function runOneByPostId(postId, dryRun) {
        setProgress((dryRun ? 'Dry running ' : 'Writing ') + postId + '...');
        try {
          const payload = await api('/debug/api/address-backfill/run-one', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postId,
              dryRun,
              force: getForce(),
              confirmAddressOnlyWrite: dryRun ? false : true
            })
          });
          document.getElementById('lastRun').textContent = JSON.stringify(payload, null, 2);
          setProgress('Done: ' + (payload.status || 'ok'));
        } catch (error) {
          setProgress(String(error.message || error));
        }
      }
      async function runBatch(dryRun, limit) {
        setProgress((dryRun ? 'Dry run batch' : 'Write batch') + ' started...');
        try {
          const payload = await api('/debug/api/address-backfill/run-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              limit,
              cursor: getCursor(),
              dryRun,
              force: getForce(),
              confirmAddressOnlyWrite: dryRun ? false : true
            })
          });
          document.getElementById('lastRun').textContent = JSON.stringify(payload, null, 2);
          if (payload.nextCursor != null) document.getElementById('cursor').value = payload.nextCursor;
          setProgress('Batch complete. attempted=' + payload.attempted + ' updated=' + payload.updated + ' failed=' + payload.failed);
        } catch (error) {
          setProgress(String(error.message || error));
        }
      }
      async function runAll(dryRun) {
        setProgress((dryRun ? 'Dry run all' : 'Write all') + ' started...');
        try {
          const payload = await api('/debug/api/address-backfill/run-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              batchLimit: getLimit(),
              dryRun,
              force: getForce(),
              maxBatches: 200,
              confirmAddressOnlyWrite: dryRun ? false : true
            })
          });
          document.getElementById('lastRun').textContent = JSON.stringify(payload, null, 2);
          if (payload.nextCursor != null) document.getElementById('cursor').value = payload.nextCursor;
          setProgress('Run-all complete. batches=' + payload.batches + ' attempted=' + payload.attempted + ' updated=' + payload.updated + ' failed=' + payload.failed);
        } catch (error) {
          setProgress(String(error.message || error));
        }
      }
      preview(false);
    </script>
  </body>
</html>`;

export async function registerAddressBackfillRoutes(app: FastifyInstance): Promise<void> {
  app.get("/debug/address-backfill", async (_request, reply) => reply.type("text/html; charset=utf-8").send(page));

  app.get("/debug/api/address-backfill/preview", async (request, reply) => {
    const query = PreviewQuerySchema.parse(request.query);
    const payload = await addressBackfillService.preview(query);
    return reply.send(payload);
  });

  app.post("/debug/api/address-backfill/run-one", async (request, reply) => {
    const body = RunOneSchema.parse(request.body);
    if (body.dryRun === false && body.confirmAddressOnlyWrite !== true) {
      return reply.status(400).send({ error: "confirm_address_only_write_required" });
    }
    const result = await addressBackfillService.runOne(body);
    return reply.send(result);
  });

  app.post("/debug/api/address-backfill/run-batch", async (request, reply) => {
    const body = RunBatchSchema.parse(request.body);
    if (body.dryRun === false && body.confirmAddressOnlyWrite !== true) {
      return reply.status(400).send({ error: "confirm_address_only_write_required" });
    }
    const result = await addressBackfillService.runBatch(body);
    return reply.send(result);
  });

  app.post("/debug/api/address-backfill/run-all", async (request, reply) => {
    const body = RunAllSchema.parse(request.body);
    if (body.dryRun === false && body.confirmAddressOnlyWrite !== true) {
      return reply.status(400).send({ error: "confirm_address_only_write_required" });
    }
    const result = await addressBackfillService.runAll(body);
    return reply.send(result);
  });
}
