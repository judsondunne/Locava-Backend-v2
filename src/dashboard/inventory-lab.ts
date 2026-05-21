/**
 * Self-contained HTML UI for Locava Inventory MVP admin.
 * Served at GET /admin/inventory
 *
 * Map pattern matches Locava Web wikipedia-staging: MapLibre + OSM raster tiles,
 * region overview at top, sticky spot verifier mini-map at bottom with center pin.
 */
export function renderInventoryLabPage(): string {
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
  <title>Inventory MVP — Backend V2</title>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    a{color:#93c5fd;text-decoration:none}
    .shell{max-width:1320px;margin:0 auto;padding:20px 16px 48px}
    h1{font-size:22px;margin:0 0 6px}
    h2{font-size:15px;margin:0 0 8px;color:#cbd5e1}
    h3{font-size:13px;margin:14px 0 8px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
    .muted{color:#94a3b8;font-size:13px;line-height:1.45}
    .warn{color:#fca5a5;background:#450a0a;border:1px solid #991b1b;border-radius:10px;padding:10px 12px;margin:12px 0;font-size:13px}
    .panel{border:1px solid #334155;border-radius:10px;background:#111827;padding:12px;margin:14px 0}
    .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0}
    label{font-size:12px;color:#cbd5e1;display:flex;flex-direction:column;gap:4px}
    input,select{padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:13px}
    button{padding:8px 12px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:13px;cursor:pointer;font-weight:600}
    button.secondary{background:#334155}
    button.ghost{background:transparent;border:1px solid #475569;color:#cbd5e1}
    button:disabled{opacity:.45;cursor:not-allowed}
    pre{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:10px;overflow:auto;font-size:11px;max-height:280px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border-top:1px solid #334155;padding:6px 8px;text-align:left;vertical-align:top}
    th{color:#94a3b8;position:sticky;top:0;background:#111827;z-index:2}
    tr.spot-row{cursor:pointer}
    tr.spot-row:hover{background:#1e293b}
    tr.spot-row.selected{background:#172554}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#0b1220;border:1px solid #334155;font-size:11px;margin-right:6px}
    .status-bar{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0b1220;font-size:14px;font-weight:600}
    .status-bar.idle{border-color:#334155;color:#94a3b8}
    .status-bar.running{border-color:#2563eb;background:#172554;color:#bfdbfe}
    .status-bar.success{border-color:#166534;background:#052e16;color:#86efac}
    .status-bar.error{border-color:#991b1b;background:#450a0a;color:#fca5a5}
    .spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:10px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:10px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
    .stat-value{font-size:20px;font-weight:700;margin-top:4px}
    .table-wrap{max-height:520px;overflow:auto;border:1px solid #1f2937;border-radius:8px}
    .run-meta{font-size:12px;color:#64748b;margin-top:6px}
    .map-shell{position:relative;width:100%;height:420px;border-radius:16px;border:1px solid #334155;overflow:hidden;background:#020617}
    .map-shell .maplibregl-map{position:absolute;inset:0}
    .map-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
    .map-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#cbd5e1;margin-top:8px}
    .legend-item{display:flex;align-items:center;gap:6px}
    .legend-swatch{width:14px;height:14px;border-radius:3px;border:1px solid rgba(255,255,255,.25)}
    .coord{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#93c5fd}
    .map-counts{font-size:12px;color:#94a3b8}
    .map-error{display:flex;align-items:center;justify-content:center;height:100%;color:#fca5a5;font-size:13px;padding:16px;text-align:center}
    .map-bottom-panel{border-top:1px solid #334155;background:#0b1220;margin-top:8px}
    .map-bottom-inner{max-width:1320px;margin:0 auto;padding:12px 16px 14px;display:grid;grid-template-columns:1fr 340px;gap:16px;align-items:start}
    @media (max-width:900px){.map-bottom-inner{grid-template-columns:1fr}}
    .mini-map-wrap{position:relative;width:100%;height:220px;border:1px solid #334155;border-radius:16px;overflow:hidden;background:#020617}
    .mini-map-wrap .center-pin{position:absolute;left:50%;top:50%;width:18px;height:18px;border-radius:50%;border:3px solid #fff;background:#dc2626;box-shadow:0 2px 8px rgba(0,0,0,.35);transform:translate(-50%,-50%);pointer-events:none;z-index:2}
    #spotMiniMap{position:absolute;inset:0}
    .maplibregl-popup-content{font-size:12px;line-height:1.45;color:#0f172a;border-radius:8px;padding:8px 10px}
    .maplibregl-ctrl-attrib{font-size:10px}
  </style>
</head>
<body>
  <div class="shell">
    <p><a href="/admin">← Admin home</a></p>
    <h1>Inventory MVP</h1>
    <p class="muted">Verify import region and coordinates on the map before committing. Default region: <strong>${defaults.label}</strong>.</p>
    <div class="warn"><strong>Production writes disabled by default.</strong> Dry-run and emulator-only commit are safe paths. Never writes to <code>/posts</code>.</div>

    <div id="statusBar" class="status-bar idle">Ready — click <strong>Run Dry Run</strong> to load spots on the map.</div>

    <section class="panel">
      <h2>Region map — ${defaults.label}</h2>
      <p class="muted">Orange box = import bbox. Blue = accepted spots. Green = routes. Red = rejected. Click a spot row below to verify on the bottom mini map.</p>
      <div class="map-toolbar">
        <button type="button" id="btnFitRegion" class="secondary">Fit import region</button>
        <button type="button" id="btnFitAll" class="secondary">Fit all markers</button>
        <button type="button" id="btnToggleRejected" class="ghost">Hide rejected</button>
        <span id="mapCounts" class="map-counts"></span>
      </div>
      <div class="map-shell"><div id="regionMap"></div></div>
      <div class="map-legend">
        <span class="legend-item"><span class="legend-swatch" style="background:rgba(245,158,11,.25);border-color:#f59e0b"></span> Import bbox</span>
        <span class="legend-item"><span class="legend-swatch" style="background:#2563eb"></span> Accepted spot</span>
        <span class="legend-item"><span class="legend-swatch" style="background:#22c55e"></span> Route</span>
        <span class="legend-item"><span class="legend-swatch" style="background:#ef4444"></span> Rejected</span>
      </div>
    </section>

    <section class="panel">
      <h2>Controls</h2>
      <div class="row">
        <label>Source
          <select id="source"><option value="fixture">fixture</option><option value="geojson">geojson</option></select>
        </label>
        <label>Limit <input id="limit" type="number" value="100" min="1" max="10000"/></label>
        <label>GeoJSON path <input id="geojsonPath" type="text" placeholder="/path/to/file.geojson"/></label>
      </div>
      <div class="row">
        <button id="btnDryRun">Run Dry Run</button>
        <button id="btnCommitEmu" class="secondary" disabled>Commit to Emulator</button>
        <button id="btnTilesDryRun" class="secondary" disabled>Build Tiles (dry run)</button>
        <button id="btnTilesEmu" class="secondary" disabled>Write Tiles to Emulator</button>
        <button id="btnClear" class="ghost">Clear session</button>
      </div>
      <div class="row">
        <span class="pill">region: ${defaults.regionKey}</span>
        <span class="pill">bbox: ${defaults.minLat},${defaults.minLng} → ${defaults.maxLat},${defaults.maxLng}</span>
      </div>
      <div id="runMeta" class="run-meta"></div>
    </section>

    <section class="panel" id="resultsPanel" style="display:none">
      <h2>OSM mirror results</h2>
      <div id="summaryGrid" class="summary-grid"></div>
    </section>

    <section class="panel" id="sanityPanel" style="display:none">
      <h2>Coordinate sanity</h2>
      <p class="muted">Accepted objects should sit near lat 43 / lng -72 for Hartland. Swapped coordinates are rejected.</p>
      <pre id="sanityOut"></pre>
    </section>

    <section class="panel" id="spotsPanel" style="display:none">
      <h2>Accepted spots (<span id="spotsCount">0</span>)</h2>
      <p class="muted">Click a row to verify coordinates on the mini map at the bottom of the page.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Category</th><th>Coordinates</th><th>Score</th><th>Coord source</th><th>ID</th></tr></thead>
          <tbody id="spotsTable"></tbody>
        </table>
      </div>
    </section>

    <section class="panel" id="routesPanel" style="display:none">
      <h2>Accepted routes (<span id="routesCount">0</span>)</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Activity</th><th>Points</th><th>Bbox</th><th>Distance (m)</th><th>ID</th></tr></thead>
          <tbody id="routesTable"></tbody>
        </table>
      </div>
    </section>

    <section class="panel" id="issuesPanel" style="display:none">
      <h2>Rejected &amp; warnings</h2>
      <h3>Rejected</h3>
      <pre id="rejected">None</pre>
      <h3>Warnings</h3>
      <pre id="warnings">None</pre>
    </section>

    <section class="panel" id="tilesPanel" style="display:none">
      <h2>Tile preview (<span id="tilesCount">0</span> tiles)</h2>
      <pre id="tiles">No tiles built yet.</pre>
    </section>

    <section class="panel map-bottom-panel" id="spotMapPanel">
      <div class="map-bottom-inner">
        <div>
          <h2 style="margin:0 0 4px;font-size:14px">Spot location verifier</h2>
          <p id="spotMapLabel" class="muted" style="margin:0 0 8px">Click a spot row to verify coordinates — red pin marks the exact point.</p>
          <div id="spotMapCoords" class="coord">—</div>
          <p class="muted" style="margin:8px 0 0;font-size:12px">Same MapLibre + OpenStreetMap tiles as Wikipedia staging admin.</p>
        </div>
        <div class="mini-map-wrap">
          <div id="spotMiniMap"></div>
          <div class="center-pin" aria-hidden="true"></div>
        </div>
      </div>
    </section>
  </div>

  <script>
    const DEFAULT_VIEWPORT = ${JSON.stringify(defaults)};
    const OSM_RASTER_STYLE = {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }],
    };

    let latestRunId = null;
    let busy = false;
    let defaultViewport = null;
    let regionMap = null;
    let spotMiniMap = null;
    let showRejected = true;
    let stagedSpotsCache = [];
    let stagedRoutesCache = [];
    let lastRunForMap = null;
    let pendingMapUpdate = null;
    let selectedSpotIdx = -1;
    let regionMapReady = false;
    let spotMiniMapReady = false;

    const els = {
      statusBar: document.getElementById("statusBar"),
      btnDryRun: document.getElementById("btnDryRun"),
      btnCommitEmu: document.getElementById("btnCommitEmu"),
      btnTilesDryRun: document.getElementById("btnTilesDryRun"),
      btnTilesEmu: document.getElementById("btnTilesEmu"),
      btnClear: document.getElementById("btnClear"),
      btnFitRegion: document.getElementById("btnFitRegion"),
      btnFitAll: document.getElementById("btnFitAll"),
      btnToggleRejected: document.getElementById("btnToggleRejected"),
      mapCounts: document.getElementById("mapCounts"),
      runMeta: document.getElementById("runMeta"),
      resultsPanel: document.getElementById("resultsPanel"),
      sanityPanel: document.getElementById("sanityPanel"),
      sanityOut: document.getElementById("sanityOut"),
      spotsPanel: document.getElementById("spotsPanel"),
      routesPanel: document.getElementById("routesPanel"),
      issuesPanel: document.getElementById("issuesPanel"),
      tilesPanel: document.getElementById("tilesPanel"),
      summaryGrid: document.getElementById("summaryGrid"),
      spotsTable: document.getElementById("spotsTable"),
      routesTable: document.getElementById("routesTable"),
      spotsCount: document.getElementById("spotsCount"),
      routesCount: document.getElementById("routesCount"),
      tilesCount: document.getElementById("tilesCount"),
      rejected: document.getElementById("rejected"),
      warnings: document.getElementById("warnings"),
      tiles: document.getElementById("tiles"),
      spotMapLabel: document.getElementById("spotMapLabel"),
      spotMapCoords: document.getElementById("spotMapCoords"),
    };

    function viewportFromInput(vp) {
      const bbox = vp?.bbox || vp || DEFAULT_VIEWPORT;
      const center = vp?.center || { lat: DEFAULT_VIEWPORT.centerLat, lng: DEFAULT_VIEWPORT.centerLng };
      return {
        label: vp?.label || DEFAULT_VIEWPORT.label,
        center,
        bbox: {
          minLat: bbox.minLat ?? DEFAULT_VIEWPORT.minLat,
          minLng: bbox.minLng ?? DEFAULT_VIEWPORT.minLng,
          maxLat: bbox.maxLat ?? DEFAULT_VIEWPORT.maxLat,
          maxLng: bbox.maxLng ?? DEFAULT_VIEWPORT.maxLng,
        },
      };
    }

    function bboxFeature(vp) {
      const b = vp.bbox;
      return {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[
            [b.minLng, b.minLat],
            [b.maxLng, b.minLat],
            [b.maxLng, b.maxLat],
            [b.minLng, b.maxLat],
            [b.minLng, b.minLat],
          ]],
        },
      };
    }

    function fmtCoord(lat, lng) {
      return lat.toFixed(6) + ", " + lng.toFixed(6);
    }

    function esc(value) {
      return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function setStatus(kind, html) {
      els.statusBar.className = "status-bar " + kind;
      els.statusBar.innerHTML = html;
    }

    function setBusy(isBusy, message) {
      busy = isBusy;
      els.btnDryRun.disabled = isBusy;
      els.btnCommitEmu.disabled = isBusy || !latestRunId;
      els.btnTilesDryRun.disabled = isBusy || !latestRunId;
      els.btnTilesEmu.disabled = isBusy || !latestRunId;
      els.btnClear.disabled = isBusy;
      if (isBusy && message) setStatus("running", '<span class="spinner"></span> ' + message);
    }

    async function api(path, options) {
      const res = await fetch(path, options);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message || "request_failed");
      return json.data;
    }

    function showMapLoadError(containerId, message) {
      const el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = '<div class="map-error">' + esc(message) + "</div>";
    }

    function ensureMapLibre() {
      if (typeof maplibregl === "undefined") {
        throw new Error("MapLibre failed to load from CDN. Check network or ad blockers.");
      }
    }

    function createMap(containerId, centerLngLat, zoom) {
      ensureMapLibre();
      const map = new maplibregl.Map({
        container: containerId,
        style: OSM_RASTER_STYLE,
        center: centerLngLat,
        zoom: zoom,
        attributionControl: true,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      return map;
    }

    function fitViewport(map, vp, padding) {
      const b = vp.bbox;
      const bounds = new maplibregl.LngLatBounds([b.minLng, b.minLat], [b.maxLng, b.maxLat]);
      map.fitBounds(bounds, { padding: padding || 24, duration: 0 });
    }

    function initRegionMap(viewport) {
      const vp = viewportFromInput(viewport);
      try {
        ensureMapLibre();
      } catch (e) {
        showMapLoadError("regionMap", e.message);
        return;
      }

      if (regionMap) {
        regionMap.remove();
        regionMap = null;
        regionMapReady = false;
      }

      regionMap = createMap("regionMap", [vp.center.lng, vp.center.lat], 10);
      regionMap.on("load", function() {
        regionMapReady = true;
        regionMap.addSource("bbox", { type: "geojson", data: bboxFeature(vp) });
        regionMap.addLayer({
          id: "bbox-fill",
          type: "fill",
          source: "bbox",
          paint: { "fill-color": "#f59e0b", "fill-opacity": 0.08 },
        });
        regionMap.addLayer({
          id: "bbox-line",
          type: "line",
          source: "bbox",
          paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [2, 2] },
        });
        regionMap.addSource("spots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        regionMap.addLayer({
          id: "spots-circle",
          type: "circle",
          source: "spots",
          paint: {
            "circle-radius": 7,
            "circle-color": "#2563eb",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        regionMap.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        regionMap.addLayer({
          id: "routes-line",
          type: "line",
          source: "routes",
          paint: { "line-color": "#22c55e", "line-width": 4, "line-opacity": 0.85 },
        });
        regionMap.addSource("rejected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        regionMap.addLayer({
          id: "rejected-circle",
          type: "circle",
          source: "rejected",
          layout: { visibility: "visible" },
          paint: {
            "circle-radius": 6,
            "circle-color": "#ef4444",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });

        regionMap.on("click", "spots-circle", function(e) {
          const f = e.features && e.features[0];
          if (!f) return;
          const idx = Number(f.properties?.idx);
          if (Number.isFinite(idx)) selectSpot(idx, false);
          const coords = f.geometry.coordinates.slice();
          new maplibregl.Popup({ closeButton: true, maxWidth: "240px" })
            .setLngLat(coords)
            .setHTML(f.properties?.popupHtml || "")
            .addTo(regionMap);
        });
        regionMap.on("mouseenter", "spots-circle", function() { regionMap.getCanvas().style.cursor = "pointer"; });
        regionMap.on("mouseleave", "spots-circle", function() { regionMap.getCanvas().style.cursor = ""; });

        fitViewport(regionMap, vp, 24);
        regionMap.resize();
        if (pendingMapUpdate) {
          updateRegionMap(pendingMapUpdate.spots, pendingMapUpdate.routes, pendingMapUpdate.run);
          pendingMapUpdate = null;
        }
      });
    }

    function initSpotMiniMap(viewport) {
      const vp = viewportFromInput(viewport);
      try {
        ensureMapLibre();
      } catch (e) {
        showMapLoadError("spotMiniMap", e.message);
        return;
      }

      if (spotMiniMap) {
        spotMiniMap.remove();
        spotMiniMap = null;
        spotMiniMapReady = false;
      }

      spotMiniMap = createMap("spotMiniMap", [vp.center.lng, vp.center.lat], 11);
      spotMiniMap.on("load", function() {
        spotMiniMapReady = true;
        spotMiniMap.resize();
      });
    }

    function fitRegionBounds() {
      if (!regionMap || !defaultViewport) return;
      fitViewport(regionMap, viewportFromInput(defaultViewport), 24);
    }

    function fitAllBounds(spots, routes, run) {
      if (!regionMap) return;
      const coords = [];
      (spots || []).forEach(function(s) { coords.push([s.lng, s.lat]); });
      rejectedSamplesFromRun(run).forEach(function(r) { coords.push([r.lng, r.lat]); });
      (routes || []).forEach(function(r) {
        (r.coordinates || []).forEach(function(c) { coords.push([c.lng, c.lat]); });
      });
      if (!coords.length) {
        fitRegionBounds();
        return;
      }
      const bounds = coords.reduce(function(b, c) { return b.extend(c); }, new maplibregl.LngLatBounds(coords[0], coords[0]));
      regionMap.fitBounds(bounds, { padding: 40, duration: 400 });
    }

    function rejectedSamplesFromRun(run) {
      const out = [];
      for (const err of run?.errors || []) {
        const s = err.sample;
        if (!s || typeof s !== "object") continue;
        const lat = Number(s.lat);
        const lng = Number(s.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          out.push({ name: s.name || s.id || err.code, lat, lng, code: err.code, message: err.message });
        }
      }
      return out;
    }

    function spotPopupHtml(s) {
      const coordSource = (s.tags && s.tags.coordSource) ? String(s.tags.coordSource) : (s.attribution?.source || "");
      return (
        "<strong>" + esc(s.name) + "</strong><br/>" +
        esc(s.category) + "<br/>" +
        '<span class="coord">' + fmtCoord(s.lat, s.lng) + "</span><br/>" +
        (coordSource ? "<small>" + esc(coordSource) + "</small>" : "")
      );
    }

    function updateRegionMap(spots, routes, run) {
      if (!regionMap || !regionMapReady) {
        pendingMapUpdate = { spots, routes, run };
        return;
      }

      const spotFeatures = spots.map(function(s, idx) {
        return {
          type: "Feature",
          properties: { idx: idx, popupHtml: spotPopupHtml(s) },
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        };
      });
      const routeFeatures = routes.map(function(r) {
        const coords = (r.coordinates || []).map(function(c) { return [c.lng, c.lat]; });
        if (coords.length < 2) return null;
        return {
          type: "Feature",
          properties: { name: r.name },
          geometry: { type: "LineString", coordinates: coords },
        };
      }).filter(Boolean);

      const rejectedFeatures = rejectedSamplesFromRun(run).map(function(r) {
        return {
          type: "Feature",
          properties: { popupHtml: "<strong>REJECTED</strong><br/>" + esc(r.name) + "<br/>" + esc(r.code) },
          geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        };
      });

      regionMap.getSource("spots").setData({ type: "FeatureCollection", features: spotFeatures });
      regionMap.getSource("routes").setData({ type: "FeatureCollection", features: routeFeatures });
      regionMap.getSource("rejected").setData({ type: "FeatureCollection", features: rejectedFeatures });
      regionMap.setLayoutProperty("rejected-circle", "visibility", showRejected ? "visible" : "none");

      const rejCount = rejectedFeatures.length;
      els.mapCounts.textContent = spots.length + " spots · " + routes.length + " routes · " + rejCount + " rejected on map";
      if (spots.length || routes.length) fitAllBounds(spots, routes, run);
      else fitRegionBounds();
    }

    function selectSpot(idx, flyRegion) {
      const spot = stagedSpotsCache[idx];
      if (!spot) return;
      selectedSpotIdx = idx;

      document.querySelectorAll("tr.spot-row").forEach(function(row) {
        row.classList.toggle("selected", Number(row.dataset.idx) === idx);
      });

      els.spotMapLabel.textContent = spot.name + " — " + spot.category;
      els.spotMapCoords.textContent = fmtCoord(spot.lat, spot.lng);

      if (spotMiniMap && spotMiniMapReady) {
        spotMiniMap.flyTo({ center: [spot.lng, spot.lat], zoom: 14, essential: true });
      }

      if (flyRegion !== false && regionMap && regionMapReady) {
        regionMap.flyTo({ center: [spot.lng, spot.lat], zoom: Math.max(regionMap.getZoom(), 13), essential: true });
      }
    }

    function clearResults() {
      latestRunId = null;
      stagedSpotsCache = [];
      stagedRoutesCache = [];
      lastRunForMap = null;
      pendingMapUpdate = null;
      els.spotMapLabel.textContent = "Click a spot row to verify coordinates — red pin marks the exact point.";
      els.spotMapCoords.textContent = "—";
      document.querySelectorAll("tr.spot-row.selected").forEach(function(row) { row.classList.remove("selected"); });

      if (regionMap && regionMapReady) {
        regionMap.getSource("spots")?.setData({ type: "FeatureCollection", features: [] });
        regionMap.getSource("routes")?.setData({ type: "FeatureCollection", features: [] });
        regionMap.getSource("rejected")?.setData({ type: "FeatureCollection", features: [] });
      }
      els.mapCounts.textContent = "";
      els.runMeta.textContent = "";
      els.resultsPanel.style.display = "none";
      els.sanityPanel.style.display = "none";
      els.spotsPanel.style.display = "none";
      els.routesPanel.style.display = "none";
      els.issuesPanel.style.display = "none";
      els.tilesPanel.style.display = "none";
      els.summaryGrid.innerHTML = "";
      els.sanityOut.textContent = "";
      els.spotsTable.innerHTML = "";
      els.routesTable.innerHTML = "";
      els.spotsCount.textContent = "0";
      els.routesCount.textContent = "0";
      els.tilesCount.textContent = "0";
      els.rejected.textContent = "None";
      els.warnings.textContent = "None";
      els.tiles.textContent = "No tiles built yet.";
      els.btnCommitEmu.disabled = true;
      els.btnTilesDryRun.disabled = true;
      els.btnTilesEmu.disabled = true;
      fitRegionBounds();
      if (spotMiniMap && spotMiniMapReady && defaultViewport) {
        const vp = viewportFromInput(defaultViewport);
        spotMiniMap.flyTo({ center: [vp.center.lng, vp.center.lat], zoom: 11, essential: true });
      }
      setStatus("idle", 'Ready — click <strong>Run Dry Run</strong> to load spots on the map.');
    }

    function renderSummary(counts) {
      const items = [
        ["Raw objects", counts.rawObjects],
        ["Accepted spots", counts.acceptedSpots],
        ["Accepted routes", counts.acceptedRoutes],
        ["Rejected", counts.rejected],
        ["Duplicates", counts.duplicates],
        ["Tiles generated", counts.tilesGenerated || 0],
      ];
      els.summaryGrid.innerHTML = items.map(function(pair) {
        return '<div class="stat-box"><div class="stat-label">' + pair[0] + '</div><div class="stat-value">' + pair[1] + "</div></div>";
      }).join("");
      els.resultsPanel.style.display = "block";
    }

    function renderSpots(spots) {
      stagedSpotsCache = spots.slice();
      els.spotsCount.textContent = String(spots.length);
      els.spotsPanel.style.display = spots.length ? "block" : "none";
      els.spotsTable.innerHTML = spots.map(function(s, idx) {
        const coordSource = (s.tags && s.tags.coordSource) ? String(s.tags.coordSource) : "—";
        return (
          '<tr class="spot-row" data-idx="' + idx + '">' +
          "<td>" + esc(s.name) + "</td>" +
          "<td>" + esc(s.category) + "</td>" +
          '<td class="coord">' + fmtCoord(s.lat, s.lng) + "</td>" +
          "<td>" + s.qualityScore + "</td>" +
          "<td><small>" + esc(coordSource) + "</small></td>" +
          "<td><code>" + esc(s.id) + "</code></td>" +
          "</tr>"
        );
      }).join("");

      els.spotsTable.querySelectorAll("tr.spot-row").forEach(function(row) {
        row.addEventListener("click", function() {
          selectSpot(Number(row.dataset.idx), true);
        });
      });

      if (spots.length) selectSpot(0, false);
    }

    async function renderCoordinateSanity(source) {
      try {
        const data = await api("/admin/inventory/api/osm-debug/bbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: source || "fixture", limit: 500 }),
        });
        const r = data.result;
        els.sanityPanel.style.display = "block";
        els.sanityOut.textContent = JSON.stringify({
          counts: r.counts,
          coordinateSanity: r.coordinateSanity,
          coordinateWarnings: r.coordinateWarnings,
          sampleRejected: r.sampleRejected.slice(0, 8),
        }, null, 2);
      } catch (_) {
        els.sanityPanel.style.display = "none";
      }
    }

    function renderRoutes(routes) {
      els.routesCount.textContent = String(routes.length);
      els.routesPanel.style.display = routes.length ? "block" : "none";
      els.routesTable.innerHTML = routes.map(function(r) {
        const pts = (r.coordinates || []).length;
        const bbox = r.bbox
          ? r.bbox.minLat.toFixed(3) + "," + r.bbox.minLng.toFixed(3) + " → " + r.bbox.maxLat.toFixed(3) + "," + r.bbox.maxLng.toFixed(3)
          : "—";
        return (
          "<tr><td>" + esc(r.name) + "</td><td>" + esc(r.activity) + "</td><td>" + pts +
          "</td><td class='coord'><small>" + bbox + "</small></td><td>" + (r.distanceMeters ?? "—") +
          "</td><td><code>" + esc(r.id) + "</code></td></tr>"
        );
      }).join("");
    }

    function renderIssues(run) {
      const hasIssues = (run.errors && run.errors.length) || (run.warnings && run.warnings.length);
      els.issuesPanel.style.display = hasIssues ? "block" : "none";
      els.rejected.textContent = run.errors?.length ? JSON.stringify(run.errors, null, 2) : "None";
      els.warnings.textContent = run.warnings?.length ? JSON.stringify(run.warnings, null, 2) : "None";
    }

    function renderTiles(tiles, tilesGenerated) {
      const count = tilesGenerated ?? tiles.length;
      els.tilesCount.textContent = String(count);
      els.tilesPanel.style.display = count > 0 ? "block" : "none";
      els.tiles.textContent = tiles.length ? JSON.stringify(tiles, null, 2) : ("Generated " + count + " tiles (preview truncated)");
    }

    function renderRunResult(run, stagedSpots, stagedRoutes, tilePreview, source) {
      latestRunId = run.runId;
      lastRunForMap = run;
      els.runMeta.textContent = "runId: " + run.runId + " · status: " + run.status;
      renderSummary(run.counts);
      renderSpots(stagedSpots || []);
      stagedRoutesCache = stagedRoutes || [];
      renderRoutes(stagedRoutesCache);
      renderIssues(run);
      updateRegionMap(stagedSpots || [], stagedRoutes || [], run);
      if (tilePreview && tilePreview.length) renderTiles(tilePreview, run.counts.tilesGenerated);
      void renderCoordinateSanity(source || document.getElementById("source").value);
      els.btnCommitEmu.disabled = busy;
      els.btnTilesDryRun.disabled = busy;
      els.btnTilesEmu.disabled = busy;
    }

    els.btnFitRegion.onclick = fitRegionBounds;
    els.btnFitAll.onclick = function() {
      fitAllBounds(stagedSpotsCache, stagedRoutesCache, lastRunForMap || { errors: [] });
    };
    els.btnToggleRejected.onclick = function() {
      showRejected = !showRejected;
      els.btnToggleRejected.textContent = showRejected ? "Hide rejected" : "Show rejected";
      if (regionMap && regionMapReady) {
        regionMap.setLayoutProperty("rejected-circle", "visibility", showRejected ? "visible" : "none");
      }
    };

    els.btnDryRun.onclick = async function() {
      clearResults();
      setBusy(true, "Running dry run — loading source, normalizing, scoring…");
      try {
        await api("/admin/inventory/api/session/reset", { method: "POST" });
        const body = {
          source: document.getElementById("source").value,
          limit: Number(document.getElementById("limit").value || 100),
          geojsonPath: document.getElementById("geojsonPath").value || undefined,
        };
        const data = await api("/admin/inventory/api/runs/dry-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        renderRunResult(data.result.run, data.result.stagedSpots, data.result.stagedRoutes, [], body.source);
        setStatus("success", "Dry run complete — verify pins on the region map and bottom mini map.");
      } catch (e) {
        setStatus("error", "Dry run failed: " + (e.message || e));
      } finally {
        setBusy(false);
      }
    };

    els.btnCommitEmu.onclick = async function() {
      if (!latestRunId) return;
      setBusy(true, "Committing to Firestore emulator…");
      try {
        const data = await api("/admin/inventory/api/runs/" + encodeURIComponent(latestRunId) + "/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commitTarget: "emulator", dryRun: false }),
        });
        const artifacts = await api("/admin/inventory/api/runs/" + encodeURIComponent(latestRunId) + "/artifacts");
        renderRunResult(artifacts.run, artifacts.stagedSpots, artifacts.stagedRoutes, artifacts.tilePreview);
        setStatus("success", "Committed — " + data.result.spotWrites + " spots, " + data.result.routeWrites + " routes.");
      } catch (e) {
        setStatus("error", "Commit failed: " + (e.message || e));
      } finally {
        setBusy(false);
      }
    };

    els.btnTilesDryRun.onclick = async function() {
      if (!latestRunId) return;
      setBusy(true, "Building tile payloads…");
      try {
        const data = await api("/admin/inventory/api/runs/" + encodeURIComponent(latestRunId) + "/build-tiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: true, commitTarget: "none" }),
        });
        const artifacts = await api("/admin/inventory/api/runs/" + encodeURIComponent(latestRunId) + "/artifacts");
        renderRunResult(artifacts.run, artifacts.stagedSpots, artifacts.stagedRoutes, data.result.tiles);
        setStatus("success", "Tiles built — " + data.result.tilesGenerated + " tiles.");
      } catch (e) {
        setStatus("error", "Tile build failed: " + (e.message || e));
      } finally {
        setBusy(false);
      }
    };

    els.btnTilesEmu.onclick = async function() {
      if (!latestRunId) return;
      setBusy(true, "Writing tiles to emulator…");
      try {
        const data = await api("/admin/inventory/api/runs/" + encodeURIComponent(latestRunId) + "/build-tiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: false, commitTarget: "emulator" }),
        });
        const artifacts = await api("/admin/inventory/api/runs/" + encodeURIComponent(latestRunId) + "/artifacts");
        renderRunResult(artifacts.run, artifacts.stagedSpots, artifacts.stagedRoutes, data.result.tiles);
        setStatus("success", "Tiles written — " + data.result.tileWrites + " docs.");
      } catch (e) {
        setStatus("error", "Tile write failed: " + (e.message || e));
      } finally {
        setBusy(false);
      }
    };

    els.btnClear.onclick = async function() {
      setBusy(true, "Clearing session…");
      try {
        await api("/admin/inventory/api/session/reset", { method: "POST" });
        clearResults();
      } catch (e) {
        setStatus("error", "Clear failed: " + (e.message || e));
      } finally {
        setBusy(false);
      }
    };

    async function boot() {
      try {
        const health = await api("/admin/inventory/api/health");
        defaultViewport = health.defaultViewport;
      } catch (_) {
        defaultViewport = {
          label: DEFAULT_VIEWPORT.label,
          regionKey: DEFAULT_VIEWPORT.regionKey,
          center: { lat: DEFAULT_VIEWPORT.centerLat, lng: DEFAULT_VIEWPORT.centerLng },
          bbox: {
            minLat: DEFAULT_VIEWPORT.minLat,
            minLng: DEFAULT_VIEWPORT.minLng,
            maxLat: DEFAULT_VIEWPORT.maxLat,
            maxLng: DEFAULT_VIEWPORT.maxLng,
          },
        };
      }

      initRegionMap(defaultViewport);
      initSpotMiniMap(defaultViewport);
      clearResults();

      window.addEventListener("resize", function() {
        if (regionMap) regionMap.resize();
        if (spotMiniMap) spotMiniMap.resize();
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  </script>
</body>
</html>`;
}
