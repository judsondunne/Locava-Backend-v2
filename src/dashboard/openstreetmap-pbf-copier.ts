/**
 * Master PBF OSM Copier — /admin/openstreetmap/pbf-copier
 *
 * PBF-first admin page. The UI shows what file the importer is pulling
 * from, what phase the runner is in, every counter you care about, a live
 * console, and preview docs as soon as they are discovered. Dry-run is
 * the default and writes zero Firebase docs. Write mode is hidden behind
 * the existing OSM national write guard PLUS a successful prior dry-run
 * for the same file+config.
 */
export function renderOpenStreetMapPbfCopierPage(): string {
  const apiBase = "/admin/openstreetmap/api/pbf-copier";
  // Render-time tagged template. Keep the entire DOM/CSS/JS in one file
  // so the admin route can serve it as a single HTML response (same
  // convention used by `openstreetmap-national-copier.ts`).
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Master PBF OSM Copier</title>
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
    button.danger{background:#b91c1c}
    button.success{background:#15803d}
    button:disabled{opacity:.5;cursor:not-allowed}
    input,select{padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:12px}
    input[type=number]{width:120px}
    input[type=text]{width:320px}
    label{font-size:12px;color:#cbd5e1;display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0}
    .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border-top:1px solid #334155;padding:6px 8px;text-align:left;vertical-align:top}
    th{background:#0b1220;color:#94a3b8;font-weight:600}
    .badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;margin-right:8px;border:1px solid #334155}
    .badge.dry{background:#1e293b;color:#cbd5e1}
    .badge.emu{background:#172554;color:#93c5fd;border-color:#2563eb}
    .badge.prod{background:#450a0a;color:#fecaca;border-color:#b91c1c}
    .badge.ok{background:#052e16;color:#86efac;border-color:#166534}
    .badge.warn{background:#422006;color:#fcd34d;border-color:#854d0e}
    #warnProd{display:none;background:#450a0a;border:2px solid #b91c1c;color:#fecaca;padding:14px;border-radius:10px;margin:12px 0;font-weight:600}
    #statusBar{padding:12px 14px;border-radius:8px;border:1px solid #334155;background:#0b1220;font-size:13px;margin:12px 0;display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center}
    #statusBar.loading{border-color:#2563eb;background:#172554;color:#bfdbfe}
    #statusBar.ok{border-color:#166534;background:#052e16;color:#86efac}
    #statusBar.warn{border-color:#854d0e;background:#422006;color:#fcd34d}
    #statusBar.error{border-color:#b91c1c;background:#450a0a;color:#fecaca}
    .phase-pill{display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;background:#0b1220;border:1px solid #334155;letter-spacing:.04em}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    .stat-value{font-size:18px;font-weight:700;margin-top:4px;color:#e2e8f0;word-break:break-all}
    .stat-value.warn{color:#fcd34d}
    .stat-value.err{color:#fca5a5}
    .stat-value.ok{color:#86efac}
    .progress{height:14px;background:#1f2937;border-radius:7px;overflow:hidden;margin:8px 0;position:relative}
    .progress > .bar{height:100%;background:linear-gradient(90deg,#2563eb,#22d3ee);width:0%;transition:width .25s ease}
    .progress > .bar.indeterminate{width:30%;background:linear-gradient(90deg,#2563eb,#22d3ee,#2563eb);animation:slide 1.4s linear infinite;background-size:200% 100%}
    @keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(400%)} }
    .progress > .label{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#e2e8f0;font-weight:600}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #334155;font-size:10px;color:#cbd5e1;margin:2px 4px 2px 0;background:#0b1220}
    .pill.warn{border-color:#854d0e;color:#fcd34d}
    .pill.ok{border-color:#166534;color:#86efac}
    .pill.err{border-color:#b91c1c;color:#fca5a5}
    #eventLog{max-height:280px;overflow:auto;font-size:11px;line-height:1.55;background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px;font-family:ui-monospace,Menlo,monospace}
    #eventLog .ev{padding:2px 0;border-bottom:1px dashed #1f2937;color:#e2e8f0}
    #eventLog .ev .ts{color:#64748b;margin-right:6px}
    #eventLog .ev .phase{color:#93c5fd;margin-right:6px;font-weight:600}
    #eventLog .ev.warn{color:#fcd34d}
    #eventLog .ev.warn .phase{color:#fcd34d}
    #eventLog .ev.error{color:#fca5a5}
    #eventLog .ev.error .phase{color:#fca5a5}
    .doc-card{border:1px solid #1f2937;border-radius:8px;padding:10px 12px;margin:8px 0;background:#0b1220}
    .doc-card h3{font-size:14px;margin:0 0 6px;color:#e2e8f0}
    .doc-meta{font-size:11px;color:#94a3b8}
    #previewArea{max-height:560px;overflow:auto}
    code{background:#020617;padding:1px 4px;border-radius:3px;color:#93c5fd}
    .scary{color:#fca5a5;font-weight:700}
    .ok-text{color:#86efac;font-weight:600}
    details summary{cursor:pointer;font-size:12px;color:#93c5fd}
    pre{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#cbd5e1;white-space:pre-wrap;word-break:break-all;background:#020617;border-radius:6px;padding:8px;margin:6px 0}
    .col2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media (max-width: 1000px) { .col2{grid-template-columns:1fr} }
    .activity-panel{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
    .activity-panel .stat-box{background:#0b1220}
    @media (max-width: 720px) { .activity-panel{grid-template-columns:repeat(2,1fr)} }
    .map-shell{height:480px;border-radius:16px;border:1px solid #334155;overflow:hidden;background:#020617}
    .table-wrap{max-height:560px;overflow:auto;border:1px solid #1f2937;border-radius:8px}
    tr:hover{background:#1e293b}
    tr.selected{background:rgba(37,99,235,.12)}
    tr.spot{background:rgba(34,197,94,.04)}
    tr.route{background:rgba(56,189,248,.04)}
    #previewSearchInput{min-width:280px}
    #mapSidebar{font-size:12px;color:#cbd5e1;margin-top:8px;min-height:48px}
    .emoji-marker{font-size:20px;line-height:1;cursor:pointer;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
    .emoji-marker.route{font-size:16px;opacity:.95}
    .map-route-legend{font-size:11px;color:#94a3b8;margin-top:6px}
    .map-popup{font-size:12px;line-height:1.45;max-width:280px}
    .map-popup strong{font-size:13px}
    .map-popup .muted{color:#64748b;font-size:11px}
    .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
    button.tab{background:#0b1220;border:1px solid #334155;color:#cbd5e1;padding:4px 8px;font-size:11px}
    button.tab.active{background:#172554;border-color:#2563eb;color:#fff}
    button.small{padding:4px 8px;font-size:11px}
    .funnel-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}
    .funnel-step{background:#020617;border:1px solid #1f2937;border-radius:10px;padding:10px 12px}
    .write-spots-panel{border:2px solid #15803d;background:linear-gradient(180deg,#052e16 0%,#111827 100%);padding:20px 22px;margin:16px 0;border-radius:14px}
    .write-spots-panel h2{color:#86efac;font-size:16px;text-transform:none;letter-spacing:0;margin:0 0 8px}
    .write-spots-hero{display:block;width:100%;max-width:720px;margin:14px 0;padding:18px 24px;font-size:18px;font-weight:800;background:linear-gradient(90deg,#15803d,#22c55e);border-radius:12px;box-shadow:0 8px 24px rgba(34,197,94,.25)}
    .write-spots-hero:disabled{background:#334155;box-shadow:none}
    .write-spots-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}
    .write-spots-progress{margin-top:14px;padding:12px 14px;border-radius:10px;background:#020617;border:1px solid #166534}
    .write-spots-progress .bar{height:12px;background:#1f2937;border-radius:6px;overflow:hidden;margin:8px 0}
    .write-spots-progress .bar > .fill{height:100%;background:linear-gradient(90deg,#22c55e,#4ade80);width:0%;transition:width .2s ease}
    #writeSpotsModal{position:fixed;inset:0;background:rgba(2,6,23,.82);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px}
    #writeSpotsModal.open{display:flex}
    .write-spots-modal-inner{background:#111827;border:2px solid #b91c1c;border-radius:14px;padding:22px 24px;max-width:440px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.45)}
    .write-spots-modal-inner h3{margin:0 0 8px;font-size:18px;color:#fecaca}
    .write-spots-modal-inner input[type=password]{width:100%;margin:10px 0 14px;padding:10px 12px;font-size:15px}
    .purge-danger-panel{border:2px solid #b91c1c;background:linear-gradient(180deg,#450a0a33 0%,#111827 100%)}
    .purge-danger-panel h2{color:#fecaca;text-transform:none;letter-spacing:0}
    #purgeUndiscoveredModal{position:fixed;inset:0;background:rgba(2,6,23,.85);display:none;align-items:center;justify-content:center;z-index:10000;padding:16px}
    #purgeUndiscoveredModal.open{display:flex}
    .purge-modal-inner{background:#111827;border:3px solid #b91c1c;border-radius:14px;padding:22px 24px;max-width:520px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.5)}
    .purge-modal-inner input[type=text],.purge-modal-inner input[type=password]{width:100%;margin:8px 0 12px;padding:10px 12px;font-size:14px}
    .funnel-step .label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    .funnel-step .value{font-size:22px;font-weight:700;margin-top:4px}
    .funnel-step .note{font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.45}
    .funnel-step.warn{border-color:#854d0e;background:#422006}
    .funnel-step.ok{border-color:#166534;background:#052e16}
    .funnel-step.err{border-color:#991b1b;background:#450a0a}
    .funnel-callout{border:1px solid #334155;border-radius:10px;padding:12px 14px;margin:10px 0;background:#0b1220;line-height:1.55;font-size:13px}
    .funnel-callout.warn{border-color:#854d0e;background:#422006;color:#fcd34d}
    .funnel-callout.info{border-color:#2563eb;background:#172554;color:#bfdbfe}
    .scan-quality-badge{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;margin-left:8px;border:1px solid #334155;background:#0b1220;color:#fcd34d}
    .scan-quality-badge.ok{color:#86efac;border-color:#166534}
    .scan-quality-badge.warn{color:#fcd34d;border-color:#854d0e}
    .helper-box{border:1px dashed #334155;border-radius:8px;padding:10px 12px;margin:8px 0;font-size:12px;color:#cbd5e1;line-height:1.5}
    .helper-box code{display:block;margin-top:6px;white-space:pre-wrap;color:#93c5fd}
    .reason-bar{height:8px;border-radius:4px;background:#1f2937;overflow:hidden;margin-top:4px}
    .reason-bar > span{display:block;height:100%;background:#f97316}
    tr.rejected-row{background:rgba(239,68,68,.04)}
    .reason-code{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#fca5a5}
    .neg-signal{font-size:10px;color:#fca5a5}
    .quota-block{background:#0b1220;border:1px dashed #334155;border-radius:8px;padding:10px 12px;margin:10px 0}
    .quota-presets{align-items:center;gap:6px}
    .inline-controls{display:inline-flex;align-items:center;flex-wrap:wrap;gap:8px}
  </style>
</head>
<body>
<div class="shell">
  <p>
    <a href="/admin">← Admin</a>
    · <a href="/admin/openstreetmap">OSM Classifier</a>
    · <a href="/admin/openstreetmap/national-import">National Import</a>
    · <a href="/admin/openstreetmap/offroad-master">Offroad Master</a>
    · <a href="/admin/openstreetmap/national-copier">National Copier</a>
    · <a href="/admin/openstreetmap/pbf-copier-v2">PBF Copier V2</a>
  </p>
  <h1>Master PBF OSM Copier</h1>
  <p class="muted">
    Read a local <code>.osm.pbf</code> file end-to-end, run the existing Locava classifier on every candidate object,
    and either preview accepted spots/routes or guarded-write them into
    <strong><code>unexploredSpots</code> / <code>unexploredRoutes</code></strong>. Never writes <code>/posts</code>.
  </p>

  <div class="panel purge-danger-panel" id="purgeUndiscoveredPanel" style="display:none">
    <h2>Remove all undiscovered map data</h2>
    <p class="muted">
      Permanently deletes every document in <code>unexploredSpots</code> and <code>unexploredRoutes</code>
      (including route <code>geometryChunks</code> subcollections).
      <strong class="scary">Never touches <code>/posts</code> or any other collection.</strong>
    </p>
    <p class="muted">
      Disabled unless <code id="purgeEnvVarName">OSM_PBF_COPIER_ALLOW_PURGE_UNDISCOVERED</code>=<code>true</code>
      in backend <code>.env</code> and the server was restarted.
    </p>
    <div class="row">
      <button type="button" class="secondary" id="btnPurgeUndiscoveredDryRun">Count docs (dry-run)</button>
      <button type="button" class="danger" id="btnPurgeUndiscovered">Remove ALL undiscovered spots &amp; routes</button>
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
        This removes <strong>all</strong> undiscovered spots and routes from production Firestore.
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
    <h2>What this writes</h2>
    <p>
      <span class="badge ok">Source</span>
      Local <code>.osm.pbf</code> file you point it at (e.g. <code>./data/osm/us-latest.osm.pbf</code>).
    </p>
    <p>
      <span class="badge ok">Target collections</span>
      <code>unexploredSpots</code> and <code>unexploredRoutes</code> only.
    </p>
    <p>
      <span class="badge prod">Never writes</span>
      <code>/posts</code> &mdash; blocked twice (PBF copier + existing OSM national write guard).
    </p>
    <p class="muted">
      Dry-run writes <strong>zero</strong> Firebase documents. Rejected items from the classifier are
      <strong>never written</strong>. Existing deterministic IDs are skipped when <code>skipExisting</code> is on.
      Write mode requires a successful prior dry-run for the same file/config.
    </p>
  </div>

  <div class="panel">
    <h2>Source &amp; mode</h2>
    <div class="row">
      <label>PBF file path
        <input id="filePath" type="text" value="./data/osm/vermont-latest.osm.pbf" placeholder="./data/osm/vermont-latest.osm.pbf"/>
      </label>
      <button type="button" class="secondary" id="btnValidateFile">Validate PBF File</button>
      <span id="fileStatus" class="pill">no file checked yet</span>
    </div>
    <div class="helper-box" id="vermontHelper">
      <strong>Testing with Vermont?</strong> Download from Geofabrik to
      <code>data/osm/vermont-latest.osm.pbf</code>. If the file is missing, run:
      <code id="vermontDownloadCmd">mkdir -p data/osm
curl -L -o data/osm/vermont-latest.osm.pbf https://download.geofabrik.de/north-america/us/vermont-latest.osm.pbf</code>
    </div>
    <div class="row">
      <label>Stop when
        <select id="dryRunStopMode">
          <option value="max_accepted" selected>Max accepted (total)</option>
          <option value="quotas">Activity/category quotas</option>
        </select>
      </label>
      <span id="maxAcceptedControls" class="inline-controls">
        <label>Max accepted
          <select id="dryRunLimit">
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100" selected>100</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
          </select>
        </label>
      </span>
    </div>
    <div id="quotaControls" class="quota-block" style="display:none">
      <div class="row" style="margin-top:0">
        <label style="flex:1">Targets
          <input id="dryRunQuotas" type="text" value="5 beaches, 3 hiking routes" placeholder="5 beaches, 3 hiking routes, 2 waterfalls" style="width:100%;max-width:520px"/>
        </label>
      </div>
      <div class="row quota-presets" style="margin-top:0">
        <span class="muted">Quick add:</span>
        <button type="button" class="secondary small" onclick="appendQuotaPreset('5 beaches')">5 beaches</button>
        <button type="button" class="secondary small" onclick="appendQuotaPreset('10 beaches')">10 beaches</button>
        <button type="button" class="secondary small" onclick="appendQuotaPreset('5 hiking routes')">5 hiking routes</button>
        <button type="button" class="secondary small" onclick="appendQuotaPreset('3 waterfalls')">3 waterfalls</button>
        <button type="button" class="secondary small" onclick="appendQuotaPreset('10 viewpoints')">10 viewpoints</button>
      </div>
      <p class="muted" style="margin-bottom:0">
        Plain English works — e.g. <code>5 beaches</code>, <code>10 hiking routes</code>, or <code>beach:10</code>.
        The scan keeps going until <strong>every</strong> target is filled.
      </p>
    </div>
    <p class="muted" id="stopModeHelp">
      <strong>Max accepted</strong> stops after N total accepted spots/routes.
      <strong>Activity quotas</strong> keep scanning until each target is filled. Rejection counts always reflect everything processed before stop.
    </p>
    <div class="row">
      <label>Node scan cap <span class="muted">(optional — ways still scanned)</span>
        <input id="maxRawObjectsToScan" type="text" value="" placeholder="blank = no cap" style="width:140px"/>
      </label>
      <label>Fast smoke test raw cap
        <input id="fastSmokeRawCap" type="number" value="250000" min="1000" style="width:120px"/>
      </label>
      <label>Classify batch size
        <input id="classifyBatchSize" type="number" value="1000" min="1"/>
      </label>
      <label>State code
        <input id="stateCode" type="text" value="VT" style="width:60px"/>
      </label>
    </div>
    <p class="muted" id="balancedPreviewHelp" style="display:none">Balanced full-file preview: scans into ways/routes before stopping. Node-only preview is not a quality test. Routes require ways/relations.</p>
    <div class="row">
      <label><input id="includeSpots" type="checkbox" checked/> Include spots</label>
      <label><input id="includeRoutes" type="checkbox" checked/> Include routes/offroading</label>
      <label><input id="includePublicOnly" type="checkbox" checked/> Public-ready only</label>
      <label><input id="includeReviewDocs" type="checkbox"/> Include review docs</label>
      <label><input id="skipExisting" type="checkbox" checked/> Skip existing IDs</label>
      <label><input id="overwriteExisting" type="checkbox"/> Overwrite existing <span class="scary">(discouraged)</span></label>
    </div>
    <div class="row" id="geoFilterRow">
      <label><input id="geoFilterEnabled" type="checkbox"/> Region bbox preview <span class="muted">(exhaustive Hartland viewport — all accepted spots/routes in box, full PBF scan)</span></label>
      <label>Center lat
        <input id="geoFilterCenterLat" type="number" step="0.0001" value="43.54063" style="width:110px" disabled/>
      </label>
      <label>Center lng
        <input id="geoFilterCenterLng" type="number" step="0.0001" value="-72.39898" style="width:110px" disabled/>
      </label>
      <label>Radius (km)
        <input id="geoFilterRadiusKm" type="number" step="0.5" min="2" max="80" value="12" style="width:70px" disabled/>
      </label>
      <span class="muted">Same viewport as <a href="/admin/openstreetmap">OSM Classifier</a> Hartland default (12 km).</span>
    </div>
    <div class="row">
      <label>Max docs to write <input id="maxDocsToWrite" type="number" placeholder="(no cap)"/></label>
      <label>Max writes/sec <input id="maxWritesPerSecond" type="number" value="10"/></label>
      <label>Max writes/min <input id="maxWritesPerMinute" type="number" value="3000"/></label>
      <label><input id="stopOnBudgetExceeded" type="checkbox" checked/> Stop on budget exceeded</label>
    </div>
    <div class="row">
      <label>Write target
        <select id="writeTarget">
          <option value="none" selected>none (dry-run only)</option>
          <option value="emulator">emulator</option>
          <option value="production">production</option>
        </select>
      </label>
      <label>Production confirmation
        <input id="confirmProductionWrite" type="text" placeholder="exact phrase"/>
      </label>
      <label>Undiscovered schema confirmation
        <input id="confirmUndiscoveredShape" type="text" placeholder="required for any write run"/>
      </label>
    </div>
    <div id="warnProd">
      ⚠ Production writes require <code id="prodPhrase">…</code> and the env var <code id="prodEnvVar">…</code>=true.
      Before a write run, a successful dry-run for the same file &amp; config must be completed in this server session.
      <br/>Any write also requires <code id="undiscoveredShapePhrase">…</code> to confirm post-like undiscovered schema writes.
    </div>
  </div>

  <div class="panel">
    <h2>Controls</h2>
    <div class="row">
      <button type="button" class="success" id="btnVermontDryRun">Run Vermont Full Dry-Run Preview</button>
      <button type="button" class="success" id="btnQuecheeBboxDryRun">Run Hartland Bbox Preview</button>
      <button type="button" class="secondary" id="btnFastDryRun">Run Fast Smoke Test</button>
      <button type="button" id="btnDryRunPreview">Run Dry-Run Preview</button>
      <button type="button" class="success" id="btnWrite" disabled>Start Write Run</button>
      <button type="button" class="secondary" id="btnPause">Pause</button>
      <button type="button" class="secondary" id="btnResume">Resume</button>
      <button type="button" class="danger" id="btnCancel">Cancel</button>
    </div>
    <div class="row">
      <button type="button" class="secondary" id="btnExport">Export Dry-Run JSON</button>
      <button type="button" class="secondary" id="btnCopySummary">Copy Run Summary</button>
      <button type="button" class="secondary" id="btnClearConsole">Clear Console</button>
    </div>
  </div>

  <div id="statusBar">
    <span class="phase-pill" id="phasePill">idle</span>
    <span id="scanQualityBadge" class="scan-quality-badge" style="display:none"></span>
    <span id="statusMessage">Ready. Validate a PBF file path, then run a dry-run preview.</span>
    <span id="runIdLabel" class="muted"></span>
  </div>
  <div id="scanWarningsBox" class="funnel-callout warn" style="display:none;margin:12px 0"></div>

  <div class="panel">
    <h2>Progress</h2>
    <div class="progress"><div class="bar" id="bytesBar"></div><div class="label" id="bytesBarLabel"></div></div>
    <p class="muted" id="progressMeta">Object counters update live during scan. Byte progress is shown only when the parser reports bytes read.</p>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-label">File bytes read</div><div class="stat-value" id="m_fileBytesRead">0</div></div>
      <div class="stat-box"><div class="stat-label">File bytes total</div><div class="stat-value" id="m_fileBytesTotal">0</div></div>
      <div class="stat-box"><div class="stat-label">Raw objects scanned</div><div class="stat-value" id="m_rawObjectsScanned">0</div></div>
      <div class="stat-box"><div class="stat-label">Nodes scanned</div><div class="stat-value" id="m_nodesScanned">0</div></div>
      <div class="stat-box"><div class="stat-label">Ways scanned</div><div class="stat-value" id="m_waysScanned">0</div></div>
      <div class="stat-box"><div class="stat-label">Relations scanned</div><div class="stat-value" id="m_relationsScanned">0</div></div>
      <div class="stat-box"><div class="stat-label">Relations skipped (geometry)</div><div class="stat-value" id="m_relationsSkippedGeometry">0</div></div>
      <div class="stat-box"><div class="stat-label">Candidate objects found</div><div class="stat-value" id="m_candidateObjectsFound">0</div></div>
      <div class="stat-box"><div class="stat-label">Candidates sent to classifier</div><div class="stat-value" id="m_candidatesSentToClassifier">0</div></div>
      <div class="stat-box"><div class="stat-label">Accepted spots</div><div class="stat-value ok" id="m_acceptedSpots">0</div></div>
      <div class="stat-box"><div class="stat-label">Accepted routes</div><div class="stat-value ok" id="m_acceptedRoutes">0</div></div>
      <div class="stat-box"><div class="stat-label">Rejected by classifier</div><div class="stat-value warn" id="m_rejectedByClassifier">0</div></div>
      <div class="stat-box"><div class="stat-label">Skipped invalid</div><div class="stat-value warn" id="m_skippedInvalid">0</div></div>
      <div class="stat-box"><div class="stat-label">Skipped missing coords</div><div class="stat-value warn" id="m_skippedMissingCoordinates">0</div></div>
      <div class="stat-box"><div class="stat-label">Skipped missing activities</div><div class="stat-value warn" id="m_skippedMissingActivities">0</div></div>
      <div class="stat-box"><div class="stat-label">Skipped duplicate</div><div class="stat-value" id="m_skippedDuplicate">0</div></div>
      <div class="stat-box"><div class="stat-label">Skipped existing</div><div class="stat-value" id="m_skippedExisting">0</div></div>
      <div class="stat-box"><div class="stat-label">Docs previewed</div><div class="stat-value ok" id="m_docsPreviewed">0</div></div>
      <div class="stat-box"><div class="stat-label">Docs written</div><div class="stat-value ok" id="m_docsWritten">0</div></div>
      <div class="stat-box"><div class="stat-label">Batches written</div><div class="stat-value" id="m_batchesWritten">0</div></div>
      <div class="stat-box"><div class="stat-label">Writer calls</div><div class="stat-value" id="m_writerCalls">0</div></div>
      <div class="stat-box"><div class="stat-label">Estimated writes</div><div class="stat-value" id="m_estimatedWrites">0</div></div>
      <div class="stat-box"><div class="stat-label">Estimated reads</div><div class="stat-value" id="m_estimatedReads">0</div></div>
      <div class="stat-box"><div class="stat-label">Errors</div><div class="stat-value err" id="m_errors">0</div></div>
      <div class="stat-box"><div class="stat-label">Warnings</div><div class="stat-value warn" id="m_warnings">0</div></div>
      <div class="stat-box"><div class="stat-label">Raw/s</div><div class="stat-value" id="m_rawObjectsPerSecond">0</div></div>
      <div class="stat-box"><div class="stat-label">Candidates/s</div><div class="stat-value" id="m_candidatesPerSecond">0</div></div>
      <div class="stat-box"><div class="stat-label">Accepted/s</div><div class="stat-value" id="m_acceptedDocsPerSecond">0</div></div>
      <div class="stat-box"><div class="stat-label">Elapsed</div><div class="stat-value" id="m_elapsedMs">0</div></div>
      <div class="stat-box"><div class="stat-label">ETA remaining</div><div class="stat-value" id="m_estimatedRemainingMs">—</div></div>
    </div>
  </div>

  <div class="col2">
    <div class="panel">
      <h2>Current activity</h2>
      <div class="activity-panel">
        <div class="stat-box"><div class="stat-label">Currently scanning</div><div class="stat-value" id="a_currentObjectType">—</div></div>
        <div class="stat-box"><div class="stat-label">Current OSM id</div><div class="stat-value" id="a_currentOsmId">—</div></div>
        <div class="stat-box"><div class="stat-label">Current label / tag</div><div class="stat-value" id="a_currentLabel">—</div></div>
        <div class="stat-box"><div class="stat-label">Phase detail</div><div class="stat-value" id="a_currentPhaseDetail">—</div></div>
      </div>
      <p class="muted" style="margin-top:8px">
        Parser: <span id="parserId">—</span> <span id="parserVersion"></span> ·
        Source provider: <span id="sourceProvider">—</span>
      </p>
    </div>

    <div class="panel">
      <h2>Real-time console</h2>
      <div id="eventLog"></div>
    </div>
  </div>

  <div class="panel" id="diagnosePlacePanel">
    <h2>Diagnose a place by name</h2>
    <p class="muted">Read-only scan of the PBF for every OSM object matching your search text. Shows tag filter, adapter, classifier, and doc-build outcomes.</p>
    <div class="row">
      <label style="flex:1">Search text
        <input id="diagnoseSearchText" type="text" placeholder="Cedar Beach, waterfall, falls, beach…"/>
      </label>
      <label><input id="diagnoseIncludeNodes" type="checkbox" checked/> Nodes</label>
      <label><input id="diagnoseIncludeWays" type="checkbox" checked/> Ways</label>
      <label><input id="diagnoseIncludeRelations" type="checkbox" checked/> Relations</label>
      <label>Raw cap <span class="muted">(optional)</span>
        <input id="diagnoseRawCap" type="text" placeholder="blank = no cap" style="width:120px"/>
      </label>
      <button type="button" class="secondary" id="btnDiagnosePlace">Find in PBF + Explain</button>
    </div>
    <p class="muted" id="diagnoseMeta">No diagnosis run yet.</p>
    <div class="table-wrap" style="max-height:420px">
      <table>
        <thead><tr>
          <th>OSM</th><th>Name</th><th>Tags</th><th>Tag filter</th><th>Classifier</th><th>Category / activities</th><th>Would build</th><th>Note</th>
        </tr></thead>
        <tbody id="diagnoseResultsBody"></tbody>
      </table>
    </div>
  </div>

  <div class="panel" id="pipelineFunnelPanel">
    <h2>Pipeline funnel — why so few accepted?</h2>
    <p class="muted">
      The <strong>max accepted</strong> setting stops the scan once that many accepted spots/routes are found. Rejection counts still reflect everything processed before stop.
      If you see fewer than your limit, something upstream (scan cap, tag filter, or classifier) stopped items from being accepted.
    </p>
    <div id="pipelineFunnelCallout" class="funnel-callout info">Run a dry-run to see the full funnel breakdown.</div>
    <div id="pipelineFunnelGrid" class="funnel-grid"></div>
  </div>

  <div class="panel" id="previewExplorerPanel">
    <h2>Dry-run explorer</h2>
    <p class="muted">
      All accepted spots/routes from this dry-run (up to your selected limit) — map, search, and table, like the
      <a href="/admin/openstreetmap">OSM Classifier</a>. Updates live while the run is in progress. Zero Firebase writes.
    </p>
    <p class="muted" id="previewLimitMeta">No preview docs yet. Run a dry-run to populate.</p>

    <div class="write-spots-panel" id="writeSpotsPanel" style="display:none">
      <h2>Write loaded preview to production</h2>
      <p class="muted" id="writeSpotsBlurb">
        Dry-run finished. Writes every spot and route on the map into <code>unexploredSpots</code> and <code>unexploredRoutes</code> (same payloads as the preview). Never writes <code>/posts</code>.
      </p>
      <button type="button" class="write-spots-hero" id="btnWriteAllSpots" disabled>
        Write all <span id="writeAllSpotsCount">0</span> loaded items to production
      </button>
      <p class="muted" id="writeSpotsBreakdown" style="margin:6px 0 12px"></p>
      <div class="write-spots-row">
        <label>Write first
          <input id="writeSpotsLimit" type="number" min="1" value="10" style="width:90px"/>
          items (spots + routes, preview order)
        </label>
        <button type="button" class="success" id="btnWriteNSpots" disabled>Write N items</button>
        <label><input id="writeSpotsSkipExisting" type="checkbox" checked/> Skip existing IDs</label>
      </div>
      <div class="write-spots-progress" id="writeSpotsProgress" style="display:none">
        <strong id="writeSpotsProgressTitle">Writing preview docs…</strong>
        <div class="bar"><div class="fill" id="writeSpotsProgressBar"></div></div>
        <span class="muted" id="writeSpotsProgressMeta">0 / 0 written</span>
      </div>
    </div>

    <div id="writeSpotsModal" aria-hidden="true" style="display:none">
      <div class="write-spots-modal-inner">
        <h3>Confirm production write</h3>
        <p class="muted">You are about to write spots and routes to <strong>production</strong> (<code>unexploredSpots</code> + <code>unexploredRoutes</code>). Enter the production password to continue.</p>
        <input id="writeSpotsPassword" type="password" placeholder="Production password" autocomplete="off"/>
        <div class="row">
          <button type="button" class="danger" id="btnConfirmWriteSpots">Write preview docs now</button>
          <button type="button" class="secondary" id="btnCancelWriteSpots">Cancel</button>
        </div>
        <p class="muted" id="writeSpotsModalHint" style="margin-top:10px;font-size:14px">
          <strong>Type exactly:</strong> <code id="writeSpotsPasswordHint">Cooper</code>
          — no env var required. (Alternative: set <code>OSM_NATIONAL_IMPORT_ALLOW_PROD_WRITE=true</code> in backend <code>.env</code> and paste the long production phrase from advanced settings.)
        </p>
      </div>
    </div>

    <h3 style="margin-top:14px">Map</h3>
    <div class="row">
      <button type="button" id="btnFitPreview" class="secondary">Fit all preview docs</button>
      <button type="button" id="btnShowAllPreview" class="secondary">Show all on map</button>
      <button type="button" id="btnClearPreviewMap" class="secondary">Clear map highlights</button>
      <span id="previewMapMeta" class="muted"></span>
    </div>
    <div class="map-shell"><div id="previewMap" style="width:100%;height:100%"></div></div>
    <div class="map-route-legend">Routes draw as green trail lines; spots use emoji pins. Click a row or Map button to focus.</div>
    <div id="mapSidebar"></div>

    <h3 style="margin-top:14px">Search &amp; filter</h3>
    <div class="row">
      <label style="flex:1">Search
        <input id="previewSearchInput" type="text" placeholder="Name, activity, category, tag, OSM id, source id…"/>
      </label>
      <label>Kind
        <select id="previewFilterKind">
          <option value="all">All kinds</option>
          <option value="spot">Spots only</option>
          <option value="route">Routes only</option>
        </select>
      </label>
      <label>Map readiness
        <select id="previewFilterReadiness">
          <option value="all">All</option>
          <option value="ready">Ready</option>
          <option value="review">Review</option>
          <option value="hidden">Hidden</option>
        </select>
      </label>
      <button type="button" id="btnPreviewSearch" class="secondary">Search</button>
    </div>
    <div class="row">
      <button type="button" class="tab preview-preset" data-preset="hiking">Hiking</button>
      <button type="button" class="tab preview-preset" data-preset="swimming">Swimming</button>
      <button type="button" class="tab preview-preset" data-preset="viewpoints">Viewpoints</button>
      <button type="button" class="tab preview-preset" data-preset="food">Food</button>
      <button type="button" class="tab preview-preset" data-preset="offroad">Offroad</button>
      <button type="button" class="tab preview-preset" data-preset="nature">Nature</button>
      <button type="button" class="tab preview-preset" data-preset="waterfall">Waterfalls</button>
      <label><input type="checkbox" id="previewOnlyPublic"/> Public map eligible only</label>
      <label><input type="checkbox" id="previewNameInferredOnly"/> Name-inferred only</label>
      <label><input type="checkbox" id="previewExplicitTagOnly"/> Explicit-tag only</label>
      <label><input type="checkbox" id="previewWaysOnly"/> Ways only</label>
      <label><input type="checkbox" id="previewRoutesOnly"/> Routes/trails only</label>
    </div>
    <div id="previewSummaryGrid" class="summary-grid"></div>

    <h3 style="margin-top:14px">Accepted preview docs (<span id="previewResultCount">0</span> / <span id="previewResultTotal">0</span>)</h3>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Kind</th><th>Name</th><th>Primary</th><th>Activities</th><th>Category</th>
          <th>Tags</th><th>Name hint</th><th>Ready</th><th>Public</th><th>OSM</th><th>Coords</th><th></th>
        </tr></thead>
        <tbody id="previewResultsBody"></tbody>
      </table>
    </div>
  </div>

  <div class="panel" id="rejectionExplorerPanel">
    <h2>Classifier rejections — exact reasons</h2>
    <p class="muted">
      Every candidate sent to the Locava classifier is listed here when rejected, with the exact
      <code>rejectionReason</code>, score, tags, and negative signals. Search or filter by reason code.
    </p>
    <p class="muted" id="rejectionMeta">No rejection data yet.</p>

    <h3 style="margin-top:14px">Rejection reason breakdown</h3>
    <div class="table-wrap" style="max-height:320px">
      <table>
        <thead><tr>
          <th>Reason code</th><th>What it means</th><th>Count</th><th>Share</th><th></th>
        </tr></thead>
        <tbody id="rejectionReasonBody"></tbody>
      </table>
    </div>

    <h3 style="margin-top:14px">Search rejected candidates</h3>
    <div class="row">
      <label style="flex:1">Search
        <input id="rejectedSearchInput" type="text" placeholder="Name, reason, tag, OSM id, negative signal…"/>
      </label>
      <label>Reason
        <select id="rejectedFilterReason"><option value="all">All reasons</option></select>
      </label>
      <label>OSM type
        <select id="rejectedFilterOsmType">
          <option value="all">All types</option>
          <option value="node">node</option>
          <option value="way">way</option>
          <option value="relation">relation</option>
        </select>
      </label>
      <button type="button" id="btnRejectedSearch" class="secondary">Search</button>
    </div>

    <h3 style="margin-top:14px">Rejected items (<span id="rejectedResultCount">0</span> / <span id="rejectedResultTotal">0</span>)</h3>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Reason</th><th>Name / label</th><th>OSM type</th><th>Score</th><th>Raw type</th>
          <th>Top tags</th><th>Negative signals</th><th>Coords</th><th></th>
        </tr></thead>
        <tbody id="rejectedResultsBody"></tbody>
      </table>
    </div>

    <div class="row" style="margin-top:10px">
      <div id="activitySamples"></div>
      <div id="metadataWarnings"></div>
    </div>
  </div>

  <details class="panel">
    <summary>Health &amp; safety surface</summary>
    <pre id="healthDump">(loading…)</pre>
  </details>
</div>

<script>
const apiBase = ${JSON.stringify(apiBase)};
const OSM_STYLE = { version:8, sources:{ osm:{ type:"raster", tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize:256 }}, layers:[{id:"osm",type:"raster",source:"osm"}]};
const HARTLAND_VT_CENTER = { lat: 43.54063, lng: -72.39898 };
const QUECHEE_VT_CENTER = { lat: 43.646, lng: -72.418 };
const PREVIEW_ROUTES_SOURCE = "preview-routes-all";
const PREVIEW_ROUTES_LAYER = "preview-routes-all-line";
const PREVIEW_ROUTE_SELECTED_SOURCE = "preview-route-selected";
const PREVIEW_ROUTE_SELECTED_LAYER = "preview-route-selected-line";
const PREVIEW_GEO_RADIUS_SOURCE = "preview-geo-radius";
const PREVIEW_GEO_RADIUS_LAYER = "preview-geo-radius-line";
let activeRunId = null;
let pollTimer = null;
let lastDryRunProofToken = null;
let lastDryRunFilePathHash = null;
let lastPreviewDocs = [];
// Pinned when a dry-run completes — survives preview write runs (empty previewDocs).
let lastDryRunPreviewDocs = [];
let lastDryRunSnapshot = null;
let lastDryRunLimit = 20;
let lastRejectedSamples = [];
let lastRejectionReasonCounts = {};
let lastRunSnapshot = null;
let previewMap = null;
let previewMarkers = [];
let previewMapReady = false;
let selectedPreviewDocId = null;
let vermontProductionPassword = "Cooper";
let undiscoveredShapePhrase = "";
let pendingWriteSpotsLimit = null;
let purgeUndiscoveredConfirmation = "DELETE_ALL_UNDISCOVERED_SPOTS_AND_ROUTES";
let purgeRequestInFlight = false;
let lastCompletedDryRunId = null;

function $(id) { return document.getElementById(id); }
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}
function fmtMs(n) {
  n = Number(n) || 0;
  if (n < 1000) return n + " ms";
  const s = n / 1000;
  if (s < 60) return s.toFixed(1) + " s";
  const m = s / 60;
  if (m < 60) return m.toFixed(1) + " min";
  return (m / 60).toFixed(1) + " h";
}
function setStatus(kind, message) {
  const bar = $("statusBar");
  bar.className = kind;
  $("statusMessage").textContent = message;
}
function setPhase(phase) {
  $("phasePill").textContent = phase || "idle";
}

async function api(path, options) {
  const res = await fetch(apiBase + path, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || json?.error || res.statusText);
  }
  return json;
}

function syncPurgePanelFromHealth(data) {
  const enabled = Boolean(data && data.purgeUndiscoveredEnabled);
  const panel = $("purgeUndiscoveredPanel");
  if (panel) panel.style.display = enabled ? "block" : "none";
  if (data && data.purgeUndiscoveredEnvVar && $("purgeEnvVarName")) {
    $("purgeEnvVarName").textContent = data.purgeUndiscoveredEnvVar;
  }
  if (data && data.purgeUndiscoveredConfirmation) {
    purgeUndiscoveredConfirmation = data.purgeUndiscoveredConfirmation;
    if ($("purgeConfirmPhraseHint")) $("purgeConfirmPhraseHint").textContent = purgeUndiscoveredConfirmation;
  }
  if (!enabled && $("purgeUndiscoveredMeta")) {
    $("purgeUndiscoveredMeta").textContent =
      "Purge controls hidden — set OSM_PBF_COPIER_ALLOW_PURGE_UNDISCOVERED=true in .env and restart backend.";
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
  const ids = [
    "btnPurgeUndiscoveredDryRun",
    "btnPurgeUndiscovered",
    "btnConfirmPurgeDryRun",
    "btnConfirmPurgeUndiscovered",
  ];
  ids.forEach(function (id) {
    const el = $(id);
    if (el) el.disabled = busy;
  });
}

async function runPurgeUndiscovered(dryRun) {
  if (purgeRequestInFlight) return;
  const creds = readPurgeCredentials();
  if (creds.phrase !== purgeUndiscoveredConfirmation) {
    setStatus(
      "warn",
      "Paste the confirmation phrase exactly: " + purgeUndiscoveredConfirmation
    );
    return;
  }
  if (!creds.password) {
    setStatus("warn", "Enter production password Cooper.");
    return;
  }
  setPurgeControlsBusy(true);
  setStatus("loading", dryRun ? "Counting undiscovered docs (fast aggregate query)…" : "Deleting undiscovered spots and routes…");
  if ($("purgeUndiscoveredMeta")) {
    $("purgeUndiscoveredMeta").textContent = dryRun ? "Count in progress…" : "Delete in progress…";
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
    const meta =
      (dryRun ? "Would delete: " : "Deleted: ")
      + (data.spotsDeleted || 0).toLocaleString() + " spot(s), "
      + (data.routesDeleted || 0).toLocaleString() + " route(s)"
      + (dryRun ? " (geometryChunks not counted in fast dry-run)." : ", "
      + (data.geometryChunksDeleted || 0).toLocaleString() + " geometry chunk(s). ")
      + (data.scope || "");
    if ($("purgeUndiscoveredMeta")) $("purgeUndiscoveredMeta").textContent = meta;
    if (!dryRun) closePurgeUndiscoveredModal();
    setStatus("ok", dryRun ? "Dry-run count complete (zero deletes)." : "Purge complete. Posts were not touched.");
  } catch (err) {
    setStatus("error", "Purge failed: " + err.message);
    if ($("purgeUndiscoveredMeta")) $("purgeUndiscoveredMeta").textContent = "Error: " + err.message;
  } finally {
    setPurgeControlsBusy(false);
  }
}

function bindClick(id, handler) {
  const el = $(id);
  if (!el) {
    console.warn("PBF copier: missing control #" + id);
    return;
  }
  el.addEventListener("click", handler);
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
    $("healthDump").textContent = JSON.stringify(json, null, 2);
    const data = json && json.data || json;
    $("prodPhrase").textContent = data.productionConfirmationPhrase || "";
    $("undiscoveredShapePhrase").textContent = data.undiscoveredShapeConfirmationPhrase || "";
    $("prodEnvVar").textContent = data.productionEnvVarName || "";
    if (data.vermontProductionPassword) vermontProductionPassword = data.vermontProductionPassword;
    if (data.undiscoveredShapeConfirmationPhrase) undiscoveredShapePhrase = data.undiscoveredShapeConfirmationPhrase;
    syncPurgePanelFromHealth(data);
    if (!data.parserAvailable) {
      setStatus("warn", "PBF parser is not installed (" + (data.parserAvailabilityReason || "module_not_installed") + "). Tests still run with synthetic readers; production needs: npm install osm-pbf-parser-node");
    }
  } catch (err) {
    $("healthDump").textContent = "(health request failed: " + err.message + ")";
  }
}

async function validateFile() {
  const filePath = $("filePath").value.trim();
  if (!filePath) { setStatus("warn", "Enter a PBF file path first."); return; }
  setStatus("loading", "Validating " + filePath + " …");
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
      const vermontHint = filePath.toLowerCase().includes("vermont")
        ? " Download: see Vermont helper box below (mkdir + curl to data/osm/vermont-latest.osm.pbf)."
        : "";
      setStatus("error", "File not found: " + data.resolvedPath + vermontHint);
      return;
    }
    if (!data.readable) {
      $("fileStatus").textContent = "not readable";
      $("fileStatus").className = "pill err";
      setStatus("error", "File not readable: " + data.warnings.join("; "));
      return;
    }
    $("fileStatus").textContent = "ok · " + fmtBytes(data.fileSizeBytes);
    $("fileStatus").className = "pill ok";
    if (!data.isPbfExtension) $("fileStatus").textContent += " (not .osm.pbf)";
    setStatus("ok", "File ok (" + fmtBytes(data.fileSizeBytes) + "). Dry-run uses zero Firebase writes.");
  } catch (err) {
    setStatus("error", "Validate failed: " + err.message);
  }
}

function parseOptionalRawCap(value) {
  const t = String(value ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function inferStateCodeFromPath(filePath) {
  const base = String(filePath || "").toLowerCase().replace(/\\\\/g, "/");
  if (base.includes("vermont")) return "VT";
  if (base.includes("new-hampshire") || base.includes("newhampshire") || /\\/nh-/.test(base)) return "NH";
  if (base.includes("maine")) return "ME";
  if (base.includes("massachusetts")) return "MA";
  if (base.includes("connecticut")) return "CT";
  if (base.includes("rhode-island")) return "RI";
  return "US";
}

function syncStateCodeFromFilePath() {
  $("stateCode").value = inferStateCodeFromPath($("filePath").value.trim());
}

function parseEmbeddedQuotaPhrasesClient(text, out) {
  const patterns = [
    [/(\d+)\s+hiking\s+routes?\b/gi, "hiking_route"],
    [/(\d+)\s+hiking\s+trails?\b/gi, "hiking_route"],
    [/(\d+)\s+beaches?\b/gi, "beach"],
    [/(\d+)\s+waterfalls?\b/gi, "waterfall"],
    [/(\d+)\s+viewpoints?\b/gi, "viewpoint"],
    [/(\d+)\s+peaks?\b/gi, "peak"],
    [/(\d+)\s+routes?\b/gi, "route"],
    [/(\d+)\s+spots?\b/gi, "spot"],
  ];
  for (const row of patterns) {
    const re = row[0];
    const key = row[1];
    for (const match of String(text || "").matchAll(re)) {
      const target = Number(match[1]);
      if (Number.isFinite(target) && target >= 1) {
        out[key] = (out[key] || 0) + Math.floor(target);
      }
    }
  }
}

function parseDryRunQuotaTextClient(text) {
  const out = {};
  const raw = String(text || "").trim();
  if (!raw) return out;
  const parts = raw.split(/[,;\\n]+|\\s+and\\s+/i);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    let key = "";
    let target = 0;
    const colonMatch = trimmed.match(/^([^:=]+)\s*[:=]\s*(\d+)\s*$/);
    if (colonMatch) {
      key = normalizeQuotaKeyClient(colonMatch[1]);
      target = Number(colonMatch[2]);
    } else {
      const countFirstMatch = trimmed.match(/^(\d+)\s+(.+)$/);
      if (countFirstMatch) {
        target = Number(countFirstMatch[1]);
        key = normalizeQuotaKeyClient(countFirstMatch[2]);
      }
    }
    if (key && Number.isFinite(target) && target >= 1) {
      out[key] = (out[key] || 0) + Math.floor(target);
      continue;
    }
    parseEmbeddedQuotaPhrasesClient(trimmed, out);
  }
  if (Object.keys(out).length === 0) {
    parseEmbeddedQuotaPhrasesClient(raw, out);
  }
  return out;
}

const QUOTA_KEY_ALIASES_CLIENT = {
  hiking_route: "hiking_route",
  hiking_routes: "hiking_route",
  hiking_trail: "hiking_route",
  hiking_trails: "hiking_route",
  trail: "hiking",
  trails: "hiking",
  routes: "route",
  route: "route",
  spots: "spot",
  spot: "spot",
  beaches: "beach",
  beach: "beach",
  waterfall: "waterfall",
  waterfalls: "waterfall",
  peak: "peak",
  peaks: "peak",
  viewpoint: "viewpoint",
  viewpoints: "viewpoint",
  view: "viewpoint",
};

function normalizeQuotaKeyClient(raw) {
  const key = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return QUOTA_KEY_ALIASES_CLIENT[key] || key;
}

function syncStopModeControls() {
  const quotaMode = $("dryRunStopMode").value === "quotas";
  $("maxAcceptedControls").style.display = quotaMode ? "none" : "inline-flex";
  $("quotaControls").style.display = quotaMode ? "block" : "none";
}

function appendQuotaPreset(text) {
  const input = $("dryRunQuotas");
  const current = String(input.value || "").trim();
  input.value = current ? current + ", " + text : text;
  $("dryRunStopMode").value = "quotas";
  syncStopModeControls();
}

function syncGeoFilterControls() {
  const on = $("geoFilterEnabled").checked;
  $("geoFilterCenterLat").disabled = !on;
  $("geoFilterCenterLng").disabled = !on;
  $("geoFilterRadiusKm").disabled = !on;
  if (on) {
    $("includePublicOnly").checked = false;
    $("includeReviewDocs").checked = true;
    if ($("previewOnlyPublic")) $("previewOnlyPublic").checked = false;
  }
  drawGeoFilterBboxOnMap(readConfig());
}

function docWithinGeoFilterBbox(doc, cfg) {
  if (!cfg || !cfg.geoFilterEnabled) return true;
  const center = {
    lat: cfg.geoFilterCenterLat != null ? Number(cfg.geoFilterCenterLat) : HARTLAND_VT_CENTER.lat,
    lng: cfg.geoFilterCenterLng != null ? Number(cfg.geoFilterCenterLng) : HARTLAND_VT_CENTER.lng,
  };
  const radiusKm = Number(cfg.geoFilterRadiusKm) || 12;
  const bbox = bboxFromCenterRadiusKm(center, radiusKm);
  const lat = doc.lat != null ? doc.lat : doc.center && doc.center.lat;
  const lng = doc.lng != null ? doc.lng : doc.center && doc.center.lng;
  if (lat == null || lng == null) return false;
  if (doc.kind === "unexplored_route" && doc.routeLineCoordinates && doc.routeLineCoordinates.length >= 2) {
    for (let i = 0; i < doc.routeLineCoordinates.length; i += 1) {
      const p = doc.routeLineCoordinates[i];
      if (p.lat >= bbox.minLat && p.lat <= bbox.maxLat && p.lng >= bbox.minLng && p.lng <= bbox.maxLng) return true;
    }
  }
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

function drawGeoFilterBboxOnMap(cfg) {
  if (!previewMap || !previewMapReady) return;
  ensurePreviewRouteLayers();
  if (cfg && cfg.geoFilterEnabled) {
    const center = {
    lat: cfg.geoFilterCenterLat != null ? Number(cfg.geoFilterCenterLat) : HARTLAND_VT_CENTER.lat,
    lng: cfg.geoFilterCenterLng != null ? Number(cfg.geoFilterCenterLng) : HARTLAND_VT_CENTER.lng,
    };
    const radiusKm = Number(cfg.geoFilterRadiusKm) || 12;
    const bbox = bboxFromCenterRadiusKm(center, radiusKm);
    previewMap.getSource(PREVIEW_GEO_RADIUS_SOURCE).setData({
      type: "FeatureCollection",
      features: [bboxPolygon(bbox)],
    });
    previewMap.fitBounds([[bbox.minLng, bbox.minLat], [bbox.maxLng, bbox.maxLat]], { padding: 40, duration: 600 });
  } else {
    previewMap.getSource(PREVIEW_GEO_RADIUS_SOURCE).setData({ type: "FeatureCollection", features: [] });
  }
}

function readConfig() {
  const dryRunQuotas = parseDryRunQuotaTextClient($("dryRunQuotas").value);
  const stopMode =
    Object.keys(dryRunQuotas).length > 0
      ? "quotas"
      : $("dryRunStopMode").value === "quotas"
        ? "quotas"
        : "max_accepted";
  if (stopMode === "quotas") {
    $("dryRunStopMode").value = "quotas";
    syncStopModeControls();
  }
  return {
    filePath: $("filePath").value.trim(),
    dryRunLimit: Number($("dryRunLimit").value) || 20,
    dryRunStopMode: stopMode,
    maxAcceptedMode: stopMode === "max_accepted",
    dryRunQuotas,
    maxRawObjectsToScan: parseOptionalRawCap($("maxRawObjectsToScan").value),
    classifyBatchSize: Number($("classifyBatchSize").value) || 1000,
    includeSpots: $("includeSpots").checked,
    includeRoutes: $("includeRoutes").checked,
    includePublicOnly: $("includePublicOnly").checked,
    includeReviewDocs: $("includeReviewDocs").checked,
    skipExisting: $("skipExisting").checked,
    overwriteExisting: $("overwriteExisting").checked,
    maxDocsToWrite: $("maxDocsToWrite").value ? Number($("maxDocsToWrite").value) : null,
    maxWritesPerSecond: Number($("maxWritesPerSecond").value) || 10,
    maxWritesPerMinute: Number($("maxWritesPerMinute").value) || 3000,
    stopOnBudgetExceeded: $("stopOnBudgetExceeded").checked,
    stateCode: $("stateCode").value.trim() || "US",
    geoFilterEnabled: $("geoFilterEnabled").checked,
    geoFilterCenterLat: $("geoFilterEnabled").checked ? Number($("geoFilterCenterLat").value) || HARTLAND_VT_CENTER.lat : null,
    geoFilterCenterLng: $("geoFilterEnabled").checked ? Number($("geoFilterCenterLng").value) || HARTLAND_VT_CENTER.lng : null,
    geoFilterRadiusKm: Number($("geoFilterRadiusKm").value) || 12,
    includePublicOnly: $("geoFilterEnabled").checked ? false : $("includePublicOnly").checked,
    includeReviewDocs: $("geoFilterEnabled").checked ? true : $("includeReviewDocs").checked,
  };
}

async function runFastDryRun() {
  const cap = parseOptionalRawCap($("fastSmokeRawCap").value) ?? 250000;
  return runDryRunPreview({ fast: true, acceptedLimit: 5, maxRawObjectsToScan: cap });
}

async function runQuecheeBboxDryRun() {
  $("filePath").value = "./data/osm/vermont-latest.osm.pbf";
  $("stateCode").value = "VT";
  $("geoFilterEnabled").checked = true;
  $("geoFilterCenterLat").value = String(HARTLAND_VT_CENTER.lat);
  $("geoFilterCenterLng").value = String(HARTLAND_VT_CENTER.lng);
  $("geoFilterRadiusKm").value = "12";
  syncGeoFilterControls();
  $("dryRunStopMode").value = "max_accepted";
  $("maxRawObjectsToScan").value = "";
  $("includePublicOnly").checked = false;
  $("includeReviewDocs").checked = true;
  $("skipExisting").checked = false;
  return runDryRunPreview({ maxRawObjectsToScan: null });
}

async function runVermontFullDryRun() {
  $("filePath").value = "./data/osm/vermont-latest.osm.pbf";
  $("stateCode").value = "VT";
  $("dryRunStopMode").value = "max_accepted";
  $("maxRawObjectsToScan").value = "";
  $("includePublicOnly").checked = true;
  $("includeReviewDocs").checked = false;
  $("skipExisting").checked = false;
  const config = readConfig();
  return runDryRunPreview({ acceptedLimit: config.dryRunLimit, maxRawObjectsToScan: null });
}

async function runDryRunPreview(opts) {
  opts = opts || {};
  const config = readConfig();
  if (!config.filePath) { setStatus("warn", "Enter a PBF file path first."); return; }
  if (config.dryRunStopMode === "quotas" && Object.keys(config.dryRunQuotas || {}).length === 0) {
    setStatus("warn", "Enter at least one quota target (e.g. 5 beaches, 3 hiking routes).");
    return;
  }
  const acceptedLimit = config.geoFilterEnabled ? undefined : (opts.acceptedLimit ?? config.dryRunLimit);
  try { if (acceptedLimit != null) localStorage.setItem("pbfDryRunLimit", String(acceptedLimit)); } catch (_e) { /* ignore */ }
  setStatus("loading", config.geoFilterEnabled
    ? "Starting Hartland bbox dry-run (full PBF scan, exhaustive viewport preview) for " + config.filePath + " …"
    : "Starting dry-run preview for " + config.filePath + " …");
  setPhase("validating_file");
  clearConsoleDom();
  clearPreviewExplorer();
  clearRejectionExplorer();
  lastDryRunLimit = acceptedLimit ?? 5000;
  try {
    const json = await api("/dry-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: config.filePath,
        acceptedLimit,
        maxRawObjectsToScan:
          opts.maxRawObjectsToScan !== undefined
            ? opts.maxRawObjectsToScan
            : config.maxRawObjectsToScan,
        includeSpots: config.includeSpots,
        includeRoutes: config.includeRoutes,
        includePublicOnly: config.geoFilterEnabled ? false : config.includePublicOnly,
        includeReviewDocs: config.geoFilterEnabled ? true : config.includeReviewDocs,
        skipExisting: config.skipExisting,
        dryRunStopMode: config.geoFilterEnabled ? "max_accepted" : config.dryRunStopMode,
        maxAcceptedMode: config.geoFilterEnabled ? false : config.maxAcceptedMode,
        dryRunQuotas: config.geoFilterEnabled ? {} : config.dryRunQuotas,
        balancedPreview: config.geoFilterEnabled ? true : false,
        stateCode: config.stateCode,
        classifyBatchSize: config.classifyBatchSize,
        geoFilterEnabled: config.geoFilterEnabled,
        geoFilterCenterLat: config.geoFilterCenterLat,
        geoFilterCenterLng: config.geoFilterCenterLng,
        geoFilterRadiusKm: config.geoFilterRadiusKm,
        writeTarget: "none",
        dryRunOnly: true,
        fast: Boolean(opts.fast),
      }),
    });
    const data = json.data || json;
    const run = data.run;
    activeRunId = run.runId;
    $("runIdLabel").textContent = "Run: " + run.runId;
    lastDryRunFilePathHash = config.filePath;
    applyRunSnapshot(run);
    setStatus("loading", "Dry-run running — live counters and event log update below. Vermont full scans can take 1–3 minutes.");
    pollRun(activeRunId);
  } catch (err) {
    setStatus("error", "Dry-run failed: " + err.message);
  }
}

async function startWriteRun() {
  const config = readConfig();
  const writeTarget = $("writeTarget").value;
  if (writeTarget === "none") { setStatus("warn", "Write target is 'none' — select emulator or production."); return; }
  if (writeTarget === "production" && config.filePath !== lastDryRunFilePathHash) {
    setStatus("error", "Production writes require a prior successful dry-run for the same file. Run dry-run first.");
    return;
  }
  setStatus("loading", "Starting write run (target=" + writeTarget + ") …");
  setPhase("validating_file");
  try {
    const json = await api("/runs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "write",
        writeTarget,
        confirmProductionWrite: $("confirmProductionWrite").value || undefined,
        confirmUndiscoveredShape: $("confirmUndiscoveredShape").value || undefined,
        dryRunProofToken: lastDryRunProofToken,
        config,
      }),
    });
    const data = json.data || json;
    activeRunId = data.runId;
    $("runIdLabel").textContent = "Run: " + activeRunId;
    pollRun(activeRunId);
  } catch (err) {
    setStatus("error", "Start failed: " + err.message);
  }
}

async function pauseRun() {
  if (!activeRunId) return;
  try { await api("/runs/" + activeRunId + "/pause", { method: "POST" }); setStatus("warn", "Paused."); }
  catch (err) { setStatus("error", "Pause failed: " + err.message); }
}

async function resumeRun() {
  if (!activeRunId) return;
  try { await api("/runs/" + activeRunId + "/resume", { method: "POST" }); setStatus("ok", "Resumed."); pollRun(activeRunId); }
  catch (err) { setStatus("error", "Resume failed: " + err.message); }
}

async function cancelRun() {
  if (!activeRunId) return;
  try { await api("/runs/" + activeRunId + "/cancel", { method: "POST" }); setStatus("warn", "Cancelled."); }
  catch (err) { setStatus("error", "Cancel failed: " + err.message); }
}

async function exportRun() {
  if (!activeRunId) { setStatus("warn", "No active run to export."); return; }
  try {
    const json = await api("/runs/" + activeRunId + "/export");
    const data = json.data || json;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = activeRunId + ".json";
    a.click();
  } catch (err) { setStatus("error", "Export failed: " + err.message); }
}

async function copySummary() {
  if (!activeRunId) return;
  const json = await api("/runs/" + activeRunId);
  const data = json.data || json;
  await navigator.clipboard.writeText(JSON.stringify(data.run.metrics, null, 2));
  setStatus("ok", "Run summary copied to clipboard.");
}

function clearConsoleDom() { $("eventLog").innerHTML = ""; }
function clearConsole() { clearConsoleDom(); setStatus("ok", "Console cleared."); }

function applyRunSnapshot(run) {
  if (!run) return;
  setPhase(run.phase);
  const m = run.metrics || {};
  for (const key of [
    "fileBytesRead","fileBytesTotal","rawObjectsScanned","nodesScanned","waysScanned",
    "relationsScanned","relationsSkippedGeometry","candidateObjectsFound","candidatesSentToClassifier",
    "tagFilterSkipped","adapterSkipped","classifierAcceptedSpots","classifierAcceptedRoutes",
    "docBuilderFilteredPublicOnly","docBuilderInvalid",
    "acceptedSpots","acceptedRoutes","rejectedByClassifier","skippedInvalid","skippedMissingCoordinates",
    "skippedMissingActivities","skippedDuplicate","skippedExisting","docsPreviewed","docsWritten",
    "batchesWritten","writerCalls","estimatedWrites","estimatedReads","errors","warnings",
    "rawObjectsPerSecond","candidatesPerSecond","acceptedDocsPerSecond"
  ]) {
    const el = $("m_" + key);
    if (el) el.textContent = m[key] != null ? m[key].toLocaleString() : "0";
  }
  $("m_elapsedMs").textContent = fmtMs(m.elapsedMs);
  $("m_estimatedRemainingMs").textContent = m.estimatedRemainingMs != null ? fmtMs(m.estimatedRemainingMs) : "—";

  const total = m.fileBytesTotal || 0;
  const read = m.fileBytesRead || 0;
  const bar = $("bytesBar");
  const label = $("bytesBarLabel");
  const byteProgressUnavailable = Boolean(run.byteProgressUnavailable) || (read <= 0 && (m.rawObjectsScanned || 0) > 0);
  const completed = run.status === "completed" || run.status === "failed" || run.status === "cancelled";
  const running = !completed && (run.status === "running" || run.phase === "scanning_raw_osm" || run.phase === "running_locava_classifier");
  const nodeCap = run.config && run.config.maxRawObjectsToScan != null ? run.config.maxRawObjectsToScan : null;
  const nodesScanned = m.nodesScanned || 0;
  const waysScanned = m.waysScanned || 0;

  if (completed) {
    bar.className = "bar";
    bar.style.width = "100%";
    label.textContent =
      "Done · raw=" + (m.rawObjectsScanned || 0).toLocaleString()
      + " · nodes=" + nodesScanned.toLocaleString()
      + " · ways=" + waysScanned.toLocaleString()
      + " · accepted preview=" + (m.docsPreviewed || 0).toLocaleString();
    $("progressMeta").textContent = run.scanStopReason || ("Run " + run.status + ".");
  } else if (!byteProgressUnavailable && total > 0 && read > 0) {
    const pct = Math.min(100, Math.max(0, (read / total) * 100));
    bar.className = "bar";
    bar.style.width = pct.toFixed(1) + "%";
    label.textContent = fmtBytes(read) + " / " + fmtBytes(total) + " (" + pct.toFixed(1) + "%)";
    $("progressMeta").textContent = "Byte progress from PBF parser.";
  } else if (nodeCap != null && nodesScanned > 0 && nodesScanned <= nodeCap && waysScanned === 0) {
    const pct = Math.min(100, Math.max(0, (nodesScanned / nodeCap) * 100));
    bar.className = "bar";
    bar.style.width = pct.toFixed(1) + "%";
    label.textContent =
      "nodes=" + nodesScanned.toLocaleString() + " / " + nodeCap.toLocaleString() + " cap (" + pct.toFixed(1) + "%)"
      + " · candidates=" + (m.candidateObjectsFound || 0).toLocaleString()
      + " · accepted preview=" + (m.docsPreviewed || 0).toLocaleString();
    $("progressMeta").textContent = "Node scan cap active — ways scan after node section.";
  } else if (running || (m.rawObjectsScanned || 0) > 0) {
    bar.className = "bar indeterminate";
    bar.style.width = "30%";
    label.textContent =
      "raw=" + (m.rawObjectsScanned || 0).toLocaleString()
      + " · nodes=" + (m.nodesScanned || 0).toLocaleString()
      + " · ways=" + (m.waysScanned || 0).toLocaleString()
      + " · relations=" + (m.relationsScanned || 0).toLocaleString()
      + " · candidates=" + (m.candidateObjectsFound || 0).toLocaleString()
      + " · accepted preview=" + (m.docsPreviewed || 0).toLocaleString()
      + (run.rawScanLimitReached && waysScanned === 0 ? " · SEEKING WAYS" : run.rawScanLimitReached ? " · NODE CAP HIT" : "")
      + (run.dryRunLimitReached ? " · ACCEPT LIMIT" : "");
    $("progressMeta").textContent = run.rawScanLimitReached && waysScanned === 0
      ? "Node cap reached — reading forward through remaining nodes to reach ways/trails."
      : byteProgressUnavailable
        ? "File byte progress unavailable from parser — using live object counters."
        : "Scanning — object counters update live.";
  } else {
    bar.className = "bar";
    bar.style.width = "0%";
    label.textContent = "";
    $("progressMeta").textContent = "Object counters update live during scan. Byte progress is shown only when the parser reports bytes read.";
  }

  const badge = $("scanQualityBadge");
  if (run.scanQualityBadge) {
    badge.style.display = "inline-block";
    badge.textContent = run.scanQualityBadge;
    badge.className = "scan-quality-badge " + (run.fileEnded && !run.rawScanLimitReached ? "ok" : "warn");
  } else if (running) {
    badge.style.display = "none";
  }

  const warnBox = $("scanWarningsBox");
  if (Array.isArray(run.scanWarnings) && run.scanWarnings.length > 0) {
    warnBox.style.display = "block";
    warnBox.innerHTML = run.scanWarnings.map(function (w) { return "<p style='margin:4px 0'>" + escapeHtml(w) + "</p>"; }).join("")
      + (run.scanStopReason ? "<p class='muted' style='margin-top:8px'>" + escapeHtml(run.scanStopReason) + "</p>" : "");
  } else {
    warnBox.style.display = "none";
    warnBox.innerHTML = "";
  }

  const a = run.currentActivity || {};
  $("a_currentObjectType").textContent = a.currentObjectType || "—";
  $("a_currentOsmId").textContent = a.currentOsmId != null ? String(a.currentOsmId) : "—";
  $("a_currentLabel").textContent = a.currentLabel || "—";
  $("a_currentPhaseDetail").textContent = a.currentPhaseDetail || "—";
  $("parserId").textContent = run.parserId || "—";
  $("parserVersion").textContent = run.parserVersion ? "(" + run.parserVersion + ")" : "";
  $("sourceProvider").textContent = run.sourceProvider || "—";

  const isDryRun = run.mode === "dry_run_preview" || run.mode === "fast_dry_run";
  const isPreviewWrite = Boolean(run.previewWriteSourceRunId);
  if (isDryRun && Array.isArray(run.previewDocs) && run.previewDocs.length > 0) {
    lastDryRunPreviewDocs = run.previewDocs.slice();
    lastDryRunSnapshot = run;
    refreshPreviewExplorer(run.previewDocs, run.metrics, run.config);
  } else if (isPreviewWrite) {
    if (lastDryRunPreviewDocs.length) {
      const snap = lastDryRunSnapshot;
      refreshPreviewExplorer(
        lastDryRunPreviewDocs,
        snap ? snap.metrics : undefined,
        snap ? snap.config : undefined
      );
    }
    updateWriteSpotsProgress(run);
  } else if (Array.isArray(run.previewDocs) && run.previewDocs.length > 0) {
    refreshPreviewExplorer(run.previewDocs, run.metrics, run.config);
  }
  if (run.previewWriteSourceRunId) updateWriteSpotsProgress(run);
  lastRunSnapshot = run;
  const funnelRun = isPreviewWrite && lastDryRunSnapshot ? lastDryRunSnapshot : run;
  renderPipelineFunnel(funnelRun);
  renderRejectionExplorer(funnelRun);

  // Activity / metadata samples
  $("activitySamples").innerHTML = "<strong>Accepted activities:</strong> " +
    (run.acceptedActivitySamples || []).map((s) => '<span class="pill ok">' + s + '</span>').join(" ");
  $("metadataWarnings").innerHTML = "<strong>Metadata warnings:</strong> " +
    (run.missingMetadataWarnings || []).slice(0, 25).map((s) => '<span class="pill">' + s + '</span>').join(" ");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\\\"":"&quot;"}[c]));
}

function previewKindLabel(doc) {
  return doc.kind === "unexplored_route" ? "route" : "spot";
}

function activityEmoji(activity) {
  const a = String(activity || "").toLowerCase();
  if (a.indexOf("offroad") >= 0 || a.indexOf("class6") >= 0 || a.indexOf("unmaintained") >= 0) return "🛻";
  if (a.indexOf("hik") >= 0 || a.indexOf("walk") >= 0) return "🥾";
  if (a.indexOf("bike") >= 0 || a.indexOf("cycl") >= 0) return "🚴";
  if (a.indexOf("swim") >= 0 || a.indexOf("beach") >= 0) return "🏊";
  if (a.indexOf("view") >= 0 || a.indexOf("lookout") >= 0) return "👀";
  if (a.indexOf("waterfall") >= 0) return "💧";
  if (a.indexOf("ski") >= 0 || a.indexOf("snow") >= 0) return "⛷";
  if (a.indexOf("food") >= 0 || a.indexOf("restaurant") >= 0 || a.indexOf("cafe") >= 0) return "🍽";
  if (a.indexOf("camp") >= 0) return "⛺";
  if (a.indexOf("fish") >= 0) return "🎣";
  if (a.indexOf("climb") >= 0) return "🧗";
  if (a.indexOf("kayak") >= 0 || a.indexOf("paddle") >= 0 || a.indexOf("boat") >= 0) return "🛶";
  if (a.indexOf("nature") >= 0 || a.indexOf("forest") >= 0 || a.indexOf("park") >= 0) return "🌲";
  return "📍";
}

function buildPreviewPopupHtml(doc) {
  const kind = previewKindLabel(doc);
  const acts = (doc.activities || []).slice(0, 6).join(", ");
  let html = '<div class="map-popup"><strong>' + escapeHtml(doc.displayName || "Unnamed") + '</strong>';
  html += '<br/>' + escapeHtml(kind) + ' · ' + escapeHtml(doc.primaryActivity || doc.primaryCategory || "");
  if (acts) html += '<br/>Activities: ' + escapeHtml(acts);
  if (doc.mapReadiness) html += '<br/>Map readiness: ' + escapeHtml(doc.mapReadiness);
  if (doc.kind === "unexplored_route") {
    const pts = (doc.routeLineCoordinates || []).length;
    html += '<br/>Trail line: ' + pts + ' points';
    if (doc.distanceMiles != null) html += ' · ' + Number(doc.distanceMiles).toFixed(2) + ' mi';
    if (!doc.hasRouteGeometry) html += '<br/><span class="muted">⚠ missing line geometry</span>';
  }
  html += '<br/>Public eligible: ' + (doc.publicMapEligible ? "yes" : "no");
  html += '<br/><span class="muted">' + escapeHtml(doc.osmType + "/" + doc.osmId) + '</span>';
  html += '</div>';
  return html;
}

function initPreviewMap() {
  if (previewMap) return;
  previewMap = new maplibregl.Map({
    container: "previewMap",
    style: OSM_STYLE,
    center: [-98.5795, 39.8283],
    zoom: 3,
  });
  previewMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  previewMap.on("load", function () {
    previewMapReady = true;
    ensurePreviewRouteLayers();
    if (lastPreviewDocs.length) drawAllPreviewOnMap(getFilteredPreviewDocs());
  });
}

function buildRoutesGeoJson(docs, selectedId) {
  const features = (docs || []).filter(function (doc) {
    return doc.kind === "unexplored_route" && doc.routeLineCoordinates && doc.routeLineCoordinates.length >= 2;
  }).map(function (doc) {
    return {
      type: "Feature",
      properties: { id: doc.id, name: doc.displayName || "", selected: doc.id === selectedId },
      geometry: {
        type: "LineString",
        coordinates: doc.routeLineCoordinates.map(function (p) { return [p.lng, p.lat]; }),
      },
    };
  });
  return { type: "FeatureCollection", features: features };
}

function bboxFromCenterRadiusKm(center, radiusKm) {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos(center.lat * Math.PI / 180));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}

function bboxPolygon(bbox) {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [bbox.minLng, bbox.minLat],
        [bbox.maxLng, bbox.minLat],
        [bbox.maxLng, bbox.maxLat],
        [bbox.minLng, bbox.maxLat],
        [bbox.minLng, bbox.minLat],
      ]],
    },
    properties: {},
  };
}

function ensurePreviewRouteLayers() {
  if (!previewMap || !previewMapReady) return;
  if (!previewMap.getSource(PREVIEW_ROUTES_SOURCE)) {
    previewMap.addSource(PREVIEW_ROUTES_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    previewMap.addLayer({
      id: PREVIEW_ROUTES_LAYER,
      type: "line",
      source: PREVIEW_ROUTES_SOURCE,
      paint: { "line-color": "#22c55e", "line-width": 3, "line-opacity": 0.85 },
    });
  }
  if (!previewMap.getSource(PREVIEW_ROUTE_SELECTED_SOURCE)) {
    previewMap.addSource(PREVIEW_ROUTE_SELECTED_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    previewMap.addLayer({
      id: PREVIEW_ROUTE_SELECTED_LAYER,
      type: "line",
      source: PREVIEW_ROUTE_SELECTED_SOURCE,
      paint: { "line-color": "#38bdf8", "line-width": 5, "line-opacity": 0.95 },
    });
  }
  if (!previewMap.getSource(PREVIEW_GEO_RADIUS_SOURCE)) {
    previewMap.addSource(PREVIEW_GEO_RADIUS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    previewMap.addLayer({
      id: PREVIEW_GEO_RADIUS_LAYER,
      type: "line",
      source: PREVIEW_GEO_RADIUS_SOURCE,
      paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.8 },
    });
  }
}

function updatePreviewRouteLayers(docs, selectedId, runConfig) {
  if (!previewMap || !previewMapReady) return;
  ensurePreviewRouteLayers();
  const allRoutes = buildRoutesGeoJson(docs, null);
  previewMap.getSource(PREVIEW_ROUTES_SOURCE).setData(allRoutes);
  const selectedDoc = selectedId ? (docs || []).find(function (d) { return d.id === selectedId; }) : null;
  const selectedData = selectedDoc && selectedDoc.routeLineCoordinates
    ? buildRoutesGeoJson([selectedDoc], selectedId)
    : { type: "FeatureCollection", features: [] };
  previewMap.getSource(PREVIEW_ROUTE_SELECTED_SOURCE).setData(selectedData);
  const cfg = runConfig || (lastRunSnapshot && lastRunSnapshot.config) || readConfig();
  drawGeoFilterBboxOnMap(cfg.geoFilterEnabled ? cfg : null);
}

function clearPreviewMapMarkers(keepAll) {
  previewMarkers = previewMarkers.filter(function (m) {
    if (keepAll && m._previewAll) return true;
    if (!keepAll && m._previewSel) return true;
    m.remove();
    return false;
  });
}

function docCoords(doc) {
  if (doc.kind === "unexplored_route" && doc.routeLineCoordinates && doc.routeLineCoordinates.length > 0) {
    return { lat: doc.routeLineCoordinates[0].lat, lng: doc.routeLineCoordinates[0].lng };
  }
  const lat = doc.lat != null ? doc.lat : doc.center && doc.center.lat;
  const lng = doc.lng != null ? doc.lng : doc.center && doc.center.lng;
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function addPreviewMarker(doc, opts) {
  opts = opts || {};
  const c = docCoords(doc);
  if (!c || !previewMap) return null;
  const kind = previewKindLabel(doc);
  const el = document.createElement("div");
  el.className = "emoji-marker" + (kind === "route" ? " route" : "");
  el.textContent = activityEmoji(doc.primaryActivity || doc.primaryCategory);
  const marker = new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat([c.lng, c.lat])
    .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(buildPreviewPopupHtml(doc)))
    .addTo(previewMap);
  if (opts.all) marker._previewAll = true;
  if (opts.selected) marker._previewSel = true;
  previewMarkers.push(marker);
  return marker;
}

function fitPreviewDocs(docs) {
  if (!previewMap || !docs.length) return;
  const coords = [];
  (docs || []).forEach(function (doc) {
    const c = docCoords(doc);
    if (c) coords.push(c);
    if (doc.kind === "unexplored_route" && doc.routeLineCoordinates) {
      doc.routeLineCoordinates.forEach(function (p) { coords.push({ lat: p.lat, lng: p.lng }); });
    }
  });
  if (!coords.length) return;
  const lngs = coords.map((c) => c.lng);
  const lats = coords.map((c) => c.lat);
  previewMap.fitBounds(
    [[Math.min.apply(null, lngs), Math.min.apply(null, lats)], [Math.max.apply(null, lngs), Math.max.apply(null, lats)]],
    { padding: 48, duration: 500, maxZoom: 14 }
  );
}

function drawAllPreviewOnMap(docs) {
  if (!previewMap) return;
  const draw = function () {
    clearPreviewMapMarkers(false);
    previewMarkers = previewMarkers.filter(function (m) {
      if (m._previewAll) { m.remove(); return false; }
      return true;
    });
    (docs || []).forEach(function (doc) { addPreviewMarker(doc, { all: true }); });
    updatePreviewRouteLayers(docs, selectedPreviewDocId, lastRunSnapshot && lastRunSnapshot.config);
    $("previewMapMeta").textContent = (docs || []).length + " docs on map";
    if (docs && docs.length) fitPreviewDocs(docs);
  };
  if (previewMapReady) draw();
  else previewMap.once("load", draw);
}

function showPreviewOnMap(doc) {
  if (!previewMap || !doc) return;
  selectedPreviewDocId = doc.id;
  clearPreviewMapMarkers(true);
  previewMarkers = previewMarkers.filter(function (m) {
    if (m._previewSel) { m.remove(); return false; }
    return true;
  });
  addPreviewMarker(doc, { selected: true });
  updatePreviewRouteLayers(getFilteredPreviewDocs(), doc.id, lastRunSnapshot && lastRunSnapshot.config);
  const c = docCoords(doc);
  if (c) {
    if (doc.kind === "unexplored_route" && doc.routeLineCoordinates && doc.routeLineCoordinates.length >= 2) {
      fitPreviewDocs([doc]);
    } else {
      previewMap.flyTo({ center: [c.lng, c.lat], zoom: Math.max(previewMap.getZoom(), 13), duration: 500 });
    }
    const dist = doc.distanceMiles != null ? " · " + Number(doc.distanceMiles).toFixed(2) + " mi" : "";
    const pts = doc.routeLineCoordinates ? doc.routeLineCoordinates.length + " line pts" : "point only";
    $("mapSidebar").innerHTML =
      "<strong>" + escapeHtml(doc.displayName || "Unnamed") + "</strong> · "
      + escapeHtml(previewKindLabel(doc)) + " · "
      + escapeHtml(doc.primaryActivity || doc.primaryCategory || "") + " · "
      + (doc.mapReadiness || "—") + " · "
      + pts + dist;
  }
  renderPreviewResults(getFilteredPreviewDocs());
}

function previewSearchHaystack(doc) {
  const tags = Object.entries(doc.sourceTagSample || {}).map(function (e) { return e[0] + "=" + e[1]; }).join(" ");
  return [
    doc.displayName, doc.primaryActivity, doc.primaryCategory,
    (doc.activities || []).join(" "), doc.id, doc.osmType, doc.osmId,
    (doc.sourceKeys || []).join(" "), (doc.sourceIds || []).join(" "), tags,
  ].join(" ").toLowerCase();
}

function getFilteredPreviewDocs() {
  const q = ($("previewSearchInput").value || "").trim().toLowerCase();
  const kind = $("previewFilterKind").value;
  const readiness = $("previewFilterReadiness").value;
  const onlyPublic = $("previewOnlyPublic").checked;
  const nameInferredOnly = $("previewNameInferredOnly") && $("previewNameInferredOnly").checked;
  const explicitTagOnly = $("previewExplicitTagOnly") && $("previewExplicitTagOnly").checked;
  const waysOnly = $("previewWaysOnly") && $("previewWaysOnly").checked;
  const routesOnly = $("previewRoutesOnly") && $("previewRoutesOnly").checked;
  const activePreset = document.querySelector(".preview-preset.active");
  const preset = activePreset ? activePreset.getAttribute("data-preset") : null;
  const presetTerms = {
    hiking: ["hik", "walk", "trail"],
    swimming: ["swim", "beach", "water"],
    viewpoints: ["view", "lookout", "scenic"],
    food: ["food", "restaurant", "cafe", "dining"],
    offroad: ["offroad", "class4", "class6", "unmaintained"],
    nature: ["nature", "forest", "park", "natural"],
    waterfall: ["waterfall", "falls"],
  };
  const geoCfg = lastRunSnapshot && lastRunSnapshot.config ? lastRunSnapshot.config : readConfig();
  return lastPreviewDocs.filter(function (doc) {
    if (!docWithinGeoFilterBbox(doc, geoCfg)) return false;
    if (kind === "spot" && doc.kind !== "unexplored_spot") return false;
    if (kind === "route" && doc.kind !== "unexplored_route") return false;
    if (readiness !== "all" && doc.mapReadiness !== readiness) return false;
    if (onlyPublic && !doc.publicMapEligible) return false;
    if (nameInferredOnly && !doc.nameInferenceUsed) return false;
    if (explicitTagOnly && doc.nameInferenceUsed) return false;
    if (waysOnly && doc.osmType !== "way") return false;
    if (routesOnly && doc.kind !== "unexplored_route") return false;
    if (q && previewSearchHaystack(doc).indexOf(q) < 0) return false;
    if (preset) {
      const terms = presetTerms[preset] || [];
      const hay = previewSearchHaystack(doc);
      if (!terms.some(function (t) { return hay.indexOf(t) >= 0; })) return false;
    }
    return true;
  });
}

function renderPreviewSummary(docs) {
  const spots = docs.filter(function (d) { return d.kind === "unexplored_spot"; }).length;
  const routes = docs.filter(function (d) { return d.kind === "unexplored_route"; }).length;
  const ready = docs.filter(function (d) { return d.mapReadiness === "ready"; }).length;
  const review = docs.filter(function (d) { return d.mapReadiness === "review"; }).length;
  const pub = docs.filter(function (d) { return d.publicMapEligible; }).length;
  const nameInferred = docs.filter(function (d) { return d.nameInferenceUsed; }).length;
  const items = [
    ["Total preview", docs.length],
    ["Name-inferred", nameInferred],
    ["Spots", spots],
    ["Routes", routes],
    ["Ready", ready],
    ["Review", review],
    ["Public eligible", pub],
    ["Dry-run limit", lastDryRunLimit],
  ];
  $("previewSummaryGrid").innerHTML = items.map(function (p) {
    return '<div class="stat-box"><div class="stat-label">' + p[0] + '</div><div class="stat-value">' + p[1] + '</div></div>';
  }).join("");
}

function renderPreviewResults(filtered) {
  $("previewResultCount").textContent = String(filtered.length);
  $("previewResultTotal").textContent = String(lastPreviewDocs.length);
  const tbody = $("previewResultsBody");
  tbody.innerHTML = "";
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="muted">No preview docs match your filters.</td></tr>';
    return;
  }
  filtered.forEach(function (doc) {
    const tr = document.createElement("tr");
    tr.className = previewKindLabel(doc) + (selectedPreviewDocId === doc.id ? " selected" : "");
    const acts = (doc.activities || []).slice(0, 4).join(", ");
    const tagSummary = Object.entries(doc.sourceTagSample || {}).slice(0, 3).map(function (e) { return e[0] + "=" + e[1]; }).join("; ");
    const nameHint = doc.nameInferenceUsed ? "yes" : (doc.nameInferenceBlockedReason ? "blocked" : "no");
    tr.innerHTML =
      '<td>' + escapeHtml(previewKindLabel(doc)) + '</td>' +
      '<td>' + escapeHtml(doc.displayName || "(unnamed)") + '</td>' +
      '<td>' + escapeHtml(doc.primaryActivity || "—") + '</td>' +
      '<td class="muted">' + escapeHtml(acts) + '</td>' +
      '<td>' + escapeHtml(doc.primaryCategory || "—") + '</td>' +
      '<td class="muted" title="' + escapeHtml(tagSummary) + '">' + escapeHtml(tagSummary || "—") + '</td>' +
      '<td title="' + escapeHtml(doc.nameInferenceReason || doc.nameInferenceBlockedReason || "") + '">' + escapeHtml(nameHint) + '</td>' +
      '<td>' + escapeHtml(doc.mapReadiness || "—") + '</td>' +
      '<td>' + (doc.publicMapEligible ? "yes" : "no") + '</td>' +
      '<td><code>' + escapeHtml(doc.osmType + "/" + doc.osmId) + '</code></td>' +
      '<td class="muted">' + doc.lat.toFixed(5) + ", " + doc.lng.toFixed(5) + '</td>' +
      '<td>'
        + '<button type="button" class="small view-preview-map">Map</button> '
        + '<button type="button" class="small copy-preview-json">Copy JSON</button>'
      + '</td>';
    tr.querySelector(".view-preview-map").addEventListener("click", function (e) {
      e.stopPropagation();
      showPreviewOnMap(doc);
    });
    tr.querySelector(".copy-preview-json").addEventListener("click", async function (e) {
      e.stopPropagation();
      const payload = doc.writePayload || doc;
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setStatus("ok", "Copied would-write JSON for " + (doc.displayName || doc.id));
    });
    tr.addEventListener("click", function () { showPreviewOnMap(doc); });
    tbody.appendChild(tr);
  });
}

function countLoadedPreviewDocs() {
  const docs = lastDryRunPreviewDocs.length ? lastDryRunPreviewDocs : (lastPreviewDocs || []);
  const spots = docs.filter(function (d) { return d.kind === "unexplored_spot"; }).length;
  const routes = docs.filter(function (d) { return d.kind === "unexplored_route"; }).length;
  return { total: spots + routes, spots: spots, routes: routes };
}

function updateWriteSpotsPanel(run) {
  const counts = countLoadedPreviewDocs();
  const panel = $("writeSpotsPanel");
  const dryRunDone = run && run.status === "completed" && (run.mode === "dry_run_preview" || run.mode === "fast_dry_run");
  const writing = run && run.mode === "write" && run.previewWriteSourceRunId && (run.status === "running" || run.status === "paused");
  const writeDone = run && run.mode === "write" && run.previewWriteSourceRunId && run.status === "completed";
  if ((dryRunDone && counts.total > 0) || writing || (writeDone && counts.total > 0)) {
    panel.style.display = "block";
    $("writeAllSpotsCount").textContent = String(counts.total);
    if ($("writeSpotsBreakdown")) {
      $("writeSpotsBreakdown").textContent =
        counts.spots.toLocaleString() + " spot(s) + " + counts.routes.toLocaleString() + " route(s)";
    }
    const busy = writing;
    $("btnWriteAllSpots").disabled = busy || counts.total === 0;
    $("btnWriteNSpots").disabled = busy || counts.total === 0;
    if ($("writeSpotsLimit")) $("writeSpotsLimit").max = String(Math.max(1, counts.total));
  } else {
    panel.style.display = "none";
  }
  if (writing || writeDone) updateWriteSpotsProgress(run);
}

function updateWriteSpotsProgress(run) {
  if (!run || !run.previewWriteSourceRunId) {
    $("writeSpotsProgress").style.display = "none";
    return;
  }
  const spotsPlanned = run.previewWritePlannedSpots || 0;
  const routesPlanned = run.previewWritePlannedRoutes || 0;
  const planned = spotsPlanned + routesPlanned || run.metrics.docsPreviewed || 0;
  const written = run.metrics.docsWritten || 0;
  const writtenSpots = run.metrics.acceptedSpots || 0;
  const writtenRoutes = run.metrics.acceptedRoutes || 0;
  $("writeSpotsProgress").style.display = "block";
  $("writeSpotsProgressTitle").textContent =
    run.status === "running" ? "Writing preview docs to production…"
    : run.status === "completed" ? "Write complete"
    : run.status === "failed" ? "Write failed"
    : "Write stopped";
  const pct = planned > 0 ? Math.min(100, (written / planned) * 100) : 0;
  $("writeSpotsProgressBar").style.width = pct.toFixed(1) + "%";
  $("writeSpotsProgressMeta").textContent =
    written.toLocaleString() + " / " + planned.toLocaleString() + " docs written"
    + " (" + writtenSpots.toLocaleString() + " spots, " + writtenRoutes.toLocaleString() + " routes)"
    + (run.metrics.skippedExisting ? " · " + run.metrics.skippedExisting.toLocaleString() + " skipped (existing)" : "")
    + (run.lastError ? " · " + run.lastError : "");
}

function openWriteSpotsModal(limit) {
  pendingWriteSpotsLimit = limit;
  const counts = countLoadedPreviewDocs();
  const n = limit != null ? Math.min(limit, counts.total) : counts.total;
  if ($("writeSpotsPassword")) $("writeSpotsPassword").value = "";
  const modal = $("writeSpotsModal");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }
  setStatus(
    "warn",
    "Enter production password to write " + n.toLocaleString() + " item(s) (spots + routes) to production."
  );
}

function closeWriteSpotsModal() {
  pendingWriteSpotsLimit = null;
  const modal = $("writeSpotsModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function confirmWritePreviewSpots() {
  const dryRunId = lastCompletedDryRunId || activeRunId;
  if (!dryRunId || !lastDryRunProofToken) {
    setStatus("error", "Run a dry-run first — no proof token.");
    return;
  }
  const password = ($("writeSpotsPassword").value || "").trim();
  if (!password) {
    setStatus("warn", "Enter the production password.");
    return;
  }
  const limit = pendingWriteSpotsLimit;
  const counts = countLoadedPreviewDocs();
  const effectiveLimit = limit != null ? Math.min(limit, counts.total) : undefined;
  closeWriteSpotsModal();
  setStatus(
    "loading",
    "Starting production write for " + (effectiveLimit != null ? effectiveLimit : counts.total).toLocaleString() + " item(s)…"
  );
  try {
    const body = {
      writeTarget: "production",
      confirmProductionWrite: password,
      confirmUndiscoveredShape: undiscoveredShapePhrase || ($("confirmUndiscoveredShape").value || "").trim() || undefined,
      skipExisting: $("writeSpotsSkipExisting").checked,
      includeSpots: true,
      includeRoutes: true,
    };
    if (effectiveLimit != null) body.limit = effectiveLimit;
    const json = await api("/runs/" + dryRunId + "/write-preview-docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = json.data || json;
    activeRunId = data.runId;
    $("runIdLabel").textContent = "Run: " + activeRunId + " (writing preview docs)";
    if (data.run) {
      applyRunSnapshot(data.run);
      updateWriteSpotsProgress(data.run);
    }
    pollRun(activeRunId);
  } catch (err) {
    setStatus("error", "Write failed: " + err.message);
  }
}

function refreshPreviewExplorer(docs, metrics, runConfig) {
  lastPreviewDocs = Array.isArray(docs) ? docs.slice() : [];
  if (runConfig && runConfig.dryRunLimit != null) lastDryRunLimit = Number(runConfig.dryRunLimit) || lastDryRunLimit;
  const limit = lastDryRunLimit;
  const accepted = metrics ? (Number(metrics.acceptedSpots || 0) + Number(metrics.acceptedRoutes || 0)) : lastPreviewDocs.length;
  initPreviewMap();
  const filtered = getFilteredPreviewDocs();
  if (runConfig && runConfig.geoFilterEnabled) {
    $("previewLimitMeta").textContent =
      "Region bbox: " + filtered.length + " preview doc(s) inside viewport · full PBF scanned · "
      + (metrics && metrics.geoFilterSkippedCandidates != null
        ? metrics.geoFilterSkippedCandidates.toLocaleString() + " candidates skipped outside bbox"
        : "outside-bbox candidates skipped");
  } else if (lastPreviewDocs.length === 0) {
    $("previewLimitMeta").textContent = "No accepted preview docs yet. Run a dry-run to populate.";
  } else {
    $("previewLimitMeta").textContent =
      "Showing all " + lastPreviewDocs.length + " preview doc(s) captured (dry-run limit " + limit + "). "
      + "Classifier accepted " + accepted + " total so far.";
  }
  renderPreviewSummary(filtered.length ? filtered : lastPreviewDocs);
  renderPreviewResults(filtered);
  if (filtered.length) drawAllPreviewOnMap(filtered);
  else if (lastPreviewDocs.length) drawAllPreviewOnMap([]);
  updateWriteSpotsPanel(lastRunSnapshot);
}

function clearPreviewExplorer() {
  lastPreviewDocs = [];
  lastDryRunPreviewDocs = [];
  lastDryRunSnapshot = null;
  selectedPreviewDocId = null;
  lastCompletedDryRunId = null;
  $("writeSpotsPanel").style.display = "none";
  $("writeSpotsProgress").style.display = "none";
  $("previewLimitMeta").textContent = "No preview docs yet. Run a dry-run to populate.";
  $("previewSummaryGrid").innerHTML = "";
  $("previewResultsBody").innerHTML = "";
  $("previewResultCount").textContent = "0";
  $("previewResultTotal").textContent = "0";
  $("previewMapMeta").textContent = "";
  $("mapSidebar").textContent = "";
  previewMarkers.forEach(function (m) { m.remove(); });
  previewMarkers = [];
}

const REJECTION_REASON_HELP = {
  below_threshold: "Locava score below the acceptance threshold — not enough positive signals.",
  utility_object: "Utility/infrastructure object (power, telecom, man_made utility) — not a destination.",
  unnamed_infrastructure: "Unnamed infrastructure feature with no recreational destination signal.",
  hard_reject: "Hard reject rule fired (blacklist, access, or unsupported type).",
  linear_highway_not_trail: "Linear highway/road geometry that is not a recreational trail.",
  linear_highway_not_spot: "Linear highway feature cannot become a point spot.",
  route_missing_geometry: "Route candidate missing usable line geometry.",
  private_access: "Tagged private/restricted access.",
  restricted_access: "Tagged restricted access.",
  motor_vehicle_no: "Motor vehicle prohibited and not a valid offroad candidate.",
  name_only_no_locava_signal: "Has a name but no activity/category signals.",
  name_blacklisted: "Name matches a blacklist pattern.",
  low_score: "Score too low after negative signals.",
  highway_service: "Service highway / driveway — not a destination.",
  fast_food_chain: "Chain fast food — filtered out.",
};

function rejectionReasonHelp(code) {
  return REJECTION_REASON_HELP[code] || "Classifier rejected with reason code: " + code;
}

function renderPipelineFunnel(run) {
  if (!run) return;
  const m = run.metrics || {};
  const cfg = run.config || {};
  const accepted = Number(m.acceptedSpots || 0) + Number(m.acceptedRoutes || 0);
  const rejected = Number(m.rejectedByClassifier || 0);
  const candidates = Number(m.candidatesSentToClassifier || 0);
  const raw = Number(m.rawObjectsScanned || 0);
  const limit = cfg.dryRunLimit != null ? cfg.dryRunLimit : lastDryRunLimit;
  const tagSkipped = Number(m.tagFilterSkipped || 0);
  const adapterSkipped = Number(m.adapterSkipped || 0);
  const docPublicFiltered = Number(m.docBuilderFilteredPublicOnly || 0);
  const docInvalid = Number(m.docBuilderInvalid || 0);
  const classifierAccepted = Number(m.classifierAcceptedSpots || 0) + Number(m.classifierAcceptedRoutes || 0);
  const steps = [
    { label: "Raw OSM scanned", value: raw.toLocaleString(), note: "Nodes " + (m.nodesScanned || 0) + " · ways " + (m.waysScanned || 0) + " · relations " + (m.relationsScanned || 0) },
    { label: "Tag filter skipped", value: tagSkipped.toLocaleString(), note: "No Locava-relevant tag keys — never sent to classifier", warn: tagSkipped > raw * 0.5 && raw > 1000 },
    { label: "Adapter skipped", value: adapterSkipped.toLocaleString(), note: "Unsupported geometry or adapter failure" },
    { label: "Tag-filter candidates", value: (m.candidateObjectsFound || 0).toLocaleString(), note: "Passed PBF tag filter" },
    { label: "Sent to classifier", value: candidates.toLocaleString(), note: "Batched into Locava classifier" },
    { label: "Classifier accepted", value: classifierAccepted.toLocaleString(), note: "Spots " + (m.classifierAcceptedSpots || 0) + " · routes " + (m.classifierAcceptedRoutes || 0), ok: classifierAccepted > 0 },
    { label: "Classifier rejected", value: rejected.toLocaleString(), note: "See rejection breakdown below", err: rejected > 0 },
    { label: "Doc builder filtered (public)", value: docPublicFiltered.toLocaleString(), note: "Accepted by classifier but dropped by public-ready / review settings", warn: docPublicFiltered > 0 },
    { label: "Doc builder invalid", value: docInvalid.toLocaleString(), note: "Missing coords, activities, or validation failed", warn: docInvalid > 0 },
    { label: "Preview docs kept", value: (run.previewDocs || []).length.toLocaleString(), note: "Dry-run accepted preview cap: " + limit, ok: (run.previewDocs || []).length > 0 },
  ];
  $("pipelineFunnelGrid").innerHTML = steps.map(function (step) {
    const cls = step.err ? " err" : step.ok ? " ok" : step.warn ? " warn" : "";
    return '<div class="funnel-step' + cls + '"><div class="label">' + step.label + '</div><div class="value">' + step.value + '</div><div class="note">' + step.note + '</div></div>';
  }).join("");

  const callouts = [];
  if (run.scanQualityBadge) {
    callouts.push("<strong>Scan quality:</strong> " + escapeHtml(run.scanQualityBadge));
  }
  if (run.scanStopReason) {
    callouts.push("<strong>Stop reason:</strong> " + escapeHtml(run.scanStopReason));
  }
  if (run.rawScanLimitReached && (m.waysScanned || 0) === 0) {
    callouts.push(
      "<strong>Stopped before ways (node cap):</strong> hit node scan cap (" + (cfg.maxRawObjectsToScan != null ? cfg.maxRawObjectsToScan.toLocaleString() : "?") + ") while still in the node block. The scan should continue reading forward — if ways stay at 0, clear the cap."
    );
  } else if (run.rawScanLimitReached) {
    callouts.push(
      "<strong>Raw scan cap hit</strong> before accepted preview limit or end of file. Increase or clear <em>Raw object scan cap</em>."
    );
  } else if (run.dryRunLimitReached) {
    if (cfg.maxAcceptedMode !== false) {
      callouts.push("<strong>Max accepted reached</strong> — stopped after finding " + limit + " accepted spot(s)/route(s). Rejection counts reflect everything scanned before stop.");
    } else {
      callouts.push("<strong>Accepted preview limit reached</strong> — stopped after finding " + limit + " accepted docs.");
    }
  } else if (run.fileEnded) {
    callouts.push("<strong>Full file scanned</strong> — reached end of PBF without hitting caps.");
  }
  if ((m.waysScanned || 0) === 0 && raw > 10000 && !run.fileEnded) {
    callouts.push(
      "<strong>No ways scanned yet:</strong> this run mostly tested node records. Most hiking trails and parks live in OSM <em>ways</em>."
    );
  } else if ((m.relationsScanned || 0) === 0 && (m.waysScanned || 0) > 0 && !run.fileEnded) {
    callouts.push("<strong>No relations scanned yet:</strong> some route/network features may not have been reached.");
  }
  if (run.dryRunQuotaProgress && cfg.dryRunStopMode === "quotas") {
    callouts.push("<strong>Quota progress:</strong> " + escapeHtml(Object.entries(cfg.dryRunQuotas || {}).map(function (pair) {
      return pair[0] + " " + (run.dryRunQuotaProgress[pair[0]] || 0) + "/" + pair[1];
    }).join(", ")));
  }
  callouts.push(
    cfg.dryRunStopMode === "quotas"
      ? "<strong>Activity quotas</strong> stop the scan once each target is filled. You got <strong>" + accepted + "</strong> accepted and <strong>" + rejected.toLocaleString() + "</strong> rejected before stop."
      : cfg.maxAcceptedMode !== false
        ? "<strong>Max accepted " + limit + "</strong> stops the scan once that many accepted spots/routes are found. You got <strong>" + accepted + "</strong> accepted and <strong>" + rejected.toLocaleString() + "</strong> rejected before stop."
        : "<strong>Dry-run accepted limit " + limit + "</strong> is the maximum number of <em>accepted</em> docs to preview — not a raw scan cap. You got <strong>" + accepted + "</strong> accepted."
  );
  if (cfg.includePublicOnly) {
    callouts.push("<strong>includePublicOnly</strong> is ON — review/hidden docs are dropped at doc-build time even if the classifier accepts them.");
  }
  if (!cfg.includeReviewDocs) {
    callouts.push("<strong>includeReviewDocs</strong> is OFF — items with mapReadiness=review are excluded from output.");
  }
  if (accepted < limit && rejected > 0 && !run.rawScanLimitReached) {
    callouts.push(
      "<strong>Most candidates were rejected by the classifier</strong> (" + rejected + " of " + candidates + "). Scroll to <em>Classifier rejections</em> below for exact reason codes."
    );
  }
  if (docPublicFiltered > 0) {
    callouts.push("<strong>Doc builder dropped " + docPublicFiltered + " accepted item(s)</strong> due to public-ready / review filters — not classifier failure.");
  }
  const rtd = run.routeTrailDiagnostics || {};
  if (rtd.wayCandidatesFound > 0 || rtd.trailCandidates > 0) {
    callouts.push(
      "<strong>Route/trail diagnostics:</strong> way candidates " + (rtd.wayCandidatesFound || 0)
      + " · trail candidates " + (rtd.trailCandidates || 0)
      + " · accepted routes " + (rtd.acceptedRoutes || m.acceptedRoutes || 0)
      + " · geometry missing " + (rtd.geometryMissingCount || 0)
    );
  }
  if ((m.nameInferredPreviewCount || 0) > Math.max(3, Math.floor((run.previewDocs || []).length * 0.15))) {
    callouts.push("<strong>Warning:</strong> too many public-ready docs used name hints — check explicit OSM tags.");
  }
  const calloutEl = $("pipelineFunnelCallout");
  const isWarn = run.rawScanLimitReached || ((m.waysScanned || 0) === 0 && raw > 10000) || (accepted === 0 && rejected > 0);
  calloutEl.className = "funnel-callout " + (isWarn ? "warn" : "info");
  calloutEl.innerHTML = callouts.map(function (c) { return "<p style='margin:6px 0'>" + c + "</p>"; }).join("");
}

async function runDiagnosePlace() {
  const searchText = ($("diagnoseSearchText").value || "").trim();
  const filePath = $("filePath").value.trim();
  if (!searchText) { setStatus("warn", "Enter search text for place diagnosis."); return; }
  if (!filePath) { setStatus("warn", "Enter a PBF file path first."); return; }
  $("diagnoseMeta").textContent = "Scanning " + filePath + " for \\"" + searchText + "\\" …";
  $("diagnoseResultsBody").innerHTML = "";
  try {
    const json = await api("/diagnose-place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath,
        searchText,
        maxRawObjectsToScan: parseOptionalRawCap($("diagnoseRawCap").value),
        includeNodes: $("diagnoseIncludeNodes").checked,
        includeWays: $("diagnoseIncludeWays").checked,
        includeRelations: $("diagnoseIncludeRelations").checked,
        stateCode: $("stateCode").value.trim() || inferStateCodeFromPath(filePath),
        includePublicOnly: $("includePublicOnly").checked,
        includeReviewDocs: $("includeReviewDocs").checked,
      }),
    });
    const data = json.data || json;
    const matches = data.matches || [];
    const meta =
      matches.length + " match(es) · raw=" + (data.rawObjectsScanned || 0).toLocaleString()
      + " · nodes=" + (data.nodesScanned || 0).toLocaleString()
      + " · ways=" + (data.waysScanned || 0).toLocaleString()
      + " · relations=" + (data.relationsScanned || 0).toLocaleString()
      + (data.scanQuality && data.scanQuality.badgeLabel ? " · " + data.scanQuality.badgeLabel : "");
    $("diagnoseMeta").textContent = meta;
    const tbody = $("diagnoseResultsBody");
    if (!matches.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">No matching OSM objects in scanned portion. Try clearing raw cap or searching a different term.</td></tr>';
      setStatus("warn", "Diagnosis complete — no matches for \\"" + searchText + "\\".");
      return;
    }
    tbody.innerHTML = matches.map(function (item) {
      const tags = Object.entries(item.tags || {}).slice(0, 4).map(function (e) { return e[0] + "=" + e[1]; }).join(", ");
      const classifier =
        item.classifierDecision === "reject"
          ? "reject · " + escapeHtml(item.rejectionReason || "?") + (item.classifierScore != null ? " · score " + item.classifierScore : "")
          : escapeHtml(item.classifierDecision || "—") + (item.classifierScore != null ? " · score " + item.classifierScore : "");
      const catActs = (item.primaryCategory || "—") + " · " + ((item.activities || []).slice(0, 4).join(", ") || "—");
      const wouldBuild = item.wouldBuildSpot || item.wouldBuildRoute
        ? "yes (" + (item.wouldBuildSpot ? "spot" : "route") + ")"
        : escapeHtml(item.docBuildBlockReason || "no");
      const note = [item.diagnosticNote, item.nameOnlyPlaceWithBeachInName ? "name-only place with beach/falls in name" : ""].filter(Boolean).join(" · ");
      return '<tr>'
        + '<td><code>' + escapeHtml(item.osmType + "/" + item.osmId) + '</code><br/><span class="muted">' + escapeHtml(item.geometrySummary || "") + '</span></td>'
        + '<td><strong>' + escapeHtml(item.name || "(unnamed)") + '</strong></td>'
        + '<td class="muted">' + escapeHtml(tags || "—") + '</td>'
        + '<td>' + (item.passedTagFilter ? "pass" : "skip") + " · adapt " + (item.adaptedToOverpass ? "ok" : "no") + '</td>'
        + '<td>' + classifier + '</td>'
        + '<td class="muted">' + escapeHtml(catActs) + '</td>'
        + '<td>' + wouldBuild + '</td>'
        + '<td class="muted">' + escapeHtml(note || "—") + '</td>'
        + '</tr>';
    }).join("");
    setStatus("ok", "Diagnosis found " + matches.length + " match(es) for \\"" + searchText + "\\".");
  } catch (err) {
    $("diagnoseMeta").textContent = "Diagnosis failed.";
    setStatus("error", "Diagnose failed: " + err.message);
  }
}

function getFilteredRejectedSamples() {
  const q = ($("rejectedSearchInput").value || "").trim().toLowerCase();
  const reason = $("rejectedFilterReason").value;
  const osmType = $("rejectedFilterOsmType").value;
  return lastRejectedSamples.filter(function (item) {
    if (reason !== "all" && item.rejectionReason !== reason) return false;
    if (osmType !== "all" && item.osmType !== osmType) return false;
    if (!q) return true;
    const hay = [
      item.displayLabel, item.name, item.rejectionReason, item.rawTypeLabel,
      item.sourceKey, item.osmType, item.osmId,
      Object.entries(item.topTags || {}).map(function (e) { return e[0] + "=" + e[1]; }).join(" "),
      (item.negativeSignals || []).join(" "),
      (item.tagSignals || []).join(" "),
    ].join(" ").toLowerCase();
    return hay.indexOf(q) >= 0;
  });
}

function renderRejectionReasonBreakdown() {
  const entries = Object.entries(lastRejectionReasonCounts || {}).sort(function (a, b) { return b[1] - a[1]; });
  const total = entries.reduce(function (sum, e) { return sum + e[1]; }, 0);
  const tbody = $("rejectionReasonBody");
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No rejection counts yet.</td></tr>';
    return;
  }
  tbody.innerHTML = entries.map(function (entry) {
    const code = entry[0];
    const count = entry[1];
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
    const width = total > 0 ? Math.max(2, (count / total) * 100) : 0;
    return '<tr>'
      + '<td><span class="reason-code">' + escapeHtml(code) + '</span></td>'
      + '<td class="muted">' + escapeHtml(rejectionReasonHelp(code)) + '</td>'
      + '<td><strong>' + count.toLocaleString() + '</strong></td>'
      + '<td>' + pct + '%<div class="reason-bar"><span style="width:' + width + '%"></span></div></td>'
      + '<td><button type="button" class="small filter-reason" data-reason="' + escapeHtml(code) + '">Show items</button></td>'
      + '</tr>';
  }).join("");
  tbody.querySelectorAll(".filter-reason").forEach(function (btn) {
    btn.addEventListener("click", function () {
      $("rejectedFilterReason").value = btn.getAttribute("data-reason") || "all";
      renderRejectedResults(getFilteredRejectedSamples());
    });
  });

  const select = $("rejectedFilterReason");
  const current = select.value;
  select.innerHTML = '<option value="all">All reasons (' + total.toLocaleString() + ")</option>"
    + entries.map(function (e) {
      return '<option value="' + escapeHtml(e[0]) + '">' + escapeHtml(e[0]) + " (" + e[1] + ")</option>";
    }).join("");
  if (current !== "all" && lastRejectionReasonCounts[current]) select.value = current;
}

function renderRejectedResults(filtered) {
  $("rejectedResultCount").textContent = String(filtered.length);
  $("rejectedResultTotal").textContent = String(lastRejectedSamples.length);
  const tbody = $("rejectedResultsBody");
  tbody.innerHTML = "";
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">No rejected items match your filters.</td></tr>';
    return;
  }
  filtered.forEach(function (item) {
    const tr = document.createElement("tr");
    tr.className = "rejected-row";
    const tags = Object.entries(item.topTags || {}).slice(0, 3).map(function (e) { return e[0] + "=" + e[1]; }).join(", ");
    const negs = (item.negativeSignals || []).slice(0, 3).join(", ");
    const coords = item.lat != null && item.lng != null ? item.lat.toFixed(5) + ", " + item.lng.toFixed(5) : "—";
    tr.innerHTML =
      '<td><span class="reason-code">' + escapeHtml(item.rejectionReason) + '</span><br/><span class="muted" style="font-size:10px">' + escapeHtml(rejectionReasonHelp(item.rejectionReason)) + '</span></td>' +
      '<td><strong>' + escapeHtml(item.displayLabel || item.name || "(unnamed)") + '</strong></td>' +
      '<td><code>' + escapeHtml(item.osmType + "/" + item.osmId) + '</code></td>' +
      '<td>' + (item.locavaScore != null ? item.locavaScore : "—") + '</td>' +
      '<td class="muted">' + escapeHtml(item.rawTypeLabel || "—") + '</td>' +
      '<td class="muted">' + escapeHtml(tags || "—") + '</td>' +
      '<td class="neg-signal">' + escapeHtml(negs || "—") + '</td>' +
      '<td class="muted">' + coords + '</td>' +
      '<td><button type="button" class="small view-rejected-map">Map</button></td>';
    tr.querySelector(".view-rejected-map").addEventListener("click", function (e) {
      e.stopPropagation();
      if (item.lat != null && item.lng != null) {
        showPreviewOnMap({
          id: item.sourceKey,
          displayName: item.displayLabel || item.name,
          kind: "unexplored_spot",
          primaryActivity: item.rawTypeLabel,
          primaryCategory: item.rawTypeLabel,
          lat: item.lat,
          lng: item.lng,
          mapReadiness: "hidden",
          publicMapEligible: false,
          osmType: item.osmType,
          osmId: item.osmId,
        });
      }
    });
    tbody.appendChild(tr);
  });
}

function renderRejectionExplorer(run) {
  lastRejectedSamples = Array.isArray(run.rejectedSamples) ? run.rejectedSamples.slice() : [];
  lastRejectionReasonCounts = run.rejectionReasonCounts || {};
  const rejectedTotal = Number(run.metrics?.rejectedByClassifier || 0);
  const stored = lastRejectedSamples.length;
  let meta = rejectedTotal.toLocaleString() + " classifier rejection(s)";
  if (stored > 0) meta += " · showing " + stored.toLocaleString() + " detailed sample(s)";
  if (run.rejectedSamplesTruncated) {
    meta += " · truncated at storage cap — use Export Dry-Run JSON for full counts";
  }
  if (stored === 0 && rejectedTotal > 0) {
    meta += " · detailed samples will appear as batches complete";
  }
  $("rejectionMeta").textContent = meta;
  renderRejectionReasonBreakdown();
  renderRejectedResults(getFilteredRejectedSamples());
}

function clearRejectionExplorer() {
  lastRejectedSamples = [];
  lastRejectionReasonCounts = {};
  lastRunSnapshot = null;
  $("rejectionMeta").textContent = "No rejection data yet.";
  $("rejectionReasonBody").innerHTML = "";
  $("rejectedResultsBody").innerHTML = "";
  $("rejectedResultCount").textContent = "0";
  $("rejectedResultTotal").textContent = "0";
  $("rejectedFilterReason").innerHTML = '<option value="all">All reasons</option>';
  $("pipelineFunnelGrid").innerHTML = "";
  $("pipelineFunnelCallout").className = "funnel-callout info";
  $("pipelineFunnelCallout").textContent = "Run a dry-run to see the full funnel breakdown.";
  $("activitySamples").innerHTML = "";
  $("metadataWarnings").innerHTML = "";
}

function bindRejectionExplorerControls() {
  $("btnRejectedSearch").addEventListener("click", function () {
    renderRejectedResults(getFilteredRejectedSamples());
  });
  $("rejectedSearchInput").addEventListener("input", function () {
    renderRejectedResults(getFilteredRejectedSamples());
  });
  $("rejectedFilterReason").addEventListener("change", function () {
    renderRejectedResults(getFilteredRejectedSamples());
  });
  $("rejectedFilterOsmType").addEventListener("change", function () {
    renderRejectedResults(getFilteredRejectedSamples());
  });
}

function bindPreviewExplorerControls() {
  $("btnPreviewSearch").addEventListener("click", function () {
    renderPreviewResults(getFilteredPreviewDocs());
    drawAllPreviewOnMap(getFilteredPreviewDocs());
  });
  $("previewSearchInput").addEventListener("input", function () {
    renderPreviewResults(getFilteredPreviewDocs());
    drawAllPreviewOnMap(getFilteredPreviewDocs());
  });
  $("previewFilterKind").addEventListener("change", function () {
    renderPreviewResults(getFilteredPreviewDocs());
    drawAllPreviewOnMap(getFilteredPreviewDocs());
  });
  $("previewFilterReadiness").addEventListener("change", function () {
    renderPreviewResults(getFilteredPreviewDocs());
    drawAllPreviewOnMap(getFilteredPreviewDocs());
  });
  $("previewOnlyPublic").addEventListener("change", function () {
    renderPreviewResults(getFilteredPreviewDocs());
    drawAllPreviewOnMap(getFilteredPreviewDocs());
  });
  document.querySelectorAll(".preview-preset").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const wasActive = btn.classList.contains("active");
      document.querySelectorAll(".preview-preset").forEach(function (b) { b.classList.remove("active"); });
      if (!wasActive) btn.classList.add("active");
      renderPreviewResults(getFilteredPreviewDocs());
      drawAllPreviewOnMap(getFilteredPreviewDocs());
    });
  });
  $("btnFitPreview").addEventListener("click", function () {
    fitPreviewDocs(getFilteredPreviewDocs().length ? getFilteredPreviewDocs() : lastPreviewDocs);
  });
  $("btnShowAllPreview").addEventListener("click", function () {
    drawAllPreviewOnMap(lastPreviewDocs);
  });
  $("btnClearPreviewMap").addEventListener("click", function () {
    selectedPreviewDocId = null;
    previewMarkers.forEach(function (m) { m.remove(); });
    previewMarkers = [];
    $("mapSidebar").textContent = "";
    $("previewMapMeta").textContent = "";
    renderPreviewResults(getFilteredPreviewDocs());
  });
}

async function pollRun(runId) {
  if (pollTimer) clearTimeout(pollTimer);
  if (!runId) return;
  try {
    const [detail, eventsJson] = await Promise.all([
      api("/runs/" + runId),
      api("/runs/" + runId + "/events?limit=80"),
    ]);
    const data = detail.data || detail;
    const events = (eventsJson.data || eventsJson).events || [];
    const run = data.run;
    if (run) applyRunSnapshot(run);
    renderEvents(events);
    if (run && run.status === "completed") {
      if (run.mode === "dry_run_preview" || run.mode === "fast_dry_run") {
        lastDryRunProofToken = run.dryRunProofToken;
        lastCompletedDryRunId = runId;
        $("btnWrite").disabled = !lastDryRunProofToken;
        updateWriteSpotsPanel(run);
        const ready = countLoadedPreviewDocs();
        setStatus(
          "ok",
          "Dry-run finished. "
            + (run.metrics.docsPreviewed || 0).toLocaleString()
            + " preview docs, "
            + ready.total.toLocaleString()
            + " ready to write ("
            + ready.spots.toLocaleString()
            + " spots + "
            + ready.routes.toLocaleString()
            + " routes). "
            + (run.metrics.rejectedByClassifier || 0).toLocaleString()
            + " rejected, "
            + (run.metrics.errors || 0).toLocaleString()
            + " errors. Zero Firebase writes until you click Write."
        );
      } else if (run.previewWriteSourceRunId) {
        updateWriteSpotsProgress(run);
        updateWriteSpotsPanel(run);
        setStatus("ok", run.scanStopReason || ("Wrote " + (run.metrics.docsWritten || 0).toLocaleString() + " docs to production."));
      } else {
        setStatus("ok", "Run completed.");
      }
      return;
    }
    if (run && run.status === "failed") {
      setStatus("error", "Run failed: " + (run.lastError || "unknown error"));
      return;
    }
    if (run && run.status === "cancelled") {
      setStatus("warn", "Run cancelled.");
      return;
    }
    if (run && (run.status === "running" || run.status === "paused")) {
      if (run.previewWriteSourceRunId) updateWriteSpotsProgress(run);
      pollTimer = setTimeout(() => pollRun(runId), 500);
    }
  } catch (err) {
    setStatus("warn", "Poll error: " + err.message + " (retrying)");
    pollTimer = setTimeout(() => pollRun(runId), 2000);
  }
}

function renderEvents(events) {
  const log = $("eventLog");
  log.innerHTML = events.map((e) => ''
    + '<div class="ev ' + (e.level === "error" ? "error" : e.level === "warn" ? "warn" : "") + '">'
    + '<span class="ts">' + new Date(e.createdAt).toLocaleTimeString() + '</span>'
    + '<span class="phase">[' + e.phase + ']</span>'
    + escapeHtml(e.message)
    + '</div>').join("");
}

function bindControlButtons() {
  bindClick("btnValidateFile", function () { void validateFile(); });
  bindClick("btnVermontDryRun", function () { void runVermontFullDryRun(); });
  bindClick("btnQuecheeBboxDryRun", function () { void runQuecheeBboxDryRun(); });
  bindClick("btnFastDryRun", function () { void runFastDryRun(); });
  bindClick("btnDryRunPreview", function () { void runDryRunPreview(); });
  bindClick("btnWrite", function () { void startWriteRun(); });
  bindClick("btnWriteAllSpots", function () { openWriteSpotsModal(null); });
  bindClick("btnWriteNSpots", function () {
    const n = Number($("writeSpotsLimit").value) || 0;
    if (n < 1) { setStatus("warn", "Enter how many preview items to write (N)."); return; }
    openWriteSpotsModal(n);
  });
  bindClick("btnConfirmWriteSpots", function () { void confirmWritePreviewSpots(); });
  bindClick("btnPurgeUndiscovered", function () { openPurgeUndiscoveredModal(); });
  bindClick("btnPurgeUndiscoveredDryRun", function (e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    void runPurgeUndiscovered(true);
  });
  bindClick("btnConfirmPurgeDryRun", function (e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    void runPurgeUndiscovered(true);
  });
  bindClick("btnConfirmPurgeUndiscovered", function (e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    void runPurgeUndiscovered(false);
  });
  bindClick("btnCancelPurgeUndiscovered", closePurgeUndiscoveredModal);
  bindClick("btnCancelWriteSpots", closeWriteSpotsModal);
  if ($("writeSpotsPassword")) {
    $("writeSpotsPassword").addEventListener("keydown", function (e) {
      if (e.key === "Enter") void confirmWritePreviewSpots();
    });
  }
  bindClick("btnPause", function () { void pauseRun(); });
  bindClick("btnResume", function () { void resumeRun(); });
  bindClick("btnCancel", function () { void cancelRun(); });
  bindClick("btnExport", function () { void exportRun(); });
  bindClick("btnCopySummary", function () { void copySummary(); });
  bindClick("btnClearConsole", clearConsole);
  bindClick("btnDiagnosePlace", function () { void runDiagnosePlace(); });
  if ($("dryRunStopMode")) $("dryRunStopMode").addEventListener("change", syncStopModeControls);
  if ($("dryRunQuotas")) {
    $("dryRunQuotas").addEventListener("input", function () {
      if (Object.keys(parseDryRunQuotaTextClient($("dryRunQuotas").value)).length > 0) {
        $("dryRunStopMode").value = "quotas";
        syncStopModeControls();
      }
    });
  }
}

function bootPage() {
  window.addEventListener("error", function (event) {
    console.error("PBF copier page error:", event.error || event.message);
    setStatus("error", "Page error: " + (event.message || "see console"));
  });
  try {
    bindControlButtons();
    try {
      const savedLimit = localStorage.getItem("pbfDryRunLimit");
      if (savedLimit && $("dryRunLimit") && $("dryRunLimit").querySelector('option[value="' + savedLimit + '"]')) {
        $("dryRunLimit").value = savedLimit;
      }
    } catch (_e) { /* ignore */ }
    if ($("dryRunLimit")) {
      $("dryRunLimit").addEventListener("change", function () {
        try { localStorage.setItem("pbfDryRunLimit", $("dryRunLimit").value); } catch (_e) { /* ignore */ }
      });
    }
    if ($("geoFilterEnabled")) $("geoFilterEnabled").addEventListener("change", syncGeoFilterControls);
    ["geoFilterCenterLat", "geoFilterCenterLng", "geoFilterRadiusKm"].forEach(function (id) {
      const el = $(id);
      if (el) el.addEventListener("change", function () { if ($("geoFilterEnabled") && $("geoFilterEnabled").checked) drawGeoFilterBboxOnMap(readConfig()); });
    });
    syncGeoFilterControls();
    if ($("writeTarget")) {
      $("writeTarget").addEventListener("change", function () {
        if ($("warnProd")) $("warnProd").style.display = $("writeTarget").value === "production" ? "block" : "none";
      });
    }
    if ($("filePath")) {
      $("filePath").addEventListener("change", syncStateCodeFromFilePath);
      $("filePath").addEventListener("blur", syncStateCodeFromFilePath);
    }
    try {
      bindPreviewExplorerControls();
      bindRejectionExplorerControls();
      initPreviewMap();
    } catch (err) {
      console.warn("Preview map/explorer init failed (controls still work):", err);
    }
    syncStateCodeFromFilePath();
    syncStopModeControls();
    void loadHealth();
  } catch (err) {
    console.error("PBF copier boot failed:", err);
    setStatus("error", "Page init failed: " + (err && err.message ? err.message : String(err)));
  }
}

bootPage();
</script>
</body>
</html>`;
}
