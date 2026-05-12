export function wikimediaMvpDevPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Wikimedia MVP Dev</title>
  <style>
    body{font-family:ui-sans-serif,system-ui;margin:0;background:#0f172a;color:#e2e8f0}
    .shell{display:grid;grid-template-columns:320px 1fr;min-height:100vh}
    .left{border-right:1px solid #334155;padding:16px;background:#111827}
    .main{padding:16px}
    textarea,input,button{width:100%;box-sizing:border-box;margin:8px 0;padding:8px;border-radius:8px;border:1px solid #475569;background:#0b1220;color:#e2e8f0}
    button{cursor:pointer;font-weight:700}
    button.primary{background:#f97316;border-color:#ea580c;color:#111827;font-size:15px;padding:12px 10px}
    button.primary:disabled{opacity:.5;cursor:wait}
    .row{display:flex;gap:8px}
    .row button{width:auto;flex:1}
    pre#logs,#analysis{background:#020617;border:1px solid #334155;border-radius:8px;padding:12px;max-height:280px;overflow:auto;font-size:12px}
    .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}
    .card{border:1px solid #334155;border-radius:10px;padding:10px;background:#111827}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .candidate,.post{border:1px solid #334155;border-radius:10px;padding:10px;margin:8px 0;background:#0b1220}
    .candidate img,.post img{max-width:96px;max-height:72px;border-radius:6px;margin:0 6px 6px 0}
    .thumbs{display:flex;flex-wrap:wrap}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;margin-right:6px}
    .KEEP{background:#14532d}.REVIEW{background:#713f12}.REJECT{background:#7f1d1d}
    .badge{display:inline-block;padding:2px 6px;border-radius:6px;font-size:10px;margin:2px 4px 2px 0}
    .badge-KEPT{background:#14532d}.badge-DUPLICATE_REMOVED{background:#7c2d12}.badge-HYGIENE_REJECTED{background:#7f1d1d}.badge-REVIEW{background:#713f12}
    @media(max-width:900px){.shell{grid-template-columns:1fr}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="shell">
    <aside class="left">
      <h1>Wikimedia MVP Dev</h1>
      <p>Grouped dry-run post previews. No Firestore writes by default.</p>
      <label>Place</label>
      <textarea id="places" rows="4" placeholder="Eiffel Tower, Paris, France"></textarea>
      <label>Max candidates</label>
      <input id="limit" type="number" min="1" max="2000" value="200"/>
      <button type="button" id="runPlaceBtn" class="primary">Run all posts for place</button>
      <button type="button" id="runQueryAllBtn">Run ALL query assets</button>
      <button type="button" id="clearBtn">Clear</button>
      <details style="margin-top:14px">
        <summary>Queue multiple places</summary>
        <p style="font-size:12px;color:#94a3b8;margin:8px 0">Comma-separated places in the box above.</p>
        <div class="row">
          <button type="button" id="startBtn">Start queue</button>
          <button type="button" id="nextBtn">Run next</button>
        </div>
        <button type="button" id="allBtn">Run all sequentially</button>
      </details>
      <p id="runMeta" class="card"></p>
    </aside>
    <main class="main">
      <section class="summary" id="summary"></section>
      <h2>Logs</h2>
      <pre id="logs"></pre>
      <h2>Current place summary</h2>
      <pre id="analysis"></pre>
      <h2>Generated posts</h2>
      <div id="generatedPosts"></div>
      <h2>Removed assets</h2>
      <div id="removedAssets"></div>
      <h2>Rejected groups</h2>
      <div id="rejectedGroups"></div>
      <section class="grid">
        <div><h2>Candidate analysis</h2><div id="kept"></div></div>
        <div><h2>Rejected candidates</h2><div id="rejected"></div></div>
      </section>
    </main>
  </div>
  <script>
    let runId = null;
    let eventSource = null;
    const $ = (id) => document.getElementById(id);
    async function api(path, body) {
      const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    function placeInputValue() {
      const raw = String($('places').value || '').trim();
      if (!raw) return '';
      const firstLine = raw.split(/\\n+/).map((x) => x.trim()).find(Boolean);
      return firstLine || raw;
    }
    function stopEvents() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    }
    function startEvents(id) {
      stopEvents();
      $('logs').textContent = '';
      eventSource = new EventSource('/dev/wikimedia-mvp/api/run/' + encodeURIComponent(id) + '/events?since=0');
      eventSource.onmessage = (event) => {
        try {
          const row = JSON.parse(event.data);
          const line = '[' + row.timestamp + '] ' + row.message + (row.data ? ' ' + JSON.stringify(row.data) : '');
          $('logs').textContent += line + '\\n';
          $('logs').scrollTop = $('logs').scrollHeight;
        } catch {}
      };
    }
    function hygieneBadge(asset) {
      if (asset.duplicateDecision === 'DUPLICATE_REJECTED') return '<span class="badge badge-DUPLICATE_REMOVED">DUPLICATE REMOVED</span>';
      if (asset.hygieneStatus === 'REJECT') return '<span class="badge badge-HYGIENE_REJECTED">HYGIENE REJECTED</span>';
      if (asset.hygieneStatus === 'REVIEW' || asset.duplicateDecision === 'POSSIBLE_DUPLICATE_REVIEW') return '<span class="badge badge-REVIEW">REVIEW</span>';
      return '<span class="badge badge-KEPT">KEPT</span>';
    }
    function assetThumb(asset) {
      return '<div><img src="' + (asset.thumbnailUrl || asset.fullImageUrl || '') + '" alt=""/>' + hygieneBadge(asset) + '<div style="font-size:11px">' + (asset.hygieneReasons || []).join(', ') + '</div></div>';
    }
    function postCard(post) {
      const keptThumbs = (post.media || []).map(assetThumb).join('');
      const removed = (post.removedAssets || []).map(assetThumb).join('');
      const review = (post.reviewAssets || []).map(assetThumb).join('');
      return '<article class="post"><span class="pill ' + post.status + '">' + post.status + '</span><div><strong>' + post.generatedTitle + '</strong></div><div>original ' + (post.originalAssetCount ?? post.assetCount) + ' · kept ' + (post.keptAssetCount ?? post.assetCount) + ' · dup removed ' + (post.rejectedDuplicateCount ?? 0) + ' · hygiene removed ' + (post.rejectedHygieneCount ?? 0) + ' · review ' + (post.reviewAssetCount ?? 0) + '</div><div>' + post.groupMethod + ' · ' + (post.activities || []).join(', ') + '</div><div>Location: ' + JSON.stringify(post.selectedLocation || {}) + '</div><div class="thumbs">' + keptThumbs + '</div><details><summary>Removed assets</summary><div class="thumbs">' + (removed || 'None') + '</div></details><details><summary>Review assets</summary><div class="thumbs">' + (review || 'None') + '</div></details><details><summary>Hygiene summary</summary><pre>' + JSON.stringify(post.assetHygieneSummary || {}, null, 2) + '</pre></details><details><summary>Post JSON</summary><pre>' + JSON.stringify(post.dryRunPostPreview || post, null, 2) + '</pre></details></article>';
    }
    function cardHtml(c) {
      const hygiene = [
        c.hygieneStatus ? 'hygiene=' + c.hygieneStatus : null,
        c.duplicateDecision ? 'duplicate=' + c.duplicateDecision : null,
        c.visualHashDistanceToPrimary != null ? 'hashDistance=' + c.visualHashDistanceToPrimary : null,
        (c.hygieneReasons || []).join(', '),
        (c.hygieneWarnings || []).join(', ')
      ].filter(Boolean).join(' · ');
      return '<article class="candidate"><img src="' + (c.thumbnailUrl || c.fullImageUrl || '') + '" alt=""/><span class="pill ' + c.status + '">' + c.status + '</span>' + hygieneBadge(c) + '<div><strong>' + c.generatedTitle + '</strong></div><div>group ' + (c.groupId || '—') + '</div><div>' + (c.activities || []).join(', ') + '</div><div>' + hygiene + '</div><div>' + (c.reasoning || []).join(' · ') + '</div><details><summary>JSON</summary><pre>' + JSON.stringify(c, null, 2) + '</pre></details></article>';
    }
    function removedAssetsSection(posts) {
      const buckets = { exact: [], near: [], panorama: [], lowQuality: [], bwFilter: [], other: [] };
      for (const post of posts) {
        for (const asset of post.removedAssets || []) {
          const reasons = asset.hygieneReasons || [];
          if (reasons.includes('exact_duplicate_same_source')) buckets.exact.push(asset);
          else if (reasons.some((r) => r.includes('near_duplicate'))) buckets.near.push(asset);
          else if (reasons.some((r) => r.includes('panorama'))) buckets.panorama.push(asset);
          else if (reasons.some((r) => r.includes('low_resolution') || r.includes('missing_usable_image_url') || r.includes('unreadable') || r.includes('non_photo'))) buckets.lowQuality.push(asset);
          else if (reasons.some((r) => r.includes('black_and_white') || r.includes('filtered'))) buckets.bwFilter.push(asset);
          else buckets.other.push(asset);
        }
      }
      const renderBucket = (title, items) => '<details open><summary>' + title + ' (' + items.length + ')</summary><div class="thumbs">' + items.map(assetThumb).join('') + '</div></details>';
      return [
        renderBucket('Exact duplicates', buckets.exact),
        renderBucket('Near duplicates', buckets.near),
        renderBucket('Panoramas', buckets.panorama),
        renderBucket('Low quality', buckets.lowQuality),
        renderBucket('Black-and-white / filter', buckets.bwFilter),
        renderBucket('Other', buckets.other)
      ].join('');
    }
    function renderPlaceResult(last, run) {
      const summary = last?.summary || {};
      $('summary').innerHTML = [
        ['Run', run?.runId || '—'],
        ['Status', run?.status || '—'],
        ['Candidates', summary.candidateCount ?? last?.candidateCount ?? 0],
        ['Generated posts', summary.generatedPostsCount ?? 0],
        ['Dup removed', summary.rejectedDuplicateCount ?? 0],
        ['Hygiene removed', summary.rejectedHygieneCount ?? 0],
        ['Review dupes', summary.possibleDuplicateReviewCount ?? 0],
        ['Multi-photo', summary.multiAssetPostCount ?? 0],
        ['No-location groups', summary.rejectedNoLocationGroupCount ?? 0],
        ['Budget', JSON.stringify(summary.budget || last?.budget || {})]
      ].map(([k,v]) => '<div class="card"><strong>' + k + '</strong><div>' + v + '</div></div>').join('');
      $('runMeta').textContent = run ? ('runId=' + run.runId + ' dryRun=' + run.dryRun + ' writes=' + run.allowWrites + ' fetchAll=' + run.fetchAll + ' limit=' + run.limitPerPlace) : '';
      $('analysis').textContent = last ? JSON.stringify({ summary, placeName: last.placeName }, null, 2) : 'No place processed yet';
      const posts = last?.generatedPosts || [];
      $('generatedPosts').innerHTML = posts.filter((p) => p.status !== 'REJECT').map(postCard).join('') || 'No generated posts yet.';
      $('removedAssets').innerHTML = removedAssetsSection(posts) || 'No removed assets.';
      $('rejectedGroups').innerHTML = posts.filter((p) => p.status === 'REJECT').map(postCard).join('') || 'No rejected groups.';
      const kept = (last?.candidateAnalysis || last?.candidates || []).filter((c) => c.status !== 'REJECT');
      const rejected = (last?.candidateAnalysis || last?.candidates || []).filter((c) => c.status === 'REJECT');
      $('kept').innerHTML = kept.map(cardHtml).join('');
      $('rejected').innerHTML = rejected.map(cardHtml).join('');
    }
    function renderSummary(run) {
      const last = run.placeResults?.[run.placeResults.length - 1];
      renderPlaceResult(last, run);
    }
    async function refresh() {
      if (!runId) return;
      const run = await api('/dev/wikimedia-mvp/api/run/' + encodeURIComponent(runId));
      renderSummary(run);
    }
    async function runPlaceForInput(fetchAll) {
      const place = placeInputValue();
      if (!place) {
        $('runMeta').textContent = 'Enter a place name first.';
        return;
      }
      const start = await api('/dev/wikimedia-mvp/api/start', {
        singlePlace: place,
        limit: Number($('limit').value || 200),
        fetchAll: fetchAll === true,
        dryRun: true,
      });
      runId = start.runId;
      startEvents(runId);
      await api('/dev/wikimedia-mvp/api/run-next', { runId });
      await refresh();
    }
    $('runPlaceBtn').onclick = async () => {
      const btn = $('runPlaceBtn');
      btn.disabled = true;
      btn.textContent = 'Running…';
      try {
        await runPlaceForInput(false);
      } catch (error) {
        $('runMeta').textContent = error instanceof Error ? error.message : String(error);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Run all posts for place';
      }
    };
    $('runQueryAllBtn').onclick = async () => {
      const btn = $('runQueryAllBtn');
      btn.disabled = true;
      btn.textContent = 'Running ALL…';
      try {
        await runPlaceForInput(true);
      } catch (error) {
        $('runMeta').textContent = error instanceof Error ? error.message : String(error);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Run ALL query assets';
      }
    };
    $('startBtn').onclick = async () => {
      const out = await api('/dev/wikimedia-mvp/api/start', { places: $('places').value, limit: Number($('limit').value || 200), dryRun: true });
      runId = out.runId;
      startEvents(runId);
      await refresh();
    };
    $('nextBtn').onclick = async () => {
      if (!runId) return;
      await api('/dev/wikimedia-mvp/api/run-next', { runId });
      await refresh();
    };
    $('allBtn').onclick = async () => {
      if (!runId) {
        const out = await api('/dev/wikimedia-mvp/api/start', { places: $('places').value, limit: Number($('limit').value || 200), dryRun: true });
        runId = out.runId;
        startEvents(runId);
      }
      while (true) {
        const run = await api('/dev/wikimedia-mvp/api/run/' + encodeURIComponent(runId));
        if (run.nextPlaceIndex >= run.places.length) break;
        await api('/dev/wikimedia-mvp/api/run-next', { runId });
      }
      await refresh();
    };
    $('clearBtn').onclick = async () => {
      stopEvents();
      await api('/dev/wikimedia-mvp/api/clear', {});
      runId = null;
      $('summary').innerHTML = '';
      $('logs').textContent = '';
      $('analysis').textContent = '';
      $('generatedPosts').innerHTML = '';
      $('removedAssets').innerHTML = '';
      $('rejectedGroups').innerHTML = '';
      $('kept').innerHTML = '';
      $('rejected').innerHTML = '';
      $('runMeta').textContent = '';
    };
  </script>
</body>
</html>`;
}
