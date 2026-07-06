/**
 * Undiscovered Spots Dashboard V1 — /admin/undiscovered/dashboard-v1
 *
 * All-in-one review surface for undiscovered-spot candidates. v1 focuses on
 * Vermont: seed candidates (sample or from an OSM PBF v2 scan), filter by
 * status/category, and move each through candidate → reviewed → approved →
 * written. Read-only against the production collections; the review queue is
 * served by /admin/undiscovered/api/dashboard-v1.
 */
export function renderUndiscoveredDashboardV1Page(): string {
  const apiBase = "/admin/undiscovered/api/dashboard-v1";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Undiscovered Spots — Dashboard V1</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    a{color:#93c5fd;text-decoration:none}
    .shell{max-width:1280px;margin:0 auto;padding:20px 16px 48px}
    h1{font-size:24px;margin:0 0 2px}
    .sub{color:#94a3b8;font-size:13px;margin:0 0 14px}
    h2{font-size:12px;margin:0 0 8px;color:#cbd5e1;text-transform:uppercase;letter-spacing:.04em}
    .panel{border:1px solid #334155;border-radius:10px;background:#111827;padding:14px 16px;margin:14px 0}
    button{padding:6px 11px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:12px;cursor:pointer;font-weight:600;margin:2px 4px 2px 0}
    button.secondary{background:#334155}
    button.ok{background:#166534}
    button.warn{background:#854d0e}
    button.bad{background:#b91c1c}
    button:disabled{opacity:.45;cursor:not-allowed}
    select{padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:12px}
    label{font-size:12px;color:#cbd5e1;margin-right:6px}
    .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    .stat-value{font-size:20px;font-weight:700;margin-top:4px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border-top:1px solid #334155;padding:6px 8px;text-align:left;vertical-align:top}
    th{background:#0b1220;color:#94a3b8;font-weight:600;position:sticky;top:0}
    .table-wrap{max-height:560px;overflow:auto;border:1px solid #1f2937;border-radius:8px}
    tr.fail td{opacity:.5}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #334155;font-size:10px;color:#cbd5e1;background:#0b1220}
    .pill.candidate{border-color:#475569;color:#cbd5e1}
    .pill.reviewed{border-color:#0369a1;color:#7dd3fc}
    .pill.approved{border-color:#166534;color:#86efac}
    .pill.rejected{border-color:#b91c1c;color:#fca5a5}
    .pill.written{border-color:#7c3aed;color:#c4b5fd}
    .reasons{color:#fbbf24;font-size:11px}
    #statusBar{padding:10px 12px;border-radius:8px;border:1px solid #334155;background:#0b1220;font-size:13px;margin:10px 0}
    #statusBar.ok{border-color:#166534;background:#052e16;color:#86efac}
    #statusBar.err{border-color:#b91c1c;background:#450a0a;color:#fecaca}
    code{background:#020617;padding:1px 5px;border-radius:4px;color:#93c5fd}
  </style>
</head>
<body>
  <div class="shell">
    <h1>🧭 Undiscovered Spots — Dashboard V1</h1>
    <p class="sub">First test region: <b>Vermont (VT)</b>. Review queue over OSM PBF v2 + future channels. Read-only against production collections. API: <code>${apiBase}</code></p>

    <div id="statusBar">Ready.</div>

    <div class="panel">
      <h2>Seed</h2>
      <div class="row">
        <button id="seedSample">Seed Vermont sample</button>
        <span class="sub">Loads representative VT candidates so the workflow is usable without a .osm.pbf. Real scans POST preview docs to <code>/seed-from-pbf</code>.</span>
      </div>
      <div class="row" style="border-top:1px solid #1f2937;padding-top:10px;margin-top:6px">
        <label>Channel</label>
        <select id="seedChannel"></select>
        <input id="seedQuery" type="text" placeholder="query (e.g. waterfall, or a blog URL)" style="width:320px;padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:12px"/>
        <button id="seedChannelBtn">Seed from channel</button>
        <span class="sub" id="channelHint"></span>
      </div>
    </div>

    <div class="panel">
      <h2>Status</h2>
      <div class="stat-grid" id="statGrid"></div>
    </div>

    <div class="panel">
      <h2>Filters</h2>
      <div class="row">
        <label>Status</label>
        <select id="fStatus"><option value="">all</option><option>candidate</option><option>reviewed</option><option>approved</option><option>rejected</option><option>written</option></select>
        <label>Category</label>
        <select id="fCategory"><option value="">all</option></select>
        <label>Channel</label>
        <select id="fChannel"><option value="">all</option></select>
        <button class="secondary" id="refresh">Refresh</button>
      </div>
    </div>

    <div class="panel">
      <h2>Candidates</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Category</th><th>Channel</th><th>Status</th><th>Quality</th><th>Actions</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
  </div>

<script>
const API = ${JSON.stringify(apiBase)};
const $ = (id) => document.getElementById(id);
function setStatus(msg, kind){ const b=$('statusBar'); b.textContent=msg; b.className = kind||''; }

async function api(path, opts){
  const res = await fetch(API + path, Object.assign({ headers: { 'Content-Type':'application/json' } }, opts));
  const json = await res.json().catch(()=>({}));
  if(!res.ok || json.ok === false){ throw new Error((json.error && json.error.message) || ('HTTP '+res.status)); }
  return json.data;
}

const NEXT = {
  candidate: [['reviewed','secondary'],['approved','ok'],['rejected','bad']],
  reviewed: [['approved','ok'],['rejected','bad'],['candidate','secondary']],
  approved: [['written','ok'],['reviewed','secondary'],['rejected','bad']],
  rejected: [['candidate','secondary']],
  written: [['approved','secondary']],
};

function renderStats(counts){
  const order=['candidate','reviewed','approved','rejected','written'];
  $('statGrid').innerHTML = order.map(k =>
    '<div class="stat-box"><div class="stat-label">'+k+'</div><div class="stat-value">'+(counts[k]||0)+'</div></div>'
  ).join('');
}

async function loadCategories(){
  const data = await api('/categories');
  const sel = $('fCategory');
  const cur = sel.value;
  sel.innerHTML = '<option value="">all</option>' + data.categories.map(c=>'<option>'+c+'</option>').join('');
  sel.value = cur;
}

async function transition(id, to){
  try{
    setStatus('Updating '+id+' → '+to+'…');
    await api('/candidates/'+encodeURIComponent(id)+'/status', { method:'POST', body: JSON.stringify({ status: to, reviewedBy: 'dashboard' }) });
    setStatus(id+' → '+to, 'ok');
    await load();
  }catch(e){ setStatus('Failed: '+e.message, 'err'); }
}

function renderRows(items){
  $('rows').innerHTML = items.map(c => {
    const actions = (NEXT[c.reviewStatus]||[]).map(([to,cls]) =>
      '<button class="'+cls+'" data-id="'+encodeURIComponent(c.id)+'" data-to="'+to+'">'+to+'</button>'
    ).join('');
    const q = c.qualityGate.passed ? '<span class="pill approved">pass</span>'
      : '<span class="reasons">'+(c.qualityGate.reasons.join(', ')||'hidden')+'</span>';
    return '<tr class="'+(c.qualityGate.passed?'':'fail')+'">'
      + '<td>'+c.displayName+'</td>'
      + '<td>'+c.kind+'</td>'
      + '<td>'+c.primaryCategory+'</td>'
      + '<td><span class="pill">'+c.sourceChannel+'</span></td>'
      + '<td><span class="pill '+c.reviewStatus+'">'+c.reviewStatus+'</span></td>'
      + '<td>'+q+'</td>'
      + '<td>'+actions+'</td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="7" class="sub">No candidates. Click “Seed Vermont sample” or seed from a channel.</td></tr>';
}

let CHANNELS = [];
async function loadChannels(){
  const data = await api('/channels');
  CHANNELS = data.channels;
  $('seedChannel').innerHTML = CHANNELS.map(c=>'<option value="'+c.channel+'">'+c.label+(c.liveFetchSupported?'':' (paste/fixture)')+'</option>').join('');
  $('fChannel').innerHTML = '<option value="">all</option>' + CHANNELS.map(c=>'<option value="'+c.channel+'">'+c.label+'</option>').join('');
  updateChannelHint();
}
function updateChannelHint(){
  const ch = CHANNELS.find(c=>c.channel===$('seedChannel').value);
  $('channelHint').textContent = ch ? ch.strategy : '';
}

async function load(){
  try{
    const params = new URLSearchParams({ region:'VT' });
    if($('fStatus').value) params.set('status', $('fStatus').value);
    if($('fCategory').value) params.set('category', $('fCategory').value);
    if($('fChannel').value) params.set('channel', $('fChannel').value);
    const data = await api('/candidates?' + params.toString());
    renderStats(data.counts);
    renderRows(data.items);
    setStatus(data.total + ' candidate(s) shown.', 'ok');
  }catch(e){ setStatus('Load failed: '+e.message, 'err'); }
}

$('seedSample').onclick = async () => {
  try{ setStatus('Seeding…'); const r = await api('/seed-sample', { method:'POST', body:'{}' }); setStatus('Seeded '+r.total+' (VT).', 'ok'); await loadCategories(); await load(); }
  catch(e){ setStatus('Seed failed: '+e.message, 'err'); }
};
$('seedChannel').onchange = updateChannelHint;
$('seedChannelBtn').onclick = async () => {
  try{
    const channel = $('seedChannel').value;
    const query = $('seedQuery').value.trim();
    setStatus('Seeding from '+channel+'…');
    const r = await api('/seed-from-channel', { method:'POST', body: JSON.stringify({ channel, region:'VT', query: query||undefined }) });
    const note = r.mapped===0 && !r.liveFetchSupported ? ' (this channel needs pasted items / a live source)' : '';
    setStatus('Seeded '+r.mapped+' from '+channel+' — total '+r.total+note, 'ok');
    await load();
  }catch(e){ setStatus('Channel seed failed: '+e.message, 'err'); }
};
$('refresh').onclick = load;
$('fStatus').onchange = load;
$('fCategory').onchange = load;
$('fChannel').onchange = load;

// Event delegation: survives innerHTML replacement, avoids fragile inline onclick.
$('rows').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-to]');
  if(!btn) return;
  transition(decodeURIComponent(btn.getAttribute('data-id')), btn.getAttribute('data-to'));
});

Promise.all([loadCategories(), loadChannels()]).then(load);
</script>
</body>
</html>`;
}
