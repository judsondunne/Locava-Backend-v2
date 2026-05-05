# Legends System Audit (End-to-End)

Date: 2026-05-05  
Scope: Backend v2 + Native app + posting/finalize + staging + after-post UX + Firestore model + idempotency/perf  
Mode: Audit only (no behavior rewrites, no prod data mutation)

## Executive Summary

The current Legends implementation is **architecturally close** to ship-ready, but not "safe enough as-is" due to a few high-risk correctness/security gaps and several medium-risk lifecycle inconsistencies.

Key conclusions:

- Posting is not blocked by Legends: finalize succeeds first, then Legends commits asynchronously.
- Native does use the staged flow (`/v2/legends/stage-post`) as best-effort, and finalize passes `legendStageId` when present.
- After-post Legends UX depends on polling `GET /v2/legends/after-post/:postId`, with a 90s client poll ceiling.
- Backend commit path is mostly idempotent (`legendProcessedPosts/{postId}` + first-claim create guards).
- **P0**: `DELETE /v2/legends/stage-post/:stageId` lacks owner verification; authenticated users can cancel other users' uncommitted stages if they know/guess IDs.
- **P1**: privacy policy for whether private/friends posts should count toward Legends is not enforced in award logic.
- Two live publish stacks (`/v2/posting/finalize` and `/v2/posts/publish`) create divergence risk if mixed clients are active.

---

## Current Lifecycle Map (Exact Post -> Legend Flow)

## 0) Compose / staging preparation (Native)

1. Compose UI calls `stageLegendsIfNeededBestEffort(...)` when location/activity changes.  
   - File: `Locava-Native/src/features/post/upload/legendsComposeStaging.ts`
2. Signature dedupe (`userId|rounded lat/lng|sorted activities`) avoids repeated stage creation for same payload.  
3. If signature changed and existing stage exists, native best-effort cancels prior stage (`DELETE /v2/legends/stage-post/:stageId`).  
4. Native stores `{stageId, signature}` in Zustand store.  
   - File: `Locava-Native/src/features/post/upload/postLegendsStage.store.ts`

## 1) Share -> upload -> finalize (Native -> Backend)

1. User taps Share (`handleInfoShare`), captures `legendStageId` from store, starts `runPostUpload(...)`.  
   - File: `Locava-Native/src/features/post/PostLayoutLogic.tsx`
2. Posting flow uses v2 endpoints:
   - `POST /v2/posting/upload-session`
   - `POST /v2/posting/media/register`
   - `POST /v2/posting/media/:mediaId/mark-uploaded`
   - `POST /v2/posting/finalize`
   - fallback/recovery: `GET /v2/posting/operations/:operationId`
3. `legendStageId` is sent in finalize payload if available.  
   - Contract field: `PostingFinalizeBodySchema.legendStageId`
   - File: `Locava Backendv2/src/contracts/surfaces/posting-finalize.contract.ts`

## 2) Finalize request handling (Backend)

1. Route validates request (`posting-finalize` contract), auth via viewer context + cutover checks.  
   - File: `Locava Backendv2/src/routes/v2/posting-finalize.routes.ts`
2. `PostingMutationService.finalizePosting(...)`:
   - in-flight dedupe: `dedupeInFlight(posting:finalize:viewer:idempotencyKey)`
   - lock: `withMutationLock(posting-finalize:viewer:sessionId)`
   - operation idempotency in repository
   - canonical post write
3. Immediately primes `legendPostResults/{postId}` as `processing`.
4. Schedules async Legends commit worker (`scheduleLegendsCommit`), does not block finalize response.
   - File: `Locava Backendv2/src/services/mutations/posting-mutation.service.ts`

## 3) Legends commit path (Background)

Branch A (preferred): staged commit

- `legendService.commitStagedPostLegend({stageId, post})`
- Validates stage exists, belongs to same user, status is staged, not expired.
- Runs transaction to:
  - read/modify scope + user stats docs
  - decide awards
  - write award docs, event docs, rank aggregates
  - write `legendPostResults/{postId}` status `complete`
  - create `legendProcessedPosts/{postId}` marker
  - mark stage committed

Branch B (fallback): no stageId

- Reads canonical `posts/{postId}`
- derives scopes from post fields
- creates synthetic stage `legdirect_{postId}`
- calls same commit path

Files:

- `Locava Backendv2/src/domains/legends/legend.service.ts`
- `Locava Backendv2/src/domains/legends/legend-award.service.ts`
- `Locava Backendv2/src/domains/legends/legend-scope-deriver.ts`
- `Locava Backendv2/src/domains/legends/legend.repository.ts`

## 4) After-post retrieval + UX

