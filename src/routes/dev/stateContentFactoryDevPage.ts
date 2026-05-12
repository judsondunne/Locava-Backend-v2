export function stateContentFactoryDevPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>State Content Factory</title>
  <style>
    body{font-family:ui-sans-serif,system-ui;margin:0;background:#0f172a;color:#e2e8f0}
    .shell{display:grid;grid-template-columns:320px 1fr;min-height:100vh}
    .left{border-right:1px solid #334155;padding:16px;background:#111827}
    .main{padding:16px}
    input,button,select,textarea{width:100%;box-sizing:border-box;margin:8px 0;padding:8px;border-radius:8px;border:1px solid #475569;background:#0b1220;color:#e2e8f0}
    button{cursor:pointer;font-weight:700}
    button.primary{background:#22c55e;border-color:#16a34a;color:#052e16}
    button.primary:disabled{opacity:.5;cursor:wait}
    .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
    .tabs button{width:auto}
    .tab.active{background:#1d4ed8;border-color:#2563eb}
    .panel{display:none}
    .panel.active{display:block}
    pre{background:#020617;border:1px solid #334155;border-radius:8px;padding:12px;max-height:360px;overflow:auto;font-size:12px}
    .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}
    .card{border:1px solid #334155;border-radius:10px;padding:10px;background:#111827}
    .place-card{border:1px solid #334155;border-radius:10px;padding:12px;margin:10px 0;background:#0b1220}
    .place-card h3{margin:0 0 8px 0}
    .place-meta{font-size:12px;color:#94a3b8}
    .warn{color:#fbbf24}
    .progress{height:10px;background:#1e293b;border-radius:999px;overflow:hidden}
    .progress>span{display:block;height:100%;background:#22c55e;width:0%}
    .filter-row{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:8px 0}
    .preview-card{border:1px solid #334155;border-radius:10px;padding:12px;margin:10px 0;background:#0f172a}
    .media-grid{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}
    .media-tile{width:120px;border:1px solid #334155;border-radius:8px;padding:6px;background:#020617;font-size:11px}
    .media-tile img{width:100%;height:120px;object-fit:cover;border-radius:6px;background:#1e293b}
    .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-right:6px}
    .badge-stageable{background:#14532d;color:#bbf7d0}
    .badge-review{background:#713f12;color:#fde68a}
    .badge-rejected{background:#7f1d1d;color:#fecaca}
    .mono-raw{font-size:11px;max-height:240px}
    .post-preview-mount{min-height:40px}
    .run-status-banner{border:1px solid #334155;background:linear-gradient(180deg,#0b1220,#020617);border-radius:12px;padding:14px 16px;margin-bottom:16px}
    .run-status-phase{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:700}
    .run-status-title{font-size:18px;font-weight:800;color:#f8fafc;margin:4px 0 2px}
    .run-status-detail{font-size:13px;color:#cbd5e1;line-height:1.45}
    .run-status-meta{font-size:12px;color:#64748b;margin-top:8px;font-family:ui-monospace,Menlo,monospace}
    @media(max-width:900px){.shell{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="shell">
    <aside class="left">
      <h1>State Content Factory</h1>
      <p>Place discovery + Wikimedia post previews. Dry run by default. No public /posts.</p>
      <p class="warn" id="healthMeta"></p>
      <label>State name</label>
      <input id="stateName" value="Vermont"/>
      <label>State code</label>
      <input id="stateCode" value="VT"/>
      <label>Discovery mode</label>
      <select id="placeDiscoveryMode">
        <option value="fast_targeted" selected>Fast targeted</option>
        <option value="deep_discovery">Deep discovery</option>
        <option value="fast_smoke">Fast smoke</option>
      </select>
      <label>Run mode</label>
      <select id="runMode">
        <option value="dry_run" selected>Dry run (in-memory only)</option>
        <option value="stage_only">Stage only (guarded writes)</option>
      </select>
      <label>Candidate limit (Wikidata pool size)</label>
      <input id="candidateLimit" type="number" min="1" max="500" value="100"/>
      <label>Max places to process (Wikimedia runs)</label>
      <input id="maxPlacesToProcess" type="number" min="1" max="80" value="20"/>
      <label>Priority queues</label>
      <input id="priorityQueues" value="P0,P1"/>
      <label>Quality threshold</label>
      <select id="qualityThreshold">
        <option value="loose">Loose</option>
        <option value="normal" selected>Normal</option>
        <option value="strict">Strict</option>
      </select>
      <label>Quality preview mode (dry-run UI)</label>
      <select id="qualityPreviewMode">
        <option value="preview_all" selected>preview_all — show all previews + thumbs</option>
        <option value="normal">normal</option>
        <option value="strict">strict</option>
      </select>
      <label>Max post previews / place</label>
      <input id="maxPostPreviewsPerPlace" type="number" min="1" max="20" value="10"/>
      <label>Total timeout ms (place-name discovery + Wikimedia)</label>
      <input id="totalTimeoutMs" type="number" min="5000" max="900000" value="300000"/>
      <label>Per-place timeout ms (each Commons run)</label>
      <input id="perPlaceTimeoutMs" type="number" min="5000" max="600000" value="25000"/>
      <label>Wikimedia harvest mode</label>
      <select id="wikimediaMode">
        <option value="fast_preview">fast_preview — very shallow</option>
        <option value="balanced" selected>balanced — recommended default</option>
        <option value="exhaustive">exhaustive — slow; avoid full-state runs</option>
      </select>
      <p class="warn" style="font-size:12px;margin:4px 0 0">Exhaustive pulls far more Commons pages and can exceed total run time for many places.</p>
      <label>Location trust (staging)</label>
      <select id="locationTrustMode">
        <option value="asset_geotag_required" selected>asset_geotag_required — require real asset coordinates</option>
        <option value="legacy_place_fallback_allowed">legacy_place_fallback_allowed — old fallback behavior</option>
      </select>
      <label><input id="includeMediaSignals" type="checkbox" checked/> Include media signals</label>
      <label><input id="allowStagingWrites" type="checkbox"/> Allow staging writes (request flag)</label>
      <label><input id="allowPublicPublish" type="checkbox" disabled/> Allow public publish (disabled)</label>
    </aside>
    <main class="main">
      <div class="tabs">
        <button type="button" class="tab active" data-tab="full">Full Pipeline</button>
        <button type="button" class="tab" data-tab="place">Place Test</button>
        <button type="button" class="tab" data-tab="post">Post Test</button>
        <button type="button" class="tab" data-tab="runs">Runs</button>
        <button type="button" class="tab" data-tab="staged">Staged Review</button>
        <button type="button" class="tab" data-tab="safety">Safety / Budgets</button>
      </div>
      <section class="panel active" id="panel-full">
        <div id="runStatusBanner" class="run-status-banner" aria-live="polite">
          <div class="run-status-phase" id="runStatusPhase">Ready</div>
          <div class="run-status-title" id="runStatusTitle">Configure a state on the left, then start.</div>
          <div class="run-status-detail" id="runStatusDetail">Step 1 discovers place names from Wikidata. Step 2 searches Wikimedia Commons per place (exhaustive mode pulls far more candidates).</div>
          <div class="run-status-meta" id="runStatusMeta"></div>
        </div>
        <button type="button" id="startFullBtn" class="primary">Start full pipeline</button>
        <div class="filter-row">
          <label><input type="radio" name="previewFilter" value="all" checked/> Show all previews</label>
          <label><input type="radio" name="previewFilter" value="stageable"/> Only stageable</label>
        </div>
        <div class="progress"><span id="progressBar"></span></div>
        <section class="summary" id="fullSummary"></section>
        <div id="placeResults"></div>
        <pre id="fullLogs"></pre>
      </section>
      <section class="panel" id="panel-place">
        <p class="place-meta">Runs <strong>Step 1 only</strong> (Wikidata place discovery). Uses the state + discovery settings on the left. When finished, this panel shows the full run JSON (<code>selectedCandidates</code>, <code>placeDiscovery</code>, counts).</p>
        <button type="button" id="startPlaceBtn" class="primary">Run place generator test</button>
        <pre id="placeOutput"></pre>
      </section>
      <section class="panel" id="panel-post">
        <p class="place-meta">Runs <strong>Step 2 only</strong> (Wikimedia → post previews) for one manual place. Optional lat/lng pin the map; if omitted, a centroid for the state code is used.</p>
        <label>Place label</label>
        <input id="postPlace" value="Huntington Gorge, Vermont, VT"/>
        <label>Place latitude (optional)</label>
        <input id="postPlaceLat" type="number" step="any" placeholder="e.g. 44.3673"/>
        <label>Place longitude (optional)</label>
        <input id="postPlaceLng" type="number" step="any" placeholder="-72.9689"/>
        <button type="button" id="startPostBtn" class="primary">Run post generator test</button>
        <div id="postOutput" class="post-preview-mount"></div>
        <pre id="postRawJson" class="mono-raw"></pre>
      </section>
      <section class="panel" id="panel-runs">
        <button type="button" id="refreshRunsBtn">Refresh runs</button>
        <pre id="runsOutput"></pre>
      </section>
      <section class="panel" id="panel-staged">
        <button type="button" id="refreshStagedBtn">Refresh staged posts</button>
        <pre id="stagedOutput"></pre>
      </section>
      <section class="panel" id="panel-safety">
        <pre id="safetyOutput"></pre>
      </section>
    </main>
  </div>
  <script>
    const $ = (id) => document.getElementById(id);
    const tabs = [...document.querySelectorAll(".tab")];
    const panels = [...document.querySelectorAll(".panel")];
    tabs.forEach((tab) => tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $("panel-" + tab.dataset.tab).classList.add("active");
    }));

    let activeRunId = null;
    let logTimer = null;
    let eventSource = null;
    let activeRunOutput = "full";
    let previewFilter = "all";
    window.__scfLastRun = null;

    function escapeHtml(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function bodyPayload(extra = {}) {
      return {
        stateName: $("stateName").value.trim(),
        stateCode: $("stateCode").value.trim() || undefined,
        runMode: $("runMode").value,
        placeDiscoveryMode: $("placeDiscoveryMode").value,
        candidateLimit: Number($("candidateLimit").value),
        maxPlacesToProcess: Number($("maxPlacesToProcess").value),
        priorityQueues: $("priorityQueues").value.split(",").map((x) => x.trim()).filter(Boolean),
        qualityThreshold: $("qualityThreshold").value,
        qualityPreviewMode: $("qualityPreviewMode").value,
        maxPostPreviewsPerPlace: Number($("maxPostPreviewsPerPlace").value),
        totalTimeoutMs: Number($("totalTimeoutMs").value),
        perPlaceTimeoutMs: Number($("perPlaceTimeoutMs").value),
        includeMediaSignals: $("includeMediaSignals").checked,
        allowStagingWrites: $("allowStagingWrites").checked,
        allowPublicPublish: false,
        wikimediaMode: $("wikimediaMode").value,
        wikimediaFetchAllExhaustive: $("wikimediaMode").value === "exhaustive",
        locationTrustMode: $("locationTrustMode").value,
        ...extra,
      };
    }

    function phaseUiLabel(phase) {
      const map = {
        idle: "Idle",
        place_discovery: "Step 1 — Finding place names",
        candidate_selection: "Step 1 — Selecting which places to run",
        place_processing: "Step 2 — Wikimedia Commons (images + previews)",
        staging: "Staging",
        complete: "Complete",
        failed: "Failed",
      };
      return map[phase] || phase || "…";
    }

    function updateRunStatusBanner(run) {
      const phaseEl = $("runStatusPhase");
      const titleEl = $("runStatusTitle");
      const detailEl = $("runStatusDetail");
      const metaEl = $("runStatusMeta");
      if (!phaseEl || !titleEl || !detailEl || !metaEl) return;
      if (!run) {
        phaseEl.textContent = "Ready";
        titleEl.textContent = "No active run.";
        detailEl.textContent = "";
        metaEl.textContent = "";
        return;
      }
      const req = run.request || {};
      const stateLine = [req.stateName, req.stateCode].filter(Boolean).join(" ");
      phaseEl.textContent = phaseUiLabel(run.phase) + (run.status === "running" ? " — in progress" : "");
      if (run.status === "completed" && run.result) {
        titleEl.textContent = "Finished for " + stateLine;
        detailEl.textContent =
          "Places with previews: " +
          run.result.counts.placesWithPreviews +
          " · Previews generated: " +
          run.result.counts.postPreviewsGenerated +
          (" · Wikimedia mode: " + (run.result.wikimediaMode || (run.result.wikimediaFetchAllExhaustive ? "exhaustive" : "balanced")) + ".");
      } else if (run.status === "failed") {
        titleEl.textContent = "Run failed for " + stateLine;
        detailEl.textContent = run.error || "";
      } else if (run.status === "running") {
        titleEl.textContent = "Working on " + stateLine;
        const evs = run.events || [];
        const last = evs[evs.length - 1];
        const tail = last && last.message ? last.message : last ? last.type : "Starting…";
        detailEl.textContent = tail;
        metaEl.textContent =
          "Places cap " +
          (req.maxPlacesToProcess ?? "?") +
          " · Candidates cap " +
          (req.candidateLimit ?? "?") +
          " · Exhaustive " +
          (req.wikimediaMode || (req.wikimediaFetchAllExhaustive !== false ? "exhaustive" : "balanced"));
      } else {
        titleEl.textContent = "Run " + (run.runId || "");
        detailEl.textContent = "";
        metaEl.textContent = "";
      }
    }

    async function fetchHealth() {
      const res = await fetch("/dev/state-content-factory/api/health");
      const data = await res.json();
      $("healthMeta").textContent = data.enabled
        ? "Enabled. Staging writes " + (data.writesAllowed ? "allowed by env" : "blocked by env")
        : "Disabled";
      $("safetyOutput").textContent = JSON.stringify(data, null, 2);
    }

    function pickDirectImageUrl(m) {
      if (!m) return "";
      return String(
        m.thumbnailUrl || m.thumbUrl || m.fullImageUrl || m.imageUrl || m.displayUrl || "",
      ).trim();
    }

    function imgOnErrorHandler() {
      return "console.warn('state_content_factory_image_error', this.src); this.classList.add('scf-broken'); var w=this.nextElementSibling; if(w) w.style.display='block';";
    }

    function renderMediaTile(m) {
      const url = pickDirectImageUrl(m);
      const links = [];
      if (m.commonsUrl)
        links.push(
          '<a href="' + escapeHtml(m.commonsUrl) + '" target="_blank" rel="noopener">Open Commons</a>',
        );
      if (m.sourceUrl)
        links.push(
          '<a href="' + escapeHtml(m.sourceUrl) + '" target="_blank" rel="noopener">Open Source</a>',
        );
      const img = url
        ? '<img src="' +
          escapeHtml(url) +
          '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="' +
          imgOnErrorHandler() +
          '"/><div class="warn" style="display:none">Broken image URL: ' +
          escapeHtml(url) +
          "</div>"
        : '<div class="warn">No direct image URL (thumb/full). Do not use Commons/source page as img src.</div><pre class="mono-raw">' +
          escapeHtml(JSON.stringify(m, null, 2)) +
          "</pre>";
      return (
        '<div class="media-tile">' +
        img +
        "<div>" +
        escapeHtml(m.title || "") +
        "</div><div class='place-meta'>" +
        escapeHtml(m.attributionText || m.creator || "") +
        "</div><div class='place-meta'>" +
        links.join(" · ") +
        "</div></div>"
      );
    }

    function renderCover(c) {
      if (!c || !pickDirectImageUrl(c)) return "";
      const url = pickDirectImageUrl(c);
      return (
        '<div class="place-meta">Cover</div><div class="media-tile">' +
        '<img src="' +
        escapeHtml(url) +
        '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="' +
        imgOnErrorHandler() +
        '"/><div class="warn" style="display:none">Broken cover URL: ' +
        escapeHtml(url) +
        "</div>" +
        "<div>" +
        escapeHtml(c.title || "") +
        "</div></div>"
      );
    }

    function renderPreviewCard(preview) {
      if (previewFilter === "stageable" && preview.qualityStatus !== "stageable") return "";
      const badge =
        preview.qualityStatus === "stageable"
          ? "badge-stageable"
          : preview.qualityStatus === "needs_review"
            ? "badge-review"
            : "badge-rejected";
      const reasons = (preview.rejectReasons || []).concat(preview.ruleFailures || []).filter(Boolean);
      const reasonText = reasons.length ? reasons.map(escapeHtml).join(", ") : "(no reject codes — check Wikimedia status)";
      const warnText = (preview.warnings || []).length ? preview.warnings.map(escapeHtml).join(" · ") : "";
      const media = preview.media || [];
      const grid =
        '<div class="media-grid">' +
        renderCover(preview.cover) +
        media.map(renderMediaTile).join("") +
        "</div>";
      const debug =
        '<details style="margin-top:8px"><summary>Raw preview debug</summary><pre class="mono-raw">' +
        escapeHtml(JSON.stringify(preview.debug || {}, null, 2)) +
        "</pre></details>";
      return (
        '<article class="preview-card"><h4>' +
        escapeHtml(preview.title || "Untitled") +
        '</h4><span class="badge ' +
        badge +
        '">' +
        escapeHtml(preview.qualityStatus) +
        "</span>" +
        '<span class="place-meta"> score=' +
        escapeHtml(String(preview.qualityScore)) +
        " · Wikimedia " +
        escapeHtml(preview.wikimediaStatus || "") +
        "</span>" +
        "<p>" +
        escapeHtml(preview.description || "") +
        "</p>" +
        (preview.descriptionSource
          ? '<p class="place-meta">descriptionSource=' + escapeHtml(preview.descriptionSource) + "</p>"
          : "") +
        (preview.wikimediaSuggestedTitle && preview.wikimediaSuggestedTitle !== preview.title
          ? '<p class="place-meta">Wikimedia suggested title: ' +
            escapeHtml(preview.wikimediaSuggestedTitle) +
            "</p>"
          : "") +
        '<p class="place-meta">Location source: ' +
        escapeHtml(preview.locationSource || "") +
        (preview.locationConfidence ? " · confidence=" + escapeHtml(preview.locationConfidence) : "") +
        "</p>" +
        (preview.locationTrust
          ? '<p class="place-meta">Trust: stagingAllowed=' +
            escapeHtml(String(preview.locationTrust.stagingAllowed)) +
            " · anchor=" +
            escapeHtml(preview.locationTrust.anchorAssetTitle || preview.locationTrust.anchorCandidateId || "") +
            " · postLat/postLng=" +
            escapeHtml(String(preview.locationTrust.postLat ?? "")) +
            "," +
            escapeHtml(String(preview.locationTrust.postLng ?? "")) +
            " · located/nonloc ridealong/excluded/wrongLoc=" +
            escapeHtml(String(preview.locationTrust.locatedAssetCount ?? "")) +
            "/" +
            escapeHtml(String(preview.locationTrust.nonlocatedRidealongCount ?? 0)) +
            "/" +
            escapeHtml(String(preview.locationTrust.excludedUnlocatedCount ?? 0)) +
            "/" +
            escapeHtml(String(preview.locationTrust.wrongLocationExcludedCount ?? 0)) +
            (preview.locationTrust.placeFallbackBlocked
              ? " · <strong>place fallback blocked</strong>"
              : "") +
            "</p>" +
            (preview.locationTrust.trustRejectionCodes && preview.locationTrust.trustRejectionCodes.length
              ? '<p class="warn">Trust reject codes: ' +
                escapeHtml(preview.locationTrust.trustRejectionCodes.join(", ")) +
                "</p>"
              : "") +
            (!preview.locationTrust.stagingAllowed
              ? '<p class="warn">Rejected: no asset-level coordinates for staging. Place fallback is not allowed for staging.</p>'
              : "") +
            ((preview.locationTrust.nonlocatedRidealongCount ?? 0) > 0
              ? '<p class="warn">Some assets have no coordinates but were included because this group has a located anchor and strong place match.</p>'
              : "")
          : "") +
        '<p class="warn"><strong>Gate / reject:</strong> ' +
        reasonText +
        "</p>" +
        (preview.primaryFailure
          ? '<p class="place-meta"><strong>Primary failure:</strong> ' + escapeHtml(preview.primaryFailure) + "</p>"
          : "") +
        (warnText ? '<p class="place-meta"><strong>Warnings:</strong> ' + warnText + "</p>" : "") +
        '<p class="place-meta">mediaCount=' +
        escapeHtml(String(preview.mediaCount)) +
        " · media rows=" +
        escapeHtml(String(media.length)) +
        "</p>" +
        grid +
        debug +
        "</article>"
      );
    }

    function renderPlaceResults(result) {
      if (!result || !result.placeResults) return "";
      return (result.placeResults || [])
        .map((place) => {
          const reason =
            place.postPreviewsGenerated === 0
              ? '<p class="warn">No previews: ' +
                escapeHtml(place.status) +
                (place.failureReason ? " (" + escapeHtml(place.failureReason) + ")" : "") +
                "</p>"
              : "";
          const previews = (place.previews || []).map(renderPreviewCard).join("");
          return (
            '<article class="place-card"><h3>' +
            escapeHtml(place.placeName) +
            '</h3><div class="place-meta">queue=' +
            escapeHtml(place.priorityQueue || "n/a") +
            " status=" +
            escapeHtml(place.status) +
            " elapsedMs=" +
            escapeHtml(String(place.elapsedMs)) +
            '</div><div class="place-meta">assets found/hydrated/accepted/rejected/grouped=' +
            place.mediaAssetsFound +
            "/" +
            (place.mediaAssetsHydrated ?? "?") +
            "/" +
            (place.mediaAssetsAcceptedForPipeline ?? place.mediaAssetsKept) +
            "/" +
            place.mediaAssetsRejected +
            "/" +
            (place.mediaAssetsGroupedIntoPreviews ?? "?") +
            " (strict KEEP " +
            (place.mediaAssetsStrictKeep ?? "?") +
            ")" +
            " groups built/rejected=" +
            place.groupsBuilt +
            "/" +
            place.groupsRejected +
            '</div><div class="place-meta">located found / valid in stageable / ridealongs / excluded unloc / wrong-loc excluded=' +
            (place.locatedAssetsFound ?? "?") +
            "/" +
            (place.validLocatedAssetsInStageablePreviews ?? "?") +
            "/" +
            (place.nonlocatedRidealongAssetsIncluded ?? 0) +
            "/" +
            (place.excludedUnlocatedAssets ?? 0) +
            "/" +
            (place.wrongLocationAssetsExcluded ?? 0) +
            '</div><div class="place-meta">previews: gen / stageable / rejected / wouldStage(=stageable) / location_unverified=' +
            place.postPreviewsGenerated +
            "/" +
            place.stageablePostPreviews +
            "/" +
            place.postPreviewsRejected +
            "/" +
            (place.wouldStage ?? place.stageablePostPreviews) +
            "/" +
            (place.postPreviewsLocationUnverified ?? place.needsReviewPostPreviews ?? 0) +
            "</div>" +
            (place.commonsQueryStats && place.commonsQueryStats.length
              ? '<details style="margin:8px 0"><summary>Commons query stats</summary><pre class="mono-raw">' +
                escapeHtml(JSON.stringify(place.commonsQueryStats, null, 2)) +
                "</pre></details>"
              : "") +
            (place.topAssetRejectReasons && place.topAssetRejectReasons.length
              ? '<details style="margin:8px 0"><summary>Top asset reject reasons</summary><pre class="mono-raw">' +
                escapeHtml(JSON.stringify(place.topAssetRejectReasons, null, 2)) +
                "</pre></details>"
              : "") +
            (place.sampleRejectedAssets && place.sampleRejectedAssets.length
              ? '<details style="margin:8px 0"><summary>Sample rejected assets</summary><pre class="mono-raw">' +
                escapeHtml(JSON.stringify(place.sampleRejectedAssets, null, 2)) +
                "</pre></details>"
              : "") +
            reason +
            previews +
            "</article>"
          );
        })
        .join("");
    }

    function renderSummaryStats(run) {
      const result = run.result;
      if (!result) return;
      $("fullSummary").innerHTML = [
        ["Phase", run.phase],
        ["State", (result.stateName || "") + (result.stateCode ? " (" + result.stateCode + ")" : "")],
        ["Wikimedia", (result.wikimediaMode || (result.wikimediaFetchAllExhaustive ? "exhaustive" : "balanced")) + (result.wikimediaFetchAllExhaustive ? " (fetch all)" : "")],
        ["Entrypoint", result.usingPostGenerationEntrypoint || "unknown"],
        ["Quality preview mode", result.qualityPreviewMode || "unknown"],
        ["Selected places", result.counts.selectedPlaces],
        ["Places processed", result.counts.placesProcessed],
        ["Places with previews", result.counts.placesWithPreviews],
        ["Places with no media", result.counts.placesWithNoMedia],
        ["Places with no previews", result.counts.placesWithNoPostPreviews],
        ["Places failed", result.counts.placesFailed],
        ["Previews generated", result.counts.postPreviewsGenerated],
        ["Stageable", result.counts.postPreviewsStageable],
        ["Needs review", result.counts.postPreviewsNeedsReview],
        ["Would stage (= stageable only)", result.counts.wouldStageForReviewPosts ?? result.counts.wouldStagePosts],
        ["Would auto-approve (= stageable)", result.counts.wouldAutoApprovePosts ?? result.counts.postPreviewsStageable],
        ["Staged", result.counts.stagedPostsCreated],
        ["Public posts", result.publicPostsWritten],
        ["Firestore reads", result.budget.firestoreReads],
        ["Firestore writes", result.budget.firestoreWrites],
      ]
        .map(([k, v]) => '<div class="card"><strong>' + k + '</strong><div>' + escapeHtml(String(v)) + "</div></div>")
        .join("");
      const pct = result.counts.selectedPlaces
        ? Math.min(100, Math.round((result.counts.placesProcessed / result.counts.selectedPlaces) * 100))
        : 0;
      $("progressBar").style.width = pct + "%";
      updateRunStatusBanner(run);
    }

    function refreshPreviewRender() {
      const run = window.__scfLastRun;
      if (!run || !run.result) return;
      const html = renderPlaceResults(run.result);
      if (activeRunOutput === "post") {
        $("postOutput").innerHTML = html;
      } else if (activeRunOutput === "full") {
        $("placeResults").innerHTML = html;
      }
    }

    document.querySelectorAll('input[name="previewFilter"]').forEach((el) => {
      el.addEventListener("change", () => {
        previewFilter = el.value;
        refreshPreviewRender();
      });
    });

    async function pollLogs() {
      if (!activeRunId) return;
      const res = await fetch("/dev/state-content-factory/api/run/" + activeRunId + "/logs?since=0");
      const data = await res.json();
      $("fullLogs").textContent = (data.logs || []).join(String.fromCharCode(10));
      const runRes = await fetch("/dev/state-content-factory/api/run/" + activeRunId);
      const run = await runRes.json();
      window.__scfLastRun = run;
      updateRunStatusBanner(run);
      if (activeRunOutput === "place") {
        $("placeOutput").textContent = JSON.stringify(run, null, 2);
      } else if (activeRunOutput === "post") {
        if (run.result) {
          $("postOutput").innerHTML = renderPlaceResults(run.result);
          $("postRawJson").textContent = JSON.stringify(run, null, 2);
        } else if (run.status === "failed") {
          $("postOutput").innerHTML =
            "<p class='warn'><strong>Run failed.</strong> " + escapeHtml(run.error || "unknown error") + "</p>";
          $("postRawJson").textContent = JSON.stringify(run, null, 2);
        } else {
          $("postOutput").innerHTML = "<p class='place-meta'>Running… Wikimedia pipeline in progress.</p>";
        }
      } else if (run.result) {
        renderSummaryStats(run);
        $("placeResults").innerHTML = renderPlaceResults(run.result);
      }
      if (run.status === "completed" || run.status === "failed") {
        clearInterval(logTimer);
        logTimer = null;
        if (eventSource) eventSource.close();
      }
    }

    async function startRun(path, outputId, extra = {}) {
      if (path.indexOf("post-test") >= 0) activeRunOutput = "post";
      else if (path.indexOf("place-test") >= 0) activeRunOutput = "place";
      else activeRunOutput = "full";
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload(extra)),
      });
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        data = { ok: false, error: "invalid_json", raw };
      }
      if (!res.ok || data.ok === false) {
        const msg = data.error || data.message || raw.slice(0, 800);
        if (outputId === "placeOutput") $("placeOutput").textContent = "Request failed (" + res.status + "): " + msg;
        if (outputId === "postOutput") {
          $("postOutput").innerHTML = "<p class='warn'>Request failed (" + res.status + ")</p>";
          $("postRawJson").textContent = String(msg);
        }
        return;
      }
      if (outputId === "placeOutput") $(outputId).textContent = JSON.stringify(data, null, 2);
      if (outputId === "postOutput") {
        $("postOutput").innerHTML = "<p class='place-meta'>Run started… polling</p>";
        $("postRawJson").textContent = JSON.stringify(data, null, 2);
      }
      activeRunId = data.runId;
      updateRunStatusBanner({
        status: "running",
        phase: "place_discovery",
        request: bodyPayload(extra),
        events: [],
        runId: data.runId,
      });
      if (eventSource) eventSource.close();
      eventSource = new EventSource("/dev/state-content-factory/api/run/" + activeRunId + "/events?since=0");
      eventSource.onmessage = () => pollLogs();
      if (logTimer) clearInterval(logTimer);
      logTimer = setInterval(pollLogs, 500);
      pollLogs();
    }

    $("startFullBtn").addEventListener("click", () => startRun("/dev/state-content-factory/api/start"));
    $("startPlaceBtn").addEventListener("click", () => startRun("/dev/state-content-factory/api/place-test", "placeOutput"));
    $("startPostBtn").addEventListener("click", () => {
      const latRaw = $("postPlaceLat").value.trim();
      const lngRaw = $("postPlaceLng").value.trim();
      const extra = { place: $("postPlace").value.trim() };
      if (latRaw) extra.postTestLatitude = Number(latRaw);
      if (lngRaw) extra.postTestLongitude = Number(lngRaw);
      startRun("/dev/state-content-factory/api/post-test", "postOutput", extra);
    });
    $("refreshRunsBtn").addEventListener("click", async () => {
      const res = await fetch("/dev/state-content-factory/api/runs");
      $("runsOutput").textContent = JSON.stringify(await res.json(), null, 2);
    });
    $("refreshStagedBtn").addEventListener("click", async () => {
      const res = await fetch("/dev/state-content-factory/api/staged-posts");
      $("stagedOutput").textContent = JSON.stringify(await res.json(), null, 2);
    });

    fetchHealth();
  </script>
</body>
</html>`;
}
