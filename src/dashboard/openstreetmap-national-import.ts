/**
 * National Unexplored OSM Import — /admin/openstreetmap/national-import
 */
export function renderOpenStreetMapNationalImportPage(): string {
  const apiBase = "/admin/openstreetmap/api/national";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>National Unexplored OSM Import</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    a{color:#93c5fd;text-decoration:none}
    .shell{max-width:1400px;margin:0 auto;padding:20px 16px 48px}
    h1{font-size:22px;margin:0 0 6px}
    .muted{color:#94a3b8;font-size:13px}
    .panel{border:1px solid #334155;border-radius:10px;background:#111827;padding:12px;margin:14px 0}
    button{padding:6px 10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:12px;cursor:pointer;font-weight:600;margin:2px}
    button.secondary{background:#334155}
    button.danger{background:#b91c1c}
    button:disabled{opacity:.5;cursor:not-allowed}
    input,select{padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:12px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border-top:1px solid #334155;padding:6px 8px;text-align:left;vertical-align:top}
    .badge{display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-right:8px}
    .badge.dry{background:#422006;color:#fcd34d;border:1px solid #854d0e}
    .badge.emu{background:#172554;color:#93c5fd;border:1px solid #2563eb}
    .badge.prod{background:#450a0a;color:#fca5a5;border:1px solid #b91c1c}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase}
    .stat-value{font-size:18px;font-weight:700;margin-top:4px}
    #warnProd{display:none;background:#450a0a;border:2px solid #b91c1c;color:#fecaca;padding:12px;border-radius:10px;margin:12px 0;font-weight:600}
    #statusBar{padding:10px 12px;border-radius:8px;border:1px solid #334155;background:#0b1220;font-size:13px;margin:12px 0}
    #statusBar.loading{border-color:#2563eb;background:#172554;color:#bfdbfe}
    #statusBar.error{border-color:#b91c1c;background:#450a0a;color:#fecaca}
    #statusBar.ok{border-color:#166534;background:#052e16;color:#86efac}
    #statusBar.warn{border-color:#854d0e;background:#422006;color:#fcd34d}
    #diagJson{width:100%;min-height:220px;font-family:ui-monospace,Menlo,monospace;font-size:11px;background:#020617;color:#cbd5e1;border:1px solid #334155;border-radius:8px;padding:8px}
    .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
    #activityFeed{max-height:240px;overflow:auto;font-size:12px;line-height:1.5}
    #planEstimate{font-size:12px;color:#cbd5e1;margin:6px 0 0}
    .help{font-size:12px;color:#94a3b8;line-height:1.5;margin:8px 0 0}
  </style>
</head>
<body>
<div class="shell">
  <p><a href="/admin">← Admin</a> · <a href="/admin/openstreetmap">OSM Classifier</a> · <a href="/admin/openstreetmap/offroad-master">Offroad Master</a></p>
  <h1>National Unexplored OSM Import</h1>
  <p class="muted">Resumable state-by-state OSM + offroad ingestion into <code>unexploredSpots</code> / <code>unexploredRoutes</code>. Progress reads run docs only — never scans generated collections.</p>

  <div id="writeBadge" class="badge dry">DRY RUN</div>
  <div id="warnProd">⚠ PRODUCTION WRITE MODE ARMED — writes go to production Firestore when started.</div>
  <div id="statusBar">Ready. For a first dry run, use <strong>Vermont only</strong>, then Plan → Start → Process Next Chunk.</div>

  <section class="panel">
    <h2 style="font-size:15px;margin:0 0 8px">Controls</h2>
    <div class="row">
      <label>States <select id="statePreset">
        <option value="VT" selected>Vermont only (recommended test)</option>
        <option value="NEW_ENGLAND">New England</option>
        <option value="CONTIGUOUS">Contiguous US (large — requires confirm)</option>
        <option value="WEST">West</option>
      </select></label>
      <label>Chunk km <input id="chunkSizeKm" type="number" value="120" min="5" max="300" style="width:70px"/></label>
      <label>Max concurrent chunks <input id="maxConcurrentChunks" type="number" value="1" min="1" max="10" style="width:50px"/></label>
      <label><input id="includeOsmSpots" type="checkbox" checked/> OSM spots</label>
      <label><input id="includeOsmRoutes" type="checkbox" checked/> OSM routes</label>
      <label><input id="includeOffroad" type="checkbox" checked/> Offroad</label>
      <label><input id="includePublicOnly" type="checkbox" checked/> Public-ready only</label>
    </div>
    <div class="row">
      <label><input id="writeMode" type="checkbox"/> Write mode</label>
      <label>Target <select id="writeTarget"><option value="none" selected>none</option><option value="emulator">emulator</option><option value="production">production</option></select></label>
      <input id="confirmProductionWrite" placeholder="Production confirmation phrase" style="min-width:320px"/>
      <label>Max total writes <input id="maxTotalWrites" type="number" value="500000" style="width:100px"/></label>
    </div>
    <div id="planEstimate" class="muted">Plan estimate: —</div>
    <div class="row">
      <button id="btnPlan">Plan Run</button>
      <button id="btnStart" class="secondary" disabled>Start</button>
      <button id="btnPause" class="secondary" disabled>Pause</button>
      <button id="btnResume" class="secondary" disabled>Resume</button>
      <button id="btnCancel" class="danger" disabled>Cancel</button>
      <button id="btnRetryFailed" class="secondary" disabled>Retry Failed</button>
      <button id="btnProcessNext" class="secondary" disabled>Process Next 1 Chunk</button>
      <button id="btnAutoRun" class="secondary" disabled>Auto-run while open</button>
      <button id="btnDiagnostics" class="secondary" disabled>Export Diagnostics JSON</button>
    </div>
    <p class="help">Dry run workflow: <strong>Plan Run</strong> creates in-memory progress docs (no unexplored writes) → <strong>Start</strong> → <strong>Process Next Chunk</strong> fetches/classifies OSM (1–3 min/chunk). Diagnostics populate after you process chunks or click Export.</p>
    <p class="muted" id="runMeta">No active run.</p>
  </section>

  <section class="panel">
    <div class="stat-grid" id="progressStats"></div>
  </section>

  <section class="panel">
    <h2 style="font-size:15px;margin:0 0 8px">State progress</h2>
    <table><thead><tr><th>State</th><th>Status</th><th>%</th><th>Chunks</th><th>Accepted</th><th>Written</th><th>Failed</th></tr></thead><tbody id="stateTable"></tbody></table>
  </section>

  <section class="panel">
    <h2 style="font-size:15px;margin:0 0 8px">Activity feed</h2>
    <div id="activityFeed"></div>
  </section>

  <section class="panel">
    <h2 style="font-size:15px;margin:0 0 8px">Diagnostics JSON</h2>
    <textarea id="diagJson" readonly>{}</textarea>
  </section>
</div>
<script>
const API = ${JSON.stringify(apiBase)};
let currentRunId = null;
let autoTimer = null;
let estimateTimer = null;

function setStatus(msg, kind) {
  const el = document.getElementById('statusBar');
  el.textContent = msg;
  el.className = kind ? kind : '';
}

async function api(path, opts) {
  const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let json;
  try { json = await res.json(); } catch { throw new Error('Invalid JSON response (HTTP '+res.status+')'); }
  if (!json.ok) throw new Error(json.error?.message || json.error?.code || ('request_failed HTTP '+res.status));
  return json.data;
}

function presetStates() {
  const p = document.getElementById('statePreset').value;
  if (p === 'VT') return { states: ['VT'] };
  return { regionPreset: p };
}

function planBody(extra) {
  const writeMode = document.getElementById('writeMode').checked;
  return {
    ...presetStates(),
    chunkSizeKm: Number(document.getElementById('chunkSizeKm').value),
    maxConcurrentChunks: Number(document.getElementById('maxConcurrentChunks').value),
    includeOsmSpots: document.getElementById('includeOsmSpots').checked,
    includeOsmRoutes: document.getElementById('includeOsmRoutes').checked,
    includeOffroad: document.getElementById('includeOffroad').checked,
    includePublicOnly: document.getElementById('includePublicOnly').checked,
    writeMode,
    writeTarget: document.getElementById('writeTarget').value,
    confirmProductionWrite: document.getElementById('confirmProductionWrite').value || undefined,
    maxTotalWrites: Number(document.getElementById('maxTotalWrites').value),
    dryRunOnly: !writeMode,
    tileBuildMode: 'per_chunk',
    ...(extra || {}),
  };
}

async function refreshPlanEstimate() {
  try {
    const data = await api('/runs/estimate', { method:'POST', body: JSON.stringify(planBody()) });
    const e = data.estimate;
    const warn = e.requiresLargePlanConfirmation ? ' — large plan, will ask to confirm' : '';
    document.getElementById('planEstimate').textContent =
      'Plan estimate: '+e.stateCount+' states, ~'+e.estimatedTotalChunks+' chunks @ '+e.chunkSizeKm+' km'+warn;
  } catch (err) {
    document.getElementById('planEstimate').textContent = 'Plan estimate unavailable: '+err.message;
  }
}

function updateWriteBadge(run) {
  const el = document.getElementById('writeBadge');
  const warn = document.getElementById('warnProd');
  if (!run || !run.writeMode) { el.className='badge dry'; el.textContent='DRY RUN'; warn.style.display='none'; return; }
  if (run.writeTarget === 'production') { el.className='badge prod'; el.textContent='PRODUCTION WRITE ARMED'; warn.style.display='block'; return; }
  if (run.writeTarget === 'emulator') { el.className='badge emu'; el.textContent='EMULATOR WRITE'; warn.style.display='none'; return; }
  el.className='badge dry'; el.textContent='DRY RUN (progress only)'; warn.style.display='none';
}

function renderProgress(run) {
  const p = run.progress || {};
  const c = run.counts || {};
  document.getElementById('progressStats').innerHTML = [
    ['Status', run.status], ['Complete', (p.percentComplete||0)+'%'], ['Chunks', (p.completedChunks||0)+'/'+(p.totalChunks||0)],
    ['States', (p.completedStates||0)+'/'+(p.totalStates||0)], ['ETA sec', p.etaSeconds ?? '—'],
    ['Accepted spots', c.acceptedSpots||0], ['Accepted routes', c.acceptedRoutes||0], ['Written spots', c.writtenSpots||0],
    ['Written routes', c.writtenRoutes||0], ['Rejected', c.rejectedObjects||0], ['Write errors', c.writeErrors||0],
    ['Current', [run.currentActivity?.stateCode, run.currentActivity?.chunkId, run.currentActivity?.step].filter(Boolean).join(' · ') || '—']
  ].map(([label,value])=>'<div class="stat-box"><div class="stat-label">'+label+'</div><div class="stat-value">'+value+'</div></div>').join('');
  document.getElementById('runMeta').textContent = 'Run '+run.runId+' · '+run.status+' · writeMode='+(run.writeMode?'on':'off')+' · target='+run.writeTarget;
  updateWriteBadge(run);
  const hasRun = !!currentRunId;
  document.getElementById('btnStart').disabled = !hasRun || run.status==='running';
  document.getElementById('btnPause').disabled = !hasRun || run.status!=='running';
  document.getElementById('btnResume').disabled = !hasRun || run.status!=='paused';
  document.getElementById('btnCancel').disabled = !hasRun;
  document.getElementById('btnRetryFailed').disabled = !hasRun;
  document.getElementById('btnProcessNext').disabled = !hasRun || run.status!=='running';
  document.getElementById('btnAutoRun').disabled = !hasRun;
  document.getElementById('btnDiagnostics').disabled = !hasRun;
}

async function refreshRun() {
  if (!currentRunId) return;
  const data = await api('/runs/'+currentRunId);
  renderProgress(data.run);
  const states = await api('/runs/'+currentRunId+'/states');
  document.getElementById('stateTable').innerHTML = (states.states||[]).map(s=>'<tr><td>'+s.stateCode+'</td><td>'+s.status+'</td><td>'+(s.progress?.percentComplete||0)+'%</td><td>'+(s.progress?.completedChunks||0)+'/'+(s.progress?.totalChunks||0)+'</td><td>'+(s.counts?.acceptedSpots||0)+' / '+(s.counts?.acceptedRoutes||0)+'</td><td>'+(s.counts?.writtenSpots||0)+' / '+(s.counts?.writtenRoutes||0)+'</td><td>'+(s.progress?.failedChunks||0)+'</td></tr>').join('') || '<tr><td colspan="7" class="muted">No states</td></tr>';
  const events = await api('/runs/'+currentRunId+'/events?limit=100');
  document.getElementById('activityFeed').innerHTML = (events.events||[]).map(e=>'<div>['+e.createdAt+'] <strong>'+e.type+'</strong> '+e.message+'</div>').join('') || '<div class="muted">No events yet.</div>';
}

async function withAction(label, fn) {
  try {
    setStatus(label+'…', 'loading');
    await fn();
    setStatus('Done: '+label, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Error: '+err.message, 'error');
  }
}

document.getElementById('btnPlan').onclick = async () => {
  await withAction('Planning run', async () => {
    let body = planBody();
    const est = await api('/runs/estimate', { method:'POST', body: JSON.stringify(body) });
    if (est.estimate.requiresLargePlanConfirmation) {
      const ok = confirm('This plan creates ~'+est.estimate.estimatedTotalChunks+' chunks across '+est.estimate.stateCount+' states. Continue?');
      if (!ok) { setStatus('Plan cancelled', 'warn'); return; }
      body = planBody({ confirmLargePlan: true });
    }
    setStatus('Planning ~'+est.estimate.estimatedTotalChunks+' chunks…', 'loading');
    const data = await api('/runs/plan', { method:'POST', body: JSON.stringify(body) });
    currentRunId = data.run.runId;
    await refreshRun();
    setStatus('Planned run '+currentRunId+' ('+data.run.progress.totalChunks+' chunks). Click Start, then Process Next Chunk.', 'ok');
  });
};

document.getElementById('btnStart').onclick = async () => { await withAction('Starting run', async () => { await api('/runs/'+currentRunId+'/start', { method:'POST', body:'{}' }); await refreshRun(); }); };
document.getElementById('btnPause').onclick = async () => { await withAction('Pausing run', async () => { await api('/runs/'+currentRunId+'/pause', { method:'POST', body:'{}' }); await refreshRun(); }); };
document.getElementById('btnResume').onclick = async () => { await withAction('Resuming run', async () => { await api('/runs/'+currentRunId+'/resume', { method:'POST', body:'{}' }); await refreshRun(); }); };
document.getElementById('btnCancel').onclick = async () => { await withAction('Cancelling run', async () => { await api('/runs/'+currentRunId+'/cancel', { method:'POST', body:'{}' }); await refreshRun(); if (autoTimer) clearInterval(autoTimer); }); };
document.getElementById('btnRetryFailed').onclick = async () => { await withAction('Retrying failed chunks', async () => { await api('/runs/'+currentRunId+'/retry-failed', { method:'POST', body:'{}' }); await refreshRun(); }); };
document.getElementById('btnProcessNext').onclick = async () => {
  await withAction('Processing next chunk (may take 1–3 min for Overpass)', async () => {
    const out = await api('/worker/process-next', { method:'POST', body: JSON.stringify({ runId: currentRunId, limit: 1 }) });
    await refreshRun();
    if (out.processed === 0) setStatus('No pending chunks (run may be complete or not started)', 'warn');
  });
};
document.getElementById('btnDiagnostics').onclick = async () => {
  await withAction('Loading diagnostics', async () => {
    const data = await api('/runs/'+currentRunId+'/diagnostics');
    document.getElementById('diagJson').value = JSON.stringify(data.diagnostics, null, 2);
  });
};

document.getElementById('btnAutoRun').onclick = () => {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; document.getElementById('btnAutoRun').textContent='Auto-run while open'; setStatus('Auto-run stopped', 'warn'); return; }
  document.getElementById('btnAutoRun').textContent='Stop auto-run';
  setStatus('Auto-run started — processing chunks while this tab is open', 'ok');
  autoTimer = setInterval(async () => {
    try {
      if (!currentRunId) return;
      const out = await api('/worker/process-next', { method:'POST', body: JSON.stringify({ runId: currentRunId, limit: 1 }) });
      await refreshRun();
      if (out.processed === 0) { clearInterval(autoTimer); autoTimer=null; document.getElementById('btnAutoRun').textContent='Auto-run while open'; setStatus('Auto-run finished — no more pending chunks', 'ok'); }
    } catch (e) { console.error(e); setStatus('Auto-run error: '+e.message, 'error'); }
  }, 5000);
};

['statePreset','chunkSizeKm'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => { refreshPlanEstimate().catch(()=>{}); });
  document.getElementById(id).addEventListener('input', () => {
    clearTimeout(estimateTimer);
    estimateTimer = setTimeout(() => refreshPlanEstimate().catch(()=>{}), 300);
  });
});

async function initPage() {
  try {
    const health = await api('/health');
    setStatus('Ready · localRunner='+(health.localRunnerReady?'yes':'no')+' · dry-run progress in memory='+(health.dryRunProgressUsesMemory?'yes':'no'), 'ok');
    const runs = await api('/runs');
    if (runs.runs && runs.runs.length > 0) {
      currentRunId = runs.runs[0].runId;
      await refreshRun();
      setStatus('Loaded latest run '+currentRunId+'. Click Start if status is created, then Process Next Chunk.', 'ok');
    }
    await refreshPlanEstimate();
  } catch (err) {
    setStatus('Init failed: '+err.message+' — is the backend running?', 'error');
  }
}

initPage();
setInterval(() => { refreshRun().catch(()=>{}); }, 5000);
</script>
</body></html>`;
}
