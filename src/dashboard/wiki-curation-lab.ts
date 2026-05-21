/**
 * Self-contained HTML UI for wiki spot curation (runs → spots → dry-review SSE → optional apply).
 * Served at GET /admin/wiki-curation on Backend V2 (same origin as /admin/wiki-curation/* APIs).
 */
export function renderWikiCurationLabPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Wiki spot curation — Backend V2</title>
    <style>
      body { font-family: Inter, Arial, sans-serif; margin: 20px; background: #0f172a; color: #e2e8f0; }
      a { color: #93c5fd; text-decoration: none; }
      h1 { margin: 0 0 8px 0; font-size: 22px; }
      h2 { margin: 0 0 8px 0; font-size: 15px; color: #cbd5e1; }
      .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
      .panel { border: 1px solid #334155; border-radius: 10px; padding: 12px; background: #111827; margin-bottom: 14px; }
      input, select, textarea { background: #1f2937; border: 1px solid #334155; color: #fff; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
      input[type="text"], input[type="password"] { min-width: 200px; }
      textarea { width: 100%; min-height: 120px; font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
      button { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: 13px; }
      button.secondary { background: #334155; }
      button.danger { background: #b91c1c; }
      button:disabled { opacity: 0.45; cursor: not-allowed; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
      th, td { border-top: 1px solid #334155; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { color: #94a3b8; font-weight: 600; }
      tr.runRow { cursor: pointer; }
      tr.runRow:hover { background: #1e293b; }
      tr.runRow.selected { background: #1e3a8a; }
      tr.spotRow { cursor: pointer; }
      tr.spotRow:hover { background: #1e293b; }
      tr.spotRow.selected { background: #14532d; }
      code { font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: #e2e8f0; }
      pre { white-space: pre-wrap; word-break: break-word; background: #020617; padding: 10px; border-radius: 8px; max-height: 280px; overflow: auto; font-size: 11px; margin: 8px 0 0; }
      .muted { opacity: 0.8; font-size: 12px; }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #0b1220; border: 1px solid #334155; margin-right: 6px; color: #cbd5e1; font-size: 11px; }
      #dryReviewVisual { margin-top: 14px; border: 1px solid #0ea5e9; border-radius: 10px; padding: 12px; background: #0b1220; max-height: 72vh; overflow: auto; }
      .dry-sec-title { font-size: 14px; font-weight: 700; margin: 14px 0 8px; color: #7dd3fc; }
      .dry-card { border-radius: 10px; padding: 10px; margin-bottom: 12px; border: 2px solid #334155; background: #111827; }
      .dry-card.publish { border-color: #22c55e; background: #0f172a; }
      .dry-card.skip { border-color: #64748b; }
      .dry-card.needs { border-color: #eab308; }
      .dry-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
      .dry-carousel { flex: 0 0 auto; max-width: 280px; width: 100%; }
      .dry-carousel-slides { position: relative; height: 168px; background: #020617; border-radius: 8px; overflow: hidden; border: 1px solid #334155; }
      .dry-carousel-slides img { width: 100%; height: 168px; object-fit: cover; display: none; }
      .dry-carousel-slides img.dry-slide-active { display: block; }
      .dry-carousel-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; gap: 8px; flex-wrap: wrap; }
      .dry-meta { font-size: 11px; color: #94a3b8; margin-bottom: 6px; }
      .dry-k { font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; margin-top: 6px; }
      .dry-v { font-size: 12px; color: #e2e8f0; line-height: 1.4; }
      #aiUsagePanel { margin-top: 16px; border: 1px solid #475569; border-radius: 10px; padding: 12px; background: #020617; font-size: 12px; }
    </style>
  </head>
  <body>
    <section class="panel" style="border-color:#2563eb; margin-bottom:14px;">
      <h2 style="margin:0 0 8px; color:#93c5fd;">Gemini API key (required)</h2>
      <p class="muted" style="margin:0 0 8px;">
        Paste your Google AI Studio key. <strong>Dry review</strong> sends it only as <code>x-wiki-curation-gemini-api-key</code>.
        The server does <strong>not</strong> use <code>GEMINI_API_KEY</code> from <code>.env</code> for Gemini.
      </p>
      <input id="geminiKeyManual" type="password" autocomplete="off" placeholder="AIza…" style="width:100%; max-width:720px; box-sizing:border-box; font-family:monospace; font-size:13px;" />
      <div class="row" style="margin-top:10px;">
        <button type="button" class="secondary" id="btnSaveManualGemini">Save in browser (localStorage)</button>
        <button type="button" class="secondary" id="btnClearManualGemini">Clear</button>
      </div>
      <div id="manualKeySaveStatus" class="muted" style="margin-top:6px; min-height:16px;"></div>
    </section>

    <section class="panel" id="geminiKeyTopPanel" style="border-color:#854d0e; margin-bottom:14px;">
      <h2 style="color:#fcd34d; margin:0 0 8px;">Gemini + .env (FYI)</h2>
      <p class="muted" style="margin:0 0 8px;">
        Dry review ignores <code>GEMINI_API_KEY</code> in process env for the Google API call. The JSON below is only for debugging file paths / stray env values.
      </p>
      <pre id="geminiKeyPlain" style="max-height:none; font-size:13px; word-break:break-all; margin:0;">Loading…</pre>
    </section>

    <div class="row">
      <h1>Wiki spot curation</h1>
      <span class="muted">Runs / spots / AI dry review (Gemini) — same server as <code>/admin/wiki-curation/*</code> JSON</span>
    </div>
    <div class="row muted">
      <a href="/admin">← Admin home</a>
      <span class="pill">No Locava Web required</span>
      <span class="pill">Dry-run only until you apply with secret</span>
    </div>

    <section class="panel">
      <h2>Gemini key (diagnostics)</h2>
      <p class="muted" style="margin:0 0 8px;">
        <code>GET /admin/wiki-curation/gemini-env</code> — process env / file paths only (not the key used for dry review).
      </p>
      <div class="row">
        <button type="button" id="btnGeminiEnv">GET /admin/wiki-curation/gemini-env</button>
      </div>
      <pre id="geminiEnvOut" style="max-height: 200px;"></pre>
    </section>

    <section class="panel">
      <h2>1. Runs</h2>
      <div class="row">
        <label>Limit <input id="runLimit" type="number" value="80" min="1" max="100" style="width:72px" /></label>
        <label>Filter <input id="runFilter" type="text" placeholder="state id substring…" /></label>
        <button type="button" id="btnRefreshRuns">Refresh runs</button>
      </div>
      <div id="runsStatus" class="muted"></div>
      <div style="overflow:auto; max-height: 320px;">
        <table>
          <thead>
            <tr>
              <th>stageRunId</th>
              <th>state</th>
              <th>places</th>
              <th>posts</th>
              <th>images</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody id="runsBody"></tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>2. Spots (selected run)</h2>
      <div class="row">
        <span>Run: <code id="selRunLabel">—</code></span>
        <button type="button" id="btnLoadSpots" disabled>Load / refresh spots (first page)</button>
        <button type="button" class="secondary" id="btnMoreSpots" disabled>More spots</button>
        <span id="spotsMeta" class="muted"></span>
      </div>
      <div style="overflow:auto; max-height: 260px;">
        <table>
          <thead>
            <tr><th>spotId</th><th>place</th><th>lat</th><th>lng</th></tr>
          </thead>
          <tbody id="spotsBody"></tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>3. Candidates &amp; dry review</h2>
      <p class="muted" style="margin:0 0 8px;">
        After a successful dry review, scroll below the JSON — <strong>visual summary</strong> shows selected vs skipped posts with photo carousel (uses the same candidate payload as &quot;Load candidates&quot;).
      </p>
      <div class="row" style="align-items:flex-start;">
        <label>maxCorePostsPerSpot <input id="maxCore" type="number" value="5" min="0" max="30" style="width:64px" /></label>
        <label>maxContextPostsPerSpot <input id="maxContext" type="number" value="3" min="0" max="30" style="width:64px" /></label>
        <label>maxTotalPostsPerSpot <input id="maxTotal" type="number" value="8" min="0" max="40" style="width:64px" /></label>
        <label>maxImagesPerCandidate <input id="maxImages" type="number" value="3" min="0" max="12" style="width:64px" /></label>
      </div>
      <div class="row" style="margin-top:6px;">
        <label><input type="checkbox" id="chkAllowContext" checked /> Allow contextual / far-but-relevant</label>
        <label style="margin-left:12px;"><input type="checkbox" id="chkRejectPlane" checked /> Reject plane views</label>
      </div>
      <div class="row muted" style="font-size:11px;margin-top:4px;">
        <label>coreRadius m <input id="coreRadiusM" type="number" value="1000" min="100" style="width:80px" /></label>
        <label>nearbyRadius m <input id="nearbyRadiusM" type="number" value="3000" min="100" style="width:80px" /></label>
        <label>extendedContext m <input id="extendedRadiusM" type="number" value="20000" min="500" style="width:88px" /></label>
      </div>
      <div class="row" style="margin-top:8px;">
        <span>Spot: <code id="selSpotLabel">—</code></span>
        <button type="button" id="btnLoadPosts" disabled>Load candidates</button>
        <button type="button" id="btnDry" disabled>Dry review</button>
      </div>
      <div id="postsMeta" class="muted"></div>
      <pre id="postsPreview" style="display:none; max-height: 180px;"></pre>
      <div class="row"><span class="muted">SSE log</span></div>
      <pre id="dryLog"></pre>
      <div class="row"><span class="muted">Job result (curator JSON)</span></div>
      <pre id="dryResult"></pre>
      <div id="dryReviewVisual" style="display:none;"></div>
      <div id="aiUsagePanel" style="display:none;"></div>
    </section>

    <section class="panel">
      <h2>4. Apply to staging (optional)</h2>
      <p class="muted" style="margin:0 0 8px;">Writes <code>aiCuration</code> on staged spot posts. Server must have <code>WIKI_CURATION_APPLY_WRITES_ENABLED=true</code> and matching <code>x-wiki-curation-apply-secret</code>.</p>
      <div class="row">
        <label>Apply secret <input id="applySecret" type="password" autocomplete="off" placeholder="from WIKI_CURATION_APPLY_SECRET" style="min-width:280px" /></label>
        <button type="button" class="danger" id="btnApply" disabled>Apply last result</button>
      </div>
      <pre id="applyOut"></pre>
    </section>

    <script>
(function () {
  const API = '/admin/wiki-curation';
  let selectedRunId = '';
  let selectedSpotId = '';
  let spotsCursor = null;
  let spotsHasMore = false;
  let allSpots = [];
  let lastCuratorResult = null;
  /** Last successful GET .../posts payload for the selected spot (used to show photos in dry-review visual). */
  let lastPostsPayload = null;

  const KEY_STORAGE = 'wikiCurationManualGeminiKey';

  function $(id) { return document.getElementById(id); }

  function manualGeminiHeaders() {
    var el = $('geminiKeyManual');
    var v = el && el.value ? String(el.value).trim() : '';
    if (!v.length) return {};
    return { 'x-wiki-curation-gemini-api-key': v };
  }

  function restoreManualGeminiKey() {
    try {
      var s = localStorage.getItem(KEY_STORAGE);
      if (s && $('geminiKeyManual')) $('geminiKeyManual').value = s;
    } catch (e) {}
  }

  function unwrap(body) {
    if (body && body.ok === true && body.data !== undefined) return body.data;
    return body;
  }

  async function getJson(path) {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(function () { return {}; });
    return { status: res.status, body };
  }

  async function postJson(path, payload, extraHeaders) {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (extraHeaders) { for (var k in extraHeaders) { if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) h[k] = extraHeaders[k]; } }
    const res = await fetch(path, { method: 'POST', headers: h, body: JSON.stringify(payload) });
    const body = await res.json().catch(function () { return {}; });
    return { status: res.status, body };
  }

  function setRunsStatus(t) { $('runsStatus').textContent = t || ''; }
  function setSpotsMeta(t) { $('spotsMeta').textContent = t || ''; }
  function setPostsMeta(t) { $('postsMeta').textContent = t || ''; }

  function renderRuns(rows) {
    var tb = $('runsBody');
    tb.innerHTML = '';
    var q = ($('runFilter').value || '').trim().toLowerCase();
    rows.filter(function (r) {
      if (!q) return true;
      var id = String(r.stageRunId || '').toLowerCase();
      var st = String(r.stateCode || '').toLowerCase();
      return id.indexOf(q) >= 0 || st.indexOf(q) >= 0;
    }).forEach(function (r) {
      var tr = document.createElement('tr');
      tr.className = 'runRow' + (String(r.stageRunId) === selectedRunId ? ' selected' : '');
      tr.onclick = function () {
        selectedRunId = String(r.stageRunId || '');
        selectedSpotId = '';
        allSpots = [];
        spotsCursor = null;
        spotsHasMore = false;
        lastCuratorResult = null;
        lastPostsPayload = null;
        $('selRunLabel').textContent = selectedRunId || '—';
        $('selSpotLabel').textContent = '—';
        $('spotsBody').innerHTML = '';
        $('dryLog').textContent = '';
        $('dryResult').textContent = '';
        var drv = $('dryReviewVisual');
        if (drv) { drv.innerHTML = ''; drv.style.display = 'none'; }
        var aiu0 = $('aiUsagePanel');
        if (aiu0) { aiu0.innerHTML = ''; aiu0.style.display = 'none'; }
        $('postsPreview').style.display = 'none';
        $('postsPreview').textContent = '';
        $('btnLoadSpots').disabled = !selectedRunId;
        $('btnMoreSpots').disabled = true;
        $('btnLoadPosts').disabled = true;
        $('btnDry').disabled = true;
        $('btnApply').disabled = true;
        renderRuns(rows);
        setSpotsMeta('');
      };
      tr.innerHTML =
        '<td><code>' + escapeHtml(r.stageRunId) + '</code></td>' +
        '<td>' + escapeHtml(r.stateCode || '') + '</td>' +
        '<td>' + escapeHtml(String(r.placeCount)) + '</td>' +
        '<td>' + escapeHtml(String(r.postCount)) + '</td>' +
        '<td>' + escapeHtml(String(r.imageCount)) + '</td>' +
        '<td>' + escapeHtml(String(r.status || '')) + '</td>';
      tb.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attrEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function mediaThumbUrl(m) {
    var u = (m && (m.thumbnailUrl || m.imageUrl)) || '';
    return String(u).trim();
  }

  function htmlCarouselForPost(post) {
    var media = (post && post.media) || [];
    var urls = [];
    for (var i = 0; i < media.length; i++) {
      var u = mediaThumbUrl(media[i]);
      if (u.indexOf('https://') === 0 || u.indexOf('http://') === 0) urls.push(u);
    }
    if (!urls.length) {
      return '<div class="muted" style="padding:24px;text-align:center;border:1px dashed #334155;border-radius:8px;">No image URLs on candidate</div>';
    }
    var h = '<div class="dry-carousel" data-idx="0"><div class="dry-carousel-slides">';
    for (var j = 0; j < urls.length; j++) {
      h +=
        '<img class="dry-slide' +
        (j === 0 ? ' dry-slide-active' : '') +
        '" data-j="' +
        j +
        '" src="' +
        attrEscape(urls[j]) +
        '" alt="" />';
    }
    h +=
      '</div><div class="dry-carousel-bar"><button type="button" class="secondary dry-carousel-prev">‹ Prev</button><span class="dry-carousel-label muted">' +
      '1 / ' +
      urls.length +
      '</span><button type="button" class="secondary dry-carousel-next">Next ›</button></div></div>';
    return h;
  }

  function htmlUl(items, color) {
    if (!items || !items.length) return '';
    var h = '<ul style="margin:4px 0 0 16px;padding:0;font-size:11px;color:' + color + ';">';
    items.forEach(function (x) {
      h += '<li>' + escapeHtml(String(x)) + '</li>';
    });
    h += '</ul>';
    return h;
  }

  function fmtMiles(m) {
    if (m == null || m === '') return '—';
    var n = Number(m);
    if (!isFinite(n)) return '—';
    return (n / 1609.34).toFixed(1) + ' mi';
  }

  function htmlDecisionCard(cd, post, variant, warnPatterns) {
    var cls = 'dry-card ' + (variant === 'publish' ? 'publish' : variant === 'needs_review' ? 'needs' : 'skip');
    var cap =
      warnPatterns && warnPatterns.length
        ? '<div style="margin-top:8px;padding:6px 8px;border-radius:8px;background:#422006;border:1px solid #ca8a04;color:#fde68a;font-size:11px;"><strong>Caption style hint:</strong> ' +
          escapeHtml(warnPatterns.join(', ')) +
          '</div>'
        : '';
    var origTitle = post && post.title != null ? String(post.title) : '';
    var origCap = post && post.caption != null ? String(post.caption) : '';
    var vm = cd.visualMagnetScore != null ? String(cd.visualMagnetScore) : '—';
    var curWarn =
      cd.curationWarnings && cd.curationWarnings.length
        ? '<div style="margin-top:8px;padding:6px 8px;border-radius:8px;background:#3f1d1d;border:1px solid #f87171;color:#fecaca;font-size:11px;"><strong>Warnings:</strong> ' +
          escapeHtml(cd.curationWarnings.join(' · ')) +
          '</div>'
        : '';
    return (
      '<div class="' +
      cls +
      '"><div class="dry-row">' +
      htmlCarouselForPost(post) +
      '<div style="flex:1;min-width:220px;"><div class="dry-meta"><strong style="color:#cbd5e1">' +
      escapeHtml(String(cd.decision || '')).toUpperCase() +
      '</strong> · tier ' +
      escapeHtml(String(cd.moderatorTier)) +
      ' · rank ' +
      escapeHtml(String(cd.finalRankForSpot)) +
      ' · visit ' +
      escapeHtml(String(cd.visitWorthyScore)) +
      ' · visual ' +
      escapeHtml(String(cd.visualAppealScore)) +
      ' · magnet ' +
      escapeHtml(vm) +
      ' · inFinalSet ' +
      escapeHtml(String(cd.shouldUseInFinalSpotSet)) +
      '</div>' +
      '<div class="dry-k">View / location / distance / lane</div><div class="dry-v">' +
      escapeHtml(String(cd.viewType || 'unknown')) +
      ' · ' +
      escapeHtml(String(cd.locationRelation || '—')) +
      ' · ' +
      fmtMiles(cd.distanceMetersFromAnchor) +
      ' · lane ' +
      escapeHtml(String(cd.selectionLane || '—')) +
      ' · countsVsCoreMax ' +
      escapeHtml(String(cd.countsAgainstCoreMax != null ? cd.countsAgainstCoreMax : '—')) +
      '</div><div class="dry-k">postId</div><div class="dry-v"><code>' +
      escapeHtml(cd.postId) +
      '</code></div><div class="dry-k">Original title</div><div class="dry-v">' +
      escapeHtml(origTitle || '—') +
      '</div><div class="dry-k">Refined title</div><div class="dry-v" style="font-weight:700">' +
      escapeHtml(cd.refinedTitle || '') +
      '</div><div class="dry-k">Original caption</div><div class="dry-v">' +
      escapeHtml(origCap || '—') +
      '</div><div class="dry-k">Refined caption</div><div class="dry-v">' +
      escapeHtml(cd.refinedCaption || '') +
      '</div>' +
      cap +
      curWarn +
      '<div class="dry-k">Reasons</div>' +
      htmlUl(cd.reasons, '#cbd5e1') +
      '<div class="dry-k">Concerns</div>' +
      htmlUl(cd.concerns, '#fbbf24') +
      '<div class="dry-k">Image notes</div>' +
      htmlUl(cd.imageNotes, '#94a3b8') +
      '</div></div></div>'
    );
  }

  function sortByRankThenId(a, b) {
    var ra = Number(a.finalRankForSpot) || 0;
    var rb = Number(b.finalRankForSpot) || 0;
    if (ra !== rb) return ra - rb;
    return String(a.postId).localeCompare(String(b.postId));
  }

  function renderAiUsagePanel() {
    var el = $('aiUsagePanel');
    if (!el) return;
    if (!lastCuratorResult || !lastCuratorResult.usage) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    var u = lastCuratorResult.usage;
    var lines = [];
    lines.push('<h3 style="margin:0 0 8px;font-size:14px;color:#93c5fd;">AI usage</h3>');
    lines.push('<div><strong>Model</strong> ' + escapeHtml(String(u.model || '')) + '</div>');
    lines.push('<div><strong>Candidates</strong> ' + escapeHtml(String(u.candidateCount)) + ' · <strong>Images sent</strong> ' + escapeHtml(String(u.imageCount)) + '</div>');
    if (u.maxImagesPerCandidate != null) {
      lines.push('<div><strong>maxImagesPerCandidate</strong> ' + escapeHtml(String(u.maxImagesPerCandidate)) + '</div>');
    }
    if (u.estimatedInputTokens != null) {
      lines.push('<div><strong>Est. input tokens</strong> ' + escapeHtml(String(u.estimatedInputTokens)) + '</div>');
    }
    lines.push(
      '<div><strong>Prompt tokens</strong> ' + escapeHtml(u.promptTokenCount != null ? String(u.promptTokenCount) : '—') + '</div>'
    );
    lines.push(
      '<div><strong>Output tokens</strong> (candidates) ' + escapeHtml(u.candidatesTokenCount != null ? String(u.candidatesTokenCount) : '—') + '</div>'
    );
    lines.push('<div><strong>Total tokens</strong> ' + escapeHtml(u.totalTokenCount != null ? String(u.totalTokenCount) : '—') + '</div>');
    lines.push(
      '<div><strong>Est. cost USD</strong> ' +
        escapeHtml(u.estimatedCostUsd != null ? String(u.estimatedCostUsd) : '—') +
        ' · <strong>pricing</strong> ' +
        escapeHtml(String(u.pricingSource || '—')) +
        '</div>'
    );
    lines.push('<div><strong>Fresh AI call</strong> ' + escapeHtml(u.freshCall ? 'yes' : 'no') + '</div>');
    el.innerHTML = '<div>' + lines.join('') + '</div>';
    el.style.display = 'block';
  }

  function renderDryReviewVisual() {
    var el = $('dryReviewVisual');
    if (!el) return;
    if (!lastCuratorResult || typeof lastCuratorResult !== 'object') {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    var decs = lastCuratorResult.decisions || [];
    if (!decs.length) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = 'block';
    var warnMap = {};
    var hints = lastCuratorResult.dryReviewHints;
    if (hints && Array.isArray(hints.captionStyleWarnings)) {
      hints.captionStyleWarnings.forEach(function (w) {
        if (w && w.postId && w.patternsMatched) warnMap[w.postId] = w.patternsMatched;
      });
    }
    var postsById = {};
    var payloadOk =
      lastPostsPayload &&
      String(lastPostsPayload.spotId || '') === String(selectedSpotId) &&
      Array.isArray(lastPostsPayload.posts);
    if (payloadOk) {
      lastPostsPayload.posts.forEach(function (p) {
        postsById[p.postId] = p;
      });
    }
    var pub = decs
      .filter(function (d) {
        return d.decision === 'publish';
      })
      .sort(sortByRankThenId);
    var sk = decs
      .filter(function (d) {
        return d.decision === 'skip';
      })
      .sort(sortByRankThenId);
    var nr = decs
      .filter(function (d) {
        return d.decision === 'needs_review';
      })
      .sort(sortByRankThenId);
    var html = '';
    if (!payloadOk) {
      html +=
        '<p class="muted" style="margin:0 0 12px;color:#fbbf24;border:1px solid #854d0e;padding:8px;border-radius:8px;background:#422006;">Load <strong>candidates</strong> for this spot (button above) so photos and original titles match. Cards still show AI fields; images may be missing.</p>';
    }
    var sum = lastCuratorResult.summary || {};
    var opt = lastCuratorResult.curationOptions || {};
    html +=
      '<div style="margin-bottom:12px;padding:10px;border-radius:8px;background:#0c4a6e;border:1px solid #0ea5e9;color:#e0f2fe;font-size:12px;"><strong>Summary</strong> · candidates ' +
      escapeHtml(String(sum.candidateCount)) +
      ' · selected total ' +
      escapeHtml(String(sum.recommendedPublishCount)) +
      ' (core ' +
      escapeHtml(String(sum.recommendedPublishCoreCount != null ? sum.recommendedPublishCoreCount : '—')) +
      ' · context ' +
      escapeHtml(String(sum.recommendedPublishContextCount != null ? sum.recommendedPublishContextCount : '—')) +
      ') · skipped ' +
      escapeHtml(String(sum.recommendedSkipCount)) +
      ' · needs review ' +
      escapeHtml(String(sum.recommendedNeedsReviewCount)) +
      ' · maxCore ' +
      escapeHtml(String(opt.maxCorePostsPerSpot != null ? opt.maxCorePostsPerSpot : sum.maxCorePostsPerSpot || '—')) +
      ' · maxContext ' +
      escapeHtml(String(opt.maxContextPostsPerSpot != null ? opt.maxContextPostsPerSpot : sum.maxContextPostsPerSpot || '—')) +
      ' · maxTotal ' +
      escapeHtml(String(opt.maxTotalPostsPerSpot != null ? opt.maxTotalPostsPerSpot : sum.maxTotalPostsPerSpot || lastCuratorResult.maxPostsForSpot || '—')) +
      '</div>';
    if (sum.overallReasoning) {
      html +=
        '<div style="margin-bottom:12px;padding:10px;border-radius:8px;background:#0b2550;border:1px solid #1d4ed8;color:#dbeafe;font-size:12px;"><strong>Model summary</strong><div class="muted" style="margin-top:8px;color:#bae6fd;line-height:1.45;">' +
        escapeHtml(sum.overallReasoning) +
        '</div></div>';
    }
    if (hints && hints.decisionInspectionWarnings && hints.decisionInspectionWarnings.length) {
      html +=
        '<div style="margin-bottom:10px;padding:8px;border-radius:8px;background:#3f1d1d;border:1px solid #f87171;color:#fecaca;font-size:12px;"><strong>Inspection warnings</strong><ul style="margin:6px 0 0 18px;padding:0;">';
      hints.decisionInspectionWarnings.forEach(function (w) {
        if (!w || !w.message) return;
        html += '<li><code>' + escapeHtml(String(w.postId || '')) + '</code> — ' + escapeHtml(w.message) + '</li>';
      });
      html += '</ul></div>';
    }
    if (hints && hints.captionStyleWarnings && hints.captionStyleWarnings.length) {
      html +=
        '<div style="margin-bottom:10px;padding:8px;border-radius:8px;background:#422006;border:1px solid #ca8a04;color:#fde68a;font-size:12px;">Some <strong>refinedCaption</strong> lines matched brochure-style filler — see yellow hints on cards.</div>';
    }
    function sec(title, list, variant) {
      if (!list.length) return '';
      var out = '<h3 class="dry-sec-title">' + escapeHtml(title) + ' (' + list.length + ')</h3>';
      list.forEach(function (cd) {
        var post = postsById[cd.postId] || null;
        out += htmlDecisionCard(cd, post, variant, warnMap[cd.postId]);
      });
      return out;
    }
    html += sec('Selected (publish)', pub, 'publish');
    html += sec('Needs review', nr, 'needs_review');
    html += sec('Rejected / skipped', sk, 'skip');
    el.innerHTML = html;
  }

  if (!window.__wikiCurationDryCar) {
    window.__wikiCurationDryCar = true;
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var prev = t.closest('.dry-carousel-prev');
      var next = t.closest('.dry-carousel-next');
      if (!prev && !next) return;
      var car = (prev || next).closest('.dry-carousel');
      if (!car) return;
      var slides = car.querySelectorAll('img.dry-slide');
      var n = slides.length;
      if (n <= 1) return;
      var idx = parseInt(car.getAttribute('data-idx') || '0', 10) || 0;
      if (prev) idx = (idx - 1 + n) % n;
      else idx = (idx + 1) % n;
      car.setAttribute('data-idx', String(idx));
      for (var i = 0; i < slides.length; i++) {
        if (i === idx) slides[i].classList.add('dry-slide-active');
        else slides[i].classList.remove('dry-slide-active');
      }
      var lab = car.querySelector('.dry-carousel-label');
      if (lab) lab.textContent = String(idx + 1) + ' / ' + String(n);
    });
  }

  function renderSpots() {
    var tb = $('spotsBody');
    tb.innerHTML = '';
    allSpots.forEach(function (s) {
      var tr = document.createElement('tr');
      tr.className = 'spotRow' + (String(s.spotId) === selectedSpotId ? ' selected' : '');
      tr.onclick = function () {
        selectedSpotId = String(s.spotId || '');
        lastPostsPayload = null;
        var drv = $('dryReviewVisual');
        if (drv) { drv.innerHTML = ''; drv.style.display = 'none'; }
        var aiu1 = $('aiUsagePanel');
        if (aiu1) { aiu1.innerHTML = ''; aiu1.style.display = 'none'; }
        $('selSpotLabel').textContent = selectedSpotId || '—';
        $('btnLoadPosts').disabled = !selectedRunId || !selectedSpotId;
        $('btnDry').disabled = !selectedRunId || !selectedSpotId;
        $('btnApply').disabled = !lastCuratorResult || !selectedRunId || !selectedSpotId;
        renderSpots();
      };
      tr.innerHTML =
        '<td><code>' + escapeHtml(s.spotId) + '</code></td>' +
        '<td>' + escapeHtml(s.placeName || '') + '</td>' +
        '<td>' + (s.latitude != null ? escapeHtml(String(s.latitude)) : '') + '</td>' +
        '<td>' + (s.longitude != null ? escapeHtml(String(s.longitude)) : '') + '</td>';
      tb.appendChild(tr);
    });
  }

  var cachedRuns = [];

  async function loadRuns() {
    setRunsStatus('Loading…');
    var lim = parseInt($('runLimit').value, 10) || 50;
    if (lim < 1) lim = 1;
    if (lim > 100) lim = 100;
    var path = API + '/runs?limit=' + encodeURIComponent(String(lim));
    var r = await getJson(path);
    if (r.status === 404) {
      setRunsStatus('Wiki curation disabled (404). Unset WIKI_SPOT_CURATION_ENABLED or set it to true.');
      $('runsBody').innerHTML = '';
      return;
    }
    var d = unwrap(r.body);
    if (r.status >= 400) {
      setRunsStatus('Error ' + r.status + ': ' + JSON.stringify(r.body));
      return;
    }
    cachedRuns = d.runs || [];
    setRunsStatus((d.cached ? 'Cached list · ' : '') + cachedRuns.length + ' runs');
    renderRuns(cachedRuns);
  }

  async function loadSpotsPage(reset) {
    if (!selectedRunId) return;
    if (reset) {
      spotsCursor = null;
      allSpots = [];
    }
    var path = API + '/runs/' + encodeURIComponent(selectedRunId) + '/spots?limit=80';
    if (spotsCursor) path += '&cursor=' + encodeURIComponent(spotsCursor);
    setSpotsMeta('Loading spots…');
    var r = await getJson(path);
    if (r.status >= 400) {
      setSpotsMeta('Error ' + r.status + ': ' + JSON.stringify(r.body));
      return;
    }
    var page = unwrap(r.body);
    var batch = page.spots || [];
    if (reset) allSpots = batch.slice();
    else allSpots = allSpots.concat(batch);
    spotsCursor = page.nextCursor || null;
    spotsHasMore = !!page.hasMore;
    $('btnMoreSpots').disabled = !spotsHasMore;
    setSpotsMeta(allSpots.length + ' spots loaded' + (spotsHasMore ? ' · more available' : ''));
    renderSpots();
  }

  async function loadPosts() {
    if (!selectedRunId || !selectedSpotId) return;
    setPostsMeta('Loading candidates…');
    $('postsPreview').style.display = 'none';
    var path = API + '/runs/' + encodeURIComponent(selectedRunId) + '/spots/' + encodeURIComponent(selectedSpotId) + '/posts';
    var r = await getJson(path);
    if (r.status >= 400) {
      setPostsMeta('Error ' + r.status);
      lastPostsPayload = null;
      $('postsPreview').textContent = JSON.stringify(r.body, null, 2);
      $('postsPreview').style.display = 'block';
      return;
    }
    var d = unwrap(r.body);
    var n = (d.posts && d.posts.length) || 0;
    setPostsMeta((d.spotName || '') + ' · ' + n + ' posts');
    lastPostsPayload = d;
    $('postsPreview').textContent = JSON.stringify(d, null, 2);
    $('postsPreview').style.display = 'block';
  }

  function runDryReview() {
    if (!selectedRunId || !selectedSpotId) return;
    var mk = ($('geminiKeyManual') && $('geminiKeyManual').value) ? String($('geminiKeyManual').value).trim() : '';
    if (!mk.length) {
      $('dryLog').textContent = 'Paste your Gemini API key in the blue box at the top (required).';
      return;
    }
    var maxCore = parseInt($('maxCore').value, 10);
    var maxContext = parseInt($('maxContext').value, 10);
    var maxTotal = parseInt($('maxTotal').value, 10);
    var maxImages = parseInt($('maxImages').value, 10);
    if (isNaN(maxCore)) maxCore = 5;
    if (isNaN(maxContext)) maxContext = 3;
    if (isNaN(maxTotal)) maxTotal = 8;
    if (isNaN(maxImages)) maxImages = 3;
    var cr = parseInt($('coreRadiusM').value, 10);
    var nr = parseInt($('nearbyRadiusM').value, 10);
    var er = parseInt($('extendedRadiusM').value, 10);
    if (isNaN(cr)) cr = 1000;
    if (isNaN(nr)) nr = 3000;
    if (isNaN(er)) er = 20000;
    var allowContext = !!$('chkAllowContext').checked;
    var rejectPlane = !!$('chkRejectPlane').checked;
    $('dryLog').textContent = '';
    $('dryResult').textContent = '';
    var drvClear = $('dryReviewVisual');
    if (drvClear) { drvClear.innerHTML = ''; drvClear.style.display = 'none'; }
    var usageEl = $('aiUsagePanel');
    if (usageEl) { usageEl.innerHTML = ''; usageEl.style.display = 'none'; }
    lastCuratorResult = null;
    $('btnDry').disabled = true;
    $('btnApply').disabled = true;

    var url = API + '/runs/' + encodeURIComponent(selectedRunId) + '/spots/' + encodeURIComponent(selectedSpotId) + '/dry-review';
    postJson(
      url,
      {
        maxCorePostsPerSpot: maxCore,
        maxContextPostsPerSpot: maxContext,
        maxTotalPostsPerSpot: maxTotal,
        maxImagesPerCandidate: maxImages,
        allowContextualFarRelevant: allowContext,
        rejectPlaneViews: rejectPlane,
        coreRadiusMeters: cr,
        nearbyRadiusMeters: nr,
        extendedContextRadiusMeters: er
      },
      manualGeminiHeaders()
    ).then(function (start) {
      if (start.status >= 400) {
        $('dryLog').textContent = 'Start failed: ' + start.status + '\\n' + JSON.stringify(start.body, null, 2);
        $('btnDry').disabled = false;
        return;
      }
      var env = unwrap(start.body);
      var jobId = String(env.jobId || '');
      var secret = String(env.secret || '');
      if (!jobId || !secret) {
        $('dryLog').textContent = 'Missing jobId/secret in response';
        $('btnDry').disabled = false;
        return;
      }
      var esUrl = API + '/jobs/' + encodeURIComponent(jobId) + '/events?secret=' + encodeURIComponent(secret);
      var es = new EventSource(esUrl);
      var logEl = $('dryLog');
      es.onmessage = function (ev) {
        try {
          var j = JSON.parse(ev.data);
          if (j.line) logEl.textContent += j.line + '\\n';
          if (j.done) {
            es.close();
            var resUrl = API + '/jobs/' + encodeURIComponent(jobId) + '/result?secret=' + encodeURIComponent(secret);
            getJson(resUrl).then(function (rr) {
              if (rr.status >= 400) {
                $('dryResult').textContent = 'Result fetch failed: ' + rr.status + '\\n' + JSON.stringify(rr.body, null, 2);
                lastCuratorResult = null;
                renderDryReviewVisual();
                renderAiUsagePanel();
                $('btnApply').disabled = true;
              } else {
                var body = unwrap(rr.body);
                if (body.status === 'failed') {
                  $('dryResult').textContent = 'FAILED: ' + (body.error || '') + '\\n' + JSON.stringify(body, null, 2);
                  lastCuratorResult = null;
                  renderDryReviewVisual();
                  renderAiUsagePanel();
                  $('btnApply').disabled = true;
                } else {
                  lastCuratorResult = body.data != null ? body.data : null;
                  $('dryResult').textContent = JSON.stringify(lastCuratorResult, null, 2);
                  renderDryReviewVisual();
                  renderAiUsagePanel();
                  $('btnApply').disabled = !lastCuratorResult;
                }
              }
              $('btnDry').disabled = false;
            });
          }
        } catch (e) {
          logEl.textContent += 'parse error: ' + e + '\\n';
        }
      };
      es.onerror = function () {
        es.close();
        logEl.textContent += '\\n[SSE error]\\n';
        $('btnDry').disabled = false;
      };
    });
  }

  function applyResult() {
    $('applyOut').textContent = '';
    var sec = ($('applySecret').value || '').trim();
    if (!lastCuratorResult) {
      $('applyOut').textContent = 'No curator result yet. Run dry review first.';
      return;
    }
    if (!sec) {
      $('applyOut').textContent = 'Enter apply secret.';
      return;
    }
    var url = API + '/runs/' + encodeURIComponent(selectedRunId) + '/spots/' + encodeURIComponent(selectedSpotId) + '/apply-ai';
    postJson(url, { result: lastCuratorResult, confirmWrite: true }, { 'x-wiki-curation-apply-secret': sec }).then(function (r) {
      $('applyOut').textContent = JSON.stringify(r.body, null, 2);
      if (r.status >= 400) return;
    });
  }

  function refreshGeminiKeyBanner() {
    $('geminiKeyPlain').textContent =
      'Dry review uses only the key in the blue box (header x-wiki-curation-gemini-api-key). GEMINI_API_KEY in .env is not used for the Gemini HTTP call.';
    $('geminiEnvOut').textContent = '';
    getJson(API + '/gemini-env').then(function (r) {
      var d = unwrap(r.body);
      if (r.status === 404) {
        $('geminiEnvOut').textContent = JSON.stringify(d, null, 2);
        return;
      }
      $('geminiEnvOut').textContent = JSON.stringify(d, null, 2);
    });
  }

  $('btnSaveManualGemini').onclick = function () {
    try {
      var v = $('geminiKeyManual').value || '';
      localStorage.setItem(KEY_STORAGE, v);
      $('manualKeySaveStatus').textContent = 'Saved in this browser (localStorage).';
    } catch (e) {
      $('manualKeySaveStatus').textContent = 'Could not save: ' + e;
    }
  };
  $('btnClearManualGemini').onclick = function () {
    try {
      localStorage.removeItem(KEY_STORAGE);
    } catch (e) {}
    $('geminiKeyManual').value = '';
    $('manualKeySaveStatus').textContent = 'Cleared.';
  };

  $('btnRefreshRuns').onclick = function () { loadRuns(); };
  $('runFilter').oninput = function () { renderRuns(cachedRuns); };
  $('btnGeminiEnv').onclick = function () { refreshGeminiKeyBanner(); };
  $('btnLoadSpots').onclick = function () { loadSpotsPage(true); };
  $('btnMoreSpots').onclick = function () { if (spotsHasMore) loadSpotsPage(false); };
  $('btnLoadPosts').onclick = function () { loadPosts(); };
  $('btnDry').onclick = function () { runDryReview(); };
  $('btnApply').onclick = function () { applyResult(); };

  restoreManualGeminiKey();
  refreshGeminiKeyBanner();
  loadRuns();
})();
    </script>
  </body>
</html>`;
}
