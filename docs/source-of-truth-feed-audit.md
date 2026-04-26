# Source-of-Truth Feed Audit (Bootstrap / Page / Detail)

Date: 2026-04-20  
Scope: `GET /v2/feed/bootstrap`, `GET /v2/feed/page`, `GET /v2/feed/items/:postId/detail`.

## Audit Summary

Feed was only partially source-integrated before this phase.  
Bootstrap/page/detail contracts were stable and pressure-safe, but repository data paths were mostly deterministic.

This phase integrates the safest remaining slice:

- real source candidate retrieval for bootstrap/page via bounded Firestore adapter with strict timeout fallback

Detail remains deterministic for now.

## Route-by-Route Parity Status

### `GET /v2/feed/bootstrap`

Before this phase:

- first-render candidates came from deterministic `FeedRepository.getBootstrapCandidates`
- `sessionHints` deferred path was deterministic

Now:

- first-render candidate retrieval can use Firestore (`posts` ordered by `createdAtMs`, bounded scan)
- deterministic fallback remains on timeout/unavailable source
- contract unchanged

Real vs synthetic fields:

- real-backed when source enabled: candidate slot ordering and freshness timestamp basis
- still synthetic: `postId` pattern (`{viewer}-feed-post-{slot}`), some card author/social/viewer internals derived from existing deterministic shaping path

### `GET /v2/feed/page`

Before this phase:

- page candidates deterministic via offset cursor + seeded slots

Now:

- candidate retrieval page can use same bounded Firestore adapter with cursor-offset slicing
- deterministic fallback on timeout/unavailable source
- contract unchanged (`requestKey`, cursor fields, sort semantics)

Real vs synthetic fields:

- real-backed when source enabled: candidate page ordering/freshness basis
- synthetic: slot-derived post id mapping and card internals that still flow through deterministic feed shaping

### `GET /v2/feed/items/:postId/detail`

Current status:

- still deterministic in `FeedRepository.getPostDetail` and related summary helpers
- no Firestore source adapter on detail path yet
- route remains pressure-safe via route/entity cache + dedupe + concurrency + deferred timeout discipline

## Shared Entity Reuse Status

All three routes continue reusing canonical shared entities:

- `PostCardSummary`
- `AuthorSummary`
- `SocialSummary`
- `ViewerPostState`
- `PostDetail`

No parallel feed-specific entity schema was introduced.

## Fan-Out and Pressure Risks

Remaining risk profile after this phase:

- bootstrap/page: no per-item detail fan-out (safe)
- detail: still deterministic, but no new fan-out introduced
- cache layers can mask deterministic shaping under warm traffic; cold diagnostics remain required for parity truth

No new invalidation storms introduced.

## Cache and Dedupe Masking Assessment

- route cache + entity cache still collapse repeated calls near-zero reads
- this can hide unfinished detail source integration if only warm paths are observed
- parity checks must include explicit cold runs and diagnostics inspection

## Mutation Coherence Assessment

- like/save/comment-related viewer/social overlays still flow through existing mutation state + invalidation layers
- coherence remains bounded and diagnostics-visible
- because feed detail data path is still deterministic, this is coherence-through-overlay, not full source-of-truth mutation reflection

## Safest Remaining Feed Slice (Post-Phase)

Still incomplete and safest next feed integration target:

- feed detail source path (`getPostDetail` and minimal supporting summary path) with strict timeout fallback and no contract changes

Not recommended in same phase as candidate integration to avoid multi-axis risk.

## Pressure-Aware Conclusion

Feed now has partial source integration on the highest-frequency candidate lanes (bootstrap/page), with fallback safety preserved.  
Feed detail remains deterministic, so feed is improved but not fully parity-complete yet.
