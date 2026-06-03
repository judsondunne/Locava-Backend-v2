/**
 * Master National OSM Copier — /admin/openstreetmap/national-copier
 *
 * Single-purpose admin page: dry-run preview, then optional guarded write of
 * accepted OSM/offroad docs into unexploredSpots / unexploredRoutes. The page
 * intentionally hides state/chunk complexity from the user.
 */
export function renderOpenStreetMapNationalCopierPage(): string {
  const apiBase = "/admin/openstreetmap/api/national-copier";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Master National OSM Copier</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    a{color:#93c5fd;text-decoration:none}
    .shell{max-width:1280px;margin:0 auto;padding:20px 16px 48px}
    h1{font-size:24px;margin:0 0 4px}
    h2{font-size:14px;margin:0 0 8px;color:#cbd5e1;text-transform:uppercase;letter-spacing:.04em}
    p{margin:6px 0}
    .muted{color:#94a3b8;font-size:13px}
    .panel{border:1px solid #334155;border-radius:10px;background:#111827;padding:14px 16px;margin:14px 0}
    button{padding:8px 12px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:13px;cursor:pointer;font-weight:600;margin:2px}
    button.secondary{background:#334155}
    button.danger{background:#b91c1c}
    button.success{background:#15803d}
    button:disabled{opacity:.5;cursor:not-allowed}
    input,select{padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:12px}
    label{font-size:12px;color:#cbd5e1;display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0}
    .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border-top:1px solid #334155;padding:6px 8px;text-align:left;vertical-align:top}
    th{background:#0b1220;color:#94a3b8;font-weight:600;position:sticky;top:0;z-index:1}
    .badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;margin-right:8px;border:1px solid #334155}
    .badge.dry{background:#1e293b;color:#cbd5e1}
    .badge.emu{background:#172554;color:#93c5fd;border-color:#2563eb}
    .badge.prod{background:#450a0a;color:#fecaca;border-color:#b91c1c}
    .badge.ok{background:#052e16;color:#86efac;border-color:#166534}
    #warnProd{display:none;background:#450a0a;border:2px solid #b91c1c;color:#fecaca;padding:14px;border-radius:10px;margin:12px 0;font-weight:600}
    #statusBar{padding:12px 14px;border-radius:8px;border:1px solid #334155;background:#0b1220;font-size:13px;margin:12px 0}
    #statusBar.loading{border-color:#2563eb;background:#172554;color:#bfdbfe}
    #statusBar.ok{border-color:#166534;background:#052e16;color:#86efac}
    #statusBar.warn{border-color:#854d0e;background:#422006;color:#fcd34d}
    #statusBar.error{border-color:#b91c1c;background:#450a0a;color:#fecaca}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    .stat-value{font-size:18px;font-weight:700;margin-top:4px;color:#e2e8f0;word-break:break-all}
    .progress{height:10px;background:#1f2937;border-radius:6px;overflow:hidden;margin:8px 0}
    .progress > .bar{height:100%;background:linear-gradient(90deg,#2563eb,#22d3ee);width:0%;transition:width .25s ease}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #334155;font-size:10px;color:#cbd5e1;margin:2px 4px 2px 0;background:#0b1220}
    .pill.warn{border-color:#854d0e;color:#fcd34d}
    .pill.ok{border-color:#166534;color:#86efac}
    .pill.err{border-color:#b91c1c;color:#fca5a5}
    #eventLog{max-height:280px;overflow:auto;font-size:11px;line-height:1.55;background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px}
    #eventLog .ev{padding:2px 0;border-bottom:1px dashed #1f2937}
    #eventLog .ev.warn{color:#fcd34d}
    #eventLog .ev.error{color:#fca5a5}
    .doc-card{border:1px solid #1f2937;border-radius:8px;padding:10px 12px;margin:8px 0;background:#0b1220}
    .doc-card h3{font-size:14px;margin:0 0 6px;color:#e2e8f0}
    .doc-meta{font-size:11px;color:#94a3b8}
    #previewArea{max-height:520px;overflow:auto}
    code{background:#020617;padding:1px 4px;border-radius:3px;color:#93c5fd}
    .scary{color:#fca5a5;font-weight:700}
    .ok-text{color:#86efac;font-weight:600}
    details summary{cursor:pointer;font-size:12px;color:#93c5fd}
    pre{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#cbd5e1;white-space:pre-wrap;word-break:break-all;background:#020617;border-radius:6px;padding:8px;margin:6px 0}
  </style>
</head>
<body>
<div class="shell">
  <p>
    <a href="/admin">← Admin</a>
    · <a href="/admin/openstreetmap">OSM Classifier</a>
    · <a href="/admin/openstreetmap/national-import">National Import</a>
    · <a href="/admin/openstreetmap/offroad-master">Offroad Master</a>
  </p>
  <h1>Master National OSM Copier</h1>
  <p class="muted">
    Copy valid OpenStreetMap-generated spots and routes nationwide into Locava's
    <strong>unexplored inventory</strong>. Uses the existing classifier (no algorithm changes).
    The runner internally tiles by state to respect Overpass limits — you don't need to pick states.
  </p>

  <div class="panel">
    <h2>What this writes</h2>
    <p>
      <span class="badge ok">Target collections</span>
      <code>unexploredSpots</code> and <code>unexploredRoutes</code> only.
    </p>
    <p>
      <span class="badge prod">Never writes</span>
      <code>/posts</code>. Posts writes are blocked by both the copier and the existing OSM national write guard.
    </p>
    <p class="muted">
      Rejected items from the classifier are <strong>never written</strong>. Invalid items (missing coordinates,
      missing activities, etc.) are skipped and counted. Existing deterministic IDs are skipped when
      <code>skipExisting</code> is on.
    </p>
  </div>

  <div id="modeBadge" class="badge dry">DRY RUN PREVIEW</div>
  <div id="warnProd">⚠ PRODUCTION WRITE MODE ARMED — writes hit production Firestore the moment you click Start Write Run.</div>
  <div id="statusBar">Ready. Click <strong>Dry Run First Accepted Docs</strong> to preview.</div>

  <section class="panel">
    <h2>Controls</h2>
    <div class="row">
      <label>Dry-run limit
        <select id="dryRunLimit">
          <option value="10">10</option>
          <option value="20" selected>20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="500">500</option>
        </select>
      </label>
      <label>Max chunks to scan (dry run)
        <input id="maxChunksToScan" type="number" min="1" max="2000" value="3" style="width:80px"/>
      </label>
      <label>Chunk size (km)
        <input id="chunkSizeKm" type="number" min="20" max="300" value="120" style="width:80px"/>
      </label>
    </div>
    <div class="row">
      <label><input id="includeSpots" type="checkbox" checked/> Include spots</label>
      <label><input id="includeRoutes" type="checkbox" checked/> Include routes / offroading</label>
      <label><input id="includePublicOnly" type="checkbox" checked/> Only public-ready</label>
      <label><input id="includeReviewDocs" type="checkbox"/> Include review docs</label>
      <label><input id="buildUnexploredTiles" type="checkbox"/> Build unexploredTiles index</label>
      <label><input id="skipExisting" type="checkbox" checked/> Skip existing deterministic IDs</label>
    </div>
    <div class="row">
      <label>Max docs to write
        <input id="maxDocsToWrite" type="number" min="0" value="" placeholder="∞" style="width:90px"/>
      </label>
      <label>Max chunks to process
        <input id="maxChunksToProcess" type="number" min="0" value="" placeholder="∞" style="width:90px"/>
      </label>
      <label>Max writes / second
        <input id="maxWritesPerSecond" type="number" min="0" value="10" style="width:70px"/>
      </label>
      <label>Max writes / minute
        <input id="maxWritesPerMinute" type="number" min="0" value="3000" style="width:80px"/>
      </label>
      <label><input id="stopOnBudgetExceeded" type="checkbox" checked/> Stop on budget exceeded</label>
    </div>
    <div class="row">
      <label>Mode
        <select id="modeSelect">
          <option value="dry_run_preview" selected>Dry Run Preview</option>
          <option value="write">Write to Unexplored Inventory</option>
        </select>
      </label>
      <label>Write target
        <select id="writeTarget">
          <option value="none" selected>none (forced for dry runs)</option>
          <option value="emulator">emulator</option>
          <option value="production">production</option>
        </select>
      </label>
      <label>Production confirmation phrase
        <input id="confirmProductionWrite" type="text" placeholder="exact phrase required" style="min-width:340px"/>
      </label>
    </div>
    <div class="row">
      <button id="btnDryRun" class="success">Dry Run First Accepted Docs</button>
      <button id="btnStartWrite" class="danger" disabled>Start Write Run</button>
      <button id="btnPause" class="secondary" disabled>Pause</button>
      <button id="btnResume" class="secondary" disabled>Resume</button>
      <button id="btnCancel" class="secondary" disabled>Cancel</button>
      <button id="btnExport" class="secondary" disabled>Export Dry Run JSON</button>
      <button id="btnCopySummary" class="secondary" disabled>Copy Run Summary</button>
    </div>
    <p class="muted" id="guardHints">
      Write button stays disabled until <strong>Mode = Write</strong>, <strong>writeTarget = emulator or production</strong>,
      and (for production) the env var <code>OSM_NATIONAL_IMPORT_ALLOW_PROD_WRITE=true</code> is set with the exact phrase.
    </p>
  </section>

  <section class="panel">
    <h2>Progress</h2>
    <div class="progress"><div id="progressBar" class="bar"></div></div>
    <div id="progressPhase" class="muted">No run yet.</div>
    <div class="stat-grid" id="statGrid"></div>
  </section>

  <section class="panel">
    <h2>Samples</h2>
    <div class="row" id="sampleStrips">
      <div style="flex:1;min-width:280px">
        <div class="stat-label">Accepted activities</div>
        <div id="activitySamples" class="muted">—</div>
      </div>
      <div style="flex:1;min-width:280px">
        <div class="stat-label">Rejected reasons</div>
        <div id="rejectedSamples" class="muted">—</div>
      </div>
      <div style="flex:1;min-width:280px">
        <div class="stat-label">Missing metadata warnings</div>
        <div id="warningSamples" class="muted">—</div>
      </div>
    </div>
  </section>

  <section class="panel">
    <h2>Preview docs (first N accepted)</h2>
    <p class="muted">Each card is a real unexplored doc that would be written.</p>
    <div id="previewArea">No preview yet.</div>
  </section>

  <section class="panel">
    <h2>Event log</h2>
    <div id="eventLog">—</div>
  </section>

  <section class="panel">
    <h2>Tile status (collapsed)</h2>
    <details><summary id="tileSummary">No tiles yet.</summary>
      <div style="max-height:360px;overflow:auto;margin-top:8px">
        <table><thead><tr>
          <th>Tile</th><th>State</th><th>Status</th><th>Spots</th><th>Routes</th><th>Written</th>
          <th>Rejected</th><th>Dupes</th><th>Existing</th><th>Invalid</th><th>Overpass ms</th><th>Last error</th>
        </tr></thead><tbody id="tileBody"></tbody></table>
      </div>
    </details>
  </section>
</div>

<script>
const API = ${JSON.stringify(apiBase)};
let currentRunId = null;
let pollTimer = null;

function $(id){ return document.getElementById(id); }
function fmt(n){ return (n||0).toLocaleString(); }
function setStatus(msg, kind){ const el=$("statusBar"); el.textContent=msg; el.className=kind||""; }
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); }

async function api(path, opts){
  const res = await fetch(API + path, { headers:{"Content-Type":"application/json"}, ...opts });
  let json; try { json = await res.json(); } catch { throw new Error("Bad JSON HTTP "+res.status); }
  if (!json.ok) throw new Error((json.error&&json.error.message)||"request_failed");
  return json.data;
}

function readControls(){
  const numOrNull = (id) => { const v = $(id).value; if(v===""||v==null) return null; const n=Number(v); return Number.isFinite(n)?n:null; };
  return {
    mode: $("modeSelect").value,
    writeTarget: $("writeTarget").value,
    confirmProductionWrite: $("confirmProductionWrite").value || undefined,
    dryRunLimit: Number($("dryRunLimit").value),
    chunkSizeKm: Number($("chunkSizeKm").value),
    maxChunksToScan: Number($("maxChunksToScan").value),
    includeSpots: $("includeSpots").checked,
    includeRoutes: $("includeRoutes").checked,
    includePublicOnly: $("includePublicOnly").checked,
    includeReviewDocs: $("includeReviewDocs").checked,
    buildUnexploredTiles: $("buildUnexploredTiles").checked,
    skipExisting: $("skipExisting").checked,
    maxDocsToWrite: numOrNull("maxDocsToWrite"),
    maxChunksToProcess: numOrNull("maxChunksToProcess"),
    maxWritesPerSecond: Number($("maxWritesPerSecond").value),
    maxWritesPerMinute: Number($("maxWritesPerMinute").value),
    stopOnBudgetExceeded: $("stopOnBudgetExceeded").checked,
  };
}

function refreshGuardUi(){
  const c = readControls();
  const modeBadge = $("modeBadge");
  const warn = $("warnProd");
  const writeOk = c.mode === "write" && (c.writeTarget === "emulator" || c.writeTarget === "production");
  const prodReady = c.writeTarget === "production" && c.confirmProductionWrite === "I_UNDERSTAND_THIS_WILL_WRITE_NATIONAL_UNEXPLORED_SPOTS";
  $("btnStartWrite").disabled = !writeOk || !currentRunId || (c.writeTarget === "production" && !prodReady);

  if (c.mode === "dry_run_preview"){
    modeBadge.className = "badge dry"; modeBadge.textContent = "DRY RUN PREVIEW"; warn.style.display = "none";
    $("writeTarget").value = "none"; return;
  }
  if (c.writeTarget === "production"){
    modeBadge.className = "badge prod"; modeBadge.textContent = "PRODUCTION WRITE ARMED";
    warn.style.display = prodReady ? "block" : "block";
    return;
  }
  if (c.writeTarget === "emulator"){
    modeBadge.className = "badge emu"; modeBadge.textContent = "EMULATOR WRITE";
    warn.style.display = "none"; return;
  }
  modeBadge.className = "badge dry"; modeBadge.textContent = "WRITE MODE (no target)";
  warn.style.display = "none";
}

["modeSelect","writeTarget","confirmProductionWrite"].forEach(id => {
  $(id).addEventListener("input", refreshGuardUi);
  $(id).addEventListener("change", refreshGuardUi);
});

function renderSamples(run){
  const pills = (arr, klass) => (arr && arr.length ? arr.map(s => '<span class="pill '+klass+'">'+esc(s)+'</span>').join("") : "—");
  $("activitySamples").innerHTML = pills(run.acceptedActivitySamples, "ok");
  $("rejectedSamples").innerHTML = pills(run.rejectedReasonSamples, "warn");
  $("warningSamples").innerHTML = pills(run.missingMetadataWarnings.slice(0, 12), "err");
}

function renderDoc(doc){
  const activities = (doc.activities||[]).map(a => '<span class="pill ok">'+esc(a)+'</span>').join(" ");
  const geomLine = doc.kind === "unexplored_route" && doc.geometryStorage
    ? '<div class="doc-meta">Geometry: '+esc(doc.geometryStorage.mode)+' ('+fmt(doc.geometryStorage.pointCount)+' pts, '+fmt(doc.geometryStorage.segmentCount)+' segs)</div>'
    : '';
  const dist = doc.distanceLabel ? '<div class="doc-meta">'+esc(doc.distanceLabel)+'</div>' : '';
  const offroad = doc.offroadCategory ? '<div class="doc-meta">'+esc(doc.legalDisplayLabel||"")+' / '+esc(doc.offroadCategory)+'</div>' : '';
  const tagPreview = Object.entries(doc.sourceTagSample||{}).map(([k,v]) => '<code>'+esc(k)+'='+esc(v)+'</code>').join(" ");
  const warnings = (doc.warnings||[]).map(w => '<span class="pill err">'+esc(w)+'</span>').join(" ");
  return ''
    + '<div class="doc-card">'
    + '<h3>'+esc(doc.displayName)+' <span class="pill">'+esc(doc.kind)+'</span> <span class="pill">'+esc(doc.collection)+'</span></h3>'
    + '<div class="doc-meta">id: <code>'+esc(doc.id)+'</code></div>'
    + '<div class="doc-meta">'+esc(doc.primaryCategory)+' · lat '+doc.lat+', lng '+doc.lng+' · mapReadiness='+esc(doc.mapReadiness||"")+' · public='+doc.publicMapEligible+'</div>'
    + '<div class="doc-meta">sourceFamily=<code>'+esc(doc.sourceFamily)+'</code> · keys=['+doc.sourceKeys.slice(0,3).map(esc).join(", ")+']</div>'
    + '<div class="doc-meta">activities: '+(activities||'—')+'</div>'
    + dist + offroad + geomLine
    + (doc.parentPlaceName ? '<div class="doc-meta">parent: '+esc(doc.parentPlaceName)+'</div>' : '')
    + '<div class="doc-meta">tags: '+tagPreview+'</div>'
    + (warnings ? '<div class="doc-meta">warnings: '+warnings+'</div>' : '')
    + '</div>';
}

function renderRun(run){
  currentRunId = run.runId;
  refreshGuardUi();
  $("progressPhase").textContent = "Run "+run.runId+" — status="+run.status+" — phase="+run.phase+(run.currentStateCode?(" — current state="+run.currentStateCode):"");
  const total = Math.max(1, run.metrics.chunksTotal);
  const pct = Math.min(100, Math.round(((run.metrics.chunksCompleted + run.metrics.chunksSkipped) / total) * 100));
  $("progressBar").style.width = pct + "%";

  const m = run.metrics;
  const stats = [
    ["docs previewed", m.docsPreviewed],
    ["docs written", m.docsWritten],
    ["existing skipped", m.docsSkippedExisting],
    ["rejected skipped", m.docsSkippedRejected],
    ["invalid skipped", m.docsSkippedInvalid],
    ["duplicates skipped", m.docsSkippedDuplicate],
    ["chunks done", m.chunksCompleted+"/"+m.chunksTotal],
    ["chunks failed", m.chunksFailed],
    ["overpass calls", m.overpassRequests],
    ["overpass failures", m.overpassFailures],
    ["writes estimated", m.writesEstimated],
    ["writes actual", m.writesActual],
    ["reads actual", m.readsActual],
    ["elapsed ms", m.elapsedMs],
    ["ETA ms", m.estimatedTimeRemainingMs ?? "—"],
    ["docs / min", m.averageDocsPerMinute],
    ["writes / min", m.averageWritesPerMinute],
  ];
  $("statGrid").innerHTML = stats.map(([l,v]) => '<div class="stat-box"><div class="stat-label">'+esc(l)+'</div><div class="stat-value">'+esc(v)+'</div></div>').join("");

  $("previewArea").innerHTML = (run.previewDocs||[]).length
    ? run.previewDocs.map(renderDoc).join("")
    : '<p class="muted">No accepted docs yet.</p>';

  renderSamples(run);
  $("tileSummary").textContent = "Tiles: "+m.chunksCompleted+" complete, "+m.chunksFailed+" failed, "+m.chunksSkipped+" skipped (of "+m.chunksTotal+")";
  $("tileBody").innerHTML = (run.tiles||[]).slice(0, 200).map(t => '<tr>'
    +'<td><code>'+esc(t.tile.tileId)+'</code></td>'
    +'<td>'+esc(t.tile.stateCode)+'</td>'
    +'<td>'+esc(t.status)+'</td>'
    +'<td>'+fmt(t.acceptedSpots)+'</td>'
    +'<td>'+fmt(t.acceptedRoutes)+'</td>'
    +'<td>'+fmt((t.writtenSpots||0)+(t.writtenRoutes||0))+'</td>'
    +'<td>'+fmt(t.rejectedSkipped)+'</td>'
    +'<td>'+fmt(t.duplicatesSkipped)+'</td>'
    +'<td>'+fmt(t.existingSkipped)+'</td>'
    +'<td>'+fmt(t.invalidSkipped)+'</td>'
    +'<td>'+fmt(t.overpassMs||0)+'</td>'
    +'<td>'+esc(t.lastError||"")+'</td>'
    +'</tr>').join("");

  ["btnPause","btnResume","btnCancel","btnExport","btnCopySummary"].forEach(b => $(b).disabled = !currentRunId);
}

async function pollRun(){
  if (!currentRunId) return;
  try {
    const data = await api("/runs/"+encodeURIComponent(currentRunId));
    renderRun(data.run);
    const events = await api("/runs/"+encodeURIComponent(currentRunId)+"/events?limit=80");
    $("eventLog").innerHTML = (events.events||[]).map(e =>
      '<div class="ev '+esc(e.level)+'">['+esc(e.createdAt)+'] '+esc(e.phase)+' — '+esc(e.message)+'</div>'
    ).join("") || "—";
    if (["completed","failed","cancelled"].includes(data.run.status) || data.run.dryRunLimitReached) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      setStatus("Run "+data.run.status+(data.run.dryRunLimitReached?" (dry-run limit reached)":""), "ok");
    }
  } catch (err) {
    setStatus("Poll failed: "+err.message, "error");
  }
}

function startPolling(){
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollRun, 1500);
  pollRun();
}

$("btnDryRun").addEventListener("click", async () => {
  const c = readControls();
  setStatus("Running dry-run preview…", "loading");
  $("btnDryRun").disabled = true;
  try {
    const data = await api("/dry-run", { method: "POST", body: JSON.stringify({
      dryRunLimit: c.dryRunLimit,
      includeSpots: c.includeSpots,
      includeRoutes: c.includeRoutes,
      includePublicOnly: c.includePublicOnly,
      includeReviewDocs: c.includeReviewDocs,
      skipExisting: c.skipExisting,
      maxChunksToScan: c.maxChunksToScan,
      chunkSizeKm: c.chunkSizeKm,
    })});
    renderRun(data.run);
    setStatus("Dry run finished. Previewing first "+(data.run.previewDocs?.length||0)+" accepted docs.", "ok");
  } catch (err) {
    setStatus("Dry run failed: "+err.message, "error");
  } finally {
    $("btnDryRun").disabled = false;
  }
});

$("btnStartWrite").addEventListener("click", async () => {
  if (!confirm("Start write run? Writes go to "+($("writeTarget").value)+".")) return;
  const c = readControls();
  setStatus("Planning write run…", "loading");
  try {
    const planResp = await api("/runs/plan", { method:"POST", body: JSON.stringify({
      mode: "write",
      writeTarget: c.writeTarget,
      confirmProductionWrite: c.confirmProductionWrite,
      config: {
        dryRunLimit: c.dryRunLimit,
        includeSpots: c.includeSpots,
        includeRoutes: c.includeRoutes,
        includePublicOnly: c.includePublicOnly,
        includeReviewDocs: c.includeReviewDocs,
        buildUnexploredTiles: c.buildUnexploredTiles,
        skipExisting: c.skipExisting,
        maxDocsToWrite: c.maxDocsToWrite,
        maxChunksToProcess: c.maxChunksToProcess,
        maxWritesPerSecond: c.maxWritesPerSecond,
        maxWritesPerMinute: c.maxWritesPerMinute,
        stopOnBudgetExceeded: c.stopOnBudgetExceeded,
        chunkSizeKm: c.chunkSizeKm,
      }
    })});
    currentRunId = planResp.run.runId;
    renderRun(planResp.run);
    startPolling();
    await api("/runs/start", { method: "POST", body: JSON.stringify({ runId: currentRunId })});
    setStatus("Write run started. Polling progress…", "loading");
  } catch (err) {
    setStatus("Write start failed: "+err.message, "error");
  }
});

$("btnPause").addEventListener("click", async () => {
  if (!currentRunId) return;
  await api("/runs/"+encodeURIComponent(currentRunId)+"/pause", { method: "POST" });
  setStatus("Paused.", "warn");
});

$("btnResume").addEventListener("click", async () => {
  if (!currentRunId) return;
  await api("/runs/"+encodeURIComponent(currentRunId)+"/resume", { method: "POST" });
  setStatus("Resumed. Polling…", "loading");
  startPolling();
});

$("btnCancel").addEventListener("click", async () => {
  if (!currentRunId) return;
  if (!confirm("Cancel the current run?")) return;
  await api("/runs/"+encodeURIComponent(currentRunId)+"/cancel", { method: "POST" });
  setStatus("Cancelled.", "warn");
});

$("btnExport").addEventListener("click", async () => {
  if (!currentRunId) return;
  const data = await api("/runs/"+encodeURIComponent(currentRunId)+"/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "osm-national-copier-"+currentRunId+".json";
  a.click();
});

$("btnCopySummary").addEventListener("click", async () => {
  if (!currentRunId) return;
  const data = await api("/runs/"+encodeURIComponent(currentRunId)+"/export");
  const summary = [
    "Run "+data.export.runId,
    "Mode: "+data.export.mode+"  Status: "+data.export.status,
    "Metrics: "+JSON.stringify(data.export.metrics),
  ].join("\\n");
  try { await navigator.clipboard.writeText(summary); setStatus("Summary copied.", "ok"); }
  catch { setStatus("Copy failed.", "error"); }
});

refreshGuardUi();
</script>
</body>
</html>`;
}
