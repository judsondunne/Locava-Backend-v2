# Post algorithm canonical readiness — Master Post V2 / legacy bilingual access

**Date:** 2026-05-04  
**Scope:** Backend V2 algorithm read paths + shared selectors; Native primary-activity selector; inventories and readiness script (no mass migration, no write-shape changes).

---

## Executive summary

Shared **`src/lib/posts/postFieldSelectors.ts`** centralizes canonical-first reads for in-memory algorithms. **Search discovery** (map, rank, bootstrap pools), **mix ranking**, **mix generation dedupe**, and **mix post Firestore visibility** now consume those selectors after fetch. **Firestore queries** that rely on legacy top-level indexes (for example `activities` array-contains, `time` orderBy, `cityRegionId` equality) are unchanged by design.

**Verdict:** Additive migration in **tiny batches** is **reasonable** only together with continued **dual-write of top-level query fields** (see below). **Mass migration** remains **operationally risky** until optional indexes exist for nested canonical fields and every query path is migrated. **Legacy top-level fields remain required** for query/index compatibility for the routes listed in this document.

---

## Phase 1 — Backend inventory

Machine-generated grep inventory:

- `docs/audits/post-algorithm-backend-inventory-2026-05-04.json`  
- Regenerate: `npm run audit:post-algorithm-inventory` (backend + native heuristic scan)

Native heuristic inventory:

- `docs/audits/post-algorithm-native-inventory-2026-05-04.json`

Classification in the JSON is **heuristic** (path-based bucket). Anything marked `needs_manual_review` should be triaged over time.

---

## Phase 2 — Firestore query constraints (top-level fields)

Until composite / nested field indexes are introduced and queries rewritten, **these top-level fields must remain written** on `posts` documents for algorithms that filter or order in Firestore:

| Field / pattern | Typical query | Migrated V2 must keep |
|-----------------|---------------|----------------------|
| `activities` | `array-contains` / `array-contains-any` | Yes — denormalized list for index |
| `time`, `createdAtMs`, `updatedAtMs` | `orderBy("time")`, recency | Yes |
| `userId` (and legacy `ownerId` where still queried) | equality / `in` | Yes |
| `lat`, `lng` / `long`, `geohash`, `geoData` | geo-ish filters (where used) | Yes |
| `cityRegionId`, `stateRegionId`, `countryRegionId` | equality | Yes |
| `privacy`, `deleted`, `isDeleted`, `archived`, `hidden` | soft filters (in-memory after select) | Yes (or equivalent denorm) |
| `assetsReady`, `mediaType`, `randomKey` (feeds) | feed / pool queries | Yes where referenced |
| `searchText` / `searchableText` (if indexed) | prefix search routes | Yes where referenced |

**Canonical equivalents** exist on Master Post V2 (`classification`, `location`, `lifecycle`, `media`, etc.) for **post-fetch** logic; they do **not** replace Firestore index fields until queries change.

---

## Phases 3–8 — Code changes this pass

### Backend selector module

- **`src/lib/posts/postFieldSelectors.ts`** — all requested getters + `isPostVisibleInPublicAlgorithmPools`, `postActivitiesCanonicalLegacyMismatch`, `buildPostAlgorithmFieldSource`.
- **`src/lib/posts/postFieldSelectors.test.ts`** — Vitest coverage for bilingual behavior.
- **`src/diagnostics/postAlgorithmFieldSource.ts`** — thin exports for structured diagnostics.

### Backend algorithms wired to selectors

| Area | File(s) |
|------|-----------|
| Search discovery | `src/services/surfaces/search-discovery.service.ts` — `mapDiscoveryPost`, `rankPosts`, `loadTopActivities`, expanded `select()` list |
| Mix ranking | `src/services/mixes/mixRanking.service.ts` |
| Mix generation | `src/services/mixes/mixGeneration.service.ts` — dedupe IDs via `getPostId` |
| Mix post pool | `src/repositories/mixPosts.repository.ts` — visibility via `isPostVisibleInPublicAlgorithmPools`; extended `select()` for canonical blobs |

### Native

- **`Locava-Native/src/features/posts/getPostActivities.ts`** — `getPostPrimaryActivity` reads root `classification.primaryActivity` (Master Post V2 on the wire).
- **`Locava-Native/src/features/posts/getPostActivities.test.ts`** — regression test.

### Not fully migrated in this pass (intentional scope boundary)

Large surfaces still contain direct field reads suitable for **follow-up** PRs: feed-for-you repositories/adapters, map-markers adapter, profile adapters, collections, notifications, chat previews, deep link resolvers, achievements, and compat legacy routes. The **inventory JSON** lists files for systematic follow-up.

---

## Phase 9 — Readiness script

- **Script:** `scripts/audits/post-canonical-algorithm-readiness.mts`
- **Command:** `npm run audit:post-algorithm-readiness`
- **Output:** `artifacts/audits/post-canonical-algorithm-readiness-2026-05-04.json`  
- **Behavior:** Synthetic fixtures only; **no Firestore writes**. Extend later with optional real post ID sampling.

---

## Phase 10 — Tests run (this session)

| Suite | Result |
|-------|--------|
| `vitest run src/lib/posts/postFieldSelectors.test.ts` | Pass |
| `vitest run src/routes/v2/search-discovery.routes.test.ts` | Pass |
| `vitest run src/routes/v2/mixes.routes.test.ts` | Pass |
| `Locava-Native`: `vitest run src/features/posts/getPostActivities.test.ts` | Pass |
| `npm run typecheck` (Backend V2) | **Fails** on pre-existing errors in `toAppPostV2.test.ts`, `posting-finalize.orchestrator.ts`, `feed-bootstrap.orchestrator.ts`, `feed-page.orchestrator.ts` (unrelated to this pass) |

---

## Phase 11 — Selector source-of-truth rules

1. **Canonical root** (`schema.name === "locava.post"` && `version === 2`) wins for nested `lifecycle`, `author`, `text`, `location`, `classification`, `media`, `engagement`, `ranking`, `compatibility`.
2. **`appPost` / `appPostV2`** embedded slices win when present and root canonical is absent (API envelope shapes).
3. **Legacy top-level** fields are fallbacks.
4. **Firestore `where` / `orderBy`** may only use legacy paths until index/query migration — reads after fetch should still go through selectors.

---

## Phase 12 — Remaining risks

- **Activity query drift:** If migration ever wrote **only** canonical `classification.activities` and **stopped** updating top-level `activities`, **array-contains** queries would miss posts. Mitigation: keep denormalized `activities` in lockstep, or add parallel indexed field + query migration.
- **Canonical vs legacy mismatch:** Use `postActivitiesCanonicalLegacyMismatch` + `buildPostAlgorithmFieldSource` logging in hot paths when debugging drops.
- **Incomplete selector rollout:** Inventory JSON shows many files still matching raw field tokens; migrate incrementally.

### Migration verdict

| Question | Answer |
|----------|--------|
| Safe to begin additive migration in **tiny batches**? | **Yes**, provided **top-level index fields stay populated** and post-fetch logic uses selectors (continue rollout). |
| Mass migration blocked? | **Recommended to block** until query/index strategy is explicit and soak-tested. |
| Legacy fields still required? | **Yes** for Firestore query compatibility as documented above. |
| Fields never removed until query migration? | **`activities`, region IDs, geo/lat-lng/geohash, `time`/`createdAtMs`, `userId`, visibility/deletion denorms**, and any field appearing in a live composite index. |

---

## Commands

```bash
npm run audit:post-algorithm-inventory
npm run audit:post-algorithm-readiness
```
