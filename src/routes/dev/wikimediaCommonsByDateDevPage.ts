export function wikimediaCommonsByDateDevPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Wikimedia Commons by date</title>
  <style>
    body{font-family:ui-sans-serif,system-ui;margin:0;background:#0f172a;color:#e2e8f0}
    .shell{display:grid;grid-template-columns:300px 1fr;min-height:100vh}
    .left{border-right:1px solid #334155;padding:16px;background:#111827}
    .main{padding:16px}
    label{display:block;font-size:12px;color:#94a3b8;margin-top:10px}
    input,button{width:100%;box-sizing:border-box;margin:6px 0;padding:10px;border-radius:8px;border:1px solid #475569;background:#0b1220;color:#e2e8f0}
    button{cursor:pointer;font-weight:700}
    button.primary{background:#22c55e;border-color:#16a34a;color:#052e16;font-size:15px;padding:12px 10px}
    button.primary:disabled{opacity:.5;cursor:wait}
    .meta{font-size:13px;color:#94a3b8;margin:8px 0}
    .summary-top{margin:0 0 20px;padding:14px 16px;background:#111827;border:1px solid #334155;border-radius:10px;font-size:15px;color:#e2e8f0}
    .summary-top strong{font-size:26px;color:#f8fafc;font-weight:800;margin-right:6px}
    .day{margin:24px 0 12px;padding-bottom:8px;border-bottom:1px solid #334155;font-size:18px;font-weight:700;color:#f8fafc}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
    figure{margin:0;background:#111827;border:1px solid #334155;border-radius:10px;padding:8px}
    figure img{width:100%;height:120px;object-fit:cover;border-radius:6px;background:#020617}
    figcaption{font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.35;word-break:break-word}
    a{color:#38bdf8;text-decoration:none}
    a:hover{text-decoration:underline}
    .err{color:#fca5a5;font-family:ui-monospace,monospace;font-size:13px}
    .rejected-zone{margin-top:36px;padding-top:20px;border-top:2px solid #7f1d1d}
    .rejected-zone h2{color:#fecaca}
    .rej-card{display:grid;grid-template-columns:108px 1fr;gap:10px;align-items:start;margin:10px 0;padding:10px;border-radius:10px;border:1px solid #7f1d1d;background:#1a0a0a}
    .rej-card img{width:108px;height:84px;object-fit:cover;border-radius:6px;background:#020617}
    .rej-badge{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.04em;padding:3px 8px;border-radius:6px;background:#991b1b;color:#fff;margin-bottom:6px}
    .rej-reasons{margin:0;padding-left:18px;font-size:12px;color:#fecaca;line-height:1.45}
    .rej-title{font-size:13px;font-weight:600;margin:0 0 4px}
    @media(max-width:800px){.shell{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="shell">
    <aside class="left">
      <h1 style="margin:0 0 8px;font-size:20px">Commons × date</h1>
      <p style="font-size:13px;color:#94a3b8;margin:0">Strict scenic filters + no panoramas/house spam. Same-day photos split into separate rows if GPS clusters are &gt; ~½ mile apart. Streams batch-by-batch; rejected (non-geo) at bottom.</p>
      <label for="q">Search query</label>
      <input id="q" type="text" placeholder="e.g. Yellowstone National Park" autocomplete="off"/>
      <label for="limit">Max files (fast: fewer requests)</label>
      <input id="limit" type="number" min="1" max="2000" value="400"/>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="rasterOnly" type="checkbox" checked style="width:auto;margin:0"/>
        Raster photos only (skip SVG / non-image)
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="requireGeo" type="checkbox" checked style="width:auto;margin:0"/>
        Only files with latitude &amp; longitude
      </label>
      <button type="button" id="go" class="primary">Load</button>
      <p id="status" class="meta"></p>
    </aside>
    <main class="main" id="main">
      <p class="meta">Enter a query and hit Load. The grid fills in as each Commons API batch arrives.</p>
    </main>
  </div>
  <script>
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\"/g,"&quot;");
    const main = $("main");
    const statusEl = $("status");
    let activeEs = null;
    let streamFinished = false;
    function renderRejectedSection(body) {
      const rej = body.rejected || [];
      const total = typeof body.rejectedTotal === "number" ? body.rejectedTotal : rej.length;
      if (!total) return "";
      const capNote =
        rej.length < total
          ? "<p class='meta'>Showing " + rej.length + " of " + total + " rejected files (cap for page size).</p>"
          : "";
      let html =
        "<section class='rejected-zone'><h2 class='day'>Filtered out — rejected (" +
        total +
        ")</h2>" +
        "<p class='meta'>These matched your search but failed photo-quality rules. Files skipped only for missing coordinates are not listed here.</p>" +
        capNote;
      for (const r of rej) {
        const thumb = r.thumbUrl || "";
        const t = esc(String(r.title || "").replace(/^File:/, ""));
        const reasons = (r.reasons || []).map((x) => "<li>" + esc(x) + "</li>").join("");
        html +=
          "<article class='rej-card'>" +
          "<div>" +
          (thumb
            ? "<a href='" + esc(r.pageUrl) + "' target='_blank' rel='noopener'><img loading='lazy' src='" + esc(thumb) + "' alt=''/></a>"
            : "") +
          "</div><div><span class='rej-badge'>REJECTED</span>" +
          "<p class='rej-title'><a href='" + esc(r.pageUrl) + "' target='_blank' rel='noopener'>" +
          t +
          "</a></p>" +
          "<ul class='rej-reasons'>" +
          reasons +
          "</ul></div></article>";
      }
      html += "</section>";
      return html;
    }
    function renderFromSnapshot(body, requireGeo, streaming) {
      const dates = body.byDate || [];
      const groupCount = typeof body.groupCount === "number" ? body.groupCount : dates.length;
      if (!dates.length) {
        main.innerHTML =
          "<div class='summary-top'><strong>0</strong> date groups</div>" +
          "<p class='meta'>" +
          (streaming ? "Waiting for files that pass all filters…" : "No accepted results") +
          (requireGeo && !streaming ? " with coordinates and photo rules" : "") +
          (streaming && requireGeo ? " (geo + quality filters — many hits are dropped)" : "") +
          "</p>" +
          renderRejectedSection(body);
        return;
      }
      let html =
        "<div class='summary-top'><strong>" +
        groupCount +
        "</strong> date group" +
        (groupCount === 1 ? "" : "s") +
        " · " +
        body.totalFetched +
        " accepted file" +
        (body.totalFetched === 1 ? "" : "s") +
        "</div>";
      for (const bucket of dates) {
        html +=
          "<h2 class='day'>" +
          esc(bucket.date) +
          (bucket.geoHint
            ? " <span style='font-weight:500;color:#a5b4fc;font-size:14px'>· " + esc(bucket.geoHint) + "</span>"
            : "") +
          " <span style='font-weight:500;color:#94a3b8;font-size:14px'>(" +
          bucket.items.length +
          ")</span></h2>";
        html += "<div class='grid'>";
        for (const it of bucket.items) {
          const thumb = it.thumbUrl || it.fileUrl || "";
          const title = esc(it.title.replace(/^File:/, ""));
          const geoLine =
            it.lat != null && it.lon != null
              ? "<br/><span style='opacity:.85'>" + esc(String(it.lat)) + ", " + esc(String(it.lon)) + "</span>"
              : "";
          html += "<figure><a href='" + esc(it.pageUrl) + "' target='_blank' rel='noopener'>" +
            (thumb ? "<img loading='lazy' src='" + esc(thumb) + "' alt=''/>" : "<div style='height:120px'></div>") +
            "</a><figcaption>" + title + "<br/><span style='opacity:.8'>" + esc(it.timestamp || "") + "</span>" +
            geoLine +
            "</figcaption></figure>";
        }
        html += "</div>";
      }
      html += renderRejectedSection(body);
      main.innerHTML = html;
    }
    $("go").onclick = () => {
      const q = String($("q").value || "").trim();
      if (!q) {
        statusEl.textContent = "Enter a search query.";
        return;
      }
      const limit = Math.min(2000, Math.max(1, Number($("limit").value || 400)));
      const imagesOnly = $("rasterOnly").checked;
      const requireGeo = $("requireGeo").checked;
      const btn = $("go");
      if (activeEs) {
        try {
          activeEs.close();
        } catch (_) {}
        activeEs = null;
      }
      streamFinished = false;
      btn.disabled = true;
      statusEl.textContent = "Connecting…";
      main.innerHTML =
        "<div class='summary-top'><strong>0</strong> date groups · 0 files</div>" +
        "<p class='meta'>Streaming from Commons…</p>";
      const params = new URLSearchParams({
        q,
        limit: String(limit),
        imagesOnly: imagesOnly ? "true" : "false",
        requireGeo: requireGeo ? "true" : "false",
      });
      const url = "/dev/wikimedia-commons-by-date/api/search-stream?" + params.toString();
      const es = new EventSource(url);
      activeEs = es;
      es.onmessage = (ev) => {
        let body;
        try {
          body = JSON.parse(ev.data);
        } catch (_) {
          return;
        }
        if (!body.ok) {
          main.innerHTML = "<p class='err'>" + esc(body.error || "Request failed") + "</p>";
          streamFinished = true;
          es.close();
          activeEs = null;
          btn.disabled = false;
          statusEl.textContent = "";
          return;
        }
        const live = !body.done;
        const scanned = typeof body.scannedCount === "number" ? body.scannedCount : "—";
        const rejT = typeof body.rejectedTotal === "number" ? body.rejectedTotal : "—";
        const geoSk = typeof body.geoSkippedCount === "number" ? body.geoSkippedCount : "—";
        statusEl.textContent =
          body.totalFetched +
          " accepted · " +
          body.groupCount +
          " date group" +
          (body.groupCount === 1 ? "" : "s") +
          " · scanned " +
          scanned +
          " · rejected " +
          rejT +
          " · no-geo skip " +
          geoSk +
          " · " +
          body.apiRequests +
          " API req" +
          (body.apiRequests === 1 ? "" : "s") +
          (live ? " (streaming…)" : " · " + body.ms + " ms") +
          (body.truncated ? " · truncated" : "") +
          (body.requireGeo ? " · geo on" : " · geo off");
        renderFromSnapshot(body, requireGeo, live);
        if (body.done) {
          streamFinished = true;
          es.close();
          activeEs = null;
          btn.disabled = false;
        }
      };
      es.onerror = () => {
        if (streamFinished) return;
        try {
          es.close();
        } catch (_) {}
        activeEs = null;
        btn.disabled = false;
        statusEl.textContent = "Stream interrupted — try again or lower the limit.";
      };
    };
  </script>
</body>
</html>`;
}
