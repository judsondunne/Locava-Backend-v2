# Real User Replay Analysis (2026-05-04)

## Scope

This analysis reconstructs the observed native-app startup and follow-on route flow from:

- the real-user backend log excerpt provided in the task prompt
- existing repo-local health/perf artifacts, especially:
  - `artifacts/health/native-session-sim-latest.json`
  - `docs/health/native-session-route-flow-2026-05-04.md`
  - `docs/perf-results/app-action-trace.json`

No standalone raw attached log file was materialized in the workspace, so this report is grounded in the provided excerpt plus the repo-local artifacts above.

## Reconstructed Timeline

Relative to the first observed request:

| Offset | Event | Notes |
| --- | --- | --- |
| `0ms` | `GET /v2/feed/for-you/simple?limit=5` | First home feed request. Observed first-load problem: about `1454ms`, `125 reads`, `7 writes`, `7 queries`, budget violations for latency, reads, and queries. |
| `+288ms` | `GET /v2/auth/session` | Overlapped with feed first paint. |
| `+1595ms` | `GET /api/config/version` | Legacy compat startup route. |
| `+1958ms` | `POST /v2/posts/details:batch` | `hydrationMode=playback`, `surface=post_detail_store`, `requestGroup=prefetch`, first visible + next `1-2` posts. |
| `+3232ms` | `POST /api/analytics/v2/events` | Accepted with HTTP `202`, but BigQuery publish failed later due permission denial. |
| `+3744ms` | `POST /v2/posts/details:batch` | Next playback prefetch batch, about `3` posts. |
| `+8793ms` | `POST /v2/posts/details:batch` | Larger playback prefetch batch; observed zero reads but large payload. |
| `+9314ms` | `POST /v2/auth/push-token` | Startup side-effect; should not contend with visible/playback work. |
| `+13326ms` | `GET /v2/feed/for-you/simple?limit=5&cursor=<prevCursor>` | Next feed page; observed about `1059ms`, `122 reads`, even with `deckHit=true` and `deckSource=memory`. |
| `+13466ms` | `POST /v2/posts/details:batch` | Overlapped with next-page feed request. |
| `+14386ms` | `POST /v2/posts/details:batch` | Additional playback prefetch after next-page response. |

## Later Route Clusters

### Search surface

- `GET /v2/search/home-bootstrap`
- Concurrent preview fanout:
  - `GET /v2/mixes/hiking/preview?limit=3&activity=hiking`
  - `GET /v2/mixes/cafe/preview?limit=3&activity=cafe`
  - other observed mix previews in the same cluster

### Achievements / profile / social cluster

- `GET /v2/achievements/leaderboard/xp_league`
- `GET /v2/achievements/leagues`
- `GET /v2/achievements/hero`
- `GET /v2/profiles/<viewerId>/following?limit=200`
- `GET /v2/achievements/bootstrap`
- `GET /v2/achievements/leaderboard/xp_global`
- `GET /v2/achievements/snapshot`
- `GET /v2/social/suggested-friends?surface=generic&limit=10&sortBy=postCount&userId=<viewerId>`

### Collections cluster

- `GET /v2/collections/<collectionId>/recommended?limit=10`
- Followed by post-detail prefetch for recommended cards

## Extracted Observations

### Request starts / completes

From the provided excerpt, the minimum observed request flow that must be replayed is the ordered sequence above. The overlapping relationships that matter most:

- feed first paint starts before auth session completes
- detail prefetch begins only after feed IDs exist, but still inside the startup burst
- analytics and push-token are background/non-visual side-effects inside the same session
- next-page feed and detail prefetch overlap
- search home and mix previews overlap
- achievements/profile/social routes overlap

### Feed summary signals

Observed from the excerpt and existing repo diagnostics:

- first `for-you simple` page:
  - about `1454ms`
  - about `125 reads`
  - `7 writes`
  - `7 queries`
  - budget violations:
    - `latency_p95_exceeded`
    - `db_reads_exceeded`
    - `db_queries_exceeded`
- next `for-you simple` page:
  - about `1059ms`
  - about `122 reads`
  - still expensive despite `deckHit=true` and `deckSource=memory`

