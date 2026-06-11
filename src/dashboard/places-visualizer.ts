export function renderPlacesVisualizerPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Places Visualizer</title>
    <style>
      :root {
        --bg: #0f172a;
        --panel: #111827;
        --card: #0b1220;
        --border: #334155;
        --text: #e2e8f0;
        --muted: #94a3b8;
        --accent: #10b981;
        --accent-hover: #059669;
        --danger-bg: #450a0a;
        --danger-border: #991b1b;
        --danger-text: #fecaca;
      }
      * { box-sizing: border-box; }
      body {
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        margin: 0;
        background: linear-gradient(180deg, #0f172a 0%, #0b1220 55%, #052e16 100%);
        color: var(--text);
        min-height: 100vh;
      }
      a { color: #93c5fd; text-decoration: none; }
      .wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px 48px; }
      .top { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
      h1 { margin: 0 0 6px 0; font-size: 28px; letter-spacing: -0.02em; }
      .subtitle { color: var(--muted); margin: 0 0 20px 0; max-width: 720px; line-height: 1.5; }
      .badge {
        display: inline-flex; align-items: center; gap: 6px;
        border: 1px solid rgba(16,185,129,.35); background: rgba(16,185,129,.12);
        color: #6ee7b7; border-radius: 999px; padding: 4px 10px; font-size: 11px;
        font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
      }
      .panel {
        border: 1px solid var(--border); border-radius: 14px; background: var(--panel);
        padding: 16px; margin-bottom: 18px;
      }
      .search-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      input[type="text"], textarea {
        flex: 1; min-width: 240px; background: var(--card); border: 1px solid var(--border);
        color: var(--text); border-radius: 10px; padding: 12px 14px; font-size: 15px;
        font-family: inherit; line-height: 1.45;
      }
      textarea { min-height: 108px; resize: vertical; }
      input[type="text"]:focus, textarea:focus { outline: none; border-color: #34d399; box-shadow: 0 0 0 3px rgba(52,211,153,.15); }
      button {
        background: var(--accent); color: #052e16; border: none; border-radius: 10px;
        padding: 12px 18px; font-weight: 700; cursor: pointer; font-size: 14px;
      }
      button:hover:not(:disabled) { background: var(--accent-hover); color: #ecfdf5; }
      button:disabled { opacity: .55; cursor: wait; }
      .pills { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
      .pill-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-right: 4px; }
      .pill {
        border: 1px solid var(--border); background: var(--card); color: var(--text);
        border-radius: 999px; padding: 7px 12px; font-size: 13px; cursor: pointer;
      }
      .pill:hover:not(:disabled) { border-color: #34d399; background: rgba(16,185,129,.12); color: #a7f3d0; }
      .pill.active { background: var(--accent); border-color: var(--accent); color: #052e16; font-weight: 700; }
      .pill:disabled { opacity: .55; cursor: wait; }
      .alert {
        border: 1px solid var(--danger-border); background: var(--danger-bg);
        color: var(--danger-text); border-radius: 10px; padding: 12px 14px; margin: 16px 0;
      }
      .loading-text {
        display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 14px; margin: 18px 0 12px;
      }
      .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
      @keyframes pulse { 0%,100%{opacity:.35; transform:scale(.9)} 50%{opacity:1; transform:scale(1)} }
      @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
      @media (max-width: 1024px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
      .card {
        border: 1px solid var(--border); border-radius: 14px; background: var(--card); overflow: hidden;
        display: flex; flex-direction: column; transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease;
      }
      .card:hover { transform: translateY(-2px); border-color: rgba(52,211,153,.45); box-shadow: 0 10px 30px rgba(16,185,129,.12); }
      .thumb { aspect-ratio: 4/3; background: #1e293b; overflow: hidden; position: relative; }
      .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .thumb-fallback { display:flex; align-items:center; justify-content:center; height:100%; color:#64748b; font-size:12px; }
      .card-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
      .caption { font-size: 13px; line-height: 1.45; color: #cbd5e1; margin: 0; }
      .cite {
        margin-top: auto; display: inline-flex; align-items: center; gap: 6px; width: fit-content;
        border: 1px solid rgba(52,211,153,.35); background: rgba(16,185,129,.12); color: #6ee7b7;
        border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 700; text-decoration: none;
      }
      .cite:hover { background: rgba(16,185,129,.22); color: #a7f3d0; }
      .skeleton .thumb {
        background: linear-gradient(90deg, #1e293b 0%, #334155 50%, #1e293b 100%);
        background-size: 200% 100%; animation: shimmer 1.6s ease-in-out infinite;
      }
      .skeleton .line { height: 12px; border-radius: 6px; background: #1e293b; margin: 8px 14px; }
      .skeleton .line.short { width: 55%; margin-bottom: 14px; }
      .results-head { display:flex; justify-content:space-between; align-items:end; gap:12px; flex-wrap:wrap; margin: 6px 0 12px; }
      .results-head h2 { margin:0; font-size:18px; }
      .meta { color: var(--muted); font-size: 13px; margin: 4px 0 0; }
      .empty {
        border: 1px dashed var(--border); border-radius: 14px; padding: 36px 20px; text-align: center; color: var(--muted);
        background: rgba(17,24,39,.55);
      }
      .place-block {
        border: 1px solid var(--border); border-radius: 16px; background: rgba(17,24,39,.45);
        padding: 16px; margin-bottom: 18px;
      }
      .place-block h3 { margin: 0 0 4px 0; font-size: 17px; color: #6ee7b7; }
      .place-block .meta { margin: 0 0 12px 0; }
      .place-error {
        border: 1px solid var(--danger-border); background: rgba(69,10,10,.35);
        color: #fca5a5; border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-bottom: 12px;
      }
      .hint { font-size: 12px; color: var(--muted); margin-top: 8px; line-height: 1.4; }
      .toggle-row { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; align-items: center; }
      .toggle-row label { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); margin: 0; cursor: pointer; }
      .toggle-row input { width: auto; margin: 0; }
      .status-pill {
        display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 4px 10px;
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      }
      .status-pill.found { border: 1px solid #166534; color: #86efac; background: rgba(5,46,22,.55); }
      .status-pill.blank { border: 1px solid #64748b; color: #94a3b8; background: rgba(30,41,59,.55); }
      .status-pill.warn { border: 1px solid #854d0e; color: #fcd34d; background: rgba(66,32,6,.55); }
      .token-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
      .token { font-size: 11px; border-radius: 999px; padding: 3px 8px; border: 1px solid var(--border); background: var(--card); color: #cbd5e1; }
      .token.missing { border-color: #991b1b; color: #fecaca; background: rgba(69,10,10,.35); }
      .reject-list { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
      .reject-item { border: 1px solid #7f1d1d; background: rgba(69,10,10,.25); border-radius: 10px; padding: 10px 12px; font-size: 12px; line-height: 1.45; }
      .photo-badge { position: absolute; top: 8px; right: 8px; border-radius: 999px; padding: 3px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
      .photo-badge.accepted { background: rgba(5,46,22,.92); color: #86efac; }
      .photo-badge.rejected { background: rgba(69,10,10,.92); color: #fecaca; }
      .photo-meta { font-size: 11px; color: var(--muted); line-height: 1.4; margin-top: 6px; word-break: break-all; }
      .warn-line { color: #fcd34d; font-size: 12px; margin: 6px 0; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <a href="/admin">← Admin</a>
        <span class="badge">Location imagery</span>
      </div>
      <h1>Places Visualizer</h1>
      <p class="subtitle">
        Search location-based imagery with explicit web citations. One place per line for batch searches.
        Use <code style="color:#a7f3d0">Feature, Region</code> or <code style="color:#a7f3d0">Region, Feature</code> on a line to scope results — e.g.
        <code style="color:#a7f3d0">Cascade Falls, Mt. Ascutney</code> or <code style="color:#a7f3d0">Ascutney VT, Hidden Falls</code>.
        Strict title/source metadata gate rejects wrong-place and generic Vermont hits — <strong>wrong photo is worse than none</strong>.
        Enable <strong>Undiscovered app mode</strong> to preview the same relaxed scoring the native app uses for web photo reveal.
        Gemini vision is not used here.
      </p>

      <section class="panel">
        <form id="searchForm" class="search-row">
          <textarea id="placeInput" rows="4" placeholder="Woodstock Vermont&#10;Quechee Gorge Vermont&#10;Ascutney VT, Hidden Falls" autocomplete="off"></textarea>
          <button id="searchBtn" type="submit">Search</button>
        </form>
        <div class="toggle-row">
          <label><input type="checkbox" id="undiscoveredAppMode" /> Undiscovered app mode (matches native)</label>
          <label><input type="checkbox" id="strictMatch" checked /> Strict title/source match</label>
          <label><input type="checkbox" id="showRejected" checked /> Show rejected results</label>
        </div>
        <p class="hint">One place per line. Commas scope a specific feature to a region (either order works). Admin mode requires distinctive place name + town/state in title or source page. Undiscovered app mode uses relaxed scoring — same as the in-app "See web photos" flow.</p>
        <div class="pills">
          <span class="pill-label">Quick picks</span>
          <button type="button" class="pill" data-place="Covered Bridge Museum, Bennington, VT">Covered Bridge Museum</button>
          <button type="button" class="pill" data-place="Easton Canal Museum">Easton Canal Museum</button>
          <button type="button" class="pill" data-place="Quechee Gorge Vermont">Quechee Gorge Vermont</button>
          <button type="button" class="pill" data-place="Woodstock Vermont">Woodstock Vermont</button>
          <button type="button" class="pill" data-place="Ascutney VT, Hidden Falls">Ascutney · Hidden Falls</button>
          <button type="button" class="pill" data-place="Easton Canal Museum&#10;Quechee Gorge Vermont&#10;Woodstock Vermont">All 3 presets</button>
          <button type="button" class="pill" data-place="Quechee Gorge Vermont&#10;Taftsville Covered Bridge Woodstock Vermont&#10;Mink Brook Swimming Area Norwich Vermont&#10;Hazen Trail Norwich Vermont&#10;Sample's Jump Norwich Vermont&#10;Covered Bridge Woodstock Vermont">VT benchmark (6)</button>
        </div>
      </section>

      <div id="error" class="alert" style="display:none"></div>
      <div id="loading" style="display:none">
        <div class="loading-text"><span class="dot"></span>Searching for local imagery...</div>
        <div class="grid" id="skeletonGrid"></div>
      </div>
      <section id="results" style="display:none">
        <div class="results-head">
          <div>
            <h2 id="resultsTitle">Results</h2>
            <p class="meta" id="resultsMeta"></p>
          </div>
        </div>
        <div id="resultsContainer"></div>
      </section>
      <div id="empty" class="empty">Search a place or tap a quick pick to preview location imagery with citations.</div>
    </div>

    <script>
      const $ = (id) => document.getElementById(id);
      let activeQuery = '';
      let loading = false;

      function parsePlaceLines(input) {
        const seen = new Set();
        const places = [];
        for (const line of String(input || '').split(/\\r?\\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const key = trimmed.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          places.push(trimmed);
        }
        return places;
      }

      function pillPlaceValue(btn) {
        return String(btn.getAttribute('data-place') || '').replace(/&#10;/g, '\\n').trim();
      }

      function skeletonCards(count) {
        return Array.from({ length: count }).map(() =>
          '<article class="card skeleton"><div class="thumb"></div><div class="line"></div><div class="line short"></div></article>'
        ).join('');
      }

      function setLoading(on, placeCount) {
        loading = on;
        $('searchBtn').disabled = on || !$('placeInput').value.trim();
        document.querySelectorAll('.pill[data-place]').forEach((btn) => { btn.disabled = on; });
        $('loading').style.display = on ? 'block' : 'none';
        if (on) {
          $('results').style.display = 'none';
          $('empty').style.display = 'none';
          $('error').style.display = 'none';
          const count = Math.max(1, placeCount || 1);
          if (count === 1) {
            $('skeletonGrid').innerHTML = skeletonCards(4);
          } else {
            $('skeletonGrid').innerHTML = Array.from({ length: count }).map((_, index) =>
              '<section class="place-block"><div class="line" style="height:16px;width:40%;margin:0 0 12px;background:#1e293b;border-radius:6px"></div>' +
              '<div class="grid">' + skeletonCards(4) + '</div></section>'
            ).join('');
          }
          $('loading').querySelector('.loading-text').innerHTML =
            '<span class="dot"></span>' + (count > 1
              ? ('Searching local imagery for ' + count + ' places...')
              : 'Searching for local imagery...');
        }
      }

      function escapeHtml(input) {
        return String(input ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function statusPillClass(status) {
        if (status === 'found') return 'found';
        if (status === 'low_confidence') return 'warn';
        return 'blank';
      }

      function renderCard(item, opts) {
        opts = opts || {};
        const caption = escapeHtml(item.title || item.caption);
        const sourceName = escapeHtml(item.sourceDomain || item.sourceName);
        const sourceUrl = escapeHtml(item.sourceUrl);
        const imageUrl = escapeHtml(item.imageUrl);
        const accepted = opts.accepted !== false;
        const badge = '<span class="photo-badge ' + (accepted ? 'accepted' : 'rejected') + '">' +
          (accepted ? 'accepted' : 'rejected') + '</span>';
        const score = item.assetMatchScore != null ? '<div class="photo-meta">Score: ' + escapeHtml(String(item.assetMatchScore)) +
          (item.assetMatchConfidence ? ' · ' + escapeHtml(item.assetMatchConfidence) : '') + '</div>' : '';
        const rejectLine = !accepted && item.rejectReasons && item.rejectReasons.length
          ? '<div class="warn-line">⚠ ' + escapeHtml(item.rejectReasons.join(', ')) + '</div>'
          : '';
        const urlLine = '<div class="photo-meta"><a href="' + sourceUrl + '" target="_blank" rel="noopener noreferrer">' + sourceUrl + '</a></div>';
        return '<article class="card">' +
          '<div class="thumb">' + badge +
          '<img src="' + imageUrl + '" alt="' + caption + '" loading="lazy" onerror="this.parentElement.innerHTML=\\'<div class=thumb-fallback>Preview unavailable</div>\\'" /></div>' +
          '<div class="card-body">' +
            '<p class="caption">' + caption + '</p>' +
            '<a class="cite" href="' + sourceUrl + '" target="_blank" rel="noopener noreferrer">↗ ' + sourceName + '</a>' +
            score + urlLine + rejectLine +
          '</div>' +
        '</article>';
      }

      function renderRejectedPreview(row) {
        return renderCard({
          imageUrl: 'https://via.placeholder.com/640x480/1e293b/64748b?text=rejected',
          caption: row.title,
          title: row.title,
          sourceName: row.sourceDomain,
          sourceDomain: row.sourceDomain,
          sourceUrl: row.sourceUrl,
          assetMatchScore: row.metadataScore,
          rejectReasons: row.rejectReasons,
        }, { accepted: false });
      }

      function renderCurationBlock(curation, showRejected) {
        if (!curation) return '';
        const status = curation.assetStatus || 'no_good_match';
        const pill = '<span class="status-pill ' + statusPillClass(status) + '">' + escapeHtml(status) + '</span>';
        const counts = 'Accepted ' + (curation.acceptedCount || 0) + ' · Rejected ' + (curation.rejectedCount || 0) +
          ' · raw ' + (curation.rawResultCount || 0);
        const profileLine = curation.scoringProfile === 'undiscovered_app'
          ? '<p class="meta">Scoring: <strong style="color:#6ee7b7">undiscovered_app</strong> · strict title/source off</p>'
          : '<p class="meta">Scoring: admin_strict · strict title/source ' + (curation.strictTitleSourceMatch ? 'on' : 'off') + '</p>';
        const matched = (curation.matchedTokens || []).map(function (t) {
          return '<span class="token">' + escapeHtml(t) + '</span>';
        }).join('');
        const missing = (curation.missingRequiredTokens || []).map(function (t) {
          return '<span class="token missing">missing: ' + escapeHtml(t) + '</span>';
        }).join('');
        const warns = (curation.warnings || []).map(function (w) {
          return '<div class="warn-line">⚠ ' + escapeHtml(w) + '</div>';
        }).join('');
        const topReject = (curation.topRejectionReasons || []).length
          ? '<p class="meta">Top reject reasons: ' + escapeHtml(curation.topRejectionReasons.join(' · ')) + '</p>'
          : '';
        const rejectList = showRejected && (curation.rejectedPreviews || []).length
          ? '<ul class="reject-list">' + (curation.rejectedPreviews || []).slice(0, 5).map(function (r) {
              return '<li class="reject-item"><strong>' + escapeHtml(r.title) + '</strong> · ' + escapeHtml(r.sourceDomain) +
                '<br/>' + escapeHtml((r.rejectReasons || []).join(', ')) + '</li>';
            }).join('') + '</ul>'
          : '';
        const rejectedCards = showRejected && (curation.rejectedPreviews || []).length
          ? '<div class="grid" style="margin-top:12px">' + (curation.rejectedPreviews || []).map(renderRejectedPreview).join('') + '</div>'
          : '';
        return '<div style="margin:10px 0 12px">' + pill +
          profileLine +
          '<p class="meta" style="margin-top:8px">' + counts + ' · set score ' + escapeHtml(String(curation.resultSetScore || 0)) + '</p>' +
          topReject + warns +
          ((matched || missing) ? '<div class="token-row">' + matched + missing + '</div>' : '') +
          rejectList + rejectedCards + '</div>';
      }

      function renderPlaceSection(place, showRejected) {
        const title = escapeHtml(place.placeName);
        const curation = place.curation;
        let meta = 'query: <code style="color:#a7f3d0">' + escapeHtml(place.searchQuery || place.placeName) + '</code> · via ' + (place.source || 'unknown');
        if (curation) {
          meta += ' · ' + (curation.assetsReady ? (place.results || []).length + ' accepted' : 'no good match');
        } else {
          meta = (place.results || []).length + ' images · ' + meta;
        }
        const errorHtml = place.error && (!curation || !curation.assetsReady)
          ? '<div class="place-error">' + escapeHtml(place.error) + '</div>'
          : '';
        const cards = (place.results || []).map(function (item) { return renderCard(item, { accepted: true }); }).join('');
        const blank = (!place.results || place.results.length === 0)
          ? '<div class="empty" style="margin:12px 0;padding:20px">No good photos found — safer to leave blank.</div>'
          : '';
        return '<section class="place-block">' +
          '<h3>' + title + '</h3>' +
          '<p class="meta">' + meta + '</p>' +
          renderCurationBlock(curation, showRejected) +
          errorHtml + blank +
          '<div class="grid">' + cards + '</div>' +
        '</section>';
      }

      function setActivePill(query) {
        document.querySelectorAll('.pill[data-place]').forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-place') === query);
        });
      }

      function renderResults(payload, query, placeNames) {
        const showRejected = $('showRejected').checked;
        $('error').style.display = 'none';
        $('results').style.display = 'block';
        $('empty').style.display = 'none';

        if (Array.isArray(payload.places)) {
          const okCount = payload.places.filter((p) => p.curation && p.curation.assetsReady).length;
          $('resultsTitle').textContent = 'Places (' + okCount + ' accepted of ' + payload.places.length + ')';
          $('resultsMeta').textContent = 'Batch search · ' +
            (payload.places[0] && payload.places[0].curation && payload.places[0].curation.scoringProfile === 'undiscovered_app'
              ? 'undiscovered_app scoring'
              : 'strict metadata gate') +
            ' · ' +
            payload.places.reduce((sum, p) => sum + (p.results || []).length, 0) + ' accepted images';
          $('resultsContainer').innerHTML = payload.places.map(function (p) {
            return renderPlaceSection(p, showRejected);
          }).join('');
          return;
        }

        $('resultsTitle').innerHTML = 'Results for <span style="color:#6ee7b7">' + escapeHtml(payload.placeName || query) + '</span>';
        $('resultsMeta').textContent =
          (payload.curation && payload.curation.scoringProfile === 'undiscovered_app'
            ? 'Undiscovered app scoring · '
            : 'Strict title/source match · ') +
          ((payload.curation && payload.curation.assetsReady) ? (payload.results || []).length + ' accepted' : 'no good match');
        $('resultsContainer').innerHTML = renderPlaceSection({
          placeName: payload.placeName,
          searchQuery: payload.searchQuery,
          results: payload.results,
          source: payload.source,
          curation: payload.curation,
          error: payload.curation && !payload.curation.assetsReady ? (payload.curation.warnings || []).join(' ') : '',
        }, showRejected);
      }

      function syncUndiscoveredModeUi() {
        const appMode = $('undiscoveredAppMode').checked;
        const strictEl = $('strictMatch');
        strictEl.disabled = appMode;
        if (appMode) strictEl.checked = false;
      }

      async function runSearch(query) {
        const trimmed = String(query || '').trim();
        if (!trimmed || loading) return;
        const placeLines = parsePlaceLines(trimmed);
        if (!placeLines.length) return;

        activeQuery = trimmed;
        $('placeInput').value = trimmed;
        setActivePill(trimmed);
        setLoading(true, placeLines.length);
        try {
          const appMode = $('undiscoveredAppMode').checked;
          const res = await fetch('/api/places/search-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              placeName: trimmed,
              strictTitleSourceMatch: appMode ? false : $('strictMatch').checked,
              scoringProfile: appMode ? 'undiscovered_app' : 'admin_strict',
            }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok || payload.ok === false) {
            const message = payload.error || ('Search failed (' + res.status + ')');
            $('error').textContent = message;
            $('error').style.display = 'block';
            $('results').style.display = 'none';
            $('empty').style.display = 'none';
            return;
          }
          renderResults(payload, trimmed, placeLines);
        } catch (err) {
          $('error').textContent = err && err.message ? err.message : 'Unexpected search error';
          $('error').style.display = 'block';
        } finally {
          setLoading(false, placeLines.length);
        }
      }

      $('undiscoveredAppMode').addEventListener('change', syncUndiscoveredModeUi);
      syncUndiscoveredModeUi();

      $('searchForm').addEventListener('submit', (event) => {
        event.preventDefault();
        runSearch($('placeInput').value);
      });

      document.querySelectorAll('.pill[data-place]').forEach((btn) => {
        btn.addEventListener('click', () => runSearch(pillPlaceValue(btn)));
      });

      $('placeInput').addEventListener('input', () => {
        $('searchBtn').disabled = loading || !$('placeInput').value.trim();
      });
    </script>
  </body>
</html>`;
}
