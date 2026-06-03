/**
 * National Offroad Source Registry — /admin/openstreetmap/offroad-master
 */
export function renderOpenStreetMapOffroadMasterPage(stateCode?: string): string {
  const isDetail = Boolean(stateCode);
  const title = isDetail ? `Offroad Sources — ${stateCode}` : "National Offroad Sources";
  const apiBase = "/admin/openstreetmap/api/offroad/sources";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    a{color:#93c5fd;text-decoration:none}
    .shell{max-width:1500px;margin:0 auto;padding:20px 16px 48px}
    h1{font-size:22px;margin:0 0 6px}
    h2{font-size:15px;margin:0 0 8px;color:#cbd5e1}
    .muted{color:#94a3b8;font-size:13px}
    .panel{border:1px solid #334155;border-radius:10px;background:#111827;padding:12px;margin:14px 0}
    button{padding:6px 10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:12px;cursor:pointer;font-weight:600}
    button.secondary{background:#334155}
    button:disabled{opacity:.5;cursor:not-allowed}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border-top:1px solid #334155;padding:6px 8px;text-align:left;vertical-align:top}
    th{position:sticky;top:0;background:#111827;color:#94a3b8;z-index:1}
    tr:hover{background:#1e293b}
    tr.row-selected{background:#172554}
    .pill{display:inline-block;padding:2px 7px;border-radius:999px;border:1px solid #334155;font-size:10px;margin:1px}
    .pill.active{border-color:#166534;color:#86efac}
    .pill.needs_source{border-color:#854d0e;color:#fcd34d}
    .pill.needs_validation{border-color:#1d4ed8;color:#93c5fd}
    .map-shell{height:480px;border-radius:12px;border:1px solid #334155;overflow:hidden;position:relative}
    #mapMeta{position:absolute;top:10px;left:10px;z-index:2;background:rgba(15,23,42,.92);border:1px solid #334155;border-radius:8px;padding:8px 12px;font-size:12px;max-width:420px;line-height:1.45}
    #mapMeta.loading{border-color:#2563eb;color:#bfdbfe}
    #mapMeta.ready{border-color:#166534;color:#86efac}
    #mapMeta.empty{border-color:#854d0e;color:#fcd34d}
    #diagJson{width:100%;min-height:200px;font-family:ui-monospace,Menlo,monospace;font-size:11px;background:#020617;color:#cbd5e1;border:1px solid #334155;border-radius:8px;padding:8px}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase}
    .stat-value{font-size:18px;font-weight:700;margin-top:4px}
    input,select{padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:12px}
    .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
    #statusBar{padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0b1220;font-size:14px;font-weight:600;position:sticky;top:0;z-index:100}
    #statusBar.loading{border-color:#2563eb;background:#172554;color:#bfdbfe;box-shadow:0 0 0 2px rgba(37,99,235,.35)}
    #statusBar.ready{border-color:#166534;background:#052e16;color:#86efac}
    #statusBar.warn{border-color:#854d0e;background:#422006;color:#fcd34d}
    #fetchOverlay{display:none;position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:9999;align-items:center;justify-content:center;padding:24px}
    #fetchOverlay.visible{display:flex}
    #fetchOverlay .box{max-width:520px;background:#111827;border:2px solid #2563eb;border-radius:14px;padding:24px 28px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
    #fetchOverlay .box h3{margin:0 0 8px;font-size:20px;color:#fff}
    #fetchOverlay .box p{margin:8px 0;color:#94a3b8;font-size:14px;line-height:1.5}
    #fetchOverlay .elapsed{font-size:28px;font-weight:700;color:#93c5fd;margin:12px 0}
    .map-shell.loading-map{opacity:.55;pointer-events:none}
    .spinner{display:inline-block;width:14px;height:14px;border:2px solid #93c5fd;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:6px}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
<div class="shell">
  <p>
    <a href="/admin">← Admin</a>
    · <a href="/admin/openstreetmap">OSM Classifier</a>
    · <a href="/admin/openstreetmap/offroad-master">National Offroad</a>
    ${isDetail ? `· <strong>${stateCode}</strong>` : ""}
  </p>
  <h1>${title}</h1>
  <p class="muted">Select a state to preview <strong>all</strong> offroad routes on the map. Cached results show instantly; full-state fetch shows a clear loading state.</p>
  <div id="statusBar" class="panel">Loading registry…</div>

  <div id="fetchOverlay" aria-live="polite">
    <div class="box">
      <div class="spinner" style="width:28px;height:28px;border-width:3px;margin:0 auto 12px"></div>
      <h3 id="fetchOverlayTitle">Fetching routes…</h3>
      <p id="fetchOverlayBody">Querying official sources. Full states use many map tiles — please wait.</p>
      <div class="elapsed" id="fetchElapsed">0:00</div>
      <p style="font-size:12px;color:#64748b">Do not close this tab. Map will update when complete.</p>
    </div>
  </div>

  <section class="panel">
    <div class="stat-grid" id="coverageStats"></div>
  </section>

  <section class="panel">
    <h2>Main spots / routes pipeline</h2>
    <p class="muted">Configure which national offroad dry-run routes stage into the OSM classifier <strong>acceptedRoutes</strong> list (in-memory only — production writes blocked). After staging, open <a href="/admin/openstreetmap">OSM Classifier</a>.</p>
    <div id="exportConfigForm" class="row" style="align-items:flex-start;flex-direction:column;gap:6px"></div>
    <div class="row">
      <button type="button" id="btnSaveExportConfig">Save export config</button>
      <button type="button" id="btnPreviewExport" class="secondary" disabled>Preview export for selected state</button>
      <button type="button" id="btnStageToMain" disabled>Stage to main routes list</button>
    </div>
    <pre id="exportPreview" class="muted" style="font-size:11px;white-space:pre-wrap;margin:8px 0 0"></pre>
  </section>

  <section class="panel" id="stateDetailPanel" style="display:none">
    <h2 id="stateDetailTitle">State preview</h2>
    <div id="stateDetail"></div>
  </section>

  <section class="panel">
    <div class="row">
      <button type="button" id="btnRefresh">Refresh registry</button>
      <button type="button" id="btnReloadRoutes" class="secondary" disabled>Reload routes for selected state</button>
      <button type="button" id="btnFederalBatch" class="secondary">Batch federal (checked)</button>
      <label><strong>Selected state</strong>
        <select id="stateFilter"><option value="">— pick a state —</option></select>
      </label>
      <input type="text" id="stateSearch" placeholder="Search table…"/>
    </div>
    <div class="table-wrap" style="max-height:480px;overflow:auto">
      <table id="statesTable">
        <thead><tr>
          <th>State</th><th>On</th><th>Setup</th><th>USFS</th><th>BLM</th><th>OSM</th>
          <th>State src</th><th>Best run</th><th>Routes</th><th>Actions</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <h2>Map preview</h2>
    <p class="muted" id="mapHint">Choose a state from the dropdown above to load routes.</p>
    <div class="map-shell">
      <div id="mapMeta">No state selected</div>
      <div id="map" style="width:100%;height:100%"></div>
    </div>
  </section>

  <section class="panel">
    <h2>Diagnostics</h2>
    <textarea id="diagJson" readonly></textarea>
  </section>
</div>
<script>
const API="${apiBase}";
const PIPELINE="/admin/openstreetmap/api/offroad/pipeline";
const INITIAL_STATE=${isDetail ? JSON.stringify(stateCode) : "null"};
let masterData=null;
let activeState=INITIAL_STATE;
let activeRunId=null;
let exportConfig=null;
let selected=new Set();
let mapReady=false;
let fetchInFlight=null;

async function api(path,opts){
  const r=await fetch(path,opts);
  const j=await r.json();
  if(!r.ok||j.ok===false) throw new Error(j.error?.message||j.message||"request_failed");
  return j.data??j;
}

function setStatus(kind,text){
  const el=document.getElementById("statusBar");
  el.className="panel "+(kind||"");
  el.innerHTML=text;
}

function setMapMeta(kind,html){
  const el=document.getElementById("mapMeta");
  el.className=kind||"";
  el.innerHTML=html;
}

function pill(status){return '<span class="pill '+status+'">'+status+'</span>';}

function renderStats(d){
  const c=d.stateCoverageDiagnostics||{};
  const cat=d.stateCatalog||[];
  document.getElementById("coverageStats").innerHTML=[
    ["Total states",c.totalStates],
    ["Federal coverage",c.statesWithFederalCoverage],
    ["Official state source",cat.filter(s=>s.setupTier==="federal_plus_state_official").length],
    ["Needs validation",cat.filter(s=>s.setupTier==="federal_plus_needs_validation").length],
    ["Federal only",cat.filter(s=>s.setupTier==="federal_only").length],
    ["Production blocked",d.productionWritesBlocked?"yes":"no"]
  ].map(([l,v])=>'<div class="stat-box"><div class="stat-label">'+l+'</div><div class="stat-value">'+v+'</div></div>').join("");
}

function renderExportConfigForm(cfg){
  exportConfig=cfg||exportConfig;
  if(!exportConfig) return;
  const fields=[
    ["includeReady","Include map-ready routes"],
    ["includeReview","Include review routes"],
    ["includeHidden","Include hidden routes"],
    ["includeOfficialState","Official state sources (VT/NH)"],
    ["includeOfficialFederal","USFS + BLM"],
    ["includeOsmExplicit","OSM explicit/strong"],
    ["includeOsmCandidates","OSM candidates"],
    ["excludePrivateAccess","Exclude private/restricted"]
  ];
  document.getElementById("exportConfigForm").innerHTML=fields.map(([k,label])=>
    '<label><input type="checkbox" data-export="'+k+'" '+(exportConfig[k]?"checked":"")+'/> '+label+'</label>'
  ).join("")+'<label>Min Locava score <input type="number" id="exportMinScore" min="0" max="100" value="'+(exportConfig.minLocavaScore||70)+'" style="width:64px"/></label>';
}

async function loadPipelineConfig(){
  const res=await api(PIPELINE+"/export-config");
  renderExportConfigForm(res.config||res);
}

function renderTable(states){
  const tbody=document.querySelector("#statesTable tbody");
  const q=(document.getElementById("stateSearch").value||"").toLowerCase();
  tbody.innerHTML="";
  for(const s of states){
    if(q&&!s.stateName.toLowerCase().includes(q)&&!s.stateCode.toLowerCase().includes(q)) continue;
    const tr=document.createElement("tr");
    if(activeState===s.stateCode) tr.className="row-selected";
    const last=s.lastDryRun;
    const routeCount=last?last.routes.length:(s.counts?s.counts.routes:"—");
    const setup=s.setup?.setupTier||"federal_only";
    tr.innerHTML=
      '<td><a href="#" data-pick="'+s.stateCode+'">'+s.stateCode+' '+s.stateName+'</a></td>'+
      '<td><input type="checkbox" data-toggle-state="'+s.stateCode+'" '+(s.enabled?"checked":"")+'/></td>'+
      '<td><span class="pill '+(setup.includes("official")?"active":setup.includes("validation")?"needs_validation":"needs_source")+'">'+setup.replace(/_/g," ")+'</span></td>'+
      '<td>'+pill(s.federalSummary.usfs)+'</td><td>'+pill(s.federalSummary.blm)+'</td><td>'+pill(s.federalSummary.osm)+'</td>'+
      '<td>cfg '+s.stateSourceSummary.configured+' / act '+s.stateSourceSummary.active+
      ' / val '+s.stateSourceSummary.needsValidation+' / need '+s.stateSourceSummary.needsSource+'</td>'+
      '<td>'+(last?(last.completedAt||last.startedAt).slice(0,19):"—")+'</td>'+
      '<td><strong>'+routeCount+'</strong></td>'+
      '<td><button data-run="'+s.stateCode+'" class="secondary">Fetch all</button> '+
      '<input type="checkbox" data-select="'+s.stateCode+'"/></td>';
    tbody.appendChild(tr);
  }
}

let map,routeLayer="offroad-routes",areaLayer="offroad-areas",stateLayer="state-outline";
let fetchTimer=null,fetchStartedAt=0;

function forcePaint(){
  return new Promise(r=>requestAnimationFrame(()=>setTimeout(r,30)));
}

function showFetchOverlay(title,body){
  document.getElementById("fetchOverlayTitle").textContent=title;
  document.getElementById("fetchOverlayBody").textContent=body;
  document.getElementById("fetchOverlay").classList.add("visible");
  document.querySelector(".map-shell")?.classList.add("loading-map");
  fetchStartedAt=Date.now();
  if(fetchTimer) clearInterval(fetchTimer);
  fetchTimer=setInterval(()=>{
    const sec=Math.floor((Date.now()-fetchStartedAt)/1000);
    const m=Math.floor(sec/60),s=sec%60;
    document.getElementById("fetchElapsed").textContent=m+":"+(s<10?"0":"")+s;
  },500);
}

function hideFetchOverlay(){
  document.getElementById("fetchOverlay").classList.remove("visible");
  document.querySelector(".map-shell")?.classList.remove("loading-map");
  if(fetchTimer){ clearInterval(fetchTimer); fetchTimer=null; }
}

function clearMapRoutes(){
  if(!mapReady) return;
  map.getSource(routeLayer)?.setData({type:"FeatureCollection",features:[]});
  map.getSource(areaLayer)?.setData({type:"FeatureCollection",features:[]});
}

function stateBoundsToGeoJson(bbox){
  if(!bbox) return {type:"FeatureCollection",features:[]};
  return {type:"FeatureCollection",features:[{type:"Feature",properties:{kind:"state-outline"},geometry:{type:"Polygon",coordinates:[[
    [bbox.minLng,bbox.minLat],[bbox.maxLng,bbox.minLat],[bbox.maxLng,bbox.maxLat],[bbox.minLng,bbox.maxLat],[bbox.minLng,bbox.minLat]
  ]]}}]};
}

function initMap(){
  map=new maplibregl.Map({
    container:"map",
    style:{version:8,sources:{osm:{type:"raster",tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],tileSize:256}},layers:[{id:"osm",type:"raster",source:"osm"}]},
    center:[-98,39],zoom:3
  });
  map.on("load",()=>{
    map.addSource(stateLayer,{type:"geojson",data:{type:"FeatureCollection",features:[]}});
    map.addLayer({id:stateLayer+"-line",type:"line",source:stateLayer,paint:{"line-color":"#60a5fa","line-width":2,"line-dasharray":[2,2]}});
    map.addSource(routeLayer,{type:"geojson",data:{type:"FeatureCollection",features:[]}});
    map.addLayer({id:routeLayer+"-line",type:"line",source:routeLayer,paint:{"line-color":"#f97316","line-width":3},layout:{"line-cap":"round","line-join":"round"}});
    map.addSource(areaLayer,{type:"geojson",data:{type:"FeatureCollection",features:[]}});
    map.addLayer({id:areaLayer+"-fill",type:"fill",source:areaLayer,paint:{"fill-color":"#22c55e","fill-opacity":0.15}});
    mapReady=true;
    if(activeState) previewState(activeState,{preferCache:true});
  });
}

function computeRoutesBounds(routes){
  let minLat=90,maxLat=-90,minLng=180,maxLng=-180,n=0;
  for(const r of routes||[]){
    const segs=r.segments?.length?r.segments:(r.coordinates?[r.coordinates]:[]);
    for(const seg of segs){
      for(const c of seg||[]){
        if(!c||!Number.isFinite(c.lat)||!Number.isFinite(c.lng)) continue;
        minLat=Math.min(minLat,c.lat); maxLat=Math.max(maxLat,c.lat);
        minLng=Math.min(minLng,c.lng); maxLng=Math.max(maxLng,c.lng);
        n++;
      }
    }
  }
  return n?{minLat,minLng,maxLat,maxLng}:null;
}

function routesToGeoJson(routes){
  const features=[];
  for(const r of routes||[]){
    const segs=r.segments&&r.segments.length?r.segments:(r.coordinates?[r.coordinates]:[]);
    for(const seg of segs){
      if(!seg||seg.length<2) continue;
      features.push({
        type:"Feature",
        properties:{name:r.name,source:r.source,activity:r.activity},
        geometry:{type:"LineString",coordinates:seg.map(c=>[c.lng,c.lat])}
      });
    }
  }
  return {type:"FeatureCollection",features};
}

function areasToGeoJson(areas){
  return {
    type:"FeatureCollection",
    features:(areas||[]).map(a=>({
      type:"Feature",
      properties:{designation:a.designation,source:a.sourceId},
      geometry:{type:"Polygon",coordinates:[[
        [a.bbox.minLng,a.bbox.minLat],[a.bbox.maxLng,a.bbox.minLat],
        [a.bbox.maxLng,a.bbox.maxLat],[a.bbox.minLng,a.bbox.maxLat],[a.bbox.minLng,a.bbox.minLat]
      ]]}
    }))
  };
}

function fitBounds(bbox){
  if(!map||!bbox) return;
  map.fitBounds([[bbox.minLng,bbox.minLat],[bbox.maxLng,bbox.maxLat]],{padding:40,duration:800});
}

function showRunOnMap(run,stateBounds,label){
  if(!mapReady||!run) return;
  clearMapRoutes();
  const gj=routesToGeoJson(run.routes);
  const segCount=gj.features.length;
  map.getSource(routeLayer).setData(gj);
  if(map.getSource(areaLayer)) map.getSource(areaLayer).setData(areasToGeoJson(run.areaContexts));
  if(map.getSource(stateLayer)&&stateBounds) map.getSource(stateLayer).setData(stateBoundsToGeoJson(stateBounds));

  const routeBounds=run.routesBounds||computeRoutesBounds(run.routes);
  if(routeBounds&&segCount>0){
    fitBounds(routeBounds);
  }else if(stateBounds){
    fitBounds(stateBounds);
  }

  const filtered=run.routesFilteredOutOfState?(" · "+run.routesFilteredOutOfState+" out-of-state removed"):"";
  setMapMeta("ready",
    "<strong>"+label+"</strong><br/>"+
    run.routes.length+" routes · "+segCount+" line segments on map"+filtered+"<br/>"+
    "Zoomed to <strong>route extent</strong> (not full state box)<br/>"+
    (run.sourceFilter||"all")+" sources · run "+run.runId.slice(0,8)
  );
  document.getElementById("mapHint").textContent=segCount===0?"No drawable geometry — check source errors above.":"";
  document.getElementById("diagJson").value=JSON.stringify({routesCount:run.routes.length,segmentsOnMap:segCount,routesBounds:routeBounds,filteredOut:run.routesFilteredOutOfState||0,runId:run.runId},null,2);
  activeRunId=run.runId;
  document.getElementById("btnPreviewExport").disabled=!run.runId;
  document.getElementById("btnStageToMain").disabled=!run.runId;
}

async function ensureStateEnabled(code){
  const info=await api(API+"/states/"+code);
  if(!info.enabled){
    await api(API+"/states/"+code+"/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:true})});
  }
  return info;
}

async function previewState(code,opts){
  opts=opts||{};
  if(!code) return;
  activeState=code.toUpperCase();
  document.getElementById("stateFilter").value=activeState;
  document.getElementById("btnReloadRoutes").disabled=false;
  document.getElementById("stateDetailPanel").style.display="block";
  document.getElementById("stateDetailTitle").textContent=activeState+" — route preview";

  if(fetchInFlight){ fetchInFlight.abort(); fetchInFlight=null; hideFetchOverlay(); }

  clearMapRoutes();
  setStatus("loading",'<span class="spinner"></span> Switching to <strong>'+activeState+'</strong>…');
  setMapMeta("loading",'<span class="spinner"></span> Preparing '+activeState+'…');
  await forcePaint();

  let info;
  try{
    info=await ensureStateEnabled(activeState);
  }catch(err){
    hideFetchOverlay();
    setStatus("warn","Failed to load "+activeState+": "+err.message);
    return;
  }

  const stateBbox=info.bounds?.bbox;
  if(stateBbox&&map.getSource(stateLayer)) map.getSource(stateLayer).setData(stateBoundsToGeoJson(stateBbox));

  const cached=info.bestRun||info.latestRun;
  const cachedRoutes=cached?.routes?.length||0;
  const cachedIsFull=cached&&(cached.sourceFilter==="all"||!cached.sourceFilter);

  if(opts.preferCache!==false && cachedRoutes>0 && cachedIsFull){
    showRunOnMap(cached,stateBbox,activeState+" (cached)");
    setStatus("ready","Showing <strong>"+cachedRoutes+"</strong> cached routes for "+activeState+". Click <em>Reload routes</em> to fetch fresh.");
    renderStateDetail(info,cached);
    if(masterData) renderTable(masterData.states);
    return;
  }

  await fetchAllRoutesForState(activeState,info);
}

async function fetchAllRoutesForState(code,info){
  const controller=new AbortController();
  fetchInFlight=controller;
  const stateName=info?.registry?.stateName||code;
  const stateBbox=info?.bounds?.bbox;

  const msg="Querying state + USFS MVUM + BLM GTLF + OSM for "+stateName+". Large states use ~100+ map chunks — typically 2–10 minutes.";
  setStatus("loading",'<span class="spinner"></span> <strong>Fetching all routes for '+stateName+' ('+code+')</strong><br/><span style="font-weight:400;font-size:13px">'+msg+'</span>');
  showFetchOverlay("Fetching "+stateName+" ("+code+")", msg);
  await forcePaint();

  try{
    const res=await fetch(API+"/states/"+code+"/run-dry-run",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({sourceFilter:"all"}),
      signal:controller.signal
    });
    const j=await res.json();
    if(!res.ok||j.ok===false) throw new Error(j.error?.message||"dry_run_failed");
    const run=j.data?.run||j.run;
    hideFetchOverlay();
    showRunOnMap(run,stateBbox,stateName+" (fresh fetch)");
    const filteredNote=run.routesFilteredOutOfState?(" · "+run.routesFilteredOutOfState+" out-of-state routes removed"):"";
    const coverage=run.coverageSummary;
    const coverageNote=coverage?("<br/><span style=\"font-size:12px\">Official state: "+coverage.stateOfficialRoutes+" · Federal: "+coverage.federalRoutes+" · OSM: "+coverage.osmRoutes+"<br/>"+coverage.completenessNote+"</span>"):"";
    setStatus("ready","Fetched <strong>"+run.routes.length+"</strong> routes for "+stateName+" ("+run.chunkCount+" chunks)"+filteredNote+"."+coverageNote);
    renderStateDetail(info,run);
    await loadMaster(false);
  }catch(err){
    hideFetchOverlay();
    if(err.name==="AbortError") return;
    setStatus("warn","Fetch failed for "+code+": "+err.message);
    setMapMeta("empty","Fetch failed — "+err.message);
  }finally{
    fetchInFlight=null;
  }
}

function renderStateDetail(info,run){
  const el=document.getElementById("stateDetail");
  if(!el||!info?.registry) return;
  const setup=masterData?.states?.find(s=>s.stateCode===info.registry.stateCode)?.setup;
  const cards=info.registry.sources.map(s=>{
    const sc=run?.sourceCounts?.find(x=>x.sourceId===s.sourceId);
    const countLine=sc?('raw '+sc.rawFeatures+' · routes '+sc.routesAccepted+(sc.errors?.length?' · <span style="color:#fca5a5">'+sc.errors.join("; ")+'</span>':"")):"not run";
    return '<div class="panel" style="margin:8px 0;padding:8px"><strong>'+s.sourceName+'</strong> '+pill(s.status)+
      '<div class="muted">'+s.sourceId+' · '+countLine+'</div></div>';
  }).join("");
  el.innerHTML=cards+(run?'<p class="muted">Run '+run.runId+' · filter '+(run.sourceFilter||"all")+'</p>'+(run.coverageSummary?'<p style="color:#fcd34d;font-size:13px"><strong>Coverage:</strong> '+run.coverageSummary.completenessNote+'</p>':""):"")+(setup?'<p class="muted">Setup: '+setup.notes+'</p>':"");
}

function collectExportConfigPayload(){
  const payload={...exportConfig};
  document.querySelectorAll("[data-export]").forEach(el=>{ payload[el.dataset.export]=el.checked; });
  payload.minLocavaScore=Number(document.getElementById("exportMinScore")?.value||payload.minLocavaScore||70);
  return payload;
}

async function loadMaster(resetStatus){
  if(resetStatus!==false) setStatus("","Loading registry…");
  masterData=await api(API+"/states");
  document.getElementById("diagJson").value=JSON.stringify(masterData.stateCoverageDiagnostics,null,2);
  renderStats(masterData);
  const filter=document.getElementById("stateFilter");
  const prev=activeState||filter.value;
  filter.innerHTML='<option value="">— pick a state —</option>';
  for(const s of masterData.states){
    const o=document.createElement("option");
    o.value=s.stateCode;
    o.textContent=s.stateCode+" — "+s.stateName;
    filter.appendChild(o);
  }
  if(prev) filter.value=prev;
  renderTable(masterData.states);
  if(resetStatus!==false&&!activeState){
    setStatus("ready","Registry loaded — "+masterData.states.length+" jurisdictions. <strong>Select a state</strong> to preview routes.");
  }
}

document.getElementById("btnRefresh").onclick=()=>loadMaster();
document.getElementById("btnReloadRoutes").onclick=()=>{ if(activeState) previewState(activeState,{preferCache:false}); };
document.getElementById("stateSearch").oninput=()=>{ if(masterData) renderTable(masterData.states); };

document.getElementById("stateFilter").onchange=function(){
  const code=this.value;
  if(code) previewState(code,{preferCache:true});
  else{
    activeState=null;
    document.getElementById("btnReloadRoutes").disabled=true;
    setMapMeta("","No state selected");
    setStatus("ready","Pick a state to preview routes.");
  }
};

document.getElementById("statesTable").onclick=async(e)=>{
  const t=e.target.closest("[data-pick],[data-toggle-state],[data-run],[data-select]");
  if(!t) return;
  if(t.dataset.pick){
    e.preventDefault();
    previewState(t.dataset.pick,{preferCache:true});
    return;
  }
  if(t.dataset.toggleState){
    await api(API+"/states/"+t.dataset.toggleState+"/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:t.checked})});
    return loadMaster(false);
  }
  if(t.dataset.select){if(t.checked) selected.add(t.dataset.select);else selected.delete(t.dataset.select);}
  if(t.dataset.run){
    previewState(t.dataset.run,{preferCache:false});
  }
};

document.getElementById("btnFederalBatch").onclick=async()=>{
  const codes=[...selected];
  if(!codes.length){alert("Check states in the table first");return;}
  setStatus("loading",'<span class="spinner"></span> Batch federal dry run for '+codes.length+" states…");
  const res=await api(API+"/run-batch-dry-run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stateCodes:codes,sourceFilter:"federal",confirmAllStates:codes.length>=50})});
  document.getElementById("diagJson").value=JSON.stringify(res,null,2);
  setStatus("ready","Batch done — "+res.runs.length+" runs");
  loadMaster(false);
};

document.getElementById("btnSaveExportConfig").onclick=async()=>{
  const config=collectExportConfigPayload();
  const res=await api(PIPELINE+"/export-config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(config)});
  renderExportConfigForm(res.config||res);
  setStatus("ready","Export config saved.");
};

document.getElementById("btnPreviewExport").onclick=async()=>{
  if(!activeRunId){ alert("Fetch routes for a state first"); return; }
  const config=collectExportConfigPayload();
  const res=await api(PIPELINE+"/runs/"+activeRunId+"/preview-export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(config)});
  const p=res.preview||res;
  document.getElementById("exportPreview").textContent=JSON.stringify(p.summary,null,2)+"\n\nbySource: "+JSON.stringify(p.summary?.bySource||{});
  setStatus("ready","Export preview: "+(p.summary?.accepted||0)+" / "+(p.summary?.total||0)+" routes would stage.");
};

document.getElementById("btnStageToMain").onclick=async()=>{
  if(!activeRunId){ alert("Fetch routes for a state first"); return; }
  const config=collectExportConfigPayload();
  setStatus("loading","Staging routes to OSM classifier main list…");
  const res=await api(PIPELINE+"/runs/"+activeRunId+"/stage-to-main-lists",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(config)});
  document.getElementById("exportPreview").textContent=JSON.stringify(res,null,2);
  setStatus("ready","Staged <strong>"+res.routesAdded+"</strong> routes (skipped "+res.routesSkipped+"). Classifier run "+res.classifierRunId.slice(0,8)+" now has "+res.acceptedRoutesTotal+" routes. <a href=\"/admin/openstreetmap\">Open classifier</a>");
};

initMap();
Promise.all([loadMaster(),loadPipelineConfig()]).then(()=>{
  if(INITIAL_STATE) previewState(INITIAL_STATE,{preferCache:true});
}).catch(err=>setStatus("warn","Error: "+err.message));
</script>
</body>
</html>`;
}
