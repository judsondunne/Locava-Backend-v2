/**
 * Vermont Off-Road → Undiscovered Posts — /admin/openstreetmap/vermont-offroad-import
 */
export function renderOpenStreetMapVermontOffroadImportPage(): string {
  const apiBase = "/admin/openstreetmap/api/vermont-offroad-import";
  const vtCenter = { lat: 44.0, lng: -72.45 };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Vermont Off-Road → Undiscovered Posts</title>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    a{color:#93c5fd;text-decoration:none}
    .shell{max-width:1400px;margin:0 auto;padding:20px 16px 48px}
    h1{font-size:22px;margin:0 0 6px}
    h2{font-size:15px;margin:0 0 8px;color:#cbd5e1}
    .muted{color:#94a3b8;font-size:13px;line-height:1.5}
    .panel{border:1px solid #334155;border-radius:10px;background:#111827;padding:14px;margin:14px 0}
    button{padding:8px 14px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:13px;cursor:pointer;font-weight:600;margin:2px}
    button.secondary{background:#334155}
    button.ghost{background:transparent;border:1px solid #475569;color:#cbd5e1}
    button.success{background:#15803d}
    button.small{padding:4px 8px;font-size:11px}
    button:disabled{opacity:.5;cursor:not-allowed}
    input,select{padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:13px}
    label{font-size:12px;color:#cbd5e1;display:flex;flex-direction:column;gap:4px}
    .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:10px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase}
    .stat-value{font-size:22px;font-weight:700;margin-top:4px}
    #statusBar{padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0b1220;font-size:14px;font-weight:600;margin:12px 0}
    #statusBar.loading{border-color:#2563eb;background:#172554;color:#bfdbfe}
    #statusBar.ok{border-color:#166534;background:#052e16;color:#86efac}
    #statusBar.warn{border-color:#854d0e;background:#422006;color:#fcd34d}
    #statusBar.error{border-color:#b91c1c;background:#450a0a;color:#fecaca}
    #warnProd{display:none;background:#450a0a;border:2px solid #b91c1c;color:#fecaca;padding:12px;border-radius:10px;margin:12px 0;font-weight:600}
    #logFeed{max-height:320px;overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.5;background:#020617;border:1px solid #334155;border-radius:8px;padding:10px}
    .log-info{color:#cbd5e1}.log-success{color:#86efac}.log-warn{color:#fcd34d}.log-error{color:#fca5a5}
    .badge{display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-right:8px;border:1px solid #334155}
    .badge.emu{background:#172554;color:#93c5fd;border-color:#2563eb}
    .badge.prod{background:#450a0a;color:#fca5a5;border-color:#b91c1c}
    .badge.dry{background:#422006;color:#fcd34d;border-color:#854d0e}
    #scanProgressPanel{display:none;border:1px solid #2563eb;border-radius:10px;background:#0b1220;padding:14px;margin:12px 0}
    #scanProgressPanel.visible{display:block}
    #scanProgressBar{height:10px;border-radius:999px;background:#1e293b;overflow:hidden;margin:10px 0}
    #scanProgressFill{height:100%;width:0;background:linear-gradient(90deg,#2563eb,#38bdf8);transition:width .35s ease}
    #scanProgressMeta{font-size:12px;color:#94a3b8;line-height:1.5}
    #scanProgressStep{font-size:14px;font-weight:600;color:#e2e8f0;margin:0 0 4px}
    #fetchOverlay{display:none}
    .map-shell{height:480px;border-radius:16px;border:1px solid #334155;overflow:hidden;background:#020617;position:relative}
    #mapMeta{position:absolute;top:10px;left:10px;z-index:2;background:rgba(15,23,42,.92);border:1px solid #334155;border-radius:8px;padding:8px 12px;font-size:12px;max-width:420px;line-height:1.45}
    #mapSidebar{font-size:12px;color:#cbd5e1;margin-top:8px;min-height:40px}
    .table-wrap{max-height:520px;overflow:auto;border:1px solid #1f2937;border-radius:8px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border-top:1px solid #334155;padding:6px 8px;text-align:left;vertical-align:top}
    th{position:sticky;top:0;background:#111827;color:#94a3b8;z-index:2}
    tr:hover{background:#1e293b}
    tr.row-selected{background:#172554}
    tr.ineligible{opacity:.55}
    .pill{display:inline-block;padding:2px 7px;border-radius:999px;border:1px solid #334155;font-size:10px}
    .pill.eligible{border-color:#166534;color:#86efac}
    .pill.review{border-color:#854d0e;color:#fcd34d}
    .emoji-marker{font-size:18px;line-height:1;cursor:pointer;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
    .map-popup{font-size:12px;line-height:1.45;max-width:280px}
    button.tab{background:#0b1220;border:1px solid #334155;color:#cbd5e1;font-size:11px;padding:5px 9px}
    #searchInput{min-width:280px}
  </style>
</head>
<body>
<div class="shell">
  <p><a href="/admin">← Admin</a> · <a href="/admin/openstreetmap">OSM Classifier</a> · <a href="/admin/openstreetmap/offroad-master">Offroad Master</a></p>
  <h1>Vermont Off-Road → Undiscovered Posts</h1>
  <p class="muted">Fetch all Vermont off-road trails statewide, <strong>browse on the map + search the list</strong> like the main OSM page, then write undiscovered route posts to <code>unexploredRoutes</code>.</p>

  <div id="targetBadge" class="badge dry">SCAN ONLY</div>
  <div id="warnProd">⚠ Production write mode — requires env unlock + confirmation phrase below.</div>
  <div id="statusBar">Loading config…</div>

  <div id="scanProgressPanel" aria-live="polite">
    <div id="scanProgressStep">Scanning…</div>
    <div id="scanProgressBar"><div id="scanProgressFill"></div></div>
    <div id="scanProgressMeta">Starting…</div>
  </div>

  <section class="panel" id="activityPanel">
    <h2>Activity log</h2>
    <div id="logFeed"></div>
  </section>

  <section class="panel">
    <h2>1. Scan Vermont (statewide)</h2>
    <p class="muted">Default scan uses <strong>VTrans Class 4 + Legal Trails</strong> and <strong>USFS MVUM</strong> (fast, official). OSM supplemental is optional and can take 30+ minutes statewide.</p>
    <div class="row">
      <label style="flex-direction:row;align-items:center;gap:6px"><input id="reuseCached" type="checkbox"/> Reuse cached in-memory VT run</label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input id="includeOsm" type="checkbox"/> Include OSM supplemental (slow)</label>
      <button id="btnScan">Scan all VT off-road trails</button>
    </div>
    <div class="row">
      <label style="flex-direction:row;align-items:center;gap:6px"><input id="autoSaveBrowser" type="checkbox" checked/> Auto-save scan to browser (localStorage)</label>
      <button type="button" id="btnSaveBrowser" class="secondary" disabled>Save to browser now</button>
      <button type="button" id="btnRestoreBrowser" class="secondary">Restore from browser</button>
      <span id="browserCacheStatus" class="muted"></span>
    </div>
    <p class="muted">Browser save keeps your scan results on this device so a backend restart does not wipe progress. Restore reloads routes into the server without re-fetching VTrans/OSM.</p>
  </section>

  <section class="panel" id="browsePanel">
    <h2>2. Map preview</h2>
    <div class="row">
      <button type="button" id="btnFitVermont" class="secondary">Fit Vermont</button>
      <button type="button" id="btnClearSelection" class="ghost">Clear selection</button>
      <label style="flex-direction:row;align-items:center;gap:6px"><input id="showAllOnMap" type="checkbox" checked/> Show all routes on map</label>
      <span id="mapMetaInline" class="muted"></span>
    </div>
    <div class="map-shell">
      <div id="mapMeta">Run a scan to load routes</div>
      <div id="vtMap" style="width:100%;height:100%"></div>
    </div>
    <div id="mapSidebar"></div>
  </section>

  <section class="panel" id="searchPanel" style="display:none">
    <h2>3. Search &amp; browse routes</h2>
    <div class="row">
      <label style="flex:1">Search<input id="searchInput" type="text" placeholder="Name, town, source, class 4, legal trail, USFS…"/></label>
      <label>Source<select id="filterSource"><option value="">All sources</option></select></label>
      <label>Readiness<select id="filterReadiness"><option value="">All</option><option value="ready">ready</option><option value="review">review</option><option value="hidden">hidden</option></select></label>
      <label>Category<select id="filterCategory"><option value="">All categories</option><option value="class4_road">class4_road</option><option value="legal_trail">legal_trail</option><option value="class6_road">class6_road</option></select></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input id="filterEligibleOnly" type="checkbox" checked/> Eligible posts only</label>
      <button type="button" id="btnSearch" class="secondary">Search</button>
    </div>
    <div class="row">
      <button type="button" class="tab preset" data-q="class 4">Class 4</button>
      <button type="button" class="tab preset" data-q="legal trail">Legal trails</button>
      <button type="button" class="tab preset" data-q="usfs">USFS</button>
      <button type="button" class="tab preset" data-q="vtrans">VTrans</button>
      <button type="button" class="tab preset" data-q="unmaintained">Unmaintained</button>
      <button type="button" class="tab preset" data-clear="1">Clear search</button>
    </div>
    <div class="stat-grid" id="previewStats"></div>
  </section>

  <section class="panel" id="resultsPanel" style="display:none">
    <h2>Routes (<span id="resultCount">0</span> / <span id="resultTotal">0</span>)</h2>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Eligible</th><th>Name</th><th>Subtitle</th><th>Activity</th><th>Category</th>
          <th>Readiness</th><th>Source</th><th>Mi</th><th>Score</th><th></th>
        </tr></thead>
        <tbody id="resultsBody"></tbody>
      </table>
    </div>
  </section>

  <section class="panel" id="writePanel" style="display:none">
    <h2>4. Write undiscovered posts</h2>
    <table id="sourceTable" style="margin-bottom:12px"><thead><tr><th>Source</th><th>Raw</th><th>Accepted</th><th>Rejected</th><th>Errors</th></tr></thead><tbody></tbody></table>
    <div class="row">
      <label>Target<select id="writeTarget"><option value="emulator">emulator</option><option value="production">production</option></select></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input id="includePublicOnly" type="checkbox" checked/> Public-ready only</label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input id="includeReview" type="checkbox"/> Include review</label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input id="writeTiles" type="checkbox" checked/> Write tiles</label>
    </div>
    <div class="row">
      <input id="confirmProductionWrite" placeholder="Production password" style="min-width:360px;flex:1"/>
      <button id="btnWriteOne" class="secondary" disabled>Write 1 test post</button>
      <button id="btnWriteAll" class="success" disabled>Write ALL posts</button>
    </div>
    <p class="muted" id="prodWriteHint">Production writes to <code>unexploredRoutes</code> / <code>unexploredTiles</code> only — enter password <strong>Cooper</strong> (no env vars required).</p>
  </section>
</div>
<script>
const API="${apiBase}";
const VT_CENTER=${JSON.stringify(vtCenter)};
const BROWSER_CACHE_KEY="locava_vt_offroad_import_v1";
const OSM_STYLE={version:8,sources:{osm:{type:"raster",tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],tileSize:256}},layers:[{id:"osm",type:"raster",source:"osm"}]};

let sessionId=null, scanRunId=null, config=null, pollTimer=null;
let browseLoaded=false, map=null, mapReady=false, markers=[], selectedSourceKey=null;
let allMapRows=[], searchDebounce=null;

function esc(s){return String(s!=null?s:"").replace(/&/g,"&amp;").replace(/</g,"&lt;");}
function fmtElapsed(ms){const s=Math.floor(ms/1000),m=Math.floor(s/60);return m+":"+String(s%60).padStart(2,"0");}

function setStatus(text,kind){
  const el=document.getElementById("statusBar");
  el.textContent=text;
  el.className=kind||"";
}

function renderScanProgress(progress){
  const panel=document.getElementById("scanProgressPanel");
  if(!progress){
    panel.classList.remove("visible");
    return;
  }
  panel.classList.add("visible");
  document.getElementById("scanProgressStep").textContent=progress.message||"Working…";
  const pct=Math.max(0,Math.min(100,progress.percentComplete||0));
  document.getElementById("scanProgressFill").style.width=pct+"%";
  const parts=[];
  if(progress.sourceId) parts.push("Source: "+progress.sourceId);
  if(progress.sourceIndex&&progress.sourceTotal) parts.push("Source "+progress.sourceIndex+"/"+progress.sourceTotal);
  if(progress.chunkIndex&&progress.chunkTotal) parts.push("Chunk "+progress.chunkIndex+"/"+progress.chunkTotal);
  if(progress.routesAcceptedSoFar!=null) parts.push(progress.routesAcceptedSoFar+" routes so far");
  if(progress.elapsedMs!=null) parts.push("Elapsed "+fmtElapsed(progress.elapsedMs));
  if(progress.includeOsmSupplemental) parts.push("OSM supplemental ON");
  else parts.push("OSM skipped (fast mode)");
  document.getElementById("scanProgressMeta").textContent=parts.join(" · ");
}

function updateBrowserCacheStatus(){
  const el=document.getElementById("browserCacheStatus");
  try{
    const raw=localStorage.getItem(BROWSER_CACHE_KEY);
    if(!raw){el.textContent="No browser save yet.";return;}
    const parsed=JSON.parse(raw);
    const n=parsed.run?.routes?.length??parsed.preview?.totalRoutesFetched??"?";
    el.textContent="Saved "+new Date(parsed.savedAt).toLocaleString()+" — "+n+" routes";
  }catch(_e){
    el.textContent="Browser cache unreadable.";
  }
}

async function saveBrowserCache(){
  if(!sessionId)return false;
  try{
    const payload=await api("/browser-cache-export?sessionId="+encodeURIComponent(sessionId));
    localStorage.setItem(BROWSER_CACHE_KEY,JSON.stringify(payload));
    updateBrowserCacheStatus();
    return true;
  }catch(e){
    const msg=String(e.message||e);
    if(msg.toLowerCase().includes("quota")||e.name==="QuotaExceededError"){
      setStatus("Browser storage full — scan too large to save locally.","warn");
    }else{
      setStatus("Browser save failed: "+msg,"warn");
    }
    return false;
  }
}

async function restoreFromBrowser(){
  const raw=localStorage.getItem(BROWSER_CACHE_KEY);
  if(!raw){setStatus("Nothing saved in this browser yet.","warn");return;}
  try{
    const payload=JSON.parse(raw);
    setStatus("Restoring from browser cache…","loading");
    browseLoaded=false;allMapRows=[];scanRunId=null;
    const data=await api("/restore-from-browser-cache",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    sessionId=data.sessionId;
    applySession(data.session);
    browseLoaded=true;
    await onScanComplete(data.session);
    setStatus("Restored "+(payload.run?.routes?.length||0)+" routes from browser cache.","ok");
  }catch(e){setStatus("Restore failed: "+e.message,"error");}
}

async function api(path,opts){
  const res=await fetch(API+path,opts);
  const json=await res.json();
  if(!res.ok||json.ok===false)throw new Error(json.error?.message||json.message||res.statusText);
  return json.data??json;
}

function renderLogs(logs){
  const feed=document.getElementById("logFeed");
  feed.innerHTML=(logs||[]).map(l=>{
    const t=new Date(l.ts).toLocaleTimeString();
    return '<div class="log-'+l.level+'">['+t+'] '+esc(l.message)+'</div>';
  }).join("")||'<div class="muted">No log entries yet.</div>';
  feed.scrollTop=feed.scrollHeight;
}

function renderPreview(preview){
  if(!preview)return;
  document.getElementById("previewStats").innerHTML=[
    ["Fetched",preview.totalRoutesFetched],
    ["Eligible posts",preview.eligibleUndiscoveredPosts],
    ["Filtered out",preview.filteredOutByPublicOnly],
  ].map(([l,v])=>'<div class="stat-box"><div class="stat-label">'+l+'</div><div class="stat-value">'+v+'</div></div>').join("");
  const tbody=document.querySelector("#sourceTable tbody");
  tbody.innerHTML=(preview.sourceCounts||[]).map(s=>'<tr><td>'+esc(s.sourceId)+'</td><td>'+s.rawFeatures+'</td><td>'+s.routesAccepted+'</td><td>'+s.rejected+'</td><td>'+esc((s.errors||[]).join("; ")||"—")+'</td></tr>').join("");
}

function updateButtons(session){
  const busy=session.phase==="scanning"||session.phase==="writing";
  document.getElementById("btnScan").disabled=busy;
  const canWrite=session.phase==="scan_complete"||session.phase==="write_complete";
  document.getElementById("btnWriteOne").disabled=!canWrite||busy;
  document.getElementById("btnWriteAll").disabled=!canWrite||busy;
}

function updateBadge(session){
  const badge=document.getElementById("targetBadge");
  const target=document.getElementById("writeTarget").value;
  if(session.phase==="writing"){badge.textContent=target.toUpperCase()+" WRITE";badge.className="badge "+(target==="production"?"prod":"emu");}
  else if(session.phase==="scan_complete"||session.phase==="write_complete"){badge.textContent="READY TO WRITE";badge.className="badge dry";}
  else if(session.phase==="scanning"){badge.textContent="SCANNING";badge.className="badge emu";}
  else{badge.textContent="SCAN ONLY";badge.className="badge dry";}
  document.getElementById("warnProd").style.display=target==="production"?"block":"none";
}

function initMap(){
  if(typeof maplibregl==="undefined") throw new Error("maplibre not loaded");
  if(map){map.remove();map=null;mapReady=false;}
  map=new maplibregl.Map({container:"vtMap",style:OSM_STYLE,center:[VT_CENTER.lng,VT_CENTER.lat],zoom:7});
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-right");
  map.on("load",()=>{
    map.addSource("state-bbox",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
    map.addLayer({id:"state-bbox-line",type:"line",source:"state-bbox",paint:{"line-color":"#60a5fa","line-width":2,"line-dasharray":[2,2]}});
    const layerColors={"all-class4":"#f97316","all-legal":"#a855f7","all-usfs":"#22c55e","all-other":"#fb923c"};
    Object.entries(layerColors).forEach(([id,color])=>{
      map.addSource(id,{type:"geojson",data:{type:"FeatureCollection",features:[]}});
      map.addLayer({id:id+"-line",type:"line",source:id,paint:{"line-color":color,"line-width":2.5,"line-opacity":0.75},layout:{"line-cap":"round","line-join":"round"}});
    });
    map.addSource("sel-route",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
    map.addLayer({id:"sel-route-line",type:"line",source:"sel-route",paint:{"line-color":"#facc15","line-width":5}});
    mapReady=true;
    if(config?.stateBbox) drawStateBbox(config.stateBbox);
    if(allMapRows.length) drawAllRoutesOnMap(allMapRows);
  });
}

function drawStateBbox(bbox){
  if(!mapReady||!bbox)return;
  const geo={type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[[
    [bbox.minLng,bbox.minLat],[bbox.maxLng,bbox.minLat],[bbox.maxLng,bbox.maxLat],[bbox.minLng,bbox.maxLat],[bbox.minLng,bbox.minLat]
  ]]}};
  map.getSource("state-bbox").setData({type:"FeatureCollection",features:[geo]});
}

function fitVermont(){
  if(!mapReady||!config?.stateBbox)return;
  const b=config.stateBbox;
  map.fitBounds([[b.minLng,b.minLat],[b.maxLng,b.maxLat]],{padding:40,duration:600});
}

function routeLineFeatures(row){
  const gp=row.geometryPreview||{};
  const cat=row.offroadCategory||"class4_road";
  const out=[];
  if(gp.type==="multiline"&&gp.segments){
    gp.segments.forEach(seg=>{if(seg&&seg.length>=2)out.push({type:"Feature",properties:{name:row.name,category:cat,sourceKey:row.sourceKey},geometry:{type:"LineString",coordinates:seg.map(c=>[c.lng,c.lat])}});});
  }else if(gp.type==="line"&&gp.coordinates&&gp.coordinates.length>=2){
    out.push({type:"Feature",properties:{name:row.name,category:cat,sourceKey:row.sourceKey},geometry:{type:"LineString",coordinates:gp.coordinates.map(c=>[c.lng,c.lat])}});
  }
  return out;
}

function drawAllRoutesOnMap(rows){
  if(!mapReady)return;
  const class4=[],legal=[],usfs=[],other=[];
  (rows||[]).forEach(row=>{
    routeLineFeatures(row).forEach(f=>{
      const cat=f.properties.category;
      const src=row.source||"";
      if(cat==="legal_trail")legal.push(f);
      else if(src.includes("usfs")||src.startsWith("usfs"))usfs.push(f);
      else if(cat==="class4_road")class4.push(f);
      else other.push(f);
    });
  });
  map.getSource("all-class4").setData({type:"FeatureCollection",features:class4});
  map.getSource("all-legal").setData({type:"FeatureCollection",features:legal});
  map.getSource("all-usfs").setData({type:"FeatureCollection",features:usfs});
  map.getSource("all-other").setData({type:"FeatureCollection",features:other});
  const total=class4.length+legal.length+usfs.length+other.length;
  document.getElementById("mapMeta").innerHTML="<strong>"+rows.length+" routes</strong><br/>"+total+" line segments · orange=class4 · purple=legal · green=USFS";
  document.getElementById("mapMetaInline").textContent=rows.length+" routes on map";
}

function clearSelectionLayers(){
  markers.forEach(m=>{if(m._routeEmoji)m.remove();});
  markers=markers.filter(m=>!m._routeEmoji);
  if(mapReady) map.getSource("sel-route").setData({type:"FeatureCollection",features:[]});
  document.getElementById("mapSidebar").textContent="";
  selectedSourceKey=null;
  document.querySelectorAll("#resultsBody tr.row-selected").forEach(tr=>tr.classList.remove("row-selected"));
}

function showRouteOnMap(row){
  if(!mapReady)return;
  clearSelectionLayers();
  selectedSourceKey=row.sourceKey;
  const features=routeLineFeatures(row);
  map.getSource("sel-route").setData({type:"FeatureCollection",features:features});
  let allCoords=[];
  features.forEach(f=>{if(f.geometry.type==="LineString")f.geometry.coordinates.forEach(c=>allCoords.push({lng:c[0],lat:c[1]}));});
  if(allCoords.length){
    const lngs=allCoords.map(c=>c.lng),lats=allCoords.map(c=>c.lat);
    map.fitBounds([[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]],{padding:60,duration:500});
    const start=allCoords[0];
    const el=document.createElement("div");el.className="emoji-marker";el.textContent="🛻";
    const m=new maplibregl.Marker({element:el,anchor:"center"}).setLngLat([start.lng,start.lat])
      .setPopup(new maplibregl.Popup({offset:12}).setHTML(buildPopup(row))).addTo(map);
    m._routeEmoji=true;markers.push(m);
  }
  document.getElementById("mapSidebar").innerHTML="<strong>"+esc(row.name)+"</strong> · "+esc(row.offroadCategory||row.activity||"")+
    (row.distanceMiles!=null?" · "+row.distanceMiles+" mi":"")+
    (row.legalDisplayLabel?"<br/>"+esc(row.legalDisplayLabel):"")+
    "<br/><span class='muted'>"+esc(row.sourceKey)+"</span>";
  document.querySelectorAll("#resultsBody tr").forEach(tr=>{
    if(tr.dataset.sourceKey===row.sourceKey) tr.classList.add("row-selected");
  });
}

function buildPopup(row){
  let h='<div class="map-popup"><strong>'+esc(row.name)+'</strong>';
  if(row.subtitle)h+='<br/><span class="muted">'+esc(row.subtitle)+'</span>';
  h+='<br/>'+esc(row.offroadCategory||row.activity||"")+' · '+esc(row.mapReadiness||"");
  if(row.distanceMiles!=null)h+='<br/>'+row.distanceMiles+' mi';
  if(row.legalDisplayLabel)h+='<br/>'+esc(row.legalDisplayLabel);
  h+='<br/><span class="muted">'+esc(row.sourceKey)+'</span></div>';
  return h;
}

function searchQueryParams(){
  return new URLSearchParams({
    sessionId: sessionId||"",
    q: document.getElementById("searchInput").value.trim(),
    sourceId: document.getElementById("filterSource").value,
    mapReadiness: document.getElementById("filterReadiness").value,
    offroadCategory: document.getElementById("filterCategory").value,
    eligibleOnly: document.getElementById("filterEligibleOnly").checked?"true":"false",
    includePublicOnly: document.getElementById("includePublicOnly").checked?"true":"false",
    includeReviewItems: document.getElementById("includeReview").checked?"true":"false",
    limit: "300",
    offset: "0"
  });
}

function renderResults(data){
  document.getElementById("resultCount").textContent=String(data.results.length);
  document.getElementById("resultTotal").textContent=String(data.total);
  const tbody=document.getElementById("resultsBody");
  tbody.innerHTML="";
  data.results.forEach(row=>{
    const tr=document.createElement("tr");
    tr.dataset.sourceKey=row.sourceKey;
    if(!row.eligibleForWrite) tr.className="ineligible";
    if(row.sourceKey===selectedSourceKey) tr.className+=" row-selected";
    tr.innerHTML=
      '<td><span class="pill '+(row.eligibleForWrite?"eligible":"review")+'">'+(row.eligibleForWrite?"yes":"no")+'</span></td>'+
      '<td>'+esc(row.name)+'</td>'+
      '<td class="muted">'+esc(row.subtitle||"")+'</td>'+
      '<td>'+esc(row.primaryActivity||row.activity||"")+'</td>'+
      '<td>'+esc(row.offroadCategory||"")+'</td>'+
      '<td>'+esc(row.mapReadiness||"")+'</td>'+
      '<td class="muted">'+esc(row.source)+'</td>'+
      '<td>'+(row.distanceMiles!=null?row.distanceMiles.toFixed(1):"—")+'</td>'+
      '<td>'+esc(row.locavaScore)+'</td>'+
      '<td><button type="button" class="small view-map">Map</button></td>';
    tr.querySelector(".view-map").addEventListener("click",e=>{e.stopPropagation();showRouteOnMap(row);});
    tr.addEventListener("click",()=>showRouteOnMap(row));
    tbody.appendChild(tr);
  });
}

async function doSearch(){
  if(!sessionId)return;
  const data=await api("/routes?"+searchQueryParams().toString());
  renderResults(data);
}

async function loadAllRoutesForMap(){
  if(!sessionId)return;
  const params=new URLSearchParams({sessionId,limit:"5000",offset:"0",eligibleOnly:"false",includePublicOnly:"true",includeReviewItems:"true"});
  const data=await api("/routes?"+params.toString());
  allMapRows=data.results;
  if(document.getElementById("showAllOnMap").checked){
    if(mapReady) drawAllRoutesOnMap(allMapRows);
    else map.once("load",()=>drawAllRoutesOnMap(allMapRows));
  }
  populateSourceFilter(allMapRows);
}

function populateSourceFilter(rows){
  const sel=document.getElementById("filterSource");
  const current=sel.value;
  const sources=[...new Set((rows||[]).map(r=>r.source).filter(Boolean))].sort();
  sel.innerHTML='<option value="">All sources</option>'+sources.map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join("");
  if(sources.includes(current)) sel.value=current;
}

async function onScanComplete(session){
  document.getElementById("browsePanel").style.display="block";
  document.getElementById("searchPanel").style.display="block";
  document.getElementById("resultsPanel").style.display="block";
  document.getElementById("writePanel").style.display="block";
  renderPreview(session.preview);
  scanRunId=session.runId;
  document.getElementById("btnSaveBrowser").disabled=false;
  if(document.getElementById("autoSaveBrowser").checked){
    const ok=await saveBrowserCache();
    if(ok) appendBrowserLog("Scan saved to browser localStorage.");
  }
  if(!map) initMap();
  await loadAllRoutesForMap();
  await doSearch();
  fitVermont();
}

function appendBrowserLog(msg){
  const feed=document.getElementById("logFeed");
  const t=new Date().toLocaleTimeString();
  feed.innerHTML+='<div class="log-info">['+t+'] '+esc(msg)+'</div>';
  feed.scrollTop=feed.scrollHeight;
}

function applySession(session){
  sessionId=session.sessionId;
  renderLogs(session.logs);
  updateButtons(session);
  updateBadge(session);
  if(session.preview) renderPreview(session.preview);

  if(session.phase==="scanning"){
    renderScanProgress(session.scanProgress);
    setStatus(session.scanProgress?.message||"Scanning Vermont statewide off-road sources…","loading");
  }else if(session.phase==="writing"){
    renderScanProgress({message:"Writing undiscovered posts to Firestore…",percentComplete:50,elapsedMs:0});
    setStatus("Writing undiscovered posts to Firestore…","loading");
  }else if(session.phase==="scan_complete"){
    renderScanProgress(null);
    const n=session.preview?.eligibleUndiscoveredPosts??0;
    setStatus("Scan complete — browse "+n+" eligible route(s) on the map, then write when ready.","ok");
    if(!browseLoaded){browseLoaded=true;void onScanComplete(session);}
  }else if(session.phase==="write_complete"){
    renderScanProgress(null);
    const w=session.writeResult?.writtenRoutes??0;
    setStatus("Write complete — "+w+" route post(s) written.","ok");
  }else if(session.phase==="failed"){
    renderScanProgress(null);
    setStatus("Failed: "+(session.error||"unknown error"),"error");
  }else{
    renderScanProgress(null);
  }
}

async function pollSession(){
  if(!sessionId)return;
  try{
    const data=await api("/session/"+sessionId);
    applySession(data.session);
    if(data.session.phase==="scanning"||data.session.phase==="writing") pollTimer=setTimeout(pollSession,800);
  }catch(e){setStatus("Poll error: "+e.message,"error");renderScanProgress(null);}
}

async function loadConfig(){
  try{
    const data=await api("/config");
    config=data.config;
    if(config.productionPasswordOnly){
      document.getElementById("prodWriteHint").innerHTML="Production writes to <code>unexploredRoutes</code> / <code>unexploredTiles</code> only — enter password <strong>"+esc(config.productionConfirmationPhrase)+"</strong> (no env vars required).";
    }
    try{ initMap(); }catch(mapErr){ console.error("map init failed", mapErr); }
    if(data.scanBlockedWhenInventoryProdUnlocked){
      setStatus("⚠ Scan blocked: inventory production writes unlocked.","error");
      document.getElementById("btnScan").disabled=true;
    }else{
      setStatus("Ready — scan Vermont, then browse routes on the map before writing.","ok");
    }
    updateBrowserCacheStatus();
  }catch(e){
    setStatus("Config load failed: "+e.message,"error");
  }
}

async function startScan(){
  browseLoaded=false;allMapRows=[];scanRunId=null;
  try{
    setStatus("Starting scan…","loading");
    renderScanProgress({message:"Starting scan…",percentComplete:1,elapsedMs:0,includeOsmSupplemental:document.getElementById("includeOsm").checked});
    const data=await api("/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      reuseCachedRun:document.getElementById("reuseCached").checked,
      includeOsmSupplemental:document.getElementById("includeOsm").checked,
    })});
    sessionId=data.sessionId;
    pollSession();
  }catch(e){setStatus("Scan failed: "+e.message,"error");renderScanProgress(null);}
}

async function startWrite(limit){
  if(!sessionId)return;
  const writeTarget=document.getElementById("writeTarget").value;
  if(writeTarget==="production"&&!confirm("Write to PRODUCTION Firestore?"))return;
  try{
    await api("/write",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      sessionId,limit,writeTarget,
      confirmProductionWrite:document.getElementById("confirmProductionWrite").value||undefined,
      includePublicOnly:document.getElementById("includePublicOnly").checked,
      includeReviewItems:document.getElementById("includeReview").checked,
      writeTiles:document.getElementById("writeTiles").checked,
    })});
    pollSession();
  }catch(e){setStatus("Write failed: "+e.message,"error");renderScanProgress(null);}
}

document.getElementById("btnScan").addEventListener("click",startScan);
document.getElementById("btnSaveBrowser").addEventListener("click",()=>{void saveBrowserCache().then(ok=>{if(ok)setStatus("Saved scan to browser localStorage.","ok");});});
document.getElementById("btnRestoreBrowser").addEventListener("click",()=>{void restoreFromBrowser();});
document.getElementById("btnWriteOne").addEventListener("click",()=>startWrite(1));
document.getElementById("btnWriteAll").addEventListener("click",()=>startWrite("all"));
document.getElementById("btnSearch").addEventListener("click",()=>doSearch());
document.getElementById("searchInput").addEventListener("input",()=>{clearTimeout(searchDebounce);searchDebounce=setTimeout(doSearch,250);});
["filterSource","filterReadiness","filterCategory","filterEligibleOnly","includePublicOnly","includeReview"].forEach(id=>{
  document.getElementById(id).addEventListener("change",()=>doSearch());
});
document.querySelectorAll(".preset").forEach(btn=>{
  btn.addEventListener("click",()=>{
    if(btn.dataset.clear){document.getElementById("searchInput").value="";}
    else{document.getElementById("searchInput").value=btn.dataset.q||"";}
    doSearch();
  });
});
document.getElementById("btnFitVermont").addEventListener("click",fitVermont);
document.getElementById("btnClearSelection").addEventListener("click",clearSelectionLayers);
document.getElementById("showAllOnMap").addEventListener("change",()=>{
  if(document.getElementById("showAllOnMap").checked&&allMapRows.length) drawAllRoutesOnMap(allMapRows);
  else if(mapReady){
    ["all-class4","all-legal","all-usfs","all-other"].forEach(id=>map.getSource(id).setData({type:"FeatureCollection",features:[]}));
    document.getElementById("mapMeta").textContent="Map overlay hidden";
  }
});
document.getElementById("writeTarget").addEventListener("change",()=>{if(sessionId)updateBadge({phase:"scan_complete"});});

loadConfig().catch(e=>setStatus("Config load failed: "+e.message,"error"));
</script>
</body>
</html>`;
}
