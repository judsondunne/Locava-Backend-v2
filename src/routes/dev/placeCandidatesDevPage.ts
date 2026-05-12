export function placeCandidatesDevPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Place Candidates Dev</title>
  <style>
    body{font-family:ui-sans-serif,system-ui;margin:0;background:#0f172a;color:#e2e8f0}
    .shell{display:grid;grid-template-columns:320px 1fr;min-height:100vh}
    .left{border-right:1px solid #334155;padding:16px;background:#111827}
    .main{padding:16px}
    input,button,select{width:100%;box-sizing:border-box;margin:8px 0;padding:8px;border-radius:8px;border:1px solid #475569;background:#0b1220;color:#e2e8f0}
    button{cursor:pointer;font-weight:700}
    button.primary{background:#22c55e;border-color:#16a34a;color:#052e16}
    button.primary:disabled{opacity:.5;cursor:wait}
    pre#logs,#events,#warnings{background:#020617;border:1px solid #334155;border-radius:8px;padding:12px;max-height:320px;overflow:auto;font-size:12px}
    .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}
    .card{border:1px solid #334155;border-radius:10px;padding:10px;background:#111827}
    .candidate{border:1px solid #334155;border-radius:10px;padding:10px;margin:8px 0;background:#0b1220}
    .tier{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-right:8px}
    .tier-A{background:#14532d;color:#bbf7d0}
    .tier-B{background:#1e3a8a;color:#bfdbfe}
    .tier-C{background:#3f3f46;color:#e4e4e7}
    .warn{color:#fbbf24}
    @media(max-width:900px){.shell{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="shell">
    <aside class="left">
      <h1>Place Candidates</h1>
      <p>State candidate generator only. No Wikimedia media, posts, or Firestore writes.</p>
      <p class="warn" id="modeHelp">Fast Locava-relevant candidate discovery.</p>
      <label>Mode</label>
      <select id="mode">
        <option value="fast_targeted" selected>Fast targeted</option>
        <option value="fast_smoke">Fast smoke</option>
        <option value="deep_discovery">Deep discovery</option>
      </select>
      <label>State name</label>
      <input id="stateName" value="Vermont"/>
      <label>State code</label>
      <input id="stateCode" value="VT"/>
      <label>Limit</label>
      <input id="limit" type="number" min="1" max="200" value="50"/>
      <label>Total timeout ms</label>
      <input id="totalTimeoutMs" type="number" min="1000" max="15000" value="10000"/>
      <label>Per query timeout ms</label>
      <input id="perQueryTimeoutMs" type="number" min="500" max="60000" value="2500"/>
      <label>Min score</label>
      <input id="minScore" type="number" min="0" max="100" value="20"/>
      <label><input id="includeMediaSignals" type="checkbox" checked/> Include media signals (ranking only)</label>
      <label>Source</label>
      <select id="source"><option value="wikidata" selected>Wikidata</option></select>
      <button type="button" id="runBtn" class="primary">Generate state candidates</button>
      <p id="runMeta" class="card"></p>
    </aside>
    <main class="main">
      <section class="summary" id="summary"></section>
      <h2>Live logs</h2>
      <pre id="logs"></pre>
      <h2>Events</h2>
      <pre id="events"></pre>
      <h2>Quality audit</h2>
      <pre id="warnings"></pre>
      <section class="summary" id="tierSummary"></section>
      <section class="summary" id="categorySummary"></section>
      <h2>Bucket breakdown</h2>
      <pre id="bucketBreakdown"></pre>
      <h2>Media signal summary</h2>
      <pre id="mediaSignalSummary"></pre>
      <h2>Run media now (P0 / P1)</h2>
      <div id="runMediaNow"></div>
      <h2>Run media later (P2)</h2>
      <div id="runMediaLater"></div>
      <h2>Backlog / lower-priority usable candidates (P3)</h2>
      <div id="backlogCandidates"></div>
      <h2>Blocked candidates</h2>
      <pre id="blockedCandidates"></pre>
      <h2>All eligible candidates</h2>
      <div id="pipelineCandidates"></div>
      <h2>Legacy tier A candidates</h2>
      <div id="tierA"></div>
      <h2>Legacy tier B candidates</h2>
      <div id="tierB"></div>
      <h2>Legacy tier C candidates</h2>
      <div id="tierC"></div>
      <h2>All returned candidates</h2>
      <div id="candidates"></div>
      <h2>Rejected candidates</h2>
      <pre id="rejected"></pre>
      <h2>Slowest source queries</h2>
      <pre id="sourceTimings"></pre>
    </main>
  </div>
  <script>
    let runId = null;
    let eventSource = null;
    let pollTimer = null;
    let sinceCursor = 0;
    const seenEventCursors = new Set();
    const $ = (id) => document.getElementById(id);
    const modeHelpText = {
      fast_targeted: 'Fast Locava-relevant candidate discovery.',
      fast_smoke: 'Raw coordinate sanity check — not quality-filtered.',
      deep_discovery: 'Broader Wikidata discovery with deeper fallback coverage.'
    };
    function updateModeHelp() {
      const mode = $('mode').value || 'fast_targeted';
      $('modeHelp').textContent = modeHelpText[mode] || modeHelpText.fast_targeted;
    }
    $('mode').onchange = updateModeHelp;
    updateModeHelp();
    function stopLive() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
    function formatEventLine(row) {
      return '[' + (row.timestamp || '') + '] ' + row.type + (row.message ? ' ' + row.message : '') + (row.counts ? ' ' + JSON.stringify(row.counts) : '');
    }
    function renderEvent(row) {
      const cursor = row.cursor;
      if (cursor != null) {
        if (seenEventCursors.has(cursor)) return;
        seenEventCursors.add(cursor);
        sinceCursor = Math.max(sinceCursor, cursor + 1);
      }
      appendLog(formatEventLine(row));
      $('events').textContent += JSON.stringify(row, null, 2) + '\\n\\n';
      $('events').scrollTop = $('events').scrollHeight;
    }
    function appendLog(line) {
      $('logs').textContent += line + '\\n';
      $('logs').scrollTop = $('logs').scrollHeight;
    }
    async function pollRunLogs() {
      if (!runId) return;
      const res = await fetch('/dev/place-candidates/api/run/' + encodeURIComponent(runId) + '/logs?since=' + sinceCursor);
      if (!res.ok) return;
      const data = await res.json();
      for (const row of data.events || []) {
        renderEvent(row);
      }
      if (data.nextCursor != null) {
        sinceCursor = Math.max(sinceCursor, data.nextCursor);
      }
    }
    function startLive(id) {
      stopLive();
      sinceCursor = 0;
      seenEventCursors.clear();
      $('logs').textContent = '';
      $('events').textContent = '';
      appendLog('[client] live stream starting for run ' + id);
      eventSource = new EventSource('/dev/place-candidates/api/run/' + encodeURIComponent(id) + '/events?since=0');
      eventSource.onmessage = (event) => {
        try {
          renderEvent(JSON.parse(event.data));
        } catch {}
      };
      eventSource.onerror = () => {
        appendLog('[client] live stream interrupted; polling logs until run finishes');
      };
      void pollRunLogs();
      pollTimer = setInterval(() => {
        void pollRunLogs();
      }, 500);
    }
    function candidateCard(c, options) {
      const opts = options || {};
      const links = [
        c.sourceUrls?.wikidata ? '<a href="' + c.sourceUrls.wikidata + '" target="_blank" rel="noreferrer">Wikidata</a>' : '',
        c.sourceUrls?.wikipedia ? '<a href="' + c.sourceUrls.wikipedia + '" target="_blank" rel="noreferrer">Wikipedia</a>' : '',
        c.sourceUrls?.commonsCategory ? '<a href="' + c.sourceUrls.commonsCategory + '" target="_blank" rel="noreferrer">Commons</a>' : ''
      ].filter(Boolean).join(' · ');
      const tier = c.candidateTier || 'C';
      const priority = c.locavaPriorityScore != null ? c.locavaPriorityScore : '—';
      const mediaScore = c.mediaSignalScore != null ? c.mediaSignalScore : '—';
      const mediaAvailability = c.mediaSignals?.mediaAvailability || '—';
      const priorityReasons = (c.priorityReasons || []).join(', ');
      const blockReasons = (c.blockReasons || c.pipelineBlockReasons || []).join(', ');
      const extra = opts.showPriority && priorityReasons
        ? '<div>Priority reasons: ' + priorityReasons + '</div>'
        : opts.showBlocks && blockReasons
          ? '<div>Block reasons: ' + blockReasons + '</div>'
          : '';
      return '<article class="candidate"><span class="tier tier-' + tier + '">Tier ' + tier + '</span><strong>' + c.name + '</strong><div>Queue ' + (c.priorityQueue || '—') + ' · action ' + (c.recommendedAction || '—') + ' · eligible ' + (c.eligibleForMediaPipeline ? 'yes' : 'no') + '</div><div>Locava score ' + c.locavaScore + ' · priority ' + priority + ' · media ' + mediaScore + ' · availability ' + mediaAvailability + '</div><div>' + (c.primaryCategory || 'other') + ' · ' + (c.categories || []).join(', ') + '</div><div>' + c.lat + ', ' + c.lng + '</div><div>Sources: ' + (c.rawSources || []).join(', ') + '</div><div>' + links + '</div><div>Score reasons: ' + (c.debug?.scoreReasons || []).join(', ') + '</div><div>Tier reasons: ' + (c.debug?.tierReasons || []).join(', ') + '</div>' + extra + '</article>';
    }
    function renderResult(data) {
      const totals = data.totals || {};
      const tiers = data.totalsByTier || {};
      const warningLines = [...(data.warnings || [])];
      if (data.timeout) warningLines.unshift('Run timed out before discovery completed.');
      if (data.partial && data.partialReason === 'LIMIT_REACHED_BEFORE_ALL_BUCKETS') {
        warningLines.unshift('Partial because enough candidates were found before all buckets completed.');
      } else if (data.partial && data.partialReason === 'SOME_BUCKETS_TIMED_OUT') {
        warningLines.unshift('Some buckets timed out, but run completed with enough candidates.');
      } else if (data.partial) {
        warningLines.unshift('Partial candidate list returned.');
      }
      if (data.mode === 'fast_smoke' && (data.elapsedMs ?? 0) > 10000) {
        warningLines.unshift('Fast smoke run exceeded 10s.');
      }
      if ((totals.returnedCandidates ?? 0) === 0) warningLines.unshift('No candidates returned.');
      if (data.mode === 'fast_targeted' && (data.eligibleCandidates || []).length === 0) {
        warningLines.unshift('Targeted discovery returned no eligible candidates.');
      }
      $('summary').innerHTML = [
        ['Mode', data.mode || 'fast_targeted'],
        ['Eligible', totals.eligibleCandidates ?? (data.eligibleCandidates || []).length],
        ['Blocked', totals.blockedCandidates ?? (data.blockedCandidates || []).length],
        ['P0', totals.p0 ?? 0],
        ['P1', totals.p1 ?? 0],
        ['P2', totals.p2 ?? 0],
        ['P3', totals.p3 ?? 0],
        ['State', data.stateName + (data.stateCode ? ' (' + data.stateCode + ')' : '')],
        ['Returned', totals.returnedCandidates ?? 0],
        ['Raw', totals.rawCandidates ?? 0],
        ['Deduped', totals.dedupedCandidates ?? 0],
        ['Rejected', totals.rejectedCandidates ?? 0],
        ['Elapsed ms', data.elapsedMs ?? 0],
        ['Timeout', data.timeout ? 'yes' : 'no'],
        ['Partial', data.partial ? 'yes' : 'no'],
        ['Partial reason', data.partialReason || '—'],
        ['Bucket timeouts', data.bucketTimeoutCount ?? 0],
        ['Buckets completed', data.bucketCompletedCount ?? 0],
        ['Limit reached', data.limitReached ? 'yes' : 'no']
      ].map(([k,v]) => '<div class="card"><strong>' + k + '</strong><div>' + v + '</div></div>').join('');
      $('warnings').innerHTML = warningLines.map((line) => '<div class="warn">' + line + '</div>').join('') || 'No quality warnings.';
      $('tierSummary').innerHTML = Object.entries(tiers).map(([k,v]) => '<div class="card"><strong>Tier ' + k + '</strong><div>' + v + '</div></div>').join('');
      $('categorySummary').innerHTML = Object.entries(data.totalsByPrimaryCategory || {}).map(([k,v]) => '<div class="card"><strong>' + k + '</strong><div>' + v + '</div>').join('');
      $('bucketBreakdown').textContent = JSON.stringify(data.bucketBreakdown || [], null, 2);
      $('mediaSignalSummary').textContent = JSON.stringify(data.mediaSignalSummary || {}, null, 2);
      const all = data.candidates || [];
      $('runMediaNow').innerHTML = (data.topPriorityCandidates || []).slice(0, 20).map((c) => candidateCard(c, { showPriority: true })).join('');
      $('runMediaLater').innerHTML = (data.backlogCandidates || []).filter((c) => c.priorityQueue === 'P2').slice(0, 20).map((c) => candidateCard(c, { showPriority: true })).join('');
      $('backlogCandidates').innerHTML = (data.backlogCandidates || []).filter((c) => c.priorityQueue === 'P3').slice(0, 20).map((c) => candidateCard(c, { showPriority: true })).join('');
      $('pipelineCandidates').innerHTML = (data.eligibleCandidates || data.topCandidatesForMediaPipeline || []).slice(0, 20).map((c) => candidateCard(c, { showPriority: true })).join('');
      $('blockedCandidates').textContent = JSON.stringify((data.blockedCandidates || []).slice(0, 50).map((c) => ({ name: c.name, blockReasons: c.blockReasons || c.pipelineBlockReasons, priorityQueue: c.priorityQueue, recommendedAction: c.recommendedAction })), null, 2);
      $('tierA').innerHTML = all.filter((c) => c.candidateTier === 'A').slice(0, 20).map(candidateCard).join('');
      $('tierB').innerHTML = all.filter((c) => c.candidateTier === 'B').slice(0, 20).map(candidateCard).join('');
      $('tierC').innerHTML = all.filter((c) => c.candidateTier === 'C').slice(0, 20).map(candidateCard).join('');
      $('candidates').innerHTML = all.slice(0, 50).map(candidateCard).join('');
      $('rejected').textContent = JSON.stringify((data.rejected || []).slice(0, 50), null, 2);
      $('sourceTimings').textContent = JSON.stringify((data.sourceTimings || []).sort((a,b) => b.elapsedMs - a.elapsedMs).slice(0, 12), null, 2);
      $('runMeta').textContent = 'runId=' + (runId || '—') + ' dryRun=' + data.dryRun + ' sources=' + (data.sourcesUsed || []).join(',');
    }
    async function refreshRun() {
      if (!runId) return;
      const run = await fetch('/dev/place-candidates/api/run/' + encodeURIComponent(runId)).then((res) => res.json());
      if (run.status === 'running') return;
      stopLive();
      if (run.status === 'failed') {
        $('runMeta').textContent = run.error || 'Run failed';
        return;
      }
      if (run.result) renderResult(run.result);
    }
    $('runBtn').onclick = async () => {
      const btn = $('runBtn');
      btn.disabled = true;
      btn.textContent = 'Running…';
      $('runMeta').textContent = 'Starting…';
      $('summary').innerHTML = '';
      $('warnings').textContent = '';
      $('tierSummary').innerHTML = '';
      $('categorySummary').innerHTML = '';
      $('pipelineCandidates').innerHTML = '';
      $('tierA').innerHTML = '';
      $('tierB').innerHTML = '';
      $('tierC').innerHTML = '';
      $('candidates').innerHTML = '';
      $('rejected').textContent = '';
      $('sourceTimings').textContent = '';
      $('bucketBreakdown').textContent = '';
      $('mediaSignalSummary').textContent = '';
      $('runMediaNow').innerHTML = '';
      $('runMediaLater').innerHTML = '';
      $('backlogCandidates').innerHTML = '';
      $('blockedCandidates').textContent = '';
      try {
        const start = await fetch('/dev/place-candidates/api/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stateName: $('stateName').value,
            stateCode: $('stateCode').value,
            mode: $('mode').value || 'fast_targeted',
            limit: Number($('limit').value || 50),
            totalTimeoutMs: Number($('totalTimeoutMs').value || 10000),
            perQueryTimeoutMs: Number($('perQueryTimeoutMs').value || 2500),
            minScore: Number($('minScore').value || 20),
            includeMediaSignals: $('includeMediaSignals').checked,
            sources: [$('source').value || 'wikidata'],
            dryRun: true
          })
        }).then((res) => res.json());
        if (!start.runId) throw new Error(start.error || 'Failed to start run');
        runId = start.runId;
        $('runMeta').textContent = 'runId=' + runId + ' status=running';
        startLive(runId);
        while (true) {
          const run = await fetch('/dev/place-candidates/api/run/' + encodeURIComponent(runId)).then((res) => res.json());
          $('runMeta').textContent = 'runId=' + runId + ' status=' + (run.status || 'unknown');
          if (run.status !== 'running') {
            await pollRunLogs();
            await refreshRun();
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        $('runMeta').textContent = error instanceof Error ? error.message : String(error);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate state candidates';
      }
    };
  </script>
</body>
</html>`;
}
