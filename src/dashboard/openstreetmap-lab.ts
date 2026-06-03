/**
 * OSM Locava Classifier admin — /admin/openstreetmap
 */
export function renderOpenStreetMapLabPage(): string {
  const defaults = {
    label: "Hartland, Vermont",
    regionKey: "hartland_vt_mvp",
    centerLat: 43.54063,
    centerLng: -72.39898,
    defaultRadiusKm: 12,
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
  <title>OSM Locava Classifier v3</title>
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
    .emoji-marker{font-size:20px;line-height:1;cursor:pointer;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
    .emoji-marker.route{font-size:16px;opacity:.95}
    .map-popup{font-size:12px;line-height:1.45;max-width:280px}
    .map-popup strong{font-size:13px}
    .map-popup .muted{color:#64748b;font-size:11px}
    .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase}
    .stat-value{font-size:18px;font-weight:700;margin-top:4px}
    .page-tabs{display:flex;gap:8px;margin:12px 0}
    .page-tab{padding:8px 14px;border-radius:8px;border:1px solid #334155;background:#1f2937;color:#cbd5e1;font-size:13px;font-weight:600;cursor:pointer}
    .page-tab.active{background:#2563eb;border-color:#2563eb;color:#fff}
    .media-badge{display:inline-block;padding:2px 7px;border-radius:6px;font-size:10px;margin:2px 4px 2px 0;border:1px solid #334155;background:#0b1220;color:#cbd5e1}
    .media-badge.preview{border-color:#166534;color:#86efac}
    .media-card{border:1px solid #334155;border-radius:10px;background:#0b1220;padding:10px 12px;margin:8px 0}
    .media-card-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;cursor:pointer}
    .media-card-body{margin-top:10px;border-top:1px solid #334155;padding-top:10px}
    .media-ref{border:1px solid #1f2937;border-radius:8px;padding:8px;margin:8px 0;background:#020617}
    .media-preview{max-width:220px;max-height:160px;border-radius:8px;border:1px solid #334155;background:#111827}
    .media-preview.broken{display:none}
    .media-preview-fallback{font-size:11px;color:#fca5a5}
    #mediaDiagnosticsJson{width:100%;min-height:200px;font-family:ui-monospace,Menlo,monospace;font-size:11px}
  </style>
</head>
<body>
<div class="shell">
  <p><a href="/admin">← Admin</a></p>
  <h1>OSM Locava Classifier v3 — Final Polish</h1>
  <p class="muted">OSM spots/trails + live VTrans Class 4 / Legal Trails (VT) + NHDOT Class VI (NH). Read-only.</p>
  <div id="statusBar" class="status-bar">Run classifier to begin.</div>

  <p class="muted"><a href="/admin/openstreetmap/offroad-master">National Offroad Sources</a> — USFS / BLM / OSM nationwide dry-run control panel · <a href="/admin/openstreetmap/vermont-offroad-import"><strong>Vermont Off-Road → Undiscovered Posts</strong></a> — bulk import all VT trails as unexplored routes</p>
  <div class="page-tabs">
    <button type="button" id="pageTabClassifier" class="page-tab active">Classifier &amp; Search</button>
    <button type="button" id="pageTabMedia" class="page-tab">Existing Media</button>
  </div>

  <div id="classifierPage">
  <section class="panel">
    <h2>Map</h2>
    <div class="row">
      <button type="button" id="btnFitRegion" class="secondary">Fit bbox</button>
      <button type="button" id="btnClearMap" class="ghost">Clear highlights</button>
      <button type="button" id="btnShowAllOffroad" class="secondary">Show all Class 4 / Legal / Class 6</button>
      <label><input type="checkbox" id="showOffroadOverlay" checked/> Auto-show offroad trails on map</label>
      <label><input type="checkbox" id="fullCoverageMode"/> Full coverage mode (all spots + routes)</label>
      <span id="mapMeta" class="muted"></span>
    </div>
    <div class="map-shell"><div id="osmMap" style="width:100%;height:100%"></div></div>
    <div id="mapSidebar"></div>
  </section>

  <section class="panel">
    <h2>Region + State Offroad (VT Class 4 / Legal · NH Class 6)</h2>
    <p class="muted">Center + radius define the bbox. VT roads from <strong>PublicHighwaySystem/MapServer/6</strong>; NH Class VI from <strong>NHDOT Legislative Class Groups/MapServer/5</strong>. All offroad routes labeled <strong>Unmaintained road</strong>. Change center/radius, then click <strong>Refetch region</strong>.</p>
    <div class="row">
      <label>Center lat<input id="centerLat" type="number" step="0.00001" value="${defaults.centerLat}"/></label>
      <label>Center lng<input id="centerLng" type="number" step="0.00001" value="${defaults.centerLng}"/></label>
      <label>Radius km<input id="radiusKm" type="number" step="1" min="2" max="80" value="${defaults.defaultRadiusKm}"/></label>
      <button type="button" id="btnApplyRegion" class="secondary">Preview bbox on map</button>
      <button type="button" id="btnRefetchRegion">Refetch region</button>
    </div>
    <div class="row">
      <label>Offroad source<select id="offroadSource"><option value="osm_vtrans" selected>OSM + state roads (recommended)</option><option value="vtrans">VTrans only (VT)</option><option value="osm">OSM only</option></select></label>
      <label><input id="includeClass4" type="checkbox" checked/> Class 4 town highways (VT)</label>
      <label><input id="includeLegalTrails" type="checkbox" checked/> Legal trails / AOTCLASS 7 (VT)</label>
      <label><input id="includeClass6" type="checkbox" checked/> Class 6 town highways (NH)</label>
    </div>
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
      <button type="button" class="tab preset" data-preset="swimming_beaches">Swimming / Beaches</button>
      <button type="button" class="tab preset" data-preset="weak_names">Weak Names</button>
      <button type="button" class="tab preset" data-preset="anchored_parents">Anchored Parents</button>
      <button type="button" class="tab preset" data-preset="name_only_rejections">Name-only Rejections</button>
      <button type="button" class="tab preset" data-preset="private_rejections">Private Rejections</button>
      <button type="button" class="tab preset" data-preset="viewpoints_waterfalls">Viewpoints / Waterfalls</button>
      <button type="button" class="tab preset" data-preset="offroading">Offroading</button>
      <button type="button" class="tab preset" data-preset="offroad_class4">Class 4 / IV</button>
      <button type="button" class="tab preset" data-preset="offroad_legal_trail">Legal Trails</button>
      <button type="button" class="tab preset" data-preset="offroad_class6">Class 6 / VI</button>
      <button type="button" class="tab preset" data-preset="offroad_candidates">Offroad Candidates</button>
      <button type="button" class="tab preset" data-preset="missing_parking">Missing Parking</button>
      <button type="button" class="tab preset" data-preset="parent_places">Parent Places</button>
      <button type="button" class="tab preset" data-preset="activity_qa">Activity QA</button>
      <button type="button" class="tab preset" data-preset="weak_activity">Weak Activity</button>
      <button type="button" class="tab preset" data-preset="niche_ready">Weird/Niche Ready</button>
      <button type="button" class="tab preset" data-preset="bad_titles">Bad Titles</button>
      <button type="button" class="tab preset" data-preset="generated_titles">Generated Titles</button>
      <button type="button" class="tab preset" data-preset="natural_feature_fixes">Natural Feature Fixes</button>
      <button type="button" class="tab preset" data-preset="ready_low_confidence">Ready Low Confidence</button>
      <button type="button" class="tab preset" data-preset="hidden_niche">Hidden Niche</button>
      <button type="button" class="tab preset" data-preset="search_alias_preview">Search Alias Preview</button>
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
          <th>Decision</th><th>Kind</th><th>Name</th><th>Subtitle</th><th>Primary</th><th>Activities</th>
          <th>Title Q</th><th>Act Conf</th><th>Ready</th><th>Parent</th><th>Score</th><th>Reason</th><th></th>
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

  <div id="mediaPage" style="display:none">
    <section class="panel">
      <h2>Existing Media</h2>
      <p class="muted">Inspect OSM image/Commons/Wikidata/Wikipedia/Mapillary tags on classified spots and routes. Uses the latest in-memory classification run — no refetch, no external API calls.</p>
      <div class="row">
        <button type="button" id="btnLoadMedia" class="secondary">Refresh media catalog</button>
        <button type="button" id="btnCopyAllMediaJson" class="ghost">Copy all media diagnostics JSON</button>
      </div>
      <div id="mediaSummaryGrid" class="summary-grid"></div>
      <div class="row" style="margin-top:12px">
        <label>Filter
          <select id="mediaFilter">
            <option value="all">All</option>
            <option value="accepted_spot">Accepted spots</option>
            <option value="accepted_route">Accepted routes</option>
            <option value="rejected">Rejected</option>
            <option value="has_media">Has any media</option>
            <option value="previewable">Previewable image</option>
            <option value="commons_file">Commons file</option>
            <option value="commons_category">Commons category</option>
            <option value="wikidata">Wikidata clue</option>
            <option value="wikipedia">Wikipedia clue</option>
            <option value="mapillary">Mapillary clue</option>
            <option value="website">Website clue</option>
            <option value="no_media">No media</option>
          </select>
        </label>
        <label style="flex:1;min-width:200px">Search
          <input id="mediaSearch" type="text" placeholder="Name, category, sourceKey, tag key, media value…"/>
        </label>
        <button type="button" id="btnMediaSearch" class="secondary">Search</button>
      </div>
      <p id="mediaMeta" class="muted"></p>
      <div id="mediaResults"></div>
    </section>
    <section class="panel">
      <h2>Copy/Paste Media Diagnostics JSON</h2>
      <div class="row"><button type="button" id="btnCopyMediaJson" class="secondary">Copy JSON</button></div>
      <textarea id="mediaDiagnosticsJson" readonly></textarea>
    </section>
  </div>
</div>

<script>
const DEFAULT_VIEWPORT = ${JSON.stringify(defaults)};
const OSM_STYLE = { version:8, sources:{ osm:{ type:"raster", tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize:256 }}, layers:[{id:"osm",type:"raster",source:"osm"}]};
let map=null, runId=null, markers=[], activeViewport=viewportFromForm(), lastAcceptedRoutes=[], lastAcceptedSpots=[], lastMapMetaBase="";

function viewportFromForm(){
  var lat=parseFloat(document.getElementById("centerLat").value);
  var lng=parseFloat(document.getElementById("centerLng").value);
  var radiusKm=parseFloat(document.getElementById("radiusKm").value);
  if(!Number.isFinite(lat)) lat=DEFAULT_VIEWPORT.centerLat;
  if(!Number.isFinite(lng)) lng=DEFAULT_VIEWPORT.centerLng;
  if(!Number.isFinite(radiusKm)) radiusKm=DEFAULT_VIEWPORT.defaultRadiusKm;
  radiusKm=Math.min(80, Math.max(2, radiusKm));
  var latDelta=radiusKm/111.32;
  var lngDelta=radiusKm/(111.32*Math.cos(lat*Math.PI/180));
  return {
    centerLat: lat, centerLng: lng, radiusKm: radiusKm,
    minLat: lat-latDelta, maxLat: lat+latDelta,
    minLng: lng-lngDelta, maxLng: lng+lngDelta
  };
}

function classifierParams(){
  var incClass4=document.getElementById("includeClass4").checked;
  var incLegal=document.getElementById("includeLegalTrails").checked;
  var incClass6=document.getElementById("includeClass6").checked;
  return {
    mode:"classify",
    source:document.getElementById("source").value,
    foodMode:document.getElementById("foodMode").value,
    trailMode:document.getElementById("trailMode").value,
    natureMode:document.getElementById("natureMode").value,
    centerLat: activeViewport.centerLat,
    centerLng: activeViewport.centerLng,
    radiusKm: activeViewport.radiusKm,
    offroadSource: document.getElementById("offroadSource").value,
    includeClass4: incClass4 ? "true" : "false",
    includeLegalTrails: incLegal ? "true" : "false",
    includeClass6: incClass6 ? "true" : "false"
  };
}

function updateMapBbox(viewport){
  if(!map || !map.isStyleLoaded()) return;
  var b=viewport;
  var geo={ type:"Feature", properties:{}, geometry:{ type:"Polygon", coordinates:[[[b.minLng,b.minLat],[b.maxLng,b.minLat],[b.maxLng,b.maxLat],[b.minLng,b.maxLat],[b.minLng,b.minLat]]] }};
  if(map.getSource("bbox")) map.getSource("bbox").setData(geo);
  map.fitBounds([[b.minLng,b.minLat],[b.maxLng,b.maxLat]],{padding:32});
}

function esc(s){ return String(s!=null?s:"").replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
function qs(params){ return new URLSearchParams(Object.entries(params).filter(function(e){ return e[1]!=null && e[1]!=="" && e[1]!==false; }).map(function(e){ return [e[0], String(e[1])]; })).toString(); }

async function api(path){ const r=await fetch(path); const j=await r.json(); if(!j.ok) throw new Error((j.error&&j.error.message)||"failed"); return j.data; }

function initMap(){
  if(map) map.remove();
  activeViewport=viewportFromForm();
  map=new maplibregl.Map({ container:"osmMap", style:OSM_STYLE, center:[activeViewport.centerLng,activeViewport.centerLat], zoom:11 });
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-right");
  map.on("load", function(){
    var b=activeViewport;
    map.addSource("bbox",{ type:"geojson", data:{ type:"Feature", properties:{}, geometry:{ type:"Polygon", coordinates:[[[b.minLng,b.minLat],[b.maxLng,b.minLat],[b.maxLng,b.maxLat],[b.minLng,b.maxLat],[b.minLng,b.minLat]]] }}});
    map.addLayer({ id:"bbox-line", type:"line", source:"bbox", paint:{ "line-color":"#f59e0b", "line-width":2, "line-dasharray":[2,2] }});
    map.fitBounds([[b.minLng,b.minLat],[b.maxLng,b.maxLat]],{padding:32});
    if(lastAcceptedRoutes.length && document.getElementById("showOffroadOverlay").checked){
      drawAllOffroadOnMap(lastAcceptedRoutes);
    }
    if(document.getElementById("fullCoverageMode").checked && (lastAcceptedSpots.length || lastAcceptedRoutes.length)){
      drawFullCoverageOnMap(lastAcceptedSpots, lastAcceptedRoutes);
    }
  });
}

function activityEmoji(activity){
  var a=String(activity||"").toLowerCase();
  if(a.indexOf("offroad")>=0 || a.indexOf("class6")>=0 || a.indexOf("unmaintained")>=0) return "🛻";
  if(a.indexOf("hik")>=0 || a.indexOf("walk")>=0) return "🥾";
  if(a.indexOf("bike")>=0 || a.indexOf("cycl")>=0) return "🚴";
  if(a.indexOf("swim")>=0 || a.indexOf("beach")>=0) return "🏊";
  if(a.indexOf("view")>=0 || a.indexOf("lookout")>=0) return "👀";
  if(a.indexOf("waterfall")>=0) return "💧";
  if(a.indexOf("ski")>=0 || a.indexOf("snow")>=0) return "⛷";
  if(a.indexOf("food")>=0 || a.indexOf("restaurant")>=0 || a.indexOf("cafe")>=0) return "🍽";
  if(a.indexOf("camp")>=0) return "⛺";
  if(a.indexOf("fish")>=0) return "🎣";
  if(a.indexOf("climb")>=0) return "🧗";
  if(a.indexOf("kayak")>=0 || a.indexOf("paddle")>=0 || a.indexOf("boat")>=0) return "🛶";
  if(a.indexOf("nature")>=0 || a.indexOf("forest")>=0 || a.indexOf("park")>=0) return "🌲";
  return "📍";
}

function buildItemPopupHtml(item, kind){
  var acts=(item.activities||[]).slice(0,6).join(", ");
  var html='<div class="map-popup"><strong>'+esc(item.name||item.displayName||"Unnamed")+'</strong>';
  if(item.subtitle) html+='<br/><span class="muted">'+esc(item.subtitle)+'</span>';
  html+='<br/>'+esc(kind)+' · '+esc(item.primaryActivity||item.activity||item.category||"");
  if(acts) html+='<br/>Activities: '+esc(acts);
  if(item.titleQuality) html+='<br/>Title: '+esc(item.titleQuality);
  if(item.mapReadiness) html+='<br/>Map readiness: '+esc(item.mapReadiness);
  if(item.parentPlaceName) html+='<br/>Parent: '+esc(item.parentPlaceName);
  if(item.distanceMiles!=null) html+='<br/>Distance: '+item.distanceMiles+' mi';
  if(item.offroad&&item.offroad.legalDisplayLabel) html+='<br/>'+esc(item.offroad.legalDisplayLabel);
  if(item.offroad&&item.offroad.offroadCategory) html+='<br/>Offroad: '+esc(item.offroad.offroadCategory);
  if(item.locavaScore!=null) html+='<br/>Score: '+esc(item.locavaScore);
  if(item.confidence) html+='<br/>Confidence: '+esc(item.confidence);
  if(item.sourceKey) html+='<br/><span class="muted">'+esc(item.sourceKey)+'</span>';
  html+='</div>';
  return html;
}

function clearFullCoverageOverlay(){
  if(!map) return;
  ["fullcov-routes","fullcov-route-lines"].forEach(function(id){
    if(map.getLayer(id)) map.removeLayer(id);
    if(map.getSource(id)) map.removeSource(id);
  });
  markers=markers.filter(function(m){
    if(m._fullcov){ m.remove(); return false; }
    return true;
  });
}

function inventoryRouteLineFeatures(route){
  var segs=route.segments && route.segments.length ? route.segments : (route.coordinates ? [route.coordinates] : []);
  var out=[];
  segs.forEach(function(seg){
    if(!seg || seg.length<2) return;
    out.push({ type:"Feature", properties:{ name:route.name, sourceKey:route.sourceKey }, geometry:{ type:"LineString", coordinates: seg.map(function(c){ return [c.lng,c.lat]; }) } });
  });
  return out;
}

function drawFullCoverageOnMap(spots, routes){
  if(!map || !map.isStyleLoaded()) return;
  clearFullCoverageOverlay();
  var lineFeatures=[];
  (routes||[]).forEach(function(route){
    inventoryRouteLineFeatures(route).forEach(function(f){ lineFeatures.push(f); });
    var center=route.center;
    if(!center && route.coordinates && route.coordinates.length){
      var mid=route.coordinates[Math.floor(route.coordinates.length/2)];
      center=mid;
    }
    if(center){
      var emoji=activityEmoji(route.primaryActivity||route.activity);
      var el=document.createElement("div");
      el.className="emoji-marker route";
      el.textContent=emoji;
      var m=new maplibregl.Marker({ element: el, anchor:"center" })
        .setLngLat([center.lng,center.lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(buildItemPopupHtml(route, "route")))
        .addTo(map);
      m._fullcov=true;
      markers.push(m);
    }
  });
  if(lineFeatures.length){
    map.addSource("fullcov-route-lines",{ type:"geojson", data:{ type:"FeatureCollection", features:lineFeatures } });
    map.addLayer({ id:"fullcov-route-lines", type:"line", source:"fullcov-route-lines", paint:{ "line-color":"#38bdf8", "line-width":2, "line-opacity":0.45 } });
  }
  (spots||[]).forEach(function(spot){
    var lat=spot.lat, lng=spot.lng;
    if(lat==null || lng==null) return;
    var emoji=activityEmoji(spot.primaryActivity||spot.activity||spot.category);
    var el=document.createElement("div");
    el.className="emoji-marker";
    el.textContent=emoji;
    var m=new maplibregl.Marker({ element: el, anchor:"center" })
      .setLngLat([lng,lat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(buildItemPopupHtml(spot, "spot")))
      .addTo(map);
    m._fullcov=true;
    markers.push(m);
  });
  updateMapMetaOverlay({ class4:0, legal:0, class6:0, offroadTotal:0, fullcovSpots:(spots||[]).length, fullcovRoutes:(routes||[]).length });
}

function scheduleFullCoverageDraw(spots, routes){
  if(!map) return;
  if(map.isStyleLoaded()) drawFullCoverageOnMap(spots, routes);
  else map.once("load", function(){ drawFullCoverageOnMap(spots, routes); });
}

function clearOffroadOverlay(){
  ["offroad-all-class4","offroad-all-legal","offroad-all-class6","offroad-all-other"].forEach(function(id){
    if(map && map.getLayer(id)) map.removeLayer(id);
  });
  ["offroad-all-class4","offroad-all-legal","offroad-all-class6","offroad-all-other"].forEach(function(id){
    if(map && map.getSource(id)) map.removeSource(id);
  });
  markers=markers.filter(function(m){ if(m._offroad){ m.remove(); return false; } return true; });
}

function routeLineFeatures(route){
  var segs=route.segments && route.segments.length ? route.segments : (route.coordinates ? [route.coordinates] : []);
  var cat=(route.offroad&&route.offroad.offroadCategory)||"class4_road";
  var out=[];
  segs.forEach(function(seg){
    if(!seg || seg.length<2) return;
    out.push({ type:"Feature", properties:{ name:route.name, category:cat, sourceKey:route.sourceKey }, geometry:{ type:"LineString", coordinates: seg.map(function(c){ return [c.lng,c.lat]; }) } });
  });
  return out;
}

function isVtransOrOffroadRoute(route){
  return route.activity==="offroading" || route.source==="vtrans_public_highway_system" || route.source==="nhdot_legislative_class" || (route.offroad&&route.offroad.offroadCategory);
}

function updateMapMetaOverlay(stats){
  var parts=[lastMapMetaBase];
  if(stats.class4 || stats.legal || stats.class6) parts.push("map: "+stats.class4+" class4 · "+stats.legal+" legal · "+stats.class6+" class6 lines");
  if(stats.offroadTotal) parts.push(stats.offroadTotal+" offroad routes");
  if(stats.fullcovSpots || stats.fullcovRoutes) parts.push("full cov: "+stats.fullcovSpots+" spots · "+stats.fullcovRoutes+" routes");
  document.getElementById("mapMeta").textContent=parts.filter(Boolean).join(" · ");
}

function scheduleOffroadOverlayDraw(routes){
  if(!map) return;
  if(map.isStyleLoaded()) drawAllOffroadOnMap(routes);
  else map.once("load", function(){ drawAllOffroadOnMap(routes); });
}

function drawAllOffroadOnMap(routes){
  if(!map || !map.isStyleLoaded()) return;
  clearOffroadOverlay();
  var class4=[], legal=[], class6=[], other=[];
  (routes||[]).filter(isVtransOrOffroadRoute).forEach(function(route){
    routeLineFeatures(route).forEach(function(f){
      if(f.properties.category==="legal_trail") legal.push(f);
      else if(f.properties.category==="class4_road") class4.push(f);
      else if(f.properties.category==="class6_road") class6.push(f);
      else other.push(f);
    });
    if(route.center){
      var cat=(route.offroad&&route.offroad.offroadCategory)||"class4_road";
      var color=cat==="legal_trail"?"#a855f7":cat==="class6_road"?"#22d3ee":"#f97316";
      var m=new maplibregl.Marker({color:color,scale:0.55}).setLngLat([route.center.lng,route.center.lat]).setPopup(new maplibregl.Popup().setHTML("<strong>"+esc(route.name)+"</strong><br/>"+esc(route.offroad&&route.offroad.legalDisplayLabel||"")+"<br/>"+esc(route.offroad&&route.offroad.offroadCategory||"")+"<br/>"+(route.distanceMiles!=null?route.distanceMiles+" mi":""))).addTo(map);
      m._offroad=true; markers.push(m);
    }
  });
  function addLayer(id, color, features, width){
    if(!features.length) return;
    map.addSource(id,{ type:"geojson", data:{ type:"FeatureCollection", features:features } });
    map.addLayer({ id:id, type:"line", source:id, paint:{ "line-color":color, "line-width":width, "line-opacity":0.85 } });
  }
  addLayer("offroad-all-class4","#f97316",class4,4);
  addLayer("offroad-all-legal","#a855f7",legal,4);
  addLayer("offroad-all-class6","#22d3ee",class6,4);
  addLayer("offroad-all-other","#fb923c",other,3);
  updateMapMetaOverlay({ class4:class4.length, legal:legal.length, class6:class6.length, offroadTotal:(routes||[]).filter(isVtransOrOffroadRoute).length, fullcovSpots: document.getElementById("fullCoverageMode").checked ? lastAcceptedSpots.length : 0, fullcovRoutes: document.getElementById("fullCoverageMode").checked ? lastAcceptedRoutes.length : 0 });
}

function clearSelectionLayers(){
  if(!map) return;
  markers=markers.filter(function(m){
    if(m._offroad || m._fullcov) return true;
    m.remove();
    return false;
  });
  ["sel-route","sel-route-faint","sel-seg-"].forEach(function(prefix){
    for(var i=0;i<20;i++){ var id=prefix+i; if(map.getLayer(id)) map.removeLayer(id); if(map.getSource(id)) map.removeSource(id); }
  });
  if(map.getLayer("sel-route")) map.removeLayer("sel-route");
  if(map.getSource("sel-route")) map.removeSource("sel-route");
  if(map.getLayer("sel-route-faint")) map.removeLayer("sel-route-faint");
  if(map.getSource("sel-route-faint")) map.removeSource("sel-route-faint");
  document.getElementById("mapSidebar").textContent="";
}

function clearMapLayers(){
  clearSelectionLayers();
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
  clearSelectionLayers();
  var gp=row.geometryPreview||{};
  var sidebar=document.getElementById("mapSidebar");
  if(row.kind==="route" && (gp.type==="line"||gp.type==="multiline")){
    var allCoords=[];
    if(gp.segments){ gp.segments.forEach(function(seg,i){ var col=row.offroadCategory==="legal_trail"?"#a855f7":"#f97316"; drawLine("sel-seg-"+i, seg, col, 5); allCoords=allCoords.concat(seg); }); }
    else if(gp.coordinates){ var col=row.activity==="offroading"?"#f97316":"#22c55e"; drawLine("sel-route", gp.coordinates, col, 5); allCoords=gp.coordinates; }
    fitCoords(allCoords);
    if(allCoords.length){ markers.push(new maplibregl.Marker({color:"#16a34a"}).setLngLat([allCoords[0].lng,allCoords[0].lat]).addTo(map)); markers.push(new maplibregl.Marker({color:"#dc2626"}).setLngLat([allCoords[allCoords.length-1].lng,allCoords[allCoords.length-1].lat]).addTo(map)); }
    sidebar.innerHTML="<strong>"+esc(row.name)+"</strong> · "+esc(row.activity||"")+" · "+(row.distanceMiles!=null?row.distanceMiles+" mi":"—")+" · "+(row.pointCount||"")+" pts · "+esc(row.reason||row.rejectionReason||"");
    if(row.activity==="offroading"){
      sidebar.innerHTML+="<br/><span style='color:#fca5a5'>Verify local access, seasonal closures, signage, and vehicle rules before driving.</span>";
      if(row.legalDisplayLabel) sidebar.innerHTML+="<br/>Label: "+esc(row.legalDisplayLabel);
    }
    if(row.selectedParking){ markers.push(new maplibregl.Marker({color:"#eab308",scale:0.8}).setLngLat([row.selectedParking.lng,row.selectedParking.lat]).addTo(map)); }
    if(row.selectedTrailhead){ markers.push(new maplibregl.Marker({color:"#a855f7",scale:0.8}).setLngLat([row.selectedTrailhead.lng,row.selectedTrailhead.lat]).addTo(map)); }
  } else if(gp.type==="line" && row.decision==="rejected"){
    drawLine("sel-route-faint", gp.coordinates, "#94a3b8", 2, [2,2]);
    fitCoords(gp.coordinates);
    sidebar.textContent="Rejected: "+(row.rejectionReason||"");
  } else if(row.lat!=null && row.lng!=null){
    markers.push(new maplibregl.Marker({color: row.decision==="accepted"?"#2563eb":"#dc2626"}).setLngLat([row.lng,row.lat]).setPopup(new maplibregl.Popup().setHTML("<strong>"+esc(row.displayName||row.name)+"</strong><br/>"+esc(row.category||row.activity||"")+"<br/>"+esc(row.reason||row.rejectionReason||""))).addTo(map));
    if(row.areaCenter && (row.areaCenter.lat!==row.lat || row.areaCenter.lng!==row.lng)){
      markers.push(new maplibregl.Marker({color:"#64748b",scale:0.7}).setLngLat([row.areaCenter.lng,row.areaCenter.lat]).addTo(map));
    }
    if(row.childHighlights){
      row.childHighlights.forEach(function(ch){
        markers.push(new maplibregl.Marker({color:"#f59e0b",scale:0.6}).setLngLat([ch.lng,ch.lat]).addTo(map));
      });
    }
    map.flyTo({center:[row.lng,row.lat],zoom:Math.max(map.getZoom(),14)});
    sidebar.textContent=(row.decision||"")+" "+(row.kind||"")+": "+(row.reason||row.rejectionReason||"");
  }
}

function renderSummary(d){
  var g=document.getElementById("summaryGrid"); g.innerHTML="";
  var audit=d.filterAudit||{};
  var off=d.offroadDiagnostics||{};
  var at=d.activityTitleDiagnostics||{};
  var items=[["Raw",d.run.rawObjects],["Spots",d.run.acceptedSpots],["Routes",d.run.acceptedRoutes],["Rejected",d.run.rejected],["Ready",at.readyItems],["Review",at.reviewItems],["Hidden",at.hiddenItems],["Primary act",at.itemsWithPrimaryActivity],["Filter",audit.verdict||"—"]];
  items.forEach(function(x){
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
    var tags=Object.entries(row.topTags||{}).slice(0,2).map(function(e){return e[0]+"="+e[1];}).join(", ");
    var acts=(row.activities||[]).slice(0,4).join(", ");
    tr.innerHTML=
      '<td class="decision-'+esc(row.decision)+'">'+esc(row.decision)+'</td>'+
      '<td>'+esc(row.kind)+'</td>'+
      '<td>'+esc(row.displayName||row.name)+'</td>'+
      '<td class="muted">'+esc(row.subtitle||"")+'</td>'+
      '<td>'+esc(row.primaryActivity||row.activity||row.category||"")+'</td>'+
      '<td class="muted">'+esc(acts)+'</td>'+
      '<td>'+esc(row.titleQuality||"")+'</td>'+
      '<td>'+esc(row.activityConfidence||"")+'</td>'+
      '<td>'+esc(row.mapReadiness||"")+'</td>'+
      '<td>'+esc(row.parentPlaceName||"")+'</td>'+
      '<td>'+esc(row.locavaScore)+'</td>'+
      '<td>'+esc(row.reason||row.rejectionReason)+'</td>'+
      '<td><button type="button" class="small view-map">Map</button></td>';
    tr.querySelector(".view-map").addEventListener("click", function(e){ e.stopPropagation(); showOnMap(row); });
    tr.addEventListener("click", function(){ showOnMap(row); });
    tbody.appendChild(tr);
  });
}

function searchParams(extra){
  var params={
    runId: runId,
    q: document.getElementById("searchInput").value.trim(),
    decision: document.getElementById("filterDecision").value,
    kind: document.getElementById("filterKind").value,
    onlyTrails: document.getElementById("onlyTrails").checked,
    onlyFood: document.getElementById("onlyFood").checked,
    onlyNature: document.getElementById("onlyNature").checked,
    onlySuspicious: document.getElementById("onlySuspicious").checked,
    limit: 300
  };
  if(extra){ for(var k in extra){ if(Object.prototype.hasOwnProperty.call(extra,k)) params[k]=extra[k]; } }
  return params;
}

async function doSearch(extra){
  var data=await api("/admin/openstreetmap/api/search?"+qs(searchParams(extra||{})));
  renderResults(data);
}

async function runClassifier(){
  document.getElementById("statusBar").className="status-bar running";
  document.getElementById("statusBar").textContent="Fetching + classifying…";
  activeViewport=viewportFromForm();
  updateMapBbox(activeViewport);
  try{
    var data=await api("/admin/openstreetmap/api/hartland/features?"+qs(classifierParams()));
    runId=data.result.runId;
    if(data.result.bbox){
      activeViewport=Object.assign({}, activeViewport, data.result.bbox, { centerLat:data.result.center.lat, centerLng:data.result.center.lng });
      updateMapBbox(activeViewport);
    }
    lastAcceptedRoutes=data.result.acceptedRoutes||[];
    lastAcceptedSpots=data.result.acceptedSpots||[];
    document.getElementById("diagnosticsJson").value=data.result.diagnosticsJson||"";
    var off=data.result.diagnostics&&data.result.diagnostics.offroadDiagnostics||{};
    var vt=off.vtrans||{};
    var nh=vt.nh||{};
    var vtransCount=off.vtransOffroadRouteCount!=null?off.vtransOffroadRouteCount:((vt.acceptedClass4)||0)+((vt.acceptedLegalTrails)||0);
    lastMapMetaBase=data.result.rawObjects+" raw · "+lastAcceptedSpots.length+" spots · "+lastAcceptedRoutes.length+" routes · "+(off.acceptedOffroadRoutes||0)+" offroad · "+vtransCount+" VT · "+(nh.acceptedClass6||0)+" NH Class 6";
    document.getElementById("mapMeta").textContent=lastMapMetaBase;
    renderSummary(data.result.diagnostics);
    if(document.getElementById("showOffroadOverlay").checked){
      scheduleOffroadOverlayDraw(lastAcceptedRoutes);
    }
    if(document.getElementById("fullCoverageMode").checked){
      scheduleFullCoverageDraw(lastAcceptedSpots, lastAcceptedRoutes);
    }
    document.getElementById("statusBar").className="status-bar success";
    document.getElementById("statusBar").textContent="Done — "+((vt.acceptedClass4)||0)+" VT Class 4 · "+((vt.acceptedLegalTrails)||0)+" VT legal trails · "+(nh.acceptedClass6||0)+" NH Class 6 · filter: "+((data.result.diagnostics&&data.result.diagnostics.filterAudit&&data.result.diagnostics.filterAudit.verdict)||"?");
    await doSearch();
    if(document.getElementById("mediaPage").style.display!=="none") void loadExistingMedia();
  }catch(e){
    document.getElementById("statusBar").className="status-bar error";
    document.getElementById("statusBar").textContent="Error: "+e.message;
  }
}

document.getElementById("btnRun").addEventListener("click", runClassifier);
document.getElementById("btnRefetchRegion").addEventListener("click", runClassifier);
document.getElementById("btnSearch").addEventListener("click", function(){ doSearch(); });
document.getElementById("searchInput").addEventListener("input", function(){ doSearch(); });
document.getElementById("filterDecision").addEventListener("change", function(){ doSearch(); });
document.getElementById("filterKind").addEventListener("change", function(){ doSearch(); });
["onlyTrails","onlyFood","onlyNature","onlySuspicious"].forEach(function(id){ document.getElementById(id).addEventListener("change", function(){ doSearch(); }); });
document.querySelectorAll(".preset").forEach(function(btn){
  btn.addEventListener("click", function(){ doSearch({ preset: btn.getAttribute("data-preset") }); });
});
document.getElementById("btnApplyRegion").addEventListener("click", function(){
  activeViewport=viewportFromForm();
  updateMapBbox(activeViewport);
});
document.getElementById("btnFitRegion").addEventListener("click", function(){
  activeViewport=viewportFromForm();
  updateMapBbox(activeViewport);
});
document.getElementById("btnClearMap").addEventListener("click", clearMapLayers);
document.getElementById("btnShowAllOffroad").addEventListener("click", function(){ scheduleOffroadOverlayDraw(lastAcceptedRoutes); });
document.getElementById("showOffroadOverlay").addEventListener("change", function(){
  if(document.getElementById("showOffroadOverlay").checked && lastAcceptedRoutes.length) scheduleOffroadOverlayDraw(lastAcceptedRoutes);
  else clearOffroadOverlay();
});
document.getElementById("fullCoverageMode").addEventListener("change", function(){
  if(document.getElementById("fullCoverageMode").checked && (lastAcceptedSpots.length || lastAcceptedRoutes.length)) scheduleFullCoverageDraw(lastAcceptedSpots, lastAcceptedRoutes);
  else clearFullCoverageOverlay();
});
document.getElementById("btnCopyJson").addEventListener("click", function(){ document.getElementById("diagnosticsJson").select(); document.execCommand("copy"); });

var mediaCatalogCache=[], mediaDiagnosticsCache=null;

function mediaBadgeClass(kind){ return (kind==="direct_image"||kind==="commons_file")?"media-badge preview":"media-badge"; }
function mediaBadgeLabel(kind){
  var L={direct_image:"direct image",commons_file:"commons file",commons_category:"commons category",wikidata:"wikidata",wikipedia:"wikipedia",mapillary:"mapillary",website:"website",generic_media_url:"media url",unknown_media_tag:"unknown"};
  return L[kind]||kind;
}

function buildMediaSearchParams(){
  var filter=document.getElementById("mediaFilter").value;
  var q=document.getElementById("mediaSearch").value.trim();
  var params=new URLSearchParams();
  params.set("limit","200");
  params.set("includeRejected","true");
  if(runId) params.set("runId", runId);
  if(q) params.set("q", q);
  if(filter==="accepted_spot"){ params.set("decision","accepted"); params.set("kind","spot"); }
  else if(filter==="accepted_route"){ params.set("decision","accepted"); params.set("kind","route"); }
  else if(filter==="rejected") params.set("decision","rejected");
  else if(filter==="has_media") params.set("hasMediaRef","true");
  else if(filter==="previewable") params.set("canPreview","true");
  else if(filter==="no_media") params.set("hasMediaRef","false");
  else if(filter==="commons_file") params.set("mediaKind","commons_file");
  else if(filter==="commons_category") params.set("mediaKind","commons_category");
  else if(filter==="wikidata") params.set("mediaKind","wikidata");
  else if(filter==="wikipedia") params.set("mediaKind","wikipedia");
  else if(filter==="mapillary") params.set("mediaKind","mapillary");
  else if(filter==="website") params.set("mediaKind","website");
  return params;
}

function renderMediaSummary(diag){
  if(!diag) return;
  var checked=diag.checked||{}, counts=diag.counts||{};
  var items=[["Accepted spots",checked.acceptedSpots],["Accepted routes",checked.acceptedRoutes],["With media refs",counts.itemsWithAnyMediaRef],["Previewable",counts.itemsWithPreviewableMedia],["Commons files",counts.itemsWithCommonsFile],["Commons categories",counts.itemsWithCommonsCategory],["Wikidata",counts.itemsWithWikidata],["Wikipedia",counts.itemsWithWikipedia],["Mapillary",counts.itemsWithMapillary],["Website",counts.itemsWithWebsite],["No media",counts.itemsWithNoMediaRefs]];
  document.getElementById("mediaSummaryGrid").innerHTML=items.map(function(p){ return '<div class="stat-box"><div class="stat-label">'+p[0]+'</div><div class="stat-value">'+(p[1]!=null?p[1]:0)+'</div></div>'; }).join("");
}

function renderMediaRef(ref){
  var preview="";
  if(ref.canPreview && ref.previewUrl){
    preview='<img class="media-preview" src="'+esc(ref.previewUrl)+'" alt="preview" loading="lazy" onerror="this.classList.add(\\'broken\\'); this.nextElementSibling.style.display=\\'block\\';"/><div class="media-preview-fallback" style="display:none">Preview failed</div>';
  }
  var link=ref.displayUrl||ref.sourceUrl;
  var linkHtml=link?'<a href="'+esc(link)+'" target="_blank" rel="noopener">'+esc(link)+'</a>':"—";
  return '<div class="media-ref"><div><strong>'+esc(ref.tagKey)+'</strong> · '+esc(ref.mediaKind)+(ref.requiresLaterResolution?' · <span class="muted">requires resolution</span>':"")+'</div><div class="muted"><code>'+esc(ref.rawValue)+'</code></div>'+preview+'<div>'+linkHtml+'</div>'+(ref.notes&&ref.notes.length?'<ul><li>'+ref.notes.map(esc).join('</li><li>')+'</li></ul>':"")+'</div>';
}

function renderMediaResults(results){
  mediaCatalogCache=results||[];
  var root=document.getElementById("mediaResults");
  if(!results.length){ root.innerHTML='<p class="muted">No items. Run classifier first, then refresh.</p>'; return; }
  root.innerHTML=results.map(function(item,idx){
    var badges=(item.existingMediaRefs||[]).map(function(ref){ return '<span class="'+mediaBadgeClass(ref.mediaKind)+'">'+esc(mediaBadgeLabel(ref.mediaKind))+'</span>'; }).join("");
    if(!badges) badges='<span class="media-badge">no media</span>';
    return '<div class="media-card"><div class="media-card-head" data-toggle="'+idx+'"><div><strong>'+esc(item.displayName||item.name)+'</strong> · '+esc(item.kind)+' · '+esc(item.decision)+(item.category?' · '+esc(item.category):"")+(item.activity?' · '+esc(item.activity):"")+'</div><div>'+badges+'</div></div><div class="media-card-body" id="mediaBody'+idx+'" style="display:none"><div class="muted">sourceKey: <code>'+esc(item.sourceKey)+'</code> · refs: '+item.existingMediaRefCount+' · previewable: '+item.previewableMediaCount+'</div>'+(item.existingMediaRefs||[]).map(renderMediaRef).join("")+'<button type="button" class="ghost btnCopyItemMedia" data-idx="'+idx+'">Copy media refs JSON for this item</button></div></div>';
  }).join("");
  root.querySelectorAll("[data-toggle]").forEach(function(el){
    el.addEventListener("click", function(){ var idx=el.getAttribute("data-toggle"); var body=document.getElementById("mediaBody"+idx); if(body) body.style.display=body.style.display==="none"?"block":"none"; });
  });
  root.querySelectorAll(".btnCopyItemMedia").forEach(function(btn){
    btn.addEventListener("click", function(ev){ ev.stopPropagation(); var idx=Number(btn.getAttribute("data-idx")); navigator.clipboard.writeText(JSON.stringify(mediaCatalogCache[idx].existingMediaRefs||[], null, 2)); });
  });
}

async function loadExistingMedia(){
  try{
    var params=buildMediaSearchParams();
    var data=await api("/admin/openstreetmap/api/media/existing?"+params.toString());
    document.getElementById("mediaMeta").textContent="runId: "+(data.runId||"—")+" · showing "+((data.results&&data.results.length)||0)+" / "+(data.total||0);
    renderMediaResults((data.results||[]).map(function(r){ return r.item; }));
    var diagData=await api("/admin/openstreetmap/api/media/diagnostics"+(data.runId?"?runId="+encodeURIComponent(data.runId):""));
    mediaDiagnosticsCache=diagData.existingMediaDiagnostics;
    renderMediaSummary(mediaDiagnosticsCache);
    document.getElementById("mediaDiagnosticsJson").value=JSON.stringify({ existingMediaDiagnostics: mediaDiagnosticsCache }, null, 2);
  }catch(e){
    document.getElementById("mediaResults").innerHTML='<p class="status-bar error">'+esc(e.message)+'</p>';
  }
}

document.getElementById("pageTabClassifier").addEventListener("click", function(){
  document.getElementById("pageTabClassifier").classList.add("active");
  document.getElementById("pageTabMedia").classList.remove("active");
  document.getElementById("classifierPage").style.display="block";
  document.getElementById("mediaPage").style.display="none";
});
document.getElementById("pageTabMedia").addEventListener("click", function(){
  document.getElementById("pageTabMedia").classList.add("active");
  document.getElementById("pageTabClassifier").classList.remove("active");
  document.getElementById("classifierPage").style.display="none";
  document.getElementById("mediaPage").style.display="block";
  void loadExistingMedia();
});
document.getElementById("btnLoadMedia").addEventListener("click", function(){ void loadExistingMedia(); });
document.getElementById("btnMediaSearch").addEventListener("click", function(){ void loadExistingMedia(); });
document.getElementById("mediaSearch").addEventListener("keydown", function(ev){ if(ev.key==="Enter") void loadExistingMedia(); });
document.getElementById("btnCopyMediaJson").addEventListener("click", function(){ document.getElementById("mediaDiagnosticsJson").select(); document.execCommand("copy"); });
document.getElementById("btnCopyAllMediaJson").addEventListener("click", function(){ if(mediaDiagnosticsCache) navigator.clipboard.writeText(JSON.stringify({ existingMediaDiagnostics: mediaDiagnosticsCache }, null, 2)); });

initMap();
document.getElementById("statusBar").textContent="Adjust center/radius or options, then click Refetch region or Run Classifier.";
</script>
</body></html>`;
}
