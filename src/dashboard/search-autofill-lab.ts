export function renderSearchAutofillLabPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Search Autofill Lab</title>
    <style>
      body { font-family: Inter, Arial, sans-serif; margin: 20px; background: #0f172a; color: #e2e8f0; }
      a { color: #93c5fd; text-decoration: none; }
      h1 { margin: 0 0 8px 0; }
      .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
      .panel { border: 1px solid #334155; border-radius: 10px; padding: 12px; background: #111827; }
      input, select { background: #1f2937; border: 1px solid #334155; color: #fff; border-radius: 8px; padding: 8px 10px; }
      input[type="text"] { min-width: 340px; }
      button { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
      button.secondary { background: #334155; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th, td { border-top: 1px solid #334155; padding: 8px; vertical-align: top; font-size: 13px; }
      th { text-align: left; color: #cbd5e1; font-weight: 600; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; color: #e2e8f0; }
      pre { white-space: pre-wrap; word-break: break-word; background: #020617; padding: 10px; border-radius: 8px; max-height: 320px; overflow: auto; }
      .pill { display:inline-block; padding: 2px 8px; border-radius: 999px; background:#0b1220; border: 1px solid #334155; margin-right: 6px; color:#cbd5e1; }
    </style>
  </head>
  <body>
    <div class="row">
      <h1>Search Autofill Lab</h1>
      <span style="opacity:.8">— synced to <code>/v2/search/suggest</code> + mix materialization via <code>/v2/search/mixes/feed</code></span>
    </div>
    <div class="row" style="opacity:.85">
      <a href="/admin">← Admin</a>
      <span>Tip: try <code>best hiking in vermont</code></span>
    </div>

    <section class="panel">
      <div class="row">
        <label>Query <input id="q" type="text" value="best hiking in vermont" /></label>
        <label>lat <input id="lat" value="44.4759" /></label>
        <label>lng <input id="lng" value="-73.2121" /></label>
        <label>viewerId <input id="viewerId" value="internal-viewer" /></label>
        <button onclick="runSuggest()">Suggest</button>
        <button class="secondary" onclick="clearOut()">Clear</button>
      </div>

      <div class="row" style="opacity:.85">
        <span class="pill">Generated mixes show as type <code>mix</code></span>
        <span class="pill">Materialize uses <code>mixSpecV1.v2MixId</code> if present</span>
      </div>

      <div id="status" style="margin-top:6px; opacity:.85"></div>
      <table>
        <thead>
          <tr>
            <th style="width: 90px">Type</th>
            <th>Text</th>
            <th style="width: 260px">Dynamic payload</th>
            <th style="width: 160px">Actions</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </section>

    <section class="panel" style="margin-top: 14px;">
      <h2 style="margin:0 0 8px 0; font-size: 16px;">Materialized dynamic collection preview</h2>
      <pre id="materialized"></pre>
    </section>

    <section class="panel" style="margin-top: 14px;">
      <h2 style="margin:0 0 8px 0; font-size: 16px;">Raw suggest payload</h2>
      <pre id="raw"></pre>
    </section>

    <script>
      function headers() {
        const viewerId = document.getElementById('viewerId').value.trim() || 'internal-viewer';
        return { 'x-viewer-id': viewerId, 'x-viewer-roles': 'internal', 'content-type': 'application/json' };
      }
      function set(id, value) {
        document.getElementById(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      }
      function clearOut() {
        document.getElementById('rows').innerHTML = '';
        set('raw', '');
        set('materialized', '');
        set('status', '');
      }
      async function getJson(url) {
        const res = await fetch(url, { headers: headers() });
        const body = await res.json().catch(() => ({}));
        return { status: res.status, body };
      }
      async function postJson(url, payload) {
        const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
        const body = await res.json().catch(() => ({}));
        return { status: res.status, body };
      }

      function tryResolveV2MixIdFromSuggestion(s) {
        const ms = s?.data?.mixSpecV1;
        if (ms && typeof ms.v2MixId === 'string' && ms.v2MixId.trim()) return ms.v2MixId.trim();
        const activity = ms?.seeds?.primaryActivityId ? String(ms.seeds.primaryActivityId).trim().toLowerCase() : '';
        if (activity) return 'activity:' + activity;
        return null;
      }

      async function materializeSuggestion(s) {
        const mixId = tryResolveV2MixIdFromSuggestion(s);
        if (!mixId) {
          set('materialized', { error: 'No v2 mix id resolvable from suggestion' });
          return;
        }
        const lat = Number(document.getElementById('lat').value);
        const lng = Number(document.getElementById('lng').value);
        const res = await postJson('/v2/search/mixes/feed', { mixId, cursor: null, limit: 12, lat: isFinite(lat) ? lat : null, lng: isFinite(lng) ? lng : null, includeDebug: true });
        set('materialized', { mixId, httpStatus: res.status, body: res.body });
      }

      async function runSuggest() {
        const q = document.getElementById('q').value.trim();
        const lat = document.getElementById('lat').value.trim();
        const lng = document.getElementById('lng').value.trim();
        if (!q) return;
        set('status', 'Loading…');
        const sp = new URLSearchParams();
        sp.set('q', q);
        if (lat) sp.set('lat', lat);
        if (lng) sp.set('lng', lng);
        const res = await getJson('/v2/search/suggest?' + sp.toString());
        set('raw', res.body);
        const suggestions = res?.body?.data?.suggestions ?? res?.body?.suggestions ?? [];
        const rowsEl = document.getElementById('rows');
        rowsEl.innerHTML = '';
        for (const s of suggestions) {
          const tr = document.createElement('tr');
          const type = String(s?.type ?? '');
          const text = String(s?.text ?? '');
          const v2MixId = tryResolveV2MixIdFromSuggestion(s);
          tr.innerHTML = \`
            <td><code>\${type}</code></td>
            <td>\${text ? text : '<span style="opacity:.7">(empty)</span>'}</td>
            <td>\${v2MixId ? '<code>' + v2MixId + '</code>' : '<span style="opacity:.7">—</span>'}</td>
            <td>\${type === 'mix' ? '<button class="secondary">Materialize</button>' : '<span style="opacity:.7">—</span>'}</td>
          \`;
          if (type === 'mix') {
            tr.querySelector('button').addEventListener('click', () => materializeSuggestion(s));
          }
          rowsEl.appendChild(tr);
        }
        set('status', 'OK (' + suggestions.length + ' suggestions)');
      }

      runSuggest();
    </script>
  </body>
</html>`;
}