1. Native post-result flow polls `GET /v2/legends/after-post/:postId` up to 90s.
   - File: `Locava-Native/src/features/legends/legendAwardsAfterPost.ts`
2. If awards arrive, native queues claim flow in `legendClaimModal.store`.
3. Post-result modal flow then consumes one pending top-priority legend award; dedupe via in-memory `shownAwardIds`.
   - Files:
     - `Locava-Native/src/features/post/upload/runPostUpload.ts`
     - `Locava-Native/src/features/achievements/heavy/modals/legendClaimModal.store.ts`
     - `Locava-Native/src/features/achievements/achievementModals.store.ts`

---

## Route Inventory (Legends + post-related surfaces)

## Legends-specific routes

1. `POST /v2/legends/stage-post`  
   - File: `src/routes/v2/legends-stage-post.routes.ts`  
   - Contract: `src/contracts/surfaces/legends-stage-post.contract.ts`  
   - Request: `userId, lat/lng/geohash, activityIds, city/state/country/region`  
   - Writes: `legendPostStages/{stageId}`  
   - Reads: bounded scope/stat reads for preview (`2N`, N <= 8)  
   - Notes: reverse geocode backfill with timeout; best-effort from native

2. `DELETE /v2/legends/stage-post/:stageId`  
   - File: `src/routes/v2/legends-stage-post-cancel.routes.ts`  
   - Contract: `src/contracts/surfaces/legends-stage-post-cancel.contract.ts`  
   - Writes: marks stage `cancelled` (if exists and not committed)  
   - **Risk**: no route-level ownership validation before cancel

3. `GET /v2/legends/after-post/:postId`  
   - File: `src/routes/v2/legends-after-post.routes.ts`  
   - Contract: `src/contracts/surfaces/legends-after-post.contract.ts`  
   - Reads: `legendPostResults`, `legendProcessedPosts`, optional `legendPostStages`, `users/{viewer}/achievements_awards/{postId}`, pending celebrations  
   - Response: `status`, `awards`, `rewards`, `pollAfterMs`, `xp*`, `legendStatus`, `reasonIfEmpty`

4. `GET /v2/legends/events/unseen` and `POST /v2/legends/events/:eventId/seen`  
   - File: `src/routes/v2/legends-events.routes.ts`  
   - Used for overtake/defense events (separate from after-post awards)

5. `GET /v2/legends/me/bootstrap` and `GET /v2/legends/scopes/:scopeId`  
   - Files:
     - `src/routes/v2/legends-me-bootstrap.routes.ts`
     - `src/routes/v2/legends-scope-detail.routes.ts`

## Posting routes that affect Legends lifecycle

- `POST /v2/posting/finalize` (accepts `legendStageId`)  
  - File: `src/routes/v2/posting-finalize.routes.ts`  
  - Service: `PostingMutationService.finalizePosting`  
  - Schedules `scheduleLegendsCommit` asynchronously.

- Upload/session/media routes used before finalize:
  - `src/routes/v2/posting-upload-session.routes.ts`
  - `src/routes/v2/posting-media-register.routes.ts`
  - `src/routes/v2/posting-media-mark-uploaded.routes.ts`
  - `src/routes/v2/posting-operation-status.routes.ts`

## Parallel/legacy publishing surface

- `POST /v2/posts/publish` remains active (legacy-monolith style service path).
  - File: `src/routes/v2/posts-publish.routes.ts`
  - Service: `src/services/mutations/posts-publish.service.ts`

---

## Legends Award Eligibility Logic (What decides "earned legend?")

Core logic chain:

1. Scope derivation from post attributes (`LegendScopeDeriver.deriveFromPost`)
2. Per-scope counter mutation + leader selection
3. Award type selection (`LegendAwardService.decideAward`)

Fields used:

- `geohash` (for `cell` + `cellActivity` scopes)
- `activities[]` normalized and capped
- `state` (+ `city`) for place scopes
- optional `country`, `region` (country currently not used for scope generation)
- post/user IDs

Direct answers to required eligibility questions:

- Depends on activity? **Yes** (`activity`, `cellActivity`, `placeActivity`)
- Depends on location? **Yes** (`cell`, `place`, place-activity combos)
- Depends on city/state/region/country?
  - state: **Yes**
  - city: **Yes** (if state present)
  - region/country: **partially** (input accepted; country scope currently disabled)
- Depends on post count? **Yes** (leader/user count increments per scope)
- Depends on media type? **No explicit gate in Legends logic**
- Depends on privacy? **No explicit gate in Legends award logic**
- Depends on deleted/hidden/draft/staged? **Only finalized created posts are processed**; no explicit delete rollback found
- Counts only successful finalized posts? **Yes** by current pipeline entrypoint
- Includes duplicate posts?  
  - duplicate finalize with same operation/post: guarded  
  - separate distinct posts: both counted
