/**
 * Undiscovered Reels Dashboard — /admin/undiscovered/reels
 *
 * Paste collected reels (JSON from the IG extension / downloader), run AI
 * location extraction + spot matching + attribution, review the results, then
 * write to the `undiscoveredReels` collection. Read-only until you press Write.
 */
export function renderUndiscoveredReelsDashboardPage(): string {
  const api = "/admin/undiscovered/api/reels";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Undiscovered Reels</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    .shell{max-width:1200px;margin:0 auto;padding:20px 16px 48px}
    h1{font-size:24px;margin:0 0 2px}
    .sub{color:#94a3b8;font-size:13px;margin:0 0 16px}
    h2{font-size:12px;margin:0 0 10px;color:#cbd5e1;text-transform:uppercase;letter-spacing:.04em}
    .panel{border:1px solid #334155;border-radius:12px;background:#111827;padding:16px;margin:14px 0}
    button{padding:8px 14px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:13px;cursor:pointer;font-weight:600;margin:2px 6px 2px 0}
    button.secondary{background:#334155}
    button.ok{background:#166534}
    button:disabled{opacity:.5;cursor:not-allowed}
    textarea{width:100%;min-height:150px;background:#020617;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-family:ui-monospace,Menlo,monospace;font-size:12px;padding:10px;box-sizing:border-box}
    label{font-size:13px;color:#cbd5e1;display:inline-flex;align-items:center;gap:6px;margin-right:14px}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:12px}
    .stat-box{background:#020617;border:1px solid #1f2937;border-radius:8px;padding:8px}
    .stat-label{font-size:10px;color:#64748b;text-transform:uppercase}
    .stat-value{font-size:20px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border-top:1px solid #334155;padding:7px 8px;text-align:left;vertical-align:middle}
    th{background:#0b1220;color:#94a3b8;font-weight:600;position:sticky;top:0}
    .table-wrap{max-height:560px;overflow:auto;border:1px solid #1f2937;border-radius:8px}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #334155;font-size:10px;color:#cbd5e1;background:#0b1220}
    .pill.match{border-color:#166534;color:#86efac}
    .pill.ai{border-color:#854d0e;color:#fcd34d}
    .pill.none{border-color:#475569;color:#94a3b8}
    .avatar{width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;background:#334155}
    a{color:#93c5fd;text-decoration:none}
    #statusBar{padding:10px 12px;border-radius:8px;border:1px solid #334155;background:#0b1220;font-size:13px;margin:10px 0}
    #statusBar.ok{border-color:#166534;background:#052e16;color:#86efac}
    #statusBar.err{border-color:#b91c1c;background:#450a0a;color:#fecaca}
    code{background:#020617;padding:1px 5px;border-radius:4px;color:#93c5fd}
    .muted{color:#64748b;font-size:12px}
  </style>
</head>
<body>
  <div class="shell">
    <h1>🎬 Undiscovered Reels</h1>
    <p class="sub">Paste collected reels → AI extracts the place, matches it to an uploaded Vermont spot, captures creator credit → write to <code>undiscoveredReels</code>. API: <code>${api}</code></p>
    <div id="statusBar">Checking pipeline…</div>

    <div class="panel">
      <h2>Auto-fetch reels by spot</h2>
      <p class="muted" style="margin-top:0">Pull reels straight from Instagram that mention your spots — no pasting. Leave the box empty to auto-pull the top spots from Firestore, or list spot names (one per line). Needs a session cookie below (Instagram blocks anonymous server requests).</p>
      <textarea id="fetchSpots" style="min-height:80px" placeholder="Warren Falls&#10;Texas Falls&#10;Quechee Gorge"></textarea>
      <div style="margin-top:10px">
        <label>Top-N if empty <input type="number" id="fetchTopN" value="10" min="1" max="50" style="width:64px;padding:6px;border-radius:6px;border:1px solid #334155;background:#020617;color:#e2e8f0"/></label>
        <label><input type="checkbox" id="fetchWriteToggle"/> Write to production <code>undiscoveredReels</code></label>
        <button id="fetchRun">Fetch &amp; geolocate</button>
      </div>
    </div>

    <div class="panel">
      <h2>Collected reels (JSON)</h2>
      <p class="muted" style="margin-top:0">Array of reels. Accepts the extension's export or a simple shape: <code>[{"shortcode":"Cx..","caption":"..","ownerUsername":"..","ownerFullName":"..","ownerProfilePicUrl":"..","videoUrl":"..","thumbnailUrl":".."}]</code></p>
      <textarea id="reelsJson" placeholder='[{"shortcode":"Cx001","caption":"Warren Falls swimming hole in Vermont","ownerUsername":"vt_hiker"}]'></textarea>
      <div style="margin-top:10px">
        <label><input type="checkbox" id="resolveToggle" checked/> Verify creators via Instagram</label>
        <label><input type="checkbox" id="writeToggle"/> Write to production <code>undiscoveredReels</code></label>
        <button id="run">Geolocate reels</button>
        <button class="secondary" id="sample">Load sample</button>
      </div>
      <details style="margin-top:10px">
        <summary class="muted" style="cursor:pointer">Instagram session cookie (optional — needed for reliable creator verification from a server)</summary>
        <input id="igCookie" type="text" placeholder="sessionid=...; csrftoken=...; ds_user_id=..." style="width:100%;margin-top:8px;padding:8px;border-radius:6px;border:1px solid #334155;background:#020617;color:#e2e8f0;font-family:ui-monospace,monospace;font-size:12px;box-sizing:border-box"/>
        <p class="muted" style="margin:6px 0 0">Without cookies, Instagram blocks anonymous requests — creators then come from the pasted data. Paste a logged-in session cookie header to verify against IG.</p>
      </details>
    </div>

    <div class="panel">
      <h2>Results</h2>
      <div class="stat-grid" id="stats"></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Reel</th><th>Extracted place</th><th>Location</th><th>Matched spot</th><th>Creator</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
  </div>

<script>
const API = ${JSON.stringify(api)};
const $ = (id) => document.getElementById(id);
function setStatus(m,k){ const b=$('statusBar'); b.textContent=m; b.className=k||''; }

async function api(path, opts){
  const res = await fetch(API+path, Object.assign({headers:{'Content-Type':'application/json'}}, opts));
  const j = await res.json().catch(()=>({}));
  if(!res.ok || j.ok===false) throw new Error((j.error&&j.error.message)||('HTTP '+res.status));
  return j.data;
}

function normalizeReels(raw){
  // Accept the extension's export (url/caption) or the direct shape.
  return raw.map(r => {
    const url = r.reelUrl || r.url || r.permalink || '';
    let shortcode = r.shortcode || '';
    if(!shortcode && url){ const m = url.match(/\\/reel\\/([^/?#]+)/); if(m) shortcode = m[1]; }
    return {
      shortcode,
      caption: r.caption || r.title || '',
      reelUrl: url || undefined,
      videoUrl: r.videoUrl || null,
      thumbnailUrl: r.thumbnailUrl || r.thumbnail || null,
      ownerUsername: r.ownerUsername || r.username || r.owner && r.owner.username || null,
      ownerFullName: r.ownerFullName || r.fullName || r.owner && r.owner.full_name || null,
      ownerProfilePicUrl: r.ownerProfilePicUrl || r.profilePicUrl || r.owner && r.owner.profile_pic_url || null,
      // Pass the raw owner/media object through so the backend can extract the
      // authoritative creator (username + name + avatar as one matched set).
      ownerRaw: (r.owner && typeof r.owner === 'object') ? r.owner : (r.node || r.media || null),
    };
  }).filter(r => r.shortcode);
}

const SRC_PILL = {spot_match:['match','spot'],ai_estimate:['ai','AI est'],geocode:['ai','geocode'],none:['none','none']};

function renderRows(records){
  $('rows').innerHTML = records.map(r=>{
    const l=r.location, c=r.creator;
    const [cls,label]=SRC_PILL[l.source]||['none',l.source];
    const spot = l.matchedSpotId ? '<code>'+l.matchedSpotId.slice(0,20)+'</code>' : '<span class="muted">—</span>';
    const coords = (l.lat!=null&&l.lng!=null)?('<br><span class="muted">'+l.lat.toFixed(4)+', '+l.lng.toFixed(4)+'</span>'):'';
    const av = c.profilePicUrl ? '<img class="avatar" src="'+c.profilePicUrl+'" onerror="this.style.display=\\'none\\'"/>' : '';
    const creator = c.profileUrl ? (av+'<a href="'+c.profileUrl+'" target="_blank" rel="noopener">'+(c.username||'profile')+'</a>') : '<span class="muted">—</span>';
    const reelLink = '<a href="'+r.reelUrl+'" target="_blank" rel="noopener">'+r.shortcode+'</a>';
    return '<tr><td>'+reelLink+'</td>'
      +'<td>'+(l.extractedName||'<span class="muted">(none)</span>')+'</td>'
      +'<td><span class="pill '+cls+'">'+label+'</span>'+coords+'</td>'
      +'<td>'+spot+'</td>'
      +'<td>'+creator+'</td></tr>';
  }).join('') || '<tr><td colspan="5" class="muted" style="padding:10px">No results yet.</td></tr>';
}

function renderStats(c){
  const items=[['total',c.total],['spot matched',c.spotMatched],['AI estimate',c.aiEstimate],['no location',c.noLocation],['with creator',c.withCreator]];
  $('stats').innerHTML=items.map(([k,v])=>'<div class="stat-box"><div class="stat-label">'+k+'</div><div class="stat-value">'+v+'</div></div>').join('');
}

$('run').onclick = async () => {
  let reels;
  try{ reels = normalizeReels(JSON.parse($('reelsJson').value)); }
  catch(e){ setStatus('Invalid JSON: '+e.message,'err'); return; }
  if(reels.length===0){ setStatus('No reels with a shortcode/URL found.','err'); return; }
  const write = $('writeToggle').checked;
  try{
    $('run').disabled=true; setStatus((write?'Geolocating + writing ':'Geolocating ')+reels.length+' reel(s) via AI…');
    const d = await api('/geolocate',{method:'POST',body:JSON.stringify({
      region:'VT', write, reels,
      resolveCreators: $('resolveToggle').checked,
      instagramCookieHeader: $('igCookie').value.trim() || undefined,
    })});
    renderStats(d.counts); renderRows(d.records);
    setStatus((write?('Wrote '+d.written+' of '):'Previewed ')+d.counts.total+' reels — '+d.counts.spotMatched+' matched to spots.','ok');
  }catch(e){ setStatus('Failed: '+e.message,'err'); }
  finally{ $('run').disabled=false; }
};

$('fetchRun').onclick = async () => {
  const cookie = $('igCookie').value.trim();
  if(!cookie){ setStatus('Auto-fetch needs an Instagram session cookie (expand the field under the JSON panel). Instagram blocks anonymous server requests.','err'); return; }
  const spotNames = $('fetchSpots').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  const write = $('fetchWriteToggle').checked;
  try{
    $('fetchRun').disabled=true;
    setStatus('Fetching reels from Instagram'+(spotNames.length?(' for '+spotNames.length+' spot(s)'):' for top spots')+'…');
    const d = await api('/fetch-by-spots',{method:'POST',body:JSON.stringify({
      region:'VT', write,
      topN: Math.max(1, Math.min(50, parseInt($('fetchTopN').value,10)||10)),
      spotNames: spotNames.length ? spotNames : undefined,
      instagramCookieHeader: cookie,
    })});
    if(d.reelsFound===0){ setStatus('Searched '+d.spotsSearched+' spot(s) — '+(d.note||'no reels found.'),'err'); renderRows([]); return; }
    renderStats(d.counts); renderRows(d.records);
    setStatus('Found '+d.reelsFound+' reel(s) across '+d.spotsSearched+' spot(s) — '+d.counts.spotMatched+' matched to spots'+(write?(', wrote '+d.written):'')+'.','ok');
  }catch(e){ setStatus('Fetch failed: '+e.message,'err'); }
  finally{ $('fetchRun').disabled=false; }
};

$('sample').onclick = () => {
  $('reelsJson').value = JSON.stringify([
    {"shortcode":"Cx001","caption":"Chasing Warren Falls in the Mad River Valley 💦 #vermont","ownerUsername":"vt_wanderer","ownerFullName":"Green Mtn Explorer"},
    {"shortcode":"Cx002","caption":"Hiked to Quechee Gorge today, unreal views over the gorge","ownerUsername":"newenglandhikes"},
    {"shortcode":"Cx003","caption":"Texas Falls might be the most underrated spot in VT","ownerUsername":"leafpeeper"},
    {"shortcode":"Cx004","caption":"just good vibes ☀️","ownerUsername":"randomcreator"}
  ], null, 2);
};

api('/health').then(d=>{
  const parts=[];
  parts.push('Gemini '+(d.geminiConfigured?'✓':'✗ (set GEMINI_API_KEY)'));
  parts.push('Firestore '+(d.firestoreEnabled?'✓':'✗'));
  setStatus('Pipeline ready — '+parts.join(' · '), d.geminiConfigured?'ok':'err');
}).catch(e=>setStatus('Health check failed: '+e.message,'err'));
</script>
</body>
</html>`;
}
