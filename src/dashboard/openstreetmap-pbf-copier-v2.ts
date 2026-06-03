/**
 * PBF Copier V2 — /admin/openstreetmap/pbf-copier-v2
 *
 * Read-only viewport coverage preview from a local .osm.pbf. No Firebase writes.
 */
export function renderOpenStreetMapPbfCopierV2Page(): string {
  const apiBase = "/admin/openstreetmap/api/pbf-copier-v2";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>PBF Copier V2</title>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    a{color:#93c5fd;text-decoration:none}
    .shell{max-width:1380px;margin:0 auto;padding:20px 16px 48px}
    h1{font-size:24px;margin:0 0 4px}
    h2{font-size:13px;margin:0 0 8px;color:#cbd5e1;text-transform:uppercase;letter-spacing:.04em}
    h3{font-size:14px;margin:0 0 6px;color:#e2e8f0}
    p{margin:6px 0}
    .muted{color:#94a3b8;font-size:13px}
    .panel{border:1px solid #334155;border-radius:10px;background:#111827;padding:14px 16px;margin:14px 0}
    button{padding:7px 12px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:13px;cursor:pointer;font-weight:600;margin:2px 4px 2px 0}
    button.secondary{background:#334155}
    button:disabled{opacity:.5;cursor:not-allowed}
    input,select{padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:12px}
    input[type=text]{width:320px}
    label{font-size:12px;color:#cbd5e1;display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0}
    .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border-top:1px solid #334155;padding:6px 8px;text-align:left;vertical-align:top}
    th{background:#0b1220;color:#94a3b8;font-weight:600}
    #statusBar{padding:12px 14px;border-radius:8px;border:1px solid #334155;background:#0b1220;font-size:13px;margin:12px 0}
    #statusBar.loading{border-color:#2563eb;background:#172554;color:#bfdbfe}
    #statusBar.ok{border-color:#166534;background:#052e16;color:#86efac}
    #statusBar.warn{border-color:#854d0e;background:#422006;color:#fcd34d}
    #statusBar.error{border-color:#b91c1c;background:#450a0a;color:#fecaca}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #334155;font-size:10px;color:#cbd5e1;margin:2px 4px 2px 0;background:#0b1220}
    .pill.ok{border-color:#166534;color:#86efac}
    .pill.err{border-color:#b91c1c;color:#fca5a5}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    .stat-value{font-size:18px;font-weight:700;margin-top:4px;color:#e2e8f0}
    .map-shell{height:480px;border-radius:16px;border:1px solid #334155;overflow:hidden;background:#020617}
    .table-wrap{max-height:560px;overflow:auto;border:1px solid #1f2937;border-radius:8px}
    tr:hover{background:#1e293b}
    tr.selected{background:rgba(37,99,235,.12)}
    tr.spot{background:rgba(34,197,94,.04)}
    tr.route{background:rgba(56,189,248,.04)}
    tr.quality-hidden{opacity:.45;background:rgba(15,23,42,.6)}
    tr.quality-hidden:hover{background:rgba(30,41,59,.55)}
    tr.quality-hidden td{color:#64748b}
    .filter-reason{font-size:11px;color:#fbbf24;max-width:220px}
    .support-meta{font-size:11px;color:#94a3b8;margin-top:4px}
    .support-meta summary{cursor:pointer;color:#cbd5e1}
    .support-meta ul{margin:4px 0 0 16px;padding:0}
    #previewSearchInput{min-width:280px}
    #mapSidebar{font-size:12px;color:#cbd5e1;margin-top:8px;min-height:48px}
    .emoji-marker{font-size:20px;line-height:1;cursor:pointer;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
    .emoji-marker.route{font-size:16px;opacity:.95}
    .map-route-legend{font-size:11px;color:#94a3b8;margin-top:6px}
    .map-popup{font-size:12px;line-height:1.45;max-width:280px}
    .map-popup strong{font-size:13px}
    .map-popup .muted{color:#64748b;font-size:11px}
    .support-highlight{outline:2px solid #2563eb;border-radius:6px;padding:4px}
    button.tab{background:#0b1220;border:1px solid #334155;color:#cbd5e1;padding:4px 8px;font-size:11px}
    button.tab.active{background:#172554;border-color:#2563eb;color:#fff}
    button.small{padding:4px 8px;font-size:11px}
    button.success{background:#15803d}
    button.danger{background:#b91c1c}
    .helper-box{border:1px dashed #334155;border-radius:8px;padding:10px 12px;margin:8px 0;font-size:12px;color:#cbd5e1;line-height:1.5}
    .helper-box code{display:block;margin-top:6px;white-space:pre-wrap;color:#93c5fd}
    code{background:#020617;padding:1px 4px;border-radius:3px;color:#93c5fd}
  </style>
</head>
<body>
<div class="shell">
  <p>
    <a href="/admin">← Admin</a>
    · <a href="/admin/openstreetmap">OSM Classifier</a>
    · <a href="/admin/openstreetmap/pbf-copier">Master PBF OSM Copier</a>
    · <a href="/admin/openstreetmap/national-copier">National Copier</a>
  </p>
  <h1>PBF Copier V2</h1>
  <p class="muted">
    Raw OSM dump for the current map viewport — every tagged node/way/relation in the PBF with geometry here. No Locava filter by default. Write blank spots to <code>unexploredSpots</code> / <code>unexploredRoutes</code> after validation.
  </p>

  <div id="statusBar" class="muted">Ready — validate a PBF file, pan/zoom the map, then scan the current viewport.</div>

  <div class="panel">
    <h2>Source PBF</h2>
    <div class="row">
      <label>PBF file path
        <input id="filePath" type="text" value="./data/osm/vermont-latest.osm.pbf" placeholder="./data/osm/vermont-latest.osm.pbf"/>
      </label>
      <button type="button" class="secondary" id="btnValidateFile">Validate PBF File</button>
      <span id="fileStatus" class="pill">no file checked yet</span>
    </div>
    <div class="helper-box">
      <strong>Vermont test file:</strong>
      <code>mkdir -p data/osm
curl -L -o data/osm/vermont-latest.osm.pbf https://download.geofabrik.de/north-america/us/vermont-latest.osm.pbf</code>
    </div>
  </div>

  <div class="panel">
    <h2>Map</h2>
    <p class="muted">Pan/zoom to your area, then scan. Shows <strong>all</strong> OSM features in view (trails, roads, shops, buildings, etc.) from the PBF file — not just Locava-approved places.</p>
    <div class="row">
      <button type="button" id="btnShowAllPosts">Scan viewport (raw OSM)</button>
      <button type="button" class="secondary" id="btnFitPreview">Fit results</button>
      <button type="button" class="secondary" id="btnClearMap">Clear map</button>
      <button type="button" class="secondary" id="btnGoHowland">Lake Pinneo / Howland Dam</button>
      <button type="button" class="secondary" id="btnGoMarshBillings">Marsh-Billings (Barrette platform)</button>
      <span id="viewportCount" class="muted"></span>
    </div>
    <div class="map-shell"><div id="previewMap" style="width:100%;height:100%"></div></div>
    <div class="map-route-legend">Colored faint lines = hiking trails/paths (colored dot at trail start — click line or dot). Gray lines = other roads (no start dot). All scanned items in view are always drawn.</div>
    <div id="mapRenderStats" class="map-route-legend muted"></div>
    <div id="mapSidebar"></div>
    <div class="stat-grid" id="scanStatsGrid" style="margin-top:12px;display:none"></div>
  </div>

  <div class="panel" id="qualityFiltersPanel" style="display:none">
    <h2>Quality Filters</h2>
    <p class="muted">Runs after raw OSM fetch + trail merge. Raw scan data is preserved — toggles only hide junk from map/table unless you show hidden items.</p>
    <div class="stat-grid" id="qualityFilterStatsGrid" style="margin-bottom:12px"></div>
    <div class="row">
      <label><input type="checkbox" id="qfHideInfrastructure" checked/> Hide infrastructure/utilities</label>
      <label><input type="checkbox" id="qfHideServiceRoads" checked/> Hide roads/service/private vehicle ways</label>
      <label><input type="checkbox" id="qfHideAdministrative" checked/> Hide administrative/map metadata</label>
      <label><input type="checkbox" id="qfHideRailway" checked/> Hide rail lines</label>
    </div>
    <div class="row">
      <label><input type="checkbox" id="qfHideBroadGeography" checked/> Hide broad linear geography</label>
      <label><input type="checkbox" id="qfHideUnnamedLand" checked/> Hide generic unnamed land blobs</label>
      <label><input type="checkbox" id="qfHideUnnamedPaths" checked/> Hide generic unnamed paths</label>
      <label><input type="checkbox" id="qfShowHidden"/> Show hidden filtered items</label>
    </div>
    <h3 style="margin-top:12px">Support objects</h3>
    <div class="row">
      <label><input type="checkbox" id="qfHideUnattachedBenches" checked/> Hide unattached benches</label>
      <label><input type="checkbox" id="qfHideUnattachedParking" checked/> Hide unattached parking</label>
      <label><input type="checkbox" id="qfAttachSupport" checked/> Attach support objects to nearby destinations</label>
      <label><input type="checkbox" id="qfShowSupportMarkers"/> Show support objects as separate markers</label>
    </div>
    <p id="qualityFilterBreakdown" class="muted" style="margin-top:8px"></p>
  </div>

  <div class="panel" id="resultsPanel" style="display:none">
    <h2>Results</h2>
    <h3>Search &amp; filter</h3>
    <div class="row">
      <label style="flex:1">Search
        <input id="previewSearchInput" type="text" placeholder="Name, activity, category, tag, OSM id…"/>
      </label>
      <label>Kind
        <select id="previewFilterKind">
          <option value="all">All kinds</option>
          <option value="spot">Spots only</option>
          <option value="route">Routes only</option>
        </select>
      </label>
    </div>
    <div class="row">
      <button type="button" class="tab preview-preset" data-preset="hiking">Hiking</button>
      <button type="button" class="tab preview-preset" data-preset="swimming">Swimming</button>
      <button type="button" class="tab preview-preset" data-preset="viewpoints">Viewpoints</button>
      <button type="button" class="tab preview-preset" data-preset="offroad">Offroad</button>
      <button type="button" class="tab preview-preset" data-preset="waterfall">Waterfalls</button>
    </div>
    <h3 style="margin-top:14px">Items (<span id="previewResultCount">0</span> shown · <span id="previewResultVisible">0</span> visible · <span id="previewResultHidden">0</span> hidden · <span id="previewResultTotal">0</span> raw)</h3>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Kind</th><th>Name</th><th>Primary</th><th>Activities</th><th>Category</th>
          <th>Tags</th><th>Filter</th><th>OSM</th><th>Coords</th><th></th>
        </tr></thead>
        <tbody id="previewResultsBody"></tbody>
      </table>
    </div>
    <div class="row" style="margin-top:16px;padding-top:12px;border-top:1px solid #334155">
      <button type="button" id="btnCopyJson" disabled>Copy output JSON</button>
      <span id="copyJsonStatus" class="muted"></span>
    </div>
  </div>

  <div class="panel" id="writePanel" style="display:none">
    <h2>Write V2 Spots</h2>
    <p class="muted">Writes validated items to <code>unexploredSpots</code> and <code>unexploredRoutes</code> (same schema as Master PBF Copier). Never writes <code>/posts</code>. Validate → dry run → write.</p>
    <div class="stat-grid" id="writeStatsGrid"></div>
    <div class="row" style="margin-top:10px">
      <label>Write scope
        <select id="writeScope">
          <option value="all_visible" selected>All fetched visible filtered items</option>
          <option value="viewport_rendered">Current map rendered items only</option>
        </select>
      </label>
      <label>Write target
        <select id="writeTarget">
          <option value="production">Production</option>
          <option value="emulator">Emulator</option>
        </select>
      </label>
    </div>
    <div class="row">
      <label><input type="checkbox" id="writeSkipExisting" checked/> Skip duplicates (by doc id)</label>
      <label><input type="checkbox" id="writeOverwrite"/> Overwrite existing</label>
      <label><input type="checkbox" id="writeIncludeHidden"/> Include hidden filtered items</label>
      <label><input type="checkbox" id="writeIncludeSupportPrimary"/> Write support as standalone spots</label>
    </div>
    <div class="row">
      <label>Production password
        <input id="writeProductionPassword" type="password" placeholder="Cooper"/>
      </label>
    </div>
    <div class="row">
      <button type="button" class="secondary" id="btnValidateWrite">Validate Write Payload</button>
      <button type="button" class="secondary" id="btnDryRunWrite">Dry Run</button>
      <button type="button" class="success" id="btnWriteBlankSpots" disabled>Write Blank Spots</button>
      <button type="button" class="secondary" id="btnResetWrite">Reset</button>
    </div>
    <p id="writeTargetInfo" class="muted"></p>
    <p id="writeValidationSummary" class="muted"></p>
    <div id="writeResultPanel" style="display:none;margin-top:12px">
      <h3>Write result</h3>
      <div class="stat-grid" id="writeResultStats"></div>
      <h3 style="margin-top:12px">Examples (first 20 written)</h3>
      <div class="table-wrap" style="max-height:200px"><table><thead><tr><th>Kind</th><th>Name</th><th>Collection</th><th>Source key</th></tr></thead><tbody id="writeWrittenExamples"></tbody></table></div>
      <h3 style="margin-top:12px">Skipped (first 20)</h3>
      <div class="table-wrap" style="max-height:200px"><table><thead><tr><th>Kind</th><th>Name</th><th>Reason</th></tr></thead><tbody id="writeSkippedExamples"></tbody></table></div>
      <p id="writeErrors" class="muted" style="color:#fca5a5"></p>
    </div>
  </div>
</div>

<script>
const apiBase = ${JSON.stringify(apiBase)};
const OSM_STYLE = { version:8, sources:{ osm:{ type:"raster", tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize:256 }}, layers:[{id:"osm",type:"raster",source:"osm"}]};
const HARTLAND_VT_CENTER = { lat: 43.54063, lng: -72.39898 };
const HOWLAND_DAM_CENTER = { lat: 43.458, lng: -72.5 };
const MARSH_BILLINGS_CENTER = { lat: 43.6429, lng: -72.4087 };
const DEFAULT_MAP_ZOOM = 11;
const PREVIEW_ROUTES_SOURCE = "preview-routes-v2";
const PREVIEW_ROUTES_LAYER = "preview-routes-v2-line";
const PREVIEW_ROUTES_HIT_SOURCE = "preview-routes-v2-hit";
const PREVIEW_ROUTES_HIT_LAYER = "preview-routes-v2-hit-line";
const PREVIEW_ROUTE_STARTS_SOURCE = "preview-routes-v2-starts";
const PREVIEW_ROUTE_STARTS_LAYER = "preview-routes-v2-starts-circle";
const PREVIEW_ROUTE_STARTS_HIT_LAYER = "preview-routes-v2-starts-hit";
const ROUTE_HIT_WIDTH = 14;
const TABLE_ROW_CAP = 500;
const MAP_RENDER_CONFIG = {
  debounceMs: 150,
};
const TRAIL_FALLBACK_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#06b6d4","#3b82f6","#6366f1","#8b5cf6","#d946ef","#ec4899","#f43f5e"];

let previewDocs = [];
let previewDocsRaw = [];
let scanCacheId = null;
let rawItemCount = 0;
let previewMap = null;
let previewMapReady = false;
let previewMarkers = [];
let previewMarkerByDocId = {};
let previewDocBySelectKey = {};
let routeClickBound = false;
let selectedPreviewDocId = null;
let scanInFlight = false;
let qualityFilterInFlight = false;
let lastScanBbox = null;
let lastScanStats = null;
let qualityFilterSummary = null;
let groupingSummary = null;
let locavaProductSummary = null;
let showHiddenFiltered = false;
let showSupportMarkersOnMap = false;
let mapRenderStats = null;
let mapRenderDebounceTimer = null;
let mapRenderInFlight = false;
let mapRenderQueued = false;
let previewClusterMarkers = [];
let lastMapRenderItems = [];
let writeValidated = false;
let writeDryRunDone = false;
let lastWriteResult = null;
const UNDISCOVERED_SHAPE_PHRASE = "I_CONFIRM_UNDISCOVERED_WRITES_MATCH_POST_LIKE_SCHEMA";
const LARGE_WRITE_THRESHOLD = 500;

function getVisibleFilteredItems() {
  return previewDocs.filter(function (d) { return !d.filteredOut; });
}

function getViewportRenderedIds() {
  return (lastMapRenderItems || []).map(function (d) { return d.id; });
}

function buildWriteRequestBody(extra) {
  if (!lastScanBbox) throw new Error("Scan the viewport first.");
  if (!scanCacheId) throw new Error("Scan cache expired — re-scan the viewport.");
  const body = {
    cacheId: scanCacheId,
    bbox: lastScanBbox,
    scanCacheId: scanCacheId,
    qualityFilterSettings: readQualityFilterSettings(),
    selectedWriteScope: $("writeScope").value || "all_visible",
    includeHidden: $("writeIncludeHidden").checked,
    includeSupportAsPrimary: $("writeIncludeSupportPrimary").checked,
    viewportRenderedIds: getViewportRenderedIds(),
    skipExisting: $("writeSkipExisting").checked && !$("writeOverwrite").checked,
    overwrite: $("writeOverwrite").checked,
  };
  return Object.assign(body, extra || {});
}

function renderWriteStats(summary, plan) {
  const items = [
    ["Raw fetched", summary ? summary.totalRawItems : rawItemCount],
    ["Visible filtered", summary ? summary.totalVisibleFiltered : getVisibleFilteredItems().length],
    ["Map rendered", summary ? summary.mapRenderedItems : getViewportRenderedIds().length],
    ["Hidden excluded", summary ? summary.hiddenExcluded : 0],
    ["Support excluded", summary ? summary.supportOnlyExcluded : 0],
    ["Spots to write", plan ? plan.spotsPlanned : "—"],
    ["Routes to write", plan ? plan.routesPlanned : "—"],
    ["Duplicate candidates", plan ? plan.duplicateCandidates : "—"],
  ];
  $("writeStatsGrid").innerHTML = items.map(function (p) {
    return '<div class="stat-box"><div class="stat-label">' + p[0] + '</div><div class="stat-value">' + p[1] + '</div></div>';
  }).join("");
  $("writeTargetInfo").textContent = "Write target: unexploredSpots + unexploredRoutes · posts forbidden";
}

function renderWriteResult(result) {
  $("writeResultPanel").style.display = "block";
  const stats = [
    ["Written", result.written],
    ["Spots", result.spotsWritten || result.spotsPlanned],
    ["Routes", result.routesWritten || result.routesPlanned],
    ["Skipped duplicates", result.skippedDuplicates],
    ["Skipped invalid", result.skippedInvalid],
    ["Support nested", result.supportObjectsNested],
  ];
  $("writeResultStats").innerHTML = stats.map(function (p) {
    return '<div class="stat-box"><div class="stat-label">' + p[0] + '</div><div class="stat-value">' + p[1] + '</div></div>';
  }).join("");
  $("writeWrittenExamples").innerHTML = (result.writtenExamples || []).slice(0, 20).map(function (ex) {
    return "<tr><td>" + escapeHtml(ex.kind) + "</td><td>" + escapeHtml(ex.displayName) + "</td><td>" + escapeHtml(ex.collection) + "</td><td><code>" + escapeHtml(ex.sourceKey) + "</code></td></tr>";
  }).join("") || '<tr><td colspan="4" class="muted">None</td></tr>';
  $("writeSkippedExamples").innerHTML = (result.skippedExamples || []).slice(0, 20).map(function (ex) {
    return "<tr><td>" + escapeHtml(ex.kind) + "</td><td>" + escapeHtml(ex.displayName) + "</td><td>" + escapeHtml(ex.reason) + "</td></tr>";
  }).join("") || '<tr><td colspan="4" class="muted">None</td></tr>';
  $("writeErrors").textContent = (result.errors && result.errors.length) ? ("Errors: " + result.errors.join("; ")) : "";
}

function updateWriteButtons() {
  $("btnWriteBlankSpots").disabled = !(writeValidated && writeDryRunDone);
}

function resetWriteState() {
  writeValidated = false;
  writeDryRunDone = false;
  lastWriteResult = null;
  $("writeValidationSummary").textContent = "";
  $("writeResultPanel").style.display = "none";
  updateWriteButtons();
}

async function validateWritePayload() {
  try {
    const json = await api("/validate-write-payload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWriteRequestBody()),
    });
    const data = json.data || json;
    lastWriteResult = data;
    writeValidated = !(data.validationErrors && data.validationErrors.length);
    writeDryRunDone = false;
    renderWriteStats(data.summary, data);
    renderWriteResult(data);
    const total = (data.spotsPlanned || 0) + (data.routesPlanned || 0);
    var msg = "Validation: " + total + " item(s) ready";
    if (data.duplicateCandidates) msg += ", " + data.duplicateCandidates + " duplicate candidate(s)";
    if (data.requiresLargeWriteConfirmation) msg += " — WARNING: >" + LARGE_WRITE_THRESHOLD + " items";
    if (data.validationErrors && data.validationErrors.length) msg += " — errors: " + data.validationErrors.join(", ");
    $("writeValidationSummary").textContent = msg;
    updateWriteButtons();
    setStatus(writeValidated ? "ok" : "warn", msg);
  } catch (err) {
    resetWriteState();
    setStatus("error", "Validate failed: " + (err.message || String(err)));
  }
}

async function dryRunWrite() {
  try {
    const json = await api("/dry-run-write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWriteRequestBody({
        writeTarget: $("writeTarget").value,
        confirmProductionWrite: $("writeProductionPassword").value || undefined,
        confirmLargeWrite: true,
      })),
    });
    const data = json.data || json;
    lastWriteResult = data;
    writeValidated = true;
    writeDryRunDone = true;
    renderWriteStats(data.summary, data);
    renderWriteResult(data);
    const total = (data.spotsPlanned || 0) + (data.routesPlanned || 0);
    $("writeValidationSummary").textContent = "Dry run: would write " + total + " doc(s), skip " + (data.skippedDuplicates || 0) + " duplicate(s). Zero Firebase writes performed.";
    updateWriteButtons();
    setStatus("ok", "Dry run complete — no Firebase writes.");
  } catch (err) {
    setStatus("error", "Dry run failed: " + (err.message || String(err)));
  }
}

async function writeBlankSpots() {
  if (!writeValidated || !writeDryRunDone) {
    setStatus("warn", "Run Validate and Dry Run before writing.");
    return;
  }
  const total = (lastWriteResult && ((lastWriteResult.spotsPlanned || 0) + (lastWriteResult.routesPlanned || 0))) || 0;
  if (total > LARGE_WRITE_THRESHOLD) {
    if (!window.confirm("Write " + total + " items to " + $("writeTarget").value + "?")) return;
  }
  $("btnWriteBlankSpots").disabled = true;
  setStatus("loading", "Writing blank spots/routes…");
  try {
    const json = await api("/write-blank-spots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWriteRequestBody({
        writeTarget: $("writeTarget").value,
        confirmProductionWrite: $("writeProductionPassword").value || undefined,
        confirmUndiscoveredShape: UNDISCOVERED_SHAPE_PHRASE,
        confirmLargeWrite: true,
      })),
    });
    const data = json.data || json;
    lastWriteResult = data;
    renderWriteResult(data);
    setStatus(data.errors && data.errors.length ? "warn" : "ok",
      "Write complete: " + (data.written || 0) + " written, " + (data.skippedDuplicates || 0) + " duplicates skipped.");
  } catch (err) {
    setStatus("error", "Write failed: " + (err.message || String(err)));
  } finally {
    updateWriteButtons();
  }
}

function showWritePanel() {
  $("writePanel").style.display = "block";
  renderWriteStats({
    totalRawItems: rawItemCount,
    totalVisibleFiltered: getVisibleFilteredItems().length,
    mapRenderedItems: getViewportRenderedIds().length,
    hiddenExcluded: previewDocs.filter(function (d) { return d.filteredOut; }).length,
    supportOnlyExcluded: previewDocs.filter(function (d) { return d.attachedTo; }).length,
  }, lastWriteResult);
}

function safeMinMaxCoords(coords) {
  if (!coords || !coords.length) return null;
  var minLat = Infinity;
  var maxLat = -Infinity;
  var minLng = Infinity;
  var maxLng = -Infinity;
  for (var i = 0; i < coords.length; i++) {
    var c = coords[i];
    if (c == null || c.lat == null || c.lng == null) continue;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
  }
  if (!isFinite(minLat)) return null;
  return { minLat: minLat, maxLat: maxLat, minLng: minLng, maxLng: maxLng };
}

function safeLngLatBounds(coords) {
  var box = safeMinMaxCoords(coords);
  if (!box) return null;
  return [[box.minLng, box.minLat], [box.maxLng, box.maxLat]];
}

function slimDocForExport(doc) {
  return {
    kind: doc.kind,
    displayName: doc.displayName,
    primaryActivity: doc.primaryActivity,
    primaryCategory: doc.primaryCategory,
    activities: doc.activities,
    lat: doc.lat,
    lng: doc.lng,
    osmType: doc.osmType,
    osmId: doc.osmId,
    tags: doc.sourceTagSample || {},
    warnings: doc.warnings || [],
    linePointCount: doc.geometryPointCount || (doc.routeLineCoordinates ? doc.routeLineCoordinates.length : 0),
    routeLineColor: doc.routeLineColor || null,
    filteredOut: doc.filteredOut === true,
    filteredBy: doc.filteredBy || [],
    filterReason: doc.filterReason || null,
    attachedTo: doc.attachedTo || null,
    attachReason: doc.attachReason || null,
    attachedToRouteId: doc.attachedToRouteId || null,
    destinationGroupId: doc.destinationGroupId || null,
    routeMarkerCoordinate: doc.routeMarkerCoordinate || null,
    routeCenterCoordinate: doc.routeCenterCoordinate || null,
    derivedName: doc.derivedName === true,
    nameSource: doc.nameSource || null,
    nameConfidence: doc.nameConfidence || null,
    supportMetadata: doc.supportMetadata || null,
  };
}

function buildCopyExportPayload() {
  return {
    tool: "pbf-copier-v2",
    mode: "raw_osm",
    exportedAt: new Date().toISOString(),
    bbox: lastScanBbox,
    stats: lastScanStats,
    qualityFilterSettings: readQualityFilterSettings(),
    qualityFilterSummary: qualityFilterSummary,
    groupingSummary: groupingSummary,
    locavaProductSummary: locavaProductSummary,
    showHiddenFiltered: showHiddenFiltered,
    itemCount: previewDocs.length,
    rawItemCount: rawItemCount || previewDocsRaw.length || previewDocs.length,
    scanCacheId: scanCacheId,
    visibleItemCount: qualityFilterSummary ? qualityFilterSummary.visibleItems : previewDocs.filter(function (d) { return !d.filteredOut; }).length,
    hiddenItemCount: qualityFilterSummary ? qualityFilterSummary.hiddenItems : previewDocs.filter(function (d) { return d.filteredOut; }).length,
    items: previewDocs.map(slimDocForExport),
  };
}

async function copyOutputJson() {
  if (!previewDocs.length && !scanCacheId) {
    setStatus("warn", "Scan the viewport first — nothing to copy yet.");
    return;
  }
  const text = JSON.stringify(buildCopyExportPayload(), null, 2);
  $("copyJsonStatus").textContent = "";
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    $("copyJsonStatus").textContent = "Copied " + previewDocs.length + " items (" + Math.round(text.length / 1024) + " KB)";
    setStatus("ok", "JSON copied to clipboard — paste into ChatGPT to grade what to include.");
  } catch (err) {
    setStatus("error", "Copy failed: " + (err && err.message ? err.message : String(err)));
  }
}

function updateCopyJsonButton() {
  $("btnCopyJson").disabled = !previewDocs.length && !scanCacheId;
}

function readQualityFilterSettings() {
  return {
    hideInfrastructure: $("qfHideInfrastructure").checked,
    hideServiceRoads: $("qfHideServiceRoads").checked,
    hideAdministrative: $("qfHideAdministrative").checked,
    hideRailway: $("qfHideRailway").checked,
    hideBroadGeography: $("qfHideBroadGeography").checked,
    hideUnnamedLand: $("qfHideUnnamedLand").checked,
    hideUnnamedPaths: $("qfHideUnnamedPaths").checked,
    hideNonDestinationAmenities: true,
    hideUnattachedBenches: $("qfHideUnattachedBenches").checked,
    hideUnattachedParking: $("qfHideUnattachedParking").checked,
    attachSupportToDestinations: $("qfAttachSupport").checked,
    showSupportObjectsAsMarkers: $("qfShowSupportMarkers").checked,
  };
}

function syncSupportMarkerToggle() {
  showSupportMarkersOnMap = $("qfShowSupportMarkers").checked;
}

function buildSupportMetaHtml(doc) {
  const meta = doc.supportMetadata;
  if (!meta) return "";
  const parking = meta.parking || [];
  const benches = meta.benches || [];
  const shelters = meta.shelters || [];
  const toilets = meta.toilets || [];
  const infoMaps = meta.informationMaps || [];
  const trailheads = meta.trailheads || [];
  const viewpoints = meta.viewpoints || [];
  const waterfalls = meta.waterfalls || [];
  if (!parking.length && !benches.length && !shelters.length && !toilets.length && !infoMaps.length
    && !trailheads.length && !viewpoints.length && !waterfalls.length) return "";
  var parts = [];
  function renderList(label, items) {
    if (!items.length) return "";
    var lis = items.map(function (item) {
      return "<li>" + escapeHtml(item.displayName || "(unnamed)") + " · "
        + escapeHtml(String(item.distanceMeters)) + "m · "
        + escapeHtml(item.attachReason || "") + "</li>";
    }).join("");
    return "<div><strong>" + escapeHtml(label) + ":</strong><ul>" + lis + "</ul></div>";
  }
  var summary = "Parking: " + parking.length
    + " · Trailheads: " + trailheads.length
    + " · Benches: " + benches.length
    + " · Toilets: " + toilets.length
    + " · Viewpoints: " + viewpoints.length
    + " · Waterfalls: " + waterfalls.length;
  parts.push(renderList("Trailheads", trailheads));
  parts.push(renderList("Parking", parking));
  parts.push(renderList("Benches", benches));
  parts.push(renderList("Shelters", shelters));
  parts.push(renderList("Toilets", toilets));
  parts.push(renderList("Info maps", infoMaps));
  parts.push(renderList("Viewpoints", viewpoints));
  parts.push(renderList("Waterfalls", waterfalls));
  return '<details class="support-meta"><summary>' + escapeHtml(summary) + '</summary>' + parts.join("") + '</details>';
}

function qualityFilterLabel(key) {
  const labels = {
    infrastructure: "Infrastructure",
    service_road: "Service roads",
    administrative: "Administrative",
    railway: "Railway",
    broad_geography: "Broad geography",
    unnamed_land: "Unnamed land",
    unnamed_path: "Unnamed paths",
    non_destination_amenity: "Non-destination",
    parking_support_unattached: "Unattached parking",
    tiny_non_destination_amenity: "Unattached bench",
    support_attached: "Attached support",
    aerialway_pylon: "Lift pylons",
    address_only: "Address-only",
    unnamed_terrain: "Unnamed terrain",
    generic_track: "Generic track",
    unnamed_piste: "Unnamed piste",
    unnamed_aerialway_station: "Unnamed lift station",
  };
  return labels[key] || key;
}

function renderQualityFilterStats(summary) {
  if (!summary) {
    $("qualityFilterStatsGrid").innerHTML = "";
    $("qualityFilterBreakdown").textContent = "";
    return;
  }
  const items = [
    ["Raw items", summary.rawItems],
    ["Visible", summary.visibleItems],
    ["Hidden", summary.hiddenItems],
  ];
  $("qualityFilterStatsGrid").innerHTML = items.map(function (p) {
    return '<div class="stat-box"><div class="stat-label">' + p[0] + '</div><div class="stat-value">' + p[1] + '</div></div>';
  }).join("");
  const breakdown = Object.entries(summary.countsByFilter || {})
    .filter(function (e) { return Number(e[1]) > 0; })
    .sort(function (a, b) { return Number(b[1]) - Number(a[1]); })
    .map(function (e) { return qualityFilterLabel(e[0]) + ": " + e[1]; })
    .join(" · ");
  $("qualityFilterBreakdown").textContent = breakdown ? ("Hidden by reason: " + breakdown) : "No items hidden with current filter settings.";
  if (groupingSummary) {
    $("qualityFilterBreakdown").textContent += " · Groups: " + groupingSummary.routeGroupsBuilt + " routes, "
      + groupingSummary.trailheadsAttached + " trailheads, "
      + groupingSummary.parkingAttachedToRoutes + " parking→routes, "
      + groupingSummary.supportObjectsAttached + " support attached, "
      + groupingSummary.derivedNamesCreated + " derived names, "
      + groupingSummary.hiddenJunkAfterGrouping + " junk hidden";
  }
  if (locavaProductSummary) {
    const lp = locavaProductSummary;
    $("qualityFilterBreakdown").textContent += " · Locava kept: "
      + lp.keptFoodDrink + " food, " + lp.keptSkiRuns + " ski, " + lp.keptCemeteries + " cemeteries · hidden: "
      + lp.hiddenHealthcare + " healthcare, " + lp.hiddenGolfMicroFeatures + " golf, "
      + lp.hiddenSportsMicroFeatures + " sports fields, " + lp.hiddenPools + " pools, "
      + lp.hiddenBanksAtms + " banks, " + lp.hiddenSupportInfrastructure + " support infra, "
      + lp.hiddenPublicServiceBuildings + " public svc, " + lp.hiddenAddressOnlyLeaks + " address-only, "
      + (lp.hiddenGeologicalLabels || 0) + " peaks, "
      + (lp.hiddenGenericFootways || 0) + " footways, "
      + (lp.hiddenUtilityLeaks || 0) + " utility";
  }
}

async function reapplyQualityFilters() {
  if (!scanCacheId && !previewDocsRaw.length) {
    previewDocs = [];
    qualityFilterSummary = null;
    groupingSummary = null;
    locavaProductSummary = null;
    renderQualityFilterStats(null);
    refreshResultsUi();
    updateCopyJsonButton();
    return;
  }
  if (qualityFilterInFlight) return;
  qualityFilterInFlight = true;
  try {
    const payload = { settings: readQualityFilterSettings() };
    if (scanCacheId) payload.cacheId = scanCacheId;
    else payload.items = previewDocsRaw;
    const json = await api("/apply-quality-filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = json.data || json;
    if (!data.items) throw new Error("Quality filter response missing items");
    previewDocs = data.items || [];
    qualityFilterSummary = data.summary || null;
    groupingSummary = data.groupingSummary || null;
    locavaProductSummary = data.locavaProductSummary || null;
    renderQualityFilterStats(qualityFilterSummary);
    refreshResultsUi();
    updateCopyJsonButton();
  } catch (err) {
    setStatus("error", "Quality filters failed: " + (err && err.message ? err.message : String(err)));
  } finally {
    qualityFilterInFlight = false;
  }
}

function isQualityHidden(doc) {
  return doc && doc.filteredOut === true;
}

function passesQualityVisibility(doc) {
  if (!isQualityHidden(doc)) return true;
  return showHiddenFiltered;
}

function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function setStatus(kind, message) {
  const bar = $("statusBar");
  bar.className = kind || "";
  bar.textContent = message;
}

async function api(path, init) {
  const res = await fetch(apiBase + path, init);
  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      if (res.ok) {
        throw new Error("Invalid JSON response (" + text.length + " bytes) — try zooming in and scanning a smaller area.");
      }
    }
  }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || json.message || res.statusText;
    throw new Error(msg || "request failed");
  }
  if (res.ok && text && !json.data && json.ok !== true && !json.items) {
    throw new Error("Empty or invalid API response — try zooming in and scanning a smaller area.");
  }
  return json;
}

function readMapBbox() {
  if (!previewMap) return null;
  const b = previewMap.getBounds();
  return {
    westLng: b.getWest(),
    southLat: b.getSouth(),
    eastLng: b.getEast(),
    northLat: b.getNorth(),
  };
}

async function validateFile() {
  const filePath = ($("filePath").value || "").trim();
  if (!filePath) { setStatus("warn", "Enter a PBF file path."); return; }
  setStatus("loading", "Validating file…");
  try {
    const json = await api("/validate-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath }),
    });
    const data = json.data || json;
    if (!data.exists) {
      $("fileStatus").textContent = "file missing";
      $("fileStatus").className = "pill err";
      setStatus("error", "File not found: " + data.resolvedPath);
      return;
    }
    if (!data.readable) {
      $("fileStatus").textContent = "not readable";
      $("fileStatus").className = "pill err";
      setStatus("error", "File not readable: " + (data.warnings || []).join("; "));
      return;
    }
    $("fileStatus").textContent = "ok · " + fmtBytes(data.fileSizeBytes);
    $("fileStatus").className = "pill ok";
    setStatus("ok", "File ok (" + fmtBytes(data.fileSizeBytes) + "). V2 is read-only — no Firebase writes.");
  } catch (err) {
    $("fileStatus").textContent = "error";
    $("fileStatus").className = "pill err";
    setStatus("error", err.message || String(err));
  }
}

function previewKindLabel(doc) {
  return doc.kind === "unexplored_route" ? "route" : "spot";
}

function activityEmoji(activity) {
  const a = String(activity || "").toLowerCase();
  if (a.indexOf("offroad") >= 0) return "🛻";
  if (a.indexOf("hik") >= 0 || a.indexOf("walk") >= 0) return "🥾";
  if (a.indexOf("bike") >= 0 || a.indexOf("cycl") >= 0) return "🚴";
  if (a.indexOf("swim") >= 0 || a.indexOf("beach") >= 0) return "🏊";
  if (a.indexOf("view") >= 0 || a.indexOf("scenic") >= 0) return "👀";
  if (a.indexOf("waterfall") >= 0 || a.indexOf("falls") >= 0) return "💧";
  if (a.indexOf("food") >= 0 || a.indexOf("cafe") >= 0) return "🍽️";
  return "📍";
}

function buildPreviewPopupHtml(doc) {
  return buildPreviewDetailHtml(doc, true);
}

function routeSelectKey(doc) {
  return doc.osmType + ":" + doc.osmId;
}

function routeMarkerPoint(doc) {
  if (doc.routeMarkerCoordinate) return doc.routeMarkerCoordinate;
  if (doc.routeLineCoordinates && doc.routeLineCoordinates.length) return doc.routeLineCoordinates[0];
  if (doc.routeLineSegments) {
    for (var si = 0; si < doc.routeLineSegments.length; si++) {
      var seg = doc.routeLineSegments[si];
      if (seg && seg.length) return seg[0];
    }
  }
  if (doc.lat != null && doc.lng != null) return { lat: doc.lat, lng: doc.lng };
  return null;
}

function routeHasRenderableLine(doc) {
  if (doc.routeLineCoordinates && doc.routeLineCoordinates.length >= 2) return true;
  if (doc.routeLineSegments && doc.routeLineSegments.some(function (s) { return s && s.length >= 2; })) return true;
  return false;
}

function isTrailLikeRouteForMap(doc) {
  if (isHikingTrailMerged(doc)) return true;
  if (doc.routeLineColor) return true;
  var tags = doc.sourceTagSample || {};
  var highway = String(tags.highway || "").toLowerCase();
  if (tags.footway === "sidewalk" || tags.foot === "no") return false;
  if (tags.sac_scale || tags.trail_visibility) return true;
  var route = String(tags.route || "").toLowerCase();
  if (route === "hiking" || route === "foot" || route === "walking") return true;
  if (highway === "path" || highway === "steps" || highway === "bridleway" || highway === "footway") return true;
  if (highway === "track") {
    var foot = String(tags.foot || "").toLowerCase();
    if (foot === "designated" || foot === "yes" || foot === "permissive" || tags.hiking === "yes") return true;
  }
  var act = String(doc.primaryActivity || "").toLowerCase();
  if (act.indexOf("hik") >= 0 || act.indexOf("walk") >= 0) return true;
  return false;
}

function formatDistance(meters) {
  if (meters == null || !isFinite(meters)) return "";
  if (meters >= 1609) return (meters / 1609.344).toFixed(meters >= 16090 ? 1 : 2) + " mi";
  return Math.round(meters) + " m";
}

function routeShapeLabel(shape) {
  if (shape === "loop") return "Loop";
  if (shape === "out_and_back") return "Out & back";
  if (shape === "point_to_point") return "Point to point";
  return "";
}

function buildPreviewDetailHtml(doc, compact) {
  const kind = previewKindLabel(doc);
  const acts = (doc.activities || []).slice(0, 6).join(", ");
  const tags = doc.sourceTagSample || {};
  const tagLines = Object.entries(tags).slice(0, compact ? 6 : 16).map(function (e) {
    return escapeHtml(e[0] + "=" + e[1]);
  }).join("<br/>");
  const lineCount = doc.geometryPointCount || (doc.routeLineCoordinates ? doc.routeLineCoordinates.length : 0);
  let html = '<div class="map-popup" id="preview-detail-card">';
  html += "<strong>" + escapeHtml(doc.displayName || "Unnamed") + "</strong>";
  if (doc.derivedName) {
    html += ' <span class="muted">(derived · ' + escapeHtml(doc.nameConfidence || "") + ")</span>";
  }
  html += "<br/>" + escapeHtml(kind) + " · " + escapeHtml(doc.primaryActivity || "—") + " · " + escapeHtml(doc.primaryCategory || "—");
  if (acts) html += "<br/>Activities: " + escapeHtml(acts);
  html += "<br/>OSM: <code>" + escapeHtml(routeSelectKey(doc)) + "</code>";
  if (doc.destinationGroupId) html += "<br/>Group: <code>" + escapeHtml(doc.destinationGroupId) + "</code>";
  if (doc.kind === "unexplored_route") {
    if (doc.distanceMeters) html += "<br/>Route length: " + escapeHtml(formatDistance(doc.distanceMeters));
    if (doc.routeShapeHint) html += "<br/>Route type: " + escapeHtml(routeShapeLabel(doc.routeShapeHint));
    if (lineCount) html += "<br/>Route line: " + lineCount + " points";
  }
  if (!compact && doc.supportMetadata) {
    html += '<div id="preview-support-section">';
    html += buildSupportMetaHtml(doc);
    html += "</div>";
  }
  if (tagLines) {
    html += '<details class="support-meta"><summary>Raw OSM tags</summary><span class="muted">' + tagLines + "</span></details>";
  }
  if (doc.filteredOut) {
    html += '<br/><span class="filter-reason">' + escapeHtml(doc.filterReason || "hidden") + "</span>";
    if (doc.attachedTo) html += '<br/><span class="muted">→ ' + escapeHtml(doc.attachedTo.displayName) + "</span>";
  }
  html += "</div>";
  return html;
}

function resolveDetailDoc(doc) {
  if (!doc || !doc.attachedToRouteId) return doc;
  var parent = previewDocs.find(function (d) {
    return d.destinationGroupId === doc.attachedToRouteId;
  });
  if (!parent && doc.attachedTo) {
    parent = previewDocs.find(function (d) {
      return d.kind === "unexplored_route"
        && d.osmType === doc.attachedTo.osmType
        && d.osmId === doc.attachedTo.osmId;
    });
  }
  return parent || doc;
}

function openUnexploredItem(doc) {
  var fromSupport = Boolean(doc && doc.attachedToRouteId);
  doc = resolveDetailDoc(doc);
  if (!doc) return;
  selectedPreviewDocId = doc.id;
  $("mapSidebar").innerHTML = buildPreviewDetailHtml(doc, false);
  if (fromSupport) {
    var section = document.getElementById("preview-support-section");
    if (section) {
      var details = section.querySelector("details.support-meta");
      if (details) details.open = true;
      section.classList.add("support-highlight");
      section.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
  renderPreviewResults(getFilteredPreviewDocs());
  drawAllPreviewOnMap();
  if (!previewMap) return;
  if (doc.kind === "unexplored_route") {
    var hasLine = (doc.routeLineCoordinates && doc.routeLineCoordinates.length >= 2)
      || (doc.routeLineSegments && doc.routeLineSegments.some(function (s) { return s && s.length >= 2; }));
    if (hasLine) fitPreviewDocs([doc]);
    else {
      var mp = routeMarkerPoint(doc);
      if (mp) previewMap.flyTo({ center: [mp.lng, mp.lat], zoom: Math.max(previewMap.getZoom(), 13), duration: 500 });
    }
  } else if (doc.lat != null && doc.lng != null) {
    previewMap.flyTo({ center: [doc.lng, doc.lat], zoom: Math.max(previewMap.getZoom(), 13), duration: 500 });
  }
}

function initPreviewMap() {
  if (previewMap) return;
  previewMap = new maplibregl.Map({
    container: "previewMap",
    style: OSM_STYLE,
    center: [HARTLAND_VT_CENTER.lng, HARTLAND_VT_CENTER.lat],
    zoom: DEFAULT_MAP_ZOOM,
  });
  previewMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  previewMap.on("load", function () {
    previewMapReady = true;
    ensurePreviewRouteLayers();
    if (previewDocs.length) scheduleMapRenderUpdate();
  });
  previewMap.on("moveend", scheduleMapRenderUpdate);
}

function hikingTrailColor(name) {
  var key = String(name || "").toLowerCase().trim();
  var hash = 0;
  for (var i = 0; i < key.length; i++) hash = ((hash * 31) + key.charCodeAt(i)) | 0;
  return TRAIL_FALLBACK_COLORS[Math.abs(hash) % TRAIL_FALLBACK_COLORS.length];
}

function isHikingTrailMerged(doc) {
  return (doc.warnings || []).indexOf("v2_hiking_trail_merged") >= 0;
}

function appendRouteFeatures(features, hitFeatures, startFeatures, startHitFeatures, doc) {
  if (!passesQualityVisibility(doc)) return;
  if (doc.kind !== "unexplored_route") return;
  if (!routeHasRenderableLine(doc)) return;
  var merged = isHikingTrailMerged(doc);
  var trailLike = isTrailLikeRouteForMap(doc);
  var showAsTrail = trailLike || merged;
  var colorLabel = doc.displayName || doc.id || "";
  var baseColor = doc.routeLineColor || (showAsTrail ? hikingTrailColor(colorLabel) : "#64748b");
  var selected = selectedPreviewDocId === doc.id;
  var color = baseColor;
  var width = selected ? (showAsTrail ? 5 : 3) : (showAsTrail ? 3 : 1.5);
  var opacity = selected ? 0.95 : (showAsTrail ? 0.4 : 0.26);
  var selectKey = routeSelectKey(doc);
  previewDocBySelectKey[selectKey] = doc;
  var baseProps = {
    id: doc.id,
    selectKey: selectKey,
    name: doc.displayName || "",
    color: color,
    width: width,
    opacity: opacity,
    merged: merged,
    selected: selected,
    hitWidth: ROUTE_HIT_WIDTH,
  };
  function pushPair(coords, segmentIdx) {
    if (!coords || coords.length < 2) return;
    var geometry = {
      type: "LineString",
      coordinates: coords.map(function (p) { return [p.lng, p.lat]; }),
    };
    features.push({
      type: "Feature",
      properties: Object.assign({}, baseProps, segmentIdx == null ? {} : { segment: segmentIdx }),
      geometry: geometry,
    });
    hitFeatures.push({
      type: "Feature",
      properties: { selectKey: selectKey, hitWidth: ROUTE_HIT_WIDTH },
      geometry: geometry,
    });
  }
  if (doc.routeLineSegments && doc.routeLineSegments.length) {
    doc.routeLineSegments.forEach(function (seg, idx) { pushPair(seg, idx); });
  } else {
    pushPair(doc.routeLineCoordinates, null);
  }

  var start = routeMarkerPoint(doc);
  if (start && showAsTrail) {
    var startProps = {
      selectKey: selectKey,
      color: color,
      opacity: selected ? 0.95 : 0.55,
      selected: selected,
      radius: selected ? 9 : 7,
      hitRadius: 14,
    };
    var point = { type: "Point", coordinates: [start.lng, start.lat] };
    startFeatures.push({ type: "Feature", properties: startProps, geometry: point });
    startHitFeatures.push({
      type: "Feature",
      properties: { selectKey: selectKey, hitRadius: 14 },
      geometry: point,
    });
  }
}

function buildRoutesGeoJson(docs, includeHitTargets) {
  previewDocBySelectKey = {};
  var features = [];
  var hitFeatures = [];
  var startFeatures = [];
  var startHitFeatures = [];
  var withHit = includeHitTargets !== false;
  (docs || []).forEach(function (doc) {
    appendRouteFeatures(features, withHit ? hitFeatures : [], startFeatures, withHit ? startHitFeatures : [], doc);
  });
  return {
    visible: { type: "FeatureCollection", features: features },
    hit: { type: "FeatureCollection", features: hitFeatures },
    starts: { type: "FeatureCollection", features: startFeatures },
    startsHit: { type: "FeatureCollection", features: startHitFeatures },
  };
}

function ensurePreviewRouteLayers() {
  if (!previewMap || !previewMapReady) return;
  if (!previewMap.getSource(PREVIEW_ROUTES_SOURCE)) {
    previewMap.addSource(PREVIEW_ROUTES_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    previewMap.addSource(PREVIEW_ROUTES_HIT_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    previewMap.addSource(PREVIEW_ROUTE_STARTS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    previewMap.addSource(PREVIEW_ROUTE_STARTS_LAYER + "-hit", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    previewMap.addLayer({
      id: PREVIEW_ROUTES_LAYER,
      type: "line",
      source: PREVIEW_ROUTES_SOURCE,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["get", "width"],
        "line-opacity": ["get", "opacity"],
      },
    });
    previewMap.addLayer({
      id: PREVIEW_ROUTE_STARTS_LAYER,
      type: "circle",
      source: PREVIEW_ROUTE_STARTS_SOURCE,
      paint: {
        "circle-radius": ["get", "radius"],
        "circle-color": ["get", "color"],
        "circle-opacity": ["get", "opacity"],
        "circle-stroke-width": ["case", ["get", "selected"], 2, 0],
        "circle-stroke-color": "#ffffff",
      },
    });
    previewMap.addLayer({
      id: PREVIEW_ROUTES_HIT_LAYER,
      type: "line",
      source: PREVIEW_ROUTES_HIT_SOURCE,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#000000",
        "line-width": ["get", "hitWidth"],
        "line-opacity": 0.01,
      },
    });
    previewMap.addLayer({
      id: PREVIEW_ROUTE_STARTS_HIT_LAYER,
      type: "circle",
      source: PREVIEW_ROUTE_STARTS_LAYER + "-hit",
      paint: {
        "circle-radius": ["get", "hitRadius"],
        "circle-color": "#000000",
        "circle-opacity": 0.01,
      },
    });
  }
  if (!routeClickBound) {
    routeClickBound = true;
    function openFromSelectKey(key) {
      if (key && previewDocBySelectKey[key]) openUnexploredItem(previewDocBySelectKey[key]);
    }
    previewMap.on("click", PREVIEW_ROUTES_HIT_LAYER, function (e) {
      var feature = e.features && e.features[0];
      if (!feature || !feature.properties) return;
      openFromSelectKey(feature.properties.selectKey);
    });
    previewMap.on("click", PREVIEW_ROUTE_STARTS_HIT_LAYER, function (e) {
      var feature = e.features && e.features[0];
      if (!feature || !feature.properties) return;
      openFromSelectKey(feature.properties.selectKey);
    });
    previewMap.on("mouseenter", PREVIEW_ROUTES_HIT_LAYER, function () {
      previewMap.getCanvas().style.cursor = "pointer";
    });
    previewMap.on("mouseleave", PREVIEW_ROUTES_HIT_LAYER, function () {
      previewMap.getCanvas().style.cursor = "";
    });
    previewMap.on("mouseenter", PREVIEW_ROUTE_STARTS_HIT_LAYER, function () {
      previewMap.getCanvas().style.cursor = "pointer";
    });
    previewMap.on("mouseleave", PREVIEW_ROUTE_STARTS_HIT_LAYER, function () {
      previewMap.getCanvas().style.cursor = "";
    });
  }
}

function clearPreviewMapMarkers() {
  previewMarkers.forEach(function (m) { m.remove(); });
  previewMarkers = [];
  previewMarkerByDocId = {};
  previewDocBySelectKey = {};
  clearClusterMarkers();
  if (previewMap && previewMapReady && previewMap.getSource(PREVIEW_ROUTES_SOURCE)) {
    previewMap.getSource(PREVIEW_ROUTES_SOURCE).setData({ type: "FeatureCollection", features: [] });
    if (previewMap.getSource(PREVIEW_ROUTES_HIT_SOURCE)) {
      previewMap.getSource(PREVIEW_ROUTES_HIT_SOURCE).setData({ type: "FeatureCollection", features: [] });
    }
    if (previewMap.getSource(PREVIEW_ROUTE_STARTS_SOURCE)) {
      previewMap.getSource(PREVIEW_ROUTE_STARTS_SOURCE).setData({ type: "FeatureCollection", features: [] });
    }
    if (previewMap.getSource(PREVIEW_ROUTE_STARTS_LAYER + "-hit")) {
      previewMap.getSource(PREVIEW_ROUTE_STARTS_LAYER + "-hit").setData({ type: "FeatureCollection", features: [] });
    }
  }
}

function docCoords(doc) {
  if (doc.lat == null || doc.lng == null) return null;
  return { lat: doc.lat, lng: doc.lng };
}

function routeMarkerEmoji(doc) {
  if (isHikingTrailMerged(doc)) return "🥾";
  const tags = doc.sourceTagSample || {};
  if (tags.amenity === "parking" || (doc.primaryCategory || "").toLowerCase().includes("parking")) return "🅿️";
  return activityEmoji(doc.primaryActivity || doc.primaryCategory);
}

function isTagCoverageOnly(doc) {
  return (doc.warnings || []).indexOf("v2_tag_coverage_only") >= 0;
}

function isRawOsmDoc(doc) {
  return (doc.warnings || []).indexOf("v2_raw_osm_unfiltered") >= 0;
}

function addPreviewMarker(doc) {
  if (!passesQualityVisibility(doc)) return null;
  if (doc.kind === "unexplored_route") return null;
  const c = docCoords(doc);
  if (!c || !previewMap) return null;
  const isRoute = previewKindLabel(doc) === "route";
  const el = document.createElement("div");
  el.className = "emoji-marker" + (isRoute ? " route" : "");
  if (isQualityHidden(doc)) el.style.opacity = "0.45";
  else if (isTagCoverageOnly(doc) && !isRawOsmDoc(doc)) el.style.opacity = "0.72";
  el.textContent = isRoute ? routeMarkerEmoji(doc) : activityEmoji(doc.primaryActivity || doc.primaryCategory);
  el.addEventListener("click", function (ev) {
    ev.stopPropagation();
    openUnexploredItem(doc);
  });
  const marker = new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat([c.lng, c.lat])
    .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(buildPreviewPopupHtml(doc)))
    .addTo(previewMap);
  previewMarkers.push(marker);
  previewMarkerByDocId[doc.id] = marker;
  return marker;
}

function fitMapToVisibleRouteGeometry() {
  if (!previewMap) return;
  var docs = (previewDocs || []).filter(function (d) {
    return passesQualityVisibility(d) && routeHasRenderableLine(d);
  });
  if (docs.length) fitPreviewDocs(docs);
}

function fitPreviewDocs(docs) {
  if (!previewMap || !docs.length) return;
  const coords = [];
  docs.forEach(function (doc) {
    const c = docCoords(doc);
    if (c) coords.push(c);
    if (doc.routeLineCoordinates) doc.routeLineCoordinates.forEach(function (p) { coords.push(p); });
    if (doc.routeLineSegments) doc.routeLineSegments.forEach(function (seg) {
      if (seg) seg.forEach(function (p) { coords.push(p); });
    });
  });
  if (!coords.length) return;
  var bounds = safeLngLatBounds(coords);
  if (!bounds) return;
  previewMap.fitBounds(bounds, { padding: 48, duration: 500, maxZoom: 14 });
}

function isSupportOnlyMapDoc(doc) {
  if (showSupportMarkersOnMap) return false;
  // Primary routes carry destinationGroupId for grouping; only attached children are support-only.
  if (doc.kind === "unexplored_route" && routeHasRenderableLine(doc)) return false;
  if (doc.attachedTo || doc.attachedToRouteId) return true;
  var tags = doc.sourceTagSample || {};
  if (tags.amenity === "bench" || tags.amenity === "bbq" || tags.leisure === "picnic_table") return true;
  if (tags.amenity === "parking" || tags.amenity === "toilets") return true;
  return false;
}

function buildMapRenderItems(sourceDocs) {
  var t0 = performance.now();
  var zoom = previewMap ? previewMap.getZoom() : DEFAULT_MAP_ZOOM;
  var totalVisible = (sourceDocs || []).filter(function (d) { return passesQualityVisibility(d); }).length;
  var toRender = [];
  (sourceDocs || []).forEach(function (doc) {
    if (!passesQualityVisibility(doc)) return;
    if (isSupportOnlyMapDoc(doc)) return;
    toRender.push(doc);
  });
  var routeCount = toRender.filter(function (d) { return d.kind === "unexplored_route"; }).length;
  var trailRouteCount = toRender.filter(function (d) {
    return d.kind === "unexplored_route" && routeHasRenderableLine(d) && isTrailLikeRouteForMap(d);
  }).length;
  var spotCount = toRender.length - routeCount;
  mapRenderStats = {
    totalVisibleItems: totalVisible,
    itemsInViewport: toRender.length,
    renderedMarkers: spotCount,
    renderedRoutes: routeCount,
    trailLikeRoutes: trailRouteCount,
    clustersRendered: 0,
    zoomLevel: zoom,
    detailLevel: "all",
    renderCapApplied: false,
    hiddenByZoomCount: 0,
    hiddenOutsideViewportCount: 0,
    renderCalculationMs: Math.round(performance.now() - t0),
    includeRouteHitTargets: true,
  };
  lastMapRenderItems = toRender;
  return toRender;
}

function clearClusterMarkers() {
  previewClusterMarkers.forEach(function (m) { m.remove(); });
  previewClusterMarkers = [];
}

function placeSpotMarkers(spotDocs) {
  spotDocs.forEach(function (doc) { addPreviewMarker(doc); });
  return spotDocs.length;
}

function renderMapRenderStatsPanel() {
  var el = $("mapRenderStats");
  if (!el || !mapRenderStats) { if (el) el.textContent = ""; return; }
  var s = mapRenderStats;
  var rendered = s.renderedMarkers + s.renderedRoutes;
  var note = "Showing " + rendered + " scanned item(s) (" + s.renderedRoutes + " routes, " + s.renderedMarkers + " spots)";
  if (s.trailLikeRoutes) note += " · " + s.trailLikeRoutes + " hiking/trail lines";
  if (s.routeLineFeatures != null) note += " · " + s.routeLineFeatures + " line segment(s)";
  note += " · " + s.renderCalculationMs + "ms";
  el.textContent = note;
}

function drawMapRenderPipeline() {
  if (!previewMap || !previewMapReady) return;
  if (mapRenderInFlight) {
    mapRenderQueued = true;
    return;
  }
  mapRenderInFlight = true;
  try {
    var mapRenderItems = buildMapRenderItems(previewDocs);
    var routes = mapRenderItems.filter(function (d) { return d.kind === "unexplored_route"; });
    var spots = mapRenderItems.filter(function (d) { return d.kind !== "unexplored_route"; });
    clearPreviewMapMarkers();
    clearClusterMarkers();
    placeSpotMarkers(spots);
    ensurePreviewRouteLayers();
    if (previewMap.getSource(PREVIEW_ROUTES_SOURCE)) {
      var routeData = buildRoutesGeoJson(routes, true);
      previewMap.getSource(PREVIEW_ROUTES_SOURCE).setData(routeData.visible);
      if (previewMap.getSource(PREVIEW_ROUTES_HIT_SOURCE)) {
        previewMap.getSource(PREVIEW_ROUTES_HIT_SOURCE).setData(routeData.hit);
      }
      if (previewMap.getSource(PREVIEW_ROUTE_STARTS_SOURCE)) {
        previewMap.getSource(PREVIEW_ROUTE_STARTS_SOURCE).setData(routeData.starts);
      }
      if (previewMap.getSource(PREVIEW_ROUTE_STARTS_LAYER + "-hit")) {
        previewMap.getSource(PREVIEW_ROUTE_STARTS_LAYER + "-hit").setData(routeData.startsHit);
      }
      if (mapRenderStats) {
        mapRenderStats.routeLineFeatures = routeData.visible.features.length;
        mapRenderStats.trailStartMarkers = routeData.starts.features.length;
      }
    }
    renderMapRenderStatsPanel();
  } catch (err) {
    console.error("[pbf-copier-v2] map render failed", err);
    setStatus("warn", "Map render error after zoom/pan — try zooming in slightly. " + (err && err.message ? err.message : String(err)));
  } finally {
    mapRenderInFlight = false;
    if (mapRenderQueued) {
      mapRenderQueued = false;
      scheduleMapRenderUpdate();
    }
  }
}

function scheduleMapRenderUpdate() {
  if (mapRenderDebounceTimer) clearTimeout(mapRenderDebounceTimer);
  mapRenderDebounceTimer = setTimeout(function () {
    mapRenderDebounceTimer = null;
    drawMapRenderPipeline();
  }, MAP_RENDER_CONFIG.debounceMs);
}

function drawAllPreviewOnMap() {
  scheduleMapRenderUpdate();
}

function previewSearchHaystack(doc) {
  const tags = Object.entries(doc.sourceTagSample || {}).map(function (e) { return e[0] + "=" + e[1]; }).join(" ");
  return [
    doc.displayName, doc.primaryActivity, doc.primaryCategory,
    (doc.activities || []).join(" "), doc.id, doc.osmType, doc.osmId, tags,
  ].join(" ").toLowerCase();
}

function getFilteredPreviewDocs() {
  const q = ($("previewSearchInput").value || "").trim().toLowerCase();
  const kind = $("previewFilterKind").value;
  const activePreset = document.querySelector(".preview-preset.active");
  const preset = activePreset ? activePreset.getAttribute("data-preset") : null;
  const presetTerms = {
    hiking: ["hik", "walk", "trail"],
    swimming: ["swim", "beach", "water"],
    viewpoints: ["view", "lookout", "scenic"],
    offroad: ["offroad", "class4", "class6"],
    waterfall: ["waterfall", "falls"],
  };
  return previewDocs.filter(function (doc) {
    if (!passesQualityVisibility(doc)) return false;
    if (kind === "spot" && doc.kind !== "unexplored_spot") return false;
    if (kind === "route" && doc.kind !== "unexplored_route") return false;
    if (q && previewSearchHaystack(doc).indexOf(q) < 0) return false;
    if (preset) {
      const terms = presetTerms[preset] || [];
      const hay = previewSearchHaystack(doc);
      if (!terms.some(function (t) { return hay.indexOf(t) >= 0; })) return false;
    }
    return true;
  });
}

function renderScanStats(stats) {
  if (!stats) { $("scanStatsGrid").style.display = "none"; return; }
  $("scanStatsGrid").style.display = "grid";
  const items = [
    ["Raw scanned", stats.rawObjectsScanned],
    ["On map", stats.itemsReturned],
    ["Homes filtered", stats.residentialHomesFiltered ?? "—"],
    ["Hiking trails", stats.hikingTrailGroupsMerged ?? "—"],
    ["Trail segments merged", stats.hikingTrailSegmentsCollapsed ?? "—"],
    ["Spots", (previewDocs || []).filter(function (d) { return d.kind === "unexplored_spot"; }).length],
    ["Elapsed ms", stats.elapsedMs],
  ];
  $("scanStatsGrid").innerHTML = items.map(function (p) {
    return '<div class="stat-box"><div class="stat-label">' + p[0] + '</div><div class="stat-value">' + p[1] + '</div></div>';
  }).join("");
}

function renderPreviewResults(filtered) {
  const rawCount = rawItemCount || (qualityFilterSummary ? qualityFilterSummary.rawItems : 0) || previewDocsRaw.length || previewDocs.length;
  const hiddenCount = qualityFilterSummary
    ? qualityFilterSummary.hiddenItems
    : previewDocs.filter(function (d) { return isQualityHidden(d); }).length;
  const visibleCount = qualityFilterSummary
    ? qualityFilterSummary.visibleItems
    : previewDocs.filter(function (d) { return !isQualityHidden(d); }).length;
  $("previewResultCount").textContent = String(filtered.length);
  $("previewResultVisible").textContent = String(visibleCount);
  $("previewResultHidden").textContent = String(hiddenCount);
  $("previewResultTotal").textContent = String(rawCount);
  const tbody = $("previewResultsBody");
  tbody.innerHTML = "";
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="muted">' + (previewDocs.length ? "No items match your filters." : "No items loaded — try re-scanning.") + '</td></tr>';
    return;
  }
  const tableRows = filtered.length > TABLE_ROW_CAP ? filtered.slice(0, TABLE_ROW_CAP) : filtered;
  tableRows.forEach(function (doc) {
    const tr = document.createElement("tr");
    tr.className = previewKindLabel(doc) + (selectedPreviewDocId === doc.id ? " selected" : "") + (isQualityHidden(doc) ? " quality-hidden" : "");
    const acts = (doc.activities || []).slice(0, 4).join(", ");
    const tagSummary = Object.entries(doc.sourceTagSample || {}).slice(0, 3).map(function (e) { return e[0] + "=" + e[1]; }).join("; ");
    const filterCell = isQualityHidden(doc)
      ? '<span class="filter-reason">' + escapeHtml(doc.filterReason || (doc.filteredBy || []).join(", "))
        + (doc.attachedTo ? '<br/><span class="muted">→ ' + escapeHtml(doc.attachedTo.displayName || "") + '</span>' : "")
        + '</span>'
      : '<span class="muted">—</span>';
    const supportMeta = buildSupportMetaHtml(doc);
    tr.innerHTML =
      '<td>' + escapeHtml(previewKindLabel(doc)) + '</td>' +
      '<td>' + escapeHtml(doc.displayName || "(unnamed)") + supportMeta + '</td>' +
      '<td>' + escapeHtml(doc.primaryActivity || "—") + '</td>' +
      '<td class="muted">' + escapeHtml(acts) + '</td>' +
      '<td>' + escapeHtml(doc.primaryCategory || "—") + '</td>' +
      '<td class="muted">' + escapeHtml(tagSummary || "—") + '</td>' +
      '<td>' + filterCell + '</td>' +
      '<td><code>' + escapeHtml(doc.osmType + "/" + doc.osmId) + '</code></td>' +
      '<td class="muted">' + Number(doc.lat).toFixed(5) + ", " + Number(doc.lng).toFixed(5) + '</td>' +
      '<td><button type="button" class="small view-preview-map">Map</button></td>';
    tr.querySelector(".view-preview-map").addEventListener("click", function (e) {
      e.stopPropagation();
      openUnexploredItem(doc);
    });
    tr.addEventListener("click", function () { openUnexploredItem(doc); });
    tbody.appendChild(tr);
  });
  if (filtered.length > TABLE_ROW_CAP) {
    const note = document.createElement("tr");
    note.innerHTML = '<td colspan="10" class="muted">Showing first ' + TABLE_ROW_CAP + ' of ' + filtered.length + ' matches — use search to narrow.</td>';
    tbody.appendChild(note);
  }
}

function showPreviewOnMap(doc) {
  openUnexploredItem(doc);
}

function refreshResultsUi() {
  const filtered = getFilteredPreviewDocs();
  renderPreviewResults(filtered);
  drawAllPreviewOnMap();
  var mapNote = "";
  if (mapRenderStats) {
    mapNote = "Map: " + (mapRenderStats.renderedMarkers + mapRenderStats.renderedRoutes)
      + " shown in view";
  } else {
    mapNote = "Map: viewport rendering";
  }
  if (qualityFilterSummary) mapNote += " · " + qualityFilterSummary.hiddenItems + " hidden by filters";
  $("viewportCount").textContent = mapNote;
}

async function scanViewport() {
  if (scanInFlight) return;
  const pbfPath = ($("filePath").value || "").trim();
  if (!pbfPath) { setStatus("warn", "Enter a PBF file path first."); return; }
  initPreviewMap();
  const bbox = readMapBbox();
  if (!bbox) { setStatus("error", "Map not ready — wait for map load."); return; }
  scanInFlight = true;
  $("btnShowAllPosts").disabled = true;
  previewDocs = [];
  previewDocsRaw = [];
  scanCacheId = null;
  rawItemCount = 0;
  qualityFilterSummary = null;
  groupingSummary = null;
  clearPreviewMapMarkers();
  setStatus("loading", "Scanning entire PBF for all OSM objects in viewport… (no filter, no Firebase write)");
  try {
    const json = await api("/viewport-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pbfPath,
        bbox,
        mode: "raw_osm",
        qualityFilterSettings: readQualityFilterSettings(),
      }),
    });
    const data = json.data || json;
    if (!data.items || !data.items.length) {
      previewDocs = [];
      scanCacheId = data.cacheId || null;
      rawItemCount = data.rawItemCount || 0;
      renderQualityFilterStats(null);
      $("viewportCount").textContent = "0 items in viewport";
      updateCopyJsonButton();
      setStatus("warn", "Scan complete — no OSM objects with geometry in this viewport bbox.");
    } else {
      scanCacheId = data.cacheId || null;
      rawItemCount = data.rawItemCount || data.stats?.itemsReturned || data.items.length;
      previewDocs = data.items;
      qualityFilterSummary = data.summary || null;
      groupingSummary = data.groupingSummary || null;
      locavaProductSummary = data.locavaProductSummary || null;
      renderQualityFilterStats(qualityFilterSummary);
      renderScanStats(data.stats);
      refreshResultsUi();
      fitMapToVisibleRouteGeometry();
      updateCopyJsonButton();
      const summary = qualityFilterSummary;
      const visible = summary ? summary.visibleItems : previewDocs.length;
      const hidden = summary ? summary.hiddenItems : 0;
      setStatus("ok", "Scan complete — " + rawItemCount + " raw OSM items (" + visible + " visible, " + hidden + " hidden). "
        + (data.stats && data.stats.elapsedMs) + " ms. Read-only.");
    }
    lastScanBbox = bbox;
    lastScanStats = data.stats || null;
    $("qualityFiltersPanel").style.display = "block";
    $("resultsPanel").style.display = "block";
    showWritePanel();
    resetWriteState();
  } catch (err) {
    setStatus("error", err.message || String(err));
  } finally {
    scanInFlight = false;
    $("btnShowAllPosts").disabled = false;
  }
}

function bindControls() {
  $("btnValidateFile").addEventListener("click", function () { void validateFile(); });
  $("btnShowAllPosts").addEventListener("click", function () { void scanViewport(); });
  $("btnFitPreview").addEventListener("click", function () { fitPreviewDocs(getFilteredPreviewDocs()); });
  $("btnClearMap").addEventListener("click", function () {
    previewDocs = [];
    previewDocsRaw = [];
    scanCacheId = null;
    rawItemCount = 0;
    lastScanBbox = null;
    lastScanStats = null;
    qualityFilterSummary = null;
    groupingSummary = null;
    locavaProductSummary = null;
    clearPreviewMapMarkers();
    $("viewportCount").textContent = "";
    $("mapSidebar").textContent = "";
    $("copyJsonStatus").textContent = "";
    $("qualityFiltersPanel").style.display = "none";
    renderQualityFilterStats(null);
    $("resultsPanel").style.display = "none";
    $("writePanel").style.display = "none";
    resetWriteState();
    updateCopyJsonButton();
    setStatus("ok", "Map cleared.");
  });
  $("btnCopyJson").addEventListener("click", function () { void copyOutputJson(); });
  $("btnGoHowland").addEventListener("click", function () {
    initPreviewMap();
    if (!previewMap) return;
    previewMap.flyTo({
      center: [HOWLAND_DAM_CENTER.lng, HOWLAND_DAM_CENTER.lat],
      zoom: 14,
      duration: 600,
    });
    setStatus("ok", "Map centered on Lake Pinneo / Howland Dam — click Show all posts on map to scan this viewport.");
  });
  $("btnGoMarshBillings").addEventListener("click", function () {
    initPreviewMap();
    if (!previewMap) return;
    previewMap.flyTo({
      center: [MARSH_BILLINGS_CENTER.lng, MARSH_BILLINGS_CENTER.lat],
      zoom: 15,
      duration: 600,
    });
    setStatus("ok", "Map centered on Marsh-Billings (McKnight / Barrette platform) — scan viewport to load posts.");
  });
  $("previewSearchInput").addEventListener("input", refreshResultsUi);
  $("previewFilterKind").addEventListener("change", refreshResultsUi);
  document.querySelectorAll(".preview-preset").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const active = btn.classList.contains("active");
      document.querySelectorAll(".preview-preset").forEach(function (b) { b.classList.remove("active"); });
      if (!active) btn.classList.add("active");
      refreshResultsUi();
    });
  });
  [
    "qfHideInfrastructure",
    "qfHideServiceRoads",
    "qfHideAdministrative",
    "qfHideRailway",
    "qfHideBroadGeography",
    "qfHideUnnamedLand",
    "qfHideUnnamedPaths",
    "qfHideUnattachedBenches",
    "qfHideUnattachedParking",
    "qfAttachSupport",
    "qfShowSupportMarkers",
  ].forEach(function (id) {
    $(id).addEventListener("change", function () {
      syncSupportMarkerToggle();
      void reapplyQualityFilters();
    });
  });
  syncSupportMarkerToggle();
  $("qfShowHidden").addEventListener("change", function () {
    showHiddenFiltered = $("qfShowHidden").checked;
    refreshResultsUi();
  });
  $("writeOverwrite").addEventListener("change", function () {
    if ($("writeOverwrite").checked) $("writeSkipExisting").checked = false;
  });
  $("writeSkipExisting").addEventListener("change", function () {
    if ($("writeSkipExisting").checked) $("writeOverwrite").checked = false;
  });
  $("btnValidateWrite").addEventListener("click", function () { void validateWritePayload(); });
  $("btnDryRunWrite").addEventListener("click", function () { void dryRunWrite(); });
  $("btnWriteBlankSpots").addEventListener("click", function () { void writeBlankSpots(); });
  $("btnResetWrite").addEventListener("click", resetWriteState);
}

try {
  initPreviewMap();
  bindControls();
} catch (err) {
  setStatus("error", "Page init failed: " + (err && err.message ? err.message : String(err)));
}
</script>
</body>
</html>`;
}
