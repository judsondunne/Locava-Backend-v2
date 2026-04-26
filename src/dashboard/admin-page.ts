export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Locava Backend V2 Admin</title>
    <style>
      body { font-family: Inter, Arial, sans-serif; margin: 20px; background: #0f172a; color: #e2e8f0; }
      h1, h2 { margin-bottom: 8px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .panel { border: 1px solid #334155; border-radius: 8px; padding: 12px; background: #111827; }
      button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
      input { background: #1f2937; border: 1px solid #334155; color: #fff; border-radius: 6px; padding: 6px; width: 120px; }
      pre { white-space: pre-wrap; word-break: break-word; background: #020617; padding: 8px; border-radius: 6px; max-height: 280px; overflow: auto; }
      ul { margin: 0; padding-left: 20px; }
      .wide { grid-column: 1 / -1; }
    </style>
  </head>
  <body>
    <h1>Locava Backend V2 Diagnostics</h1>
    <p>Internal dashboard for route visibility, diagnostics, and curl-equivalent test triggering.</p>

    <div class="grid">
      <section class="panel">
        <h2>Environment</h2>
        <button onclick="loadEnv()">Refresh</button>
        <pre id="env"></pre>
      </section>

      <section class="panel">
        <h2>Routes</h2>
        <button onclick="loadRoutes()">Refresh</button>
        <pre id="routes"></pre>
      </section>

      <section class="panel">
        <h2>Run Test Route</h2>
        <div>
          <button onclick="callRoute('/test/ping')">GET /test/ping</button>
          <button onclick="callRoute('/test/error')">GET /test/error</button>
        </div>
        <div style="margin-top: 8px;">
          <label>Slow ms <input id="slowMs" value="500" /></label>
          <button onclick="callRoute('/test/slow?ms=' + document.getElementById('slowMs').value)">GET /test/slow</button>
        </div>
        <div style="margin-top: 8px;">
          <label>Reads <input id="reads" value="2" /></label>
          <label>Writes <input id="writes" value="1" /></label>
          <button onclick="callRoute('/test/db-simulate?reads=' + document.getElementById('reads').value + '&writes=' + document.getElementById('writes').value)">GET /test/db-simulate</button>
        </div>
        <pre id="testOutput"></pre>
      </section>

      <section class="panel">
        <h2>Diagnostics</h2>
        <button onclick="loadDiagnostics()">Refresh</button>
        <pre id="diagnostics"></pre>
      </section>

      <section class="panel wide">
        <h2>Recent request metrics</h2>
        <ul id="requestList"></ul>
      </section>
    </div>

    <script>
      async function json(path, options) {
        const response = await fetch(path, options);
        return response.json();
      }
      function set(id, value) {
        document.getElementById(id).textContent = JSON.stringify(value, null, 2);
      }
      async function loadEnv() {
        set('env', await json('/diagnostics?limit=1'));
      }
      async function loadRoutes() {
        set('routes', await json('/routes'));
      }
      async function callRoute(path) {
        const payload = path.includes('/test/echo')
          ? await json(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'dashboard' }) })
          : await json(path);
        set('testOutput', payload);
        await loadDiagnostics();
      }
      async function loadDiagnostics() {
        const payload = await json('/diagnostics');
        set('diagnostics', payload);
        const list = document.getElementById('requestList');
        list.innerHTML = '';
        const rows = payload?.data?.recentRequests || [];
        for (const row of rows.slice(0, 10)) {
          const item = document.createElement('li');
          item.textContent =
            row.method + ' ' + row.route + ' => ' + row.statusCode + ' in ' + row.latencyMs +
            'ms (db r:' + row.dbOps.reads + ' w:' + row.dbOps.writes + ' q:' + row.dbOps.queries + ')';
          list.appendChild(item);
        }
      }
      loadEnv();
      loadRoutes();
      loadDiagnostics();
    </script>
  </body>
</html>`;
}
