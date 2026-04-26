# Search Users / Profiles (v2)

## Route

- `GET /v2/search/users?q=...&cursor=...&limit=...`
- Route name: `search.users.get`
- Cutover: internal-only (`search` surface gating)

## Purpose

Provide fast, isolated user/profile search results without mixing post/place/collection payloads.

## Shared Entity Reuse

- `items` are `AuthorSummary[]` only.
- No parallel user-result schema is introduced.
- Author summaries are loaded through shared entity cache (`user:{userId}:summary`).

## Follow-State + Mutation Consistency

- Response includes `viewer.followingUserIds` for returned result user IDs.
- Follow/unfollow mutation state is reflected in user search reads.
- This keeps read consistency without heavy enrichment fan-out.

## Query-Churn Strategy

- `requestKey` + `queryEcho` + cursor echo support client stale suppression.
- Service-level in-flight dedupe keyed by `(viewer, normalized query, cursor, limit)`.
- Concurrency cap on repo lane to prevent request storms.
- Route cache keyed by identical query page inputs for repeat calls.

## Payload Discipline

- Strict query/limit bounds:
  - `q`: 2..80 chars
  - `limit`: 5..12 (default 8)
- No nested heavy payloads (no posts, no social graph blobs).

## Intentionally Excluded

- post lists under users
- follower graph payloads
- profile detail sections
- mixed-mode search (posts + users + places + collections)

## Route Policy

- Priority: `critical_interactive`
- Latency: `p50 85ms`, `p95 200ms`
- DB budget: `maxReadsCold 24`, `maxQueriesCold 3`
- Payload: `target 10KB`, `max 20KB`
- Cache expectation: `required`
- Concurrency expectation: dedupe enabled, max concurrent repo ops `4`

## Why This Avoids Bog-Down

- Narrow entity-only payload avoids heavy transfer/serialization.
- No per-result post/social fan-out.
- Deduped + cached query pages reduce repeat pressure under rapid typing/submit churn.

## Local Curl Commands

Denied/internal-only check:

```bash
curl -i "http://127.0.0.1:8080/v2/search/users?q=creator"
```

Success:

```bash
curl -sS \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  "http://127.0.0.1:8080/v2/search/users?q=creator&limit=8"
```

Repeat same query:

```bash
curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" \
  "http://127.0.0.1:8080/v2/search/users?q=creator&limit=8"
curl -sS -H "x-viewer-id: internal-viewer" -H "x-viewer-roles: internal" \
  "http://127.0.0.1:8080/v2/search/users?q=creator&limit=8"
```

Pagination:

```bash
curl -sS \
  -H "x-viewer-id: internal-viewer" \
  -H "x-viewer-roles: internal" \
  "http://127.0.0.1:8080/v2/search/users?q=creator&limit=8&cursor=cursor:8"
```

Diagnostics:

```bash
curl -sS "http://127.0.0.1:8080/diagnostics?limit=50"
```

## Tradeoffs

- Follow-state is projected as a lightweight viewer list, not embedded heavy relationship objects per row.
- Some route-level stale windows remain bounded by TTL by design to avoid broad invalidation storms.
