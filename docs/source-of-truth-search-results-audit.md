# Source-of-Truth Audit: Search Results (Posts)

Date: 2026-04-20

## Current State (Before This Slice)

`search.results.get` candidate retrieval in `SearchRepository` is deterministic/mock-backed:

- synthetic total size from seeded hash
- synthetic post IDs (`{viewerId}-feed-post-{slot}`)
- no real source-of-truth query path

Service/orchestrator guardrails are already strong and should be preserved:

- service dedupe + concurrency cap
- route cache for identical pages
- shared `PostCardSummary` shaping via `FeedService.loadPostCardSummaryBatch`
- request identity metadata (`requestKey`, `queryEcho`, `cursorIn`)

## Real Query Path Decision

This slice integrates **candidate retrieval only** via Firestore adapter.

Collection/query strategy:

- collection: `posts`
- indexed prefix field: `searchText` (lowercased, index-friendly)
- query: `where(searchText >= q && searchText <= q+\uf8ff).orderBy(searchText).limit(scanLimit)`
- selected fields only: `feedSlot`, `searchRank`, `updatedAtMs`

## Why This Query Shape

- 1 bounded query keeps query budget safe
- avoids per-result detail reads/fan-out
- returns minimal ranking metadata only
- keeps candidate stage simple (not a ranking engine rewrite)

## Bounded Query/Read Safety

- strict route limit already bounded (`4..12`)
- adapter scan cap bounded (`<= 60`)
- candidate page uses offset cursor slicing over bounded candidate set
- deterministic fallback path remains available on timeout/unavailable source

## Highest Read Amplification Risks

Risks:

- running separate queries per result
- hydrating post detail per candidate
- unbounded search scans

Mitigations in this slice:

- single bounded candidate query
- no detail hydration in repository
- candidate IDs only, then existing shared card batch path

## What Route Intentionally Refuses To Load

- full post detail payloads
- comments trees
- heavy media ladders
- ranking-debug trees
- non-post search modes

## Fallback + Timeout Discipline

- Firestore candidate query has strict timeout cap
- on timeout/source failure: record timeout/fallback diagnostics and use deterministic candidate path
- route contract and response semantics remain unchanged

## Budget Risk Assessment

Most at-risk metric: latency p95 under failing/slow source.

Mitigation:

- aggressive adapter timeout + immediate fallback
- preserve route/entity cache + dedupe behavior so warm repeats collapse reads/queries

No route policy relaxation is planned in this slice.