- Includes reposts/saved posts? **No direct repost/saved coupling found in Legends path**
- Counts old posts or only new posts? **Only new post creation events in this pipeline**
- Uses denormalized user doc stats? **No; uses `legendUserStats` + `legendScopes`**
- Scans posts directly? **No full scan in commit path**
- Uses cached counters? **Uses persisted scope/user counters, not in-memory caches**
- Uses transactions? **Yes** for staged commit
- Can double-award? **Mostly protected**; residual unknown if same post enters separate incompatible path
- Can miss awards? **Yes** if async commit fails or client poll window expires
- Can award on stale/missing fields? **Yes fallback risk** when post has incomplete geo/activity fields

---

## Staging Behavior Audit

Questions answered:

- Does native call stage-post? **Yes**, best-effort in compose transitions.
- What is staged?
  - `derivedScopes`, preview cards, owner user, expiry, status
- Where stored?  
  - `legendPostStages/{stageId}`
- How long does stage live?
  - backend stage TTL config default 10 minutes (`LegendService`), clamped bounds
- Cleaned up on cancel? **Attempted** (native best-effort cancel)
- Cleaned up on upload fail? **Native tries cancel when no postId**
- Cleaned up on finalize success?  
  - local stage store cleared; server stage marked `committed` (not deleted)
- Finalize success but background commit fails?
  - post exists, legends result can become `failed`; user may receive no award UX
- Native never sends `legendStageId`?
  - fallback `processPostCreated` path derives from canonical post
- User posts twice quickly?
  - share guard + idempotency per task; separate posts can each process legends
- App closes mid upload/finalize?
  - task reconciliation uses operation status route; partial recovery depending captured operationId
- Can stages leak forever?
  - status can stay staged/cancelled/expired/committed; no hard cleanup job in audited code
- Can stage be reused incorrectly?
  - commit enforces stage status/user match; committed stage cannot be reused
- Can user spoof another user stageId?
  - commit path rejects stage user mismatch
  - **cancel path currently vulnerable (no ownership check)**
- Auth checks correct?
  - viewer auth + cutover checks present; ownership check missing in cancel route

---

## After-Post Receiving UX Audit

- Primary post-share legends UX comes from:
  - `runPostUpload` -> `fetchLegendsAfterPostWithBriefPolling` -> queue award -> post result flow modal step
- Display timing:
  - not immediate at Share tap; appears after post success + polling outcome
- Route used: **Yes**, `GET /v2/legends/after-post/:postId`
- Also related surfaces:
  - legends event unseen watcher (overtake events)
  - achievements bootstrap/claimables may influence adjacent modal sequencing

Behavior under conditions:

- Slow route: polls up to 90s then returns processing/empty in UI path
- Multiple legends: queued; best award selected for claim modal step, with "more" count
- No legend: no legend modal step, flow continues
- Already shown legend: in-memory dedupe via `shownAwardIds` (session-scoped)
- Seen state:
  - for event stream: explicit seen endpoint exists
  - for after-post award presentation: no backend per-award "shown-to-user" update in this path
- Claimed state:
  - canonical award payload includes viewer status semantics (`claimed` for first family)
- Network blocking:
  - designed off critical path; finalize/post success not blocked
- Freeze risk:
  - heavy async steps with many swallowed errors; low direct freeze, medium consistency risk
- Popup conflicts:
  - achievements + legends sequencing uses shared post-result flow; conflicts mitigated but possible under racey state updates
- Skip risk:
  - yes, if polling misses commit window or navigation/state flush races

---

## Contracts / Response Shape Audit

Strong points:

- Zod contracts are present for core legends/finalize routes.
- `after-post` contract explicitly supports `processing|complete|failed`.
- Finalize contract includes `legendStageId`.

Findings:

- Stage-post contract requires `userId` from client body; route defaults to viewer if missing/empty, but schema currently requires min length.
- After-post route normalizes many fields defensively; this helps compatibility.
- Finalize response may return `legendRewards` processing placeholder while commit runs async.
- Some native integrations ignore portions of response or remap reward cards into award-like rows.
- Legacy achievement API fallback branches still exist in native while `/api/achievements/*` hard-block path exists in request helper, creating dead/confusing fallback code.

---

## Firestore Data Model Inventory (Legends-related)

Canonical legends collections/docs:

- `legendPostStages/{stageId}` (staged inputs, status, expiry)
- `legendProcessedPosts/{postId}` (idempotency marker)
- `legendPostResults/{postId}` (after-post payload status/results)
- `legendScopes/{scopeId}` (leaderboards per scope)
- `legendUserStats/{scopeId_userId}` (per-user per-scope counters)
- `legendFirstClaims/{claimKey}` (global first-claim uniqueness)
- `legendRankAggregates/{aggregateKey}` (rank family aggregates)
- `users/{userId}/legendAwards/{awardId}` (award history)
- `users/{userId}/legendEvents/{eventId}` (overtake/defense events)
- `users/{userId}/legends/state` (active/close/recent/defense projections)

Overlapping systems touched in post lifecycle:

- `posts/{postId}`
- `users/{userId}` + `users/{userId}/posts/{postId}`
- `users/{userId}/achievements/state`
- `users/{userId}/achievements_awards/{postId}`
- badges/challenges collections via achievements repository

Index/read-pattern concerns:

- unseen events query requires compound index support for `seen + createdAt desc`.
- No unbounded scan detected in core commit path; scope list bounded/capped.
- Stage docs and processed/result docs likely need lifecycle cleanup policy (TTL/cloud function) to avoid growth.

---

## Idempotency / Duplicate Award Safety Matrix

Legend:

- safe
- probably safe
- unsafe
- unknown

1. Finalize retried (same idempotency key): **safe**  
2. Native calls after-post multiple times: **safe** (read-only + dedupe on client display)  
3. Background legend worker runs twice: **safe** (processed marker transaction guard)  
4. Upload success + finalize retries: **probably safe** (depends on consistent operation idempotency path)  
5. User taps Share multiple times quickly: **probably safe** (UI guard + unique task ids; still separate post risk if user intentionally repeats)  
6. Timeout but backend succeeds: **probably safe** (operation recovery exists; edge race remains)  
7. App reloads after posting: **probably safe** (task store reconciliation, with edge unknowns if operationId absent)  
8. Two posts created in short time: **safe** (distinct post IDs, distinct commit markers)  
9. Same post processed by legacy + v2 paths: **unknown/high risk** if overlap happens in real client mix  
10. Same stageId reused: **safe** for commit (status/user checks), **unsafe** for cancel endpoint auth

---

## Performance / Latency Audit (Route-level budget)

| Route / Function | Expected Reads | Expected Writes | Blocking vs Async | Current Risk | Recommended Budget |
|---|---:|---:|---|---|---|
| `POST /v2/legends/stage-post` | ~`2N` (`scope+stat`, N<=8) | 1 | Blocking | P2 | p95 < 350ms without reverse geocode, < 900ms with backfill |
| `POST /v2/posting/finalize` | session/media/post reads + idempotency lookups | post write + op updates + prime result | Mostly blocking for post creation; legends async | P1 | p95 < 1.5s excluding media transport |
| `scheduleLegendsCommit` worker | 3 + `2N` + first-claim checks | scope/stat/result/processed/stage + awards/events | Async | P1 | p95 < 1.2s (N<=8) |
| `GET /v2/legends/after-post/:postId` | 1-4 + award/celebration reads | 0 | Blocking | P1 | p95 < 250ms cached hot, < 600ms cold |
| `GET /v2/legends/events/unseen` | bounded query | seen writes on separate route | Blocking | P2 | hard cap already present; keep < 120ms |
| Native `fetchLegendsAfterPostWithBriefPolling` | repeated after-post reads until status/timeout | 0 | Async from share critical path | P1 UX | keep polling interval adaptive; avoid >30 requests per post |

Observations:

- Posting does not synchronously wait for Legends commit (good for share latency).
- After-post UX can lag/miss if commit is slow > polling window.
- No full collection scans found in core commit loop.

---

## Relationship Audit: Achievements / Challenges / Badges / XP / Other systems

Shared coupling points:

- Finalize schedules both Legends and Achievements pipelines.
- `after-post` endpoint bundles XP claim + league pass celebration + legends rewards.
- Native post-result flow is shared across achievements and legends.
- Dynamic leader badge sync is invoked after legends commit (`syncDynamicLeaderBadgesForViewer`).

Risks:

- A broken achievements delta/claim path can degrade legends post-result UX timing/coherence.
- Mixed legacy/v2 achievement client code increases possibility of stale assumptions and swallowed errors.
- Shared modal gating can reorder or hide expected legends step under certain state races.

No direct evidence in audited code of hard coupling with Clubs/Trips/Memories logic, beyond shared post creation surfaces.

---

## Dead / Duplicated / Legacy Findings

1. Two active publish paths:
   - `/v2/posting/finalize` (current canonical)
   - `/v2/posts/publish` (legacy route still active)
