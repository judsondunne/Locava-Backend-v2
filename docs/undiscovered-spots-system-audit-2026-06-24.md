# Undiscovered Spots System — Audit (June 24)

Status: current-state map of the discovery pipeline as it exists in `Locava-Backend-v2`.
Scope: OSM PBF v2 setup, Wikimedia/WikiCommons MVP, undiscovered-spots data structure, and what is close to done.

---

## 1. The two Firestore collections everything funnels into

All discovery output lands in exactly two collections (enforced by guards):

- `unexploredSpots` — point spots
- `unexploredRoutes` — routes/trails

Guarded in `src/admin/openstreetmap/national/pbfCopier/pbfCopierGuards.ts`:
- `PBF_COPIER_ALLOWED_COLLECTIONS = ["unexploredSpots", "unexploredRoutes"]`
- `PBF_COPIER_FORBIDDEN_COLLECTIONS = ["posts"]` — the pipeline can never write to the live feed.

Canonical doc shape is defined in `src/contracts/entities/osm-national-entities.contract.ts`
(`UnexploredRoute` etc.). Photo data attaches as a `photoSearch` sub-object (see §4).

---

## 2. OSM PBF v2 — the primary MVP (`/admin/openstreetmap/pbf-copier-v2`)

This is the live discovery engine. Source files:

- Dashboard UI: `src/dashboard/openstreetmap-pbf-copier-v2.ts` (MapLibre, read-only viewport preview, no writes on load)
- HTTP routes: `src/admin/openstreetmap/national/pbfCopier/pbfCopierV2.routes.ts`
  (base `/admin/openstreetmap/api/pbf-copier-v2`)
- Shared classify/filter pipeline: `pbfCopierV2Pipeline.ts`
- Quality filters: `pbfCopierV2QualityFilters.ts`
- Write path: `pbfCopierV2Write.ts` (gated)

### Flow
1. Load a local `.osm.pbf` → `validate-file`
2. `viewport-preview` / `full-run` scans raw OSM features → `PbfCopierPreviewDoc[]`
3. `runPbfCopierV2Pipeline` → generated display names + `applyPbfQualityFilters` + grouping
4. `apply-quality-filters` / `audit` for review
5. `validate-write-payload` → `dry-run-write` → `write-blank-spots` (writes blank spots; photos fetched later on demand)

### Endpoint surface (already built)
- Health/counts: `health`, `undiscovered-counts`, `undiscovered-map-preview`
- Map repair/purge: `repair-map-visibility`, `purge-undiscovered`
- Review: `validate-file`, `audit`, `viewport-preview`, `apply-quality-filters`
- Write: `validate-write-payload`, `dry-run-write`, `write-blank-spots`
- Full run (long jobs): `full-run/{start,pause,resume,stop,write-current,status,runs,chunks}`
- Asset preview (photos): `asset-preview/{live-sources,sources,fetch,fetch-stream,fetch-stream-live,vision-qa-spot}`

### Default quality gate (`DEFAULT_PBF_QUALITY_FILTER_SETTINGS`)
Hides: infrastructure, service roads, administrative, railway, broad geography,
unnamed land, unnamed paths, non-destination amenities, low-quality mountain/outdoor.
→ This is the existing definition of "what counts as a spot." Discovery quality rules already live here.

### Vermont path (the named first test region)
`src/admin/openstreetmap/vermontOffroadUndiscoveredImport.service.ts` (`STATE_CODE = "VT"`)
is a dedicated off-road import for Vermont — state bbox scan → `buildUnexploredDocsFromClassification`
→ `writeUnexploredChunkDocs` + tile writer. Session/preview/write tracked in
`vermontOffroadImportSessionStore.ts`. **Vermont is already wired as a first-class import target.**

---

## 3. National copier (scale-out layer)

`src/admin/openstreetmap/national/copier/osmNationalCopier.routes.ts` — run orchestration for
multi-region imports: `dry-run`, `runs/plan`, `runs/start`, pause/resume/cancel, events, preview, export.
Runner: `osmNationalCopierRunner.ts`, store: `osmNationalRunStore.ts`.
This is how PBF v2 generalizes beyond a single viewport to whole states.

