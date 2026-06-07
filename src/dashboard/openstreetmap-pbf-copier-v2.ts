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
    .write-ready-banner{margin:14px 0;padding:16px 18px;border-radius:12px;border:2px solid #166534;background:linear-gradient(180deg,#052e16 0%,#111827 100%)}
    .write-ready-banner h3{margin:0 0 12px;font-size:15px;color:#86efac;text-transform:none;letter-spacing:0}
    .write-ready-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
    .write-ready-box{background:#020617;border:1px solid #1f2937;border-radius:10px;padding:14px 16px}
    .write-ready-box.spots{border-color:#166534}
    .write-ready-box.routes{border-color:#0369a1}
    .write-ready-box.total{border-color:#854d0e}
    .write-ready-label{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em}
    .write-ready-value{font-size:32px;font-weight:800;margin-top:6px;line-height:1.1}
    .write-ready-box.spots .write-ready-value{color:#4ade80}
    .write-ready-box.routes .write-ready-value{color:#38bdf8}
    .write-ready-box.total .write-ready-value{color:#fcd34d}
    .undiscovered-live-banner{margin:14px 0;padding:18px 20px;border-radius:12px;border:2px solid #0369a1;background:linear-gradient(180deg,#0c4a6e33 0%,#111827 100%)}
    .undiscovered-live-banner h2{margin:0 0 12px;font-size:14px;color:#7dd3fc;text-transform:uppercase;letter-spacing:.05em}
    .undiscovered-live-banner .live-count-total .write-ready-value{color:#fcd34d;font-size:40px}
    .write-status-panel summary{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;list-style:none}
    .write-status-panel summary::-webkit-details-marker{display:none}
    .write-status-panel[open] summary h2{color:#86efac}
    .write-status-panel summary h2{margin:0;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#cbd5e1}
    .write-console{margin-top:12px;background:#020617;border:1px solid #1f2937;border-radius:8px;padding:10px 12px;max-height:220px;overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.45;color:#cbd5e1;white-space:pre-wrap}
    .write-console .line-err{color:#fca5a5}
    .write-console .line-ok{color:#86efac}
    .purge-danger-panel{border:2px solid #b91c1c;background:linear-gradient(180deg,#450a0a33 0%,#111827 100%)}
    .purge-danger-panel h2{color:#fecaca;text-transform:none;letter-spacing:0}
    .scary{color:#fca5a5}
    #purgeUndiscoveredModal{position:fixed;inset:0;background:rgba(2,6,23,.85);display:none;align-items:center;justify-content:center;z-index:10000;padding:16px}
    #purgeUndiscoveredModal.open{display:flex}
    .purge-modal-inner{background:#111827;border:3px solid #b91c1c;border-radius:14px;padding:22px 24px;max-width:520px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.5)}
    .purge-modal-inner input[type=text],.purge-modal-inner input[type=password]{width:100%;margin:8px 0 12px;padding:10px 12px;font-size:14px}
    .asset-preview-panel{border-color:#166534;background:linear-gradient(180deg,#052e1633 0%,#111827 100%)}
    .asset-preview-panel h2{color:#86efac;text-transform:none;letter-spacing:0;font-size:15px}
    .asset-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:10px}
    .asset-photo-card{border:1px solid #334155;border-radius:10px;background:#020617;overflow:hidden}
    .asset-photo-thumb{aspect-ratio:4/3;background:#1e293b;position:relative;overflow:hidden}
    .asset-photo-thumb img{width:100%;height:100%;object-fit:cover;display:block}
    .asset-photo-body{padding:8px 10px 10px;font-size:11px;line-height:1.4}
    .asset-photo-rank{position:absolute;top:6px;left:6px;background:rgba(2,6,23,.85);border:1px solid #334155;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:700}
    .asset-spot-card{border:1px solid #334155;border-radius:12px;background:#0b1220;padding:12px 14px;margin:12px 0}
    .asset-spot-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}
    .asset-spot-head h3{margin:0;font-size:14px;color:#e2e8f0;text-transform:none;letter-spacing:0}
    .asset-conf{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase}
    .asset-conf.high{border:1px solid #166534;color:#86efac;background:#052e16}
    .asset-conf.medium{border:1px solid #854d0e;color:#fcd34d;background:#422006}
    .asset-conf.low{border:1px solid #b91c1c;color:#fca5a5;background:#450a0a}
    .asset-conf.skipped{border:1px solid #475569;color:#cbd5e1;background:#1e293b}
    .asset-warn{border:1px solid #854d0e;background:#422006;color:#fcd34d;border-radius:8px;padding:8px 10px;font-size:11px;margin:8px 0}
    .asset-empty{border:1px dashed #334155;border-radius:10px;padding:20px;text-align:center;color:#94a3b8;font-size:12px}
    button.tab.disabled{opacity:.45;cursor:not-allowed}
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

  <div class="undiscovered-live-banner" id="undiscoveredLiveBanner">
    <h2>Live Firestore — undiscovered map layer</h2>
    <div class="write-ready-grid">
      <div class="write-ready-box spots">
        <div class="write-ready-label">unexploredSpots</div>
        <div class="write-ready-value" id="liveUndiscoveredSpots">—</div>
      </div>
      <div class="write-ready-box routes">
        <div class="write-ready-label">unexploredRoutes</div>
        <div class="write-ready-value" id="liveUndiscoveredRoutes">—</div>
      </div>
      <div class="write-ready-box total live-count-total">
        <div class="write-ready-label">Total spots + routes</div>
        <div class="write-ready-value" id="liveUndiscoveredTotal">—</div>
      </div>
      <div class="write-ready-box routes">
        <div class="write-ready-label">unexploredTiles (native map cache)</div>
        <div class="write-ready-value" id="liveUndiscoveredTiles" style="font-size:28px">—</div>
      </div>
    </div>
    <p class="muted" id="undiscoveredLiveMeta" style="margin:10px 0 0">Loading live counts from Firestore…</p>
    <div class="row" style="margin-top:10px">
      <button type="button" class="secondary" id="btnRepairMapVisibility">Fix map visibility (existing PBF V2 writes)</button>
    </div>
  </div>

  <details class="panel write-status-panel" id="writeStatusPanel">
    <summary><h2>Write status</h2> <span id="writeStatusBadge" class="pill">idle</span></summary>
    <p class="muted" style="margin-top:0">
      Every write upserts <code>unexploredSpots</code>, <code>unexploredRoutes</code>, and nested
      <code>unexploredTiles</code> tile docs (z/x/y paths) — same as the native app map layer expects.
      Never writes <code>/posts</code>.
    </p>
    <p id="writeStatusLine" class="muted">No write in progress.</p>
    <div class="stat-grid" id="writeStatusGrid"></div>
    <p id="writeStatusErrors" class="muted" style="color:#fca5a5;margin-top:8px"></p>
    <h3 style="margin:14px 0 6px;font-size:12px;text-transform:uppercase;color:#94a3b8">Write console</h3>
    <div class="write-console" id="writeConsoleLog">No write activity yet.</div>
  </details>

  <div id="statusBar" class="muted">Ready — validate a PBF file, pan/zoom the map, then scan the current viewport.</div>

  <div class="panel purge-danger-panel" id="purgeUndiscoveredPanel">
    <h2>Remove all undiscovered map data</h2>
    <p class="muted">
      Permanently deletes <code>unexploredSpots</code>, <code>unexploredRoutes</code> (plus route
      <code>geometryChunks</code>), and the nested <code>unexploredTiles</code> map cache
      (embedded copies the app reads first — required or markers linger after spot/route delete).
      <strong class="scary">Never touches <code>/posts</code> or any other collection.</strong>
    </p>
    <p class="muted">
      Disabled unless <code id="purgeEnvVarName">OSM_PBF_COPIER_ALLOW_PURGE_UNDISCOVERED</code>=<code>true</code>
      in backend <code>.env</code> and the server was restarted.
    </p>
    <div class="row">
      <button type="button" class="secondary" id="btnPurgeUndiscoveredDryRun">Count docs (dry-run)</button>
      <button type="button" class="danger" id="btnPurgeUndiscovered">Remove ALL undiscovered (spots + routes + tiles)</button>
    </div>
    <div class="purge-inline-creds" style="margin-top:12px">
      <p class="muted" style="margin:0 0 8px">
        Count or delete requires password <strong>Cooper</strong> and the confirmation phrase below (copy/paste OK).
      </p>
      <label style="display:block;margin:6px 0">Confirmation phrase
        <input id="purgePanelPhrase" type="text" placeholder="DELETE_ALL_UNDISCOVERED_SPOTS_AND_ROUTES" autocomplete="off" style="width:100%;max-width:640px;margin-top:4px"/>
      </label>
      <label style="display:block;margin:6px 0">Production password
        <input id="purgePanelPassword" type="password" placeholder="Cooper" autocomplete="off" style="width:100%;max-width:240px;margin-top:4px"/>
      </label>
    </div>
    <p class="muted" id="purgeUndiscoveredMeta"></p>
  </div>

  <div id="purgeUndiscoveredModal" aria-hidden="true" style="display:none">
    <div class="purge-modal-inner">
      <h3 class="scary">Confirm permanent delete</h3>
      <p class="muted">
        This removes <strong>all</strong> undiscovered spots, routes, and nested map tile cache from Firestore.
        User posts are not affected.
      </p>
      <p class="muted">Type exactly: <code id="purgeConfirmPhraseHint">DELETE_ALL_UNDISCOVERED_SPOTS_AND_ROUTES</code></p>
      <input id="purgeConfirmPhrase" type="text" placeholder="Confirmation phrase" autocomplete="off" style="width:100%;margin:8px 0"/>
      <input id="purgePassword" type="password" placeholder="Production password (Cooper)" autocomplete="off" style="width:100%;margin:8px 0"/>
      <div class="row">
        <button type="button" class="secondary" id="btnConfirmPurgeDryRun">Count only (dry-run)</button>
        <button type="button" class="danger" id="btnConfirmPurgeUndiscovered">Delete all now</button>
        <button type="button" class="secondary" id="btnCancelPurgeUndiscovered">Cancel</button>
      </div>
    </div>
  </div>

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
    <h2>Run mode</h2>
    <div class="row">
      <label><input type="radio" name="runMode" id="modeBbox" value="bbox"/> BBox Preview Mode (map)</label>
      <label><input type="radio" name="runMode" id="modeFullVermont" value="full_vermont" checked/> Full Vermont File Mode</label>
    </div>
    <p class="muted" id="runModeHelp">Scan the current map viewport only — same algorithm as before.</p>
  </div>

  <div class="panel" id="fullRunPanel">
    <h2>Full Vermont Run</h2>
    <p class="muted">Processes the whole Vermont PBF in geographic tiles with checkpoint/resume. Each tile re-reads the entire PBF (slow). Enable <strong>Limit total spots</strong> for a quick test run — default 100, then auto-stops.</p>
    <div class="row">
      <label>Write mode
        <select id="fullRunMode">
          <option value="dry_run">Dry run (no DB writes)</option>
          <option value="write_test" selected>Write test (emulator)</option>
          <option value="write_prod">Write prod (explicit)</option>
        </select>
      </label>
      <label><input type="checkbox" id="fullRunLimitSpots" checked/> Limit total spots (stop when reached)</label>
      <label>Max spots
        <input id="fullRunMaxSpots" type="number" min="1" value="100" style="width:80px"/>
      </label>
      <label>Tile step °
        <input id="fullRunTileStep" type="number" min="0.2" max="1" step="0.1" value="0.4" style="width:64px"/>
      </label>
    </div>
    <div class="row">
      <button type="button" id="btnFullRunStart">Start</button>
      <button type="button" class="secondary" id="btnFullRunPause">Pause</button>
      <button type="button" class="secondary" id="btnFullRunResume">Resume</button>
      <button type="button" class="secondary" id="btnFullRunStop">Stop</button>
      <button type="button" class="success" id="btnFullRunWriteCurrent">Write Current Chunks</button>
      <button type="button" class="secondary" id="btnFullRunDryWrite">Dry Run Write</button>
      <button type="button" class="secondary" id="btnFullRunTestWrite">Write Test</button>
      <button type="button" class="danger" id="btnFullRunProdWrite">Write to DB</button>
    </div>
    <div class="write-ready-banner" id="fullRunWriteReadyBanner" style="display:none">
      <h3>Ready to write (deduped across processed chunks)</h3>
      <div class="write-ready-grid">
        <div class="write-ready-box spots">
          <div class="write-ready-label">Spots → unexploredSpots</div>
          <div class="write-ready-value" id="fullRunWriteReadySpots">—</div>
        </div>
        <div class="write-ready-box routes">
          <div class="write-ready-label">Routes → unexploredRoutes</div>
          <div class="write-ready-value" id="fullRunWriteReadyRoutes">—</div>
        </div>
        <div class="write-ready-box total">
          <div class="write-ready-label">Total Firestore documents</div>
          <div class="write-ready-value" id="fullRunWriteReadyTotal">—</div>
        </div>
      </div>
      <p class="muted" id="fullRunWriteReadyMeta" style="margin:10px 0 0"></p>
    </div>
    <p id="fullRunStatusLine" class="muted">No full run started.</p>
    <div class="stat-grid" id="fullRunStatsGrid"></div>
    <p id="fullRunValidation" class="muted" style="margin-top:8px"></p>
    <p id="fullRunRunId" class="muted"></p>
  </div>

  <div class="panel asset-preview-panel" id="assetPreviewPanel" style="border-width:3px;padding:22px 24px;text-align:center">
    <h2 style="font-size:22px;margin:0 0 8px;color:#86efac">📷 Photo preview moved to its own page</h2>
    <p class="muted" style="max-width:560px;margin:0 auto 18px;font-size:14px;line-height:1.5">
      Scans <strong>vermont-latest.osm.pbf</strong> live (tile-by-tile, same V2 pipeline) and curates photos per spot —
      no saved run or dry-run artifacts needed.
    </p>
    <a href="/admin/openstreetmap/pbf-photo-preview" style="display:inline-block;background:#16a34a;color:#fff;font-weight:800;font-size:17px;padding:14px 28px;border-radius:12px;text-decoration:none;box-shadow:0 4px 18px rgba(22,163,74,.4)">
      Open PBF Photo Preview →
    </a>
  </div>

  <div class="panel" id="mapPanel">
    <h2>Map</h2>
    <p class="muted">Scan the PBF viewport, or load what is already in Firestore and fit the map to all undiscovered spots/routes (same data the native app uses).</p>
    <div class="row">
      <button type="button" id="btnShowAllPosts">Scan viewport (raw OSM)</button>
      <button type="button" class="secondary" id="btnLoadDbUndiscovered">Load Firestore undiscovered</button>
      <button type="button" class="secondary" id="btnFitDbUndiscovered">Fit all in DB</button>
      <button type="button" class="secondary" id="btnFitPreview">Fit scan results</button>
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
let fullRunId = null;
let fullRunPollTimer = null;
let lastAssetPreviewChunkCount = 0;
let fullRunWritePollTimer = null;
let undiscoveredCountsPollTimer = null;
let clientWriteConsoleLines = [];
let uiRunMode = "bbox";
let purgeUndiscoveredConfirmation = "DELETE_ALL_UNDISCOVERED_SPOTS_AND_ROUTES";
let purgeRequestInFlight = false;
let lastWriteReadyCounts = null;
let rawItemCount = 0;
let previewMap = null;
let previewMapReady = false;
let autoLoadedDbUndiscoveredMap = false;
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
  renderWriteStatusFromResult(result, { source: "viewport", dryRun: !!result.dryRun });
}

function openWriteStatusPanel() {
  const panel = $("writeStatusPanel");
  if (panel) panel.open = true;
}

function renderWriteStatusBadge(status) {
  const badge = $("writeStatusBadge");
  if (!badge) return;
  badge.textContent = status || "idle";
  badge.className = "pill" + (status === "writing" ? " ok" : status === "error" ? " err" : status === "complete" ? " ok" : "");
}

function renderWriteStatusGrid(rows) {
  $("writeStatusGrid").innerHTML = (rows || []).map(function (r) {
    return '<div class="stat-box"><div class="stat-label">' + r[0] + '</div><div class="stat-value">' + r[1] + '</div></div>';
  }).join("");
}

function renderWriteStatusFromResult(result, meta) {
  if (!result) return;
  openWriteStatusPanel();
  const dryRun = meta && meta.dryRun;
  const status = dryRun ? "dry-run" : (result.errors && result.errors.length ? "error" : "complete");
  renderWriteStatusBadge(status);
  const rows = [
    ["Source", (meta && meta.source) || "—"],
    ["Target", result.writeTarget || "—"],
    ["Spots planned", (result.spotsPlanned || 0).toLocaleString()],
    ["Routes planned", (result.routesPlanned || 0).toLocaleString()],
    ["Spots written", dryRun ? "—" : (result.spotsWritten || 0).toLocaleString()],
    ["Routes written", dryRun ? "—" : (result.routesWritten || 0).toLocaleString()],
    ["Tiles upserted", dryRun ? "—" : (result.tilesWritten || 0).toLocaleString()],
    ["Total docs written", dryRun ? (result.written || 0).toLocaleString() + " (simulated)" : (result.written || 0).toLocaleString()],
    ["Dup skipped", (result.skippedDuplicates || 0).toLocaleString()],
    ["Invalid skipped", (result.skippedInvalid || 0).toLocaleString()],
  ];
  renderWriteStatusGrid(rows);
  $("writeStatusLine").textContent = dryRun
    ? "Dry run complete — zero Firestore writes. Tile upserts would run on a real write."
    : "Write complete — spots/routes + nested unexploredTiles updated for native map.";
  $("writeStatusErrors").textContent = (result.errors && result.errors.length) ? ("Errors: " + result.errors.join("; ")) : "";
  if (!dryRun && status === "complete") void pollUndiscoveredCounts(true);
}

function appendWriteConsole(line, kind) {
  const ts = new Date().toLocaleTimeString();
  clientWriteConsoleLines.push({ ts: ts, line: line, kind: kind || "info" });
  if (clientWriteConsoleLines.length > 150) clientWriteConsoleLines = clientWriteConsoleLines.slice(-150);
  renderWriteConsole(clientWriteConsoleLines, null);
}

function renderWriteConsole(clientLines, serverLines) {
  const el = $("writeConsoleLog");
  if (!el) return;
  const rows = [];
  if (Array.isArray(serverLines)) {
    for (let i = 0; i < serverLines.length; i++) {
      const raw = String(serverLines[i] || "");
      const cls = raw.toLowerCase().includes("error") ? "line-err" : raw.toLowerCase().includes("complete") ? "line-ok" : "";
      rows.push('<div class="' + cls + '">' + escapeHtml(raw) + '</div>');
    }
  }
  if (Array.isArray(clientLines)) {
    for (let j = 0; j < clientLines.length; j++) {
      const row = clientLines[j];
      const cls = row.kind === "err" ? "line-err" : row.kind === "ok" ? "line-ok" : "";
      rows.push('<div class="' + cls + '">[' + escapeHtml(row.ts) + '] ' + escapeHtml(row.line) + '</div>');
    }
  }
  el.innerHTML = rows.length ? rows.join("") : "No write activity yet.";
  el.scrollTop = el.scrollHeight;
}

function renderWriteStatusFromRun(run) {
  if (!run) return;
  renderWriteConsole(clientWriteConsoleLines, run.writeLog || null);
  const hb = run.writeHeartbeat;
  const ws = run.writeStats || {};
  if (run.phase === "writing" || (hb && hb.status === "writing")) {
    openWriteStatusPanel();
    renderWriteStatusBadge("writing");
    const p = hb || {};
    const stageLabels = {
      loading: "loading chunk artifacts",
      building_payload: "building write payloads",
      checking_duplicates: "checking existing Firestore ids",
      spots: "writing spots + spot tiles",
      routes: "writing routes + route tiles",
      done: "finishing",
    };
    const stageLabel = stageLabels[p.stage] || p.stage || "preparing";
    const batchLabel = p.batchCount ? ("batch " + (p.batchIndex || 0) + " / " + p.batchCount) : (p.message || "starting");
    const targetLabel = p.dryRun ? "DRY RUN (no Firestore writes)" : ("→ " + (p.writeTarget || "production"));
    $("writeStatusLine").textContent = "Writing · " + stageLabel + " · " + batchLabel + " · " + targetLabel;
    renderWriteStatusGrid([
      ["Run phase", run.phase || "—"],
      ["Write target", p.dryRun ? "dry run" : (p.writeTarget || "—")],
      ["Stage", stageLabel],
      ["Spots planned", (p.spotsPlanned || 0).toLocaleString()],
      ["Routes planned", (p.routesPlanned || 0).toLocaleString()],
      ["Spots written", (p.spotsWritten || 0).toLocaleString()],
      ["Routes written", (p.routesWritten || 0).toLocaleString()],
      ["Tiles upserted", (p.tilesWritten || 0).toLocaleString()],
      ["Run total written", (ws.written || 0).toLocaleString()],
      ["Run total tiles", (ws.tilesWritten || 0).toLocaleString()],
      ["Dup skipped (run)", (ws.skippedDuplicates || 0).toLocaleString()],
    ]);
    $("writeStatusErrors").textContent = (p.errors && p.errors.length) ? ("Errors: " + p.errors.join("; ")) : (p.message && p.stage !== "spots" && p.stage !== "routes" ? p.message : "");
    return;
  }
  if (hb && (hb.status === "complete" || hb.status === "error")) {
    renderWriteStatusFromResult({
      dryRun: hb.dryRun,
      writeTarget: hb.writeTarget,
      spotsPlanned: hb.spotsPlanned,
      routesPlanned: hb.routesPlanned,
      spotsWritten: hb.spotsWritten,
      routesWritten: hb.routesWritten,
      tilesWritten: hb.tilesWritten,
      written: hb.spotsWritten + hb.routesWritten,
      skippedDuplicates: hb.skippedDuplicates,
      skippedInvalid: 0,
      errors: hb.errors || [],
    }, { source: "full Vermont run", dryRun: hb.dryRun });
  }
}

async function repairMapVisibility() {
  if (!window.confirm("Set publicMapEligible=true and mapReadiness=ready on existing PBF Copier V2 writes in Vermont?")) return;
  setStatus("loading", "Patching map visibility fields on existing writes…");
  try {
    const res = await fetch(apiBase + "/repair-map-visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    });
    const json = await res.json();
    if (!json.ok) { setStatus("error", json.error?.message || "Repair failed"); return; }
    const d = json.data || json;
    setStatus("ok", "Map visibility fixed: " + (d.spotsUpdated || 0) + " spots, " + (d.routesUpdated || 0) + " routes");
    void pollUndiscoveredCounts(true);
  } catch (err) {
    setStatus("error", "Repair failed: " + (err && err.message ? err.message : String(err)));
  }
}

async function pollUndiscoveredCounts(force) {
  try {
    if (!force) $("undiscoveredLiveMeta").textContent = "Refreshing Firestore counts…";
    const res = await fetch(apiBase + "/undiscovered-counts", {
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(15000)
        : undefined,
    });
    const json = await res.json();
    if (!json.ok) {
      $("undiscoveredLiveMeta").textContent = "Count failed: " + (json.error?.message || "unknown");
      return;
    }
    const c = json.data || json;
    const spots = Number(c.spots ?? 0);
    const routes = Number(c.routes ?? 0);
    const total = Number(c.total ?? spots + routes) || 0;
    const tiles = c.tiles == null ? null : Number(c.tiles);
    $("liveUndiscoveredSpots").textContent = spots.toLocaleString();
    $("liveUndiscoveredRoutes").textContent = routes.toLocaleString();
    $("liveUndiscoveredTotal").textContent = total.toLocaleString();
    $("liveUndiscoveredTiles").textContent = tiles == null ? "nested" : tiles.toLocaleString();
    const when = c.countedAt ? new Date(c.countedAt).toLocaleString() : "now";
    $("undiscoveredLiveMeta").textContent =
      "Project " + (c.projectId || "—") + " · " + (c.source || "Firestore live count") + " · updated " + when;
    if (!autoLoadedDbUndiscoveredMap && total > 0) {
      autoLoadedDbUndiscoveredMap = true;
      void loadDbUndiscoveredOnMap({ fit: true });
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const timedOut = msg.indexOf("abort") >= 0 || msg.indexOf("timeout") >= 0;
    $("undiscoveredLiveMeta").textContent = timedOut
      ? "Count timed out — retrying. If this persists, restart the backend (npm run build && npm run start)."
      : "Count error — is the backend running on port 8080? " + msg;
  }
}

function startUndiscoveredCountsPolling() {
  void pollUndiscoveredCounts(true);
  if (undiscoveredCountsPollTimer) clearInterval(undiscoveredCountsPollTimer);
  undiscoveredCountsPollTimer = setInterval(function () { void pollUndiscoveredCounts(false); }, 20000);
}

function startFullRunWritePolling() {
  if (fullRunWritePollTimer) clearInterval(fullRunWritePollTimer);
  fullRunWritePollTimer = setInterval(function () { void pollFullRunStatus(); }, 1000);
}

function stopFullRunWritePolling() {
  if (fullRunWritePollTimer) {
    clearInterval(fullRunWritePollTimer);
    fullRunWritePollTimer = null;
  }
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
    openWriteStatusPanel();
    renderWriteStatusBadge("validating");
    $("writeStatusLine").textContent = "Validating write payload…";
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
    openWriteStatusPanel();
    renderWriteStatusBadge("writing");
    $("writeStatusLine").textContent = "Dry run — simulating write plan (no Firestore writes)…";
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
  openWriteStatusPanel();
  renderWriteStatusBadge("writing");
  $("writeStatusLine").textContent = "Writing spots, routes, and unexploredTiles to Firestore…";
  renderWriteStatusGrid([
    ["Source", "viewport scan"],
    ["Target", $("writeTarget").value],
    ["Status", "in progress…"],
  ]);
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
    if (!(data.errors && data.errors.length) && !data.dryRun) {
      void pollUndiscoveredCounts(true);
      void loadDbUndiscoveredOnMap({ fit: true });
    }
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
    hideUnnamedPaths: false,
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

function ensurePreviewMapReady() {
  initPreviewMap();
  if (previewMapReady) return Promise.resolve();
  return new Promise(function (resolve) {
    if (!previewMap) {
      resolve();
      return;
    }
    if (typeof previewMap.loaded === "function" && previewMap.loaded()) {
      previewMapReady = true;
      ensurePreviewRouteLayers();
      resolve();
      return;
    }
    previewMap.once("load", function () {
      previewMapReady = true;
      ensurePreviewRouteLayers();
      resolve();
    });
  });
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

async function api(path, options) {
  const res = await fetch(apiBase + path, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || json?.error || res.statusText);
  }
  return json;
}

function formatPurgeSummaryMeta(data, dryRun) {
  return (
    (dryRun ? "Would delete: " : "Deleted: ")
    + (data.spotsDeleted || 0).toLocaleString() + " spot(s), "
    + (data.routesDeleted || 0).toLocaleString() + " route(s), "
    + (data.tilesDeleted || 0).toLocaleString() + " nested map tile doc(s)"
    + (dryRun
      ? " (includes unexploredTiles cache scan — may take 1–2 min; geometryChunks not counted)."
      : ", " + (data.geometryChunksDeleted || 0).toLocaleString() + " geometry chunk(s).")
  );
}

function syncPurgePanelFromHealth(data) {
  const enabled = Boolean(data && data.purgeUndiscoveredEnabled);
  const panel = $("purgeUndiscoveredPanel");
  if (panel) panel.style.display = "block";
  if (data && data.purgeUndiscoveredEnvVar && $("purgeEnvVarName")) {
    $("purgeEnvVarName").textContent = data.purgeUndiscoveredEnvVar;
  }
  if (data && data.purgeUndiscoveredConfirmation) {
    purgeUndiscoveredConfirmation = data.purgeUndiscoveredConfirmation;
    if ($("purgeConfirmPhraseHint")) $("purgeConfirmPhraseHint").textContent = purgeUndiscoveredConfirmation;
  }
  ["btnPurgeUndiscoveredDryRun", "btnPurgeUndiscovered"].forEach(function (id) {
    const el = $(id);
    if (el) el.disabled = !enabled;
  });
  if ($("purgeUndiscoveredMeta")) {
    $("purgeUndiscoveredMeta").textContent = enabled
      ? "Purge enabled — deletes spots, routes, and nested unexploredTiles (map cache). Cooper + confirmation phrase required."
      : "Purge disabled — set OSM_PBF_COPIER_ALLOW_PURGE_UNDISCOVERED=true in .env (or shell) and restart backend.";
  }
}

function readPurgeCredentials() {
  const panelPhrase = ($("purgePanelPhrase") && $("purgePanelPhrase").value || "").trim();
  const panelPassword = ($("purgePanelPassword") && $("purgePanelPassword").value || "").trim();
  const modalPhrase = ($("purgeConfirmPhrase") && $("purgeConfirmPhrase").value || "").trim();
  const modalPassword = ($("purgePassword") && $("purgePassword").value || "").trim();
  return {
    phrase: panelPhrase || modalPhrase,
    password: panelPassword || modalPassword,
  };
}

function setPurgeControlsBusy(busy) {
  purgeRequestInFlight = busy;
  ["btnPurgeUndiscoveredDryRun", "btnPurgeUndiscovered", "btnConfirmPurgeDryRun", "btnConfirmPurgeUndiscovered"].forEach(function (id) {
    const el = $(id);
    if (el) el.disabled = busy;
  });
}

async function runPurgeUndiscovered(dryRun) {
  if (purgeRequestInFlight) return;
  const creds = readPurgeCredentials();
  if (creds.phrase !== purgeUndiscoveredConfirmation) {
    setStatus("warn", "Paste the confirmation phrase exactly: " + purgeUndiscoveredConfirmation);
    return;
  }
  if (!creds.password) {
    setStatus("warn", "Enter production password Cooper.");
    return;
  }
  setPurgeControlsBusy(true);
  setStatus(
    "loading",
    dryRun
      ? "Counting spots, routes, and nested map tiles (unexploredTiles scan can take 1–2 min)…"
      : "Deleting spots, routes, and nested map tiles — may take several minutes…"
  );
  if ($("purgeUndiscoveredMeta")) {
    $("purgeUndiscoveredMeta").textContent = dryRun
      ? "Count in progress (includes nested unexploredTiles)…"
      : "Delete in progress: spots/routes in small batches + recursive unexploredTiles purge…";
  }
  try {
    const json = await api("/purge-undiscovered", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        writeTarget: "production",
        confirmProductionWrite: creds.password,
        confirmPurge: creds.phrase,
        dryRun: dryRun,
      }),
    });
    const data = json.data || json;
    const meta = formatPurgeSummaryMeta(data, dryRun);
    if ($("purgeUndiscoveredMeta")) $("purgeUndiscoveredMeta").textContent = meta;
    if (!dryRun) closePurgeUndiscoveredModal();
    setStatus("ok", dryRun ? "Dry-run count complete (zero deletes)." : "Purge complete — spots, routes, and map tiles cleared. Posts were not touched.");
    void pollUndiscoveredCounts(true);
  } catch (err) {
    setStatus("error", "Purge failed: " + err.message);
    if ($("purgeUndiscoveredMeta")) $("purgeUndiscoveredMeta").textContent = "Error: " + err.message;
  } finally {
    setPurgeControlsBusy(false);
    void loadHealth();
  }
}

function openPurgeUndiscoveredModal() {
  const creds = readPurgeCredentials();
  if ($("purgeConfirmPhrase")) $("purgeConfirmPhrase").value = creds.phrase;
  if ($("purgePassword")) $("purgePassword").value = creds.password;
  const modal = $("purgeUndiscoveredModal");
  if (!modal) return;
  modal.style.display = "flex";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  setStatus("warn", "Confirm delete — posts are never touched.");
}

function closePurgeUndiscoveredModal() {
  const modal = $("purgeUndiscoveredModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function loadHealth() {
  try {
    const json = await api("/health");
    syncPurgePanelFromHealth(json.data || json);
  } catch (err) {
    if ($("purgeUndiscoveredMeta")) {
      $("purgeUndiscoveredMeta").textContent = "Health check failed: " + err.message;
    }
  }
}

function renderWriteReadyBanner(counts) {
  const banner = $("fullRunWriteReadyBanner");
  if (!banner) return;
  if (!counts || !(counts.chunksIncluded > 0)) {
    banner.style.display = "none";
    return;
  }
  banner.style.display = "block";
  $("fullRunWriteReadySpots").textContent = (counts.spots || 0).toLocaleString();
  $("fullRunWriteReadyRoutes").textContent = (counts.routes || 0).toLocaleString();
  $("fullRunWriteReadyTotal").textContent = (counts.total || 0).toLocaleString();
  const meta = [];
  meta.push(counts.chunksIncluded + " chunk(s) processed");
  if (counts.chunksPending > 0) meta.push(counts.chunksPending + " chunk(s) still pending");
  if (counts.tileOverlapDuplicatesExcluded > 0) {
    meta.push(counts.tileOverlapDuplicatesExcluded.toLocaleString() + " tile-overlap dupes excluded");
  }
  if (counts.skippedSupportOnly > 0) meta.push(counts.skippedSupportOnly + " support-only skipped");
  if (counts.skippedInvalid > 0) meta.push(counts.skippedInvalid + " invalid skipped");
  meta.push("Counts match dry-run write validation; DB skipExisting not applied");
  $("fullRunWriteReadyMeta").textContent = meta.join(" · ");
}

function setUiRunMode(mode) {
  uiRunMode = mode;
  const full = mode === "full_vermont";
  $("fullRunPanel").style.display = full ? "block" : "none";
  $("qualityFiltersPanel").style.display = full ? "none" : ($("qualityFiltersPanel").dataset.hadResults === "1" ? "block" : "none");
  $("resultsPanel").style.display = full ? "none" : ($("resultsPanel").style.display === "block" ? "block" : "none");
  $("runModeHelp").textContent = full
    ? "Full-file mode: tile checkpoints on disk. Map stays visible — use Load Firestore undiscovered / Fit all in DB after writing."
    : "Scan the current map viewport only — same algorithm as before.";
}

function dbMarkerToPreviewDoc(item, kind) {
  const isRoute = kind === "route";
  return {
    id: item.id,
    kind: isRoute ? "unexplored_route" : "unexplored_spot",
    lat: item.lat,
    lng: item.lng,
    displayName: item.displayName || item.id,
    primaryActivity: item.primaryActivity || (isRoute ? "hiking" : "place"),
    primaryCategory: item.primaryActivity || (isRoute ? "hiking" : "place"),
    activities: item.primaryActivity ? [item.primaryActivity] : [],
    filteredOut: false,
    sourceTagSample: {},
    warnings: ["loaded_from_firestore"],
    routeLineCoordinates: isRoute ? (item.routeLineCoordinates || []) : undefined,
    geometryPointCount: isRoute ? (item.routeLineCoordinates || []).length : 0,
    publicMapEligible: item.publicMapEligible === true,
    mapReadiness: item.mapReadiness || "ready",
  };
}

async function loadDbUndiscoveredOnMap(opts) {
  const fit = !opts || opts.fit !== false;
  setStatus("loading", "Loading undiscovered spots/routes from Firestore…");
  try {
    const res = await fetch(apiBase + "/undiscovered-map-preview");
    const json = await res.json();
    if (!json.ok) {
      setStatus("error", json.error?.message || "Failed to load Firestore map preview");
      return null;
    }
    const data = json.data || json;
    const docs = [];
    (data.spots || []).forEach(function (s) { docs.push(dbMarkerToPreviewDoc(s, "spot")); });
    (data.routes || []).forEach(function (r) { docs.push(dbMarkerToPreviewDoc(r, "route")); });
    previewDocs = docs;
    previewDocsRaw = docs.slice();
    await ensurePreviewMapReady();
    clearPreviewMapMarkers();
    if (fit && data.bounds && previewMap) {
      previewMap.fitBounds(
        [[data.bounds.westLng, data.bounds.southLat], [data.bounds.eastLng, data.bounds.northLat]],
        { padding: 48, duration: 600, maxZoom: 12 }
      );
    } else if (fit && data.center && previewMap) {
      previewMap.flyTo({ center: [data.center.lng, data.center.lat], zoom: 9, duration: 600 });
    }
    drawAllPreviewOnMap();
    $("viewportCount").textContent = docs.length.toLocaleString() + " from Firestore ("
      + (data.counts?.spots || 0).toLocaleString() + " spots, "
      + (data.counts?.routes || 0).toLocaleString() + " routes)";
    $("mapSidebar").textContent = "Loaded live Firestore undiscovered layer for Vermont bbox. Native app shows the same docs when you pan here.";
    setStatus("ok", "Loaded " + docs.length.toLocaleString() + " undiscovered item(s) from Firestore onto the map.");
    return data;
  } catch (err) {
    setStatus("error", "Load Firestore map failed: " + (err && err.message ? err.message : String(err)));
    return null;
  }
}

async function fitDbUndiscoveredOnMap() {
  const data = await loadDbUndiscoveredOnMap({ fit: true });
  if (!data) return;
}

function renderFullRunStats(run, writeReadyCounts) {
  if (!run) return;
  const wr = writeReadyCounts || lastWriteReadyCounts;
  if (writeReadyCounts) lastWriteReadyCounts = writeReadyCounts;
  renderWriteReadyBanner(wr);
  const s = run.stats || {};
  const dq = s.destinationQuality || {};
  const chunksDone = (run.completedChunkIds || []).length;
  const chunksTotal = run.totalChunks || 0;
  const hb = run.scanHeartbeat;
  const wrApprox = wr && wr.approximate ? " (approx)" : "";
  const spotLimit = run.maxTotalSpots != null ? run.maxTotalSpots : null;
  const rows = [
    ["Spots ready", wr && wr.chunksIncluded > 0 ? (wr.spots || 0).toLocaleString() + wrApprox : "—"],
    ["Spot limit", spotLimit != null ? spotLimit.toLocaleString() + " (stop when reached)" : "off"],
    ["Routes ready", wr && wr.chunksIncluded > 0 ? (wr.routes || 0).toLocaleString() + wrApprox : "—"],
    ["Total write-ready", wr && wr.chunksIncluded > 0 ? (wr.total || 0).toLocaleString() + wrApprox : "—"],
    ["Progress", (run.percentComplete || 0) + "%" + (run.percentEstimated ? " (est)" : "")],
    ["Phase", run.phase || "—"],
    ["Status", run.status || "—"],
    ["Chunks done", chunksDone + " / " + chunksTotal],
    ["Scanning tile", hb ? "tile " + (hb.tileIndex + 1) + "/" + chunksTotal + " · " + (hb.objectsScannedThisTile || 0).toLocaleString() + " objs" : (run.status === "running" ? "starting…" : "—")],
    ["Raw scanned", (s.rawObjectsScanned || 0).toLocaleString()],
    ["Nodes", (s.nodesScanned || 0).toLocaleString()],
    ["Ways", (s.waysScanned || 0).toLocaleString()],
    ["Relations", (s.relationsScanned || 0).toLocaleString()],
    ["Visible", (s.visibleItems || 0).toLocaleString()],
    ["Hidden", (s.hiddenItems || 0).toLocaleString()],
    ["Chunks written", s.chunksWritten || 0],
    ["Written items", run.writeStats?.written || 0],
    ["Dup skipped", run.writeStats?.skippedDuplicates || 0],
    ["Errors", run.errorCount || 0],
    ["obj/s", (run.avgObjectsPerSec || 0).toFixed(1)],
    ["ETA", run.etaMs != null ? Math.round(run.etaMs / 1000) + "s" : "—"],
    ["Train bridges rescued", dq.finalRescuedTrainBridges || 0],
    ["Hiking rescued", dq.finalRescuedUnmarkedHikingTrails || 0],
  ];
  $("fullRunStatsGrid").innerHTML = rows.map(function (r) {
    return '<div class="stat-box"><div class="stat-label">' + r[0] + '</div><div class="stat-value">' + r[1] + '</div></div>';
  }).join("");
  const elapsedSec = Math.round((run.elapsedMs || 0) / 1000);
  let statusLine = "Run " + run.status + " · phase " + run.phase + " · elapsed " + elapsedSec + "s";
  if (hb && run.status === "running") {
    statusLine += " · reading PBF tile " + (hb.tileIndex + 1) + "/" + chunksTotal
      + " (" + (hb.objectsScannedThisTile || 0).toLocaleString() + " objects this pass)";
  } else if (run.status === "running" && run.phase === "scanning_ways") {
    statusLine += " · each tile re-reads the full Vermont PBF (5–15 min/tile is normal)";
  }
  if (spotLimit != null && run.status === "running") {
    const found = wr && wr.chunksIncluded > 0 ? (wr.spots || 0) : 0;
    statusLine += " · spot limit " + found.toLocaleString() + " / " + spotLimit.toLocaleString();
  }
  $("fullRunStatusLine").textContent = statusLine;
  $("fullRunRunId").textContent = "runId: " + run.runId;
  $("fullRunValidation").textContent = (run.validationWarnings || []).length
    ? "Warnings: " + run.validationWarnings.join(" · ")
    : "";
}

async function pollFullRunStatus() {
  if (!fullRunId) return;
  try {
    const res = await fetch(apiBase + "/full-run/status?runId=" + encodeURIComponent(fullRunId));
    const json = await res.json();
    if (!json.ok) {
      $("fullRunStatusLine").textContent = "Status poll failed: " + (json.error?.message || "unknown error");
      return;
    }
    renderFullRunStats(json.data.run, json.data.writeReadyCounts);
    renderWriteStatusFromRun(json.data.run);
    const chunksDone = (json.data.run.completedChunkIds || []).length;
    if (chunksDone !== lastAssetPreviewChunkCount) {
      lastAssetPreviewChunkCount = chunksDone;
    }
    if (json.data.run && json.data.run.phase !== "writing") {
      stopFullRunWritePolling();
    }
    if (json.data.run && (json.data.run.status === "complete" || json.data.run.status === "error" || json.data.run.status === "stopped")) {
      if (fullRunPollTimer) { clearInterval(fullRunPollTimer); fullRunPollTimer = null; }
    }
  } catch (err) {
    $("fullRunStatusLine").textContent = "Status poll error — is the backend running? " + (err && err.message ? err.message : String(err));
  }
}

async function startFullVermontRun() {
  const limitSpots = $("fullRunLimitSpots").checked;
  const maxSpotsRaw = $("fullRunMaxSpots").value.trim();
  const body = {
    pbfPath: $("filePath").value.trim(),
    mode: $("fullRunMode").value,
    tileStepDegrees: Number($("fullRunTileStep").value) || 0.4,
    maxTotalSpots: limitSpots ? (Number(maxSpotsRaw) || 100) : null,
    qualityFilterSettings: readQualityFilterSettings(),
  };
  setStatus("loading", "Starting full Vermont run…");
  const res = await fetch(apiBase + "/full-run/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!json.ok) { setStatus("error", json.error?.message || "Start failed"); return; }
  fullRunId = json.data.run.runId;
  try { sessionStorage.setItem("pbfFullRunId", fullRunId); } catch (_e) { /* ignore */ }
  syncAssetPreviewRunSelect();
  renderFullRunStats(json.data.run, json.data.writeReadyCounts || null);
  const limitMsg = body.maxTotalSpots
    ? " — stops after ~" + body.maxTotalSpots.toLocaleString() + " visible spots"
    : " — runs all tiles (slow)";
  setStatus("ok", "Full Vermont run started" + limitMsg);
  if (fullRunPollTimer) clearInterval(fullRunPollTimer);
  void pollFullRunStatus();
  fullRunPollTimer = setInterval(function () { void pollFullRunStatus(); }, 3000);
}

async function fullRunAction(path) {
  if (!fullRunId) { setStatus("warn", "Start a full run first"); return null; }
  const res = await fetch(apiBase + "/full-run/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: fullRunId }),
  });
  const json = await res.json();
  if (!json.ok) { setStatus("error", json.error?.message || path + " failed"); return null; }
  renderFullRunStats(json.data.run);
  return json.data;
}

async function fullRunWrite(opts) {
  if (!fullRunId) { setStatus("warn", "Start a full run first"); return; }
  const options = Object.assign({}, opts || {});
  if (options.dryRun !== true) {
    const target = options.writeTarget || ($("fullRunMode").value === "write_prod" ? "production" : "emulator");
    options.writeTarget = target;
    options.dryRun = false;
    if (target === "production" && !options.confirmProductionWrite) {
      const pw = window.prompt("Production write password (Cooper):");
      if (!pw) { setStatus("warn", "Production write cancelled — password required"); return; }
      options.confirmProductionWrite = pw;
    }
  }
  const body = Object.assign({ runId: fullRunId, confirmUndiscoveredShape: UNDISCOVERED_SHAPE_PHRASE }, options);
  appendWriteConsole("POST /full-run/write-current " + JSON.stringify({ dryRun: body.dryRun, writeTarget: body.writeTarget }), "info");
  setStatus("loading", body.dryRun ? "Dry run write…" : "Writing to Firestore (spots + routes + tiles)…");
  openWriteStatusPanel();
  renderWriteStatusBadge("writing");
  $("writeStatusLine").textContent = body.dryRun ? "Dry run started…" : ("Production write → " + body.writeTarget);
  startFullRunWritePolling();
  try {
    const res = await fetch(apiBase + "/full-run/write-current", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) {
      appendWriteConsole("Write failed: " + (json.error?.message || "unknown"), "err");
      setStatus("error", json.error?.message || "Write failed");
      return;
    }
    renderFullRunStats(json.data.run, json.data.writeReadyCounts || lastWriteReadyCounts);
    renderWriteStatusFromRun(json.data.run);
    const wr = json.data.writeResult;
    if (wr) {
      if (wr.errors && wr.errors.length) {
        appendWriteConsole(wr.errors.join(" · "), "err");
      } else {
        appendWriteConsole(
          (wr.dryRun ? "Dry run OK: " : "Written: ")
            + (wr.spotsWritten || wr.spotsPlanned || 0) + " spots, "
            + (wr.routesWritten || wr.routesPlanned || 0) + " routes, "
            + (wr.tilesWritten || 0) + " tiles",
          wr.dryRun ? "info" : "ok"
        );
      }
      renderWriteStatusFromResult(wr, { source: "full Vermont run", dryRun: !!wr.dryRun });
      setStatus(wr.errors && wr.errors.length ? "error" : "ok",
        wr.errors && wr.errors.length
          ? ("Write failed: " + wr.errors[0])
          : ((wr.dryRun ? "Dry run: " : "Written: ")
            + (wr.spotsWritten || wr.spotsPlanned || 0).toLocaleString() + " spots, "
            + (wr.routesWritten || wr.routesPlanned || 0).toLocaleString() + " routes, "
            + (wr.tilesWritten || 0).toLocaleString() + " tiles"
            + (wr.dryRun ? " (simulated)" : "")));
      if (!wr.dryRun && !wr.errors.length) {
        void pollUndiscoveredCounts(true);
        void loadDbUndiscoveredOnMap({ fit: true });
      }
    } else {
      appendWriteConsole("Write returned no result payload", "err");
      setStatus("warn", "Write finished but no result returned");
    }
    void pollFullRunStatus();
  } catch (err) {
    appendWriteConsole("Network error: " + (err && err.message ? err.message : String(err)), "err");
    setStatus("error", "Write failed: " + (err && err.message ? err.message : String(err)));
  } finally {
    stopFullRunWritePolling();
  }
}

let assetPreviewAbort = null;
let assetPreviewLoading = false;

function assetConfClass(status, confidence) {
  if (status === "found" || status === "ready") return "high";
  if (status === "skipped" || status === "error" || status === "lookup_failed") return "skipped";
  if (status === "low_confidence" || status === "no_good_match" || status === "not_found") return "low";
  if (confidence === "high") return "high";
  if (confidence === "medium") return "medium";
  return "low";
}

function renderAssetPreviewPhotoCard(asset) {
  const caption = escapeHtml(asset.caption || asset.title || "Image result");
  const sourceName = escapeHtml(asset.sourceName || asset.sourceDomain || "source");
  const sourceUrl = escapeHtml(asset.backlinkUrl || asset.sourceUrl || "#");
  const imageUrl = escapeHtml(asset.imageUrl || "");
  const conf = escapeHtml(asset.assetMatchConfidence || "low");
  const domain = escapeHtml(asset.sourceDomain || asset.sourceName || "");
  const vision = asset.visionJudgment;
  const visionLine = vision && vision.automated
    ? '<div class="muted" style="margin-top:6px;font-size:10px">Gemini: ' +
      escapeHtml(vision.assetType) + " · place " + vision.placeMatchScore + "/5 · quality " +
      vision.visualQualityScore + "/5 · " + escapeHtml(vision.shortReason) + "</div>"
    : "";
  return '<article class="asset-photo-card">' +
    '<div class="asset-photo-thumb">' +
      '<span class="asset-photo-rank">#' + asset.rank + " · " + conf + "</span>" +
      '<img src="' + imageUrl + '" alt="' + caption + '" loading="lazy" onerror="this.parentElement.innerHTML=\\'<div style=padding:24px;text-align:center;color:#64748b;font-size:11px>Preview unavailable</div>\\'"/>' +
    "</div>" +
    '<div class="asset-photo-body">' +
      "<div>" + caption + "</div>" +
      '<div class="muted" style="margin-top:4px">' + domain + '</div>' +
      visionLine +
      '<a href="' + sourceUrl + '" target="_blank" rel="noopener noreferrer" style="color:#93c5fd">↗ ' + sourceName + "</a>" +
    "</div>" +
  "</article>";
}

function renderAssetPreviewSpot(item) {
  const preview = item.assetPreview || {};
  const payload = item.writePayload && item.writePayload.location ? item.writePayload.location : {};
  const town = payload.city || (item.sourceTagSample && item.sourceTagSample["addr:city"]) || "—";
  const state = payload.state || (item.sourceTagSample && item.sourceTagSample["addr:state"]) || "—";
  const address = payload.address || "—";
  const lat = item.lat != null ? item.lat : (item.routeMarkerCoordinate && item.routeMarkerCoordinate.lat);
  const lng = item.lng != null ? item.lng : (item.routeMarkerCoordinate && item.routeMarkerCoordinate.lng);
  const status = preview.assetStatus || "no_good_match";
  const topConf = preview.externalAssets && preview.externalAssets[0] ? preview.externalAssets[0].assetMatchConfidence : "low";
  const warnings = (preview.warnings || []).map(function (w) {
    return '<div class="asset-warn">⚠ ' + escapeHtml(w) + "</div>";
  }).join("");
  const photos = (preview.externalAssets || []).slice(0, 8).map(renderAssetPreviewPhotoCard).join("");
  const activities = (item.activities || []).join(", ") || "—";
  return '<section class="asset-spot-card">' +
    '<div class="asset-spot-head">' +
      "<h3>" + escapeHtml(item.displayName) + "</h3>" +
      '<span class="asset-conf ' + assetConfClass(status, topConf) + '">' +
        escapeHtml(status) + (preview.assetsReady ? " · assetsReady" : "") +
      "</span>" +
    "</div>" +
    '<p class="muted" style="margin:6px 0">' +
      escapeHtml(item.primaryActivity || "—") + " · " + escapeHtml(item.primaryCategory || "—") + " · " + escapeHtml(activities) +
      "<br/>" + escapeHtml(item.osmType) + "/" + escapeHtml(String(item.osmId)) +
      " · " + escapeHtml(String(lat)) + ", " + escapeHtml(String(lng)) +
      "<br/>" + escapeHtml(address) + " · " + escapeHtml(town) + ", " + escapeHtml(state) +
    "</p>" +
    '<p class="muted" style="margin:6px 0"><strong>Query:</strong> <code>' + escapeHtml(preview.query || "—") + "</code>" +
      (preview.querySpecificityScore != null ? " · specificity " + preview.querySpecificityScore : "") +
      (preview.provider && preview.provider !== "none" ? " · via " + escapeHtml(preview.provider) : "") +
    "</p>" +
    warnings +
    (preview.skipReason ? '<div class="asset-warn">Skipped: ' + escapeHtml(preview.skipReason) + "</div>" : "") +
    (preview.lookupError ? '<div class="asset-warn">' + escapeHtml(preview.lookupError) + "</div>" : "") +
    '<div class="asset-photo-grid">' + (photos || '<div class="asset-empty" style="grid-column:1/-1">No photo cards for this spot.</div>') + "</div>" +
  "</section>";
}

function renderAssetPreviewProgress(progress, partial) {
  partial = partial || {};
  const rows = [
    ["Spots loaded", partial.completed != null ? partial.completed + " / " + (progress.spotsLoaded || partial.total || 0) : (progress.spotsLoaded || 0)],
    ["Query-ready pool", progress.photoQueryReady != null ? progress.photoQueryReady : "—"],
    ["Lookups OK", progress.photoLookupsCompleted || 0],
    ["Gemini", progress.geminiEnabled ? "on" : "off"],
    ["Gemini judged", progress.geminiJudged != null ? progress.geminiJudged : "—"],
    ["Gemini rejected", progress.geminiRejected != null ? progress.geminiRejected : "—"],
    ["Lookups failed", progress.photoLookupsFailed || 0],
    ["Low confidence", progress.lowConfidenceCount || 0],
    ["Elapsed", ((progress.elapsedMs || 0) / 1000).toFixed(1) + "s"],
    ["Avg lookup", progress.avgLookupSpeedMs != null ? progress.avgLookupSpeedMs + "ms" : "—"],
  ];
  $("assetPreviewProgress").innerHTML = rows.map(function (r) {
    return '<div class="stat-box"><div class="stat-label">' + escapeHtml(r[0]) + '</div><div class="stat-value">' + escapeHtml(String(r[1])) + "</div></div>";
  }).join("");
  $("assetPreviewProgress").style.display = "grid";
}

function hasAssetPreviewUi() {
  return Boolean($("btnAssetPreviewFetch"));
}

function setAssetPreviewLoading(on, message) {
  if (!hasAssetPreviewUi()) return;
  assetPreviewLoading = on;
  $("btnAssetPreviewFetch").disabled = on;
  $("btnAssetPreviewClear").disabled = on;
  $("assetPreviewRunSelect").disabled = on;
  $("assetPreviewChunkSelect").disabled = on;
  $("assetPreviewMaxSpots").disabled = on;
  $("assetPreviewGeminiKey").disabled = on;
  $("btnAssetPreviewStop").style.display = on ? "inline-block" : "none";
  if (message) $("assetPreviewStatus").textContent = message;
}

function syncAssetPreviewMaxSpotsFromFullRun() {
  if (!$("fullRunLimitSpots").checked) return;
  const cap = Math.max(1, Math.min(100, Number($("fullRunMaxSpots").value || 100)));
  $("assetPreviewMaxSpots").value = String(Math.min(cap, 25));
}

async function loadAssetPreviewSources(runId) {
  if (!hasAssetPreviewUi()) return;
  const params = [];
  if (runId) params.push("runId=" + encodeURIComponent(runId));
  if (fullRunId) params.push("activeRunId=" + encodeURIComponent(fullRunId));
  const qs = params.length ? ("?" + params.join("&")) : "";
  const json = await api("/asset-preview/sources" + qs);
  const data = json.data || {};
  const selected = fullRunId || runId || data.defaultRunId || "";
  $("assetPreviewRunSelect").innerHTML = (data.runs || []).map(function (run) {
    return '<option value="' + escapeHtml(run.runId) + '"' + (run.runId === selected ? " selected" : "") + ">" + escapeHtml(run.label) + "</option>";
  }).join("") || '<option value="">No Vermont runs found</option>';
  $("assetPreviewChunkSelect").innerHTML = '<option value="">All processed chunks</option>' +
    (data.chunks || []).map(function (chunk) {
      return '<option value="' + escapeHtml(chunk.chunkId) + '">' + escapeHtml(chunk.label) + "</option>";
    }).join("");
  if (selected) $("assetPreviewRunSelect").value = selected;
  const activeRun = (data.runs || []).find(function (r) { return r.runId === selected; });
  if (activeRun && activeRun.maxTotalSpots != null && $("fullRunLimitSpots").checked) {
    $("assetPreviewMaxSpots").value = String(Math.min(activeRun.maxTotalSpots, 25));
  }
  if (!data.prefersWriteRuns) {
    $("assetPreviewStatus").textContent =
      "No write-test/write-prod Full Vermont Run yet — start one above (defaults to write-test + 100 spot cap).";
  } else if (fullRunId && selected === fullRunId) {
    $("assetPreviewStatus").textContent = "Synced to active Full Vermont Run " + fullRunId.slice(0, 20) + "…";
  }
}

async function consumeAssetPreviewSseStream(res, onEvent) {
  if (!res.body) throw new Error("No response stream from server");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    var splitAt;
    while ((splitAt = buffer.indexOf("\\n\\n")) >= 0) {
      const block = buffer.slice(0, splitAt);
      buffer = buffer.slice(splitAt + 2);
      block.split("\\n").forEach(function (line) {
        if (!line.startsWith("data: ")) return;
        var msg;
        try { msg = JSON.parse(line.slice(6)); } catch (_e) { return; }
        onEvent(msg);
      });
    }
  }
}

async function runAssetPreviewFetch() {
  if (assetPreviewLoading) return;
  const maxSpots = Math.max(1, Math.min(100, Number($("assetPreviewMaxSpots").value || 10)));
  const runId = fullRunId || $("assetPreviewRunSelect").value || undefined;
  const chunkId = $("assetPreviewChunkSelect").value || undefined;
  $("assetPreviewEmpty").style.display = "none";
  $("assetPreviewResults").innerHTML = "";
  $("assetPreviewResults").style.display = "block";
  $("assetPreviewProgress").style.display = "grid";
  setAssetPreviewLoading(true, "Streaming spots — first results appear in a few seconds…");
  assetPreviewAbort = new AbortController();
  const geminiKey = ($("assetPreviewGeminiKey").value || "").trim();
  if (geminiKey) {
    try { localStorage.setItem("pbfAssetPreviewGeminiKey", geminiKey); } catch (_e) { /* ignore */ }
  }
  var streamMeta = { totalSpots: maxSpots, runId: runId, photoQueryReady: null };
  var completedSpots = 0;
  var partialProgress = { geminiJudged: 0, geminiRejected: 0, photoLookupsCompleted: 0, geminiEnabled: false };
  try {
    const headers = { "Content-Type": "application/json" };
    if (geminiKey) headers["x-pbf-asset-gemini-api-key"] = geminiKey;
    const res = await fetch(apiBase + "/asset-preview/fetch-stream", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        runId: runId,
        activeRunId: fullRunId || undefined,
        chunkId: chunkId,
        maxSpots: maxSpots,
        concurrency: 6,
        geminiApiKey: geminiKey || undefined,
      }),
      signal: assetPreviewAbort.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      var errJson = null;
      try { errJson = JSON.parse(errText); } catch (_e2) {}
      throw new Error((errJson && errJson.error && errJson.error.message) || errText || "Asset preview stream failed");
    }
    await consumeAssetPreviewSseStream(res, function (msg) {
      if (msg.type === "meta") {
        streamMeta.totalSpots = msg.totalSpots || maxSpots;
        streamMeta.runId = msg.runId || runId;
        streamMeta.photoQueryReady = msg.photoQueryReady;
        $("assetPreviewStatus").textContent = "Loading 0/" + streamMeta.totalSpots + " spots…";
        renderAssetPreviewProgress({ spotsLoaded: streamMeta.totalSpots, photoQueryReady: streamMeta.photoQueryReady }, { completed: 0, total: streamMeta.totalSpots });
      } else if (msg.type === "spot" && msg.item) {
        completedSpots += 1;
        $("assetPreviewResults").insertAdjacentHTML("beforeend", renderAssetPreviewSpot(msg.item));
        const preview = msg.item.assetPreview || {};
        if (preview.provider && preview.provider !== "none") partialProgress.photoLookupsCompleted += 1;
        (preview.externalAssets || []).forEach(function (a) {
          if (a.visionJudgment && a.visionJudgment.automated) partialProgress.geminiJudged += 1;
        });
        if (preview.warnings && preview.warnings.some(function (w) { return w.indexOf("Gemini filtered") >= 0; })) {
          partialProgress.geminiRejected += 1;
        }
        partialProgress.geminiEnabled = true;
        $("assetPreviewStatus").textContent =
          "Loaded " + completedSpots + "/" + (msg.total || streamMeta.totalSpots) + " spots — " + escapeHtml(msg.item.displayName || "spot");
        renderAssetPreviewProgress({
          spotsLoaded: streamMeta.totalSpots,
          photoQueryReady: streamMeta.photoQueryReady,
          photoLookupsCompleted: partialProgress.photoLookupsCompleted,
          geminiEnabled: partialProgress.geminiEnabled,
          geminiJudged: partialProgress.geminiJudged,
          geminiRejected: partialProgress.geminiRejected,
          elapsedMs: 0,
        }, { completed: completedSpots, total: streamMeta.totalSpots });
      } else if (msg.type === "done") {
        renderAssetPreviewProgress(msg.progress || {});
        const prog = msg.progress || {};
        $("assetPreviewStatus").textContent =
          "Loaded " + (msg.items || []).length + " spots from run " + (streamMeta.runId || "—") +
          (prog.photoQueryReady != null ? " · " + prog.photoQueryReady + " query-ready in pool" : "") +
          " · " + ((prog.elapsedMs || 0) / 1000).toFixed(1) + "s total.";
        setStatus("ok", "PBF photo asset preview ready (" + (msg.items || []).length + " spots, " + ((prog.elapsedMs || 0) / 1000).toFixed(1) + "s).");
      } else if (msg.type === "error") {
        throw new Error(msg.message || "Asset preview stream error");
      }
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      $("assetPreviewStatus").textContent = "Fetch stopped.";
      setStatus("warn", "Asset preview fetch stopped.");
    } else {
      const msg = err && err.message ? err.message : String(err);
      $("assetPreviewStatus").textContent = msg;
      setStatus("error", msg);
    }
    $("assetPreviewEmpty").style.display = "block";
  } finally {
    assetPreviewAbort = null;
    setAssetPreviewLoading(false);
  }
}

function clearAssetPreview() {
  if (assetPreviewAbort) assetPreviewAbort.abort();
  $("assetPreviewProgress").style.display = "none";
  $("assetPreviewResults").style.display = "none";
  $("assetPreviewResults").innerHTML = "";
  $("assetPreviewEmpty").style.display = "block";
  $("assetPreviewStatus").textContent = "Cleared preview results.";
}

function syncAssetPreviewRunSelect() {
  if (!fullRunId) return;
  const sel = $("assetPreviewRunSelect");
  if (!sel) return;
  for (let i = 0; i < sel.options.length; i += 1) {
    if (sel.options[i].value === fullRunId) {
      sel.selectedIndex = i;
      void loadAssetPreviewSources(fullRunId);
      return;
    }
  }
}

function bindControls() {
  $("modeBbox").addEventListener("change", function () { if ($("modeBbox").checked) setUiRunMode("bbox"); });
  $("modeFullVermont").addEventListener("change", function () { if ($("modeFullVermont").checked) setUiRunMode("full_vermont"); });
  $("btnRepairMapVisibility").addEventListener("click", function () { void repairMapVisibility(); });
  $("btnFullRunStart").addEventListener("click", function () { void startFullVermontRun(); });
  $("fullRunLimitSpots").addEventListener("change", function () {
    $("fullRunMaxSpots").disabled = !$("fullRunLimitSpots").checked;
  });
  $("btnFullRunPause").addEventListener("click", function () { void fullRunAction("pause"); });
  $("btnFullRunResume").addEventListener("click", function () { void fullRunAction("resume"); });
  $("btnFullRunStop").addEventListener("click", function () { void fullRunAction("stop"); });
  $("btnFullRunWriteCurrent").addEventListener("click", function () {
    void fullRunWrite({
      dryRun: false,
      writeTarget: $("fullRunMode").value === "write_prod" ? "production" : "emulator",
    });
  });
  $("btnFullRunDryWrite").addEventListener("click", function () { void fullRunWrite({ dryRun: true }); });
  $("btnFullRunTestWrite").addEventListener("click", function () { void fullRunWrite({ dryRun: false, writeTarget: "emulator" }); });
  $("btnFullRunProdWrite").addEventListener("click", function () {
    void fullRunWrite({ dryRun: false, writeTarget: "production" });
  });
  $("btnPurgeUndiscovered").addEventListener("click", function () { openPurgeUndiscoveredModal(); });
  $("btnPurgeUndiscoveredDryRun").addEventListener("click", function () { void runPurgeUndiscovered(true); });
  $("btnConfirmPurgeDryRun").addEventListener("click", function () { void runPurgeUndiscovered(true); });
  $("btnConfirmPurgeUndiscovered").addEventListener("click", function () { void runPurgeUndiscovered(false); });
  $("btnCancelPurgeUndiscovered").addEventListener("click", function () { closePurgeUndiscoveredModal(); });
  $("btnValidateFile").addEventListener("click", function () { void validateFile(); });
  $("btnShowAllPosts").addEventListener("click", function () { void scanViewport(); });
  $("btnFitPreview").addEventListener("click", function () { fitPreviewDocs(getFilteredPreviewDocs()); });
  $("btnLoadDbUndiscovered").addEventListener("click", function () { void loadDbUndiscoveredOnMap({ fit: true }); });
  $("btnFitDbUndiscovered").addEventListener("click", function () { void fitDbUndiscoveredOnMap(); });
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
  if (hasAssetPreviewUi()) {
    $("btnAssetPreviewFetch").addEventListener("click", function () { void runAssetPreviewFetch(); });
    $("btnAssetPreviewClear").addEventListener("click", clearAssetPreview);
    $("btnAssetPreviewStop").addEventListener("click", function () { if (assetPreviewAbort) assetPreviewAbort.abort(); });
    $("assetPreviewRunSelect").addEventListener("change", function () {
      void loadAssetPreviewSources($("assetPreviewRunSelect").value).catch(function (err) {
        setStatus("error", err && err.message ? err.message : "Failed to refresh asset preview chunks");
      });
    });
  }
}

try {
  initPreviewMap();
  setUiRunMode("full_vermont");
  bindControls();
  try {
    const savedFullRunId = sessionStorage.getItem("pbfFullRunId");
    if (savedFullRunId) fullRunId = savedFullRunId;
  } catch (_e) { /* ignore */ }
  void loadHealth();
  if (fullRunId) {
    void pollFullRunStatus();
    if (!fullRunPollTimer) fullRunPollTimer = setInterval(function () { void pollFullRunStatus(); }, 3000);
  }
  if (hasAssetPreviewUi()) {
    try {
      const savedGeminiKey = localStorage.getItem("pbfAssetPreviewGeminiKey");
      if (savedGeminiKey) $("assetPreviewGeminiKey").value = savedGeminiKey;
    } catch (_e2) { /* ignore */ }
    void loadAssetPreviewSources(fullRunId || undefined).catch(function (err) {
      $("assetPreviewRunSelect").innerHTML = '<option value="">No runs available</option>';
      $("assetPreviewStatus").textContent = err && err.message ? err.message : "Could not load PBF runs for asset preview";
    });
  }
  startUndiscoveredCountsPolling();
} catch (err) {
  setStatus("error", "Page init failed: " + (err && err.message ? err.message : String(err)));
}
</script>
</body>
</html>`;
}