2. Misleading service method name: `publishToLegacyMonolith` now writes canonical native post path internally.
3. Native achievements API contains legacy fallback branches that are effectively disabled in helper for `/api/*`.

---

## Top Risk Findings (Top 10)

1. **P0** Stage cancel authorization gap: `DELETE /v2/legends/stage-post/:stageId` cancels by ID without owner match check.  
2. **P1** No explicit privacy gate in legends awarding logic (private/friends policy unclear/unenforced).  
3. **P1** Async commit + finite poll window can miss immediate legends UX despite successful eventual commit.  
4. **P1** Dual publish stacks increase divergence/double-processing uncertainty in mixed-client environments.  
5. **P1** Swallowed errors in native after-post/staging path can silently skip legends UI updates.  
6. **P1** App-close / timeout recovery depends on operation tracking; edge races remain for late commits.  
7. **P2** Stage/result/processed docs lack explicit cleanup lifecycle in audited path (growth/leak risk).  
8. **P2** Heavy logging in legends posting path may add noisy diagnostics; ensure prod log budgets remain safe.  
9. **P2** In-memory dedupe (`shownAwardIds`) is session-local; cross-session repeat UX possible by design.  
10. **P2** Achievements+Legends shared modal orchestration can create non-deterministic ordering under async updates.

---

## Missing Tests / Gaps

High-value missing coverage:

- Stage cancel authz (cross-user attempts)
- Privacy variants (public/friends/secret) effect on award eligibility
- finalize timeout with eventual backend success + operation recovery
- after-post poll timeout but eventual legend commit
- duplicate finalize + duplicate stage reuse + stage expiry
- mixed legacy/v2 publish path interactions

---

## Recommended Repair Plan (Next Phase, ordered)

1. **P0 immediate**: enforce stage ownership in cancel route/repository path.
2. **P1**: codify and enforce privacy policy in legends eligibility.
3. **P1**: tighten after-post reliability contract:
   - explicit "processing age" diagnostics
   - client fallback retrieval path after initial window
4. **P1**: decide single canonical publish route and lock down mixed behavior.
5. **P1/P2**: reduce swallowed errors to structured non-fatal telemetry.
6. **P2**: add retention/TTL cleanup for stage/result/processed docs.
7. **P2**: persist shown-award state if product requires cross-session dedupe.
8. **P2**: explicit integration tests across shared achievement+legend modal sequencing.

---

## Recommended Simulation/Test Harness Plan

Target: emulator + native-like runner that mirrors real share flow (session/media/finalize/poll).

Must include these scenarios:

1. earns no legend
2. earns exactly one
3. earns multiple on one post
4. missing activity fields
5. missing location fields
6. public/friends/private variants
7. cancel before finalize
8. upload success finalize fail
9. finalize success after-post fetch fail
10. duplicate finalize call
11. duplicate stage-post call
12. stageId reused
13. app close after finalize
14. share tapped twice
15. slow Firestore simulation
16. missing index behavior
17. old post schema
18. new post schema
19. legacy route compatibility
20. v2-only behavior
21. existing heavy user
22. new user zero posts

Harness requirements:

- deterministic clock controls for polling/retries
- network fault injection (timeouts/partial success)
- explicit assertions on Firestore doc-level side effects
- UI-state assertions for modal/popup sequencing

---

## Instrumentation Added in This Audit

None.  
No production behavior was modified in this run.

---

## Exact Files / Functions / Routes to Change Next Run

P0/P1 first edits:

1. `Locava Backendv2/src/routes/v2/legends-stage-post-cancel.routes.ts`  
2. `Locava Backendv2/src/domains/legends/legend.repository.ts` (`cancelStage`)  
3. `Locava Backendv2/src/domains/legends/legend.service.ts` (privacy-policy gating, explicit eligibility guards)  
4. `Locava Backendv2/src/routes/v2/legends-after-post.routes.ts` (diagnostic/status robustness)  
5. `Locava-Native/src/features/legends/legendAwardsAfterPost.ts` (poll fallback/timeout UX policy)  
6. `Locava-Native/src/features/post/upload/runPostUpload.ts` (error handling + resilient queueing)  
7. `Locava Backendv2/src/routes/v2/posts-publish.routes.ts` and `src/routes/v2/posting-finalize.routes.ts` (publish path consolidation strategy)

---

## Ship Readiness Verdict

Current implementation is **not safe enough to ship as-is** without at least:

- stage cancel authz fix (P0)
- privacy policy enforcement decision + code enforcement (P1)
- post-result reliability hardening for async commit lag (P1)

Everything else can follow in a phased hardening rollout.