### Post detail media summary / batch behavior

- `POST /v2/posts/details:batch` is often fast because it serves from cache/post-card data
- payloads are repeatedly too large for prefetch:
  - about `68KB`
  - about `76KB`
  - at least one `payload_bytes_exceeded`
- one later prefetch was especially suspicious:
  - zero reads
  - still a large payload
  - indicates duplicate prefetch or over-hydrated cached payloads
- feed card video summaries and detail playback summaries diverged:
  - feed simple showed HLS path hints present
  - selected variant counts still choosing `original` in feed simple
  - details batch sometimes repaired cached video media and chose HLS

### Pool refresh / warmer activity

- near-me quick refresh: about `20s`
- near-me full refresh: about `16s`
- mixes scheduled refresh: about `600 reads` / `10.7s`
- these must remain in background lanes and must not compete with visible/playback traffic

### BigQuery analytics failure

- route accepted analytics with HTTP `202`
- publish path later failed with:
  - `Permission bigquery.tables.updateData denied`
- current product behavior is non-blocking, but data silently does not land unless health/debug surfaces expose degraded state

### Budget violations / route hotspots

- `/v2/feed/for-you/simple` first page:
  - latency budget violation
  - read budget violation
  - query budget violation
- `/v2/feed/for-you/simple` next page:
  - still far over warm-deck expectations
- `/v2/posts/details:batch`
  - at least one `payload_bytes_exceeded`
- `/v2/search/home-bootstrap`
  - about `729ms`
  - `56 reads`
  - `11 queries`
- `/v2/collections/:id/recommended`
  - about `1946ms`
  - about `177KB`
  - about `230 reads`
  - violations for latency, reads, and payload bytes
- `/v2/profiles/:id/following?limit=200`
  - about `528ms`
  - tiny payload relative to cost

## Explicit Problem List From Observed Logs

1. `/v2/feed/for-you/simple` first load took about `1454ms` with `125 reads`, `7 writes`, `7 queries`, and violated `latency_p95_exceeded`, `db_reads_exceeded`, `db_queries_exceeded`.
2. `/v2/feed/for-you/simple` next page still took about `1059ms` with `122 reads` even though `deckHit=true` and `deckSource=memory`.
3. `posts.details:batch` is often fast from cache but repeatedly sends very large payloads, including about `68KB`, `76KB`, and other large responses.
4. One `posts.details:batch` hit `payload_bytes_exceeded`.
5. Video card summaries show HLS path hints present but selected variant counts choosing `original` in feed simple; details batch sometimes repairs cached video media and chooses HLS.
6. BigQuery analytics accepts HTTP `202` but publish fails with `Permission bigquery.tables.updateData denied`.
7. Startup warmers are heavy:
   - near-me quick refresh around `20s`
   - near-me full around `16s`
   - mixes scheduled refresh around `600 reads` / `10.7s`
8. Search home bootstrap took about `729ms` with `56 reads` / `11 queries`.
9. Collections recommended is extremely bad: about `1946ms`, `177KB` payload, `230 reads`, and violations for latency/db reads/payload bytes.
10. `profile following limit=200` took about `528ms` for a tiny payload.
11. Achievements/profile/social route clusters fire in parallel and need explicit route-lane correctness, concurrency safety, and cache expectations.
12. Debug logs are too noisy: `POST_DETAILS_BATCH_PLAYBACK_CACHE_DECISION` repeats aggressively and should be sampled or debug-gated.

## Replay Requirements Derived From Forensics

- Use the exact startup route order above.
- Preserve relative timing gaps.
- Preserve overlap:
  - feed initial before auth completion
  - detail prefetch while scrolling
  - page-2 feed overlapping with detail prefetch
  - search home with preview fanout
  - achievements/profile/social fanout
- Use the first feed cursor for the second page request.
- Use actual feed-returned post IDs for detail-batch bodies.
- Detect duplicate sliding-window prefetches and repeated payload waste.
- Record feed/detail video variant consistency for the same post IDs.
- Separate visible/opened asset readiness from total route latency.