---

## 4. Photos — on-demand web photo search (shipped 2026-06-07)

Per `docs/undiscovered-web-photo-search-report.md`:
- Route `POST /v2/undiscovered/photo-search` (`undiscovered.photo_search.post`)
- Heuristic only (Serper → Bing), **no Gemini**. Photos hidden until user taps "See web photos."
- Caches up to 12 results (returns 5) in a `photoSearch` object on the canonical unexplored doc.
- Service: `src/services/undiscovered/undiscoveredPhotoSearch.service.ts`
- Env: `SERPER_API_KEY`, `BING_SEARCH_API_KEY`, `UNDISCOVERED_PHOTO_SEARCH_ENABLED`
- Native UI components already exist (`UndiscoveredWebPhoto*` in Locava-Native per report).

**Assessment: essentially done.** Spots are written "blank," photos hydrated lazily and cached.

---

## 5. Wikimedia / WikiCommons MVP — assessment

- Dev-only page (`ENABLE_WIKIMEDIA_MVP_DEV_PAGE`, `/dev/wikimedia-mvp` per the older `:4000` URL).
- Write path is **separately and more cautiously gated**: `ALLOW_WIKIMEDIA_MVP_FIREBASE`,
  `WIKIMEDIA_MVP_ALLOW_WRITES`, `WIKIMEDIA_MVP_ENABLE_FIRESTORE_DEDUPE`, plus per-run caps
  (`WIKIMEDIA_MVP_MAX_PLACES_PER_RUN` default 10, candidates/pages/hydrate caps, 5-min timeout).
- Overlaps the photo problem the on-demand web search (§4) now solves heuristically.

**Recommendation:** treat Wikimedia MVP as a *supplementary licensed-image source*, not the primary
discovery path. PBF v2 owns spot discovery; on-demand web search owns photos. Wikimedia's value is
properly-attributed/licensed images for spots where web search is thin — worth keeping behind its
existing write guards, not worth making it the backbone. Confirm with Judson before investing further.

---

## 6. Safety posture (must respect — `AGENTS.md`)

Production Firestore is read-only by default. Destructive ops (wipe/reseed/purge) require the
emulator + `ALLOW_DESTRUCTIVE_FIRESTORE_EMULATOR_ONLY` + guard. PBF writes are gated by a production
unlock env var + confirmation phrase (`pbfCopierGuards.ts`). Any dashboard work must keep dry-run-first.

---

## 7. What is close to done

| Piece | State |
|-------|-------|
| OSM PBF v2 spot discovery + quality filters | **Working**, the real engine |
| Vermont off-road import | **Wired** as first-class state target |
| Blank-spot write + gated full-run | **Working** |
| On-demand web photo search + Native UI | **Shipped** (2026-06-07) |
| National multi-region copier | **Built**, run-orchestrated |
| Wikimedia MVP | Dev-only, gated, supplementary — **decide scope** |
| Multi-channel sources (Reddit/IG/blogs/trails) | **Not started** (June 26–27 milestone) |

## 8. Dashboard requirements implied for v1 (feeds June 25–26)

The "all-in-one dashboard" is largely an **aggregation + review layer over what exists**:
1. Reuse `pbf-copier-v2` review/audit/quality endpoints as the spot-review backbone.
2. Per-region status (start with Vermont via the existing VT import session store).
3. A review/status workflow (candidate → reviewed → written) — partly present in run stores; needs an explicit status field.
4. Spot categories + quality rules — already encoded in `DEFAULT_PBF_QUALITY_FILTER_SETTINGS`; surface them as editable rules.
5. A channel-agnostic candidate shape so non-OSM sources (June 26–27) can feed the same review queue.

**Next obvious step:** define the unified "discovery candidate" review record (status + source channel)
that the v1 dashboard reads, using `unexploredSpots`/`unexploredRoutes` as the write target and the
existing PBF quality rules as the gate.
