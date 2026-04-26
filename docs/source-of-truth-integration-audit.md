# Source-of-Truth Integration Audit (v2)

Date: 2026-04-20

## Repository Reality Check

Current repository layer is largely deterministic/mock-backed:

- `src/repositories/surfaces/search-users.repository.ts` (deterministic corpus)
- `src/repositories/surfaces/search.repository.ts` (deterministic post-id/rank generation)
- `src/repositories/surfaces/profile.repository.ts` (seeded profile/grid data)
- `src/repositories/surfaces/profile-post-detail.repository.ts` (seeded detail/comments)
- `src/repositories/surfaces/feed.repository.ts` (seeded feed card/detail/social/viewer)
- `src/repositories/surfaces/auth-bootstrap.repository.ts` (seeded session/bootstrap)

Mutation state is currently in-memory (`mutation-state.repository.ts`) by design for this hardening stage.

## Safe Integration Priority

Chosen order for controlled real-data adoption:

1. `search.users` (selected in this phase)
2. `search.results` (posts)
3. profile bootstrap/detail
4. feed bootstrap/page/detail

Reasoning:

- `search.users` has smallest payload and narrowest entity (`AuthorSummary`)
- bounded limits (5..12) and existing query-churn guardrails are already strict
- no post/media fan-out required
- easiest place to validate Firestore integration without risking feed/detail latency regressions

## Likely Firestore Patterns

For `search.users`:

- Collection: `users`
- Prefix search fields: `searchHandle`, `searchName` (lowercased/index-friendly)
- Selected fields only: `name`, `handle`, `profilePic/profilePicture/photo`
- Follow projection lookup: `users/{viewerId}/following/{targetUserId}`

## Read Amplification Risks

Highest-risk patterns when switching to real reads:

- duplicate enrich-by-id after primary query (N+1)
- over-broad scans from unbounded prefix queries
- per-result detail fan-out
- follow-state lookups as one query per row

Mitigation in selected slice:

- max 2 search queries + 1 batched follow lookup
- strict scan caps and response limit caps
- no per-result detail/profile expansion
- `AuthorSummary` entity cache reuse

## Budgets Most At Risk

Most sensitive under real data:

- `search.users.get` DB query/read budget
- `search.results.get` DB read/query if post candidate generation moves to Firestore
- profile/feed detail routes due to larger shape and higher fan-out risk

## Cache/Entity Layers That Absorb Risk

- route cache for identical query pages
- in-flight dedupe for same query key
- concurrency lane caps (`search-users-page-repo`)
- entity cache (`user:{userId}:summary`) to avoid repeated shaping

## Intentionally Deferred in This Phase

Deferred to avoid scope explosion and guardrail regression:

- `search.results` post candidate source-of-truth integration
- profile repositories source-of-truth wiring
- feed repositories source-of-truth wiring
- auth/bootstrap source-of-truth wiring

This phase integrates only `search.users` to prove the pattern safely.
