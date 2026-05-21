/**
 * OSM Locava Classifier admin — /admin/openstreetmap
 */
export function renderOpenStreetMapLabPage(): string {
  const defaults = {
    label: "Hartland, Vermont",
    regionKey: "hartland_vt_mvp",
    centerLat: 43.54063,
    centerLng: -72.39898,
    minLat: 43.45,
    minLng: -72.55,
    maxLat: 43.63,
    maxLng: -72.25,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>OSM Locava Classifier v2</title>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    a{color:#93c5fd;text-decoration:none}
    .shell{max-width:1400px;margin:0 auto;padding:20px 16px 48px}
    h1{font-size:22px;margin:0 0 6px}
    h2{font-size:15px;margin:0 0 8px;color:#cbd5e1}
    .muted{color:#94a3b8;font-size:13px}
    .panel{border:1px solid #334155;border-radius:10px;background:#111827;padding:12px;margin:14px 0}
    .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0}
    label{font-size:12px;color:#cbd5e1;display:flex;flex-direction:column;gap:4px}
    input,select,textarea{padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:13px}
    button{padding:8px 12px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:13px;cursor:pointer;font-weight:600}
    button.secondary{background:#334155}
    button.ghost{background:transparent;border:1px solid #475569;color:#cbd5e1}
    button.small{padding:4px 8px;font-size:11px}
    button.tab{background:#0b1220;border:1px solid #334155;color:#cbd5e1}
    button.tab.active{background:#172554;border-color:#2563eb;color:#fff}
    .status-bar{padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0b1220;font-size:14px;font-weight:600;margin-bottom:12px}
    .status-bar.success{border-color:#166534;background:#052e16;color:#86efac}
    .status-bar.running{border-color:#2563eb;background:#172554;color:#bfdbfe}
    .status-bar.error{border-color:#991b1b;background:#450a0a;color:#fca5a5}
    .map-shell{height:480px;border-radius:16px;border:1px solid #334155;overflow:hidden;background:#020617}
    .table-wrap{max-height:560px;overflow:auto;border:1px solid #1f2937;border-radius:8px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border-top:1px solid #334155;padding:6px 8px;text-align:left;vertical-align:top}
    th{position:sticky;top:0;background:#111827;color:#94a3b8;z-index:2}
    tr:hover{background:#1e293b}
    tr.accepted{background:rgba(34,197,94,.06)}
    tr.rejected{background:rgba(239,68,68,.04)}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#0b1220;border:1px solid #334155;font-size:11px}
    .decision-accepted{color:#86efac}
    .decision-rejected{color:#fca5a5}
    #searchInput{min-width:320px}
    #diagnosticsJson{width:100%;min-height:280px;font-family:ui-monospace,Menlo,monospace;font-size:11px}
    #mapSidebar{font-size:12px;color:#cbd5e1;margin-top:8px;min-height:48px}
    .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase}
    .stat-value{font-size:18px;font-weight:700;margin-top:4px}
  </style>
</head>
<body>
<div class="shell">
  <p><a href="/admin">← Admin</a></p>
  <h1>OSM Locava Classifier v2</h1>
  <p class="muted">Hartland bbox · classify spots/routes/reject · search all results · highlight full trails on map. Read-only.</p>
  <div id="statusBar" class="status-bar">Run classifier to begin.</div>

  <section class="panel">
    <h2>Map</h2>
    <div class="row">
      <button type="button" id="btnFitRegion" class="secondary">Fit bbox</button>
      <button type="button" id="btnClearMap" class="ghost">Clear highlights</button>
      <span id="mapMeta" class="muted"></span>
    </div>
    <div class="map-shell"><div id="osmMap" style="width:100%;height:100%"></div></div>
    <div id="mapSidebar"></div>
  </section>

  <section class="panel">
    <h2>Classifier + Search</h2>
    <div class="row">
      <label>Source<select id="source"><option value="overpass">Live Overpass</option><option value="fixture">Fixture</option></select></label>
      <label>foodMode<select id="foodMode"><option value="local_only" selected>local_only</option><option value="all_named_food">all_named_food</option></select></label>
      <label>trailMode<select id="trailMode"><option value="recreation_only" selected>recreation_only</option><option value="all_paths">all_paths</option></select></label>
      <label>natureMode<select id="natureMode"><option value="named_or_recreational" selected>named_or_recreational</option><option value="broad_natural">broad_natural</option></select></label>
      <button id="btnRun">Run Classifier</button>
    </div>
    <div class="row">
      <label style="flex:1">Search<input id="searchInput" type="text" placeholder="Search name, activity, category, tag, source id, rejection reason…"/></label>
      <label>Decision<select id="filterDecision"><option value="all">All (accepted first)</option><option value="accepted">Accepted only</option><option value="rejected">Rejected only</option></select></label>
      <label>Kind<select id="filterKind"><option value="all">All kinds</option><option value="spot">Spots</option><option value="route">Routes</option></select></label>
      <button type="button" id="btnSearch" class="secondary">Search</button>
    </div>
    <div class="row">
      <button type="button" class="tab preset" data-preset="trail_debug">Trail Debug</button>
      <button type="button" class="tab preset" data-preset="suspicious_accepted">Suspicious Accepted</button>
      <button type="button" class="tab preset" data-preset="possible_misses">Possible Misses</button>
      <label><input type="checkbox" id="onlyTrails"/> Only trails</label>
      <label><input type="checkbox" id="onlyFood"/> Only food</label>
      <label><input type="checkbox" id="onlyNature"/> Only nature</label>
      <label><input type="checkbox" id="onlySuspicious"/> Only suspicious</label>
    </div>
    <div id="summaryGrid" class="summary-grid"></div>
  </section>

  <section class="panel">
    <h2>Results (<span id="resultCount">0</span> / <span id="resultTotal">0</span>)</h2>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Decision</th><th>Kind</th><th>Name</th><th>Category/Activity</th><th>Score</th>
          <th>Reason</th><th>Dist</th><th>Priority</th><th>Source</th><th>Tags</th><th></th>
        </tr></thead>
        <tbody id="resultsBody"></tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <h2>Copy/Paste Diagnostics JSON</h2>
    <div class="row"><button type="button" id="btnCopyJson" class="secondary">Copy JSON</button></div>
    <textarea id="diagnosticsJson" readonly></textarea>
  </section>
</div>

<script>
const DEFAULT_VIEWPORT = ${JSON.stringify(defaults)};
const OSM_STYLE = { version:8, sources:{ osm:{ type:"raster", tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize:256 }}, layers:[{id:"osm",type:"raster",source:"osm"}]};
let map=null, runId=null, markers=[];

function esc(s){ return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
function qs(params){ return new URLSearchParams(Object.entries(params).filter(function(e){ return e[1]!=null && e[1]!=="" && e[1]!==false; }).map(function(e){ return [e[0], String(e[1])]; })).toString(); }

async function api(path){ const r=await fetch(path); const j=await r.json(); if(!j.ok) throw new Error(j.error?.message||"failed"); return j.data; }

function initMap(){
  if(map) map.remove();
  map=new maplibregl.Map({ container:"osmMap", style:OSM_STYLE, center:[DEFAULT_VIEWPORT.centerLng,DEFAULT_VIEWPORT.centerLat], zoom:11 });
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-right");
  map.on("load", function(){
    const b=DEFAULT_VIEWPORT;
    map.addSource("bbox",{ type:"geojson", data:{ type:"Feature", properties:{}, geometry:{ type:"Polygon", coordinates:[[[b.minLng,b.minLat],[b.maxLng,b.minLat],[b.maxLng,b.maxLat],[b.minLng,b.maxLat],[b.minLng,b.minLat]]] }}});
    map.addLayer({ id:"bbox-line", type:"line", source:"bbox", paint:{ "line-color":"#f59e0b", "line-width":2, "line-dasharray":[2,2] }});
    map.fitBounds([[b.minLng,b.minLat],[b.maxLng,b.maxLat]],{padding:32});
  });
}

function clearMapLayers(){
  markers.forEach(function(m){ m.remove(); });
  markers=[];
  ["sel-route","sel-route-faint","sel-seg-"].forEach(function(prefix){
    for(var i=0;i<20;i++){ var id=prefix+i; if(map.getLayer(id)) map.removeLayer(id); if(map.getSource(id)) map.removeSource(id); }
  });
  if(map.getLayer("sel-route")) map.removeLayer("sel-route");
  if(map.getSource("sel-route")) map.removeSource("sel-route");
  if(map.getLayer("sel-route-faint")) map.removeLayer("sel-route-faint");
  if(map.getSource("sel-route-faint")) map.removeSource("sel-route-faint");
  document.getElementById("mapSidebar").textContent="";
}

function drawLine(id, coords, color, width, dash){
  if(!coords || coords.length<2) return;
  var geo={ type:"Feature", properties:{}, geometry:{ type:"LineString", coordinates: coords.map(function(c){ return [c.lng,c.lat]; }) }};
  if(map.getSource(id)) map.removeLayer(id), map.removeSource(id);
  map.addSource(id,{ type:"geojson", data:geo });
  map.addLayer({ id:id, type:"line", source:id, paint:{ "line-color":color, "line-width":width, "line-dasharray": dash||[1,0] }});
}

function fitCoords(coords){
  if(!coords || !coords.length) return;
  var lngs=coords.map(function(c){return c.lng;}), lats=coords.map(function(c){return c.lat;});
  map.fitBounds([[Math.min.apply(null,lngs),Math.min.apply(null,lats)],[Math.max.apply(null,lngs),Math.max.apply(null,lats)]],{padding:48,duration:500});
}

function showOnMap(row){
  clearMapLayers();
  var gp=row.geometryPreview||{};
  var sidebar=document.getElementById("mapSidebar");
  if(row.kind==="route" && (gp.type==="line"||gp.type==="multiline")){
    var allCoords=[];
    if(gp.segments){ gp.segments.forEach(function(seg,i){ drawLine("sel-seg-"+i, seg, "#22c55e", 5); allCoords=allCoords.concat(seg); }); }
    else if(gp.coordinates){ drawLine("sel-route", gp.coordinates, "#22c55e", 5); allCoords=gp.coordinates; }
    fitCoords(allCoords);
    if(allCoords.length){ markers.push(new maplibregl.Marker({color:"#16a34a"}).setLngLat([allCoords[0].lng,allCoords[0].lat]).addTo(map)); markers.push(new maplibregl.Marker({color:"#dc2626"}).setLngLat([allCoords[allCoords.length-1].lng,allCoords[allCoords.length-1].lat]).addTo(map)); }
    sidebar.innerHTML="<strong>"+esc(row.name)+"</strong> · "+esc(row.activity||"")+" · "+(row.distanceMiles!=null?row.distanceMiles+" mi":"—")+" · "+(row.pointCount||"")+" pts · "+esc(row.reason||row.rejectionReason||"");
  } else if(gp.type==="line" && row.decision==="rejected"){
    drawLine("sel-route-faint", gp.coordinates, "#94a3b8", 2, [2,2]);
    fitCoords(gp.coordinates);
    sidebar.textContent="Rejected: "+(row.rejectionReason||"");
  } else if(row.lat!=null && row.lng!=null){
    markers.push(new maplibregl.Marker({color: row.decision==="accepted"?"#2563eb":"#dc2626"}).setLngLat([row.lng,row.lat]).setPopup(new maplibregl.Popup().setHTML("<strong>"+esc(row.name)+"</strong><br/>"+esc(row.category||row.activity||"")+"<br/>"+esc(row.reason||row.rejectionReason||""))).addTo(map));
    map.flyTo({center:[row.lng,row.lat],zoom:Math.max(map.getZoom(),14)});
    sidebar.textContent=(row.decision||"")+" "+(row.kind||"")+": "+(row.reason||row.rejectionReason||"");
  }
}

function renderSummary(d){
  var g=document.getElementById("summaryGrid"); g.innerHTML="";
  var audit=d.filterAudit||{};
  [["Raw",d.run.rawObjects],["Spots",d.run.acceptedSpots],["Routes",d.run.acceptedRoutes],["Rejected",d.run.rejected],["Filter",audit.verdict||"—"]].forEach(function(x){
    var box=document.createElement("div"); box.className="stat-box";
    box.innerHTML='<div class="stat-label">'+x[0]+'</div><div class="stat-value">'+x[1]+'</div>'; g.appendChild(box);
  });
}

function renderResults(data){
  document.getElementById("resultCount").textContent=String(data.results.length);
  document.getElementById("resultTotal").textContent=String(data.total);
  var tbody=document.getElementById("resultsBody"); tbody.innerHTML="";
  data.results.forEach(function(row){
    var tr=document.createElement("tr");
    tr.className=row.decision;
    var tags=Object.entries(row.topTags||{}).slice(0,3).map(function(e){return e[0]+"="+e[1];}).join(", ");
    tr.innerHTML=
      '<td class="decision-'+esc(row.decision)+'">'+esc(row.decision)+'</td>'+
      '<td>'+esc(row.kind)+'</td>'+
      '<td>'+esc(row.name)+'</td>'+
      '<td>'+esc(row.category||row.activity||row.rawTypeLabel)+'</td>'+
      '<td>'+esc(row.locavaScore)+'</td>'+
      '<td>'+esc(row.reason||row.rejectionReason)+'</td>'+
      '<td>'+(row.distanceMiles!=null?row.distanceMiles+" mi":"")+'</td>'+
      '<td>'+esc(row.displayPriority)+'</td>'+
      '<td>'+esc(row.sourceKey)+'</td>'+
      '<td>'+esc(tags)+'</td>'+
      '<td><button type="button" class="small view-map">View on map</button></td>';
    tr.querySelector(".view-map").addEventListener("click", function(e){ e.stopPropagation(); showOnMap(row); });
    tr.addEventListener("click", function(){ showOnMap(row); });
    tbody.appendChild(tr);
  });
}

function searchParams(extra){
  return {
    runId: runId,
    q: document.getElementById("searchInput").value.trim(),
    decision: document.getElementById("filterDecision").value,
    kind: document.getElementById("filterKind").value,
    onlyTrails: document.getElementById("onlyTrails").checked,
    onlyFood: document.getElementById("onlyFood").checked,
    onlyNature: document.getElementById("onlyNature").checked,
    onlySuspicious: document.getElementById("onlySuspicious").checked,
    limit: 300,
    ...extra
  };
}

async function doSearch(extra){
  var data=await api("/admin/openstreetmap/api/search?"+qs(searchParams(extra||{})));
  renderResults(data);
}

async function runClassifier(){
  document.getElementById("statusBar").className="status-bar running";
  document.getElementById("statusBar").textContent="Fetching + classifying…";
  try{
    var params={ mode:"classify", source:document.getElementById("source").value, foodMode:document.getElementById("foodMode").value, trailMode:document.getElementById("trailMode").value, natureMode:document.getElementById("natureMode").value };
    var data=await api("/admin/openstreetmap/api/hartland/features?"+qs(params));
    runId=data.result.runId;
    document.getElementById("diagnosticsJson").value=data.result.diagnosticsJson||"";
    document.getElementById("mapMeta").textContent=data.result.rawObjects+" raw · "+data.result.acceptedSpots.length+" spots · "+data.result.acceptedRoutes.length+" routes";
    renderSummary(data.result.diagnostics);
    document.getElementById("statusBar").className="status-bar success";
    document.getElementById("statusBar").textContent="Done — filter audit: "+(data.result.diagnostics.filterAudit?.verdict||"?");
    await doSearch();
  }catch(e){
    document.getElementById("statusBar").className="status-bar error";
    document.getElementById("statusBar").textContent="Error: "+e.message;
  }
}

document.getElementById("btnRun").addEventListener("click", runClassifier);
document.getElementById("btnSearch").addEventListener("click", function(){ doSearch(); });
document.getElementById("searchInput").addEventListener("input", function(){ doSearch(); });
document.getElementById("filterDecision").addEventListener("change", function(){ doSearch(); });
document.getElementById("filterKind").addEventListener("change", function(){ doSearch(); });
["onlyTrails","onlyFood","onlyNature","onlySuspicious"].forEach(function(id){ document.getElementById(id).addEventListener("change", function(){ doSearch(); }); });
document.querySelectorAll(".preset").forEach(function(btn){
  btn.addEventListener("click", function(){ doSearch({ preset: btn.getAttribute("data-preset") }); });
});
document.getElementById("btnFitRegion").addEventListener("click", function(){
  var b=DEFAULT_VIEWPORT; map.fitBounds([[b.minLng,b.minLat],[b.maxLng,b.maxLat]],{padding:32});
});
document.getElementById("btnClearMap").addEventListener("click", clearMapLayers);
document.getElementById("btnCopyJson").addEventListener("click", function(){ document.getElementById("diagnosticsJson").select(); document.execCommand("copy"); });

initMap();
runClassifier();
</script>
</body></html>`;
}
