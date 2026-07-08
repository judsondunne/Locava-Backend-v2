/**
 * Undiscovered Spots — Live Scraping Dashboard — /admin/undiscovered/scraping
 *
 * Real-time scale view across all discovery channels. The PBF Copier V2 engine
 * (OSM) is the primary high-volume source; Reddit/web/trail/Instagram feed the
 * same review queue. Shows live per-channel progress, total locations collected,
 * processing status, and throughput metrics. Dry-run only — no production writes.
 */
export function renderUndiscoveredScrapingDashboardPage(): string {
  const api = "/admin/undiscovered/api/dashboard-v1";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Undiscovered Spots — Dashboard</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    #map{height:420px;border-radius:10px;overflow:hidden;border:1px solid #1f2937}
    .emoji-pin{font-size:22px;line-height:22px;text-align:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
    .leaflet-popup-content{font-family:Inter,Arial,sans-serif}
    .legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:12px;color:#cbd5e1}
    .legend span{white-space:nowrap}
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    .shell{max-width:1200px;margin:0 auto;padding:20px 16px 48px}
    h1{font-size:24px;margin:0 0 2px}
    .sub{color:#94a3b8;font-size:13px;margin:0 0 16px}
    h2{font-size:12px;margin:0 0 10px;color:#cbd5e1;text-transform:uppercase;letter-spacing:.04em}
    .panel{border:1px solid #334155;border-radius:12px;background:#111827;padding:16px;margin:14px 0}
    button{padding:8px 14px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:13px;cursor:pointer;font-weight:600;margin:2px 6px 2px 0}
    button.secondary{background:#334155}
    button:disabled{opacity:.5;cursor:not-allowed}
    input,select{padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:12px}
    .hero{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
    .metric{background:#020617;border:1px solid #1f2937;border-radius:10px;padding:14px}
    .metric .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    .metric .value{font-size:30px;font-weight:700;margin-top:6px;font-variant-numeric:tabular-nums}
    .metric.big .value{color:#86efac}
    .bar{height:10px;background:#0b1220;border-radius:999px;overflow:hidden;border:1px solid #1f2937;margin-top:8px}
    .bar > div{height:100%;background:#2563eb;width:0%;transition:width .5s ease}
    .bar.done > div{background:#166534}
    .grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}
    .chan{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:1px solid #1f2937;font-size:13px}
    .chan:first-child{border-top:none}
    .dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px}
    .cnum{font-weight:700;font-variant-numeric:tabular-nums}
    .pill{display:inline-block;padding:2px 9px;border-radius:999px;border:1px solid #334155;font-size:10px;color:#cbd5e1;background:#0b1220}
    .pill.run{border-color:#2563eb;color:#93c5fd}
    .pill.done{border-color:#166534;color:#86efac}
    .muted{color:#64748b;font-size:12px}
    .kv{display:flex;gap:18px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:#94a3b8}
    .kv b{color:#e2e8f0;font-variant-numeric:tabular-nums}
    code{background:#020617;padding:1px 5px;border-radius:4px;color:#93c5fd}
  </style>
</head>
<body>
  <div class="shell">
    <h1>🧭 Undiscovered Spots — Dashboard</h1>
    <p class="sub">Multi-channel discovery at scale. Primary engine: <b>PBF Copier V2</b> (OpenStreetMap) on the real Vermont extract. Dry-run — zero production writes. Auto-refreshes every 2s.</p>

    <div class="hero">
      <div class="metric big"><div class="label">Total quality locations</div><div class="value" id="mTotal">0</div></div>
      <div class="metric"><div class="label">Objects scanned</div><div class="value" id="mObjects">0</div></div>
      <div class="metric"><div class="label">Throughput (obj/s)</div><div class="value" id="mRate">0</div></div>
      <div class="metric"><div class="label">Channels active</div><div class="value" id="mChannels">0</div></div>
    </div>

    <div class="grid2">
      <div class="panel">
        <h2>PBF Copier V2 — OSM engine (Vermont)</h2>
        <div class="row">
          <button id="startPbf">Start Vermont scan</button>
          <span class="pill" id="pbfStatus">idle</span>
        </div>
        <div class="bar" id="pbfBarWrap"><div id="pbfBar"></div></div>
        <div class="kv">
          <span>chunk <b id="pbfChunk">0/0</b></span>
          <span>objects <b id="pbfObj">0</b></span>
          <span>accepted spots <b id="pbfSpots">0</b></span>
          <span>accepted routes <b id="pbfRoutes">0</b></span>
          <span>ETA <b id="pbfEta">—</b></span>
        </div>
        <p class="muted" id="pbfNote" style="margin-top:10px">This scans millions of OSM objects and accepts quality spots/routes. Projected full-Vermont yield updates live.</p>
      </div>

      <div class="panel">
        <h2>Discovery channels</h2>
        <div id="chanList"></div>
        <div class="row" style="margin-top:12px;border-top:1px solid #1f2937;padding-top:10px">
          <select id="seedChannel"></select>
          <input id="seedQuery" type="text" placeholder="query / URL" style="width:150px"/>
          <button class="secondary" id="seedBtn">Scrape</button>
        </div>
        <p class="muted" id="chanHint" style="margin-top:8px"></p>
      </div>
    </div>

    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h2 style="margin:0">Map — Vermont spots</h2>
        <span>
          <label style="font-size:12px;color:#94a3b8">show up to</label>
          <select id="mapLimit"><option>200</option><option selected>500</option><option>1000</option><option>2000</option></select>
          <button class="secondary" id="mapRefresh">Refresh map</button>
        </span>
      </div>
      <div id="map"></div>
      <div class="legend" id="mapLegend"></div>
      <p class="muted" id="mapNote" style="margin-top:8px"></p>
    </div>

    <div class="panel">
      <h2>Review &amp; add locations</h2>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <button class="secondary" id="importPbf">Import PBF results</button>
        <button class="secondary" id="seedSample">Seed VT sample</button>
        <select id="rChannel"><option value="">all channels</option></select>
        <select id="rCategory"><option value="">all categories</option></select>
        <select id="rStatus"><option value="">all statuses</option><option>candidate</option><option>reviewed</option><option>approved</option><option>rejected</option><option>written</option></select>
        <span class="muted" id="rCount"></span>
      </div>
      <div style="max-height:460px;overflow:auto;border:1px solid #1f2937;border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="position:sticky;top:0;background:#0b1220;color:#94a3b8">
            <th style="padding:7px 8px;text-align:left;font-weight:600">Location</th>
            <th style="padding:7px 8px;text-align:left;font-weight:600">Category</th>
            <th style="padding:7px 8px;text-align:left;font-weight:600">Channel</th>
            <th style="padding:7px 8px;text-align:left;font-weight:600">Source</th>
            <th style="padding:7px 8px;text-align:left;font-weight:600">Quality</th>
            <th style="padding:7px 8px;text-align:left;font-weight:600">Status</th>
            <th style="padding:7px 8px;text-align:left;font-weight:600">Add to app</th>
          </tr></thead>
          <tbody id="reviewRows"></tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:8px">Sift the scraped locations, open each source to verify, then <b>Approve</b> to queue it for the app database. Approved → the guarded production write (Wednesday). “Import PBF results” pulls a sample of the 51k OSM locations in to review.</p>
    </div>

    <p class="sub" style="margin-top:6px">Scale path: Vermont proven here → same engine + tile grid scales to every U.S. state (national copier already exists). Reddit/IG go live with API credentials.</p>
  </div>

<script>
const API = ${JSON.stringify(api)};
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n==null?'—':Number(n).toLocaleString());
const chanColor = {osm_pbf:'#38bdf8',web_blog:'#34d399',instagram:'#f472b6',trail_db:'#fbbf24',reddit:'#fb923c'};
let CHANNELS = [];

async function api(path, opts){
  const res = await fetch(API+path, Object.assign({headers:{'Content-Type':'application/json'}}, opts));
  const j = await res.json().catch(()=>({}));
  if(!res.ok || j.ok===false) throw new Error((j.error&&j.error.message)||('HTTP '+res.status));
  return j.data;
}

function fmtEta(ms){ if(!ms||ms<0) return '—'; const s=Math.round(ms/1000); if(s<90) return s+'s'; return Math.round(s/60)+'m'; }

async function loadChannels(){
  const d = await api('/channels');
  CHANNELS = d.channels;
  $('seedChannel').innerHTML = CHANNELS.map(c=>'<option value="'+c.channel+'">'+c.label+(c.liveFetchSupported?'':' (paste)')+'</option>').join('');
}

async function tick(){
  try{
    const m = await api('/scrape-metrics');
    const pbf = m.pbf;
    // hero
    $('mTotal').textContent = fmt(m.totals.grandTotal);
    $('mObjects').textContent = fmt(pbf ? pbf.processedObjects : 0);
    $('mRate').textContent = fmt(pbf && pbf.status==='running' ? pbf.avgObjectsPerSec : 0);
    $('mChannels').textContent = Object.keys(m.channels).length + (pbf ? 1 : 0);
    // pbf card
    if(pbf){
      $('pbfStatus').textContent = pbf.status + ' · ' + (pbf.phase||'');
      $('pbfStatus').className = 'pill ' + (pbf.status==='complete'?'done':'run');
      $('pbfBar').style.width = (pbf.percentComplete||0) + '%';
      $('pbfBarWrap').className = 'bar' + (pbf.status==='complete'?' done':'');
      $('pbfChunk').textContent = pbf.currentChunkIndex + '/' + pbf.totalChunks;
      $('pbfObj').textContent = fmt(pbf.processedObjects);
      $('pbfSpots').textContent = fmt(pbf.acceptedSpots);
      $('pbfRoutes').textContent = fmt(pbf.acceptedRoutes);
      $('pbfEta').textContent = pbf.status==='running' ? fmtEta(pbf.etaMs) : (pbf.status==='complete'?'done':'—');
      if(pbf.percentComplete>0 && pbf.status==='running'){
        const proj = Math.round(pbf.acceptedTotal / (pbf.percentComplete/100));
        $('pbfNote').textContent = 'Projected full-Vermont yield ≈ ' + fmt(proj) + ' quality locations at current accept rate.';
      } else if(pbf.status==='complete'){
        $('pbfNote').textContent = 'Scan complete — ' + fmt(pbf.acceptedTotal) + ' quality Vermont locations, dry-run (no production writes).';
      }
    }
    // channels
    const rows = CHANNELS.map(c=>{
      const n = m.channels[c.channel] || 0;
      const col = chanColor[c.channel] || '#64748b';
      const live = c.needsCredentials ? '<span class="pill">needs creds</span>' : (c.liveFetchSupported?'<span class="pill run">live</span>':'<span class="pill">paste</span>');
      return '<div class="chan"><span><span class="dot" style="background:'+col+'"></span>'+c.label+' '+live+'</span><span class="cnum">'+fmt(n)+'</span></div>';
    }).join('');
    // include osm_pbf as a channel row (accepted total)
    const pbfRow = '<div class="chan"><span><span class="dot" style="background:'+chanColor.osm_pbf+'"></span>OSM / PBF <span class="pill run">engine</span></span><span class="cnum">'+fmt(pbf?pbf.acceptedTotal:0)+'</span></div>';
    $('chanList').innerHTML = pbfRow + rows;
  }catch(e){ /* transient */ }
}

$('startPbf').onclick = async () => {
  try{ $('startPbf').disabled=true; $('pbfStatus').textContent='starting…'; await api('/pbf/start-vermont',{method:'POST',body:'{}'}); setTimeout(()=>{$('startPbf').disabled=false;}, 4000); await tick(); }
  catch(e){ $('pbfStatus').textContent='error: '+e.message; $('startPbf').disabled=false; }
};
const PLACEHOLDER = {
  web_blog: 'blank = curated VT pages, or paste a page URL',
  reddit: 'search terms (needs API creds)',
  trail_db: 'needs pasted items / trail API key',
  instagram: 'needs pasted captions / Graph API',
};
function syncChannelUI(){
  const ch = $('seedChannel').value;
  const c = CHANNELS.find(x=>x.channel===ch);
  $('chanHint').textContent = c ? c.strategy : '';
  $('seedQuery').placeholder = PLACEHOLDER[ch] || 'query / URL';
}
$('seedChannel').onchange = syncChannelUI;
$('seedBtn').onclick = async () => {
  try{
    const channel=$('seedChannel').value, query=$('seedQuery').value.trim();
    $('seedBtn').disabled=true; $('chanHint').textContent='scraping '+channel+'…';
    const r = await api('/seed-from-channel',{method:'POST',body:JSON.stringify({channel,region:'VT',query:query||undefined})});
    $('chanHint').textContent = r.mapped>0 ? ('✓ +'+r.mapped+' from '+channel+' — total '+r.total) : (r.note || 'No results.');
    await tick();
  }catch(e){ $('chanHint').textContent='failed: '+e.message; }
  finally{ $('seedBtn').disabled=false; }
};

// ---- Review table: sift, view source, approve into the app database ----
const STATUS_COLOR = {candidate:['#475569','#cbd5e1'],reviewed:['#0369a1','#7dd3fc'],approved:['#166534','#86efac'],rejected:['#b91c1c','#fca5a5'],written:['#7c3aed','#c4b5fd']};
const NEXT = {candidate:[['approved','ok','Approve'],['rejected','bad','Reject']],reviewed:[['approved','ok','Approve'],['rejected','bad','Reject']],approved:[['written','ok','Add ✓'],['rejected','bad','Reject']],rejected:[['candidate','secondary','Reopen']],written:[['approved','secondary','Undo']]};

async function loadReviewFilters(){
  const d = await api('/categories');
  $('rCategory').innerHTML = '<option value="">all categories</option>' + d.categories.map(c=>'<option>'+c+'</option>').join('');
  $('rChannel').innerHTML = '<option value="">all channels</option>' + CHANNELS.map(c=>'<option value="'+c.channel+'">'+c.label+'</option>').join('') + '<option value="osm_pbf">OSM / PBF</option>';
}
async function transition(id, to){
  try{ await api('/candidates/'+encodeURIComponent(id)+'/status',{method:'POST',body:JSON.stringify({status:to,reviewedBy:'dashboard'})}); await loadReview(); await loadMap(); await tick(); }
  catch(e){ $('rCount').textContent='action failed: '+e.message; }
}
function reviewRow(c){
  const [bc,tc] = STATUS_COLOR[c.reviewStatus]||STATUS_COLOR.candidate;
  const col = chanColor[c.sourceChannel]||'#64748b';
  const src = c.provenance && c.provenance.sourceUrl;
  const view = src ? '<a href="'+src+'" target="_blank" rel="noopener" style="color:#93c5fd">view ↗</a>' : '<span class="muted">—</span>';
  const acts = (NEXT[c.reviewStatus]||[]).map(([to,cls,lbl])=>'<button class="'+cls+'" data-id="'+encodeURIComponent(c.id)+'" data-to="'+to+'" style="padding:3px 8px;font-size:11px">'+lbl+'</button>').join('');
  const q = c.qualityGate && c.qualityGate.passed
    ? '<span class="pill" style="border-color:#166534;color:#86efac">pass</span>'
    : '<span style="color:#fbbf24;font-size:11px">'+((c.qualityGate&&c.qualityGate.reasons||[]).join(', ')||'flagged')+'</span>';
  return '<tr style="border-top:1px solid #1f2937">'
    +'<td style="padding:6px 8px">'+c.displayName+'</td>'
    +'<td style="padding:6px 8px">'+c.primaryCategory+'</td>'
    +'<td style="padding:6px 8px"><span class="dot" style="background:'+col+'"></span>'+c.sourceChannel+'</td>'
    +'<td style="padding:6px 8px">'+view+'</td>'
    +'<td style="padding:6px 8px">'+q+'</td>'
    +'<td style="padding:6px 8px"><span class="pill" style="border-color:'+bc+';color:'+tc+'">'+c.reviewStatus+'</span></td>'
    +'<td style="padding:6px 8px">'+acts+'</td>'
    +'</tr>';
}
async function loadReview(){
  try{
    const p = new URLSearchParams({region:'VT'});
    if($('rChannel').value) p.set('channel',$('rChannel').value);
    if($('rCategory').value) p.set('category',$('rCategory').value);
    if($('rStatus').value) p.set('status',$('rStatus').value);
    const d = await api('/candidates?'+p.toString());
    $('reviewRows').innerHTML = d.items.slice(0,400).map(reviewRow).join('') || '<tr><td colspan="7" class="muted" style="padding:10px">No locations. Scrape a channel, Import PBF results, or Seed VT sample.</td></tr>';
    $('rCount').textContent = fmt(d.total)+' locations'+(d.total>400?' (showing 400)':'');
  }catch(e){ $('rCount').textContent='load failed: '+e.message; }
}
$('reviewRows').addEventListener('click',(e)=>{ const b=e.target.closest('button[data-to]'); if(!b) return; transition(decodeURIComponent(b.getAttribute('data-id')), b.getAttribute('data-to')); });
$('rChannel').onchange = loadReview; $('rCategory').onchange = loadReview; $('rStatus').onchange = loadReview;
$('importPbf').onclick = async () => {
  try{ $('importPbf').disabled=true; $('rCount').textContent='importing PBF results…'; const r=await api('/pbf/import-results',{method:'POST',body:'{}'}); $('rCount').textContent='imported '+r.imported+' PBF locations'; await loadReview(); await loadMap(); await tick(); }
  catch(e){ $('rCount').textContent='import failed: '+e.message; }
  finally{ $('importPbf').disabled=false; }
};
$('seedSample').onclick = async () => {
  try{ $('seedSample').disabled=true; $('rCount').textContent='seeding VT sample…'; const r=await api('/seed-sample',{method:'POST',body:'{}'}); $('rCount').textContent='seeded '+r.total+' sample locations'; await loadReview(); await loadMap(); await tick(); }
  catch(e){ $('rCount').textContent='seed failed: '+e.message; }
  finally{ $('seedSample').disabled=false; }
};

// ---- Minimap: plot spots with real coordinates, emoji by category ----
const EMOJI = {
  waterfall:'💧', swimming_hole:'🏊', summit_viewpoint:'⛰️', scenic_overlook:'🌄',
  hiking_trail:'🥾', lake_pond:'🏞️', river_stream:'🌊', gorge_canyon:'🏔️', cave:'🕳️',
  forest_natural:'🌲', beach:'🏖️', campsite:'🏕️', historic_landmark:'🏛️', park:'🌳', other:'📍'
};
const VT = {minLat:42.6,maxLat:45.1,minLng:-73.5,maxLng:-71.4};
let MAP=null, MARKERS=null;
function initMap(){
  if(MAP || typeof L==='undefined') return;
  MAP = L.map('map',{scrollWheelZoom:true}).setView([44.0,-72.7], 8);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(MAP);
  MARKERS = L.layerGroup().addTo(MAP);
}
function pin(cat){ return L.divIcon({html:'<div class="emoji-pin">'+(EMOJI[cat]||EMOJI.other)+'</div>',className:'',iconSize:[24,24],iconAnchor:[12,12]}); }
async function loadMap(){
  initMap(); if(!MAP) return;
  MARKERS.clearLayers();
  const limit = Number($('mapLimit').value)||500;
  const d = await api('/candidates?region=VT');
  const plottable = d.items.filter(c=>c.lat && c.lng && c.lat>=VT.minLat&&c.lat<=VT.maxLat&&c.lng>=VT.minLng&&c.lng<=VT.maxLng).slice(0,limit);
  const bounds=[];
  const usedCats=new Set();
  for(const c of plottable){
    usedCats.add(c.primaryCategory);
    const src = c.provenance && c.provenance.sourceUrl;
    const html = '<b>'+c.displayName+'</b><br>'+(EMOJI[c.primaryCategory]||'📍')+' '+c.primaryCategory+' · '+c.sourceChannel
      +'<br>status: '+c.reviewStatus+(src?('<br><a href="'+src+'" target="_blank" rel="noopener">view source ↗</a>'):'');
    L.marker([c.lat,c.lng],{icon:pin(c.primaryCategory)}).bindPopup(html).addTo(MARKERS);
    bounds.push([c.lat,c.lng]);
  }
  if(bounds.length) MAP.fitBounds(bounds,{padding:[30,30],maxZoom:11});
  const noCoords = d.total - d.items.filter(c=>c.lat&&c.lng).length;
  $('mapNote').textContent = plottable.length+' spots plotted'+(d.total>plottable.length?' of '+d.total+' ('+noCoords+' have no coordinates yet — mostly web/blog text finds; Import PBF results for mapped spots)':'');
  $('mapLegend').innerHTML = Array.from(usedCats).sort().map(cat=>'<span>'+(EMOJI[cat]||'📍')+' '+cat+'</span>').join('') || '<span class="muted">No mapped spots yet — click “Import PBF results”.</span>';
}
$('mapRefresh').onclick = loadMap;
$('mapLimit').onchange = loadMap;

loadChannels().then(()=>{ syncChannelUI(); loadReviewFilters(); loadReview(); loadMap(); tick(); setInterval(tick, 2000); });
</script>
</body>
</html>`;
}
