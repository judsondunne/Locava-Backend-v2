/**
 * Standalone PBF Photo Asset Preview — GET /admin/openstreetmap/pbf-photo-preview
 */
export function renderPbfPhotoAssetPreviewPage(): string {
  const apiBase = "/admin/openstreetmap/api/pbf-copier-v2";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>PBF Photo Preview — Locava</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Inter,system-ui,Arial,sans-serif;margin:0;background:#020617;color:#e2e8f0;min-height:100vh}
    a{color:#93c5fd}
    .wrap{max-width:1100px;margin:0 auto;padding:24px 20px 64px}
    .top-links{font-size:13px;color:#94a3b8;margin-bottom:20px}
    .top-links a{margin-right:14px}
    h1{font-size:32px;margin:0 0 6px;font-weight:800;letter-spacing:-.02em}
    .tagline{font-size:15px;color:#94a3b8;margin:0 0 24px;max-width:720px;line-height:1.5}
    .hero-status{border-radius:16px;padding:20px 24px;margin-bottom:24px;border:2px solid #334155;background:#0f172a}
    .hero-status.idle{border-color:#475569}
    .hero-status.wait{border-color:#854d0e;background:linear-gradient(135deg,#422006 0%,#111827 100%)}
    .hero-status.ok{border-color:#166534;background:linear-gradient(135deg,#052e16 0%,#111827 100%)}
    .hero-status.load{border-color:#2563eb;background:linear-gradient(135deg,#172554 0%,#111827 100%);animation:pulse 1.5s ease-in-out infinite}
    .hero-status.err{border-color:#b91c1c;background:linear-gradient(135deg,#450a0a 0%,#111827 100%)}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.88}}
    .hero-title{font-size:20px;font-weight:700;margin:0 0 6px}
    .hero-detail{font-size:14px;color:#cbd5e1;margin:0;line-height:1.45}
    .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
    @media(max-width:720px){.steps{grid-template-columns:1fr}}
    .step{border:1px solid #334155;border-radius:12px;padding:14px 16px;background:#111827}
    .step-num{display:inline-block;width:28px;height:28px;border-radius:999px;background:#1e3a8a;color:#bfdbfe;font-weight:800;font-size:14px;text-align:center;line-height:28px;margin-bottom:8px}
    .step.done .step-num{background:#166534;color:#86efac}
    .step h3{margin:0 0 4px;font-size:14px}
    .step p{margin:0;font-size:12px;color:#94a3b8;line-height:1.4}
    .panel{border:1px solid #334155;border-radius:14px;background:#111827;padding:18px 20px;margin-bottom:20px}
    .panel h2{margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8}
    label{font-size:13px;color:#cbd5e1;display:block;margin-bottom:6px}
    input,select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#1f2937;color:#fff;font-size:14px}
    input[type=number]{width:120px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    @media(max-width:720px){.grid2{grid-template-columns:1fr}}
    .pbf-card{border:2px solid #166534;border-radius:14px;padding:16px 18px;background:#052e1622;margin-top:12px}
    .pbf-card.bad{border-color:#b91c1c;background:#450a0a33}
    .run-card .name{font-size:18px;font-weight:700;margin:0 0 4px}
    .run-card .meta{font-size:13px;color:#94a3b8;margin:0}
    .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;margin-right:6px}
    .pill.write{background:#14532d;color:#86efac}
    .pill.dry{background:#334155;color:#94a3b8}
    .pill.active{background:#1e3a8a;color:#bfdbfe}
    .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:16px}
    .btn-fetch{font-size:18px;font-weight:800;padding:16px 32px;border-radius:12px;border:none;background:#16a34a;color:#fff;cursor:pointer;box-shadow:0 4px 20px rgba(22,163,74,.35)}
    .btn-fetch:hover{background:#15803d}
    .btn-fetch:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
    button.sec{padding:10px 16px;border-radius:10px;border:none;background:#334155;color:#fff;font-size:13px;cursor:pointer}
    button.danger{background:#b91c1c}
    button:disabled{opacity:.45;cursor:not-allowed}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:14px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:10px;padding:10px 12px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase}
    .stat-value{font-size:20px;font-weight:800;margin-top:4px}
    #results{margin-top:8px}
    .asset-spot-card{border:1px solid #334155;border-radius:14px;background:#0b1220;padding:14px 16px;margin:16px 0}
    .asset-spot-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}
    .asset-spot-head h3{margin:0;font-size:16px}
    .asset-conf{padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase}
    .asset-conf.high{border:1px solid #166534;color:#86efac;background:#052e16}
    .asset-conf.medium{border:1px solid #854d0e;color:#fcd34d;background:#422006}
    .asset-conf.low,.asset-conf.skipped{border:1px solid #64748b;color:#94a3b8}
    .asset-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px}
    .asset-photo-card{border:1px solid #334155;border-radius:12px;background:#020617;overflow:hidden}
    .asset-photo-thumb{aspect-ratio:4/3;background:#1e293b;position:relative}
    .asset-photo-thumb img{width:100%;height:100%;object-fit:cover}
    .asset-photo-rank{position:absolute;top:8px;left:8px;background:rgba(2,6,23,.9);border-radius:999px;padding:3px 8px;font-size:10px;font-weight:700}
    .asset-photo-body{padding:10px 12px;font-size:12px;line-height:1.45}
    .muted{color:#94a3b8;font-size:13px}
    .asset-warn{color:#fcd34d;font-size:12px;margin:4px 0}
    .empty-box{text-align:center;padding:48px 24px;border:2px dashed #334155;border-radius:16px;color:#94a3b8}
    .empty-box strong{color:#e2e8f0;font-size:16px;display:block;margin-bottom:8px}
    code{background:#020617;padding:2px 6px;border-radius:4px;font-size:12px;color:#93c5fd}
    .toggle-row{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;align-items:center}
    .toggle-row label{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#cbd5e1;margin:0;cursor:pointer}
    .toggle-row input{width:auto;margin:0}
    .token-row{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
    .token{font-size:11px;border-radius:999px;padding:3px 8px;border:1px solid #334155;background:#020617;color:#cbd5e1}
    .token.missing{border-color:#991b1b;color:#fecaca;background:#450a0a55}
    .reject-list{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:8px}
    .reject-item{border:1px solid #7f1d1d;background:#450a0a40;border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.45}
    .photo-badge{position:absolute;top:8px;right:8px;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:700;text-transform:uppercase}
    .photo-badge.accepted{background:rgba(5,46,22,.92);color:#86efac}
    .photo-badge.rejected{background:rgba(69,10,10,.92);color:#fecaca}
    .asset-photo-card.rejected-card{border-color:#7f1d1d;opacity:.92}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top-links">
      <a href="/admin">← Admin</a>
      <a href="/admin/openstreetmap/pbf-copier-v2">Full Vermont Run (start / manage runs)</a>
    </div>

    <h1>📷 PBF Photo Preview</h1>
    <p class="tagline">
      Reads <strong>vermont-latest.osm.pbf</strong> directly — tile by tile, place by place — same classifier pipeline as Full Vermont Run,
      then metadata-scored Serper photos (no Gemini by default). <strong>Wrong photos are worse than none.</strong>
    </p>

    <div id="heroStatus" class="hero-status idle">
      <p class="hero-title" id="heroTitle">Checking Vermont PBF file…</p>
      <p class="hero-detail" id="heroDetail">Looking for data/osm/vermont-latest.osm.pbf on the server.</p>
    </div>

    <div class="steps">
      <div class="step" id="step1">
        <div class="step-num">1</div>
        <h3>PBF file on disk</h3>
        <p>Uses the same large Vermont OSM file as Full Vermont Run — no pre-run artifacts needed.</p>
      </div>
      <div class="step" id="step2">
        <div class="step-num">2</div>
        <h3>Scan tiles → spots</h3>
        <p>Walks Vermont tile-by-tile (0.4° step), runs the V2 pipeline, picks photo-ready places.</p>
      </div>
      <div class="step" id="step3">
        <div class="step-num">3</div>
        <h3>Photos per spot</h3>
        <p>Serper images scored by place name, town, and source metadata. Blank is OK when confidence is low.</p>
      </div>
    </div>

    <section class="panel">
      <h2>Live PBF scan</h2>
      <div id="pbfCard" class="pbf-card bad">
        <p class="name" id="pbfCardName">vermont-latest.osm.pbf</p>
        <p class="meta" id="pbfCardMeta">Checking…</p>
      </div>
      <div class="grid2" style="margin-top:14px">
        <div>
          <label for="maxSpots">How many spots to preview</label>
          <input id="maxSpots" type="number" min="1" max="100" value="10"/>
        </div>
        <div>
          <label for="tileStep">Tile step (degrees, same as Full Vermont Run)</label>
          <input id="tileStep" type="number" min="0.2" max="1" step="0.1" value="0.4"/>
        </div>
      </div>
      <div style="margin-top:14px">
        <label for="startTile">Start tile index (0 = southwest Vermont)</label>
        <input id="startTile" type="number" min="0" value="0"/>
      </div>
      <div class="toggle-row">
        <label><input type="checkbox" id="strictMatch" checked /> Strict title/source match</label>
        <label><input type="checkbox" id="showRejected" checked /> Show rejected results</label>
      </div>
      <details style="margin-top:14px" class="muted">
        <summary style="cursor:pointer;color:#94a3b8">Advanced: optional Vision QA (Gemini, borderline only)</summary>
        <div style="margin-top:10px">
          <label for="geminiKey">Gemini API key (only for manual Vision QA per spot)</label>
          <input id="geminiKey" type="password" placeholder="Not used during normal scan" autocomplete="off"/>
        </div>
      </details>
      <div class="actions">
        <button type="button" class="btn-fetch" id="btnFetch">▶ SCAN PBF + FETCH PHOTOS</button>
        <button type="button" class="sec" id="btnRefresh">Recheck PBF file</button>
        <button type="button" class="sec" id="btnStop" style="display:none">Stop</button>
        <button type="button" class="sec" id="btnClear">Clear results</button>
      </div>
    </section>

    <section class="panel" id="progressPanel" style="display:none">
      <h2>Progress</h2>
      <div class="stat-grid" id="progressGrid"></div>
    </section>

    <section id="results"></section>
    <div id="emptyState" class="empty-box">
      <strong>No photos yet</strong>
      Click <strong>SCAN PBF + FETCH PHOTOS</strong>. The server scans Vermont tiles from the PBF file, then curates photos for each spot here.
    </div>
  </div>

<script>
(function () {
  const API = ${JSON.stringify(apiBase)};
  const $ = function (id) { return document.getElementById(id); };
  let abort = null;
  let loading = false;
  let liveSources = null;
  const spotItemsByKey = {};

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function setHero(mode, title, detail) {
    $("heroStatus").className = "hero-status " + mode;
    $("heroTitle").textContent = title;
    $("heroDetail").textContent = detail;
  }

  function markStep(n, done) {
    const el = $("step" + n);
    if (el) el.className = done ? "step done" : "step";
  }

  async function apiGet(path) {
    const res = await fetch(API + path);
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error((json.error && json.error.message) || "Request failed");
    return json.data || {};
  }

  function formatBytes(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
    return n + " B";
  }

  function updatePbfCard(data) {
    const card = $("pbfCard");
    card.className = "pbf-card " + (data && data.readable ? "" : "bad");
    $("pbfCardName").textContent = (data && data.resolvedPath) ? data.resolvedPath.split("/").pop() : "vermont-latest.osm.pbf";
    if (!data) {
      $("pbfCardMeta").textContent = "Not loaded";
      return;
    }
    $("pbfCardMeta").textContent =
      (data.readable ? "✅ readable" : "❌ missing") + " · " + formatBytes(data.fileSizeBytes) +
      " · " + data.totalTiles + " tiles @ " + data.tileStepDegrees + "°";
  }

  async function loadLiveSources() {
    const tileStep = Number($("tileStep").value) || 0.4;
    setHero("load", "Checking PBF file…", "Validating vermont-latest.osm.pbf on the backend.");
    const data = await apiGet("/asset-preview/live-sources?tileStepDegrees=" + encodeURIComponent(String(tileStep)));
    liveSources = data;
    updatePbfCard(data);
    if (data.readable) {
      setHero("ok", "✅ Vermont PBF ready", data.message + " Click SCAN PBF + FETCH PHOTOS.");
      markStep(1, true); markStep(2, true); markStep(3, false);
      $("btnFetch").disabled = false;
    } else {
      setHero("err", "❌ PBF file not found", data.message);
      markStep(1, false); markStep(2, false); markStep(3, false);
      $("btnFetch").disabled = true;
    }
  }

  function assetConfClass(status) {
    if (status === "found") return "high";
    if (status === "skipped" || status === "error") return "skipped";
    if (status === "low_confidence" || status === "no_good_match") return "low";
    return "medium";
  }

  function statusLabel(status) {
    if (status === "found") return "found · photos OK";
    if (status === "no_good_match") return "no good match";
    if (status === "low_confidence") return "low confidence";
    if (status === "skipped") return "skipped";
    if (status === "error") return "error";
    return status || "?";
  }

  function renderPhoto(asset, opts) {
    opts = opts || {};
    const accepted = opts.accepted !== false;
    const v = asset.visionJudgment;
    const visionLine = v && v.automated
      ? '<div class="muted">Gemini: ' + escapeHtml(v.assetType) + " · place " + v.placeMatchScore + "/5 · " + escapeHtml(v.shortReason) + "</div>"
      : "";
    const badge = '<span class="photo-badge ' + (accepted ? "accepted" : "rejected") + '">' + (accepted ? "accepted" : "rejected") + "</span>";
    const scoreLine = asset.assetMatchScore != null
      ? '<div class="muted">Score ' + escapeHtml(String(asset.assetMatchScore)) + " · " + escapeHtml(asset.assetMatchConfidence || "low") + "</div>"
      : (asset.metadataScore != null ? '<div class="muted">Score ' + escapeHtml(String(asset.metadataScore)) + "</div>" : "");
    const urlLine = asset.sourceUrl
      ? '<div class="muted" style="word-break:break-all"><a href="' + escapeHtml(asset.sourceUrl) + '" target="_blank" rel="noopener">' + escapeHtml(asset.sourceUrl) + "</a></div>"
      : "";
    const rejectLine = !accepted && asset.rejectReasons && asset.rejectReasons.length
      ? '<div class="asset-warn">' + escapeHtml(asset.rejectReasons.join(", ")) + "</div>"
      : "";
    const rank = asset.rank != null ? "#" + asset.rank + " · " : "";
    return '<article class="asset-photo-card' + (accepted ? "" : " rejected-card") + '"><div class="asset-photo-thumb">' +
      badge +
      '<span class="asset-photo-rank">' + rank + escapeHtml(asset.assetMatchConfidence || (accepted ? "accepted" : "rejected")) + "</span>" +
      '<img src="' + escapeHtml(asset.imageUrl) + '" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement(\\'div\\'),{className:\\'muted\\',style:\\'padding:24px;text-align:center\\',textContent:\\'Preview unavailable\\'}))"/>' +
      '</div><div class="asset-photo-body"><div>' + escapeHtml(asset.title || asset.caption || "Photo") + '</div>' +
      '<div class="muted">' + escapeHtml(asset.sourceDomain || asset.sourceName || "") + "</div>" +
      scoreLine + urlLine + rejectLine + visionLine + "</div></article>";
  }

  function renderSpot(item, spotKey) {
    const p = item.assetPreview || {};
    const showRejected = $("showRejected").checked;
    const town = (item.sourceTagSample && item.sourceTagSample["addr:city"]) || "—";
    const acceptedPhotos = (p.externalAssets || []).map(function (a) { return renderPhoto(a, { accepted: true }); }).join("");
    const rejectedPhotos = showRejected && (p.rejectedPreviews || []).length
      ? (p.rejectedPreviews || []).map(function (r) {
          return renderPhoto({
            title: r.title,
            caption: r.title,
            sourceDomain: r.sourceDomain,
            sourceUrl: r.sourceUrl,
            imageUrl: "https://via.placeholder.com/400x300/1e293b/64748b?text=rejected",
            metadataScore: r.metadataScore,
            rejectReasons: r.rejectReasons,
          }, { accepted: false });
        }).join("")
      : "";
    const warns = (p.warnings || []).map(function (w) { return '<div class="asset-warn">⚠ ' + escapeHtml(w) + "</div>"; }).join("");
    const countsLine = '<p class="muted">Accepted <strong>' + escapeHtml(String(p.acceptedCount ?? (p.externalAssets || []).length)) +
      "</strong> · Rejected <strong>" + escapeHtml(String(p.rejectedCount ?? 0)) + "</strong></p>";
    const rejectLine = (p.topRejectionReasons && p.topRejectionReasons.length)
      ? '<p class="muted">Top reject reasons: ' + escapeHtml(p.topRejectionReasons.slice(0, 4).join(" · ")) + "</p>"
      : "";
    const matched = (p.matchedTokens || []).map(function (t) {
      return '<span class="token">' + escapeHtml(t) + "</span>";
    }).join("");
    const missing = (p.missingRequiredTokens || []).map(function (t) {
      return '<span class="token missing">missing: ' + escapeHtml(t) + "</span>";
    }).join("");
    const tokenRow = (matched || missing) ? '<div class="token-row">' + matched + missing + "</div>" : "";
    const rejectList = showRejected && (p.rejectedPreviews || []).length
      ? '<ul class="reject-list">' + (p.rejectedPreviews || []).slice(0, 5).map(function (r) {
          return '<li class="reject-item"><strong>' + escapeHtml(r.title) + "</strong> · " + escapeHtml(r.sourceDomain) +
            "<br/>" + escapeHtml((r.rejectReasons || []).join(", ")) + "</li>";
        }).join("") + "</ul>"
      : "";
    const blankMsg = (!p.assetsReady && (p.assetStatus === "low_confidence" || p.assetStatus === "no_good_match"))
      ? '<div class="asset-warn" style="font-size:14px;margin:12px 0">No good photos found — safer to leave blank.</div>'
      : "";
    const scoreLine = '<p class="muted">Set score <strong>' + escapeHtml(String(p.resultSetScore ?? "—")) +
      "</strong> · status <code>" + escapeHtml(p.assetStatus || "?") + "</code> · strict " +
      (p.strictTitleSourceMatch !== false ? "on" : "off") + "</p>";
    const qaBtn = '<button type="button" class="sec spot-vision-qa" data-spot-key="' + escapeHtml(spotKey) +
      '" style="margin-top:8px">Run Vision QA (optional)</button>';
    return '<section class="asset-spot-card" id="spot-' + escapeHtml(spotKey) + '"><div class="asset-spot-head"><h3>' + escapeHtml(item.displayName) +
      '</h3><span class="asset-conf ' + assetConfClass(p.assetStatus) + '">' +
      escapeHtml(statusLabel(p.assetStatus)) + '</span></div>' +
      '<p class="muted">' + escapeHtml(item.primaryActivity || "") + " · " + escapeHtml(town) + ", VT<br/>" +
      'Search query: <code>' + escapeHtml(p.query || "") + "</code></p>" + scoreLine + countsLine + rejectLine + tokenRow + rejectList + warns + blankMsg +
      '<div class="asset-photo-grid">' + (acceptedPhotos || '<div class="muted">No accepted photos</div>') + rejectedPhotos + "</div>" + qaBtn +
      "</section>";
  }

  function renderProgress(progress, partial) {
    partial = partial || {};
    const rows = [
      ["Tile", partial.tileIndex != null ? (partial.tileIndex + 1) + " / " + (partial.totalTiles || "—") : "—"],
      ["Spots", (partial.completed != null ? partial.completed + " / " + (partial.total || progress.spotsLoaded) : progress.spotsLoaded) || "—"],
      ["Found", partial.foundCount != null ? partial.foundCount : "—"],
      ["Blank", partial.blankCount != null ? partial.blankCount : "—"],
      ["Elapsed", progress.elapsedMs ? (progress.elapsedMs / 1000).toFixed(1) + "s" : (partial.elapsedSec != null ? partial.elapsedSec + "s" : "—")],
    ];
    $("progressGrid").innerHTML = rows.map(function (r) {
      return '<div class="stat-box"><div class="stat-label">' + r[0] + '</div><div class="stat-value">' + escapeHtml(String(r[1])) + "</div></div>";
    }).join("");
    $("progressPanel").style.display = "block";
  }

  async function consumeStream(res, onEvent) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var at;
      while ((at = buffer.indexOf("\\n\\n")) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        block.split("\\n").forEach(function (line) {
          if (!line.startsWith("data: ")) return;
          try { onEvent(JSON.parse(line.slice(6))); } catch (_e) {}
        });
      }
    }
  }

  async function fetchPhotos() {
    if (loading) return;
    if (!liveSources || !liveSources.readable) {
      setHero("err", "PBF not ready", "Recheck PBF file — vermont-latest.osm.pbf must exist on the server.");
      return;
    }
    loading = true;
    $("btnFetch").disabled = true;
    $("btnRefresh").disabled = true;
    $("btnStop").style.display = "inline-block";
    $("emptyState").style.display = "none";
    $("results").innerHTML = "";
    setHero("load", "⏳ Scanning Vermont PBF…", "Walking tiles from the large OSM file. First spot may take 30–90s (tile scan + photos).");
    markStep(3, true);
    abort = new AbortController();
    let completed = 0;
    let foundCount = 0;
    let blankCount = 0;
    let total = Number($("maxSpots").value) || 10;
    const scanStarted = Date.now();
    let totalTiles = liveSources.totalTiles || 0;
    let currentTile = Number($("startTile").value) || 0;
    try {
      const res = await fetch(API + "/asset-preview/fetch-stream-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxSpots: Math.max(1, Math.min(100, total)),
          tileStepDegrees: Number($("tileStep").value) || 0.4,
          startTileIndex: Math.max(0, Number($("startTile").value) || 0),
          visionMode: "off",
          strictTitleSourceMatch: $("strictMatch").checked,
        }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const t = await res.text();
        var j; try { j = JSON.parse(t); } catch (_e3) {}
        throw new Error((j && j.error && j.error.message) || t || "Fetch failed");
      }
      await consumeStream(res, function (msg) {
        const elapsedSec = ((Date.now() - scanStarted) / 1000).toFixed(0);
        if (msg.type === "meta") {
          total = msg.totalSpots || total;
          totalTiles = msg.totalTiles || totalTiles;
          currentTile = msg.startTileIndex || 0;
          setHero("load", "⏳ Scanning tile 1/" + totalTiles + "…", "Reading PBF → pipeline → photos. 0/" + total + " spots so far.");
          renderProgress({ spotsLoaded: total }, { completed: 0, total: total, tileIndex: currentTile, totalTiles: totalTiles, elapsedSec: elapsedSec });
        } else if (msg.type === "tile") {
          currentTile = msg.tileIndex;
          totalTiles = msg.totalTiles || totalTiles;
          setHero("load",
            "⏳ Scanning tile " + (msg.tileIndex + 1) + "/" + totalTiles,
            (msg.visibleInTile || 0) + " visible in tile · " + (msg.photoReadyInTile || 0) + " photo-ready · " + completed + "/" + total + " spots done");
          renderProgress({ spotsLoaded: total, geminiEnabled: completed > 0 }, {
            completed: completed, total: total, tileIndex: msg.tileIndex, totalTiles: totalTiles, elapsedSec: elapsedSec,
          });
        } else if (msg.type === "spot" && msg.item) {
          completed += 1;
          const spotKey = String(completed);
          if (msg.item.assetPreview && msg.item.assetPreview.assetsReady) foundCount += 1;
          else blankCount += 1;
          spotItemsByKey[spotKey] = msg.item;
          $("results").insertAdjacentHTML("beforeend", renderSpot(msg.item, spotKey));
          setHero("load", "⏳ " + completed + "/" + (msg.total || total) + " — " + (msg.item.displayName || "spot"),
            "Tile " + ((msg.tileIndex || 0) + 1) + "/" + totalTiles + " · " + foundCount + " with photos, " + blankCount + " blank");
          renderProgress({ spotsLoaded: total }, {
            completed: completed, total: msg.total || total, tileIndex: msg.tileIndex, totalTiles: totalTiles,
            elapsedSec: elapsedSec, foundCount: foundCount, blankCount: blankCount,
          });
        } else if (msg.type === "done") {
          renderProgress(msg.progress || {});
          setHero("ok", "✅ Done — " + (msg.items || []).length + " spots from live PBF scan",
            "Total time " + (((msg.progress || {}).elapsedMs || 0) / 1000).toFixed(1) + "s. Scroll down to review.");
        } else if (msg.type === "error") {
          throw new Error(msg.message || "Stream error");
        }
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        setHero("idle", "Stopped", "Fetch cancelled.");
      } else {
        setHero("err", "❌ Fetch failed", err && err.message ? err.message : String(err));
        $("emptyState").style.display = "block";
      }
    } finally {
      loading = false;
      abort = null;
      $("btnFetch").disabled = false;
      $("btnRefresh").disabled = false;
      $("btnStop").style.display = "none";
    }
  }

  $("btnFetch").addEventListener("click", function () { void fetchPhotos(); });
  $("btnRefresh").addEventListener("click", function () { void loadLiveSources().catch(function (e) { setHero("err", "Load failed", e.message); }); });
  $("btnStop").addEventListener("click", function () { if (abort) abort.abort(); });
  $("btnClear").addEventListener("click", function () {
    if (abort) abort.abort();
    $("results").innerHTML = "";
    Object.keys(spotItemsByKey).forEach(function (k) { delete spotItemsByKey[k]; });
    $("progressPanel").style.display = "none";
    $("emptyState").style.display = "block";
    void loadLiveSources();
  });
  $("tileStep").addEventListener("change", function () { void loadLiveSources(); });
  $("showRejected").addEventListener("change", function () {
    Object.keys(spotItemsByKey).forEach(function (key) {
      const item = spotItemsByKey[key];
      const el = document.getElementById("spot-" + key);
      if (item && el) el.outerHTML = renderSpot(item, key);
    });
  });

  document.addEventListener("click", function (ev) {
    const btn = ev.target && ev.target.closest ? ev.target.closest(".spot-vision-qa") : null;
    if (!btn) return;
    const key = btn.getAttribute("data-spot-key") || "0";
    const item = spotItemsByKey[key];
    if (!item) return;
    const geminiKey = ($("geminiKey").value || "").trim();
    if (!geminiKey) { alert("Paste a Gemini API key under Advanced to run Vision QA."); return; }
    if (geminiKey) try { localStorage.setItem("pbfAssetPreviewGeminiKey", geminiKey); } catch (_e2) {}
    btn.disabled = true;
    btn.textContent = "Running Vision QA…";
    const headers = { "Content-Type": "application/json", "x-pbf-asset-gemini-api-key": geminiKey };
    fetch(API + "/asset-preview/vision-qa-spot", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ doc: item, visionMode: "borderline_only", geminiApiKey: geminiKey }),
    }).then(function (res) { return res.json(); }).then(function (json) {
      if (!json.ok) throw new Error((json.error && json.error.message) || "Vision QA failed");
      const updated = json.data.item;
      spotItemsByKey[key] = updated;
      const el = document.getElementById("spot-" + key);
      if (el) el.outerHTML = renderSpot(updated, key);
    }).catch(function (err) {
      alert(err && err.message ? err.message : String(err));
      btn.disabled = false;
      btn.textContent = "Run Vision QA (optional)";
    });
  });

  try {
    const k = localStorage.getItem("pbfAssetPreviewGeminiKey");
    if (k) $("geminiKey").value = k;
  } catch (_e) {}

  void loadLiveSources().catch(function (e) {
    setHero("err", "Could not reach backend", e.message + " — is the server running on :8080?");
  });
})();
</script>
</body>
</html>`;
}
